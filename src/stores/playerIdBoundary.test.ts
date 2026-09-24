import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import type { HistoryRecord, PlayerId, StorytellerLobbyRecord } from "./types";

// Phase 9R.4 (B8 remediation): `game.players` is a plain object, so an
// indexed lookup `game.players[id]` also "finds" inherited Object.prototype
// members -- "toString"/"constructor" resolve to functions and "__proto__"
// to Object.prototype itself, all truthy. A PlayerId names a player ONLY
// when it is an own property of game.players. Every authoritative command
// taking a caller-supplied PlayerId must treat an inherited name exactly
// like any other nonexistent id: completely inert -- same game, same
// players map, no own property created, same Undo, same localSeq, same
// History, and no prototype of anything changed.

const INHERITED = ["toString", "constructor", "__proto__"] as const;

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const own = (id: string) => Object.prototype.hasOwnProperty.call(game().players, id);

// Object.prototype must never gain (or lose) a member through any command.
const PROTOTYPE_MEMBERS = Object.getOwnPropertyNames(Object.prototype).sort();
const expectPrototypesPristine = () => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTOTYPE_MEMBERS);
  expect(Object.getPrototypeOf(game().players)).toBe(Object.prototype);
  expect(({} as Record<string, unknown>).seat).toBeUndefined();
  expect(({} as Record<string, unknown>).name).toBeUndefined();
};
afterAll(() => expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTOTYPE_MEMBERS));

type Baseline = {
  game: StorytellerLobbyRecord;
  players: StorytellerLobbyRecord["players"];
  undoStack: StorytellerLobbyRecord[];
  localSeq: number;
  history: HistoryRecord[];
  playerKeys: string[];
};
const baseline = (): Baseline => ({
  game: game(), players: game().players, undoStack: state().undoStack, localSeq: state().localSeq,
  history: game().history, playerKeys: Object.keys(game().players),
});

/** An invalid PlayerId request was rejected before any mutation. */
function expectInert(before: Baseline, id: string) {
  expect(state().game).toBe(before.game);
  expect(game().players).toBe(before.players);
  expect(Object.keys(game().players)).toEqual(before.playerKeys);
  expect(own(id)).toBe(false);
  expect(state().undoStack).toBe(before.undoStack);
  expect(state().localSeq).toBe(before.localSeq);
  expect(game().history).toBe(before.history);
  expectPrototypesPristine();
}

/** A legitimate PlayerId request is exactly one genuine mutation. */
function expectOneMutation(before: Baseline, { undo = "push", history = 0 }: { undo?: "push" | "cleared"; history?: number } = {}) {
  expect(state().game).not.toBe(before.game);
  expect(state().localSeq).toBe(before.localSeq + 1);
  if (undo === "push") {
    expect(state().undoStack).toHaveLength(before.undoStack.length + 1);
    expect(state().undoStack.at(-1)).toEqual(before.game);
  } else {
    expect(state().undoStack).toEqual([]); // membership boundary
  }
  expect(game().history).toHaveLength(before.history.length + history);
  expectPrototypesPristine();
}

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});

/** Dealt, pre-Reveal Setup through real commands, with a queued pending
 * player and a real Undo entry, so "unchanged" is never trivially empty. */
function setupFixture() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (let i = 0; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  state().addToPendingQueue("uid-pending", "Pending");
  store.setState({ undoStack: [] });
  state().setNotes(game().seatOrder[0]!, "real undo entry");
}

/** Night 1 of the same game, with real History already recorded. */
function liveFixture() {
  setupFixture();
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
  state().setAlive(game().seatOrder[0]!, false);
  expect(game().history.length).toBeGreaterThan(0);
}

/** An occupied, evil Thief Traveler on a ready Setup fixture. */
function travelerFixture() {
  store.setState({ game: setupGame(standardRoles(5)), undoStack: [], localSeq: 0 });
  state().addPlayer("Traveler");
  const id = game().seatOrder.at(-1)!;
  expect(state().setIsTraveler(id, true).ok).toBe(true);
  state().assignRole(id, "thief");
  state().setTravelerAlignment(id, "evil");
  store.setState({ undoStack: [] });
  return id;
}

const imp = () => Object.values(game().players).find((p) => p.actualRole === "imp")!.id;

