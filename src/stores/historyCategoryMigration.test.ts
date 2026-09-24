import { beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import { HistoryCategorySchema, HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { needsShownIdentity } from "./identity";
import { participantRefOf } from "./participants";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { buildRichPhase9Game } from "@/test/phase9RichState";

// Terminology audit (v17 -> v18): the History category for an Actual Role
// change is "role", not "identity". These tests cover the production
// emission, the local persisted migration (Current State and every Undo
// snapshot), strict rejection of stale current-version data, and the
// category enum's boundaries. Remote checkpoint recovery is covered in
// src/firebase/historyCategoryCheckpoint.test.ts.

const STORAGE_KEY = "new-blood-st";
const game = () => store.getState().game!;
const state = () => store.getState();

type Raw = Record<string, unknown>;
type RawHistory = { category: string } & Raw;

/** Deep copy of a game-shaped entry with every "role" History category
 * renamed to the v17 name "identity" -- exactly what a v17 writer stored. */
function asV17<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as { history: RawHistory[] };
  for (const record of copy.history) if (record.category === "role") record.category = "identity";
  return copy as unknown as T;
}

const categoriesOf = (entry: unknown) => (entry as { history: RawHistory[] }).history.map((h) => h.category);

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
  takeMigrationResetFlag();
});

// ---------------------------------------------------------------------------
// A. Production History emission
// ---------------------------------------------------------------------------
function dealtGame(count = 7) {
  state().newGame(setupScript.id, { plannedPlayerCount: count, plannedTravelerCount: 0 });
  for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(count));
  expect(state().dealRolePool().ok).toBe(true);
}

