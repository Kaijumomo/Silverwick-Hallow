import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { answerOf, ask, nameOf, outcome, requireLivingActor, subjectId } from "./shared";
import { informationAbilityRefusal } from "./informationSupport";

/**
 * Town Crier -- GUIDED (Treacherous 30th, owner-authorized; information support rules of
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 8).
 * https://wiki.bloodontheclocktower.com/Town_Crier
 *
 * "Each night*, you learn if a Minion nominated today." Other Nights. A true / false
 * Information Action. The answer reads the Day just ended from the Voting record: any
 * regular nomination (not an exile) whose nominator registers as a Minion makes it Yes. The
 * record must be complete (known coverage). A nominator whose registration is the Storyteller's
 * call (a Spy or Recluse) is put to the Storyteller as ONE question ("did a Minion nominate today?"),
 * like the Godfather's, unless a Minion certainly nominated (then YES). Impaired / simulated: the
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
    // Nominators whose registration is the Storyteller's call (a Spy, a Recluse): whether they count is never guessed.
    const doubtful: ParticipantBinding[] = [];
    for (const round of voting.rounds) {
      if (round.mode !== "nomination") continue;
      const nominator = { playerId: round.nominator.playerId, participantId: round.nominator.participantId };
      if (!context.query.participant(nominator)) return { kind: "unsupported", message: "A nominator's seat changed: the Storyteller decides." };
      const registered = context.query.registersAsType(nominator, "minion", "towncrier");
      if (!registered.known) { if (!doubtful.some((who) => who.participantId === nominator.participantId)) doubtful.push(nominator); continue; }
      if (registered.value) return deliver(context, true);
    }
    if (doubtful.length) {
      const id = subjectId("towncrier:minionNominated", ...doubtful);
      const ruled = answerOf(context.inputs, id, "boolean");
      if (!ruled) return ask(`${doubtful.map((who) => nameOf(context, who)).join(" and ")} nominated during the Day and may register as a Minion. Did a Minion nominate today?`,
        { id, kind: "boolean", source: "storyteller", label: "A Minion nominated today (Yes: the Town Crier learns YES; No: NO)" });
      return deliver(context, ruled.value);
    }
    return deliver(context, false);
  },
};
