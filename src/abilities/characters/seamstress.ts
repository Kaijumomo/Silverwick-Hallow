import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { Alignment } from "@/stores/types";
import { answerOf, ask, lifeOperation, nameOf, outcome, participantsOf, requireLivingActor, subjectId } from "./shared";
import { informationAbilityRefusal, possibleAlignments, possibleAnswers } from "./informationSupport";

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
 * A Vortox in play makes the whole step Manual through the shared information modifier (passiveRules.ts) until the Vortox merge.
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
    if (context.simulated || !context.functioning) {
      const id = subjectId(SEAMSTRESS_COMMUNICATED, ...targets);
      const told = answerOf(context.inputs, id, "boolean");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Seamstress ability. Choose the answer to show."
        : "This Seamstress's ability is not functioning: the choice uses it. Choose the answer to show.",
      { id, kind: "boolean", source: "storyteller", label: "Show YES (the same alignment)" });
      return deliver(context, targets, told.value);
    }
    const forms: (readonly Alignment[])[] = [];
    const doubtful: ParticipantBinding[] = [];
    for (const target of targets) {
      const alignments = possibleAlignments(context.query, target, "seamstress");
      if (!alignments.known) return { kind: "unsupported", message: alignments.reason };
      if (alignments.forms.length > 1) doubtful.push(target);
      forms.push(alignments.forms);
    }
    const answers = possibleAnswers(forms, ([first, second]) => [first === second]);
    if (answers.length === 1) return deliver(context, targets, answers[0]!);
    const id = subjectId(SEAMSTRESS_SAME, ...targets);
    const ruled = answerOf(context.inputs, id, "boolean");
    if (!ruled) return ask(`${doubtful.map((who) => nameOf(context, who)).join(" and ")} may register as good or evil to the Seamstress. Do ${targets.map((who) => nameOf(context, who)).join(" and ")} register as the same alignment?`,
      { id, kind: "boolean", source: "storyteller", label: "They register as the same alignment (Yes: the Seamstress learns YES; No: NO)" });
    return deliver(context, targets, ruled.value);
  },
};
