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

  it.each(INHERITED)("setSeatOrder containing %j never mints a player record for it (seat-order structure itself is out of scope)", (id) => {
    setupFixture();
    state().setSeatOrder([id, ...game().seatOrder]);
    expect(own(id)).toBe(false);
    expect(Object.keys(game().players)).toHaveLength(7);
    expectPrototypesPristine();
  });
});

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
