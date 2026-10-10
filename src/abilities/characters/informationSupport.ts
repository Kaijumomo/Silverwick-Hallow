import type { AbilityEvaluation, AbilityEvaluationContext } from "../semantics";

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
