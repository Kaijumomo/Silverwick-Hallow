// Phase 10E Astra remediation (PHASE10E.md 26): SOL-10E-A1, A2, A3, A5 and
// the Traveler -> Traveler alignment-perception amendment, reproducing the
// demonstrated ASTRA-10E-001/002/003/005 cases directly. (SOL-10E-A4, the
// gameplay disclosure cue, is UI state: see
// src/features/players/alignmentAstraRemediation.test.tsx.)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { usePlayerStore } from "./playerStore";
import { HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { migrateGameEntry } from "./gameMigration";
import { changeAlignmentIntent, correctAlignmentIntent, planAlignmentTransaction, type AlignmentIdSource } from "./alignmentResolution";
import { changeRoleIntent, correctRoleIntent, planRoleTransaction, setPerceptionIntent } from "./roleResolution";
import { identityNeedsCheck, projectLobbyToSelfMap, projectToSelf } from "./projections";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import { asV22 } from "@/test/v20Migration";
import { buildRegistry } from "@/data/roleRegistry";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { SessionWriter } from "@/firebase/writer";
import { startStorytellerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { SnapshotValidationError } from "@/firebase/snapshots";
import type { PlayerId, StorytellerLobbyRecord, STPlayerRecord } from "./types";

const code = "ASTR2345";
const root = `lobbies/${code}`;
const registry = buildRegistry(setupScript);
const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
type Raw = Record<string, unknown>;
type Players = Record<string, Raw>;
const disposals: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript } });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  localStorage.clear();
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

function seatSeven() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
}
function liveGame() {
  seatSeven();
  state().setRolePool(standardRoles(7));
  state().dealRolePool();
  for (const id of game().seatOrder) state().showAssignedRole(id);
  state().revealRoles();
  state().beginNightOne();
  store.setState({ undoStack: [] });
}
function liveTraveler(role = "thief") {
  liveGame();
  state().addPlayer("Zed");
  const zed = idOf("Zed");
  state().assignRole(zed, role);
  state().setTravelerAlignment(zed, "evil");
  store.setState({ undoStack: [] });
  return zed;
}
const asRaw = (): Raw => ({ ...JSON.parse(JSON.stringify(game())), code, storytellerUid: "host" });
type Baseline = { game: StorytellerLobbyRecord; undo: number; seq: number };
const baseline = (): Baseline => ({ game: game(), undo: state().undoStack.length, seq: state().localSeq });
function expectInert(b: Baseline) {
  expect(state().game).toBe(b.game);
  expect(state().undoStack).toHaveLength(b.undo);
  expect(state().localSeq).toBe(b.seq);
}
/** Ids that count every draw: a refusal "before ids" draws none. */
function countingIds() {
  const calls = { history: 0, epoch: 0 };
  const ids: AlignmentIdSource = { historyId: () => `h-${++calls.history}`, packetEpoch: () => `e-${++calls.epoch}` };
  return { ids, calls };
}

async function recoverFrom(entry: Raw) {
  const b = new MemoryRoomBackend();
  await b.set(`${root}/checkpoint`, JSON.stringify({ game: entry, roster: {} }));
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  store.getState().setLobby(lobby);
  const writer = new SessionWriter(b, code, session.id);
  disposals.push(() => writer.dispose());
  return { b, start: () => startStorytellerSession(b, lobby, writer) };
}
async function recoverRawString(text: string) {
  const b = new MemoryRoomBackend();
  await b.set(`${root}/checkpoint`, text);
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  store.getState().setLobby(lobby);
  const writer = new SessionWriter(b, code, session.id);
  disposals.push(() => writer.dispose());
  return () => startStorytellerSession(b, lobby, writer);
}

