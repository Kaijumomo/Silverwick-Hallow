import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";
import { informationAbilityRefusal } from "./informationSupport";

/**
 * Oracle -- GUIDED (Treacherous 30th, owner-authorized; information support rules of
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 8).
 * https://wiki.bloodontheclocktower.com/Oracle
 *
 * "Each night*, you learn how many dead players are evil." Other Nights. A number
 * Information Action: every dead participant (Travellers included) whose alignment
 * registers as evil. A dead Spy or Recluse (optional registration) or any ambiguous
 * registration is the Storyteller's call -> Manual. Impaired / simulated: the Storyteller
 * chooses the number shown.
 */
export const COMMUNICATED = "communicated";

function deliver(context: AbilityEvaluationContext, value: number): AbilityEvaluation {
  if (!Number.isInteger(value) || value < 0) return { kind: "illegal", message: "The Oracle learns a whole number from 0 up." };
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "oracle-other-night",
    values: [{ requirementId: "deadEvil", kind: "number", value }] }]);
}

export const ORACLE: AbilityDescriptor = {
  roleId: "oracle",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information", "registration"],
  informationActions: ["oracle-other-night"],
  presentation: { complexity: "simple", action: "Show how many dead players are evil" },
  evaluator: (context) => {
    const dead = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) {
      const told = answerOf(context.inputs, COMMUNICATED, "number");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Oracle ability. Choose the number to show."
        : "This Oracle's ability is not functioning. Choose the number to show.",
      { id: COMMUNICATED, kind: "number", source: "storyteller", label: "The number of dead evil players shown" });
      return deliver(context, told.value);
    }
    let evil = 0;
    for (const player of Object.values(context.query.game.players)) {
      if (player.isEmpty || !player.participantId || player.alive) continue;
      const alignment = context.query.registration({ playerId: player.id, participantId: player.participantId }, "oracle").alignment;
      if (!alignment.known) return { kind: "unsupported", message: alignment.reason };
      if (alignment.value === "evil") evil++;
    }
    return deliver(context, evil);
  },
};
