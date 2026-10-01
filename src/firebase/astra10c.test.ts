// Phase 10C Astra remediation -- regression proofs for:
//  ASTRA-10C-001  current ParticipantIds are unique across occupied seats
//  ASTRA-10C-002  legacy Reminder History cannot be a `value` record, and a
//                 cleanupCue nested in Reminder History is v21 evidence
//  ASTRA-10C-003  each game entry's OWN version routes old store migrations
//  ASTRA-10C-004  sparse Reminder intent arrays refuse, never throw
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { HistoryRecordSchema, StorytellerGamePersistedSchema } from "@/stores/schemas";
import { detectLegacyGameVersion, hasV21Evidence, migrateGameEntry } from "@/stores/gameMigration";
import { planLifeTransaction } from "@/stores/lifeResolution";
import { participantRefOf } from "@/stores/participants";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { buildRichPhase9Game } from "@/test/phase9RichState";
import { asV20, withV21Reminders, withV22Roles, withV23Alignment } from "@/test/v20Migration";
import type { ReminderIntent, ReminderParticipantBinding } from "@/stores/reminderResolution";
import type { PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";

type Raw = Record<string, unknown>;
type RawGame = Raw & { players: Record<string, Raw>; history: Raw[]; seatOrder: string[] };
const code = "ASTR2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
const state = () => useStorytellerStore.getState();
const game = () => state().game!;
const idOf = (name: string) => game().seatOrder.find((id) => game().players[id]!.name === name)!;
const bind = (id: PlayerId): ReminderParticipantBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript },
  });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  localStorage.clear();
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

function liveGame() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  useStorytellerStore.setState({ undoStack: [] });
}
/** A JSON copy of the current game, as persisted/checkpointed. */
const persisted = (g: StorytellerLobbyRecord = game()): RawGame => JSON.parse(JSON.stringify({ ...g, code, storytellerUid: "host" }));
const valid = (g: unknown) => StorytellerGamePersistedSchema.safeParse(g).success;

async function recoverFrom(g: Raw) {
  const b = new MemoryRoomBackend();
  await b.set(`${root}/checkpoint`, JSON.stringify({ game: g, roster: {} }));
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  const writer = new SessionWriter(b, code, session.id);
  disposals.push(() => writer.dispose());
  return () => startStorytellerSession(b, lobby, writer);
}

