import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";
import { refersToParticipant } from "./participants";
import type { HistoryRecord } from "./types";

// Phase 9R.1 (Finding B5): any state an authoritative Phase 9 command
// accepts must already be safe for Zustand/localStorage, JSON checkpoint
// serialization, and raw Firebase RTDB writes -- which means an ABSENT
// optional field, never a field whose value is the literal JavaScript
// `undefined`. These tests deliberately supply explicit `undefined`
// optional keys (the exact TypeScript-legal-but-storage-unsafe shapes the
// Phase 9 closure audit reproduced) and prove the STORED object's own keys
// -- not merely what reading the property returns -- reflect absence, not
// `undefined`. Never rely on JSON.stringify() alone for this (it would
// coincidentally strip undefined too, on exactly one specific
// serialization path, masking a real store-boundary bug); check own-key
// presence directly with `in`/Object.keys() before any serialization runs.

const game = () => store.getState().game!;
const state = () => store.getState();
const STORAGE_KEY = "new-blood-st";
/** Phase 9R.2: the record's durable participant is the CURRENT occupant of `id`. */
const isAbout = (h: HistoryRecord, id: string) =>
  refersToParticipant(h.participant, game().players[id]!.participantId!);

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});

function dealtGame(count = 5) {
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

describe("Phase 9R.1 Finding B5: Provenance never stores an explicit-undefined optional key", () => {
  it('{ reason: "known", note: undefined } stores as { reason: "known" } -- "note" is genuinely absent', () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setAlive(id, false, { provenance: { reason: "known", note: undefined } });
    const record = game().history.find((h) => h.category === "life" && isAbout(h, id))!;
    expect(record.provenance).toEqual({ reason: "known" });
    expect("note" in record.provenance!).toBe(false);
    expect(Object.keys(record.provenance!)).toEqual(["reason"]);
  });

  it("survives a real localStorage persist/rehydrate cycle with the key still absent, not reintroduced", async () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    // Phase 10A: a death (a living player has no ghost vote to spend).
    state().recordDeath(id, { provenance: { reason: "known", sourcePlayer: undefined, sourceCharacter: undefined } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = localStorage.getItem(STORAGE_KEY)!;
    expect(raw).toBeTruthy();
    // The RAW persisted JSON string itself never contains the literal
    // token `undefined` anywhere -- JSON has no such literal; if it were
    // ever written as a real JS `undefined` on a plain object,
    // JSON.stringify (used by localStorage's own serializer) would simply
    // omit the key, which is exactly the property under test.
    expect(raw).not.toContain("undefined");

    store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null });
    localStorage.setItem(STORAGE_KEY, raw);
    await store.persist.rehydrate();

    const record = game().history.find((h) => h.category === "life" && isAbout(h, id))!;
    expect(record.provenance).toEqual({ reason: "known" });
    expect("sourcePlayer" in record.provenance!).toBe(false);
    expect("sourceParticipant" in record.provenance!).toBe(false);
    expect("sourceCharacter" in record.provenance!).toBe(false);
  });
});

describe("Phase 9R.1 Finding B5: Effect never stores an explicit-undefined optional key", () => {
  it('{ type: "protected", lifetime: { kind: "manual" }, sourcePlayer: undefined } stores with sourcePlayer genuinely absent', () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const effectId = state().addEffect(id, {
      type: "protected", lifetime: { kind: "manual" }, sourcePlayer: undefined,
    });
    const stored = game().players[id]!.effects.find((e) => e.id === effectId)!;
    // Phase 10B: plus the lifecycle the planner fills in (applied now,
    // active, no automatic expiry) -- never a literal undefined anywhere.
    expect(stored).toEqual({ id: effectId, type: "protected", lifetime: { kind: "manual" },
      appliedAt: { phase: game().phase, day: game().day }, state: "active", expiry: { kind: "none" } });
    expect("sourcePlayer" in stored).toBe(false);
    expect("sourceParticipant" in stored).toBe(false);
  });
});

