// Phase 10G Astra remediation: ASTRA-10G-003 (explicit v25 data may not omit
// `gameRuleFacts`) and ASTRA-10G-004 (registered Rule Fact lifetimes are
// validated on recovery). Each malformed shape is driven through every real
// authoritative boundary: the persisted-game schema, local rehydration of
// Current State and of an Undo snapshot (the persist `merge` validator), and
// remote checkpoint recovery through the production startStorytellerSession /
// readCheckpoint chokepoint.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store, migrateStoreState, takeMigrationResetFlag } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { PIT_HAG_ARBITRARY_DEATHS, TOYMAKER_DEMON_SKIP_OCCURRED, gameRuleFactActive } from "@/stores/gameRuleFacts";
import { asV24 } from "@/test/v20Migration";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import type { GameRuleFactRecord, StorytellerLobbyRecord } from "@/stores/types";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";

type Raw = Record<string, unknown>;
const KEY = "new-blood-st";
const code = "ASTR4G10";
const registry = buildRegistry(setupScript);
const disposals: (() => void | Promise<void>)[] = [];
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true, code, storytellerUid: "host", ...over });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  return g;
}
const withoutRuleFacts = (g: StorytellerLobbyRecord): Raw => {
  const copy = structuredClone(g) as unknown as Raw;
  delete copy.gameRuleFacts;
  return copy;
};
const pitHag = (over: Partial<GameRuleFactRecord> = {}): GameRuleFactRecord =>
  ({ type: PIT_HAG_ARBITRARY_DEATHS, recordedAt: { phase: "night", day: 2 }, expiresAt: { phase: "day", day: 2 }, ...over });
const toymaker = (over: Partial<GameRuleFactRecord> = {}): GameRuleFactRecord =>
  ({ type: TOYMAKER_DEMON_SKIP_OCCURRED, recordedAt: { phase: "night", day: 2 }, ...over });

beforeEach(() => {
  localStorage.clear();
  takeMigrationResetFlag();
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript } });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

/** Rehydrates a CURRENT-version (v25) saved blob through the real persist
 * merge validator; returns whether the state was rejected and reset. */
async function rehydrateCurrent(state: { game: unknown; undoStack?: unknown[] }): Promise<boolean> {
  // Clear first: any setState persists, so it must precede the seeded blob.
  store.setState({ game: null, undoStack: [] });
  localStorage.setItem(KEY, JSON.stringify({
    state: { game: state.game, undoStack: state.undoStack ?? [], customScripts: { [setupScript.id]: setupScript }, view: "game", lobby: null, localSeq: 1, sync: null },
    version: 26,
  }));
  await store.persist.rehydrate();
  return takeMigrationResetFlag();
}

/** Seeds a real lobby whose checkpoint carries `game` and drives recovery on
 * a fresh device (no local game) through startStorytellerSession. */
async function recoverCheckpoint(game: unknown) {
  const b = new MemoryRoomBackend();
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  store.getState().setLobby(lobby);
  await b.set(`lobbies/${code}/checkpoint`, JSON.stringify({ game, roster: {} }));
  const writer = new SessionWriter(b, code, session.id);
  disposals.push(async () => { await writer.dispose(); });
  return { run: () => startStorytellerSession(b, lobby, writer), b };
}

