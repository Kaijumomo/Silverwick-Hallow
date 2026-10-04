import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";
import { participantRefOf, refersToParticipant } from "./participants";
import type { GameHistoryRecord as HistoryRecord } from "./types";

// Phase 9R.1 (Finding B4): once an Authoritative Mutation Command accepts
// structured input, the store must own its own immutable snapshot of it --
// later mutation of the CALLER's original object/array must never alter
// Current State, History, Provenance, or Information Delivery. Each test
// below: (1) calls a command with a mutable object/array the test keeps its
// own reference to, (2) saves the authoritative result, (3) mutates the
// ORIGINAL input after the command has already returned, (4) confirms the
// store is unaffected, and (5) confirms localSeq does not move again purely
// from that external mutation (no second store command ran).

const game = () => store.getState().game!;
const state = () => store.getState();
/** Phase 9R.2: a History Record is "about" the participant CURRENTLY in seat
 * `id` when its durable participant snapshot carries that participant's
 * own ParticipantId (not merely the same, reusable seat id). */
const isAbout = (h: HistoryRecord, id: string) =>
  refersToParticipant(h.participant, game().players[id]!.participantId!);

const STORAGE_KEY = "new-blood-st";

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});

function dealtGame(count = 7) {
  state().newGame(setupScript.id, { plannedPlayerCount: count, plannedTravelerCount: 0 });
  for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(count));
  expect(state().dealRolePool().ok).toBe(true);
}

/** Advances a freshly dealt Setup game into live play. */
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

describe("Phase 9R.1 Finding B4: Provenance ownership", () => {
  it("mutating the caller's original Provenance object after setAlive() returns does not alter the stored History Record", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;

    const provenance = { reason: "killed by the Demon", note: "original note" };
    state().setAlive(id, false, { provenance });
    const localSeqAfterCommand = state().localSeq;
    const storedRecord = game().history.find((h) => isAbout(h, id) && h.category === "life")!;
    expect(storedRecord.provenance).toEqual({ reason: "killed by the Demon", note: "original note" });

    // The caller's own object is mutated AFTER the command has already
    // returned and stored its snapshot.
    provenance.reason = "MUTATED AFTER THE FACT";
    provenance.note = "MUTATED AFTER THE FACT";

    const restoredRecord = game().history.find((h) => isAbout(h, id) && h.category === "life")!;
    expect(restoredRecord.provenance).toEqual({ reason: "killed by the Demon", note: "original note" });
    expect(restoredRecord.provenance).not.toEqual(provenance);
    // No second store command ran -- localSeq must not have moved again.
    expect(state().localSeq).toBe(localSeqAfterCommand);
  });

  it("survives a real localStorage persist/rehydrate cycle unaffected by the caller's later mutation", async () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const provenance = { reason: "Storyteller ruling" };
    // Phase 10A: a living player has no ghost vote to spend; a death carries
    // the same caller-supplied Provenance through the life boundary (into
    // both the History Record and the Life Event).
    expect(state().recordDeath(id, { provenance }).ok).toBe(true);
    provenance.reason = "MUTATED AFTER THE FACT";

    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const beforeGame = game();
    store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null });
    localStorage.setItem(STORAGE_KEY, raw!);
    await store.persist.rehydrate();

    const record = game().history.find((h) => isAbout(h, id) && h.category === "life")!;
    expect(record.provenance).toEqual({ reason: "Storyteller ruling" });
    expect(game().lifeEventWindow.events[0]!.provenance).toEqual({ reason: "Storyteller ruling" });
    expect(game()).toEqual(beforeGame);
  });
});

