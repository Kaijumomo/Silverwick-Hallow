import { participantStepKey } from "@/stores/nightProgress";
import type { AbilityLifeIntent, AbilityOutcome, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { scarletWomanSuccession } from "./characters/scarletWoman";

/** Verify the complete automatic death chain before committing. Eligibility
 * belongs to the immediate pre-death state, never post-death source cleanup.
 * Manual outcomes and historical corrections do not enter this guard. */
export function incompleteSuccessionReason(
  query: RulesQuery,
  outcome: AbilityOutcome,
  action: { actor: ParticipantBinding; roleId: string },
  intents: readonly AbilityLifeIntent[] = outcome.operations.flatMap(op => op.domain === "life" ? op.intents : []),
  _after?: RulesQuery,
): string | undefined {
  const deaths = intents.filter(intent => intent.kind === "death" && query.participant(intent.target)?.alive);
  // Multi-death batches can remove an impairment source before a later death.
  // B4 supports one death per automatic action; do not pretend a single query
  // proves every intermediate state in an exceptional compound batch.
  if (deaths.length > 1 && Object.values(query.game.players).some(p => !p.isEmpty && p.alive && p.actualRole === "scarletwoman"))
    return "Scarlet Woman succession across multiple deaths requires manual resolution.";
  for (const death of deaths) {
    const succession = scarletWomanSuccession(query, death.target, action.roleId === "slayer" ? "slayer" : undefined);
    if (succession.kind === "manual") return succession.reason;
    if (succession.kind === "none") continue;
    const binding = succession.target;
    const allDeaths = outcome.operations.flatMap(op => op.domain === "life" ? op.intents.filter(intent => intent.kind === "death") : []);
    const selfPass = action.roleId === "imp" && death.target.participantId === action.actor.participantId;
    const complete = allDeaths.length === 1 && ["imp", "slayer"].includes(action.roleId) &&
      outcome.operations.some(op => op.domain === "role" && op.intents.some(intent =>
        intent.kind === "changeActualRole" && intent.target.playerId === binding.playerId &&
        intent.target.participantId === binding.participantId && intent.actualRole === "imp")) &&
      outcome.operations.some(op => op.domain === "role" && op.intents.some(intent =>
        intent.kind === "setPerception" && intent.target.playerId === binding.playerId &&
        intent.target.participantId === binding.participantId && intent.shownRole === "imp")) &&
      (!selfPass || outcome.operations.some(op => op.domain === "nightStep" && op.day === query.game.day &&
        op.stepKey === participantStepKey(binding.participantId, "imp") && op.status === "skipped"));
    if (!complete) return "Scarlet Woman succession is not fully modeled for this action -- resolve the entire action manually.";
  }
}
