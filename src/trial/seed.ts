import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { isTabletTrial } from "@/config/trial";
import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
import { changeAlignmentIntent } from "@/stores/alignmentResolution";
import type { PlayerId } from "@/stores/types";

export type TrialSize = 15 | 20;
export const TRIAL_SCRIPT_ID = "silverwick-voting-tablet-trial";
const ORDINARY = ["virgin", "pacifist", "chef", "empath", "fortuneteller", "monk", "undertaker", "ravenkeeper", "washerwoman", "saint", "poisoner", "spy", "scarletwoman", "imp", "butler"];
const TRAVELERS = ["bureaucrat", "thief", "scapegoat", "gunslinger", "beggar"];
const NAMES = ["Alice", "Bartholomew", "Cass", "Dmitri", "Evangeline", "Fen", "Guillermo", "Hana", "Ignatius", "Jo", "Kwame", "Lucía", "Mo", "Nadia", "Oluwaseun", "Tess", "Uriah", "Vik", "Wren", "Xiomara"];
const state = () => useStorytellerStore.getState();
function accepted(result: { ok: boolean; message?: string; error?: string }, step: string) {
  if (!result.ok) throw new Error(`${step}: ${result.message ?? result.error ?? "refused"}`);
}

/** Trial-only fixture. All game changes use the same commands as real play. */
export function seedTabletTrial(size: TrialSize): void {
  if (!isTabletTrial) throw new Error("The sample table is available only in the local tablet trial.");
  if (state().lobby) throw new Error("Detach the online session before opening a sample table.");
  if (!state().customScripts[TRIAL_SCRIPT_ID]) {
    accepted(state().addCustomScript({ id: TRIAL_SCRIPT_ID, name: "Voting practice", author: "Silverwick Hollow", characters: canonicalRoles([...ORDINARY, ...TRAVELERS]) }), "Prepare sample script");
  }
  const ordinaryCount = size === 15 ? 14 : 15;
  const roles = [...ORDINARY.slice(0, ordinaryCount), ...TRAVELERS.slice(0, size - ordinaryCount)];
  state().newGame(TRIAL_SCRIPT_ID, { plannedPlayerCount: size, plannedTravelerCount: size - ordinaryCount });
  for (let i = 0; i < size; i++) state().addPlayerToSeat(NAMES[i]!);
  const ids = [...state().game!.seatOrder];
  for (let i = ordinaryCount; i < size; i++) {
    if (!state().game!.players[ids[i]!]!.isTraveler) accepted(state().setIsTraveler(ids[i]!, true), "Seat Traveler");
    accepted(state().assignRole(ids[i]!, roles[i]!), "Assign Traveler");
    accepted(state().resolveAlignments({ intents: [changeAlignmentIntent(state().game!.players[ids[i]!]!, "good")] }), "Set Traveler alignment");
  }
  state().setRolePool(ORDINARY.slice(0, ordinaryCount));
  accepted(state().dealRolePool(), "Deal sample table");
  // Deterministic names/characters make review scenarios repeatable.
  for (let i = 0; i < ordinaryCount; i++) accepted(state().assignRole(ids[i]!, roles[i]!), "Assign sample character");
  const registry = buildRegistry(state().customScripts[TRIAL_SCRIPT_ID]!);
  accepted(state().resolveAlignments({ intents: ids.slice(0, ordinaryCount).map(id => {
    const player = state().game!.players[id]!;
    return changeAlignmentIntent(player, registry.alignmentOf(player.actualRole!));
  }) }), "Set sample alignments");
  for (const id of ids) accepted(state().showAssignedRole(id), "Show assigned role");
  accepted(state().revealRoles(), "Reveal sample roles");
  accepted(state().beginNightOne(), "Begin sample game");
  accepted(state().advancePhase(), "Day 1");
  accepted(state().advancePhase(), "Night 2");
  accepted(state().recordDeath(ids[7]!), "Give Hana a dead vote");
  accepted(state().recordDeath(ids[8]!), "Mark Ignatius dead");
  accepted(state().spendGhostVote(ids[8]!), "Use Ignatius's dead vote");
  accepted(state().advancePhase(), "Day 2");
  const bind = (id: PlayerId) => ({ playerId: id, participantId: state().game!.players[id]!.participantId! });
  const game = state().game!;
  accepted(state().resolveVoting({ kind: "bureaucrat", code: game.code, day: game.day,
    expectedRevision: game.voting?.revision ?? 0, modifierId: "trial-bureaucrat-day-2",
    source: bind(ids[ordinaryCount]!), target: bind(ids[2]!) }, captureVotingContext()), "Give Cass three votes");
  state().selectPlayer(null);
  state().setView("game");
  // Seed construction is not a review action. Keep Undo for actions the user takes.
  useStorytellerStore.setState({ undoStack: [], seatSwapUndo: [] });
}