// ---------------------------------------------------------------------------
// 1. Exhaustive: every authoritative command taking a caller-supplied
//    PlayerId, for every inherited name, in Setup AND Live Play (Live Play
//    alone would hide Setup-only failures: History's own participant check
//    happens to refuse there).
// ---------------------------------------------------------------------------
const COMMANDS: [string, (id: PlayerId) => unknown][] = [
  ["renamePlayer", (id) => state().renamePlayer(id, "Mallory")],
  ["removePlayer", (id) => expect(state().removePlayer(id)).toBe(false)],
  ["unseatPlayer", (id) => expect(state().unseatPlayer(id)).toBe(false)],
  ["movePlayer", (id) => { state().movePlayer(id, "left"); state().movePlayer(id, "right"); }],
  ["assignPendingToSeat", (id) => expect(state().assignPendingToSeat("uid-pending", id)).toBe(false)],
  ["restoreSeatedMember", (id) => expect(state().restoreSeatedMember("uid-pending", id, "Pending", "pt-restored")).toBe(false)],
  ["assignRole", (id) => state().assignRole(id, "chef")],
  ["showAssignedRole", (id) => state().showAssignedRole(id)],
  ["setShownRole", (id) => state().setShownRole(id, "chef")],
  ["setShownAlignment", (id) => state().setShownAlignment(id, "evil")],
  ["setBehaviorMode", (id) => state().setBehaviorMode(id, "fake_demon_behavior")],
  ["setBluffs", (id) => state().setBluffs(id, ["chef"])],
  ["setFakeMinions", (id) => state().setFakeMinions(id, [])],
  ["setPrivateText", (id) => state().setPrivateText(id, "text")],
  ["setIsTraveler", (id) => expect(state().setIsTraveler(id, true).ok).toBe(false)],
  ["setTravelerAlignment", (id) => state().setTravelerAlignment(id, "evil")],
  ["setActualAlignment", (id) => state().setActualAlignment(id, "evil")],
  ["prepareTravelerDemon", (id) => state().prepareTravelerDemon(id)],
  ["completeTravelerInformation", (id) => state().completeTravelerInformation(id)],
  ["completeTravelerArrivalCheck", (id) => state().completeTravelerArrivalCheck(id)],
  ["exileTraveler", (id) => state().exileTraveler(id)],
  ["setAlive(false)", (id) => state().setAlive(id, false)],
  ["setAlive(true)", (id) => state().setAlive(id, true)],
  ["setGhostVote", (id) => state().setGhostVote(id, false)],
  ["setAbilityUsed", (id) => state().setAbilityUsed(id, true)],
  ["setStatus", (id) => state().setStatus(id, "poisoned", true)],
  ["addEffect", (id) => expect(state().addEffect(id, { type: "poisoned", lifetime: { kind: "manual" } })).toBeNull()],
  ["removeEffect", (id) => state().removeEffect(id, "manual:poisoned")],
  ["addReminder", (id) => expect(state().addReminder(id, { label: "Mark", lifetime: { kind: "manual" } })).toBeNull()],
  ["removeReminder", (id) => state().removeReminder(id, "r1")],
  ["recordInformationDelivery", (id) => expect(state().recordInformationDelivery(id, "chef-first-night", []).ok).toBe(false)],
  ["setNotes", (id) => state().setNotes(id, "notes")],
  ["swapSetupRoles(a)", (id) => expect(state().swapSetupRoles(id, game().seatOrder[1]!).ok).toBe(false)],
  ["swapSetupRoles(b)", (id) => expect(state().swapSetupRoles(game().seatOrder[1]!, id).ok).toBe(false)],
  ["replaceSetupRole", (id) => expect(state().replaceSetupRole(id, "monk").ok).toBe(false)],
];

describe.each([["Setup", setupFixture], ["Live Play", liveFixture]] as const)(
  "Phase 9R.4 (B8 remediation): inherited Object.prototype names are never players -- %s",
  (_phase, fixture) => {
    const rows = COMMANDS.flatMap(([name, run]) => INHERITED.map((id) => [name, id, run] as const));
    it.each(rows)("%s(%j) is completely inert", (_name, id, run) => {
      fixture();
      expect(own(id)).toBe(false);
      const before = baseline();
      expect(before.undoStack.length).toBe(1);
      run(id);
      expectInert(before, id);
    });
  },
);

