import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";

/**
 * Empath -- SUPPORT SEMANTIC (matrix Sections 8 and 18.2), required to prove
 * Drunk shown as the Empath.
 *
 * "Each night, you learn how many of your 2 alive neighbors are evil."
 * Functioning actual Empath: the two closest LIVING neighbours (Rules Query;
 * empty seats and the dead are skipped); each one's registered alignment to
 * the Empath. All known -> 0/1/2 is computed; any ambiguous registration -> the
 * Storyteller's explicit judgment of the final 0/1/2.
 *
 * Simulated (Drunk shown as the Empath) or impaired: there is no Empath
 * mechanic. The Storyteller supplies the communicated 0/1/2 (true or false --
 * no rule says it must be false); only the Information Delivery is recorded
 * (performedRole = empath for the simulated wake, enforced by the coordinator).
 */
export const COMMUNICATED = "communicated";
export const EMPATH_JUDGMENT = "empath:evilNeighbours";

const actionId = (context: AbilityEvaluationContext) => context.query.game.day === 1 ? "empath-first-night" : "empath-other-night";
const VALID = [0, 1, 2];

function deliver(context: AbilityEvaluationContext, value: number): AbilityEvaluation {
  if (!VALID.includes(value)) return { kind: "illegal", message: "The Empath learns 0, 1 or 2." };
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: actionId(context),
    values: [{ requirementId: "evilNeighbors", kind: "number", value }] }]);
}

export const EMPATH: AbilityDescriptor = {
  roleId: "empath",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information", "registration"],
  informationActions: ["empath-first-night", "empath-other-night"],
  presentation: { complexity: "simple", action: "Show how many living neighbours are evil" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) {
      const told = answerOf(context.inputs, COMMUNICATED, "number");
      if (!told) {
        return ask(context.simulated
          ? "Simulated wake: this player has no Empath ability. Choose the number to show."
          : "This Empath's ability is not functioning. Choose the number to show.",
        { id: COMMUNICATED, kind: "number", source: "storyteller", label: "The number shown (0, 1 or 2)" });
      }
      return deliver(context, told.value);
    }
    const neighbours = context.query.aliveNeighbours(context.actor.binding);
    const judged = answerOf(context.judgments, EMPATH_JUDGMENT, "number");
    const judgment = () => judged ? deliver(context, judged.value)
      : ask("A neighbour's registration is ambiguous: the Storyteller decides the number.",
        { id: EMPATH_JUDGMENT, kind: "number", source: "judgment", label: "Number of evil living neighbours to show (0, 1 or 2)" });
    if (!neighbours.known) return judgment();
    const unique = [neighbours.value.left, neighbours.value.right]
      .filter((binding): binding is ParticipantBinding => !!binding)
      .filter((binding, index, all) => all.findIndex((other) => other.participantId === binding.participantId) === index);
    let evil = 0;
    for (const neighbour of unique) {
      const alignment = context.query.registration(neighbour, "empath").alignment;
      if (!alignment.known) return judgment();
      if (alignment.value === "evil") evil++;
    }
    return deliver(context, evil);
  },
};
