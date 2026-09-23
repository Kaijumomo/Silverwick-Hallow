import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import type { HistoryRecord, PlayerId, STPlayerRecord, StorytellerLobbyRecord } from "./types";

// Phase 9R.4 (B8): a rejected command, or one whose complete intended result
// equals Current State, must leave EVERYTHING untouched -- the same game
// reference, the same Undo stack reference, the same localSeq, the same
// History. A genuine mutation right afterward must still change state,
// push exactly one Undo entry (where the command supports Undo), and advance
// localSeq exactly once -- the contrast that proves a guard never simply
// disabled its command. Phase 9R.4 (B9): the bulk setReminders() setter is
// gone; addReminder/removeReminder are the only Reminder paths.

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;

type Baseline = {
  game: StorytellerLobbyRecord;
  undoStack: StorytellerLobbyRecord[];
  localSeq: number;
  history: HistoryRecord[];
};
const baseline = (): Baseline => ({ game: game(), undoStack: state().undoStack, localSeq: state().localSeq, history: game().history });

/** Invalid request or true no-op: nothing moved at all. */
function expectInert(before: Baseline) {
  expect(state().game).toBe(before.game);
  expect(state().undoStack).toBe(before.undoStack);
  expect(state().localSeq).toBe(before.localSeq);
  expect(state().game!.history).toBe(before.history);
}

/** Genuine mutation: new state, localSeq + 1, exactly one Undo entry
 * snapshotting the prior state (or none, for a command that never records
 * Undo), and exactly `history` new History Records. */
function expectOneMutation(before: Baseline, { undo = true, history = 0 } = {}) {
  expect(state().game).not.toBe(before.game);
  expect(state().localSeq).toBe(before.localSeq + 1);
  if (undo) {
    expect(state().undoStack).toHaveLength(before.undoStack.length + 1);
    expect(state().undoStack.at(-1)).toEqual(before.game);
  } else {
    expect(state().undoStack).toBe(before.undoStack);
  }
  expect(state().game!.history).toHaveLength(before.history.length + history);
}

/** Fixture-only field patch through the raw zustand setter (no localSeq,
 * no Undo) -- used to stage state no command writes directly, e.g. a
 * published packet. */
function patch(id: PlayerId, fields: Partial<STPlayerRecord>) {
  store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), ...fields } } } });
}

/** Keeps Undo well under UNDO_LIMIT so depth assertions stay exact. */
const clearUndo = () => store.setState({ undoStack: [] });

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

/** A real-command 7-player Setup game, dealt but not yet revealed. */
function dealtGame(count = 7) {
  state().newGame(setupScript.id, { plannedPlayerCount: count, plannedTravelerCount: 0 });
  for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(count));
  expect(state().dealRolePool().ok).toBe(true);
  clearUndo();
}

/** Reveals and begins Night 1 through real commands (standardRoles(7) has
 * no concealed role, so every player can simply be shown their own). */
function goLive() {
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  clearUndo();
}

const holderOf = (role: string): PlayerId => Object.values(game().players).find((p) => p.actualRole === role)!.id;
const seat = (i: number): PlayerId => game().seatOrder[i]!;

/** An occupied Traveler added to a ready Setup fixture (phase optional). */
function travelerGame(role: string, alignment: "good" | "evil", over: Partial<StorytellerLobbyRecord> = {}) {
  store.setState({ game: setupGame(standardRoles(5)), undoStack: [], localSeq: 0 });
  state().addPlayer("Traveler");
  const id = game().seatOrder.at(-1)!;
  expect(state().setIsTraveler(id, true).ok).toBe(true);
  state().assignRole(id, role);
  state().setTravelerAlignment(id, alignment);
  store.setState({ game: { ...game(), ...over } });
  clearUndo();
  return id;
}

