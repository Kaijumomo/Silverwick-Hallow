import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { EffectRecord, RoleId, STPlayerRecord } from "@/stores/types";
import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import { FALSE_INFORMATION_REFUSED, numberTruth, unknownTruth } from "../falseInformation";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";
import { informationAbilityRefusal, recluseRegistrationChoice, spyRegistrationChoice, storytellerChooses } from "./informationSupport";
import { passiveRegistrationOptions } from "./passiveRules";

/**
 * Juggler -- GUIDED (SV-5f, Sects & Violets part 2b; PO build approval 2026-11-23; proposal sections 14.1, 36-38; information support
 * rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 8).
 * https://wiki.bloodontheclocktower.com/Juggler (saved 2026-11-11)
 *
 * "On your 1st day, publicly guess up to 5 players' characters. That night, you learn how many you got correct."
 * How to Run: "For each correct guess, mark the Juggler with a CORRECT reminder. (Make sure the players don't see how many reminders
 * you're placing.) That night, wake the Juggler. Show them fingers ... equaling the number of CORRECT reminders. ... Remove the CORRECT
 * reminders and the Juggler's night token when convenient." Summary: "They may guess zero characters, or up to five characters, and these
 * characters and players may be different or the same." "If the Juggler made their guesses while drunk or poisoned, but is sober and
 * healthy when their ability triggers that night, then the Storyteller still gives them true information."
 *
 * THE DAY (features/grimoire-v6/day/juggler.ts, Q6 A and Q16 A): each guess is recorded the moment it is picked, as ONE `jugglerGuess`
 * Effect on the Juggler (source: the Juggler; the guessed participant, the guessed character, and whether it was correct, judged THEN and
 * frozen). A Spy or Recluse who may register as the guessed character is one Yes / No ruling (PO Part 1 Q2: follow the pages). "Done"
 * records a `jugglerGuessesDone` Effect (zero guesses allowed). Both are Storyteller facts (rulesQuery APPROVED_EFFECT_SEMANTICS) that
 * expire at the next dawn; the official CORRECT token is drawn from the correct guesses (officialReminderPresentation.ts). Undo is the
 * only correction (Q16 A).
 *
 * THE NIGHT (this descriptor; the wake itself is the Night order's, SV-1: the night after the Juggler's first Day): the count of the
 * correct guesses recorded on the Day just ended, shown as a finger signal on the Night card (PO Q1). Next records it.
 *  - The count is the truth when the Juggler functions TONIGHT, whatever their state when guessing (the page).
 *  - Drunk or poisoned tonight, or a Drunk shown the Juggler: the Storyteller chooses the number.
 *  - A Vortox (SV-5h, the shared rule): the Storyteller chooses any number but the true count.
 *  - "Done" not recorded: the app cannot tell "no guesses" from guesses made by hand, so the Storyteller gives the number (by hand under a
 *    Vortox, whose truth would be unknown).
 *  - A functioning Juggler's commit also removes the guesses and the Done record (the page's "remove the CORRECT reminders"): one Undo
 *    restores them. A non-functioning ability may change nothing (the coordinator's rule), so then they simply expire at dawn.
 * Not here: the Cannibal jinx (a Storyteller judgment, classification.ts); a Philosopher-gained Juggler (by hand, SV-3).
 */
export const JUGGLER_GUESS = "jugglerGuess";
export const JUGGLER_DONE = "jugglerGuessesDone";
/** The Effect parameters of one guess. */
export const JUGGLER_GUESSED = "guessed";
export const JUGGLER_CHARACTER = "character";
export const JUGGLER_CORRECT = "correct";
export const JUGGLER_MAX_GUESSES = 5;
/** The Storyteller's number (impaired, a Vortox). */
export const JUGGLER_COMMUNICATED = "communicated";
/** The Storyteller's number when the guesses were not marked done. */
export const JUGGLER_UNRECORDED = "juggler:unrecorded";
const ANSWER = "correct";

/** This participant's own Juggler records (guesses or Done) made on Day `day`. */
function recordsOn(player: STPlayerRecord, type: string, day: number): EffectRecord[] {
  return player.effects.filter((effect) => effect.type === type && effect.state === "active" && effect.sourceCharacter === "juggler"
    && effect.sourceParticipant?.kind === "participant" && effect.sourceParticipant.participantId === player.participantId
    && effect.appliedAt?.phase === "day" && effect.appliedAt.day === day);
}

export type JugglerTally = { guesses: EffectRecord[]; done: EffectRecord[]; correct: number };

/** What the Juggler recorded on Day `day`: the guesses (in order), the Done record, and how many guesses were correct. */
export function jugglerTally(player: STPlayerRecord, day: number): JugglerTally {
  const guesses = recordsOn(player, JUGGLER_GUESS, day);
  const correct = guesses.filter((effect) => {
    const value = effect.parameters?.[JUGGLER_CORRECT];
    return value?.kind === "boolean" && value.value;
  }).length;
  return { guesses, done: recordsOn(player, JUGGLER_DONE, day), correct };
}

export type GuessVerdict = { kind: "known"; correct: boolean } | { kind: "ask"; reason: string };

