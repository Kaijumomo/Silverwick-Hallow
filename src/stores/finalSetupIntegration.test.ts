import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { selectSetupContext } from "@/features/setup/setupContext";
import { analyzeSetup } from "@/features/setup/setupAnalyzer";
import { needsShownIdentity } from "./identity";
import { MAX_TOTAL_PLAYERS } from "@/data/setupCounts";
import { setupScript, standardRoles } from "@/test/setupFixtures";

// FINAL SETUP INTEGRATION REVISION -- adversarial coverage for the required
// test categories: Reveal commitment, Composition defense, the corrected
// population model (plan vs occupancy vs commitment), New Game bounds,
// Traveler Deal independence, Traveler arrival readiness, and Traveler
// alignment delivery. Each `it` below names the exact scenario it proves.

const game = () => store.getState().game!;
const state = () => store.getState();
const population = () => selectSetupContext(game()).population;

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } }));

function newPlan(total: number, travelers = 0) {
  state().newGame(setupScript.id, { plannedPlayerCount: total, plannedTravelerCount: travelers });
}

describe("Section 2: Reveal is a hard starting-setup commitment boundary", () => {
  function readyToReveal(count: number) {
    newPlan(count);
    for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
    state().setRolePool(standardRoles(count));
    expect(state().dealRolePool().ok).toBe(true);
    // A concealed identity (Drunk/Marionette/Lunatic) needs an explicit
    // policy-valid shown role -- the ordinary showAssignedRole() shortcut
    // deliberately never reveals one (see identity.test.ts).
    game().seatOrder.forEach(id => {
      const actualRole = game().players[id]!.actualRole;
      if (needsShownIdentity(actualRole)) state().setShownRole(id, "chef");
      else state().showAssignedRole(id);
    });
    expect(state().revealRoles().ok).toBe(true);
  }

  it("refuses ordinary -> Traveler after Reveal", () => {
    readyToReveal(6);
    const id = game().seatOrder[0]!;
    const before = state();
    const result = state().setIsTraveler(id, true);
    expect(result.ok).toBe(false);
    expect(state()).toBe(before);
  });

  it("refuses Traveler -> ordinary after Reveal", () => {
    readyToReveal(6);
    // Seat a late arrival, which defaults to Traveler post-Reveal.
    state().addPlayer("Latecomer");
    const travelerId = game().seatOrder.at(-1)!;
    expect(game().players[travelerId]!.isTraveler).toBe(true);
    const before = state();
    const result = state().setIsTraveler(travelerId, false);
    expect(result.ok).toBe(false);
    expect(state()).toBe(before);
  });

  it("Begin Night 1 refuses when the committed ordinary composition is mutated invalid after Reveal (defense-in-depth)", () => {
    readyToReveal(5);
    // A future accidental UI escape: mutate the Demon away post-Reveal via
    // the generic assignRole() (only legitimate once gameplay has begun --
    // simulated directly here to prove the guard exists independent of when
    // the mutation happened).
    const impId = game().seatOrder.find(id => game().players[id]!.actualRole === "imp")!;
    state().assignRole(impId, "chef");
    expect(state().beginNightOne().ok).toBe(false);
  });

  it("Begin Night 1 still succeeds when the committed composition remains valid after Reveal", () => {
    readyToReveal(5);
    expect(state().beginNightOne().ok).toBe(true);
  });
});

