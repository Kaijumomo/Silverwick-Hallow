import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { isTabletTrial } from "@/config/trial";
import { useStorytellerStore } from "@/stores/storytellerStore";
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
  // This mixed-script practice table contains unreviewed interactions. Record
  // the Storyteller's sample selection as notation; its vote contribution is
  // entered with the existing explicit voting adjustment during practice.
  accepted(state().resolveReminders({ intents: [{ kind: "place", target: bind(ids[2]!), reminder: {
    label: "3 Votes", source: bind(ids[ordinaryCount]!), sourceCharacter: "bureaucrat",
    note: "Sample selection: enter the vote contribution manually after adjudicating the ability.",
  } }] }), "Record Cass's sample Bureaucrat selection");
  state().selectPlayer(null);
  state().setView("game");
  // Seed construction is not a review action. Keep Undo for actions the user takes.
  useStorytellerStore.setState({ undoStack: [], seatSwapUndo: [] });
}

/** Same participants as the approved Claude reference; isolated trial data only. */
export function seedShellDesignTrial(): void {
  if (!isTabletTrial || state().lobby) throw new Error("The design table requires an offline trial.");
  const names = ["Ada", "Bram", "Cleo", "Dmitri", "Elspeth", "Felix", "Greta", "Hollis", "Iris", "Jonah", "Kestrel", "Lior", "Mara", "Nico", "Odette", "Pim", "Quill", "Rosa", "Silas", "Tamsin"];
  const roles = ["washerwoman", "empath", "fortuneteller", "butler", "poisoner", "monk", "undertaker", "imp", "virgin", "spy", "slayer", "gunslinger", "investigator", "chef", "thief", "recluse", "scarletwoman", "bureaucrat", "scapegoat", "beggar"];
  const id = "silverwick-shell-design-trial";
  if (!state().customScripts[id]) accepted(state().addCustomScript({ id, name: "Trouble Brewing", author: "Shell design reference", characters: canonicalRoles(roles) }), "Prepare design table");
  state().newGame(id, { plannedPlayerCount: 20, plannedTravelerCount: 5 });
  names.forEach(name => state().addPlayerToSeat(name));
  const ids = [...state().game!.seatOrder];
  const travelers = new Set([11, 14, 17, 18, 19]);
  for (let i = 0; i < ids.length; i++) {
    const traveler = travelers.has(i);
    if (state().game!.players[ids[i]!]!.isTraveler !== traveler) accepted(state().setIsTraveler(ids[i]!, traveler), "Set design seat type");
    if (traveler) accepted(state().assignRole(ids[i]!, roles[i]!), "Assign design Traveler");
  }
  state().setRolePool(roles.filter((_, i) => !travelers.has(i)));
  accepted(state().dealRolePool(), "Deal design roles");
  for (let i = 0; i < ids.length; i++) if (!travelers.has(i)) accepted(state().assignRole(ids[i]!, roles[i]!), "Assign design role");
  const registry = buildRegistry(state().customScripts[id]!);
  accepted(state().resolveAlignments({ intents: ids.map((playerId, i) => changeAlignmentIntent(state().game!.players[playerId]!, travelers.has(i) ? "good" : registry.alignmentOf(roles[i]!))) }), "Set design alignments");
  for (const playerId of ids) accepted(state().showAssignedRole(playerId), "Show design role");
  accepted(state().revealRoles(), "Reveal design roles");
  accepted(state().beginNightOne(), "Begin design game");
  accepted(state().advancePhase(), "Design Day 1");
  accepted(state().recordDeath(ids[3]!), "Record Dmitri death");
  accepted(state().recordDeath(ids[15]!), "Record Pim death");
  accepted(state().spendGhostVote(ids[15]!), "Spend Pim vote");
  accepted(state().advancePhase(), "Design Night 2");
  for (const [index, label, sourceCharacter] of [[1, "Townsfolk", "washerwoman"], [2, "Wrong", "washerwoman"], [10, "Red Herring", "fortuneteller"], [5, "Master", "butler"], [3, "Executed", "undertaker"], [9, "Minion", "investigator"], [13, "Wrong", "investigator"]] as const) {
    if (!state().addReminder(ids[index]!, { label, sourceCharacter })) throw new Error("Design reminder could not be added.");
  }
  state().selectPlayer(null);
  state().setView("game");
  useStorytellerStore.setState({ undoStack: [], seatSwapUndo: [] });
}
