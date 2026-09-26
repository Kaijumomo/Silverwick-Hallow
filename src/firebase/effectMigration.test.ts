// Phase 10B: store v19 -> v20 (the Effect lifecycle + explicit game schema
// version evidence) across every path -- local Current State, every Undo
// snapshot, remote checkpoint recovery through the real
// startStorytellerSession/readCheckpoint chokepoint -- plus the explicit
// version-evidence rule, recovery/reconnect never expiring anything, and the
// public/self/Public Display privacy boundary.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { detectLegacyGameVersion, hasV20Evidence, migrateGameEntry } from "@/stores/gameMigration";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";
import { writeProjections } from "./sync";
import type { StorytellerLobbyRecord } from "@/stores/types";

const code = "EFFX2345";
const root = `lobbies/${code}`;
const STORAGE_KEY = "new-blood-st";
const disposals: (() => void | Promise<void>)[] = [];
type Raw = Record<string, unknown>;

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: {},
  });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  localStorage.clear();
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

const alice = { kind: "participant", participantId: "pt-a", playerId: "a", nameAtTime: "Alice" };

const player = (id: string, seat: number, over: Raw = {}): Raw => ({
  id, name: id.toUpperCase(), seat, joinedAt: 1, actualRole: "chef",
  shownRole: "chef", shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
  alive: true, ghostVote: true, abilityUsed: false, statuses: {}, reminders: [], stNotes: "",
  isTraveler: false, actualAlignment: "good", effects: [], participantId: `pt-${id}`, ...over,
});

const manualV19 = { id: "manual:drunk", type: "drunk", lifetime: { kind: "manual" }, appliedAt: { phase: "night", day: 1 } };
const finiteV19 = { id: "fx-1", type: "poisoned", sourceCharacter: "poisoner", sourceParticipant: alice, lifetime: { kind: "throughFollowingDay" }, appliedAt: { phase: "night", day: 2 }, note: "SENTINEL-EFFECT-NOTE" };

/** Exactly what a v19 app stored/checkpointed: a Life Event Window, but no
 * Effect lifecycle and no gameSchemaVersion. Its History mentions an Effect
 * that is NOT in Current State (removed earlier) -- migration must never
 * consult it. */
function v19Game(phase = "day", day = 2): Raw {
  return {
    code, storytellerUid: "host", scriptId: "tb", phase, day, notes: "",
    players: {
      a: player("a", 0, { name: "Alice" }),
      b: player("b", 1, { name: "Bob", effects: [structuredClone(manualV19), structuredClone(finiteV19)] }),
    },
    seatOrder: ["a", "b"], nightProgress: {}, fabled: [], bluffs: [], lorics: [], rolePool: [],
    plannedPlayerCount: 2, plannedTravelerCount: 0, pendingPlayers: {}, setupRolesDealt: true, setupRolesRevealed: true,
    history: [
      { id: "h1", category: "effect", participant: alice, moment: { phase: "night", day: 1 },
        change: { kind: "added", item: { id: "gone", type: "protected", lifetime: { kind: "untilDawn" } } } },
      { id: "h2", category: "effect", participant: alice, moment: { phase: "day", day: 1 },
        change: { kind: "removed", item: { id: "gone", type: "protected", lifetime: { kind: "untilDawn" } } } },
    ],
    informationDeliveries: [],
    lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] },
  };
}

function expectedV20(entry: Raw): Raw {
  const copy = structuredClone(entry);
  const b = (copy.players as Record<string, Raw>).b!;
  b.effects = [
    { ...manualV19, state: "active", expiry: { kind: "none" } },
    { ...finiteV19, state: "active", expiry: { kind: "unresolved" } },
  ];
  copy.gameSchemaVersion = 20;
  return copy;
}