describe("Section 3: population model -- plan vs occupancy vs commitment", () => {
  it("partial occupancy never redefines the plan: plan 10/0, seat 6, marking one seated player Traveler yields target ordinary 9, not 5", () => {
    newPlan(10, 0);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    expect(state().setIsTraveler(id, true).ok).toBe(true);
    expect(game().plannedPlayerCount).toBe(10);
    expect(game().plannedTravelerCount).toBe(1);
    expect(population().targetNonTravelerCount).toBe(9);
  });

  it("a planned Traveler slot is fulfilled, not double-counted: plan 10/1, 0 designated, marking one seated player Traveler leaves plan 10/1", () => {
    newPlan(10, 1);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    expect(state().setIsTraveler(id, true).ok).toBe(true);
    expect(game().plannedPlayerCount).toBe(10);
    expect(game().plannedTravelerCount).toBe(1); // fulfilled, not incremented to 2
    expect(population().targetNonTravelerCount).toBe(9);
  });

  it("reverse conversion relinquishes the intended slot: 10/1/9 -> Traveler becomes ordinary -> 10/0/10", () => {
    newPlan(10, 0);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    expect(state().setIsTraveler(id, true).ok).toBe(true);
    expect(game().plannedTravelerCount).toBe(1);
    expect(state().setIsTraveler(id, false).ok).toBe(true);
    expect(game().plannedPlayerCount).toBe(10);
    expect(game().plannedTravelerCount).toBe(0);
    expect(population().targetNonTravelerCount).toBe(10);
  });

  it("a deliberate additional participant before Reveal grows the plan: all planned seats occupied, adding an 11th raises plannedPlayerCount to 11", () => {
    newPlan(10, 0);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    expect(population().emptyPlannedSeatCount).toBe(0);
    state().addPlayer("Eleventh");
    expect(game().plannedPlayerCount).toBe(11);
    expect(game().seatOrder).toHaveLength(11);
  });

  it("addPlayer never grows the plan past the supported total cap", () => {
    newPlan(MAX_TOTAL_PLAYERS, 0);
    for (let i = 0; i < MAX_TOTAL_PLAYERS; i++) state().addPlayerToSeat("Player " + i);
    state().addPlayer("Overflow");
    expect(game().plannedPlayerCount).toBe(MAX_TOTAL_PLAYERS);
    expect(game().seatOrder).toHaveLength(MAX_TOTAL_PLAYERS + 1); // seat still created
  });

  it("filling an existing planned empty seat does not change the planned total", () => {
    newPlan(10, 0);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    expect(population().emptyPlannedSeatCount).toBe(4);
    state().addPlayerToSeat("Player 6");
    expect(game().plannedPlayerCount).toBe(10);
  });

  it("unseating a player while retaining their planned seat does not change the planned total", () => {
    newPlan(10, 0);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    state().unseatPlayer(game().seatOrder[0]!);
    expect(game().plannedPlayerCount).toBe(10);
    expect(game().seatOrder).toHaveLength(10);
  });

  it("removing an occupied participant before Reveal shrinks the plan; a Traveler removal also reconciles plannedTravelerCount", () => {
    newPlan(10, 0);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    const travelerId = game().seatOrder[0]!;
    expect(state().setIsTraveler(travelerId, true).ok).toBe(true);
    expect(game().plannedTravelerCount).toBe(1);
    state().removePlayer(travelerId);
    expect(game().plannedPlayerCount).toBe(9);
    expect(game().plannedTravelerCount).toBe(0);
  });

  it("removing an ordinary participant before Reveal shrinks only plannedPlayerCount", () => {
    newPlan(10, 0);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    state().removePlayer(game().seatOrder[0]!);
    expect(game().plannedPlayerCount).toBe(9);
    expect(game().plannedTravelerCount).toBe(0);
  });

  it("removing a never-filled empty seat never changes the planned total", () => {
    newPlan(10, 0);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const emptyId = game().seatOrder.find(id => game().players[id]!.isEmpty)!;
    state().removePlayer(emptyId);
    expect(game().plannedPlayerCount).toBe(10);
  });

  it("Add Traveler capacity never converts an empty seat into a Traveler player directly", () => {
    newPlan(5, 0);
    for (let i = 0; i < 5; i++) state().addPlayerToSeat("Player " + i);
    state().addTravelerSeat();
    const newSeatId = game().seatOrder.at(-1)!;
    expect(game().players[newSeatId]!.isEmpty).toBe(true);
    expect(game().players[newSeatId]!.isTraveler).toBe(false); // ordinary-neutral
    expect(game().plannedPlayerCount).toBe(6);
    expect(game().plannedTravelerCount).toBe(1);
  });

  it("Add Traveler capacity's planned slot is fulfilled -- not double-counted -- once a real player occupies it", () => {
    newPlan(5, 0);
    for (let i = 0; i < 5; i++) state().addPlayerToSeat("Player " + i);
    state().addTravelerSeat();
    const newSeatId = game().seatOrder.at(-1)!;
    state().addPlayerToSeat("Traveling Sam"); // fills the existing empty seat -- no plan change
    expect(game().plannedPlayerCount).toBe(6);
    expect(game().players[newSeatId]!.isEmpty).toBe(false);
    expect(state().setIsTraveler(newSeatId, true).ok).toBe(true);
    expect(game().plannedTravelerCount).toBe(1); // fulfilled the Add-Traveler slot, not incremented to 2
  });
});