function goLive() {
  for (const id of game().seatOrder) {
    const actualRole = game().players[id]!.actualRole;
    if (!actualRole) continue;
    if (needsShownIdentity(actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
}

describe("A. assignRole emits Role History", () => {
  it("during Live Play, produces exactly one History Record with category \"role\" and unchanged participant/change/moment/Provenance", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const source = game().seatOrder[1]!;
    const participant = participantRefOf(game(), id)!;
    const sourceParticipant = participantRefOf(game(), source)!;
    const before = game().players[id]!.actualRole;
    const target = before === "imp" ? "chef" : "imp";

    state().assignRole(id, target, { provenance: { sourcePlayer: source, sourceCharacter: "philosopher", reason: "gained a new role" } });

    expect(game().players[id]!.actualRole).toBe(target);
    expect(game().history).toHaveLength(1);
    const record = game().history[0]!;
    expect(record.category).toBe("role");
    expect(record.participant).toEqual(participant);
    expect(record.change).toEqual({ kind: "value", from: { actualRole: before }, to: { actualRole: target } });
    expect(record.moment).toEqual({ phase: "night", day: 1 });
    expect(record.provenance).toEqual({ sourceParticipant, sourceCharacter: "philosopher", reason: "gained a new role" });
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
    expect(JSON.stringify(game().history)).not.toContain("\"identity\"");
  });

  it("without a Mutation Context, no Provenance is invented", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().assignRole(id, game().players[id]!.actualRole === "imp" ? "chef" : "imp");
    expect(game().history).toHaveLength(1);
    expect(game().history[0]!.category).toBe("role");
    expect("provenance" in game().history[0]!).toBe(false);
  });

  it("a no-op assignRole (the same Actual Role) records nothing and pushes no Undo entry", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const undoDepth = state().undoStack.length;
    const localSeq = state().localSeq;
    state().assignRole(id, game().players[id]!.actualRole);
    expect(game().history).toEqual([]);
    expect(state().undoStack.length).toBe(undoDepth);
    expect(state().localSeq).toBe(localSeq);
  });

  it("Undo removes the Role History Record together with the Actual Role change", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const snapshot = structuredClone(game());
    state().assignRole(id, game().players[id]!.actualRole === "imp" ? "chef" : "imp");
    expect(categoriesOf(game())).toEqual(["role"]);
    state().undo();
    expect(game()).toEqual(snapshot);
    expect(game().history).toEqual([]);
  });

  it("Setup role preparation (Deal, pre-Reveal replacement, Setup assignRole) still records no History", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    expect(state().replaceSetupRole(id, "imp").ok).toBe(true);
    state().assignRole(game().seatOrder[1]!, "chef");
    expect(game().phase).toBe("setup");
    expect(game().history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B/C/H. Local v17 -> v18 migration (Current State and Undo)
// ---------------------------------------------------------------------------
const alice = { kind: "participant", participantId: "pt-alice", playerId: "a", nameAtTime: "Alice" };
const bobNow = { kind: "participant", participantId: "pt-bob", playerId: "a", nameAtTime: "Bob" };
const carol = { kind: "participant", participantId: "pt-carol", playerId: "c", nameAtTime: "Carol" };
const legacyA = { kind: "legacy", playerId: "a" };

const v17Player = (id: string, seat: number, over: Raw = {}): Raw => ({
  id, name: id.toUpperCase(), seat, joinedAt: 1, actualRole: "chef",
  shownRole: "chef", shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
  alive: true, ghostVote: true, abilityUsed: false, statuses: {}, reminders: [], stNotes: "",
  isTraveler: false, actualAlignment: "good", effects: [], ...over,
});

/** A v17 History list covering every category, both ParticipantRef kinds,
 * Provenance with a durable source, a note, and a record with no moment.
 * Seat "a" is NOW occupied by Bob; two records are about Alice (who used to
 * sit there) and one is an unresolved legacy reference to seat "a". */
const v17History = (): RawHistory[] => [
  { id: "h1", category: "identity", participant: alice, moment: { phase: "night", day: 1 },
    change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } },
    provenance: { sourceParticipant: carol, sourceCharacter: "pithag", reason: "Pit-Hag" }, note: "night 1" },
  { id: "h2", category: "alignment", participant: alice, moment: { phase: "night", day: 1 },
    change: { kind: "value", from: { actualAlignment: "good" }, to: { actualAlignment: "evil" } } },
  { id: "h3", category: "identity", participant: legacyA,
    change: { kind: "value", from: { actualRole: "empath" }, to: { actualRole: "chef" } } },
  { id: "h4", category: "life", participant: carol, moment: { phase: "day", day: 1 },
    change: { kind: "value", from: { alive: true }, to: { alive: false } } },
  { id: "h5", category: "effect", participant: carol, moment: { phase: "night", day: 2 },
    change: { kind: "added", item: { id: "e1", type: "poisoned", sourceParticipant: alice, lifetime: { kind: "manual" } } },
    provenance: { sourceParticipant: alice } },
  { id: "h6", category: "reminder", participant: bobNow, moment: { phase: "night", day: 2 },
    change: { kind: "removed", item: { id: "r1", label: "Red Herring", lifetime: { kind: "manual" } } } },
  { id: "h7", category: "identity", participant: bobNow, moment: { phase: "night", day: 2 },
    change: { kind: "value", from: { actualRole: "" }, to: { actualRole: "chef" } } },
];

const v17Game = (): Raw => ({
  code: "", storytellerUid: "", scriptId: "tb", phase: "night", day: 2, notes: "ST notes",
  players: {
    a: v17Player("a", 0, { name: "Bob", participantId: "pt-bob" }),
    c: v17Player("c", 1, { name: "Carol", participantId: "pt-carol", alive: false }),
  },
  seatOrder: ["a", "c"], nightProgress: {}, fabled: [], bluffs: [], lorics: [], rolePool: [],
  plannedPlayerCount: 2, plannedTravelerCount: 0, pendingPlayers: {},
  history: v17History(),
  informationDeliveries: [{
    id: "d1", recipient: alice, actualRole: "washerwoman", informationActionId: "washerwoman-first-night",
    moment: { phase: "night", day: 1 },
    values: [{ requirementId: "players", kind: "player", participants: [carol, legacyA] }],
  }],
});

/** The exact v18 expectation: the same entry with only the category renamed. */
function expectedV18(entry: Raw): Raw {
  const copy = structuredClone(entry) as { history: RawHistory[] };
  for (const record of copy.history) if (record.category === "identity") record.category = "role";
  return copy as unknown as Raw;
}

describe("B. local v17 -> v18 migration of Current State", () => {
  it("\"identity\" becomes \"role\"; every other History field and all of Current State are unchanged", () => {
    const game17 = v17Game();
    const expected = expectedV18(game17);
    const result = migrateStoreState({ game: game17, undoStack: [] }, 17) as { game: Raw };

    expect(takeMigrationResetFlag()).toBe(false);
    expect(categoriesOf(result.game)).toEqual(["role", "alignment", "role", "life", "effect", "reminder", "role"]);
    // Whole-entry equality: ids, order, ParticipantRefs, moments (and their
    // absence), change snapshots, Provenance, notes, players, and
    // Information Delivery are exactly as they were.
    expect(result.game).toEqual(expected);
    // Byte-level: the serialized records differ only in the renamed value.
    expect(JSON.stringify((result.game as { history: unknown }).history))
      .toBe(JSON.stringify(v17History()).replaceAll("\"category\":\"identity\"", "\"category\":\"role\""));
    const { history: _h, ...currentState } = result.game;
    const { history: _h17, ...currentState17 } = v17Game();
    expect(currentState).toEqual(currentState17);
  });

  it("H. a reused seat never pulls historical identity: Alice's records and the legacy seat reference stay as they were, never Bob's", () => {
    const result = migrateStoreState({ game: v17Game(), undoStack: [] }, 17) as { game: { history: RawHistory[] } };
    const byId = Object.fromEntries(result.game.history.map((h) => [h.id, h]));
    expect(byId.h1!.participant).toEqual(alice);
    expect(byId.h2!.participant).toEqual(alice);
    expect(byId.h3!.participant).toEqual(legacyA);
    expect(byId.h7!.participant).toEqual(bobNow);
    expect(JSON.stringify([byId.h1, byId.h2, byId.h3])).not.toContain("pt-bob");
  });

  it("a v16 store with a PlayerId-only \"identity\" record migrates through both steps: unresolved legacy ref and \"role\"", () => {
    const game16 = v17Game();
    game16.players = { a: v17Player("a", 0, { name: "Bob" }), c: v17Player("c", 1, { name: "Carol" }) };
    game16.history = [{ id: "h1", category: "identity", playerId: "a",
      change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } } }];
    game16.informationDeliveries = [];
    const result = migrateStoreState({ game: game16, undoStack: [] }, 16) as { game: { history: unknown[] } };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game.history).toEqual([{ id: "h1", category: "role", participant: legacyA,
      change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } } }]);
  });

  it("idempotent: a second pass over already-migrated state changes nothing", () => {
    const once = migrateStoreState({ game: v17Game(), undoStack: [v17Game()] }, 17);
    const snapshot = structuredClone(once);
    const twice = migrateStoreState(once, 17);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(twice).toEqual(snapshot);
  });
});