describe("Phase 9R.4 (B8 remediation): inherited names inside a caller-supplied PlayerId LIST", () => {
  it.each(INHERITED)("setFakeMinions(realPlayer, [%j]) never stores an inherited name as a selected player", (id) => {
    setupFixture();
    const before = baseline();
    state().setFakeMinions(imp(), [id]);
    expectInert(before, id);
    expect(player(imp()).privateInfo).toBeUndefined();
  });

  // Phase 9R.4 (B8 remediation #2): originally asserted only that no player
  // record was minted; setSeatOrder now accepts exact permutations only, so
  // the same call is fully inert.
  it.each(INHERITED)("setSeatOrder containing %j is completely inert and never mints a player record for it", (id) => {
    setupFixture();
    const before = baseline();
    state().setSeatOrder([id, ...game().seatOrder]);
    expectInert(before, id);
    expect(Object.keys(game().players)).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Phase 9R.4 (Astra A): movePlayer() must prove its target is a real own
// player BEFORE consulting seatOrder. A recovered seatOrder can already
// carry a string with no player record behind it (repairing that is a
// separate, out-of-scope recovery package); moving such a string must be
// inert rather than reordering authoritative seats.
// ---------------------------------------------------------------------------
describe.each([["Setup", setupFixture], ["Live Play", liveFixture]] as const)(
  "Phase 9R.4 (Astra A): movePlayer ignores a seatOrder entry with no own player record -- %s",
  (_phase, fixture) => {
    /** Malformed recovered state: `bad` sits at index 3 of seatOrder, with
     * real neighbours on both sides, but has no own player record. */
    function malformed(bad: string) {
      fixture();
      const order = [...game().seatOrder];
      order.splice(3, 0, bad);
      store.setState({ game: { ...game(), seatOrder: order } });
      expect(own(bad)).toBe(false);
    }

    it.each(["missing-player", ...INHERITED])("movePlayer(%j, left/right) is completely inert", (bad) => {
      malformed(bad);
      const order = [...game().seatOrder];
      const seatsBefore = seats();
      const before = baseline();
      state().movePlayer(bad, "left");
      state().movePlayer(bad, "right");
      expectInert(before, bad);
      expect(game().seatOrder).toEqual(order);
      expect(seats()).toEqual(seatsBefore);
    });

    it("contrast: moving a genuine player in that same malformed order still mutates exactly once", () => {
      malformed("missing-player");
      const [a, b] = game().seatOrder;
      const before = baseline();
      state().movePlayer(a!, "right");
      expectOneMutation(before);
      expect(game().seatOrder.slice(0, 2)).toEqual([b, a]);
      game().seatOrder.forEach((id, idx) => { if (own(id)) expect(player(id).seat).toBe(idx); });
    });

    it("contrast: a genuine move in a well-formed order swaps neighbours and renumbers every seat", () => {
      fixture();
      const order = [...game().seatOrder];
      const before = baseline();
      state().movePlayer(order[4]!, "left");
      expectOneMutation(before);
      [order[3], order[4]] = [order[4]!, order[3]!];
      expect(game().seatOrder).toEqual(order);
      order.forEach((id, idx) => expect(player(id).seat).toBe(idx));
    });

    it("a real own player that is not in seatOrder stays inert (existing behavior)", () => {
      fixture();
      const stray = { ...player(game().seatOrder[1]!), id: "stray", seat: 99 };
      store.setState({ game: { ...game(), players: { ...game().players, stray } } });
      const before = baseline();
      state().movePlayer("stray", "left");
      state().movePlayer("stray", "right");
      expectInert(before, "missing-player");
    });
  },
);

// ---------------------------------------------------------------------------
// Phase 9R.4 (B8 remediation #2): setSeatOrder() only REORDERS. Its input
// must be an exact permutation of the current authoritative seat ids; any
// other order is rejected before renumbering, Undo, or set().
// ---------------------------------------------------------------------------
const seats = () => Object.fromEntries(Object.entries(game().players).map(([id, p]) => [id, p.seat]));

describe.each([["Setup", setupFixture], ["Live Play", liveFixture]] as const)(
  "Phase 9R.4 (B8 remediation #2): setSeatOrder accepts only an exact permutation of the current seats -- %s",
  (_phase, fixture) => {
    const replaceLast = (o: PlayerId[], id: string) => [...o.slice(0, -1), id];
    const INVALID: [string, (o: PlayerId[]) => PlayerId[], string][] = [
      ...INHERITED.flatMap((id): [string, (o: PlayerId[]) => PlayerId[], string][] => [
        [`inherited ${JSON.stringify(id)} appended (extra slot)`, (o) => [...o, id], id],
        [`inherited ${JSON.stringify(id)} replacing a seat (same length)`, (o) => replaceLast(o, id), id],
      ]),
      ['unknown "missing-player" appended (extra slot)', (o) => [...o, "missing-player"], "missing-player"],
      ['unknown "missing-player" replacing a seat (same length)', (o) => replaceLast(o, "missing-player"), "missing-player"],
      ["a duplicate existing id replacing another (duplicate + omission, same length)", (o) => [o[0]!, o[1]!, o[1]!, ...o.slice(3)], "missing-player"],
      ["a duplicate existing id appended (extra slot)", (o) => [...o, o[0]!], "missing-player"],
      ["one existing id omitted", (o) => o.slice(0, -1), "missing-player"],
      ["an empty order", () => [], "missing-player"],
    ];

    it.each(INVALID)("%s is completely inert", (_label, build, probe) => {
      fixture();
      const order = [...game().seatOrder];
      const seatsBefore = seats();
      const before = baseline();
      expect(before.undoStack.length).toBe(1);
      state().setSeatOrder(build(order));
      expectInert(before, probe);
      expect(game().seatOrder).toBe(before.game.seatOrder);
      expect(game().seatOrder).toEqual(order);
      expect(seats()).toEqual(seatsBefore);
    });

    it("an own player record that is not currently seated can never be ordered into a seat (seat creation belongs to other commands)", () => {
      fixture();
      const stray = { ...player(game().seatOrder[1]!), id: "stray", seat: 99 };
      store.setState({ game: { ...game(), players: { ...game().players, stray } } }); // malformed fixture: record without a seat
      const order = [...game().seatOrder];
      const before = baseline();
      state().setSeatOrder(replaceLast(order, "stray"));
      expectInert(before, "missing-player");
      expect(game().seatOrder).toEqual(order);
    });

    it("contrast: a real reorder (the Grimoire ring-drag shape) mutates exactly once and renumbers every seat", () => {
      fixture();
      const order = [...game().seatOrder];
      const moved = order.splice(1, 1)[0]!;
      order.splice(4, 0, moved);
      const before = baseline();
      state().setSeatOrder(order);
      expectOneMutation(before);
      expect(game().seatOrder).toEqual(order);
      order.forEach((id, idx) => expect(player(id).seat).toBe(idx));
    });

    it("contrast: the exact current order with correct seat numbers is a true no-op", () => {
      fixture();
      const before = baseline();
      state().setSeatOrder([...game().seatOrder]);
      expectInert(before, "missing-player");
    });

    it("contrast: the exact current order with a corrupted seat number is still a real repair", () => {
      fixture();
      const id = game().seatOrder[2]!;
      store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), seat: 4 } } } });
      const before = baseline();
      state().setSeatOrder([...game().seatOrder]);
      expectOneMutation(before);
      expect(player(id).seat).toBe(2);
      game().seatOrder.forEach((pid, idx) => expect(player(pid).seat).toBe(idx));
    });
  },
);

