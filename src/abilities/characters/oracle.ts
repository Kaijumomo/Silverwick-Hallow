import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";
import { informationAbilityRefusal, storytellerChooses } from "./informationSupport";
import { FALSE_INFORMATION_REFUSED, numberTruth, unknownTruth } from "../falseInformation";
import type { RulesQuery } from "@/stores/rulesQuery";

/**
 * Oracle -- GUIDED (Treacherous 30th, owner-authorized; information support rules of
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 8).
 * https://wiki.bloodontheclocktower.com/Oracle
 *
 * "Each night*, you learn how many dead players are evil." Other Nights. A number
 * Information Action: every dead participant (Travellers included) whose alignment
 * registers as evil. A dead Spy or Recluse (optional registration) or any ambiguous
 * registration is the Storyteller's call -> Manual. Impaired / simulated: the Storyteller
 * chooses the number shown. SV-5i: a Vortox makes the number false (src/abilities/falseInformation.ts): the true count is worked out
 * as above, for a drunk or poisoned Oracle too, and the Storyteller chooses any other number.
 */
export const COMMUNICATED = "communicated";
const ANSWER = "deadEvil";

function deliver(context: AbilityEvaluationContext, value: number): AbilityEvaluation {
  if (!Number.isInteger(value) || value < 0) return { kind: "illegal", message: "The Oracle learns a whole number from 0 up." };
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "oracle-other-night",
    values: [{ requirementId: ANSWER, kind: "number", value }] }]);
}

/** How many dead players register as evil to the Oracle (an unknown registration: the Storyteller's, by hand). Shared by the evaluator,
 * the descriptor's truth and the Night card (SV-5i). */
export function oracleDeadEvil(query: RulesQuery): { known: true; value: number } | { known: false; reason: string } {
  let evil = 0;
  for (const player of Object.values(query.game.players)) {
    if (player.isEmpty || !player.participantId || player.alive) continue;
    const alignment = query.registration({ playerId: player.id, participantId: player.participantId }, "oracle").alignment;
    if (!alignment.known) return { known: false, reason: alignment.reason };
    if (alignment.value === "evil") evil++;
  }
  return { known: true, value: evil };
}

/** The numbers the Night card offers when the Storyteller chooses: 0 to the number of dead players (at least 0 to 2). */
export const oracleChoices = (query: RulesQuery): number[] =>
  Array.from({ length: Math.max(2, Object.values(query.game.players).filter((player) => !player.isEmpty && player.participantId && !player.alive).length) + 1 }, (_, index) => index);

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
    if (storytellerChooses(context)) {
      const told = answerOf(context.inputs, COMMUNICATED, "number");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Oracle ability. Choose the number to show."
        : "This Oracle's ability is not functioning. Choose the number to show.",
      { id: COMMUNICATED, kind: "number", source: "storyteller", label: "The number of dead evil players shown" });
      return deliver(context, told.value);
    }
    const truth = oracleDeadEvil(context.query);
    if (!truth.known) return { kind: "unsupported", message: truth.reason };
    if (!context.mustBeFalse) return deliver(context, truth.value);
    // SV-5i: under a Vortox (a drunk or poisoned Oracle too) the Storyteller chooses any number but the true one.
    const told = answerOf(context.inputs, COMMUNICATED, "number");
    if (!told) return ask("A Vortox is in play: choose a false number to show.",
      { id: COMMUNICATED, kind: "number", source: "storyteller", label: "The number of dead evil players shown", exclude: [truth.value] });
    if (told.value === truth.value) return { kind: "illegal", message: FALSE_INFORMATION_REFUSED };
    return deliver(context, told.value);
  },
  truth: (context) => {
    const truth = oracleDeadEvil(context.query);
    return truth.known ? numberTruth(ANSWER, [truth.value]) : unknownTruth(truth.reason);
  },
};
