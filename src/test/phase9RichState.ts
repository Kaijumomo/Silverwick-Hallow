import { useStorytellerStore } from "@/stores/storytellerStore";
import type { PlayerId } from "@/stores/types";

/**
 * Phase 9D.5: builds a single, deliberately rich authoritative game --
 * driven entirely through real Authoritative Mutation/Setup/Information
 * commands, never hand-constructed -- exercising Setup composition, a
 * randomized Deal, pre-Reveal refinement, explicit Reveal, Night 1, live
 * Current State mutations (identity/alignment/life/effects/reminders),
 * History with Provenance, Information Delivery, a Traveler (public
 * character + private alignment + exile), night progress, and
 * Storyteller-private notes.
 *
 * Deliberately does NOT depend on which physical seat gets which role --
 * `tb`'s randomized deal decides that -- every downstream step resolves
 * players by their (guaranteed-present, for a 7-player Trouble Brewing
 * deal) Actual Role instead of a seat index.
 */
export type RichGameHandles = {
  code: string;
  ordinaryIds: PlayerId[];
  chefId: PlayerId;
  washerwomanId: PlayerId;
  investigatorId: PlayerId;
  librarianId: PlayerId;
  travelerId: PlayerId;
  deadOrdinaryId: PlayerId;
  ghostVoteToggledId: PlayerId;
};

function byActualRole(roleId: string): PlayerId {
  const game = useStorytellerStore.getState().game!;
  const player = Object.values(game.players).find((p) => p.actualRole === roleId);
  if (!player) throw new Error(`rich game: no seated player has Actual Role "${roleId}"`);
  return player.id;
}

export function buildRichPhase9Game(): RichGameHandles {
  const store = () => useStorytellerStore.getState();
  const code = "RICH" + Math.random().toString(36).slice(2, 6).toUpperCase();

  // --- Setup: plan/composition ---------------------------------------
  store().newGame("tb", { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (let i = 0; i < 7; i++) store().addPlayerToSeat("Player " + i);
  const ordinaryIds = [...store().game!.seatOrder];

  // --- Deal: randomized initial Storyteller truth ---------------------
  store().setRolePool(["washerwoman", "librarian", "investigator", "chef", "empath", "poisoner", "imp"]);
  const dealResult = store().dealRolePool();
  if (!dealResult.ok) throw new Error("rich game: deal failed -- " + dealResult.message);

  const chefId = byActualRole("chef");
  let washerwomanId = byActualRole("washerwoman");
  let investigatorId = byActualRole("investigator");
  const librarianId = byActualRole("librarian");

  // --- Pre-Reveal refinement: still possible, composition-neutral -----
  const swapResult = store().swapSetupRoles(washerwomanId, investigatorId);
  if (!swapResult.ok) throw new Error("rich game: pre-Reveal swap failed -- " + swapResult.message);
  washerwomanId = byActualRole("washerwoman");
  investigatorId = byActualRole("investigator");

  // --- Reveal: explicit, locks post-Reveal ordinary Setup semantics ---
  for (const id of ordinaryIds) store().showAssignedRole(id);
  const revealResult = store().revealRoles();
  if (!revealResult.ok) throw new Error("rich game: reveal failed -- " + revealResult.message);

  // --- Night 1 begins through the real readiness path -----------------
  const beginResult = store().beginNightOne();
  if (!beginResult.ok) throw new Error("rich game: beginNightOne failed -- " + beginResult.message);

  // --- Night progress ---------------------------------------------------
  store().setNightStepStatus(1, "demonInfo", "done");
  store().setNightStepNotes(1, "demonInfo", "Demon informed per script.");

  // --- Traveler: a late arrival defaults Traveler once Reveal has
  // committed the ordinary roster. Public character + private alignment
  // + eventual exile (distinct from a generic kill). ---------------------
  store().addPlayerToSeat("Late Traveler");
  const travelerId = store().game!.seatOrder.at(-1)!;
  if (!store().game!.players[travelerId]!.isTraveler) {
    throw new Error("rich game: late arrival did not default to Traveler");
  }
  store().assignRole(travelerId, "thief"); // public character -- Identity History
  store().setTravelerAlignment(travelerId, "evil", {
    provenance: { reason: "Storyteller selection", sourceCharacter: "thief" },
  }); // private alignment -- Alignment History with Provenance
  store().exileTraveler(travelerId); // flips alive/exiled together; its own "life" History entry, distinct from a generic kill

  // --- Ordinary Life State: alive/dead + ghost vote --------------------
  const deadOrdinaryId = librarianId;
  store().setAlive(deadOrdinaryId, false, { provenance: { reason: "killed by the Demon" } });
  const ghostVoteToggledId = investigatorId;
  store().setGhostVote(ghostVoteToggledId, false);

  // --- Structured Effects: manual + ability-sourced, with lifetime -----
  store().setStatus(chefId, "poisoned", true); // manual
  store().addEffect(washerwomanId, {
    type: "protected", sourceCharacter: "monk", sourcePlayer: chefId,
    lifetime: { kind: "untilDawn" },
  });

  // --- Structured Reminders: manual + sourced --------------------------
  store().addReminder(chefId, { label: "Poisoned", lifetime: { kind: "manual" } });
  store().addReminder(washerwomanId, {
    label: "Red Herring", sourceCharacter: "fortuneteller", lifetime: { kind: "manual" },
  });

  // --- Information Delivery: two materially different requirement
  // shapes, through the real Roles' real Information Actions -----------
  const chefDelivery = store().recordInformationDelivery(chefId, "chef-first-night", [
    { requirementId: "pairs", kind: "number", value: 1 },
  ]);
  if (!chefDelivery.ok) throw new Error("rich game: Chef Information Delivery failed -- " + chefDelivery.message);
  const wwDelivery = store().recordInformationDelivery(washerwomanId, "washerwoman-first-night", [
    { requirementId: "players", kind: "player", playerIds: [investigatorId, librarianId] },
    { requirementId: "role", kind: "role", roleId: "librarian" },
  ]);
  if (!wwDelivery.ok) throw new Error("rich game: Washerwoman Information Delivery failed -- " + wwDelivery.message);

  // --- Storyteller-private notes ----------------------------------------
  store().setNotes(chefId, "SENTINEL-PRIVATE-CHEF-NOTE");

  // --- Phase 9C sync/reconnect watermark state (representative) --------
  const sessionId = "session-" + code;
  store().ensureSyncScope(code, sessionId);
  store().noteWriterAttempt(code, sessionId, { token: "tok-rich-1", revision: 1 });
  store().noteWriterAck(code, sessionId, { token: "tok-rich-1", revision: 1 });

  return {
    code, ordinaryIds, chefId, washerwomanId, investigatorId, librarianId,
    travelerId, deadOrdinaryId, ghostVoteToggledId,
  };
}