/**
 * Whether a guess "this player is this character" is correct, judged now: the character the player registers as to the Juggler (their
 * actual character). A healthy Spy or Recluse who might register as the guessed character (or as something other than their own) is the
 * Storyteller's ruling, as are other registrations the app cannot settle. A Spy guessed as a Demon, or a Recluse as a Townsfolk, cannot
 * register so: incorrect.
 */
export function jugglerGuessVerdict(query: RulesQuery, target: ParticipantBinding, roleId: RoleId): GuessVerdict {
  const player = query.participant(target);
  if (!player) return { kind: "ask", reason: "That player is no longer in this seat." };
  const character = query.registration(target, "juggler").character;
  if (character.known) return { kind: "known", correct: character.value === roleId };
  const optional = player.actualRole === "spy" ? spyRegistrationChoice(query, target) : player.actualRole === "recluse" ? recluseRegistrationChoice(query, target) : false;
  if (optional) {
    const options = passiveRegistrationOptions(player.actualRole);
    const type = query.roleOf(roleId)?.type;
    if (roleId !== player.actualRole && !(type && options?.types.includes(type))) return { kind: "known", correct: false };
    const own = query.roleOf(player.actualRole)?.name ?? player.actualRole;
    return { kind: "ask", reason: roleId === player.actualRole ? `The ${own} might register as another character.` : `The ${own} might register as this character.` };
  }
  return { kind: "ask", reason: character.reason };
}

function deliver(context: AbilityEvaluationContext, value: number, clear: AbilityOperation[]): AbilityEvaluation {
  if (!Number.isInteger(value) || value < 0 || value > JUGGLER_MAX_GUESSES) return { kind: "illegal", message: "The Juggler learns a whole number from 0 to 5." };
  // The coordinator orders mechanics before information: the records go first, then the count is delivered.
  return outcome([...clear, { domain: "information", recipient: context.actor.binding, informationActionId: "juggler-other-night",
    values: [{ requirementId: ANSWER, kind: "number", value }] }]);
}

/** The Day the guesses belong to: the Day just ended (the Night order wakes the Juggler only on the night after their first Day). */
function guessDay(context: AbilityEvaluationContext): number | null {
  const moment = context.query.moment();
  return moment && moment.phase === "night" && moment.day > 1 ? moment.day - 1 : null;
}

export const JUGGLER: AbilityDescriptor = {
  roleId: "juggler",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information", "registration"],
  informationActions: ["juggler-other-night"],
  presentation: { complexity: "simple", action: "Show how many guesses were correct" },
  evaluator: (context) => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    const day = guessDay(context);
    if (day === null) return { kind: "unsupported", message: "The Juggler learns at night, after their first Day: give the number by hand." };
    const tally = jugglerTally(context.actor.player, day);
    if (storytellerChooses(context)) {
      const told = answerOf(context.inputs, JUGGLER_COMMUNICATED, "number");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Juggler ability. Choose the number to show."
        : "This Juggler's ability is not functioning. Choose the number to show.",
      { id: JUGGLER_COMMUNICATED, kind: "number", source: "storyteller", label: "The number of correct guesses shown" });
      // A non-functioning ability changes nothing: the records expire at dawn.
      return deliver(context, told.value, []);
    }
    const records = [...tally.guesses, ...tally.done];
    // A non-functioning ability (drunk or poisoned under a Vortox) changes nothing: then the records expire at dawn.
    const clear: AbilityOperation[] = records.length && context.functioning && !context.simulated ? [{ domain: "effect", intents: records.map((effect) => ({ kind: "remove" as const, target: context.actor.binding, effectId: effect.id })) }] : [];
    if (!tally.done.length) {
      if (context.mustBeFalse) return { kind: "unsupported", message: "The Juggler's guesses were not marked done on the Day card, and a Vortox makes the number false: give it by hand." };
      const told = answerOf(context.inputs, JUGGLER_UNRECORDED, "number");
      if (!told) return ask("The guesses were not marked done on the Day card. Choose the number to show.",
        { id: JUGGLER_UNRECORDED, kind: "number", source: "storyteller", label: "The number of correct guesses shown" });
      return deliver(context, told.value, clear);
    }
    if (!context.mustBeFalse) return deliver(context, tally.correct, clear);
    // SV-5h: under a Vortox (a drunk or poisoned Juggler too) the Storyteller chooses any number but the true count.
    const told = answerOf(context.inputs, JUGGLER_COMMUNICATED, "number");
    if (!told) return ask("A Vortox is in play: choose a false number to show.",
      { id: JUGGLER_COMMUNICATED, kind: "number", source: "storyteller", label: "The number of correct guesses shown", exclude: [tally.correct] });
    if (told.value === tally.correct) return { kind: "illegal", message: FALSE_INFORMATION_REFUSED };
    return deliver(context, told.value, clear);
  },
  truth: (context) => {
    const day = guessDay(context);
    if (day === null) return unknownTruth("The Juggler learns at night, after their first Day.");
    const tally = jugglerTally(context.actor.player, day);
    return tally.done.length ? numberTruth(ANSWER, [tally.correct]) : unknownTruth("The Juggler's guesses were not marked done on the Day card.");
  },
};
