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
export const FALSE_INFORMATION_NOTE = "A Vortox is in play: the answer is false.";
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

/** A number whose possible true values are `possible` (every value the allowed registrations could give). A value is certainly true
 * only when it is the one possible answer: with two or more, each is false under some registration the Storyteller may rule. */
export const certainNumber = (possible: readonly number[]): number | undefined => new Set(possible).size === 1 ? possible[0] : undefined;
export const numberTruth = (requirementId: string, possible: readonly number[]): InformationTruth => {
  const certain = certainNumber(possible);
  return knownTruth((given) => certain !== undefined && given.requirementId === requirementId && given.kind === "number" && given.value === certain);
};

/** The numbers the Storyteller may give as false: `candidates` without the certainly true one. */
export const falseNumbers = (candidates: readonly number[], possible: readonly number[]): number[] => {
  const certain = certainNumber(possible);
  return candidates.filter((value) => value !== certain);
};