describe("Phase 9R.1 Finding B4: Information Value ownership (including nested Player id arrays)", () => {
  it("mutating the caller's original values array (and its nested playerIds array) after recordInformationDelivery() returns does not alter the stored record", () => {
    dealtGame();
    goLive();
    const wwId = game().seatOrder.find((id) => game().players[id]!.actualRole === "washerwoman")
      ?? (state().assignRole(game().seatOrder[0]!, "washerwoman"), game().seatOrder[0]!);
    const targets = [game().seatOrder[1]!, game().seatOrder[2]!];

    const values = [
      { requirementId: "players", kind: "player" as const, playerIds: [...targets] },
      { requirementId: "role", kind: "role" as const, roleId: "chef" },
    ];
    const result = state().recordInformationDelivery(wwId, "washerwoman-first-night", values);
    expect(result.ok).toBe(true);
    const localSeqAfterCommand = state().localSeq;
    const storedBefore = game().informationDeliveries[0]!;
    // Phase 9R.2: the accepted live playerIds are stored as the durable
    // participant snapshots of exactly those players.
    const expectedStored = [
      { requirementId: "players", kind: "player", participants: targets.map((t) => participantRefOf(game(), t)!) },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ];
    expect(storedBefore.values).toEqual(expectedStored);

    // Mutate the caller's own array AND its nested playerIds array after
    // the command has already returned.
    (values[0] as { playerIds: string[] }).playerIds.push("INJECTED-AFTER-THE-FACT");
    values.push({ requirementId: "extra", kind: "role" as const, roleId: "imp" });

    const storedAfter = game().informationDeliveries[0]!;
    expect(storedAfter.values).toEqual(expectedStored);
    expect(JSON.stringify(storedAfter)).not.toContain("INJECTED-AFTER-THE-FACT");
    expect(storedAfter.values).toHaveLength(2);
    expect(state().localSeq).toBe(localSeqAfterCommand);
  });

  it("mutating the caller's original Mutation Context provenance after recordInformationDelivery() returns does not alter the stored record", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().assignRole(id, "chef");
    const provenance = { note: "confirmed with player" };

    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ], { provenance });
    expect(result.ok).toBe(true);
    provenance.note = "MUTATED AFTER THE FACT";

    expect(game().informationDeliveries[0]!.provenance).toEqual({ note: "confirmed with player" });
  });
});

describe("Phase 9R.1 Finding B4: Effect lifetime ownership", () => {
  it("mutating the caller's original effect object (including its nested lifetime object) after addEffect() returns does not alter the stored Effect or its History snapshot", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;

    const lifetime = { kind: "nights" as const, count: 2 };
    const effect = { type: "poisoned", sourceCharacter: "poisoner", lifetime };
    const effectId = state().addEffect(id, effect);
    expect(effectId).not.toBeNull();
    const localSeqAfterCommand = state().localSeq;
    const storedBefore = game().players[id]!.effects.find((e) => e.id === effectId)!;
    expect(storedBefore.lifetime).toEqual({ kind: "nights", count: 2 });

    // Mutate the caller's own nested lifetime object (and the top-level
    // effect object) after the command has already returned.
    lifetime.count = 999;
    effect.sourceCharacter = "INJECTED-AFTER-THE-FACT";

    const storedAfter = game().players[id]!.effects.find((e) => e.id === effectId)!;
    expect(storedAfter.lifetime).toEqual({ kind: "nights", count: 2 });
    expect(storedAfter.sourceCharacter).toBe("poisoner");
    const historyItem = game().history.find((h) => h.category === "effect" && isAbout(h, id))!;
    expect(historyItem.change).toMatchObject({ kind: "added", item: { lifetime: { kind: "nights", count: 2 }, sourceCharacter: "poisoner" } });
    expect(state().localSeq).toBe(localSeqAfterCommand);
  });
});

