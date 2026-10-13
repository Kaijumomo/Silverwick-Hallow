import type { AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { isCanonicalRole } from "@/data/canonical";

/** R1: a healthy canonical Recluse supplies an optional, per-interaction
 * information choice. Unknown impairment or an explicit registration Effect
 * still requires whole-action manual resolution; no registration is saved. */
export function recluseInformationChoice(context: AbilityEvaluationContext, target: ParticipantBinding): boolean {
  const player = context.query.participant(target);
  const role = player && context.query.roleOf(player.actualRole);
  if (!player || !player.actualAlignment || role?.id !== "recluse" || !isCanonicalRole(role)
    || player.effects.some(effect => effect.state === "active" && effect.type === "registersFalsely")) return false;
  const functioning = context.query.abilityFunctions(target);
  return functioning.known && functioning.value;
}

/** B5 information support extends PHASE10F_CHARACTER_RULES_MATRIX.md.
 * Losing an ability is not drunkenness/poisoning: it grants no simulated
 * information interaction. Read applicability through the existing query,
 * including source-dependent and suppressed effects; never read reminders.
 */
export function informationAbilityRefusal(context: AbilityEvaluationContext): AbilityEvaluation | undefined {
  for (const effect of context.actor.player.effects) {
    if (effect.type !== "abilityLost") continue;
    const applies = context.query.effectApplies(context.actor.binding, effect);
    if (!applies.known) return { kind: "unsupported", message: applies.reason };
    if (applies.value) return { kind: "notApplicable", message: "This player has lost their ability." };
  }
}
