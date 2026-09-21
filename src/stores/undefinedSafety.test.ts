import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";

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
    const record = game().history.find((h) => h.category === "life" && h.playerId === id)!;
    expect(record.provenance).toEqual({ reason: "known" });
    expect("note" in record.provenance!).toBe(false);
    expect(Object.keys(record.provenance!)).toEqual(["reason"]);
  });

  it("survives a real localStorage persist/rehydrate cycle with the key still absent, not reintroduced", async () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setGhostVote(id, false, { provenance: { reason: "known", sourcePlayer: undefined, sourceCharacter: undefined } });
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

    const record = game().history.find((h) => h.category === "life" && h.playerId === id)!;
    expect(record.provenance).toEqual({ reason: "known" });
    expect("sourcePlayer" in record.provenance!).toBe(false);
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
    expect(stored).toEqual({ id: effectId, type: "protected", lifetime: { kind: "manual" } });
    expect("sourcePlayer" in stored).toBe(false);
  });
});

describe("Phase 9R.1 Finding B5: Reminder never stores an explicit-undefined optional key", () => {
  it("an explicit sourceCharacter: undefined stores with the key genuinely absent", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const reminderId = state().addReminder(id, {
      label: "Red Herring", lifetime: { kind: "manual" }, sourceCharacter: undefined,
    });
    const stored = game().players[id]!.reminders.find((r) => r.id === reminderId)!;
    expect(stored).toEqual({ id: reminderId, label: "Red Herring", lifetime: { kind: "manual" } });
    expect("sourceCharacter" in stored).toBe(false);
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
