import type { AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { isCanonicalRole } from "@/data/canonical";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { Alignment, RoleId, RoleType } from "@/stores/types";
import { passiveRegistrationOptions } from "./passiveRules";

/** R1: a healthy canonical Recluse supplies an optional, per-interaction
 * information choice. Unknown impairment or an explicit registration Effect
 * still requires whole-action manual resolution; no registration is saved. */
export function recluseInformationChoice(context: AbilityEvaluationContext, target: ParticipantBinding): boolean {
  return recluseRegistrationChoice(context.query, target);
}

/** Optional canonical registration for one supported interaction only. This
 * proves eligibility for a choice, never a persistent registration override. */
export function recluseRegistrationChoice(query: RulesQuery, target: ParticipantBinding): boolean {
  return optionalRegistrationChoice(query, target, "recluse");
}

/** The same per-interaction choice for a healthy canonical Spy, who "might register as good and as a Townsfolk or
 * Outsider" (https://wiki.bloodontheclocktower.com/Spy). A drunk or poisoned Spy registers as itself, so it never
 * gets this choice. Eligibility only: no registration is saved. */
export function spyRegistrationChoice(query: RulesQuery, target: ParticipantBinding): boolean {
  return optionalRegistrationChoice(query, target, "spy");
}

function optionalRegistrationChoice(query: RulesQuery, target: ParticipantBinding, roleId: "recluse" | "spy"): boolean {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  if (!player || !player.actualAlignment || role?.id !== roleId || !isCanonicalRole(role)
    || player.effects.some(effect => effect.state === "active" && effect.type === "registersFalsely")) return false;
  const functioning = query.abilityFunctions(target);
  return functioning.known && functioning.value;
}

/** B5 information support extends PHASE10F_CHARACTER_RULES_MATRIX.md.
 * Losing an ability is not drunkenness/poisoning: it grants no simulated
 * information interaction. Read applicability through the existing query,
 * including source-dependent and suppressed effects; never read reminders.
 */
export function informationAbilityRefusal(context: AbilityEvaluationContext): AbilityEvaluation | undefined {
  for (const effect of context.actor.player.effects) {
    if (effect.type !== "abilityLost") continue;
    const applies = context.query.effectApplies(context.actor.binding, effect);
    if (!applies.known) return { kind: "unsupported", message: applies.reason };
    if (applies.value) return { kind: "notApplicable", message: "This player has lost their ability." };
  }
}

/**
 * SV-5 (PO Q2, 2026-11-21: "follow the pages"): the forms a participant may take for ONE observer's information, read through the
 * shared registration query. A known registration is one form. A healthy canonical Spy or Recluse whose registration the query
 * leaves to the Storyteller has every form its page allows (its actual one plus the optional ones). Anything else unknown (a
 * "registers falsely" Effect, a modifier, an unverified character) has no list: the caller sends the whole action by hand.
 * Possible forms only: nothing is chosen or saved here.
 */
export type RegistrationForms<T> = { known: true; forms: readonly T[]; optional: boolean } | { known: false; reason: string };

export function possibleTypes(query: RulesQuery, binding: ParticipantBinding, observer: RoleId): RegistrationForms<RoleType> {
  const player = query.participant(binding);
  if (!player) return { known: false, reason: "That participant is no longer in this seat." };
  const character = query.registration(binding, observer).character;
  if (character.known) {
    const type = query.roleOf(character.value)?.type;
    return type ? { known: true, forms: [type], optional: false } : { known: false, reason: "This character's type is not known: the Storyteller decides." };
  }
  const options = passiveRegistrationOptions(player.actualRole);
  const actual = query.roleOf(player.actualRole)?.type;
  if (!options || !actual || !optionalRegistrationChoice(query, binding, player.actualRole as "spy" | "recluse")) return { known: false, reason: character.reason };
  return { known: true, forms: [...new Set([actual, ...options.types])], optional: true };
}

export function possibleAlignments(query: RulesQuery, binding: ParticipantBinding, observer: RoleId): RegistrationForms<Alignment> {
  const player = query.participant(binding);
  if (!player) return { known: false, reason: "That participant is no longer in this seat." };
  const alignment = query.registration(binding, observer).alignment;
  if (alignment.known) return { known: true, forms: [alignment.value], optional: false };
  const options = passiveRegistrationOptions(player.actualRole);
  if (!options || !player.actualAlignment || !optionalRegistrationChoice(query, binding, player.actualRole as "spy" | "recluse")) return { known: false, reason: alignment.reason };
  return { known: true, forms: [...new Set<Alignment>([player.actualAlignment, options.alignment])], optional: true };
}

/** Every answer the allowed registrations could give: the answers under each combination of forms (an empty list, such as "no
 * Minion could be counted", gives none), without duplicates, in first-seen order. */
export function possibleAnswers<F, A>(choices: readonly (readonly F[])[], answer: (forms: readonly F[]) => readonly A[]): A[] {
  const answers: A[] = [];
  const walk = (index: number, picked: F[]) => {
    if (index === choices.length) {
      for (const value of answer(picked)) if (!answers.includes(value)) answers.push(value);
      return;
    }
    for (const form of choices[index]!) walk(index + 1, [...picked, form]);
  };
  walk(0, []);
  return answers;
}
