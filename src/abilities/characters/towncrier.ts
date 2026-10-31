import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";
import { informationAbilityRefusal } from "./informationSupport";

/**
 * Town Crier -- GUIDED (Treacherous 30th, owner-authorized; information support rules of
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 8).
 * https://wiki.bloodontheclocktower.com/Town_Crier
 *
 * "Each night*, you learn if a Minion nominated today." Other Nights. A true / false
 * Information Action. The answer reads the Day just ended from the Voting record: any
 * regular nomination (not an exile) whose nominator registers as a Minion makes it Yes. The
 * record must be complete (known coverage) and every nominator's registration known
 * (a Spy or Recluse is the Storyteller's call -> Manual). Impaired / simulated: the
 * Storyteller chooses the answer shown.
 */
export const COMMUNICATED = "communicated";

function deliver(context: AbilityEvaluationContext, value: boolean): AbilityEvaluation {
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "towncrier-other-night",
    values: [{ requirementId: "minionNominated", kind: "boolean", value }] }]);
}

export const TOWN_CRIER: AbilityDescriptor = {
  roleId: "towncrier",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information", "registration"],
  informationActions: ["towncrier-other-night"],
  presentation: { complexity: "simple", action: "Show whether a Minion nominated today" },
  evaluator: (context) => {
    const dead = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (dead) return dead;
    const moment = context.query.moment();
    if (!moment || moment.phase !== "night" || moment.day <= 1) return { kind: "notApplicable", message: "There was no previous Day to learn about." };
    if (context.simulated || !context.functioning) {
      const told = answerOf(context.inputs, COMMUNICATED, "boolean");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Town Crier ability. Choose the answer to show."
        : "This Town Crier's ability is not functioning. Choose the answer to show.",
      { id: COMMUNICATED, kind: "boolean", source: "storyteller", label: "Show YES (a Minion nominated today)" });
      return deliver(context, told.value);
    }
    const voting = context.query.game.voting;
    if (!voting || voting.day !== moment.day - 1 || voting.coverage !== "known") {
      return { kind: "unsupported", message: "The previous Day's nomination record is incomplete. Resolve this information manually." };
    }
    for (const round of voting.rounds) {
      if (round.mode !== "nomination") continue;
      const nominator = { playerId: round.nominator.playerId, participantId: round.nominator.participantId };
      if (!context.query.participant(nominator)) return { kind: "unsupported", message: "A nominator's seat changed: the Storyteller decides." };
      const registered = context.query.registersAsType(nominator, "minion", "towncrier");
      if (!registered.known) return { kind: "unsupported", message: registered.reason };
      if (registered.value) return deliver(context, true);
    }
    return deliver(context, false);
  },
};
