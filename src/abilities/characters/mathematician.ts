import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { RulesQuery } from "@/stores/rulesQuery";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";
import { informationAbilityRefusal, storytellerChooses } from "./informationSupport";
import { FALSE_INFORMATION_REFUSED, numberTruth } from "../falseInformation";
import { abnormalCount } from "@/stores/abnormalMarks";

/**
 * Mathematician -- GUIDED (SV-5g, Sects & Violets part 2c; PO build approval 2026-11-23; proposal sections 39-42).
 * https://wiki.bloodontheclocktower.com/Mathematician. Information support rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 8.
 *
 * "Each night, you learn how many players' abilities worked abnormally (since dawn) due to another character's ability." Every night,
 * the first included. The count is the number of players holding an ABNORMAL mark (stores/abnormalMarks.ts), the Mathematician himself
 * left out ("does not detect their own ability failing"). The marks are the ones the app proves by itself (PO Q17 A: a Vortox's false
 * information, impaired information proven false; abilities/abnormalInformation.ts) and the ones the Storyteller places by hand with the
 * official ABNORMAL token (PO Q7 A). The app never decides by itself which other abilities "should have worked"; the Chambermaid, Drunk,
 * Marionette and Lunatic jinxes stay the Storyteller's, by hand.
 * The Night card shows only the count, for a finger signal (PO Q1: no player screen). The commit clears every mark (PO Q18 A, "Remove all
 * ABNORMAL reminders"); a mark made later that Night expires at dawn uncounted. Drunk or poisoned, or a Drunk shown the Mathematician:
 * the Storyteller chooses the number. A Vortox makes it false (src/abilities/falseInformation.ts): any number but the true count.
 */
export const MATHEMATICIAN_COMMUNICATED = "communicated";
const ANSWER = "abnormal";

const actionId = (context: AbilityEvaluationContext) => context.query.game.day === 1 ? "mathematician-first-night" : "mathematician-other-night";

/** The true count for this Mathematician: players with an ABNORMAL mark, not counting himself. */
export const mathematicianCount = (query: RulesQuery, participantId: string): number => abnormalCount(query.game, participantId);

/** The numbers the Night card offers when the Storyteller chooses: 0 to 5 (the five official ABNORMAL tokens), or up to the true count when
 * it is higher, and never more than the other seated players. */
export function mathematicianChoices(query: RulesQuery, participantId: string): number[] {
  const others = Object.values(query.game.players).filter((player) => !player.isEmpty && player.participantId && player.participantId !== participantId).length;
  const top = Math.max(1, Math.min(others, Math.max(5, mathematicianCount(query, participantId))));
  return Array.from({ length: top + 1 }, (_, index) => index);
}

function deliver(context: AbilityEvaluationContext, value: number): AbilityEvaluation {
  if (!mathematicianChoices(context.query, context.actor.binding.participantId).includes(value)) return { kind: "illegal", message: "Choose a number of players this table can have." };
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: actionId(context),
    values: [{ requirementId: ANSWER, kind: "number", value }] }]);
}

export const MATHEMATICIAN: AbilityDescriptor = {
  roleId: "mathematician",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information"],
  informationActions: ["mathematician-first-night", "mathematician-other-night"],
  presentation: { complexity: "simple", action: "Show how many players' abilities worked abnormally since dawn" },
  evaluator: (context) => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    if (storytellerChooses(context)) {
      const told = answerOf(context.inputs, MATHEMATICIAN_COMMUNICATED, "number");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Mathematician ability. Choose the number to show."
        : "This Mathematician's ability is not functioning. Choose the number to show.",
      { id: MATHEMATICIAN_COMMUNICATED, kind: "number", source: "storyteller", label: "The number of abnormal abilities shown" });
      return deliver(context, told.value);
    }
    const count = mathematicianCount(context.query, context.actor.binding.participantId);
    if (!context.mustBeFalse) return deliver(context, count);
    // Under a Vortox (a drunk or poisoned Mathematician too) the Storyteller chooses any number but the true count.
    const told = answerOf(context.inputs, MATHEMATICIAN_COMMUNICATED, "number");
    if (!told) return ask("A Vortox is in play: choose a false number to show.",
      { id: MATHEMATICIAN_COMMUNICATED, kind: "number", source: "storyteller", label: "The number of abnormal abilities shown", exclude: [count] });
    if (told.value === count) return { kind: "illegal", message: FALSE_INFORMATION_REFUSED };
    return deliver(context, told.value);
  },
  truth: (context) => numberTruth(ANSWER, [mathematicianCount(context.query, context.actor.binding.participantId)]),
};
