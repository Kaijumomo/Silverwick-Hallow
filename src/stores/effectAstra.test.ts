// Phase 10B Astra targeted remediation: ASTRA-10B-001 .. 004 (all MEDIUM).
// Every original Astra reproduction is included verbatim in spirit and must
// fail before the fix and pass after it.
import { beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import type { EffectIntent, EffectParticipantBinding, EffectTransaction } from "./effectResolution";
import { StorytellerGamePersistedSchema, StorytellerStateSchema } from "./schemas";
import { participantRefOf } from "./participants";
import { writeProjections } from "@/firebase/sync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { buildRegistry } from "@/data/roleRegistry";
import type { EffectRecord, PlayerId, StorytellerLobbyRecord } from "./types";

const STORAGE_KEY = "new-blood-st";
const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const bind = (id: PlayerId): EffectParticipantBinding => ({ playerId: id, participantId: player(id).participantId! });
const effectHistory = () => game().history.filter((h) => h.category === "effect");
const resolve = (...intents: EffectIntent[]) => state().resolveEffects({ intents });
const apply = (name: string, effect: Extract<EffectIntent, { kind: "apply" }>["effect"]): EffectIntent =>
  ({ kind: "apply", target: bind(idOf(name)), effect });
const persisted = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const withEffectsOn = (g: StorytellerLobbyRecord, playerId: PlayerId, effects: EffectRecord[]): StorytellerLobbyRecord =>
  ({ ...g, players: { ...g.players, [playerId]: { ...g.players[playerId]!, effects } } });

type Baseline = { game: StorytellerLobbyRecord; undo: number; seq: number };
const baseline = (): Baseline => ({ game: game(), undo: state().undoStack.length, seq: state().localSeq });
function expectInert(b: Baseline) {
  expect(state().game).toBe(b.game);
  expect(state().undoStack).toHaveLength(b.undo);
  expect(state().localSeq).toBe(b.seq);
}

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
  takeMigrationResetFlag();
});

function liveGame() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}

/** The authoritative game must satisfy every persistence gate: the game
 * schema, the whole Storyteller state schema, the private checkpoint, and a
 * real local hydration that does not reset. */
async function expectPersistable() {
  expect(StorytellerGamePersistedSchema.safeParse(persisted(game())).success).toBe(true);
  const whole = { game: game(), undoStack: state().undoStack, localSeq: state().localSeq, sync: state().sync };
  expect(StorytellerStateSchema.safeParse(persisted(whole)).success).toBe(true);
  const backend = new MemoryRoomBackend();
  await writeProjections({ backend, code: "ASTR1234", stState: { ...game(), code: "ASTR1234" }, registry: buildRegistry(setupScript), online: {} });
  const checkpoint = JSON.parse(await backend.get("lobbies/ASTR1234/checkpoint") as string) as { game: unknown };
  expect(StorytellerGamePersistedSchema.safeParse(checkpoint.game).success).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const saved = localStorage.getItem(STORAGE_KEY)!;
  const before = persisted(game());
  store.setState({ game: null, undoStack: [] });
  localStorage.setItem(STORAGE_KEY, saved);
  await store.persist.rehydrate();
  expect(takeMigrationResetFlag()).toBe(false);
  expect(persisted(game())).toEqual(before);
}

