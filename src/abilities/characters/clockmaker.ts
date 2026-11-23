import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RoleType } from "@/stores/types";
import { answerOf, ask, nameOf, outcome, requireLivingActor, subjectId } from "./shared";
import { ringOf } from "./chef";
import { informationAbilityRefusal, answersByCombination, possibleTypes, storytellerChooses } from "./informationSupport";
import { FALSE_INFORMATION_REFUSED, certainValues, falseNumbers, numberTruth, unknownTruth } from "../falseInformation";

/**
 * Clockmaker -- GUIDED (SV-5a, Sects & Violets). https://wiki.bloodontheclocktower.com/Clockmaker (saved 2026-11-11)
 *
 * "You start knowing how many steps from the Demon to its nearest Minion." First night only. "The distance is the number of seated
 * players, starting from the player next to the Demon and ending at the nearest Minion, either clockwise or counterclockwise."
 * Examples: a Demon next to a Minion is 1; "evil Travellers are not Minions" but are counted as seats.
 *
 * The ring is the Chef's: every seated participant, the dead and Travellers included, empty seats skipped. The app counts the steps
 * from the Demon to each Minion both ways round and shows the smallest; the Storyteller gives it with fingers (PO Q1: no new player
 * screen). Registration follows the pages (PO Q2): a Spy might not register as a Minion and a Recluse might register as a Minion
 * or a Demon, so every number the allowed registrations could give is worked out. One number: shown. Several: the Storyteller picks
 * one of THOSE numbers (one question). Nothing is saved as a registration.
 * By hand (Manual) with the reason: a registration only the Storyteller can rule (a "registers falsely" Effect, a modifier), more
 * than one Demon, no Demon or no Minion to count, a Clockmaker step after the first night (a Pit-Hag or Barber made one: "start
 * knowing" is a first-night ability). Drunk or poisoned, or a Drunk shown the Clockmaker: the Storyteller chooses the number
 * (the information support rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 8). SV-5i: a Vortox makes the number
 * false (src/abilities/falseInformation.ts): the numbers are worked out as above, for a drunk or poisoned Clockmaker too, and the
 * Storyteller chooses any number of steps the table allows except the certainly true one.
 */
export const CLOCKMAKER_COMMUNICATED = "communicated";
export const CLOCKMAKER_POSSIBLE = "clockmaker:possibleSteps";

/** Steps between two seats of a ring of `size`, the shorter way round. */
export const ringSteps = (from: number, to: number, size: number) => Math.min((to - from + size) % size, (from - to + size) % size);

/** The largest distance a ring of seated players can give (half the ring, at least 1). */
export const clockmakerMaximumSteps = (query: RulesQuery) => Math.max(1, Math.floor(ringOf(query).length / 2));

export type ClockmakerAnswers = { kind: "answers"; steps: number[]; /** True under every allowed registration (SV-5h). */ certain: number[]; doubtful: ParticipantBinding[] } | { kind: "manual"; message: string };

/** Every number the allowed registrations could give the Clockmaker, ascending, and the players whose registration is the
 * Storyteller's call. Shared by the evaluator and the Night card (which offers only these numbers). */
export function clockmakerAnswers(query: RulesQuery): ClockmakerAnswers {
  const ring = ringOf(query);
  const forms: (readonly RoleType[])[] = [];
  const doubtful: ParticipantBinding[] = [];
  for (const player of ring) {
    const binding = { playerId: player.id, participantId: player.participantId! };
    const types = possibleTypes(query, binding, "clockmaker");
    if (!types.known) return { kind: "manual", message: types.reason };
    if (types.forms.length > 1) doubtful.push(binding);
    forms.push(types.forms);
  }
  if (ring.filter((_, index) => forms[index]!.length === 1 && forms[index]![0] === "demon").length > 1)
    return { kind: "manual", message: "More than one Demon is in play: count the Clockmaker's steps by hand." };
  const combinations = answersByCombination(forms, (picked) => {
    const demons = picked.flatMap((type, index) => type === "demon" ? [index] : []);
    const minions = picked.flatMap((type, index) => type === "minion" ? [index] : []);
    if (!minions.length) return [];
    // One Demon in each combination, except where a Recluse may register as a second one: each is offered.
    return demons.map((demon) => Math.min(...minions.map((minion) => ringSteps(demon, minion, ring.length))));
  });
  const unique = [...new Set(combinations.flat())].sort((a, b) => a - b);
  if (!unique.length) return { kind: "manual", message: "No Demon and Minion can be counted at this table: give the Clockmaker's number by hand." };
  return { kind: "answers", steps: unique, certain: certainValues(combinations), doubtful };
}