// ---------------------------------------------------------------------------
// 1. Player-target invalidity
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): a player-targeted command naming a missing PlayerId is completely inert", () => {
  const MISSING = "no-such-player";
  const commands: [string, () => void][] = [
    ["setShownAlignment", () => state().setShownAlignment(MISSING, "evil")],
    ["setBehaviorMode", () => state().setBehaviorMode(MISSING, "fake_demon_behavior")],
    ["renamePlayer", () => state().renamePlayer(MISSING, "Mallory")],
    ["setAbilityUsed", () => state().setAbilityUsed(MISSING, true)],
    ["setNotes", () => state().setNotes(MISSING, "notes")],
    ["setShownRole", () => state().setShownRole(MISSING, "chef")],
    ["setBluffs", () => state().setBluffs(MISSING, ["chef"])],
    ["setFakeMinions", () => state().setFakeMinions(MISSING, [])],
    ["setPrivateText", () => state().setPrivateText(MISSING, "text")],
    ["prepareTravelerDemon", () => state().prepareTravelerDemon(MISSING)],
    ["completeTravelerInformation", () => state().completeTravelerInformation(MISSING)],
    ["completeTravelerArrivalCheck", () => state().completeTravelerArrivalCheck(MISSING)],
  ];

  it.each(commands)("%s(missing id) during Live Play leaves game, Undo, localSeq and History untouched", (_name, run) => {
    dealtGame();
    goLive();
    state().setAlive(seat(0), false); // real Undo + History, so "unchanged" is non-trivial
    const before = baseline();
    expect(before.undoStack.length).toBe(1);
    expect(before.history.length).toBeGreaterThan(0);
    run();
    expectInert(before);
  });

  it("setShownAlignment: the missing-id reproduction is inert, and the same call on a real player is exactly one mutation", () => {
    dealtGame();
    const id = seat(0);
    const before = baseline();
    state().setShownAlignment(MISSING, "evil");
    expectInert(before);

    const contrast = baseline();
    state().setShownAlignment(id, player(id).shownAlignment === "evil" ? "good" : "evil");
    expectOneMutation(contrast);
  });

  it("removePendingPlayer(uid never queued) no longer replaces the game or advances localSeq; removing a queued uid still does", () => {
    dealtGame();
    const before = baseline();
    state().removePendingPlayer("never-queued");
    state().removePendingPlayer("toString"); // inherited key: still not queued
    expectInert(before);

    state().addToPendingQueue("uid-zed", "Zed");
    const contrast = baseline();
    state().removePendingPlayer("uid-zed");
    expectOneMutation(contrast, { undo: false });
    expect(game().pendingPlayers).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 2. Scalar no-ops
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): scalar setters with the already-current value are completely inert", () => {
  it("setAbilityUsed(id, currentValue)", () => {
    dealtGame();
    goLive();
    const id = seat(0);
    expect(player(id).abilityUsed).toBe(false);
    const before = baseline();
    state().setAbilityUsed(id, false);
    expectInert(before);

    const contrast = baseline();
    state().setAbilityUsed(id, true);
    expectOneMutation(contrast);
    expect(player(id).abilityUsed).toBe(true);
    const again = baseline();
    state().setAbilityUsed(id, true);
    expectInert(again);
  });

  it("setNotes(id, currentNotes)", () => {
    dealtGame();
    const id = seat(0);
    const before = baseline();
    state().setNotes(id, "");
    expectInert(before);

    const contrast = baseline();
    state().setNotes(id, "watch this one");
    expectOneMutation(contrast);
    const again = baseline();
    state().setNotes(id, "watch this one");
    expectInert(again);
  });

  it("renamePlayer with a name that normalizes (trim, 20-character cap) to the stored one", () => {
    dealtGame();
    const id = seat(0);
    const before = baseline();
    state().renamePlayer(id, "  Player 0  ");
    expectInert(before);

    const contrast = baseline();
    state().renamePlayer(id, "A very long player name indeed");
    expectOneMutation(contrast);
    expect(player(id).name).toBe("A very long player n");
    const again = baseline();
    state().renamePlayer(id, "A very long player name, truncated identically");
    expectInert(again);
  });

  it("setPlannedPlayerCount(currentCount) before any seat exists", () => {
    state().newGame(setupScript.id);
    state().setPlannedPlayerCount(8);
    const before = baseline();
    state().setPlannedPlayerCount(8);
    expectInert(before);

    const contrast = baseline();
    state().setPlannedPlayerCount(9);
    expectOneMutation(contrast);
    expect(game().plannedPlayerCount).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 3. Phase no-ops
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): phase commands", () => {
  it("setPhase(currentPhase) is inert and still reports success; a real phase change is one mutation", () => {
    dealtGame();
    const setup = baseline();
    expect(state().setPhase("setup").ok).toBe(true);
    expectInert(setup);

    goLive();
    const night = baseline();
    expect(state().setPhase("night")).toEqual({ ok: true });
    expectInert(night);

    const contrast = baseline();
    expect(state().setPhase("day").ok).toBe(true);
    expectOneMutation(contrast);
    expect(game().phase).toBe("day");
  });

  it("the ended-game restriction is preserved: leaving 'ended' is refused, re-ending is inert, both with zero mutation", () => {
    dealtGame();
    goLive();
    const contrast = baseline();
    expect(state().setPhase("ended").ok).toBe(true);
    expectOneMutation(contrast);

    const ended = baseline();
    expect(state().setPhase("day")).toEqual({ ok: false, message: "This game has ended. Create a new setup to play again." });
    expect(state().setPhase("setup").ok).toBe(false);
    expect(state().setPhase("ended").ok).toBe(true);
    expectInert(ended);
  });

  it("advancePhase on an ended game is refused with zero mutation (it used to commit an identical game); advancing a live game still mutates once", () => {
    dealtGame();
    goLive();
    const contrast = baseline();
    expect(state().advancePhase().ok).toBe(true);
    expectOneMutation(contrast);
    expect(game()).toMatchObject({ phase: "day", day: 1 });

    expect(state().setPhase("ended").ok).toBe(true);
    const ended = baseline();
    expect(state().advancePhase()).toEqual({ ok: false, message: "This game has ended. Create a new setup to play again." });
    expectInert(ended);
  });
});