// ---------------------------------------------------------------------------
// 2. The required representatives: inherited ids inert, then IMMEDIATELY a
//    legitimate PlayerId through the same command still works exactly once.
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8 remediation): representative families -- inherited ids inert, valid player contrast", () => {
  function inertThenValid(fixture: () => void, run: (id: PlayerId) => void, valid: () => PlayerId,
    expectation: Parameters<typeof expectOneMutation>[1] = {}, check?: (id: PlayerId) => void) {
    fixture();
    for (const id of INHERITED) {
      const before = baseline();
      run(id);
      expectInert(before, id);
    }
    const id = valid();
    const before = baseline();
    run(id);
    expectOneMutation(before, expectation);
    check?.(id);
  }
  const first = () => game().seatOrder[1]!;

  it("1. renamePlayer", () => inertThenValid(setupFixture, (id) => state().renamePlayer(id, "Mallory"), first, {},
    (id) => expect(player(id).name).toBe("Mallory")));

  it("2. setAlive -- kill in Setup; kill and revive with Live History", () => {
    inertThenValid(setupFixture, (id) => state().setAlive(id, false), first, {}, (id) => expect(player(id).alive).toBe(false));
    inertThenValid(liveFixture, (id) => state().setAlive(id, false), first, { history: 1 }, (id) => {
      expect(player(id).alive).toBe(false);
      expect(game().history.at(-1)).toMatchObject({ category: "life", change: { from: { alive: true }, to: { alive: false } } });
    });
    const id = first();
    for (const bad of INHERITED) {
      const before = baseline();
      state().setAlive(bad, true);
      expectInert(before, bad);
    }
    const before = baseline();
    state().setAlive(id, true);
    expectOneMutation(before, { history: 1 });
    expect(player(id).alive).toBe(true);
  });

  it("3. setShownAlignment -- never reaches packet invalidation for an inherited id", () =>
    // Deal is random: contrast with a player currently shown "good", so the
    // valid call is a genuine change rather than the accepted B8 no-op.
    inertThenValid(setupFixture, (id) => state().setShownAlignment(id, "evil"),
      () => Object.values(game().players).find((p) => p.shownAlignment === "good")!.id, {},
      (id) => expect(player(id).shownAlignment).toBe("evil")));

  it("4. setBehaviorMode -- never reaches private-info pruning for an inherited id", () =>
    inertThenValid(setupFixture, (id) => state().setBehaviorMode(id, "fake_demon_behavior"), first, {},
      (id) => expect(player(id).behaviorMode).toBe("fake_demon_behavior")));

  it("5. setAbilityUsed", () => inertThenValid(setupFixture, (id) => state().setAbilityUsed(id, true), first, {},
    (id) => expect(player(id).abilityUsed).toBe(true)));

  it("6. setNotes", () => inertThenValid(setupFixture, (id) => state().setNotes(id, "watch"), first, {},
    (id) => expect(player(id).stNotes).toBe("watch")));

  it("7. addEffect -- no Effect and no History for an inherited id; a real Effect in Live Play records History", () =>
    inertThenValid(liveFixture, (id) => { state().addEffect(id, { id: "e1", type: "poisoned", lifetime: { kind: "manual" } }); },
      first, { history: 1 }, (id) => expect(player(id).effects.map((e) => e.id)).toEqual(["e1"])));

  it("8. addReminder -- no Reminder and no History for an inherited id; a real Reminder in Live Play records History", () =>
    inertThenValid(liveFixture, (id) => { state().addReminder(id, { id: "r1", label: "Mark", lifetime: { kind: "manual" } }); },
      first, { history: 1 }, (id) => expect(player(id).reminders.map((r) => r.id)).toEqual(["r1"])));

  it("9. Traveler: completeTravelerInformation -- prototype values never pass Traveler checks", () => {
    let traveler = "";
    inertThenValid(() => { traveler = travelerFixture(); }, (id) => state().completeTravelerInformation(id), () => traveler, {},
      (id) => expect(player(id).travelerArrival?.demonInfoComplete).toBe(true));
  });

  it("10. Removal: unseatPlayer and removePlayer never treat an inherited value as an occupant", () => {
    inertThenValid(setupFixture, (id) => { state().unseatPlayer(id); }, first, { undo: "cleared" },
      (id) => expect(player(id).isEmpty).toBe(true));
    const removed = game().seatOrder[2]!;
    for (const bad of INHERITED) {
      const before = baseline();
      expect(state().removePlayer(bad)).toBe(false);
      expectInert(before, bad);
    }
    const plan = game().plannedPlayerCount;
    const before = baseline();
    expect(state().removePlayer(removed)).toBe(true);
    expectOneMutation(before, { undo: "cleared" });
    expect(own(removed)).toBe(false);
    expect(game().plannedPlayerCount).toBe(plan - 1);
  });
});

// ---------------------------------------------------------------------------
// 3. "__proto__" specifically: no record, no prototype change, no pollution.
// ---------------------------------------------------------------------------
describe('Phase 9R.4 (B8 remediation): "__proto__" is rejected before any write', () => {
  it("across every command, game.players keeps Object.prototype as its prototype and gains no own __proto__ key, and no object gains player fields", () => {
    setupFixture();
    const before = baseline();
    for (const [, run] of COMMANDS) run("__proto__");
    state().setFakeMinions(imp(), ["__proto__"]);
    expectInert(before, "__proto__");
    expect(Object.getOwnPropertyNames(game().players)).not.toContain("__proto__");
    for (const field of ["seat", "name", "alive", "stNotes", "abilityUsed", "effects", "reminders", "actualRole"])
      expect(({} as Record<string, unknown>)[field]).toBeUndefined();
  });
});
