import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { Alignment } from "@/stores/types";
import { answerOf, ask, lifeOperation, nameOf, outcome, participantsOf, requireLivingActor, subjectId } from "./shared";
import { asGiven, informationAbilityRefusal, possibleAlignments, possibleAnswers, storytellerChooses, yesNoTruth, type WorkedTruth } from "./informationSupport";
import { unknownTruth } from "../falseInformation";

/**
 * Seamstress -- GUIDED (SV-5b, Sects & Violets). https://wiki.bloodontheclocktower.com/Seamstress (saved 2026-11-11)
 *
 * "Once per game, at night, choose 2 players (not yourself): you learn if they are the same alignment." "They may choose alive or
 * dead players or even Travellers." How to Run: "Each night, wake the Seamstress. They either shake their head no or point at any two
 * players except themself. If they shake their head no, nothing happens." Otherwise nod or shake; "The Seamstress loses their
 * ability - mark them with the NO ABILITY reminder and remove their night token from the night sheet." Two evil players are "yes".
 *
 * One night step each night until the ability is used (nightOrder WAKES_UNTIL_USED). "Not Tonight" (the head shake) is the Night card's
 * own step completion: nothing is used. Two chosen players are ONE resolution (one Undo): the ability is used through the Life
 * boundary (which places the official NO ABILITY token) and the YES / NO is recorded as an information delivery, kept as given.
 * The answer compares what each player REGISTERS as to the Seamstress (PO Q2, the pages): everyone registers as their actual alignment
 * (a Marionette is evil, a Drunk good) except a healthy Spy or Recluse, who may register as good or evil; where that could change the
 * answer the Storyteller rules YES or NO (one question). Only YES or NO is shown, never why (proposal section 4, item 4).
 * Drunk or poisoned, or a Drunk shown the Seamstress: pointing still uses the ability ("no ability" means it does nothing, not that it
 * is saved) and the Storyteller chooses YES or NO. Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 8, the
 * information support rules; matrix Section 10, the Slayer's once-per-game use: an impaired choice still spends the use).
 * SV-5i: a Vortox makes the answer false (src/abilities/falseInformation.ts): the truth is worked out as above, for a drunk or
 * poisoned Seamstress too (the choice still uses the ability), and the opposite is given.
 */
export const SEAMSTRESS_TARGETS = "targets";
export const SEAMSTRESS_COMMUNICATED = "communicated";
export const SEAMSTRESS_SAME = "seamstress:sameAlignment";

const actionId = (context: AbilityEvaluationContext) => context.query.game.day === 1 ? "seamstress-first-night" : "seamstress-other-night";

function deliver(context: AbilityEvaluationContext, targets: ParticipantBinding[], same: boolean): AbilityEvaluation {
  const use: AbilityOperation = lifeOperation([{ kind: "useAbility", target: context.actor.binding }]);
  return outcome([use, { domain: "information", recipient: context.actor.binding, informationActionId: actionId(context), values: [
    { requirementId: "players", kind: "player", participants: targets },
    { requirementId: "sameAlignment", kind: "boolean", value: same },
  ] }]);
}

/** Do the two players register as the same alignment to the Seamstress? A Spy or Recluse who could change the answer is one ruling.
 * Shared by the evaluator and, under a Vortox, by the descriptor's truth (SV-5i). */
function sameAlignment(context: AbilityEvaluationContext, targets: ParticipantBinding[]): WorkedTruth<boolean> {
  const forms: (readonly Alignment[])[] = [];
  const doubtful: ParticipantBinding[] = [];
  for (const target of targets) {
    const alignments = possibleAlignments(context.query, target, "seamstress");
    if (!alignments.known) return { kind: "unsupported", message: alignments.reason };
    if (alignments.forms.length > 1) doubtful.push(target);
    forms.push(alignments.forms);
  }
  const answers = possibleAnswers(forms, ([first, second]) => [first === second]);
  if (answers.length === 1) return { kind: "known", value: answers[0]! };
  const id = subjectId(SEAMSTRESS_SAME, ...targets);
  const ruled = answerOf(context.inputs, id, "boolean");
  if (ruled) return { kind: "known", value: ruled.value };
  return { kind: "ask", evaluation: ask(`${doubtful.map((who) => nameOf(context, who)).join(" and ")} may register as good or evil to the Seamstress. Do ${targets.map((who) => nameOf(context, who)).join(" and ")} register as the same alignment?`,
    { id, kind: "boolean", source: "storyteller", label: "They register as the same alignment (Yes: the Seamstress learns YES; No: NO)" }) };
}

export const SEAMSTRESS: AbilityDescriptor = {
  roleId: "seamstress",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "oncePerGame" },
  inputs: [{ id: SEAMSTRESS_TARGETS, kind: "participant", source: "player", count: 2, constraints: ["notSelf", "distinct"], label: "The two players chosen" }],
  hooks: ["information", "registration"],
  informationActions: ["seamstress-first-night", "seamstress-other-night"],
  presentation: { complexity: "simple", action: "Choose 2 players: learn if they are the same alignment" },
  evaluator: (context) => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    const targets = participantsOf(context.inputs, SEAMSTRESS_TARGETS)!;
    if (targets.length !== 2 || targets[0]!.participantId === targets[1]!.participantId) return { kind: "illegal", message: "Choose two different players." };
    if (storytellerChooses(context)) {
      const id = subjectId(SEAMSTRESS_COMMUNICATED, ...targets);
      const told = answerOf(context.inputs, id, "boolean");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Seamstress ability. Choose the answer to show."
        : "This Seamstress's ability is not functioning: the choice uses it. Choose the answer to show.",
      { id, kind: "boolean", source: "storyteller", label: "Show YES (the same alignment)" });
      return deliver(context, targets, told.value);
    }
    // SV-5i: under a Vortox the truth is worked out the same way (a drunk or poisoned Seamstress too, the Spy / Recluse ruling included)
    // and given as its opposite.
    const truth = sameAlignment(context, targets);
    if (truth.kind === "unsupported") return { kind: "unsupported", message: truth.message };
    if (truth.kind === "ask") return truth.evaluation;
    return deliver(context, targets, asGiven(context, truth.value));
  },
  truth: (context) => {
    const targets = participantsOf(context.inputs, SEAMSTRESS_TARGETS) ?? [];
    return targets.length === 2 ? yesNoTruth("sameAlignment", sameAlignment(context, targets)) : unknownTruth("Choose two different players.");
  },
};