// ---------------------------------------------------------------------------
// 4. Collection normalization no-ops
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): collections are compared in their canonical stored form", () => {
  const [f1, f2] = [FABLED[0]!.id, FABLED[1]!.id];
  const [l1, l2] = [LORICS[0]!.id, LORICS[1]!.id];

  it("setFabled: duplicates and invalid ids that normalize to the stored list are inert; a reorder is a real change", () => {
    dealtGame();
    const empty = baseline();
    state().setFabled(["not-a-fabled"]);
    expectInert(empty);

    const first = baseline();
    state().setFabled([f1, f2]);
    expectOneMutation(first);
    const before = baseline();
    state().setFabled([f1, "not-a-fabled", f1, f2, f2]);
    expectInert(before);

    const contrast = baseline();
    state().setFabled([f2, f1]);
    expectOneMutation(contrast);
    expect(game().fabled).toEqual([f2, f1]);
  });

  it("setLorics: same normalization rule", () => {
    dealtGame();
    state().setLorics([l1, l2]);
    const before = baseline();
    state().setLorics([l1, l1, "bogus", l2]);
    expectInert(before);

    const contrast = baseline();
    state().setLorics([l1]);
    expectOneMutation(contrast);
    expect(game().lorics).toEqual([l1]);
  });

  it("setBluffs: falsy entries and the 3-bluff cap that canonicalize to the stored bluffs are inert; clearing nothing is inert", () => {
    dealtGame();
    const imp = holderOf("imp");
    const none = baseline();
    state().setBluffs(imp, []);
    state().setBluffs(imp, ["", ""]);
    expectInert(none);
    expect(player(imp).privateInfo).toBeUndefined();

    state().setBluffs(imp, ["chef", "empath", "monk"]);
    const before = baseline();
    state().setBluffs(imp, ["", "chef", "empath", "monk", "undertaker"]);
    expectInert(before);

    const reorder = baseline();
    state().setBluffs(imp, ["empath", "chef", "monk"]);
    expectOneMutation(reorder); // stored order is significant
    const clear = baseline();
    state().setBluffs(imp, []);
    expectOneMutation(clear);
    expect(player(imp).privateInfo).toBeUndefined();
  });

  it("setFakeMinions: duplicates, self, unknown and empty-seat ids filtered to the stored selection are inert", () => {
    dealtGame();
    const imp = holderOf("imp");
    const [a, b] = game().seatOrder.filter((id) => id !== imp);
    state().setFakeMinions(imp, [a!, b!]);
    const before = baseline();
    state().setFakeMinions(imp, [a!, a!, imp, "no-such-player", b!, b!]);
    expectInert(before);

    const contrast = baseline();
    state().setFakeMinions(imp, [b!]);
    expectOneMutation(contrast);
    expect(player(imp).privateInfo?.fakeMinions).toEqual([b]);
    state().setFakeMinions(imp, []);
    const none = baseline();
    state().setFakeMinions(imp, ["no-such-player"]);
    expectInert(none);
  });

  it("setSeatOrder: the exact current, correctly numbered order is inert; a reorder, or re-numbering malformed seats, is real", () => {
    dealtGame();
    const before = baseline();
    state().setSeatOrder([...game().seatOrder]);
    expectInert(before);

    const reversed = [...game().seatOrder].reverse();
    const contrast = baseline();
    state().setSeatOrder(reversed);
    expectOneMutation(contrast);
    expect(game().seatOrder).toEqual(reversed);

    // Same order, but a seat number out of step with it: the command's
    // complete result (re-numbering) differs from Current State.
    patch(seat(0), { seat: 5 });
    const repair = baseline();
    state().setSeatOrder([...game().seatOrder]);
    expectOneMutation(repair);
    expect(player(seat(0)).seat).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Text normalization no-op
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): setPrivateText compares the normalized stored text", () => {
  it("blank text with nothing stored, the stored text again, and a longer text truncating to the same 4000 characters are all inert", () => {
    dealtGame();
    const id = seat(0);
    const blank = baseline();
    state().setPrivateText(id, "");
    state().setPrivateText(id, "   \n ");
    expectInert(blank);
    expect(player(id).privateInfo).toBeUndefined();

    const first = baseline();
    state().setPrivateText(id, "You learn that 1 of them is the Imp.");
    expectOneMutation(first);
    const same = baseline();
    state().setPrivateText(id, "You learn that 1 of them is the Imp.");
    expectInert(same);

    const long = "x".repeat(4000);
    state().setPrivateText(id, long);
    const truncated = baseline();
    state().setPrivateText(id, long + " and more that is cut off");
    expectInert(truncated);
    expect(player(id).privateInfo?.extraText).toBe(long);

    const contrast = baseline();
    state().setPrivateText(id, "  ");
    expectOneMutation(contrast);
    expect(player(id).privateInfo?.extraText).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Commands whose same input can still be a real dependent-state mutation
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): identity/perception commands compare their COMPLETE intended result", () => {
  it("setShownRole(current role) is inert only when nothing would be reset; clearing an alignment override, private info, or a published packet is still a mutation", () => {
    dealtGame();
    const id = holderOf("chef");
    // Deal stores an explicit shownAlignment; re-showing resets it to the
    // derived null -- a real change the first time, inert the second.
    const reset = baseline();
    state().setShownRole(id, "chef");
    expectOneMutation(reset);
    expect(player(id).shownAlignment).toBeNull();
    const clean = baseline();
    state().setShownRole(id, "chef");
    expectInert(clean);

    state().setShownAlignment(id, "evil");
    const override = baseline();
    state().setShownRole(id, "chef");
    expectOneMutation(override);
    expect(player(id).shownAlignment).toBeNull();

    state().setPrivateText(id, "stale information");
    const info = baseline();
    state().setShownRole(id, "chef");
    expectOneMutation(info);
    expect(player(id).privateInfo).toBeUndefined();

    patch(id, { publishedPacket: { id: "sent", payload: { shownRole: "chef", shownAlignment: "good" } } });
    const packet = baseline();
    state().setShownRole(id, "chef");
    expectOneMutation(packet);
    expect(player(id).publishedPacket).toBeUndefined();

    const contrast = baseline();
    state().setShownRole(id, "empath");
    expectOneMutation(contrast);
    expect(player(id).shownRole).toBe("empath");
  });

  it("setShownAlignment(current alignment) is inert and manufactures no packet invalidation; a real change still invalidates", () => {
    dealtGame();
    const id = holderOf("chef");
    state().setShownAlignment(id, "evil");
    patch(id, { publishedPacket: { id: "sent", payload: { shownRole: "chef", shownAlignment: "evil" } } });
    const epoch = player(id).packetEpoch;
    const before = baseline();
    state().setShownAlignment(id, "evil");
    expectInert(before);
    expect(player(id).packetEpoch).toBe(epoch);
    expect(player(id).publishedPacket).toBeDefined();

    const contrast = baseline();
    state().setShownAlignment(id, null);
    expectOneMutation(contrast);
    expect(player(id).packetEpoch).not.toBe(epoch);
    expect(player(id).publishedPacket).toBeUndefined();
  });

  it("setBehaviorMode(current mode) is inert only when pruning removes nothing; stale inapplicable private info makes it a real mutation", () => {
    dealtGame();
    const id = holderOf("chef");
    const before = baseline();
    state().setBehaviorMode(id, "normal");
    expectInert(before);

    // A normal Chef can never hold bluffs: re-applying the same mode prunes them.
    patch(id, { privateInfo: { bluffs: ["empath"] } });
    const stale = baseline();
    state().setBehaviorMode(id, "normal");
    expectOneMutation(stale);
    expect(player(id).privateInfo).toBeUndefined();

    const contrast = baseline();
    state().setBehaviorMode(id, "fake_demon_behavior");
    expectOneMutation(contrast);
    expect(player(id).behaviorMode).toBe("fake_demon_behavior");
  });
});

