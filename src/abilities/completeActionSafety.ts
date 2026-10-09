import { isCanonicalRole } from "@/data/canonical";
import { participantStepKey } from "@/stores/nightProgress";
import type { AbilityLifeIntent, AbilityOutcome, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";

/** B0 coverage boundary, not a succession resolver. General Scarlet Woman
 * succession remains manual. Only the already modeled Imp self-pass is exempt.
 * The coordinator repeats this against each tentative Life operation, including
 * source-effect cleanup, before any part of the action can be committed. */
export function incompleteSuccessionReason(
  query: RulesQuery,
  outcome: AbilityOutcome,
  action: { actor: ParticipantBinding; roleId: string },
  intents: readonly AbilityLifeIntent[] = outcome.operations.flatMap(op => op.domain === "life" ? op.intents : []),
  after?: RulesQuery,
): string | undefined {
  const living = Object.values(query.game.players).filter(p => !p.isEmpty && p.participantId && p.alive && !p.isTraveler);
  if (living.length < 5) return;
  const deaths = intents.filter(intent => intent.kind === "death" && query.participant(intent.target)?.alive);
  const demonDeaths = deaths.filter(intent => query.roleOf(query.participant(intent.target)!.actualRole)?.type === "demon");
  if (!demonDeaths.length) return;
  const scarletWoman = query.roleOf("scarletwoman");
  if (!scarletWoman || !isCanonicalRole(scarletWoman)) return;
  for (const player of living.filter(p => p.actualRole === "scarletwoman")) {
    const binding = { playerId: player.id, participantId: player.participantId! };
    const functions = query.abilityFunctions(binding);
    const later = after?.abilityFunctions(binding);
    if (functions.known && !functions.value && (!later || (later.known && !later.value))) continue;
    const allDeaths = outcome.operations.flatMap(op => op.domain === "life" ? op.intents.filter(intent => intent.kind === "death") : []);
    const completeSelfPass = allDeaths.length === 1 && demonDeaths.length === 1 &&
      action.roleId === "imp" && query.participant(action.actor)?.actualRole === "imp" &&
      demonDeaths[0]!.target.participantId === action.actor.participantId &&
      outcome.operations.some(op => op.domain === "role" && op.intents.some(intent =>
        intent.kind === "changeActualRole" && intent.target.playerId === binding.playerId &&
        intent.target.participantId === binding.participantId && intent.actualRole === "imp")) &&
      outcome.operations.some(op => op.domain === "nightStep" && op.day === query.game.day &&
        op.stepKey === participantStepKey(binding.participantId, "imp") && op.status === "skipped");
    if (!completeSelfPass) return "Scarlet Woman succession is not fully modeled for this action -- resolve the entire action manually.";
  }
}