describe("Phase 9R.1 Finding B4: Reminder ownership (addReminder -- the same pattern as addEffect)", () => {
  // Phase 10C: the nested caller-owned object is now the cleanup request
  // (Reminders no longer carry a lifetime); the stored cue is resolved by the
  // planner, and nothing the caller keeps can reach it.
  it("mutating the caller's original reminder object (including its nested cleanup request) after addReminder() returns does not alter the stored Reminder or its History snapshot", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;

    const cleanup = { kind: "nextPhase" as const };
    const reminder = { label: "Red Herring", sourceCharacter: "fortuneteller", note: "original", cleanup };
    const reminderId = state().addReminder(id, reminder);
    expect(reminderId).not.toBeNull();
    const storedBefore = game().players[id]!.reminders.find((r) => r.id === reminderId)!;
    expect(storedBefore.cleanupCue).toEqual({ kind: "at", moment: { phase: "day", day: 1 } });

    (cleanup as { kind: string }).kind = "INJECTED";
    reminder.label = "INJECTED-AFTER-THE-FACT";
    reminder.note = "INJECTED";

    const storedAfter = game().players[id]!.reminders.find((r) => r.id === reminderId)!;
    expect(storedAfter.cleanupCue).toEqual({ kind: "at", moment: { phase: "day", day: 1 } });
    expect(storedAfter.label).toBe("Red Herring");
    expect(storedAfter.note).toBe("original");
    const historyItem = game().history.find((h) => h.category === "reminder" && isAbout(h, id))!;
    expect(historyItem.change).toMatchObject({ kind: "added", item: { label: "Red Herring", note: "original", cleanupCue: { kind: "at", moment: { phase: "day", day: 1 } } } });
  });
});

// ---------------------------------------------------------------------------
// Luna follow-up (residual B4/B5) originally proved this for the bulk
// setReminders() setter, which only spread-copied the TOP-LEVEL array.
// Phase 9R.4 (B9) removed that setter; the same several-Reminders ownership
// property is now proven through addReminder(), the only remaining path.
// ---------------------------------------------------------------------------
describe("Phase 9R.1 Finding B4 (Luna follow-up): several Reminders' ownership (Phase 9R.4: via addReminder)", () => {
  it("mutating the caller's original Reminder objects (and their nested cleanup requests) after each addReminder() returns does not alter authoritative Current State", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;

    const cleanupA = { kind: "nextPhase" as const };
    const reminderA = { id: "r-a", label: "Red Herring", sourceCharacter: "fortuneteller", cleanup: cleanupA };
    const reminderB = { id: "r-b", label: "Chosen", note: "b" };
    const reminders: { id: string; label: string; sourceCharacter?: string; note?: string; cleanup?: { kind: "nextPhase" } }[] = [reminderA, reminderB];

    for (const reminder of reminders) expect(state().addReminder(id, reminder)).toBe(reminder.id);
    const localSeqAfterCommand = state().localSeq;
    const now = { phase: "night", day: 1 };
    const expected = [
      { id: "r-a", label: "Red Herring", sourceCharacter: "fortuneteller", createdAt: now, cleanupCue: { kind: "at", moment: { phase: "day", day: 1 } } },
      { id: "r-b", label: "Chosen", createdAt: now, note: "b" },
    ];
    expect(game().players[id]!.reminders).toEqual(expected);
    // A true independent baseline -- structuredClone, never a shallow
    // `[...array]` copy, which would still alias each stored Reminder
    // object to the caller's own (an aliased "before" would silently
    // corrupt itself alongside the mutation below, masking exactly the
    // bug this test exists to catch).
    const storedBefore = structuredClone(game().players[id]!.reminders);

    // Mutate the caller's own array, its elements, and their nested
    // cleanup requests -- all AFTER the command has already returned.
    (cleanupA as { kind: string }).kind = "INJECTED";
    reminderA.label = "INJECTED-AFTER-THE-FACT";
    reminderB.label = "ALSO-INJECTED";
    reminders.push({ id: "r-c", label: "INJECTED-EXTRA" });

    const storedAfter = game().players[id]!.reminders;
    expect(storedAfter).toEqual(expected);
    expect(storedAfter).toEqual(storedBefore);
    expect(storedAfter).toHaveLength(2);
    // No second store command ran -- localSeq must not have moved again.
    expect(state().localSeq).toBe(localSeqAfterCommand);
  });
});