// ---------------------------------------------------------------------------
describe("ASTRA-10B-001: Effect Mutation Context is runtime-validated", () => {
  const applyWith = (context: unknown): ReturnType<typeof resolve> => state().resolveEffects({
    context, intents: [apply("Carol", { type: "poisoned", lifetime: { kind: "untilDawn" } })],
  } as unknown as EffectTransaction);

  it("Astra reproduction: { provenance: { reason: 7 } } is refused as invalid -- nothing committed, the game stays loadable", async () => {
    liveGame();
    const b = baseline();
    const historyBefore = game().history.length;
    expect(applyWith({ provenance: { reason: 7 } })).toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
    expect(game().history).toHaveLength(historyBefore);
    expect(player(idOf("Carol")).effects).toEqual([]);
    await expectPersistable();
  });

  it.each([
    ["a numeric note", { provenance: { note: 3 } }],
    ["a non-string sourceCharacter", { provenance: { sourceCharacter: { id: "poisoner" } } }],
    ["an empty sourceCharacter", { provenance: { sourceCharacter: "" } }],
    ["a numeric sourcePlayer", { provenance: { sourcePlayer: 12 } }],
    ["an empty sourcePlayer", { provenance: { sourcePlayer: "" } }],
    ["a provenance array", { provenance: ["reason"] }],
    ["a provenance string", { provenance: "because" }],
    ["a null provenance", { provenance: null }],
    ["an unknown provenance field", { provenance: { reason: "x", extra: true } }],
    ["a smuggled durable sourceParticipant", { provenance: { sourceParticipant: { kind: "participant", participantId: "pt-x", playerId: "x", nameAtTime: "X" } } }],
    ["a Mutation Context that is an array", []],
    ["a Mutation Context that is a string", "context"],
    ["a null Mutation Context", null],
    ["an unknown Mutation Context field", { provenance: { reason: "x" }, options: {} }],
  ])("%s is refused as invalid, atomically", (_label, context) => {
    liveGame();
    const b = baseline();
    expect(applyWith(context)).toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
  });

  it("a live sourcePlayer that names no current participant keeps its existing refusal semantics", () => {
    liveGame();
    const alice = idOf("Alice");
    state().unseatPlayer(alice);
    store.setState({ undoStack: [] });
    const b = baseline();
    expect(applyWith({ provenance: { sourcePlayer: alice } })).toMatchObject({ ok: false, code: "notSeated" });
    expectInert(b);
  });

  it.each([
    ["reason only", { reason: "Poisoner ability" }, () => ({ reason: "Poisoner ability" })],
    ["sourceCharacter", { sourceCharacter: "poisoner" }, () => ({ sourceCharacter: "poisoner" })],
    ["a live sourcePlayer -> durable sourceParticipant", { sourcePlayer: "@Bob" },
      () => ({ sourceParticipant: participantRefOf(game(), idOf("Bob")) })],
    ["combined fields (explicit undefined dropped)", { sourcePlayer: "@Bob", sourceCharacter: "poisoner", reason: "r", note: "n", ...({ extraUndefined: undefined } as object) },
      () => ({ sourceParticipant: participantRefOf(game(), idOf("Bob")), sourceCharacter: "poisoner", reason: "r", note: "n" })],
  ])("valid provenance (%s) is recorded and the game passes every persistence gate", async (_label, provenance, expected) => {
    liveGame();
    const input = Object.fromEntries(Object.entries(provenance).map(([k, v]) => [k, v === "@Bob" ? idOf("Bob") : v]));
    const r = applyWith({ provenance: input });
    expect(r.ok).toBe(true);
    expect(effectHistory().at(-1)!.provenance).toEqual(expected());
    await expectPersistable();
  });
});

