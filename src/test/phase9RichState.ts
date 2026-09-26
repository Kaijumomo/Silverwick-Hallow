import { useStorytellerStore } from "@/stores/storytellerStore";
import type { PlayerId } from "@/stores/types";

/**
 * Phase 9D.5: builds a single, deliberately rich authoritative game --
 * driven entirely through real Authoritative Mutation/Setup/Information
 * commands, never hand-constructed -- exercising Setup composition, a
 * randomized Deal, pre-Reveal refinement, explicit Reveal, Night 1, live
 * Current State mutations (role/alignment/life/effects/reminders),
 * History with Provenance, Information Delivery, a Traveler (public
 * character + private alignment + exile), night progress, and
 * Storyteller-private notes. Phase 10A: it ends on Day 1 with a Life Event
 * Window holding the Night 1 death and the Day 1 execution (survived) and
 * exile (died), and the dead player's spent vote.
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

function lifeOk(result: { ok: boolean; message?: string }, label: string): void {
  if (!result.ok) throw new Error(`rich game: ${label} failed -- ${result.message ?? ""}`);
}

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
  store().assignRole(travelerId, "thief"); // public character -- Role History
  store().setTravelerAlignment(travelerId, "evil", {
    provenance: { reason: "Storyteller selection", sourceCharacter: "thief" },
  }); // private alignment -- Alignment History with Provenance

  // --- Ordinary Life State: a Night death (Phase 10A Life Event) --------
  const deadOrdinaryId = librarianId;
  lifeOk(store().recordDeath(deadOrdinaryId, { provenance: { reason: "killed by the Demon" } }), "recordDeath");

  // --- Structured Effects: manual + ability-sourced, with lifetime -----
  store().setStatus(chefId, "poisoned", true); // manual
  // Phase 10B: finite Effects now expire deterministically at their exact
  // boundary. This sourced Effect must still exist in the Day 1 snapshot
  // below, so it lasts through the following Day (expires entering Night 2)
  // -- an "untilDawn" Effect would, correctly, expire on entering Day 1.
  store().addEffect(washerwomanId, {
    type: "protected", sourceCharacter: "monk", sourcePlayer: chefId,
    lifetime: { kind: "throughFollowingDay" },
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

  // --- Phase 10A: Day 1 -- the Night's Life Events stay queryable, and the
  // Day's execution/exile are recorded when they happen. ----------------
  const advance = store().advancePhase();
  if (!advance.ok) throw new Error("rich game: advance to Day 1 failed -- " + advance.message);
  // An execution the executee survives: a Life Event with no life-field diff.
  lifeOk(store().recordExecution(investigatorId, "survived"), "recordExecution");
  // Exile flips alive/exiled together; its own exile Life Event, distinct
  // from a generic kill.
  lifeOk(store().recordExile(travelerId, "died"), "recordExile");
  // The dead player spends their vote token.
  const ghostVoteToggledId = deadOrdinaryId;
  lifeOk(store().spendGhostVote(ghostVoteToggledId), "spendGhostVote");

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