describe("Phase 9R.1 Finding B5: Reminder never stores an explicit-undefined optional key", () => {
  it("an explicit sourceCharacter: undefined stores with the key genuinely absent", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const reminderId = state().addReminder(id, {
      label: "Red Herring", sourceCharacter: undefined,
    });
    const stored = game().players[id]!.reminders.find((r) => r.id === reminderId)!;
    expect(stored).toEqual({ id: reminderId, label: "Red Herring", createdAt: { phase: "night", day: 1 } });
    expect("sourceCharacter" in stored).toBe(false);
  });

  // Phase 9R.4 (B9): these two Luna follow-up proofs originally targeted the
  // bulk setReminders() setter, now removed. They are retargeted at
  // addReminder() -- the only remaining Reminder path -- with EVERY optional
  // field it accepts set explicitly undefined (including a smuggled
  // sourceParticipant), not only the single field the test above covers.
  it("Luna follow-up: addReminder() with every optional field explicitly undefined stores the Reminder with those keys genuinely absent", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    // LUNA-10C-002: every KNOWN optional input field explicitly undefined is
    // simply "not supplied"; an UNKNOWN key is refused by presence even when
    // undefined (see the next test), so it is not part of this shape.
    expect(state().addReminder(id, {
      id: "r-1", label: "Chosen",
      sourcePlayer: undefined, sourceCharacter: undefined, note: undefined, cleanup: undefined,
    })).toBe("r-1");
    const stored = game().players[id]!.reminders[0]!;
    // Phase 10C: createdAt is planner-generated (never caller-supplied).
    expect(stored).toEqual({ id: "r-1", label: "Chosen", createdAt: { phase: "night", day: 1 } });
    expect("sourceParticipant" in stored).toBe(false);
    expect("sourcePlayer" in stored).toBe(false);
    expect("sourceCharacter" in stored).toBe(false);
    expect("note" in stored).toBe(false);
    expect("cleanupCue" in stored).toBe(false);
  });

  it("LUNA-10C-002: addReminder() refuses an unknown key present with an undefined value -- never silently stripped", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    for (const key of ["sourceParticipant", "createdAt", "cleanupCue", "lifetime", "mystery"]) {
      const before = game();
      const seq = state().localSeq;
      const undo = state().undoStack.length;
      expect(state().addReminder(id, { label: "Chosen", ...({ [key]: undefined } as object) })).toBeNull();
      expect(game()).toBe(before);
      expect(state().localSeq).toBe(seq);
      expect(state().undoStack).toHaveLength(undo);
    }
    expect(game().players[id]!.reminders).toEqual([]);
  });

  // Phase 10C: Reminders no longer carry a lifetime (a zero-count one was
  // never a valid v20 lifetime anyway), and a blank note is normalized to
  // "no note" by the planner. The falsy-but-real value that remains is a
  // "0" label -- stored exactly.
  it("Luna follow-up: addReminder() still preserves legitimate falsy-looking values (a \"0\" label) and normalizes a blank note to absent", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().addReminder(id, { id: "r-2", label: "0", note: "" });
    const stored = game().players[id]!.reminders[0]!;
    expect(stored).toEqual({ id: "r-2", label: "0", createdAt: { phase: "night", day: 1 } });
  });
});

describe("Phase 9R.1 Finding B5: Information Delivery -- ended-phase moment, and explicit-undefined Provenance", () => {
  it('a triggered Information Action recorded after phase === "ended" omits `moment` entirely -- never stores it as literal undefined', () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().assignRole(id, "ravenkeeper");
    expect(state().setPhase("ended").ok).toBe(true);

    const other = game().seatOrder[1]!;
    const result = state().recordInformationDelivery(id, "ravenkeeper-triggered", [
      { requirementId: "chosenPlayer", kind: "player", playerIds: [other] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(true);
    const record = game().informationDeliveries.find((d) => d.informationActionId === "ravenkeeper-triggered")!;
    expect("moment" in record).toBe(false);
    expect(record.moment).toBeUndefined(); // reads as undefined via the optional type...
    expect(Object.keys(record)).not.toContain("moment"); // ...but the key itself is genuinely absent
  });

  it('an explicit-undefined Provenance field on a delivery stores with the key genuinely absent', () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    state().assignRole(id, "chef");
    store.setState({ game: { ...game(), phase: "night", day: 1 } }); // chef-first-night requires Night 1
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ], { provenance: { reason: "known", note: undefined } });
    expect(result.ok).toBe(true);
    const record = game().informationDeliveries[0]!;
    expect(record.provenance).toEqual({ reason: "known" });
    expect("note" in record.provenance!).toBe(false);
  });
});