// ---------------------------------------------------------------------------
// ASTRA-10C-001
// ---------------------------------------------------------------------------
describe("ASTRA-10C-001: every occupied participant has a unique current ParticipantId", () => {
  /** Astra's reproducer: Carol's live record carries Alice's ParticipantId. */
  function duplicated(): RawGame {
    liveGame();
    const g = persisted();
    g.players[idOf("Carol")]!.participantId = g.players[idOf("Alice")]!.participantId;
    return g;
  }

  it("Current State: two occupied seats sharing one ParticipantId are rejected by StorytellerGamePersistedSchema", () => {
    const g = duplicated();
    const result = StorytellerGamePersistedSchema.safeParse(g);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.path.join(".") === `players.${idOf("Carol")}.participantId`)).toBe(true);
    // Local hydration of that Current State resets.
    migrateStoreState({ game: g, undoStack: [] }, 21);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("Undo snapshot: a valid Current State with a duplicate-identity Undo entry fails through the reset path", () => {
    const bad = duplicated();
    const result = migrateStoreState({ game: persisted(), undoStack: [bad] }, 21) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it("Checkpoint recovery: rejected and never adopted", async () => {
    const start = await recoverFrom(duplicated());
    useStorytellerStore.setState({ game: null });
    await expect(start()).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("cross-planner: the ambiguous snapshot Astra fed the Life planner can never become authoritative -- the boundary rejects it first", async () => {
    const g = duplicated();
    // The planner assumes a valid game; the invalid one is stopped before any
    // planner could be handed it as recovered/persisted authoritative state.
    expect(valid(g)).toBe(false);
    useStorytellerStore.setState({ game: null });
    localStorage.setItem("new-blood-st", JSON.stringify({ version: 21, state: { game: g, undoStack: [] } }));
    await useStorytellerStore.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(true);
    expect(useStorytellerStore.getState().game).toBeNull();
    // (Life semantics are unchanged: on a VALID game the planner still works.)
    useStorytellerStore.setState({ customScripts: { [setupScript.id]: setupScript } });
    liveGame();
    const life = planLifeTransaction(game(), { intents: [{ kind: "death", playerId: idOf("Alice") }] });
    expect(life, JSON.stringify(life)).toMatchObject({ ok: true });
  });

  it("historical refs legitimately repeat current and departed ParticipantIds (History, Provenance, Information Delivery, origins, Life Events)", () => {
    buildRichPhase9Game();
    const g = game();
    const alive = Object.values(g.players).filter((p) => !p.isEmpty && p.alive)[0]!;
    // Add origins and provenance naming the same participant repeatedly.
    const target = Object.values(g.players).find((p) => !p.isEmpty && p.id !== alive.id)!;
    expect(state().resolveReminders({ intents: [
      { kind: "place", target: bind(target.id), reminder: { label: "A", source: bind(alive.id) } },
      { kind: "place", target: bind(target.id), reminder: { label: "B", source: bind(alive.id) } },
    ], context: { provenance: { sourcePlayer: alive.id } } }).ok).toBe(true);
    const json = JSON.stringify(game());
    expect(json.split(alive.participantId!).length - 1).toBeGreaterThan(3);
    expect(valid(persisted())).toBe(true);
  });

  it("seat reuse: a departed ParticipantId in History next to the new occupant's fresh id stays valid", () => {
    liveGame();
    const seat = idOf("Alice");
    const departed = game().players[seat]!.participantId!;
    expect(state().resolveReminders({ intents: [{ kind: "place", target: bind(idOf("Carol")), reminder: { label: "X", source: bind(seat) } }] }).ok).toBe(true);
    state().unseatPlayer(seat);
    state().addPlayerToSeat("Mallory");
    expect(game().players[seat]!.participantId).not.toBe(departed);
    expect(JSON.stringify(game().history)).toContain(departed);
    expect(valid(persisted())).toBe(true);
  });

  it("legacy migration still gives distinct occupied seats distinct ParticipantIds (no false duplicates)", () => {
    liveGame();
    const legacy = persisted();
    // A v16-shaped game: no marker/window/history/deliveries or identity yet.
    for (const key of ["gameSchemaVersion", "lifeEventWindow", "history", "informationDeliveries"]) delete legacy[key];
    for (const p of Object.values(legacy.players)) { delete p.participantId; for (const e of p.effects as Raw[]) { delete e.state; delete e.expiry; } }
    const result = migrateStoreState({ game: legacy, undoStack: [] }, 16) as { game: RawGame };
    expect(takeMigrationResetFlag()).toBe(false);
    const ids = Object.values(result.game.players).filter((p) => p.isEmpty !== true).map((p) => p.participantId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(valid(result.game)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ASTRA-10C-002
// ---------------------------------------------------------------------------
describe("ASTRA-10C-002: legacy Reminder History cannot smuggle value records or v21 snapshots", () => {
  const participant = { kind: "participant", participantId: "pt-a", playerId: "a", nameAtTime: "A" };
  const legacyItem = { id: "r", label: "Chosen", lifetime: { kind: "manual" } };
  const history = (record: Raw) => HistoryRecordSchema.safeParse({ id: "h", category: "reminder", participant, ...record }).success;

  it.each([
    ["clean snapshots", legacyItem, legacyItem],
    ["a retired sourcePlayer", { ...legacyItem, sourcePlayer: "a" }, legacyItem],
    ["a malformed sourceParticipant", legacyItem, { ...legacyItem, sourceParticipant: { kind: "participant" } }],
  ])("an operation-less Reminder `value` record (%s) is rejected, never read as a v21 amend", (_label, from, to) => {
    expect(history({ change: { kind: "value", from, to } })).toBe(false);
  });

  it("genuine legacy add/remove (with lifetime snapshots and mirrored provenance) stays accepted", () => {
    for (const kind of ["added", "removed"]) {
      expect(history({ change: { kind, item: { ...legacyItem, sourceParticipant: { kind: "legacy", playerId: "a" }, note: "n" } },
        provenance: { sourceParticipant: { kind: "legacy", playerId: "a" }, note: "n" } })).toBe(true);
    }
  });

  it("a legacy-shaped add/remove carrying a v21 cleanupCue is a hybrid and is rejected", () => {
    for (const kind of ["added", "removed"]) {
      expect(history({ change: { kind, item: { ...legacyItem, cleanupCue: { kind: "unresolved" } } } })).toBe(false);
      expect(history({ change: { kind, item: { ...legacyItem, cleanupCue: undefined } } })).toBe(false);
    }
  });

  it("planner-produced v21 Place / Amend / Remove History stays accepted", () => {
    liveGame();
    const target = bind(idOf("Carol"));
    expect(state().resolveReminders({ intents: [{ kind: "place", target, reminder: { id: "r1", label: "A", cleanup: { kind: "nextPhase" } } }] }).ok).toBe(true);
    expect(state().resolveReminders({ intents: [{ kind: "amend", target, reminderId: "r1", changes: { note: "n" } }] }).ok).toBe(true);
    expect(state().resolveReminders({ intents: [{ kind: "remove", target, reminderId: "r1" }] }).ok).toBe(true);
    const records = game().history.filter((h) => h.category === "reminder");
    expect(records.map((h) => h.reminderOperation)).toEqual(["place", "amend", "remove"]);
    expect(valid(persisted())).toBe(true);
  });

  /** A marker-20 game whose legacy-shaped Reminder History carries a cue. */
  function marker20WithNestedCue(where: "item" | "from" | "to" = "item"): RawGame {
    liveGame();
    const g = asV20(persisted()) as RawGame;
    const snapshot = { ...legacyItem, cleanupCue: { kind: "unresolved" } };
    g.history.push(where === "item"
      ? { id: "h-cue", category: "reminder", participant, change: { kind: "added", item: snapshot } }
      : { id: "h-cue", category: "reminder", participant, change: { kind: "value", from: where === "from" ? snapshot : legacyItem, to: where === "to" ? snapshot : legacyItem } });
    return g;
  }

  it.each(["item", "from", "to"] as const)("marker 20 + a cleanupCue nested in Reminder History (%s) is v21 evidence: no v20 -> v21 repair, rejected", (where) => {
    const g = marker20WithNestedCue(where);
    expect(hasV21Evidence(g)).toBe(true);
    expect(detectLegacyGameVersion(g)).toBe(20);
    const copy = structuredClone(g);
    migrateGameEntry(copy, 20, { kind: "canonical-only" });
    expect(copy).toEqual(g);
    expect(valid(copy)).toBe(false);
    migrateStoreState({ game: structuredClone(g), undoStack: [] }, 20);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("marker-less + a nested History cleanupCue is current evidence: never migrated as older legacy", () => {
    const g = marker20WithNestedCue();
    delete g.gameSchemaVersion;
    expect(detectLegacyGameVersion(g)).toBe(23);
    const copy = structuredClone(g);
    migrateGameEntry(copy, 13, { kind: "canonical-only" });
    expect(copy).toEqual(g);
    migrateStoreState({ game: structuredClone(g), undoStack: [] }, 19);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ASTRA-10C-003
// ---------------------------------------------------------------------------
describe("ASTRA-10C-003: an entry's own version routes old store migrations", () => {
  it("Case A (Astra): outer v2 + marker-21 game with fabled: null -- never defaulted to [], rejected as written", () => {
    liveGame();
    const g = persisted() as RawGame;
    g.fabled = null;
    const envelope = { game: g, undoStack: [] as unknown[] };
    const result = migrateStoreState(envelope, 2) as { game: unknown };
    expect(envelope.game.fabled).toBeNull(); // not repaired in place either
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it("Case B (Astra): outer v9 + marker-21 Current State and Undo keep their startingNonTravelerCount", () => {
    liveGame();
    const g = persisted();
    expect(g.startingNonTravelerCount).toBe(7);
    const result = migrateStoreState({ game: g, undoStack: [persisted()] }, 9) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game.startingNonTravelerCount).toBe(7);
    expect(result.undoStack[0]!.startingNonTravelerCount).toBe(7);
    expect(result.game).toEqual(persisted());
  });

  it("marker 20 inside a very old envelope receives exactly v20 -> v21 -> v22 -> v23 and nothing older", () => {
    liveGame();
    state().resolveReminders({ intents: [{ kind: "place", target: bind(idOf("Carol")), reminder: { label: "Chosen" } }] });
    const v20 = asV20(persisted());
    (v20 as RawGame).fabled = ["djinn"]; // an old step would never touch it anyway; content must survive exactly
    const result = migrateStoreState({ game: structuredClone(v20), undoStack: [structuredClone(v20)] }, 1) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(withV23Alignment(withV22Roles(withV21Reminders(v20))));
    expect(result.undoStack[0]).toEqual(withV23Alignment(withV22Roles(withV21Reminders(v20))));
  });

  it("Current State and each Undo entry follow their own path (marker 23 / genuine v13 / marker 20)", () => {
    liveGame();
    const current = persisted();
    const v13 = persisted() as RawGame;
    for (const key of ["gameSchemaVersion", "lifeEventWindow", "history", "informationDeliveries", "startingNonTravelerCount"]) delete v13[key];
    for (const p of Object.values(v13.players)) { delete p.participantId; delete p.effects; delete p.actualAlignment; }
    const v20 = asV20(persisted());
    const result = migrateStoreState({ game: structuredClone(current), undoStack: [v13, structuredClone(v20)],
      customScripts: { [setupScript.id]: setupScript } }, 13) as { game: Raw; undoStack: RawGame[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(current); // no legacy repair
    const [migrated13, migrated20] = result.undoStack;
    expect(migrated13!.gameSchemaVersion).toBe(23);
    for (const p of Object.values(migrated13!.players).filter((p) => p.isEmpty !== true)) {
      expect(p.participantId).toBe(`legacy-current:${p.id}`); // the v13+ path ran
      expect(p.actualAlignment).toBeDefined(); // v13 -> v14 derivation ran
    }
    expect(migrated20).toEqual(withV23Alignment(withV22Roles(withV21Reminders(v20)))); // only v20 -> v21 -> v22 -> v23
  });

  it("a genuine old save (v1 envelope, v1-shaped game) still migrates through the whole chain", () => {
    liveGame();
    const old = persisted();
    for (const key of ["gameSchemaVersion", "lifeEventWindow", "history", "informationDeliveries", "plannedTravelerCount",
      "startingNonTravelerCount", "nightProgress", "fabled", "bluffs", "lorics", "rolePool", "plannedPlayerCount", "pendingPlayers"]) delete old[key];
    for (const p of Object.values(old.players)) { delete p.participantId; delete p.effects; delete p.isEmpty; }
    const result = migrateStoreState({ game: old, undoStack: [] }, 1) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toMatchObject({ gameSchemaVersion: 23, fabled: [], lorics: [], rolePool: [], plannedTravelerCount: 0, pendingPlayers: {} });
  });

  it("a pre-v8 envelope with a lobby cannot drop/rewrite a newer game entry: it fails closed", () => {
    liveGame();
    const g = persisted();
    const envelope = { game: g, undoStack: [persisted()], lobby: { code: "X", uid: "u", status: "live" } };
    migrateStoreState(envelope, 7);
    expect(takeMigrationResetFlag()).toBe(true);
    expect(envelope.game.code).toBe(code); // never rewritten
    expect(envelope.undoStack).toHaveLength(1);
  });

  it("checkpoint parity: local hydration and checkpoint recovery now agree on the same game content", async () => {
    liveGame();
    const v20 = asV20(persisted());
    const local = migrateStoreState({ game: structuredClone(v20), undoStack: [] }, 2) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    const start = await recoverFrom(structuredClone(v20));
    useStorytellerStore.setState({ game: null, undoStack: [] });
    const recovered = await start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game).toEqual(local.game);
    // And a malformed marked game is rejected by BOTH paths.
    const bad = persisted() as RawGame;
    bad.fabled = null;
    migrateStoreState({ game: structuredClone(bad), undoStack: [] }, 2);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("combined (003 x 002): old envelope + marker-20 game + legacy History carrying a cleanupCue is not normalized and migrated", () => {
    liveGame();
    const g = asV20(persisted()) as RawGame;
    g.history.push({ id: "h-cue", category: "reminder", participant: participantRefOf(game(), idOf("Carol")),
      change: { kind: "added", item: { id: "x", label: "X", lifetime: { kind: "manual" }, cleanupCue: { kind: "unresolved" } } } });
    delete g.lorics; // something an old step WOULD have defaulted
    const envelope = { game: g, undoStack: [] as unknown[] };
    const result = migrateStoreState(envelope, 3) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
    expect("lorics" in envelope.game).toBe(false);
    expect(envelope.game.gameSchemaVersion).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// ASTRA-10C-004
// ---------------------------------------------------------------------------
describe("ASTRA-10C-004: sparse intent arrays refuse with a structured invalid, never throw", () => {
  function expectRefusal(intents: unknown[], intentIndex: number) {
    const before = game();
    const history = structuredClone(before.history);
    const undo = state().undoStack.length;
    const seq = state().localSeq;
    let result: unknown;
    expect(() => { result = state().resolveReminders({ intents: intents as ReminderIntent[] }); }).not.toThrow();
    expect(result).toMatchObject({ ok: false, code: "invalid", intentIndex });
    expect(state().game).toBe(before);
    expect(game().history).toEqual(history);
    expect(state().undoStack).toHaveLength(undo);
    expect(state().localSeq).toBe(seq);
  }

  it("new Array(1) -> invalid at index 0", () => {
    liveGame();
    expectRefusal(new Array(1), 0);
  });

  it("[valid, <hole>, valid] -> invalid at index 1; nothing applied", () => {
    liveGame();
    const valid = { kind: "place", target: bind(idOf("Carol")), reminder: { label: "A" } };
    const sparse: unknown[] = [valid];
    sparse[2] = { ...valid, reminder: { label: "B" } };
    expect(1 in sparse).toBe(false);
    expectRefusal(sparse, 1);
    expect(game().players[idOf("Carol")]!.reminders).toEqual([]);
  });

  it("dense arrays behave unchanged", () => {
    liveGame();
    const result = state().resolveReminders({ intents: [
      { kind: "place", target: bind(idOf("Carol")), reminder: { label: "A" } },
      { kind: "place", target: bind(idOf("Carol")), reminder: { label: "B" } },
    ] });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(game().players[idOf("Carol")]!.reminders.map((r) => r.label)).toEqual(["A", "B"]);
  });
});