// ---------------------------------------------------------------------------
// 7. Night-step no-ops
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): night progress", () => {
  it("setNightStepStatus with the stored status is inert; an ABSENT key is never 'already current' (storing it is real)", () => {
    dealtGame();
    goLive();
    const absent = baseline();
    state().setNightStepStatus(1, "manual:a", "pending");
    expectOneMutation(absent);
    expect(game().nightProgress["1:manual:a"]).toEqual({ status: "pending", notes: "" });

    const same = baseline();
    state().setNightStepStatus(1, "manual:a", "pending");
    expectInert(same);

    const contrast = baseline();
    state().setNightStepStatus(1, "manual:a", "done");
    expectOneMutation(contrast);
    const again = baseline();
    state().setNightStepStatus(1, "manual:a", "done");
    expectInert(again);
  });

  it("setNightStepStatus on a Traveler's first-night step is inert only when the arrival record would not change either", () => {
    const t = travelerGame("apprentice", "good", { phase: "night", day: 1, setupRolesDealt: true, setupRolesRevealed: true });
    const step = `p:${t}:apprentice`;
    const done = baseline();
    state().setNightStepStatus(1, step, "done");
    expectOneMutation(done);
    expect(player(t).travelerArrival).toMatchObject({ firstNightComplete: true, completedAtNight: 1 });

    const same = baseline();
    state().setNightStepStatus(1, step, "done");
    expectInert(same);

    const contrast = baseline();
    state().setNightStepStatus(1, step, "pending");
    expectOneMutation(contrast);
    expect(player(t).travelerArrival?.firstNightComplete).toBe(false);
  });

  it("setNightStepNotes with the stored notes is inert (it never records Undo, but used to advance localSeq); creating a custom step is real", () => {
    dealtGame();
    goLive();
    // "Add custom night step" is exactly this call: an absent key, empty notes.
    const create = baseline();
    state().setNightStepNotes(1, "manual:custom", "");
    expectOneMutation(create, { undo: false });
    expect(game().nightProgress).toHaveProperty(["1:manual:custom"]);

    const same = baseline();
    state().setNightStepNotes(1, "manual:custom", "");
    expectInert(same);

    const contrast = baseline();
    state().setNightStepNotes(1, "manual:custom", "Wake the Gossip's target");
    expectOneMutation(contrast, { undo: false });
    const again = baseline();
    state().setNightStepNotes(1, "manual:custom", "Wake the Gossip's target");
    expectInert(again);
  });

  it("clearNightProgress(day) with nothing recorded for that night is inert; with a step, or a Traveler first night completed on it, it is real", () => {
    dealtGame();
    goLive();
    state().setNightStepStatus(1, "manual:a", "done");
    const nothing = baseline();
    state().clearNightProgress(2);
    expectInert(nothing);

    const contrast = baseline();
    state().clearNightProgress(1);
    expectOneMutation(contrast);
    expect(game().nightProgress).toEqual({});
    const cleared = baseline();
    state().clearNightProgress(1);
    expectInert(cleared);
  });

  it("clearNightProgress(day) still resets a Traveler first night completed on that day even with no step key left", () => {
    const t = travelerGame("apprentice", "good", { phase: "night", day: 1, setupRolesDealt: true, setupRolesRevealed: true });
    state().setNightStepStatus(1, `p:${t}:apprentice`, "done");
    store.setState({ game: { ...game(), nightProgress: {} } });
    const before = baseline();
    state().clearNightProgress(1);
    expectOneMutation(before);
    expect(player(t).travelerArrival).toMatchObject({ firstNightComplete: false });
    expect(player(t).travelerArrival).not.toHaveProperty("completedAtNight");
  });
});