describe("Phase 10B migration: v19 -> v20", () => {
  it("manual Effects become active + no expiry; finite Effects become active + UNRESOLVED -- never guessed, never removed, never from History", () => {
    const original = v19Game();
    const result = migrateStoreState({ game: structuredClone(original), undoStack: [] }, 19) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(expectedV20(original));
    // History is untouched and its removed Effect is NOT recreated.
    expect(result.game.history).toEqual(original.history);
    expect(((result.game.players as Record<string, Raw>).a!.effects as unknown[])).toEqual([]);
  });

  it("the expiry is never inferred from the current phase: the same Effect migrates identically in any phase", () => {
    for (const [phase, day] of [["setup", 0], ["night", 1], ["day", 5], ["ended", 3]] as const) {
      const entry = v19Game(phase, day);
      migrateGameEntry(entry, 19, { kind: "canonical-only" });
      expect((entry.players as Record<string, { effects: Raw[] }>).b!.effects[1]!.expiry).toEqual({ kind: "unresolved" });
    }
  });

  it("every Undo snapshot migrates from its own content; the result is deterministic and idempotent", () => {
    const older = v19Game("night", 2);
    (older.players as Record<string, Raw>).b!.effects = [structuredClone(finiteV19)];
    const state = { game: v19Game(), undoStack: [older, v19Game()] };
    const a = migrateStoreState(structuredClone(state), 19) as { game: Raw; undoStack: Raw[] };
    const b = migrateStoreState(structuredClone(state), 19);
    expect(a).toEqual(b);
    expect(a.undoStack[1]).toEqual(a.game);
    expect((a.undoStack[0]!.players as Record<string, { effects: Raw[] }>).b!.effects).toEqual([{ ...finiteV19, state: "active", expiry: { kind: "unresolved" } }]);
    const snapshot = structuredClone(a);
    expect(migrateStoreState(a, 20)).toBe(a);
    expect(a).toEqual(snapshot);
    const entry = v19Game();
    migrateGameEntry(entry, 19, { kind: "canonical-only" });
    const once = structuredClone(entry);
    migrateGameEntry(entry, 19, { kind: "canonical-only" });
    migrateGameEntry(entry, 13, { kind: "canonical-only" });
    expect(entry).toEqual(once);
  });

  it("a genuine v19 localStorage blob rehydrates as v20 with an unresolved legacy Effect surfaced (not corruption)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 19, state: { game: v19Game(), undoStack: [v19Game("night", 2)] } }));
    await useStorytellerStore.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    const game = useStorytellerStore.getState().game!;
    expect(game.gameSchemaVersion).toBe(20);
    expect(game.players.b!.effects[1]!.expiry).toEqual({ kind: "unresolved" });
    expect(useStorytellerStore.getState().undoStack[0]!.gameSchemaVersion).toBe(20);
  });
});

