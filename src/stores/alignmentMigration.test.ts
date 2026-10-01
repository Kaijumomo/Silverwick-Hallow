// Phase 10E: store / game schema v23 -- the v22 -> v23 Traveler perception
// normalization, v23 evidence ordering, legacy Alignment History preservation,
// and the same per-entry routing for Current State, every Undo snapshot and
// remote checkpoint recovery (no Alignment-specific recovery path).
// Traceability: 10E-AC-26..32 and 10E-AC-35.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { usePlayerStore } from "./playerStore";
import { GAME_SCHEMA_VERSION, HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { detectLegacyGameVersion, hasV19LifeEvidence, hasV20Evidence, hasV23Evidence, migrateGameEntry } from "./gameMigration";
import { correctAlignmentIntent, changeAlignmentIntent } from "./alignmentResolution";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { asV20, asV21, asV22, withV22Roles, withV21Reminders, withV23Alignment } from "@/test/v20Migration";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { SessionWriter } from "@/firebase/writer";
import { startStorytellerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { SnapshotValidationError } from "@/firebase/snapshots";

const code = "ALGN2345";
const root = `lobbies/${code}`;
const state = () => store.getState();
const game = () => state().game!;
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

/** A live current (v23) game: two Travelers (Thief evil, Beggar good), an
 * ordinary participant with an explicit Shown Alignment, legacy-shaped and
 * v23-shaped Alignment History, Information Delivery and arrival progress. */
function currentGame(): Raw {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  state().dealRolePool();
  for (const id of game().seatOrder) state().showAssignedRole(id);
  state().revealRoles();
  state().beginNightOne();
  for (const [name, role] of [["Zed", "thief"], ["Yan", "beggar"]] as const) {
    state().addPlayer(name);
    const id = game().seatOrder.at(-1)!;
    state().assignRole(id, role);
  }
  const [zed, yan] = game().seatOrder.slice(-2) as [string, string];
  const chef = game().seatOrder.find((id) => game().players[id]!.actualRole === "chef")!;
  expect(state().setTravelerAlignment(zed, "evil")).toMatchObject({ ok: true }); // a plain (legacy-shaped) Alignment record
  expect(state().setTravelerAlignment(yan, "good")).toMatchObject({ ok: true });
  expect(state().resolveAlignments({ intents: [correctAlignmentIntent(game().players[chef]!, "evil")] })).toMatchObject({ ok: true }); // v23: correction
  expect(state().resolveAlignments({ intents: [changeAlignmentIntent(game().players[yan]!, "evil")], resolutionId: "res-1" })).toMatchObject({ ok: true }); // v23: resolutionId
  expect(state().setShownAlignment(chef, "evil")).toMatchObject({ ok: true }); // ordinary explicit perception
  return { ...JSON.parse(JSON.stringify(game())), code, storytellerUid: "host" };
}
const travelerIds = (g: Raw) => Object.values(g.players as Players).filter((p) => p.isTraveler === true).map((p) => p.id as string);
/** A v22 entry as a v22 writer stored it, with inert Traveler Good/Evil leftovers. */
function v22WithLeftovers(): Raw {
  const g = asV22(currentGame());
  const [zed, yan] = travelerIds(g) as [string, string];
  (g.players as Players)[zed]!.shownAlignment = "good"; // stale: Actual is evil
  (g.players as Players)[yan]!.shownAlignment = "evil"; // a copy of Actual
  return g;
}

describe("10E-AC-27 / AC-28: v22 -> v23 Traveler normalization", () => {
  it("a v22 Traveler's stored Good/Evil becomes Normal (null); nothing else changes", () => {
    const v22 = v22WithLeftovers();
    const copy = structuredClone(v22);
    migrateGameEntry(copy, 22, { kind: "canonical-only" });
    const [zed, yan] = travelerIds(v22) as [string, string];
    const players = copy.players as Players;
    expect(players[zed]!.shownAlignment).toBeNull();
    expect(players[yan]!.shownAlignment).toBeNull();
    // Only that field and the marker: Actual Alignment, Role, arrival, History,
    // Information Delivery, Effects, Reminders -- byte-identical.
    const expected = structuredClone(v22);
    (expected.players as Players)[zed]!.shownAlignment = null;
    (expected.players as Players)[yan]!.shownAlignment = null;
    expected.gameSchemaVersion = 23;
    expect(copy).toEqual(expected);
    expect(copy).toEqual(withV23Alignment(v22));
    expect(players[zed]!.actualAlignment).toBe("evil");
    expect(JSON.stringify(copy.history)).toBe(JSON.stringify(v22.history));
    expect(JSON.stringify(copy.informationDeliveries)).toBe(JSON.stringify(v22.informationDeliveries));
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(true);
  });

  it("never copies Actual Alignment into shownAlignment, never touches ordinary perception, never invents undisclosed", () => {
    const v22 = v22WithLeftovers();
    const chef = Object.values(v22.players as Players).find((p) => p.actualRole === "chef")!;
    expect(chef.shownAlignment).toBe("evil");
    const copy = structuredClone(v22);
    migrateGameEntry(copy, 22, { kind: "canonical-only" });
    const after = copy.players as Players;
    expect(after[chef.id as string]!.shownAlignment).toBe("evil"); // ordinary explicit value untouched
    for (const p of Object.values(after)) {
      expect(p.shownAlignment).not.toBe("undisclosed");
      if (p.isTraveler === true) expect(p.shownAlignment).toBeNull(); // never the Actual value
    }
    // A Traveler already at Normal stays at Normal (not filled from Actual).
    const normal = asV22(currentGame());
    const before = structuredClone(normal);
    migrateGameEntry(normal, 22, { kind: "canonical-only" });
    expect(normal).toEqual({ ...before, gameSchemaVersion: 23 });
  });

  it("fail-closed: a v22 entry with a non-object player record is left unstamped and rejected", () => {
    const v22 = v22WithLeftovers();
    (v22.players as Raw).bad = "not a player";
    const copy = structuredClone(v22);
    migrateGameEntry(copy, 22, { kind: "canonical-only" });
    expect(copy).toEqual(v22);
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
  });
});

describe("10E-AC-26: legacy Alignment History is preserved, never rewritten", () => {
  it("pre-v23 Alignment History survives migration byte-for-byte and keeps its looser contract", () => {
    const v22 = asV22(currentGame());
    const legacyRecord = { id: "legacy-a", category: "alignment", participant: { kind: "legacy", playerId: "a" },
      change: { kind: "value", from: { actualAlignment: "good", legacyExtra: 1 }, to: { actualAlignment: "evil", note: "old" } } };
    (v22.history as Raw[]).push(legacyRecord);
    const before = JSON.stringify(v22.history);
    const result = migrateStoreState({ game: structuredClone(v22), undoStack: [structuredClone(v22)] }, 22) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(JSON.stringify(result.game.history)).toBe(before);
    expect(JSON.stringify(result.undoStack[0]!.history)).toBe(before);
    expect(HistoryRecordSchema.safeParse(legacyRecord).success).toBe(true);
    // The same loose shape carrying v23-only metadata is rejected.
    expect(HistoryRecordSchema.safeParse({ ...legacyRecord, correction: true }).success).toBe(false);
  });
});

describe("10E-AC-29: per-entry migration for Current State, every Undo entry and remote recovery", () => {
  it("local Current State and EACH Undo snapshot migrate independently through migrateGameEntry", () => {
    const current = currentGame();
    const v22 = v22WithLeftovers();
    const v21 = asV21(current);
    const v20 = asV20(current);
    const result = migrateStoreState({ game: structuredClone(v22), undoStack: [structuredClone(current), structuredClone(v21), structuredClone(v20), structuredClone(v22)] }, 20) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(withV23Alignment(v22));
    expect(result.undoStack[0]).toEqual(current); // marker 23: untouched
    expect(result.undoStack[1]).toEqual(withV23Alignment(withV22Roles(v21)));
    expect(result.undoStack[2]).toEqual(withV23Alignment(withV22Roles(withV21Reminders(v20))));
    expect(result.undoStack[3]).toEqual(result.game);
    for (const entry of [result.game, ...result.undoStack]) expect(StorytellerGamePersistedSchema.safeParse(entry).success).toBe(true);
  });

  it("a genuine v22 localStorage blob rehydrates as v23 and is written back as v23", async () => {
    localStorage.setItem("new-blood-st", JSON.stringify({ version: 22, state: { game: v22WithLeftovers(), undoStack: [v22WithLeftovers()] } }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(game().gameSchemaVersion).toBe(23);
    for (const id of travelerIds(game() as unknown as Raw)) expect(game().players[id]!.shownAlignment).toBeNull();
    expect(state().undoStack[0]!.gameSchemaVersion).toBe(23);
    state().setNotes(game().seatOrder[0]!, "x");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(localStorage.getItem("new-blood-st")!).version).toBe(23);
  });

  async function recoverFrom(entry: Raw) {
    const b = new MemoryRoomBackend();
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: entry, roster: {} }));
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.getState().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    return { start: () => startStorytellerSession(b, lobby, writer) };
  }

  it("a v22 remote checkpoint recovers to the SAME v23 result local migration reaches (two independent recoveries agree)", async () => {
    const entry = v22WithLeftovers();
    const local = migrateStoreState({ game: structuredClone(entry), undoStack: [] }, 22) as { game: Raw };
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const first = await recoverFrom(structuredClone(entry));
    const recovered = await first.start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    const once = structuredClone(game());
    expect(once).toEqual(withV23Alignment(entry));
    expect(JSON.parse(JSON.stringify(once))).toEqual(JSON.parse(JSON.stringify(local.game)));
    for (const dispose of disposals.splice(0).reverse()) await dispose();
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const second = await recoverFrom(structuredClone(entry));
    const again = await second.start();
    disposals.push(() => again.stop());
    expect(game()).toEqual(once);
  });

  it("10E-AC-35: a v23 checkpoint (undisclosed perception, correction / correlated Alignment History) recovers unchanged through the existing path", async () => {
    const entry = currentGame();
    const [zed] = travelerIds(entry) as [string];
    (entry.players as Players)[zed]!.shownAlignment = "undisclosed";
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const { start } = await recoverFrom(structuredClone(entry));
    const recovered = await start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(JSON.parse(JSON.stringify(game()))).toEqual(entry);
  });

  it("10E-AC-35: a checkpoint with a malformed v23 Alignment record, or marker 22 carrying v23 evidence, is rejected and never adopted", async () => {
    for (const corrupt of [
      (g: Raw) => { (g.history as Raw[]).push({ id: "bad", category: "alignment", participant: { kind: "legacy", playerId: "a" }, correction: true,
        change: { kind: "value", from: { actualAlignment: "good", shownAlignment: "evil" }, to: { actualAlignment: "evil" } } }); },
      (g: Raw) => { g.gameSchemaVersion = 22; },
    ]) {
      const entry = currentGame();
      corrupt(entry);
      store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
      const { start } = await recoverFrom(entry);
      await expect(start()).rejects.toThrow(SnapshotValidationError);
      expect(state().game).toBeNull();
      for (const dispose of disposals.splice(0).reverse()) await dispose();
    }
  });
});