// ---------------------------------------------------------------------------
// 8. Completion no-ops (Travelers)
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): repeated Traveler completion commands are inert once complete", () => {
  it("prepareTravelerDemon: the first preparation is one mutation, re-preparing the same Demon is inert", () => {
    const t = travelerGame("thief", "evil");
    const contrast = baseline();
    state().prepareTravelerDemon(t);
    expectOneMutation(contrast);
    expect(player(t).privateInfo).toEqual({ travelerDemon: "p4" });

    const again = baseline();
    state().prepareTravelerDemon(t);
    expectInert(again);
  });

  it("completeTravelerInformation: once, then inert; an ineligible (good) Traveler is inert from the start", () => {
    const t = travelerGame("thief", "evil");
    const contrast = baseline();
    state().completeTravelerInformation(t);
    expectOneMutation(contrast);
    expect(player(t).travelerArrival?.demonInfoComplete).toBe(true);

    const again = baseline();
    state().completeTravelerInformation(t);
    state().completeTravelerInformation(t);
    expectInert(again);

    const good = travelerGame("thief", "good");
    const ineligible = baseline();
    state().completeTravelerInformation(good);
    expectInert(ineligible);
  });

  it("completeTravelerArrivalCheck: once, then inert; a Traveler with no arrival check is inert from the start", () => {
    const gnome = travelerGame("gnome", "good");
    const contrast = baseline();
    state().completeTravelerArrivalCheck(gnome);
    expectOneMutation(contrast);
    expect(player(gnome).travelerArrival?.arrivalCheckComplete).toBe(true);

    const again = baseline();
    state().completeTravelerArrivalCheck(gnome);
    expectInert(again);

    const thief = travelerGame("thief", "good");
    const ineligible = baseline();
    state().completeTravelerArrivalCheck(thief);
    expectInert(ineligible);
  });
});

