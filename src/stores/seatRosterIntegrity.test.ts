// Phase 9R.5 -- recovered seat / roster integrity. A recovered game may only
// become authoritative when its seat-bearing player records and seatOrder
// describe ONE coherent roster/seat geometry (schemas.ts checkSeatGeometry).
// Previously a save omitting a legitimate player from seatOrder hydrated,
// and removePlayer() -- which rebuilt the players map solely by walking
// seatOrder -- then silently deleted that unseated player as collateral.
//
// Remote checkpoint recovery for the same contract lives in
// src/firebase/seatRosterCheckpoint.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store, takeMigrationResetFlag } from "./storytellerStore";
import { StorytellerGamePersistedSchema, StorytellerStateSchema } from "./schemas";
import { selectSetupContext } from "@/features/setup/setupContext";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import { needsShownIdentity } from "./identity";
import type { STPlayerRecord, StorytellerLobbyRecord } from "./types";

const STORAGE_KEY = "new-blood-st";
const game = () => store.getState().game!;
const state = () => store.getState();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeEach(() => {
  store.setState({
    game: null, view: "home", lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
  takeMigrationResetFlag();
});

/** Seven legitimate, occupied, dealt players built only through real
 * production commands -- never a hand-assembled record. */
function sevenPlayerGame() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (let i = 0; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  expect(game().seatOrder).toHaveLength(7);
  expect(Object.keys(game().players)).toHaveLength(7);
}

function goLive() {
  for (const id of game().seatOrder) {
    const actualRole = game().players[id]!.actualRole;
    if (needsShownIdentity(actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
}

const geometryIssues = (candidate: unknown) => {
  const result = StorytellerGamePersistedSchema.safeParse(candidate);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((i) => ({ path: i.path, message: i.message }));
};

// ---------------------------------------------------------------------------
// A. Persisted schema integrity
// ---------------------------------------------------------------------------
describe("Phase 9R.5 A: StorytellerGamePersistedSchema enforces one coherent roster/seat geometry", () => {
  const valid = () => clone(setupGame()); // p0..p6, seat i at seatOrder[i]

  it("control: a coherent game (seven records, each seated exactly once at its own index) is accepted unchanged", () => {
    const g = valid();
    const parsed = StorytellerGamePersistedSchema.parse(g);
    expect(parsed.seatOrder).toEqual(g.seatOrder);
    expect(parsed.players).toEqual(g.players);
  });

  it("control: an empty roster (no records, no seats) is coherent", () => {
    expect(StorytellerGamePersistedSchema.safeParse({ ...valid(), players: {}, seatOrder: [] }).success).toBe(true);
  });

  it("control: a coherently REORDERED geometry -- seatOrder and every stored seat updated together -- is accepted", () => {
    const g = valid();
    const order = ["p3", "p0", "p6", "p1", "p5", "p2", "p4"];
    order.forEach((id, index) => { g.players[id]!.seat = index; });
    g.seatOrder = order;
    const parsed = StorytellerGamePersistedSchema.parse(g);
    expect(parsed.seatOrder).toEqual(order);
    expect(order.map((id) => parsed.players[id]!.seat)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("rejects a seatOrder id with no player record at all", () => {
    const g = valid();
    g.seatOrder.push("ghost");
    expect(geometryIssues(g)).toContainEqual({ path: ["seatOrder", 7], message: 'seatOrder[7] ("ghost") names no own player record' });
  });

  it.each(["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"])(
    "rejects an inherited-only seatOrder id (%s) -- an Object.prototype member is never a player record",
    (inherited) => {
      const g = valid();
      g.seatOrder.push(inherited);
      expect(geometryIssues(g)).toContainEqual({
        path: ["seatOrder", 7], message: `seatOrder[7] (${JSON.stringify(inherited)}) names no own player record`,
      });
    });

  it("rejects an inherited id even when it REPLACES a legitimate seat (same length, so no count mismatch hides it)", () => {
    const g = valid();
    g.seatOrder[6] = "toString";
    const issues = geometryIssues(g);
    expect(issues).toContainEqual({ path: ["seatOrder", 6], message: 'seatOrder[6] ("toString") names no own player record' });
    expect(issues).toContainEqual({ path: ["players", "p6"], message: "player record is missing from seatOrder" });
  });

  it("rejects a duplicate seatOrder id", () => {
    const g = valid();
    g.seatOrder.push("p2");
    expect(geometryIssues(g)).toContainEqual({ path: ["seatOrder", 7], message: 'seatOrder[7] duplicates seatOrder[2] ("p2")' });
  });

  it("rejects a duplicate that displaces a legitimate player (same length)", () => {
    const g = valid();
    g.seatOrder[5] = "p2";
    const issues = geometryIssues(g);
    expect(issues).toContainEqual({ path: ["seatOrder", 5], message: 'seatOrder[5] duplicates seatOrder[2] ("p2")' });
    expect(issues).toContainEqual({ path: ["players", "p5"], message: "player record is missing from seatOrder" });
  });

  it("rejects an own player record omitted from seatOrder -- the exact 9R.5 finding shape", () => {
    const g = valid();
    g.seatOrder = g.seatOrder.filter((id) => id !== "p6");
    expect(geometryIssues(g)).toEqual([{ path: ["players", "p6"], message: "player record is missing from seatOrder" }]);
  });

  it("rejects an omitted player even when the remaining seats are renumbered to look contiguous", () => {
    const g = valid();
    g.seatOrder = g.seatOrder.filter((id) => id !== "p3");
    g.seatOrder.forEach((id, index) => { g.players[id]!.seat = index; });
    expect(geometryIssues(g)).toEqual([{ path: ["players", "p3"], message: "player record is missing from seatOrder" }]);
  });

  it("rejects a players key / embedded player.id mismatch", () => {
    const g = valid();
    g.players.p4!.id = "p9";
    expect(geometryIssues(g)).toEqual([{ path: ["players", "p4", "id"], message: 'player id "p9" disagrees with its players key' }]);
  });

  it("rejects a stored player.seat that disagrees with its seatOrder index", () => {
    const g = valid();
    g.players.p1!.seat = 4;
    expect(geometryIssues(g)).toEqual([{ path: ["players", "p1", "seat"], message: "player seat 4 disagrees with its seatOrder index 1" }]);
  });

  it("rejects a half-applied reorder: seatOrder permuted but stored seats left behind", () => {
    const g = valid();
    g.seatOrder = ["p1", "p0", ...g.seatOrder.slice(2)];
    const issues = geometryIssues(g);
    expect(issues).toContainEqual({ path: ["players", "p1", "seat"], message: "player seat 1 disagrees with its seatOrder index 0" });
    expect(issues).toContainEqual({ path: ["players", "p0", "seat"], message: "player seat 0 disagrees with its seatOrder index 1" });
  });

  it('rejects an own "__proto__" players key (raw JSON) rather than letting record parsing silently drop it', () => {
    const g = valid();
    const raw = JSON.parse(JSON.stringify(g).replace('"players":{', `"players":{"__proto__":${JSON.stringify(makeSTPlayer({ id: "__proto__", seat: 7 }))},`)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(raw.players, "__proto__")).toBe(true);
    expect(geometryIssues(raw)).toContainEqual({ path: ["players", "__proto__"], message: 'a "__proto__" players key can never be a player record' });
    // ...even if seatOrder names it: never adopted either way.
    (raw.seatOrder as string[]).push("__proto__");
    expect(StorytellerGamePersistedSchema.safeParse(raw).success).toBe(false);
  });

  it("validation never mutates or normalizes the candidate (rejected or accepted)", () => {
    const bad = valid();
    bad.seatOrder = [...bad.seatOrder.filter((id) => id !== "p6"), "p0", "toString"];
    bad.players.p2!.seat = 9;
    const before = clone(bad);
    expect(StorytellerGamePersistedSchema.safeParse(bad).success).toBe(false);
    expect(bad).toEqual(before);
    const good = valid();
    const goodBefore = clone(good);
    expect(StorytellerGamePersistedSchema.safeParse(good).success).toBe(true);
    expect(good).toEqual(goodBefore);
  });

  it("the same rules apply to every Undo snapshot through StorytellerStateSchema", () => {
    const okUndo = valid();
    const badUndo = valid();
    badUndo.seatOrder = badUndo.seatOrder.slice(1);
    expect(StorytellerStateSchema.safeParse({ game: valid(), undoStack: [okUndo] }).success).toBe(true);
    const result = StorytellerStateSchema.safeParse({ game: valid(), undoStack: [okUndo, badUndo] });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path)).toContainEqual(["undoStack", 1, "players", "p0"]);
  });

  it("every normal seat-geometry command leaves the game coherent under this contract (add/fill/empty/Traveler seat/move/reorder/unseat/remove)", () => {
    const coherent = (label: string) =>
      expect(StorytellerGamePersistedSchema.safeParse(clone(game())).success, label).toBe(true);
    state().newGame(setupScript.id, { plannedPlayerCount: 4, plannedTravelerCount: 0 });
    coherent("newGame");
    state().addPlayerToSeat("Ann"); coherent("addPlayerToSeat");
    state().addPlayer("Bob"); coherent("addPlayer");
    state().addEmptySeat(); coherent("addEmptySeat");
    state().addTravelerSeat(); coherent("addTravelerSeat");
    const [a, b, c] = game().seatOrder;
    state().movePlayer(a!, "right"); coherent("movePlayer");
    state().setSeatOrder([...game().seatOrder].reverse()); coherent("setSeatOrder");
    state().unseatPlayer(game().seatOrder.find((id) => !game().players[id]!.isEmpty)!); coherent("unseatPlayer");
    expect(state().removePlayer(b!)).toBe(true); coherent("removePlayer");
    expect(state().removePlayer(c!)).toBe(true); coherent("removePlayer #2");
    state().undo(); coherent("undo");
  });
});

// ---------------------------------------------------------------------------
// B. Local current-version (v18) recovery
// ---------------------------------------------------------------------------
describe("Phase 9R.5 B: a malformed CURRENT-version (v18) local save never hydrates as authoritative", () => {
  /** Persist the real store state, return the raw v18 localStorage blob. */
  async function persistedBlob(): Promise<{ state: Record<string, unknown>; version: number }> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = localStorage.getItem(STORAGE_KEY)!;
    const blob = JSON.parse(raw) as { state: Record<string, unknown>; version: number };
    expect(blob.version).toBe(18); // already current: Zustand's own migrate() is skipped
    return blob;
  }

  async function rehydrateFrom(blob: unknown) {
    store.setState({ game: null, view: "home", lobby: null, undoStack: [], selectedPlayerId: null });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    await store.persist.rehydrate();
  }

  it("control: an unmodified seven-player v18 save round-trips unchanged", async () => {
    sevenPlayerGame();
    const expected = clone(game());
    const blob = await persistedBlob();
    await rehydrateFrom(blob);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(game()).toEqual(expected);
  });

  it("seven legitimate players with ONE omitted from seatOrder: the whole save is rejected through the existing reset contract -- never partially adopted, never repaired", async () => {
    sevenPlayerGame();
    const blob = await persistedBlob();
    const persistedGame = blob.state.game as StorytellerLobbyRecord;
    const omitted = persistedGame.seatOrder[3]!;
    persistedGame.seatOrder = persistedGame.seatOrder.filter((id) => id !== omitted);
    expect(Object.keys(persistedGame.players)).toHaveLength(7);
    expect(persistedGame.seatOrder).toHaveLength(6);
    blob.state.view = "game";

    await rehydrateFrom(blob);

    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull(); // not the malformed game, not a "repaired" one
    expect(state().undoStack).toEqual([]);
    expect(state().view).toBe("home");
  });

  it.each<[string, (g: StorytellerLobbyRecord) => void]>([
    ["an unknown seat id", (g) => { g.seatOrder.push("ghost"); }],
    ["an inherited seat id (toString)", (g) => { g.seatOrder[6] = "toString"; }],
    ["a duplicate seat id", (g) => { g.seatOrder[6] = g.seatOrder[0]!; }],
    ["a key / player.id mismatch", (g) => { g.players[g.seatOrder[2]!]!.id = "someone-else"; }],
    ["a stored seat / index mismatch", (g) => { g.players[g.seatOrder[2]!]!.seat = 5; }],
  ])("a v18 save with %s is likewise rejected through the reset contract", async (_label, corrupt) => {
    sevenPlayerGame();
    const blob = await persistedBlob();
    corrupt(blob.state.game as StorytellerLobbyRecord);
    await rehydrateFrom(blob);
    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull();
  });

  it("a VALID current game whose persisted Undo snapshot omits a player is rejected too -- Undo gets the same canonical rules, not weaker ones", async () => {
    sevenPlayerGame();
    state().setNotes(game().seatOrder[0]!, "creates an Undo entry");
    const blob = await persistedBlob();
    const undo = blob.state.undoStack as StorytellerLobbyRecord[];
    expect(undo.length).toBeGreaterThan(0);
    const snapshot = undo[undo.length - 1]!;
    snapshot.seatOrder = snapshot.seatOrder.slice(0, -1);
    expect(StorytellerGamePersistedSchema.safeParse(blob.state.game).success).toBe(true); // Current State itself is fine

    await rehydrateFrom(blob);

    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull();
    expect(state().undoStack).toEqual([]);
  });

  it("a malformed PRE-v17 (v16) save is rejected after migration as well", async () => {
    sevenPlayerGame();
    const blob = await persistedBlob();
    const g = blob.state.game as StorytellerLobbyRecord & Record<string, unknown>;
    for (const p of Object.values(g.players)) delete (p as Partial<STPlayerRecord>).participantId; // v16 shape
    g.seatOrder = g.seatOrder.slice(1);
    await rehydrateFrom({ ...blob, version: 16 });
    expect(takeMigrationResetFlag()).toBe(true);
    expect(state().game).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D. selectSetupContext() defense in depth
// ---------------------------------------------------------------------------
describe("Phase 9R.5 D: selectSetupContext() resolves only OWN player records", () => {
  const inherited = ["toString", "constructor", "__proto__", "hasOwnProperty"];

  it.each(inherited)("an inherited seatOrder name (%s) is never an occupied, ordinary, Traveler, or valid player record", (name) => {
    const base = setupGame(standardRoles(5));
    const malformed: StorytellerLobbyRecord = { ...base, seatOrder: [...base.seatOrder, name] };
    const context = selectSetupContext(malformed, setupScript);
    const controlContext = selectSetupContext(base, setupScript);

    const ids = (list: STPlayerRecord[]) => list.map((p) => p.id);
    expect(ids(context.occupied)).toEqual(base.seatOrder);
    expect(ids(context.ordinary)).toEqual(base.seatOrder);
    expect(context.travelers).toEqual([]);
    for (const p of [...context.occupied, ...context.ordinary, ...context.travelers]) {
      expect(typeof p).toBe("object");
      expect(Object.prototype.hasOwnProperty.call(malformed.players, p.id)).toBe(true);
      expect(malformed.players[p.id]).toBe(p);
    }
    expect(context.population.occupiedNonTravelerCount).toBe(controlContext.population.occupiedNonTravelerCount);
    expect(context.population.occupiedTravelerCount).toBe(0);
    expect(context.population.emptyPlannedSeatCount).toBe(controlContext.population.emptyPlannedSeatCount);
    expect(context.population.outstandingTravelerReservationCount).toBe(controlContext.population.outstandingTravelerReservationCount);
    expect(context.assigned).toEqual(controlContext.assigned);
  });

  it("control: every legitimate participant -- ordinary, Traveler, empty seat, Traveler reservation -- is still resolved, and duplicate ids stay de-duplicated", () => {
    const base = setupGame(standardRoles(5));
    const traveler = makeSTPlayer({ id: "t1", name: "Trav", seat: 5, actualRole: "", isTraveler: true });
    const empty = makeSTPlayer({ id: "e1", name: "", seat: 6, actualRole: "", isEmpty: true });
    const reserved = { ...makeSTPlayer({ id: "r1", name: "", seat: 7, actualRole: "", isEmpty: true }), plannedTravelerSeat: true };
    const g: StorytellerLobbyRecord = {
      ...base,
      players: { ...base.players, t1: traveler, e1: empty, r1: reserved },
      seatOrder: [...base.seatOrder, "t1", "e1", "r1", "p0"], // trailing duplicate
    };
    const context = selectSetupContext(g, setupScript);
    expect(context.ordinary.map((p) => p.id)).toEqual(base.seatOrder);
    expect(context.travelers.map((p) => p.id)).toEqual(["t1"]);
    expect(context.occupied.map((p) => p.id)).toEqual([...base.seatOrder, "t1"]);
    expect(context.population).toMatchObject({
      occupiedNonTravelerCount: 5, occupiedTravelerCount: 1,
      emptyPlannedSeatCount: 1, outstandingTravelerReservationCount: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// E. Unrelated-player data-loss reproducer
// ---------------------------------------------------------------------------
describe("Phase 9R.5 E: removePlayer(Y) never deletes an unrelated player X that a malformed seatOrder omits", () => {
  function sevenWithRichX() {
    sevenPlayerGame();
    goLive();
    const [a, , x, , y] = game().seatOrder as [string, string, string, string, string];
    // Meaningful private/current state on X, through real commands.
    state().setNotes(x, "X's Storyteller notes");
    state().setBluffs(x, ["chef", "empath", "monk"]);
    state().setFakeMinions(x, [a]);
    state().setPrivateText(x, "X's private text");
    state().setAlive(x, false);
    expect(state().addEffect(x, { type: "poisoned", lifetime: { kind: "manual" } })).not.toBeNull();
    expect(state().addReminder(x, { label: "Red Herring", lifetime: { kind: "manual" } })).not.toBeNull();
    const xBefore = clone(game().players[x]!);
    expect(xBefore.stNotes).toBe("X's Storyteller notes");
    expect(xBefore.privateInfo).toMatchObject({ bluffs: ["chef", "empath", "monk"], fakeMinions: [a], extraText: "X's private text" });
    expect(xBefore.alive).toBe(false);
    expect(xBefore.effects).toHaveLength(1);
    expect(xBefore.reminders).toHaveLength(1);
    expect(xBefore.participantId).toBeTruthy();
    return { x, y, xBefore };
  }

  it("the exact finding: 7 own records, X omitted from seatOrder, removePlayer(Y) removes only Y -- X (identity, private and current state) and every other player survive", () => {
    const { x, y, xBefore } = sevenWithRichX();
    const everyoneBefore = clone(game().players);
    // Directly inject the malformed in-memory shape (defense in depth: the
    // recovery gate above keeps this from arriving via normal recovery).
    store.setState({ game: { ...game(), seatOrder: game().seatOrder.filter((id) => id !== x) } });
    const orderWithoutX = [...game().seatOrder];
    expect(Object.keys(game().players)).toHaveLength(7);

    expect(state().removePlayer(y)).toBe(true);

    const after = game();
    expect(Object.prototype.hasOwnProperty.call(after.players, y)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(after.players, x)).toBe(true);
    expect(after.players[x]).toEqual(xBefore); // participantId, notes, privateInfo, alive, effects, reminders, seat: untouched
    expect(Object.keys(after.players).sort()).toEqual(Object.keys(everyoneBefore).filter((id) => id !== y).sort());
    expect(Object.keys(after.players)).toHaveLength(6);
    // Seated survivors keep their identities and are renumbered contiguously;
    // X's missing geometry is neither invented nor repaired.
    expect(after.seatOrder).toEqual(orderWithoutX.filter((id) => id !== y));
    after.seatOrder.forEach((id, index) => {
      expect(after.players[id]!.seat).toBe(index);
      expect(after.players[id]!.participantId).toBe(everyoneBefore[id]!.participantId);
    });
    expect(after.seatOrder).not.toContain(x);
    expect(state().undoStack).toEqual([]); // membership transition still clears Undo
  });

  it("the unseated survivor's own record object is carried over as-is, never mutated in place", () => {
    const { x, y } = sevenWithRichX();
    store.setState({ game: { ...game(), seatOrder: game().seatOrder.filter((id) => id !== x) } });
    const xRecord = game().players[x]!;
    const frozen = clone(xRecord);
    state().removePlayer(y);
    expect(xRecord).toEqual(frozen);
  });

  it("a live fakeMinions reference to the removed player is still scrubbed -- on an unseated survivor too -- without deleting anything else", () => {
    const { x, y } = sevenWithRichX();
    const a = game().seatOrder[0]!;
    state().setFakeMinions(x, [a, y]);
    expect(game().players[x]!.privateInfo!.fakeMinions).toEqual([a, y]);
    const xBefore = clone(game().players[x]!);
    store.setState({ game: { ...game(), seatOrder: game().seatOrder.filter((id) => id !== x) } });

    state().removePlayer(y);

    expect(game().players[x]).toEqual({ ...xBefore, privateInfo: { ...xBefore.privateInfo, fakeMinions: [a] } });
  });

  it("an inherited seatOrder name in malformed memory is never minted into an own record by removePlayer()", () => {
    sevenPlayerGame();
    const [first, second] = game().seatOrder as [string, string];
    store.setState({ game: { ...game(), seatOrder: [...game().seatOrder, "toString", "__proto__"] } });
    expect(state().removePlayer(first)).toBe(true);
    const after = game();
    expect(Object.prototype.hasOwnProperty.call(after.players, "toString")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(after.players, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(after.players)).toBe(Object.prototype);
    expect(Object.keys(after.players)).toHaveLength(6);
    expect(after.players[second]!.seat).toBe(0);
    expect(state().removePlayer("toString")).toBe(false); // still not a player
  });
});

// ---------------------------------------------------------------------------
// F. Valid command regressions
// ---------------------------------------------------------------------------
describe("Phase 9R.5 F: ordinary valid seat commands behave exactly as before", () => {
  it("removePlayer on a coherent game: only that player goes, survivors renumber 0..n-1 in seat order (players key order included), plan shrinks, selection cleared, Undo cleared", () => {
    sevenPlayerGame();
    const order = [...game().seatOrder];
    const removed = order[2]!;
    const before = clone(game());
    state().selectPlayer(removed);
    const planned = game().plannedPlayerCount;

    expect(state().removePlayer(removed)).toBe(true);

    const expectedOrder = order.filter((id) => id !== removed);
    expect(game().seatOrder).toEqual(expectedOrder);
    expect(Object.keys(game().players)).toEqual(expectedOrder);
    expectedOrder.forEach((id, index) => expect(game().players[id]).toEqual({ ...before.players[id], seat: index }));
    expect(game().plannedPlayerCount).toBe(planned - 1); // still before Reveal
    expect(state().selectedPlayerId).toBeNull();
    expect(state().undoStack).toEqual([]);
    expect(StorytellerGamePersistedSchema.safeParse(clone(game())).success).toBe(true);
  });

  it("removePlayer before Reveal still decrements the plan exactly once", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 3, plannedTravelerCount: 0 });
    state().addTravelerSeat();
    expect(game().plannedPlayerCount).toBe(4);
    expect(game().plannedTravelerCount).toBe(1);
    const travelerSeat = game().seatOrder[3]!;
    expect(state().removePlayer(travelerSeat)).toBe(true);
    expect(game().plannedPlayerCount).toBe(3);
    expect(game().plannedTravelerCount).toBe(0);
    expect(state().removePlayer(game().seatOrder[0]!)).toBe(true);
    expect(game().plannedPlayerCount).toBe(2);
    expect(game().plannedTravelerCount).toBe(0);
  });

  it("removePlayer still scrubs a removed player from a seated survivor's fakeMinions, dropping empty privateInfo", () => {
    sevenPlayerGame();
    const [a, b, c] = game().seatOrder as [string, string, string];
    state().setFakeMinions(a, [b]);
    state().setFakeMinions(c, [b, a]);
    state().removePlayer(b);
    expect(game().players[a]!.privateInfo).toBeUndefined();
    expect(game().players[c]!.privateInfo!.fakeMinions).toEqual([a]);
  });

  it("removePlayer of an unknown or inherited id is still a no-op returning false", () => {
    sevenPlayerGame();
    const before = game();
    for (const id of ["nobody", "toString", "constructor", "__proto__"]) expect(state().removePlayer(id)).toBe(false);
    expect(game()).toBe(before);
  });

  it("setSeatOrder: an exact permutation renumbers every seat; anything else is still refused", () => {
    sevenPlayerGame();
    const order = [...game().seatOrder].reverse();
    state().setSeatOrder(order);
    expect(game().seatOrder).toEqual(order);
    order.forEach((id, index) => expect(game().players[id]!.seat).toBe(index));
    const before = game();
    state().setSeatOrder(order.slice(1));
    state().setSeatOrder([...order.slice(1), "toString"]);
    state().setSeatOrder([...order.slice(1), order[1]!]);
    expect(game()).toBe(before);
  });

  it("movePlayer swaps neighbours and renumbers both; edges and unknown ids are still no-ops", () => {
    sevenPlayerGame();
    const [a, b] = game().seatOrder as [string, string];
    state().movePlayer(a, "right");
    expect(game().seatOrder.slice(0, 2)).toEqual([b, a]);
    expect(game().players[a]!.seat).toBe(1);
    expect(game().players[b]!.seat).toBe(0);
    const before = game();
    state().movePlayer(b, "left");
    state().movePlayer("toString", "right");
    expect(game()).toBe(before);
  });

  it("Setup selection on a coherent real game is unchanged: every seated occupant is an ordinary participant", () => {
    sevenPlayerGame();
    const context = selectSetupContext(game(), setupScript);
    expect(context.ordinary.map((p) => p.id)).toEqual(game().seatOrder);
    expect(context.population.occupiedNonTravelerCount).toBe(7);
    expect(context.population.totalPhysicalSeatCount).toBe(7);
  });
});