describe("10E-AC-30 / AC-31: v23 evidence runs first and fails closed", () => {
  const evidence: [string, (g: Raw) => void][] = [
    ["a persisted undisclosed perception", (g) => { (g.players as Players)[travelerIds(g)[0]!]!.shownAlignment = "undisclosed"; }],
    ["an Alignment correction", (g) => { (g.history as Raw[]).push({ id: "hx", category: "alignment", participant: { kind: "legacy", playerId: "a" }, correction: true,
      change: { kind: "value", from: {}, to: { actualAlignment: "good" } } }); }],
    ["an Alignment resolutionId", (g) => { (g.history as Raw[]).push({ id: "hx", category: "alignment", participant: { kind: "legacy", playerId: "a" }, resolutionId: "r",
      change: { kind: "value", from: {}, to: { actualAlignment: "good" } } }); }],
  ];

  it.each(evidence)("%s is v23 evidence, detected ahead of any older generic heuristic", (_label, inject) => {
    const g = asV22(currentGame());
    delete g.gameSchemaVersion;
    inject(g);
    expect(hasV23Evidence(g)).toBe(true);
    expect(detectLegacyGameVersion(g)).toBe(GAME_SCHEMA_VERSION);
  });

  it.each(evidence)("marker-less %s is rejected unrepaired -- no legacy step runs, never stamped", (_label, inject) => {
    // The trap: `correction` is also v19 Life evidence and `resolutionId` v20
    // evidence; a naive older heuristic would run legacy steps over it.
    const g = asV20(currentGame());
    delete g.gameSchemaVersion;
    for (const p of Object.values(g.players as Record<string, { effects?: Raw[] }>)) for (const e of p.effects ?? []) { delete e.state; delete e.expiry; }
    delete g.lifeEventWindow;
    inject(g);
    if ((g.history as Raw[]).some((h) => h.category === "alignment" && "correction" in h)) expect(hasV19LifeEvidence(g)).toBe(true);
    if ((g.history as Raw[]).some((h) => h.category === "alignment" && "resolutionId" in h)) expect(hasV20Evidence(g)).toBe(true);
    const copy = structuredClone(g);
    migrateGameEntry(copy, 18, { kind: "canonical-only" });
    expect(copy).toEqual(g);
    expect("gameSchemaVersion" in copy).toBe(false);
    migrateStoreState({ game: structuredClone(g), undoStack: [] }, 18);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it.each([20, 21, 22] as const)("an OLDER marker (%s) carrying v23 evidence is rejected unrepaired -- locally, in an Undo entry, and never stamped", (marker) => {
    const build = marker === 22 ? asV22 : marker === 21 ? asV21 : asV20;
    for (const [, inject] of evidence) {
      const g = build(currentGame());
      inject(g);
      expect(g.gameSchemaVersion).toBe(marker);
      const copy = structuredClone(g);
      migrateGameEntry(copy, marker, { kind: "canonical-only" });
      expect(copy).toEqual(g);
      expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
      const result = migrateStoreState({ game: structuredClone(g), undoStack: [] }, marker) as { game: unknown };
      expect(takeMigrationResetFlag()).toBe(true);
      expect(result.game).toBeNull();
      migrateStoreState({ game: build(currentGame()), undoStack: [structuredClone(g)] }, marker);
      expect(takeMigrationResetFlag()).toBe(true);
    }
  });

  it("10E-AC-31: a legitimate v22 Traveler with stored Good/Evil is NOT v23 evidence and migrates rather than being rejected", () => {
    const g = v22WithLeftovers();
    expect(hasV23Evidence(g)).toBe(false);
    expect(detectLegacyGameVersion(g)).toBe(22);
    const result = migrateStoreState({ game: structuredClone(g), undoStack: [] }, 22) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(withV23Alignment(g));
  });

  it("the evidence is narrow: correction / resolutionId on other categories, or a plain Alignment record, is not v23 evidence", () => {
    const g: Raw = { players: { a: { shownAlignment: "good", isTraveler: true } }, history: [
      { id: "h1", category: "life", correction: true }, { id: "h2", category: "role", correction: true, resolutionId: "r" },
      { id: "h3", category: "effect", resolutionId: "r", effectOperation: "apply" }, { id: "h4", category: "alignment", change: { kind: "value", from: {}, to: { actualAlignment: "good" } } },
    ] };
    expect(hasV23Evidence(g)).toBe(false);
  });

  it("unsupported / newer markers remain rejected and are never reinterpreted", () => {
    for (const marker of [24, "23", null, { v: 23 }]) {
      const g = currentGame();
      g.gameSchemaVersion = marker;
      expect(detectLegacyGameVersion(g)).toBe(23);
      const copy = structuredClone(g);
      migrateGameEntry(copy, 13, { kind: "canonical-only" });
      expect(copy).toEqual(g);
      migrateStoreState({ game: structuredClone(g), undoStack: [] }, 22);
      expect(takeMigrationResetFlag()).toBe(true);
    }
  });
});

describe("10E-AC-32: persisted round-trip", () => {
  it("a valid v23 game with undisclosed perception and correction / correlated Alignment History round-trips schema and localStorage", async () => {
    currentGame();
    const zed = game().seatOrder.at(-2)!;
    expect(state().setShownAlignment(zed, "undisclosed")).toMatchObject({ ok: true });
    const records = game().history.filter((h) => h.category === "alignment");
    expect(records.some((h) => h.correction === true)).toBe(true);
    expect(records.some((h) => h.resolutionId === "res-1")).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);
    const snapshot = JSON.parse(JSON.stringify({ game: game(), undoStack: state().undoStack }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = localStorage.getItem("new-blood-st")!;
    expect(JSON.parse(saved).version).toBe(23);
    store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", saved);
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(JSON.parse(JSON.stringify({ game: game(), undoStack: state().undoStack }))).toEqual(snapshot);
    expect(game().players[zed]!.shownAlignment).toBe("undisclosed");
  });
});
