import type { AbilityDescriptor, AbilityEvaluationContext, InformationTruth } from "./semantics";
import type { AbilityInformationValue, AbilityOutcome } from "@/stores/abilityResolution";
import type { QueryAnswer, RulesQuery } from "@/stores/rulesQuery";
import { townsfolkInformationFalse } from "./characters/passiveRules";

/**
 * SV-5h: THE shared false-information rule (Sects & Violets part 3, PO build approval 2026-11-22; proposal sections 22 and 26).
 * https://wiki.bloodontheclocktower.com/Vortox: "Townsfolk abilities yield false info." "Anytime a Townsfolk player gets information
 * from their ability, they get false information. Even if they are drunk or poisoned, it must be false." It "does not affect
 * information gained by other means".
 *
 * One rule, read by the ability coordinator for every descriptor, never a per-character workaround:
 *  - WHEN (`falseInformationApplies`): the performed ability is a Townsfolk ability whose descriptor declares its `truth`, the actor
 *    really has it (a simulated wake -- a Drunk shown a Townsfolk -- has no Townsfolk ability, so its information stays the
 *    Storyteller's free choice), and a Vortox is alive and functioning (passiveRules `townsfolkInformationFalse`). Derived each time.
 *  - WHAT: the evaluator receives `mustBeFalse` and works out the truth exactly as it does for true information (the Spy and Recluse
 *    rulings included); a Yes / No is then given as its opposite, and a number, token or pair is the Storyteller's choice among the
 *    answers that are not true (PO Q10 A).
 *  - ENFORCED (`falseInformationRefusal`): whatever the evaluator or the Night card did, no delivered value the descriptor's truth
 *    calls true is accepted, and an unknown truth sends the step to the Storyteller, by hand.
 *  - A Townsfolk ability with no `truth` stays wholly by hand while the rule applies (the Vortox's information modifier gates it).
 * It reads only information prompts: kills, protections and choices still work, and nothing is stored or shown as "poisoned".
 */
export const FALSE_INFORMATION_REFUSED = "A Vortox is in play: this information must be false. Choose an answer that is not true.";

export function falseInformationApplies(query: RulesQuery, descriptor: AbilityDescriptor, roleId: string, simulated: boolean): QueryAnswer<boolean> {
  if (simulated || !descriptor.truth) return { known: true, value: false };
  return townsfolkInformationFalse(query, roleId);
}

/** The coordinator's generic check of an evaluated outcome while information must be false: null when every delivered value is
 * false, otherwise the refusal. */
export function falseInformationRefusal(descriptor: AbilityDescriptor, context: AbilityEvaluationContext, outcome: AbilityOutcome):
  { kind: "unsupported" | "illegal"; message: string } | null {
  const truth = descriptor.truth?.(context);
  if (!truth) return { kind: "unsupported", message: "This information must be false, and its truth is not modelled. Resolve it by hand." };
  if (!truth.known) return { kind: "unsupported", message: truth.reason };
  for (const operation of outcome.operations) {
    if (operation.domain !== "information") continue;
    for (const value of operation.values) if (truth.isTrue(value)) return { kind: "illegal", message: FALSE_INFORMATION_REFUSED };
  }
  return null;
}

export const knownTruth = (isTrue: (value: AbilityInformationValue) => boolean): InformationTruth => ({ known: true, isTrue });
export const unknownTruth = (reason: string): InformationTruth => ({ known: false, reason });

/** A Yes / No whose truth is `value` (undefined: either answer is true under a registration the Storyteller has not ruled yet). */
export const booleanTruth = (requirementId: string, value: boolean | undefined): InformationTruth =>
  knownTruth((given) => value !== undefined && given.requirementId === requirementId && given.kind === "boolean" && given.value === value);

/** The answers true under EVERY registration the Storyteller may rule: the intersection of each registration combination's answers.
 * A value some combination does not give is false under that ruling, so it is not certainly true. A ruling that gives no answer at
 * all (a lone Spy ruled not a Minion: the Clockmaker has nothing to count) is not one the Storyteller can use, so it is left out, as
 * the true-information path (`possibleAnswers`) leaves it out (independent check at 4208516). */
export const certainValues = <T>(perCombination: readonly (readonly T[])[]): T[] => {
  const usable = perCombination.filter((answers) => answers.length > 0);
  return usable.length ? usable[0]!.filter((value, index, first) => first.indexOf(value) === index && usable.every((answers) => answers.includes(value))) : [];
};

/** A number whose certainly true values are `certain` (see `certainValues`): only those are refused. */
export const numberTruth = (requirementId: string, certain: readonly number[]): InformationTruth =>
  knownTruth((given) => given.requirementId === requirementId && given.kind === "number" && certain.includes(given.value));

/** The numbers the Storyteller may give as false: `candidates` without the certainly true ones. */
export const falseNumbers = (candidates: readonly number[], certain: readonly number[]): number[] =>
  candidates.filter((value) => !certain.includes(value));