describe("C. local v17 -> v18 migration of every Undo snapshot", () => {
  it("Undo snapshots are canonicalized exactly like Current State -- the two never diverge", () => {
    const older = v17Game();
    older.history = (older.history as RawHistory[]).slice(0, 3);
    const state17 = { game: v17Game(), undoStack: [older, v17Game()] };
    const result = migrateStoreState(state17, 17) as { game: Raw; undoStack: Raw[] };

    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.undoStack[0]).toEqual(expectedV18(older));
    expect(result.undoStack[1]).toEqual(expectedV18(v17Game()));
    expect(result.undoStack[1]).toEqual(result.game);
    for (const entry of [result.game, ...result.undoStack]) expect(categoriesOf(entry)).not.toContain("identity");
  });

  it("a real v17 localStorage blob of a rich game rehydrates to exactly the v18 game and Undo stack the app would write today", async () => {
    buildRichPhase9Game();
    const before = structuredClone({ game: state().game!, undoStack: state().undoStack, localSeq: state().localSeq, sync: state().sync });
    expect(categoriesOf(before.game)).toContain("role");
    expect(before.undoStack.some((entry) => categoriesOf(entry).includes("role"))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as { state: Raw; version: number };
    expect(current.version).toBe(18);

    const v17Blob = {
      version: 17,
      state: { ...current.state, game: asV17(current.state.game), undoStack: (current.state.undoStack as unknown[]).map(asV17) },
    };
    expect(JSON.stringify(v17Blob)).toContain("\"category\":\"identity\"");
    store.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v17Blob));
    await store.persist.rehydrate();

    expect(takeMigrationResetFlag()).toBe(false);
    expect(state().game).toEqual(before.game);
    expect(state().undoStack).toEqual(before.undoStack);
    expect(state().localSeq).toBe(before.localSeq);
    expect(state().sync).toEqual(before.sync);
  });
});