// ---------------------------------------------------------------------------
// 9. Setup commands whose complete result can be provably identical
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): Setup commands skip only a provably identical complete result", () => {
  it("setRolePool: an identical pool with no Deal/Reveal evidence left to clear is inert; the same pool that WOULD clear Deal evidence is real", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 7 });
    const pool = standardRoles(7);
    const first = baseline();
    state().setRolePool(pool);
    expectOneMutation(first); // also records setupRolesDealt/Revealed: false
    const same = baseline();
    state().setRolePool([...pool]);
    expectInert(same);

    const contrast = baseline();
    state().setRolePool(pool.slice(0, 6));
    expectOneMutation(contrast);

    // Same pool again, but with Deal evidence present: the whole result
    // (clearing that evidence) differs, so this is not a no-op.
    store.setState({ game: { ...game(), rolePool: pool, setupRolesDealt: true } });
    const evidence = baseline();
    state().setRolePool(pool);
    expectOneMutation(evidence);
    expect(game().setupRolesDealt).toBe(false);
  });

  it("setRolePool([]) after Deal (empty pool already stored, nothing to clear) is inert", () => {
    dealtGame();
    const before = baseline();
    state().setRolePool([]);
    expectInert(before);
  });

  it("applyEditedBag with the current bag reassigns nobody and is inert; a real bag edit is one mutation", () => {
    dealtGame();
    const bag = game().seatOrder.map((id) => player(id).actualRole);
    const before = baseline();
    expect(state().applyEditedBag([...bag].reverse())).toEqual({ ok: true });
    expectInert(before);

    const contrast = baseline();
    expect(state().applyEditedBag(bag.map((r) => (r === "chef" ? "monk" : r))).ok).toBe(true);
    expectOneMutation(contrast);
    expect(player(holderOf("monk")).actualRole).toBe("monk");
  });

  it("replaceSetupRole with the current role is inert only when the player already holds exactly that fresh assignment", () => {
    dealtGame();
    const id = holderOf("chef");
    const before = baseline();
    expect(state().replaceSetupRole(id, "chef")).toEqual({ ok: true });
    expectInert(before);

    // Deceptive configuration makes the same-role override a real reset.
    state().setShownAlignment(id, "evil");
    const reset = baseline();
    expect(state().replaceSetupRole(id, "chef").ok).toBe(true);
    expectOneMutation(reset);
    expect(player(id).shownAlignment).toBe("good");

    const contrast = baseline();
    expect(state().replaceSetupRole(id, "monk").ok).toBe(true);
    expectOneMutation(contrast);
  });

  it("swapSetupRoles between two players already holding the same fresh role is inert; a real swap is one mutation", () => {
    dealtGame();
    const a = holderOf("chef");
    const b = holderOf("empath");
    expect(state().replaceSetupRole(b, "chef").ok).toBe(true);
    const before = baseline();
    expect(state().swapSetupRoles(a, b)).toEqual({ ok: true });
    expectInert(before);

    const imp = holderOf("imp");
    const contrast = baseline();
    expect(state().swapSetupRoles(a, imp).ok).toBe(true);
    expectOneMutation(contrast);
    expect(player(a).actualRole).toBe("imp");
  });

  it("shuffleSetupRoles drawing the identity permutation onto already-fresh assignments is inert; a real redistribution is one mutation", () => {
    dealtGame();
    // j = floor(0.9999 * (i + 1)) = i at every Fisher-Yates step.
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const before = baseline();
    expect(state().shuffleSetupRoles()).toEqual({ ok: true });
    expectInert(before);

    vi.spyOn(Math, "random").mockReturnValue(0);
    const contrast = baseline();
    expect(state().shuffleSetupRoles().ok).toBe(true);
    expectOneMutation(contrast);
  });

  it("revealRoles on an already-revealed Setup is inert and still reports success; the first Reveal is one mutation", () => {
    dealtGame();
    for (const id of game().seatOrder) state().showAssignedRole(id);
    clearUndo();
    const contrast = baseline();
    expect(state().revealRoles().ok).toBe(true);
    expectOneMutation(contrast);
    expect(game().setupRolesRevealed).toBe(true);

    const again = baseline();
    expect(state().revealRoles()).toEqual({ ok: true });
    expectInert(again);
  });
});