function deliver(context: AbilityEvaluationContext, value: number): AbilityEvaluation {
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "clockmaker-first-night",
    values: [{ requirementId: "steps", kind: "number", value }] }]);
}

export const CLOCKMAKER: AbilityDescriptor = {
  roleId: "clockmaker", timing: ["firstNight"], invocation: "wake", usage: { kind: "unlimited" }, inputs: [],
  hooks: ["information", "registration"], informationActions: ["clockmaker-first-night"],
  presentation: { complexity: "simple", action: "Show how many steps from the Demon to its nearest Minion" },
  evaluator: (context) => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    const moment = context.query.moment();
    if (!moment || moment.phase !== "night" || moment.day !== 1)
      return { kind: "unsupported", message: "The Clockmaker starts knowing this on the first night only: a Clockmaker made later is yours, by hand." };
    if (storytellerChooses(context)) {
      const told = answerOf(context.inputs, CLOCKMAKER_COMMUNICATED, "number");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Clockmaker ability. Choose the number to show."
        : "This Clockmaker's ability is not functioning. Choose the number to show.",
      { id: CLOCKMAKER_COMMUNICATED, kind: "number", source: "storyteller", label: "Steps from the Demon to its nearest Minion shown" });
      if (!Number.isInteger(told.value) || told.value < 1 || told.value > clockmakerMaximumSteps(context.query))
        return { kind: "illegal", message: "Choose a number of steps this table can have." };
      return deliver(context, told.value);
    }
    const answers = clockmakerAnswers(context.query);
    if (answers.kind === "manual") return { kind: "unsupported", message: answers.message };
    if (context.mustBeFalse) {
      // SV-5i: under a Vortox (a drunk or poisoned Clockmaker too) the Storyteller chooses any number the table allows but the true one.
      // Only a number true under every registration the Storyteller may rule is refused (a Recluse who may register as a second Demon
      // adds a number to one ruling but leaves the number every ruling gives certainly true).
      const all = Array.from({ length: clockmakerMaximumSteps(context.query) }, (_, index) => index + 1);
      const choices = falseNumbers(all, answers.certain);
      if (!choices.length) return { kind: "unsupported", message: "A Vortox is in play and this table allows no false number of steps: give the Clockmaker's number by hand." };
      const told = answerOf(context.inputs, CLOCKMAKER_COMMUNICATED, "number");
      if (!told) return ask("A Vortox is in play: choose a false number of steps to show.",
        { id: CLOCKMAKER_COMMUNICATED, kind: "number", source: "storyteller", label: "Steps from the Demon to its nearest Minion shown", exclude: all.filter((value) => !choices.includes(value)) });
      if (!choices.includes(told.value)) return { kind: "illegal", message: FALSE_INFORMATION_REFUSED };
      return deliver(context, told.value);
    }
    if (answers.steps.length === 1) return deliver(context, answers.steps[0]!);
    const id = subjectId(CLOCKMAKER_POSSIBLE, ...answers.doubtful);
    const told = answerOf(context.inputs, id, "number");
    if (!told) return ask(`${answers.doubtful.map((who) => nameOf(context, who)).join(" and ")} may register differently, so the Clockmaker could learn ${answers.steps.join(" or ")}. Choose the number to show.`,
      { id, kind: "number", source: "storyteller", label: "Steps from the Demon to its nearest Minion shown" });
    if (!answers.steps.includes(told.value)) return { kind: "illegal", message: `Choose ${answers.steps.join(" or ")}: the numbers the registrations allow.` };
    return deliver(context, told.value);
  },
  truth: (context) => {
    const answers = clockmakerAnswers(context.query);
    return answers.kind === "manual" ? unknownTruth(answers.message) : numberTruth("steps", answers.certain);
  },
};