// ---------------------------------------------------------------------------
// D. Current-version (v18) strictness
// ---------------------------------------------------------------------------
describe("D. a store labeled v18 that still carries \"identity\" is malformed, never treated as v17", () => {
  it("migrateStoreState(..., 18) rejects it and resets", () => {
    const result = migrateStoreState({ game: v17Game(), undoStack: [] }, 18) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it("a stale \"identity\" only inside an Undo snapshot also rejects the whole v18 store", () => {
    const result = migrateStoreState({ game: expectedV18(v17Game()), undoStack: [v17Game()] }, 18) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it("the same data rehydrated from a real v18 localStorage blob resets instead of hydrating", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 18, state: { game: v17Game(), undoStack: [] } }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull();
  });

  it("control: the same data labeled v17 migrates and hydrates", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 17, state: { game: v17Game(), undoStack: [] } }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(state().game).toEqual(expectedV18(v17Game()));
  });

  it("a canonical v18 store passes through unchanged (same reference)", () => {
    const current = { game: expectedV18(v17Game()), undoStack: [expectedV18(v17Game())] };
    const snapshot = structuredClone(current);
    const result = migrateStoreState(current, 18);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result).toBe(current);
    expect(result).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// G. The category enum is not broadened
// ---------------------------------------------------------------------------
describe("G. invalid categories stay invalid", () => {
  const record = (category: string) => ({ id: "h", category, participant: alice,
    change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } } });

  it("the canonical enum is exactly role/alignment/life/effect/reminder", () => {
    expect(HistoryCategorySchema.options).toEqual(["role", "alignment", "life", "effect", "reminder"]);
    expect(HistoryRecordSchema.safeParse(record("role")).success).toBe(true);
  });

  it.each(["identity", "character", "identity-change", "roles", "Role", "IDENTITY", " role", ""])(
    "%j is rejected by the v18 schema", (category) => {
      expect(HistoryCategorySchema.safeParse(category).success).toBe(false);
      expect(HistoryRecordSchema.safeParse(record(category)).success).toBe(false);
    });

  it.each(["character", "identity-change", "roles", "Identity"])(
    "%j is not the legacy alias: migration leaves it untouched and the v17 store is rejected", (category) => {
      const game17 = v17Game();
      (game17.history as RawHistory[])[0]!.category = category;
      const entry = structuredClone(game17);
      migrateGameEntry(entry, 17, { kind: "canonical-only" });
      expect((entry.history as RawHistory[])[0]!.category).toBe(category);
      const result = migrateStoreState({ game: game17, undoStack: [] }, 17) as { game: unknown };
      expect(takeMigrationResetFlag()).toBe(true);
      expect(result.game).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Shared migrateGameEntry step: bounded and idempotent
// ---------------------------------------------------------------------------
describe("migrateGameEntry v17 -> v18 step", () => {
  it("is a byte-identical no-op on canonical v18 data", () => {
    const entry = expectedV18(v17Game());
    const before = JSON.stringify(entry);
    migrateGameEntry(entry, 17, { kind: "canonical-only" });
    expect(JSON.stringify(entry)).toBe(before);
    expect(StorytellerGamePersistedSchema.safeParse(entry).success).toBe(true);
  });

  it("applying it repeatedly has no effect after the first canonicalization", () => {
    const entry = v17Game();
    migrateGameEntry(entry, 17, { kind: "canonical-only" });
    const once = JSON.stringify(entry);
    migrateGameEntry(entry, 17, { kind: "canonical-only" });
    migrateGameEntry(entry, 17, { kind: "canonical-only" });
    expect(JSON.stringify(entry)).toBe(once);
  });

  it("does nothing for fromVersion 18", () => {
    const entry = v17Game();
    migrateGameEntry(entry, 18, { kind: "canonical-only" });
    expect(entry).toEqual(v17Game());
  });

  it("skips malformed History entries and never adds, removes, or reorders records", () => {
    const entry = v17Game();
    const history = entry.history as unknown[];
    history.splice(1, 0, null, "identity", ["identity"]);
    migrateGameEntry(entry, 17, { kind: "canonical-only" });
    expect((entry.history as unknown[]).length).toBe(v17History().length + 3);
    expect((entry.history as unknown[]).slice(1, 4)).toEqual([null, "identity", ["identity"]]);
    expect((entry.history as { id?: string }[]).filter((h) => h && typeof h === "object" && !Array.isArray(h)).map((h) => h.id))
      .toEqual(v17History().map((h) => h.id));
  });

  it("remote detection still reports v17 for both the v17 and the v18 spelling (no new version marker)", () => {
    expect(detectLegacyGameVersion(v17Game())).toBe(17);
    expect(detectLegacyGameVersion(expectedV18(v17Game()))).toBe(17);
  });
});