describe("Phase 10B: explicit v20 evidence is never 'repaired' by legacy migration", () => {
  const v20 = () => expectedV20(v19Game());
  const malformed: [string, (g: Raw) => void][] = [
    ["an Effect missing its state", (g) => { delete ((g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!).state; }],
    ["an Effect missing its expiry", (g) => { delete ((g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!).expiry; }],
    ["an unknown operational state", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!.state = "paused"; }],
    ["a manual Effect with a timed expiry", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!.expiry = { kind: "at", moment: { phase: "night", day: 3 } }; }],
    ["a finite Effect with no expiry", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[1]!.expiry = { kind: "none" }; }],
    ["an expiry at Setup", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[1]!.expiry = { kind: "at", moment: { phase: "setup", day: 0 } }; }],
    ["a duplicate Effect id on one participant", (g) => { const e = (g.players as Record<string, { effects: Raw[] }>).b!.effects; e.push(structuredClone(e[0]!)); }],
    ["an unknown key on an Effect", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!.stray = 1; }],
    ["a retired sourcePlayer on an Effect", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!.sourcePlayer = "a"; }],
    ["a legacy ParticipantRef inside a parameter", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!.parameters = { chosen: { kind: "participant", participants: [{ kind: "legacy", playerId: "a" }] } }; }],
    ["an empty parameter map", (g) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!.parameters = {}; }],
    ["a wrong version marker", (g) => { g.gameSchemaVersion = 21; }],
    ["a string version marker", (g) => { g.gameSchemaVersion = "20"; }],
    ["an effect correction without its operation", (g) => { (g.history as Raw[]).push({ id: "h9", category: "effect", participant: alice, correction: true, change: { kind: "added", item: manualV19 } }); }],
    ["a v20 update snapshot with a malformed lifecycle", (g) => { (g.history as Raw[]).push({ id: "h9", category: "effect", participant: alice, effectOperation: "update",
      change: { kind: "value", from: { ...manualV19, state: "active", expiry: { kind: "none" } }, to: { ...manualV19, state: "active" } } }); }],
  ];

  it.each(malformed)("%s: rejected locally (reset) whether labelled v20 or v19 -- migration never touches it", (_label, corrupt) => {
    for (const version of [20, 19]) {
      const game = v20();
      corrupt(game);
      expect(hasV20Evidence(game)).toBe(true);
      expect(detectLegacyGameVersion(game)).toBe(20);
      const copy = structuredClone(game);
      migrateGameEntry(copy, 13, { kind: "canonical-only" });
      expect(copy).toEqual(game);
      const result = migrateStoreState({ game: structuredClone(game), undoStack: [] }, version) as { game: unknown };
      expect(takeMigrationResetFlag()).toBe(true);
      expect(result.game).toBeNull();
    }
  });

  it("marker-less v20 lifecycle evidence is current-version data missing its marker: rejected, not stamped", () => {
    const game = v20();
    delete game.gameSchemaVersion;
    expect(hasV20Evidence(game)).toBe(true);
    const copy = structuredClone(game);
    migrateGameEntry(copy, 19, { kind: "canonical-only" });
    expect("gameSchemaVersion" in copy).toBe(false);
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
  });

  it("a store labelled v20 whose game lacks the marker (genuine v19 shape) is incomplete current data and resets", () => {
    migrateStoreState({ game: v19Game(), undoStack: [] }, 20);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a malformed v20 lifecycle only inside an Undo snapshot rejects the whole store", () => {
    const bad = v20();
    (bad.players as Record<string, { effects: Raw[] }>).b!.effects[0]!.state = "paused";
    migrateStoreState({ game: v20(), undoStack: [bad] }, 20);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Remote checkpoint recovery through the real production chokepoint.
// ---------------------------------------------------------------------------
async function recoverFrom(game: Raw) {
  const b = new MemoryRoomBackend();
  await b.set(`${root}/checkpoint`, JSON.stringify({ game, roster: {} }));
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  const writer = new SessionWriter(b, code, session.id);
  disposals.push(() => writer.dispose());
  const recovered = await startStorytellerSession(b, lobby, writer);
  disposals.push(() => recovered.stop());
  return { recovered, backend: b };
}

describe("Phase 10B: remote checkpoint recovery", () => {
  it("a v19 (markerless) checkpoint recovers deterministically as v20 -- two independent recoveries agree", async () => {
    const first = await recoverFrom(v19Game());
    expect(first.recovered.outcome).toBe("live");
    const once = structuredClone(useStorytellerStore.getState().game!);
    expect(once).toEqual(expectedV20(v19Game()));
    for (const dispose of disposals.splice(0).reverse()) await dispose();
    useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    await recoverFrom(v19Game());
    expect(useStorytellerStore.getState().game).toEqual(once);
  });

  it("a v20 checkpoint recovers EXACTLY: nothing expires, no lifespan is recomputed, no source is reassigned, suppressed stays suppressed", async () => {
    const game = expectedV20(v19Game("night", 3));
    const effects = (game.players as Record<string, { effects: Raw[] }>).b!.effects;
    // An Effect expiring on entering Day 3 (the very next phase) and a
    // suppressed one: recovery must keep both exactly.
    effects.push({ id: "soon", type: "safeFromDemon", lifetime: { kind: "untilDawn" }, appliedAt: { phase: "night", day: 3 },
      state: "suppressed", expiry: { kind: "at", moment: { phase: "day", day: 3 } }, sourceParticipant: alice,
      parameters: { chosen: { kind: "participant", participants: [alice] } } });
    const { recovered } = await recoverFrom(game);
    expect(recovered.outcome).toBe("live");
    const restored = useStorytellerStore.getState().game!;
    expect(restored.players).toEqual(game.players);
    expect(restored.history).toEqual(game.history);
  });

  it.each([
    ["an Effect missing its lifecycle", (g: Raw) => { delete ((g.players as Record<string, { effects: Raw[] }>).b!.effects[0]!).state; }],
    ["a finite Effect claiming no expiry", (g: Raw) => { (g.players as Record<string, { effects: Raw[] }>).b!.effects[1]!.expiry = { kind: "none" }; }],
    ["a wrong version marker", (g: Raw) => { g.gameSchemaVersion = 19; }],
  ])("a malformed v20 checkpoint (%s) is rejected -- never adopted, never repaired", async (_label, corrupt) => {
    const bad = expectedV20(v19Game());
    corrupt(bad);
    await expect(recoverFrom(bad)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Privacy: Effects never reach public/self/Public Display.
// ---------------------------------------------------------------------------
describe("Phase 10B privacy: Effects are Storyteller-private", () => {
  it("public, self and the Firebase public/player projections carry no Effect data or metadata", async () => {
    const game = expectedV20(v19Game()) as unknown as StorytellerLobbyRecord;
    game.players.b!.effects.push({ id: "SENTINEL-EFFECT-ID", type: "SENTINEL-TYPE", lifetime: { kind: "manual" }, state: "suppressed",
      expiry: { kind: "none" }, parameters: { secret: { kind: "text", value: "SENTINEL-PARAM" } } });
    const registry = buildRegistry(troubleBrewing);
    const publicText = JSON.stringify(projectLobbyToPublic(game, {}));
    const selfText = JSON.stringify(projectLobbyToSelfMap(game, registry));
    const backend = new MemoryRoomBackend();
    await writeProjections({ backend, code, stState: game, registry, online: {} });
    const wirePublic = JSON.stringify(await backend.get(`${root}/public`));
    const wirePlayer = JSON.stringify(await backend.get(`${root}/player`));
    for (const text of [publicText, selfText, wirePublic, wirePlayer]) {
      for (const secret of ["effects", "SENTINEL", "poisoner", "expiry", "unresolved", "suppressed", "parameters", "fx-1", "manual:drunk", "gameSchemaVersion"]) {
        expect(text).not.toContain(secret);
      }
    }
    // The private checkpoint does carry it (Storyteller-only path).
    expect(await backend.get(`${root}/checkpoint`)).toContain("SENTINEL-PARAM");
  });
});