// ---------------------------------------------------------------------------
// 10. Already-correct commands stay correct (Phase 9D.4 no-op semantics)
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B8): commands already implementing true no-ops keep them", () => {
  it("assignRole / setActualAlignment / setAlive / setGhostVote / setStatus / addReminder / removeReminder / removeEffect with already-current input stay inert in Live Play", () => {
    dealtGame();
    goLive();
    const id = seat(0);
    state().addReminder(id, { id: "r1", label: "Mark", lifetime: { kind: "manual" } });
    const before = baseline();
    state().assignRole(id, player(id).actualRole);
    state().setActualAlignment(id, player(id).actualAlignment!);
    state().setAlive(id, true);
    state().setGhostVote(id, true);
    state().setStatus(id, "poisoned", false);
    expect(state().addReminder(id, { id: "r1", label: "Mark", lifetime: { kind: "manual" } })).toBe("r1");
    state().removeReminder(id, "no-such-reminder");
    state().removeEffect(id, "no-such-effect");
    state().removeInformationDelivery("no-such-delivery");
    expectInert(before);
  });
});

// ---------------------------------------------------------------------------
// B9: the bulk setReminders() setter is removed
// ---------------------------------------------------------------------------
describe("Phase 9R.4 (B9): addReminder/removeReminder are the only Reminder mutation paths", () => {
  it("the store no longer exposes setReminders -- at runtime or in its type", () => {
    dealtGame();
    expect("setReminders" in state()).toBe(false);
    // @ts-expect-error -- Phase 9R.4 (B9): setReminders is not part of StorytellerStore.
    expect(state().setReminders).toBeUndefined();
  });

  it("Live Play Reminder add/remove each record structured History, with one Undo entry and one localSeq step apiece", () => {
    dealtGame();
    goLive();
    const id = seat(0);
    const added = baseline();
    expect(state().addReminder(id, { id: "r1", label: "Red Herring", sourceCharacter: "fortuneteller", lifetime: { kind: "manual" } })).toBe("r1");
    expectOneMutation(added, { history: 1 });
    expect(game().history.at(-1)).toMatchObject({ category: "reminder", change: { kind: "added", item: { id: "r1", label: "Red Herring" } } });

    const removed = baseline();
    state().removeReminder(id, "r1");
    expectOneMutation(removed, { history: 1 });
    expect(game().history.at(-1)).toMatchObject({ category: "reminder", change: { kind: "removed", item: { id: "r1" } } });
    expect(player(id).reminders).toEqual([]);
  });

  it("Setup Reminder add/remove change Current State and Undo but never Live History", () => {
    dealtGame();
    const id = seat(0);
    const added = baseline();
    state().addReminder(id, { id: "r1", label: "Setup mark", lifetime: { kind: "manual" } });
    expectOneMutation(added, { history: 0 });
    expect(player(id).reminders.map((r) => r.id)).toEqual(["r1"]);

    const removed = baseline();
    state().removeReminder(id, "r1");
    expectOneMutation(removed, { history: 0 });
    expect(game().history).toEqual([]);
  });
});
