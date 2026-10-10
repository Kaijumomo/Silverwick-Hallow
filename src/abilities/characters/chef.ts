import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { RulesQuery } from "@/stores/rulesQuery";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";
import { informationAbilityRefusal } from "./informationSupport";

/** B5 extends PHASE10F_CHARACTER_RULES_MATRIX.md information semantics.
 * https://wiki.bloodontheclocktower.com/Chef
 * Count the edges of the actual seating ring, including the closing edge and
 * overlapping pairs. Death does not remove a participant from Chef seating.
 * Optional registration is contextual even for each edge: never choose it.
 */
export const CHEF_COMMUNICATED = "communicated";
const ringOf = (query: RulesQuery) => query.game.seatOrder.flatMap(id => {
  const player = query.game.players[id];
  return player && !player.isEmpty && player.participantId ? [player] : [];
});
export const chefMaximumPairs = (query: RulesQuery): number => {
  const count = ringOf(query).length;
  return count < 3 ? Math.max(0, count - 1) : count;
};

function deliver(context: AbilityEvaluationContext, value: number): AbilityEvaluation {
  if (!Number.isInteger(value) || value < 0 || value > chefMaximumPairs(context.query))
    return { kind: "illegal", message: "Choose a whole number within the number of neighbouring pairs." };
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "chef-first-night",
    values: [{ requirementId: "pairs", kind: "number", value }] }]);
}

export const CHEF: AbilityDescriptor = {
  roleId: "chef", timing: ["firstNight"], invocation: "wake", usage: { kind: "unlimited" }, inputs: [],
  hooks: ["information", "registration"], informationActions: ["chef-first-night"],
  presentation: { complexity: "simple", action: "Show how many neighbouring pairs are evil" },
  evaluator: context => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    if (context.simulated || !context.functioning) {
      const told = answerOf(context.inputs, CHEF_COMMUNICATED, "number");
      return told ? deliver(context, told.value) : ask("Choose the number to show.",
        { id: CHEF_COMMUNICATED, kind: "number", source: "storyteller", label: "Number of evil pairs shown" });
    }
    const ring = ringOf(context.query);
    let pairs = 0;
    const edges = chefMaximumPairs(context.query);
    for (let index = 0; index < edges; index++) {
      const pair = [ring[index]!, ring[(index + 1) % ring.length]!];
      const registrations = pair.map(player => context.query.registration(
        { playerId: player.id, participantId: player.participantId! }, "chef").alignment);
      // An indisputably good endpoint makes this edge irrelevant to any
      // discretionary registration at its other endpoint.
      if (registrations.some(answer => answer.known && answer.value === "good")) continue;
      if (registrations.some(answer => !answer.known)) return { kind: "unsupported",
        message: "A neighbouring pair depends on discretionary registration. Resolve this information manually." };
      pairs++;
    }
    return deliver(context, pairs);
  },
};
