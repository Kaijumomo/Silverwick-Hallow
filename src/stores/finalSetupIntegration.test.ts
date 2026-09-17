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

// Deals, then publishes a policy-valid shown identity for every ordinary
// seat and reveals. A concealed identity (Drunk/Marionette/Lunatic) needs an
// explicit policy-valid shown role -- the ordinary showAssignedRole()
// shortcut deliberately never reveals one (see identity.test.ts).
function readyToReveal(count: number) {
  state().setRolePool(standardRoles(count));
  expect(state().dealRolePool().ok).toBe(true);
  game().seatOrder.forEach(id => {
    const actualRole = game().players[id]!.actualRole;
    if (!actualRole) return; // Travelers/unseated -- never part of the ordinary bag
    if (needsShownIdentity(actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  });
  expect(state().revealRoles().ok).toBe(true);
}

describe("Section 2: Reveal is a hard starting-setup commitment boundary", () => {
  function readyToRevealPlan(count: number) {
    newPlan(count);
    for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
    readyToReveal(count);
  }

  it("refuses ordinary -> Traveler after Reveal", () => {
    readyToRevealPlan(6);
    const id = game().seatOrder[0]!;
    const before = state();
    const result = state().setIsTraveler(id, true);
    expect(result.ok).toBe(false);
    expect(state()).toBe(before);
  });

  it("refuses Traveler -> ordinary after Reveal", () => {
    readyToRevealPlan(6);
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
    readyToRevealPlan(5);
    // A future accidental UI escape: mutate the Demon away post-Reveal via
    // the generic assignRole() (only legitimate once gameplay has begun --
    // simulated directly here to prove the guard exists independent of when
    // the mutation happened).
    const impId = game().seatOrder.find(id => game().players[id]!.actualRole === "imp")!;
    state().assignRole(impId, "chef");
    expect(state().beginNightOne().ok).toBe(false);
  });

  it("Begin Night 1 still succeeds when the committed composition remains valid after Reveal", () => {
    readyToRevealPlan(5);
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

  // FINAL POPULATION CLOSURE, Section 2 (required test: "Twenty-player
  // atomic refusal"): at capacity, every seat/participant-creating command
  // refuses entirely before any mutation -- never clamps the plan while
  // still creating seat/player 21.
  it.each(["addPlayer", "addPlayerToSeat", "addEmptySeat", "addTravelerSeat"] as const)(
    "%s refuses atomically at the 20-participant cap: no seat added, no player added, plan unchanged", command => {
      newPlan(MAX_TOTAL_PLAYERS, 0);
      for (let i = 0; i < MAX_TOTAL_PLAYERS; i++) state().addPlayerToSeat("Player " + i);
      const before = state();
      if (command === "addPlayer" || command === "addPlayerToSeat") state()[command]("Overflow");
      else state()[command]();
      expect(state()).toBe(before); // no mutation at all
      expect(game().plannedPlayerCount).toBe(MAX_TOTAL_PLAYERS);
      expect(game().seatOrder).toHaveLength(MAX_TOTAL_PLAYERS);
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

  it("FINAL POPULATION CLOSURE, Section 8: removing a never-filled empty seat still removes one unit of starting capacity", () => {
    newPlan(10, 0);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const emptyId = game().seatOrder.find(id => game().players[id]!.isEmpty)!;
    state().removePlayer(emptyId);
    expect(game().plannedPlayerCount).toBe(9);
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

describe("FINAL POPULATION CLOSURE -- required reproductions", () => {
  it("new seat accounting: 10 planned, + New Seat -> plannedPlayerCount 11; seating someone into it stays 11", () => {
    newPlan(10, 0);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    state().addEmptySeat();
    expect(game().plannedPlayerCount).toBe(11);
    state().addPlayerToSeat("Eleventh");
    expect(game().plannedPlayerCount).toBe(11);
  });

  it("Traveller reservation: 10/0, Add Traveller -> 11 total/1 Traveller; the new empty seat is not isTraveler but carries the reservation marker; removing it restores 10/0", () => {
    newPlan(10, 0);
    for (let i = 0; i < 10; i++) state().addPlayerToSeat("Player " + i);
    state().addTravelerSeat();
    const reservedId = game().seatOrder.at(-1)!;
    expect(game().plannedPlayerCount).toBe(11);
    expect(game().plannedTravelerCount).toBe(1);
    expect(game().players[reservedId]!.isEmpty).toBe(true);
    expect(game().players[reservedId]!.isTraveler).toBe(false);
    expect(game().players[reservedId]!.plannedTravelerSeat).toBe(true);
    state().removePlayer(reservedId);
    expect(game().plannedPlayerCount).toBe(10);
    expect(game().plannedTravelerCount).toBe(0);
  });

  it("explicit Traveller assignment honors intent through the reservation marker, never suppressed by the seat it just filled: 14 ordinary, Add Traveller, assign a waiting player to the reserved seat -> 14 ordinary + 1 Traveller, never 15 ordinary", () => {
    newPlan(14, 0);
    for (let i = 0; i < 14; i++) state().addPlayerToSeat("Player " + i);
    state().addTravelerSeat();
    const reservedId = game().seatOrder.at(-1)!;
    expect(game().players[reservedId]!.plannedTravelerSeat).toBe(true);
    // The exact production path a waiting-queue assignment uses
    // (SeatAssignPopup -> assignPendingToSeat) -- no explicit setIsTraveler
    // call at all. The store's own arrivalPlayer() must fulfill the
    // reservation atomically, never re-deriving from post-fill occupancy
    // (the Section 5 timing bug: filling this exact seat could otherwise
    // push occupied-ordinary to a point that spuriously suppresses the
    // Traveler designation the reservation already promised).
    state().addToPendingQueue("uid-1", "Waiting Traveler");
    expect(state().assignPendingToSeat("uid-1", reservedId)).toBe(true);
    const context = selectSetupContext(game());
    expect(context.population.occupiedNonTravelerCount).toBe(14);
    expect(context.population.occupiedTravelerCount).toBe(1);
    expect(game().players[reservedId]!.isTraveler).toBe(true);
    expect(game().players[reservedId]!.plannedTravelerSeat).toBeUndefined(); // consumed
  });

  it("automatic cap arrival updates the plan atomically: 15 ordinary, add a new participant before Reveal -> the new player is a Traveler, plan becomes 16/1, ordinary target stays 15", () => {
    newPlan(15, 0);
    for (let i = 0; i < 15; i++) state().addPlayerToSeat("Player " + i);
    expect(population().emptyPlannedSeatCount).toBe(0);
    state().addPlayer("16th arrival");
    const newId = game().seatOrder.at(-1)!;
    expect(game().players[newId]!.isTraveler).toBe(true);
    expect(game().plannedPlayerCount).toBe(16);
    expect(game().plannedTravelerCount).toBe(1); // never 16/0
    expect(population().targetNonTravelerCount).toBe(15); // never 16
  });

  it("four-ordinary rejection: an adversarially reached unsupported ordinary target (4) cannot Reveal or Begin Night 1", () => {
    newPlan(5, 0);
    for (let i = 0; i < 5; i++) state().addPlayerToSeat("Player " + i);
    state().setRolePool(standardRoles(5));
    expect(state().dealRolePool().ok).toBe(true);
    game().seatOrder.forEach(id => state().showAssignedRole(id));
    // Remove one starting seat before Reveal -- ordinary target drops to 4,
    // outside the supported 5-15 range.
    state().removePlayer(game().seatOrder[0]!);
    expect(population().targetNonTravelerCount).toBe(4);
    expect(state().revealRoles().ok).toBe(false);
    expect(state().beginNightOne().ok).toBe(false);
  });

  it("four-ordinary rejection persists even when the analyzer cannot compute a specific candidate mismatch (adversarial state past Reveal)", () => {
    newPlan(5, 0);
    for (let i = 0; i < 5; i++) state().addPlayerToSeat("Player " + i);
    state().setRolePool(standardRoles(5));
    expect(state().dealRolePool().ok).toBe(true);
    game().seatOrder.forEach(id => state().showAssignedRole(id));
    expect(state().revealRoles().ok).toBe(true);
    // Adversarial/legacy mutation after Reveal: an ordinary player is
    // removed (a legitimate membership action even post-Reveal), leaving an
    // unsupported 4-ordinary composition. Begin Night 1 must still refuse.
    state().removePlayer(game().seatOrder[0]!);
    expect(state().beginNightOne().ok).toBe(false);
  });

  // Store-level guards (Section 2) already refuse a 21st seat/participant
  // through every normal command before Reveal -- this simulates
  // legacy/adversarial state bypassing them directly, isolated from the
  // ordinary-composition checks by injecting OCCUPIED TRAVELER seats (which
  // never count toward the ordinary target/occupancy comparison) with valid
  // characters and alignments, so capacity is the only thing that can block.
  function injectExtraTravelers(count: number) {
    const current = game();
    const extraPlayers: typeof current.players = {};
    const extraIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `extra-${i}`;
      extraIds.push(id);
      extraPlayers[id] = {
        id, name: "Overflow " + i, seat: current.seatOrder.length + i, joinedAt: Date.now(),
        actualRole: "thief", shownRole: null, shownAlignment: null, behaviorMode: "normal",
        publicDisplayRole: null, alive: true, ghostVote: true, abilityUsed: false, statuses: {},
        reminders: [], stNotes: "", isTraveler: true, actualAlignment: "good",
      };
    }
    store.setState({ game: { ...current, players: { ...current.players, ...extraPlayers },
      seatOrder: [...current.seatOrder, ...extraIds] } });
  }

  it("twenty-one rejection: adversarial capacity beyond 20 cannot Reveal", () => {
    newPlan(15, 0);
    for (let i = 0; i < 15; i++) state().addPlayerToSeat("Player " + i);
    state().setRolePool(standardRoles(15));
    expect(state().dealRolePool().ok).toBe(true);
    game().seatOrder.forEach(id => state().showAssignedRole(id));
    injectExtraTravelers(6); // 15 + 6 = 21 physical seats
    expect(population().totalPhysicalSeatCount).toBe(21);
    expect(state().revealRoles().ok).toBe(false);
  });

  it("twenty-one rejection: adversarial capacity beyond 20 cannot Begin Night 1", () => {
    newPlan(15, 0);
    for (let i = 0; i < 15; i++) state().addPlayerToSeat("Player " + i);
    readyToReveal(15);
    injectExtraTravelers(6); // 15 + 6 = 21 physical seats, added after a valid Reveal
    expect(population().totalPhysicalSeatCount).toBe(21);
    expect(state().beginNightOne().ok).toBe(false);
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

  it("an unfilled planned Traveler reservation (Add Traveler, no occupant yet) never blocks ordinary Deal either", () => {
    newPlan(9, 0);
    for (let i = 0; i < 9; i++) state().addPlayerToSeat("Player " + i);
    state().addTravelerSeat(); // an empty, plannedTravelerSeat-marked reservation -- no occupant at all
    expect(population().emptyPlannedSeatCount).toBe(0); // never counted as an unused ordinary seat
    state().setRolePool(standardRoles(9));
    expect(state().dealRolePool().ok).toBe(true);
  });
});

describe("Section 6: Traveler arrival readiness gates Begin Night 1, not the first-night wake", () => {
  function readyOrdinary(count: number) {
    newPlan(count, 0);
    for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
    readyToReveal(count);
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