describe("Section 4: New Game 5-20/5-15 bounds enforced at the store boundary", () => {
  it("newGame caps plannedPlayerCount at the supported total even given malformed input", () => {
    newPlan(999, 0);
    expect(game().plannedPlayerCount).toBe(MAX_TOTAL_PLAYERS);
    expect(game().seatOrder).toHaveLength(MAX_TOTAL_PLAYERS);
  });

  it("newGame caps plannedTravelerCount to never exceed the total", () => {
    newPlan(10, 999);
    expect(game().plannedTravelerCount).toBe(10);
  });

  it("setPlannedPlayerCount refuses to exceed the supported total", () => {
    newPlan(10, 0);
    state().setPlannedPlayerCount(999);
    expect(game().plannedPlayerCount).toBe(10); // unchanged; the malformed input is refused
  });
});

describe("Section 5: Traveler character completeness never blocks ordinary Deal", () => {
  it("9 ordinary roles ready, Traveler still choosing character -> Deal succeeds", () => {
    newPlan(9, 0);
    for (let i = 0; i < 9; i++) state().addPlayerToSeat("Player " + i);
    state().addPlayer("Traveler"); // grows the plan to 10/0 -> 9 ordinary target unaffected
    const travelerId = game().seatOrder.at(-1)!;
    expect(state().setIsTraveler(travelerId, true).ok).toBe(true); // 10/1 -- fulfilled/increment either way
    expect(population().targetNonTravelerCount).toBe(9);
    // Traveler has no actual role yet -- this must not block Deal.
    expect(game().players[travelerId]!.actualRole).toBe("");
    state().setRolePool(standardRoles(9));
    expect(state().dealRolePool().ok).toBe(true);
    // Begin Night 1 remains blocked on the missing Traveler character.
    expect(state().beginNightOne().ok).toBe(false);
  });
});

describe("Section 6: Traveler arrival readiness gates Begin Night 1, not the first-night wake", () => {
  function readyOrdinary(count: number) {
    newPlan(count, 0);
    for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
    state().setRolePool(standardRoles(count));
    expect(state().dealRolePool().ok).toBe(true);
    // A concealed identity (Drunk/Marionette/Lunatic) needs an explicit
    // policy-valid shown role -- the ordinary showAssignedRole() shortcut
    // deliberately never reveals one (see identity.test.ts).
    game().seatOrder.forEach(id => {
      const actualRole = game().players[id]!.actualRole;
      if (needsShownIdentity(actualRole)) state().setShownRole(id, "chef");
      else state().showAssignedRole(id);
    });
    expect(state().revealRoles().ok).toBe(true);
  }

  it("blocks Begin while a Gnome-style unresolved arrival check is outstanding", () => {
    readyOrdinary(5);
    state().addPlayer("Gnomey");
    const id = game().seatOrder.at(-1)!;
    state().assignRole(id, "gnome");
    state().setTravelerAlignment(id, "good");
    expect(state().beginNightOne().ok).toBe(false);
    state().completeTravelerArrivalCheck(id);
    expect(state().beginNightOne().ok).toBe(true);
  });

  it("blocks Begin while an evil Traveler's Demon information is not yet complete", () => {
    readyOrdinary(5);
    state().addPlayer("Shifty");
    const id = game().seatOrder.at(-1)!;
    state().assignRole(id, "thief");
    state().setTravelerAlignment(id, "evil");
    expect(state().beginNightOne().ok).toBe(false);
    state().completeTravelerInformation(id);
    expect(state().beginNightOne().ok).toBe(true);
  });

  it("does not require the Traveler's first-night wake/procedure to begin Night 1", () => {
    readyOrdinary(5);
    state().addPlayer("Wakeful");
    const id = game().seatOrder.at(-1)!;
    state().assignRole(id, "thief"); // has a first-night procedure of its own
    state().setTravelerAlignment(id, "good");
    // No first-night completion recorded, and Begin still succeeds once
    // arrival prerequisites (character + alignment) are satisfied.
    expect(game().players[id]!.travelerArrival?.firstNightComplete).toBeFalsy();
    expect(state().beginNightOne().ok).toBe(true);
  });
});

describe("Section 7: normal Traveler alignment delivery is automatic and never stale", () => {
  it("the Traveler's own private view reflects the current actual alignment and updates immediately on change", () => {
    newPlan(6, 0);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    expect(state().setIsTraveler(id, true).ok).toBe(true); // 6 ordinary -> 5, at the floor
    state().assignRole(id, "thief");
    state().setTravelerAlignment(id, "good");
    const context = selectSetupContext(game());
    expect(analyzeSetup(context).findings.some(f => f.code === `traveler-alignment:${id}`)).toBe(false);
    state().setTravelerAlignment(id, "evil");
    expect(game().players[id]!.actualAlignment).toBe("evil");
    // No stale shownAlignment mirror exists to override the new value.
    expect(game().players[id]!.shownAlignment).toBeNull();
  });
});