describe("ASTRA-10G-003: explicit v25 data must carry gameRuleFacts (fails closed, never repaired)", () => {
  it("the persisted-game schema rejects a v25 game missing the collection; an empty one is valid", () => {
    expect(StorytellerGamePersistedSchema.safeParse(withoutRuleFacts(liveGame())).success).toBe(false);
    expect(StorytellerGamePersistedSchema.safeParse(liveGame()).success).toBe(true);
  });

  it("v25 Current State missing it is rejected on rehydration (state reset, nothing supplied)", async () => {
    expect(await rehydrateCurrent({ game: withoutRuleFacts(liveGame()) })).toBe(true);
    expect(store.getState().game).toBeNull();
  });

  it("a v25 Undo entry missing it is rejected even when Current State is valid", async () => {
    expect(await rehydrateCurrent({ game: liveGame(), undoStack: [withoutRuleFacts(liveGame())] })).toBe(true);
    expect(store.getState().game).toBeNull();
    // Control: the same state with a well-formed Undo entry round-trips.
    expect(await rehydrateCurrent({ game: liveGame(), undoStack: [liveGame()] })).toBe(false);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("a v25 checkpoint game missing it is refused by recovery before adoption", async () => {
    const { run } = await recoverCheckpoint(withoutRuleFacts(liveGame()));
    await expect(run()).rejects.toThrow(SnapshotValidationError);
    expect(store.getState().game).toBeNull();
  });

  it("an explicit v24 game missing it is migrated: exactly [] is added", () => {
    const v24 = asV24(liveGame()) as unknown as Raw;
    expect(v24).not.toHaveProperty("gameRuleFacts");
    const migrated = migrateStoreState({ game: structuredClone(v24), undoStack: [structuredClone(v24)] }, 24) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(migrated.game.gameRuleFacts).toEqual([]);
    expect(migrated.undoStack[0]!.gameRuleFacts).toEqual([]);
  });

  it("a present malformed collection is still rejected", () => {
    for (const bad of [null, {}, "none", [{ type: "bad type!", recordedAt: { phase: "night", day: 2 } }], [pitHag(), pitHag()]]) {
      expect(StorytellerGamePersistedSchema.safeParse({ ...liveGame(), gameRuleFacts: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("History is never used to reconstruct a missing fact", async () => {
    // A v25 game whose History records the Pit-Hag fact being applied but
    // whose Current State lacks the collection: rejected, not rebuilt.
    const g = liveGame();
    g.history = [{
      id: "h1", category: "gameRuleFact", moment: { phase: "night", day: 2 }, ruleFactType: PIT_HAG_ARBITRARY_DEATHS,
      ruleFactOperation: "apply", change: { kind: "added", item: pitHag() },
    }] as StorytellerLobbyRecord["history"];
    expect(await rehydrateCurrent({ game: withoutRuleFacts(g) })).toBe(true);
    expect(store.getState().game).toBeNull();
    // With an explicit (empty) collection the History stays explanatory only:
    // the fact is NOT active.
    expect(await rehydrateCurrent({ game: g })).toBe(false);
    expect(store.getState().game!.gameRuleFacts).toEqual([]);
    expect(gameRuleFactActive(store.getState().game!, PIT_HAG_ARBITRARY_DEATHS)).toBe(false);
  });

  it("the intended wire path: the checkpoint is one JSON string that keeps an empty collection, and recovery restores it", async () => {
    const { run } = await recoverCheckpoint(liveGame());
    const recovered = await run();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(store.getState().game!.gameRuleFacts).toEqual([]);
  });

  it("no production path decodes the sparse RTDB `storyteller` projection back into a game", () => {
    // Remote recovery reads only the checkpoint leaf; the `storyteller` node is
    // write-only for this client, so no sparse-array normalization is needed
    // (or permitted) to weaken persisted validation.
    const sync = readFileSync(resolve(__dirname, "storytellerSync.ts"), "utf8");
    expect(sync).toMatch(/raw\.get\(`lobbies\/\$\{lobby\.code\}\/checkpoint`\)/);
    expect(sync).not.toMatch(/\.get\([^)]*\/storyteller[`"']\)/);
    expect(sync).not.toMatch(/subscribe\([^)]*\/storyteller[`"']/);
  });
});

describe("ASTRA-10G-004: registered Rule Fact lifetimes are validated (never repaired)", () => {
  const MALFORMED: [string, GameRuleFactRecord][] = [
    ["Pit-Hag without expiry", { type: PIT_HAG_ARBITRARY_DEATHS, recordedAt: { phase: "night", day: 2 } }],
    ["Pit-Hag recorded during Day", pitHag({ recordedAt: { phase: "day", day: 1 }, expiresAt: { phase: "day", day: 2 } })],
    ["Pit-Hag expiring at a later unrelated Day", pitHag({ expiresAt: { phase: "day", day: 999 } })],
    ["Pit-Hag expiring at Night", pitHag({ expiresAt: { phase: "night", day: 3 } })],
    ["Toymaker with an expiry", toymaker({ expiresAt: { phase: "day", day: 5 } })],
  ];

  it.each(MALFORMED)("the schema rejects %s", (_label, fact) => {
    expect(StorytellerGamePersistedSchema.safeParse(liveGame({ gameRuleFacts: [fact] })).success).toBe(false);
  });

  it.each(MALFORMED)("an ended snapshot still rejects %s (the moment is frozen, not the lifetime)", (_label, fact) => {
    expect(StorytellerGamePersistedSchema.safeParse(liveGame({ phase: "ended", day: 4, gameRuleFacts: [fact] })).success).toBe(false);
  });

  it.each(MALFORMED)("Current State carrying %s is rejected on rehydration", async (_label, fact) => {
    expect(await rehydrateCurrent({ game: liveGame({ gameRuleFacts: [fact] }) })).toBe(true);
    expect(store.getState().game).toBeNull();
  });

  it.each(MALFORMED)("an Undo snapshot carrying %s is rejected on rehydration", async (_label, fact) => {
    expect(await rehydrateCurrent({ game: liveGame(), undoStack: [liveGame({ gameRuleFacts: [fact] })] })).toBe(true);
    expect(store.getState().game).toBeNull();
  });

  it.each(MALFORMED)("checkpoint recovery refuses %s before adoption", async (_label, fact) => {
    const { run } = await recoverCheckpoint(liveGame({ gameRuleFacts: [fact] }));
    await expect(run()).rejects.toThrow(SnapshotValidationError);
    expect(store.getState().game).toBeNull();
  });

  it("well-formed registered facts are valid live and in an ended snapshot", () => {
    expect(StorytellerGamePersistedSchema.safeParse(liveGame({ gameRuleFacts: [pitHag(), toymaker()] })).success).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(liveGame({ phase: "day", day: 3, gameRuleFacts: [toymaker({ recordedAt: { phase: "day", day: 3 } })] })).success).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(liveGame({ phase: "ended", day: 2, gameRuleFacts: [pitHag(), toymaker()] })).success).toBe(true);
  });

  it("an unregistered type acquires no registered lifetime semantics", () => {
    const custom = { type: "houseRuleNote", recordedAt: { phase: "day", day: 2 }, expiresAt: { phase: "night", day: 999 } } as GameRuleFactRecord;
    expect(StorytellerGamePersistedSchema.safeParse(liveGame({ phase: "day", day: 2, gameRuleFacts: [custom] })).success).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(liveGame({ phase: "day", day: 2, gameRuleFacts: [{ type: "houseRuleNote", recordedAt: { phase: "day", day: 1 } }] })).success).toBe(true);
  });

  it("planner-produced facts round-trip through persistence and checkpoint recovery unchanged", async () => {
    store.setState({ game: liveGame(), undoStack: [], localSeq: 1 });
    expect(store.getState().resolveGameRuleFacts({ intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }, { kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] })).toMatchObject({ ok: true });
    const planned = structuredClone(store.getState().game!);
    expect(planned.gameRuleFacts.map((f) => [f.type, f.recordedAt, f.expiresAt])).toEqual([
      [PIT_HAG_ARBITRARY_DEATHS, { phase: "night", day: 2 }, { phase: "day", day: 2 }],
      [TOYMAKER_DEMON_SKIP_OCCURRED, { phase: "night", day: 2 }, undefined],
    ]);
    // Local round-trip (Current State + the pre-apply Undo snapshot).
    const saved = localStorage.getItem(KEY)!;
    store.setState({ game: null, undoStack: [] });
    localStorage.setItem(KEY, saved);
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(store.getState().game).toEqual(planned);
    // Checkpoint round-trip.
    store.setState({ game: null, undoStack: [] });
    const { run } = await recoverCheckpoint(planned);
    const recovered = await run();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(store.getState().game!.gameRuleFacts).toEqual(planned.gameRuleFacts);
    // Phase rollover still expires the Pit-Hag fact; the result stays valid.
    expect(store.getState().advancePhase()).toMatchObject({ ok: true });
    expect(store.getState().game!.gameRuleFacts.map((f) => f.type)).toEqual([TOYMAKER_DEMON_SKIP_OCCURRED]);
    expect(StorytellerGamePersistedSchema.safeParse(store.getState().game).success).toBe(true);
  });
});