// ---------------------------------------------------------------------------
describe("SOL-10E-A1 (ASTRA-10E-001): setIsTraveler is Setup-only", () => {
  it("an ENDED snapshot whose Reveal never happened refuses before any mutation (no alignment deletion, no plan change, no Undo, no localSeq)", () => {
    seatSeven();
    const alice = idOf("Alice");
    expect(state().setActualAlignment(alice, "evil")).toMatchObject({ ok: true, changed: true });
    state().setPrivateText(alice, "draft");
    expect(state().setPhase("ended").ok).toBe(true);
    expect(game().setupRolesRevealed).not.toBe(true);
    const before = structuredClone(game());
    const b = baseline();
    for (const value of [true, false]) {
      const result = state().setIsTraveler(alice, value);
      expect(result.ok === false || value === false).toBe(true);
      expectInert(b);
    }
    expect(state().setIsTraveler(alice, true)).toMatchObject({ ok: false, message: expect.stringMatching(/only during Setup/) });
    expect(game()).toEqual(before);
    expect(player(alice)).toMatchObject({ actualAlignment: "evil", isTraveler: false, privateInfo: { extraText: "draft" } });
  });

  it("Night and Day refuse too; Setup before Reveal still designates", () => {
    liveGame();
    const chef = holder("chef");
    for (const phase of ["night", "day"] as const) {
      if (game().phase !== phase) state().advancePhase();
      const b = baseline();
      expect(state().setIsTraveler(chef, true)).toMatchObject({ ok: false });
      expectInert(b);
    }
    store.setState({ game: null });
    seatSeven();
    const alice = idOf("Alice");
    expect(state().setIsTraveler(alice, true)).toEqual({ ok: true });
    expect(player(alice).isTraveler).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10E-A2 (ASTRA-10E-002): Traveler self projection fails closed on an incompatible Shown Role", () => {
  const traveler = (over: Partial<STPlayerRecord> = {}) =>
    makeSTPlayer({ id: "t1", isTraveler: true, actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief", actualAlignment: "evil", shownAlignment: null, ...over });

  it("a Traveler shown an ordinary character (or another Traveler) is unsafe / Needs check and projects nothing -- never an ordinary derived alignment", () => {
    for (const p of [traveler({ shownRole: "chef" }), traveler({ shownRole: "imp", shownAlignment: "good" }), traveler({ shownRole: "beggar" }),
      traveler({ shownRole: "chef", shownAlignment: "undisclosed" })]) {
      expect(identityNeedsCheck(p, registry)).toBe(true);
      expect(projectToSelf(p, registry)).toBeNull();
    }
    // A non-Traveler carrying a Traveler Shown Role stays unsafe.
    const ordinary = makeSTPlayer({ id: "o1", actualRole: "chef", shownRole: "thief", actualAlignment: "good" });
    expect(identityNeedsCheck(ordinary, registry)).toBe(true);
    expect(projectToSelf(ordinary, registry)).toBeNull();
  });

  it("a valid Traveler keeps the v23 semantics: Normal -> Actual, explicit -> explicit, Not told -> character only", () => {
    expect(projectToSelf(traveler(), registry)).toEqual({ shownRole: "thief", shownAlignment: "evil" });
    expect(projectToSelf(traveler({ shownAlignment: "good" }), registry)).toEqual({ shownRole: "thief", shownAlignment: "good" });
    expect(projectToSelf(traveler({ shownAlignment: "undisclosed" }), registry)).toEqual({ shownRole: "thief" });
    expect(identityNeedsCheck(traveler(), registry)).toBe(false);
  });

  it.each([["native v23", (g: Raw) => g], ["v22 -> v23", (g: Raw) => asV22(g)]] as const)(
    "a recovered %s checkpoint with such a Traveler is adopted unrepaired and publishes no self identity for them", async (_label, build) => {
      const zed = liveTraveler();
      const raw = asRaw();
      (raw.players as Players)[zed]!.shownRole = "chef";
      (raw.players as Players)[zed]!.shownAlignment = "good";
      const entry = build(raw);
      expect(StorytellerGamePersistedSchema.safeParse(entry.gameSchemaVersion === 22 ? (() => { const c = structuredClone(entry); migrateGameEntry(c, 22, { kind: "canonical-only" }); return c; })() : entry).success).toBe(true);
      store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
      const { b, start } = await recoverFrom(entry);
      const recovered = await start();
      disposals.push(() => recovered.stop());
      expect(recovered.outcome).toBe("live");
      const p = player(zed);
      expect(p.shownRole).toBe("chef"); // never repaired / invented
      expect(identityNeedsCheck(p, registry)).toBe(true);
      expect(projectLobbyToSelfMap(game(), registry)[zed]).toBeUndefined();
      expect(await b.get(`${root}/player/${zed}`)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
describe("SOL-10E-A3 (ASTRA-10E-003): Live Play requires a valid live Game Moment", () => {
  it.each(["night", "day"] as const)("a persisted %s day-0 game is rejected (local Current State and Undo), never repaired", (phase) => {
    liveGame();
    const valid = asRaw();
    expect(StorytellerGamePersistedSchema.safeParse(valid).success).toBe(true);
    const bad = { ...structuredClone(valid), phase, day: 0 };
    const parsed = StorytellerGamePersistedSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.some((issue) => issue.path.join(".") === "day")).toBe(true);
    for (const state of [{ game: structuredClone(bad), undoStack: [] }, { game: structuredClone(valid), undoStack: [structuredClone(bad)] }]) {
      const result = migrateStoreState(state, 23) as { game: unknown };
      expect(takeMigrationResetFlag()).toBe(true);
      expect(result.game).toBeNull();
    }
    // Migration never rewrites day 0 into day 1 (marker 22 still only normalizes perception).
    const v22 = { ...asV22(bad), day: 0 };
    migrateGameEntry(v22, 22, { kind: "canonical-only" });
    expect(v22.day).toBe(0);
    expect(StorytellerGamePersistedSchema.safeParse(v22).success).toBe(false);
  });

  it("Setup day 0 and an ended pre-game snapshot remain valid; Night 1 / Day 1 are valid", () => {
    seatSeven();
    expect(StorytellerGamePersistedSchema.safeParse(asRaw()).success).toBe(true);
    state().setPhase("ended");
    expect(game().day).toBe(0);
    expect(StorytellerGamePersistedSchema.safeParse(asRaw()).success).toBe(true);
    store.setState({ game: null });
    liveGame();
    expect(StorytellerGamePersistedSchema.safeParse(asRaw()).success).toBe(true);
    state().advancePhase();
    expect(game()).toMatchObject({ phase: "day", day: 1 });
    expect(StorytellerGamePersistedSchema.safeParse(asRaw()).success).toBe(true);
  });

  it.each(["night", "day"] as const)("a remote %s day-0 checkpoint is rejected and never adopted", async (phase) => {
    liveGame();
    const bad = { ...asRaw(), phase, day: 0 };
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const { start } = await recoverFrom(bad);
    await expect(start()).rejects.toThrow(SnapshotValidationError);
    expect(state().game).toBeNull();
  });

  it("the Alignment planner refuses a directly constructed Night/Day day-0 snapshot before drawing any id", () => {
    liveTraveler();
    for (const phase of ["night", "day"] as const) {
      const invalid = { ...game(), phase, day: 0 };
      const zed = idOf("Zed");
      const { ids, calls } = countingIds();
      for (const intent of [changeAlignmentIntent(invalid.players[zed]!, "good"), correctAlignmentIntent(invalid.players[holder("chef")]!, "evil")]) {
        expect(planAlignmentTransaction(invalid, { intents: [intent] }, { ids })).toMatchObject({ ok: false, code: "phase" });
      }
      expect(calls).toEqual({ history: 0, epoch: 0 });
      // Through the store too: nothing commits.
      store.setState({ game: invalid });
      const b = baseline();
      expect(state().resolveAlignments({ intents: [changeAlignmentIntent(player(zed), "good")] })).toMatchObject({ ok: false, code: "phase" });
      expectInert(b);
    }
  });

  it("the Role planner refuses the same snapshot before drawing any id", () => {
    liveGame();
    for (const phase of ["night", "day"] as const) {
      const invalid = { ...game(), phase, day: 0 };
      const chef = invalid.players[holder("chef")]!;
      const { ids, calls } = countingIds();
      for (const intents of [[changeRoleIntent(chef, "imp")], [correctRoleIntent(chef, "monk")], [setPerceptionIntent(chef, { shownRole: "chef", shownAlignment: "evil" })]]) {
        expect(planRoleTransaction(invalid, { intents }, { script: setupScript, ids })).toMatchObject({ ok: false, code: "phase" });
      }
      expect(calls).toEqual({ history: 0, epoch: 0 });
    }
  });

  it("normal Night 1 / Day 1 mutation still commits with its History", () => {
    liveGame();
    expect(state().setActualAlignment(holder("chef"), "evil")).toMatchObject({ ok: true, changed: true });
    state().advancePhase();
    expect(state().assignRole(holder("monk") ?? holder("empath"), "saint")).toMatchObject({ ok: true, changed: true });
    expect(game().history.map((h) => [h.category, h.moment])).toEqual([["alignment", { phase: "night", day: 1 }], ["role", { phase: "day", day: 1 }]]);
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10E-A5 (ASTRA-10E-005): raw v23 Alignment History snapshots reject extra own keys", () => {
  const MARK = "PROTO_MARK";
  /** Serializes, then turns the MARK key into a literal own "__proto__" key
   * -- exactly what JSON.parse of stored/remote text produces. */
  const withOwnProto = (value: unknown): unknown => JSON.parse(JSON.stringify(value).split(`"${MARK}"`).join('"__proto__"'));
  const base = { id: "h", category: "alignment", participant: { kind: "legacy", playerId: "a" } };

  it("a raw own __proto__ (or any extra key) on from / to is rejected for correction and correlated records", () => {
    for (const meta of [{ correction: true }, { resolutionId: "r" }, { correction: true, resolutionId: "r" }]) {
      for (const change of [
        { kind: "value", from: { actualAlignment: "good", [MARK]: { polluted: true } }, to: { actualAlignment: "evil" } },
        { kind: "value", from: { [MARK]: 1 }, to: { actualAlignment: "evil" } },
        { kind: "value", from: { actualAlignment: "good" }, to: { actualAlignment: "evil", [MARK]: null } },
        { kind: "value", from: { actualAlignment: "good", extra: 1 }, to: { actualAlignment: "evil" } },
      ]) {
        const raw = withOwnProto({ ...base, ...meta, change }) as Raw;
        expect(HistoryRecordSchema.safeParse(raw).success).toBe(false);
      }
      expect(HistoryRecordSchema.safeParse({ ...base, ...meta, change: { kind: "value", from: {}, to: { actualAlignment: "good" } } }).success).toBe(true);
      expect(HistoryRecordSchema.safeParse({ ...base, ...meta, change: { kind: "value", from: { actualAlignment: "evil" }, to: { actualAlignment: "good" } } }).success).toBe(true);
    }
  });

  it("legacy Alignment History (no correction / resolutionId) keeps its loose contract, own __proto__ included", () => {
    const legacy = withOwnProto({ ...base, change: { kind: "value", from: { actualAlignment: "good", [MARK]: 1, legacyExtra: 2 }, to: { actualAlignment: "evil" } } });
    expect(HistoryRecordSchema.safeParse(legacy).success).toBe(true);
  });

  /** A current v23 game whose stored text carries one Alignment correction
   * with a raw own "__proto__" in its `from` snapshot. */
  function pollutedGameText(): string {
    liveGame();
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(player(holder("chef")), "evil")], resolutionId: "r1" })).toMatchObject({ ok: true });
    const raw = asRaw();
    const record = (raw.history as Raw[]).find((h) => h.category === "alignment")!;
    ((record.change as Raw).from as Raw)[MARK] = { polluted: true };
    return JSON.stringify(raw).split(`"${MARK}"`).join('"__proto__"');
  }

  it("local persistence: a stored v23 game with such a record resets instead of hydrating", async () => {
    const text = pollutedGameText();
    store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", `{"version":23,"state":{"game":${text},"undoStack":[]}}`);
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull();
  });

  it("remote checkpoint: such a record is rejected and never adopted", async () => {
    const text = pollutedGameText();
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const start = await recoverRawString(`{"game":${text},"roster":{}}`);
    await expect(start()).rejects.toThrow(SnapshotValidationError);
    expect(state().game).toBeNull();
  });

  it("valid v23 and legacy Alignment History still round-trip through local persistence", async () => {
    liveGame();
    state().resolveAlignments({ intents: [correctAlignmentIntent(player(holder("chef")), "evil")], resolutionId: "r1" });
    state().setActualAlignment(holder("imp"), "good");
    const legacy = { id: "legacy-a", category: "alignment" as const, participant: { kind: "legacy" as const, playerId: "a" },
      change: { kind: "value" as const, from: { actualAlignment: "good", legacyExtra: 1 }, to: { actualAlignment: "evil" } } };
    store.setState({ game: { ...game(), history: [...game().history, legacy] } });
    const snapshot = JSON.parse(JSON.stringify(game()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", saved);
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(JSON.parse(JSON.stringify(game()))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
describe("PHASE10E.md 26 semantic question 1: Traveler -> Traveler Role changes preserve alignment perception", () => {
  function seedTraveler(shownAlignment: STPlayerRecord["shownAlignment"]) {
    const zed = liveTraveler("thief");
    if (shownAlignment !== null) expect(state().setShownAlignment(zed, shownAlignment)).toMatchObject({ ok: true });
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed),
      privateInfo: { extraText: "draft" }, publishedPacket: { id: "k", payload: { shownRole: "thief" } }, packetEpoch: "epoch-before" } } } });
    return zed;
  }
  const expectInvalidated = (zed: PlayerId) => {
    const p = player(zed);
    expect(p.publishedPacket).toBeUndefined();
    expect(p.privateInfo).toBeUndefined();
    expect(p.packetEpoch).not.toBe("epoch-before");
  };

  it("gameplay change with Normal: stays Normal and follows Actual for the new character", () => {
    const zed = seedTraveler(null);
    expect(state().assignRole(zed, "scapegoat")).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ actualRole: "scapegoat", shownRole: "scapegoat", publicDisplayRole: "scapegoat", shownAlignment: null });
    expectInvalidated(zed);
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "scapegoat", shownAlignment: "evil" });
  });

  it("gameplay change with explicit Good: Good is preserved", () => {
    const zed = seedTraveler("good");
    expect(state().resolveRoles({ intents: [changeRoleIntent(player(zed), "gunslinger")] })).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", shownRole: "gunslinger", shownAlignment: "good" });
    expectInvalidated(zed);
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "gunslinger", shownAlignment: "good" });
  });

  it("correction with explicit Evil: Evil is preserved", () => {
    const zed = seedTraveler("evil");
    state().setTravelerAlignment(zed, "good");
    expect(state().correctRole(zed, "beggar")).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ actualRole: "beggar", shownRole: "beggar", publicDisplayRole: "beggar", shownAlignment: "evil", actualAlignment: "good" });
    expectInvalidated(zed);
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "beggar", shownAlignment: "evil" });
  });

  it("correction with Not told (restart policy too): stays withheld", () => {
    const zed = seedTraveler("undisclosed");
    expect(state().correctRole(zed, "bureaucrat", { travelerArrivalPolicy: "restart" })).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ actualRole: "bureaucrat", shownRole: "bureaucrat", shownAlignment: "undisclosed" });
    expectInvalidated(zed);
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "bureaucrat" });
  });

  it("ordinary -> Traveler starts at Normal unless the same resolution sets a perception; Traveler -> ordinary still needs an ordinary perception", () => {
    liveGame();
    const chef = holder("chef");
    state().setShownAlignment(chef, "evil");
    expect(state().resolveRoles({ intents: [changeRoleIntent(player(chef), "thief")] })).toMatchObject({ ok: true, changed: true });
    expect(player(chef)).toMatchObject({ isTraveler: true, shownRole: "thief", shownAlignment: null });
    const imp = holder("imp");
    const before = player(imp);
    expect(state().resolveRoles({ intents: [
      changeRoleIntent(before, "thief"),
      { kind: "setPerception", target: { playerId: imp, participantId: before.participantId! }, expectedShownRole: "thief", expectedShownAlignment: null,
        shownRole: "thief", shownAlignment: "good" },
    ] })).toMatchObject({ ok: true, changed: true });
    expect(player(imp)).toMatchObject({ isTraveler: true, shownAlignment: "good" });
    // Traveler -> ordinary without an explicit ordinary perception is refused.
    expect(state().resolveRoles({ intents: [changeRoleIntent(player(chef), "chef")] })).toMatchObject({ ok: false, code: "perception" });
  });
});