// ---------------------------------------------------------------------------
describe("ASTRA-10B-002: v20 evidence blocks every legacy migration step for that entry", () => {
  /** A genuine current v20 game, then deliberately missing a v19-required field. */
  function v20WithoutWindow(): Record<string, unknown> {
    liveGame();
    resolve(apply("Carol", { type: "poisoned", lifetime: { kind: "untilDawn" } }));
    const g = persisted(game()) as unknown as Record<string, unknown>;
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(true);
    delete g.lifeEventWindow;
    return g;
  }
  async function rehydrateEnvelope(version: number, gameEntry: unknown, undoStack: unknown[] = []) {
    store.setState({ game: null, undoStack: [] });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version, state: { game: gameEntry, undoStack } }));
    await store.persist.rehydrate();
  }

  it("Astra reproduction: an outer v18 envelope around a v20 game missing lifeEventWindow is rejected (reset), never repaired", async () => {
    const g = v20WithoutWindow();
    await rehydrateEnvelope(18, g);
    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull();
  });

  it.each([17, 16, 13])("the same holds under an older outer envelope (v%d)", async (version) => {
    const g = v20WithoutWindow();
    await rehydrateEnvelope(version, g);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a v20-evidenced Undo entry is judged independently: never repaired, the whole store resets", async () => {
    const bad = v20WithoutWindow();
    const good = persisted(game());
    await rehydrateEnvelope(18, good, [bad]);
    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull();
  });

  it("an outer v17 envelope never renames a stale v17 History category inside a v20 game", () => {
    liveGame();
    // Always a real change (the random Deal may already have made Alice
    // evil, which would make this a no-op with no History to corrupt).
    const alice = idOf("Alice");
    state().setActualAlignment(alice, game().players[alice]!.actualAlignment === "evil" ? "good" : "evil");
    const g = persisted(game()) as unknown as { history: { category: string }[] };
    g.history[g.history.length - 1]!.category = "identity";
    const result = migrateStoreState({ game: g, undoStack: [] }, 17) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it("markerless v20 lifecycle evidence also blocks earlier steps and goes straight to the current schema", () => {
    const g = v20WithoutWindow();
    delete g.gameSchemaVersion;
    const result = migrateStoreState({ game: g, undoStack: [] }, 18) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it.each([21, "20", null])("an explicit wrong/malformed gameSchemaVersion (%j) is still v20 evidence: no legacy repair, rejected", (marker) => {
    const g = v20WithoutWindow();
    g.gameSchemaVersion = marker;
    migrateStoreState({ game: g, undoStack: [] }, 18);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("control: a genuine markerless v19 store still migrates to a valid v20 game (and v18 to v19 to v20)", async () => {
    liveGame();
    const v19 = persisted(game()) as unknown as Record<string, unknown>;
    delete v19.gameSchemaVersion;
    delete v19.gameRuleFacts; // Phase 10G: v25-only
    await rehydrateEnvelope(19, v19);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(state().game!.gameSchemaVersion).toBe(25);
    const v18 = { ...v19 };
    delete v18.lifeEventWindow;
    await rehydrateEnvelope(18, v18);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(state().game!.lifeEventWindow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("ASTRA-10B-003: an unresolved end can only be resolved by a correction", () => {
  function withLegacy() {
    liveGame();
    const carol = idOf("Carol");
    const legacy: EffectRecord = { id: "l", type: "poisoned", lifetime: { kind: "untilDawn" }, state: "active", expiry: { kind: "unresolved" } };
    store.setState({ game: withEffectsOn(game(), carol, [legacy]), undoStack: [] });
    return bind(carol);
  }

  it.each([
    ["none", { kind: "none" }],
    ["a future exact end", { kind: "at", moment: { phase: "night", day: 3 } }],
  ] as const)("ordinary Update to %s is refused -- no change, History, Undo or localSeq", (_label, expiry) => {
    const target = withLegacy();
    const b = baseline();
    const historyBefore = game().history.length;
    const r = resolve({ kind: "update", target, effectId: "l", changes: { expiry } });
    expect(r).toMatchObject({ ok: false, code: "immutable" });
    expect(!r.ok && r.message).toMatch(/correction/);
    expectInert(b);
    expect(game().history).toHaveLength(historyBefore);
  });

  it("ordinary Update of note or parameters on an unresolved Effect is still accepted (and leaves it unresolved)", () => {
    const target = withLegacy();
    expect(resolve({ kind: "update", target, effectId: "l", changes: { note: "checked" } }).ok).toBe(true);
    expect(resolve({ kind: "update", target, effectId: "l", changes: { parameters: { n: { kind: "number", value: 1 } } } }).ok).toBe(true);
    expect(player(idOf("Carol")).effects[0]).toMatchObject({ note: "checked", parameters: { n: { kind: "number", value: 1 } }, expiry: { kind: "unresolved" } });
    expect(effectHistory().slice(-2).every((h) => h.effectOperation === "update" && h.correction === undefined)).toBe(true);
  });

  it.each([
    ["none", { kind: "none" }],
    ["a future exact end", { kind: "at", moment: { phase: "night", day: 3 } }],
  ] as const)("correctAmend to %s resolves it, with correction History", (_label, expiry) => {
    const target = withLegacy();
    expect(state().resolveEffects({ intents: [{ kind: "correctAmend", target, effectId: "l", amendment: { expiry } }] }).ok).toBe(true);
    expect(player(idOf("Carol")).effects[0]!.expiry).toEqual(expiry);
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "update", correction: true,
      change: { kind: "value", from: { expiry: { kind: "unresolved" } }, to: { expiry } } });
  });
});

// ---------------------------------------------------------------------------
describe("ASTRA-10B-004: applied-creation results are participant-scoped", () => {
  const marked = (id: string): EffectRecord => ({ id, type: "marked", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } });

  it("Astra reproduction: apply x to A, remove x from A, suppress B's existing x -> effectIds [] and History only for B", () => {
    liveGame();
    const a = idOf("Alice");
    const b = idOf("Bob");
    store.setState({ game: withEffectsOn(game(), b, [marked("x")]), undoStack: [] });
    const historyBefore = effectHistory().length;
    const r = resolve(
      { kind: "apply", target: bind(a), effect: { id: "x", type: "marked", lifetime: { kind: "manual" } } },
      { kind: "remove", target: bind(a), effectId: "x" },
      { kind: "suppress", target: bind(b), effectId: "x" },
    );
    expect(r).toEqual({ ok: true, changed: true, effectIds: [] });
    expect(player(a).effects).toEqual([]);
    expect(player(b).effects).toEqual([{ ...marked("x"), state: "suppressed" }]);
    const added = effectHistory().slice(historyBefore);
    expect(added.map((h) => [h.effectOperation, h.participant])).toEqual([["suppress", participantRefOf(game(), b)]]);
  });

  it("the same id created on two participants is reported once per participant, in intent order (ids are participant-local)", () => {
    liveGame();
    const r = resolve(apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" } }), apply("Bob", { id: "x", type: "marked", lifetime: { kind: "manual" } }));
    expect(r).toEqual({ ok: true, changed: true, effectIds: ["x", "x"] });
    expect(player(idOf("Alice")).effects.map((e) => e.id)).toEqual(["x"]);
    expect(player(idOf("Bob")).effects.map((e) => e.id)).toEqual(["x"]);
  });

  it("cancel on A, create on B with the same id: only B's creation survives -- one 'x'", () => {
    liveGame();
    const r = resolve(
      apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" } }),
      { kind: "remove", target: bind(idOf("Alice")), effectId: "x" },
      apply("Bob", { id: "x", type: "marked", lifetime: { kind: "manual" } }),
    );
    expect(r).toEqual({ ok: true, changed: true, effectIds: ["x"] });
    expect(player(idOf("Alice")).effects).toEqual([]);
    expect(player(idOf("Bob")).effects.map((e) => e.id)).toEqual(["x"]);
  });

  it("apply / remove / re-apply on one participant reports the surviving creation once, at its surviving position", () => {
    liveGame();
    const r = resolve(
      apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" } }),
      apply("Bob", { id: "y", type: "marked", lifetime: { kind: "manual" } }),
      { kind: "remove", target: bind(idOf("Alice")), effectId: "x" },
      apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" } }),
    );
    expect(r).toEqual({ ok: true, changed: true, effectIds: ["y", "x"] });
    expect(player(idOf("Alice")).effects.map((e) => e.id)).toEqual(["x"]);
    expect(effectHistory().map((h) => h.effectOperation)).toEqual(["apply", "apply", "remove", "apply"]);
  });

  it("net-zero apply/remove: no applied id, and R9 no-op semantics are intact", () => {
    liveGame();
    const b = baseline();
    expect(resolve(apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" } }), { kind: "remove", target: bind(idOf("Alice")), effectId: "x" }))
      .toEqual({ ok: true, changed: false, effectIds: [] });
    expectInert(b);
  });
});
