import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext, AbilityInputRequirement } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RoleDef, RoleId, RoleType } from "@/stores/types";
import { FALSE_INFORMATION_REFUSED, knownTruth, unknownTruth } from "../falseInformation";
import { answerOf, ask, nameOf, outcome, participantsOf, requireLivingActor, subjectId } from "./shared";
import { informationAbilityRefusal, spyRegistrationChoice, recluseRegistrationChoice } from "./informationSupport";

/**
 * Dreamer -- GUIDED (SV-5c, Sects & Violets). https://wiki.bloodontheclocktower.com/Dreamer (saved 2026-11-11)
 *
 * "Each night, choose a player (not yourself or Travellers): you learn 1 good & 1 evil character, 1 of which is correct." How to Run:
 * "If the chosen player's character is a Townsfolk or Outsider, show their character token and any Minion or Demon token to the
 * Dreamer. If the chosen player's character is a Minion or Demon, show their character token and any Townsfolk or Outsider token."
 * Examples: a Philosopher who gained the Flowergirl shows the Philosopher (the actual character); an Evil Twin shows the Evil Twin.
 *
 * The Storyteller taps the chosen player on the board (any seat but the Dreamer's and Travellers'; the dead allowed). The app reads
 * the character the player REGISTERS as to the Dreamer (a Drunk shows the Drunk, a Marionette the Marionette) and fixes its group; the
 * Storyteller picks the false token from the OTHER group of the script (any of them, in play or not: the page), never the true one.
 * One information delivery, the good token first and the evil token second whichever is true (PO Q4), so the order says nothing.
 * The Storyteller picks BOTH tokens (one good, one evil) when the Dreamer is drunk or poisoned, a Drunk is shown the Dreamer, or the
 * chosen player is a healthy Spy or Recluse (PO Q2: either may register as a character of the other group, so every good-and-evil
 * pair is one the pages allow). Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 8, information support).
 * By hand: any other registration only the Storyteller can rule; a character that is neither good nor evil by type. SV-5j: a Vortox
 * makes both tokens false (src/abilities/falseInformation.ts; the page: a Dreamer who checks a Savant "learns that player is either
 * the Philosopher or the No Dashii"): the Storyteller picks both, and neither may be the character the player registers as.
 */
export const DREAMER_TARGET = "target";
/** Follow-up ids. Each names the group of the token asked for, so the Night card opens the picker on that group. */
export const DREAMER_FALSE_GOOD = "dreamer:falseGood";
export const DREAMER_FALSE_EVIL = "dreamer:falseEvil";
export const DREAMER_GOOD = "dreamer:good";
export const DREAMER_EVIL = "dreamer:evil";
export const GOOD_TYPES: readonly RoleType[] = ["townsfolk", "outsider"];
export const EVIL_TYPES: readonly RoleType[] = ["minion", "demon"];
/** The character types the picker offers for a Dreamer follow-up (undefined: not a Dreamer token question). */
export const dreamerPickTypes = (requirementId: string): readonly RoleType[] | undefined =>
  requirementId.startsWith(`${DREAMER_FALSE_GOOD}:`) || requirementId.startsWith(`${DREAMER_GOOD}:`) ? GOOD_TYPES
    : requirementId.startsWith(`${DREAMER_FALSE_EVIL}:`) || requirementId.startsWith(`${DREAMER_EVIL}:`) ? EVIL_TYPES : undefined;

const actionId = (context: AbilityEvaluationContext) => context.query.game.day === 1 ? "dreamer-first-night" : "dreamer-other-night";

function deliver(context: AbilityEvaluationContext, target: ParticipantBinding, good: RoleId, evil: RoleId): AbilityEvaluation {
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: actionId(context), values: [
    { requirementId: "player", kind: "player", participants: [target] },
    { requirementId: "goodCharacter", kind: "role", roleId: good },
    { requirementId: "evilCharacter", kind: "role", roleId: evil },
  ] }]);
}

/** One picked token of the expected group, or a refusal. */
function picked(context: AbilityEvaluationContext, id: string, types: readonly RoleType[], label: string, message: string, exclude: readonly RoleId[] = []):
  { roleId: RoleId } | { evaluation: AbilityEvaluation } {
  const answer = answerOf(context.inputs, id, "character");
  if (!answer) return { evaluation: ask(message, { id, kind: "character", source: "storyteller", label, ...(exclude.length ? { exclude } : {}) } satisfies AbilityInputRequirement) };
  const role = answer.roleIds.length === 1 ? context.query.roleOf(answer.roleIds[0]!) : undefined;
  if (!role || !types.includes(role.type)) return { evaluation: { kind: "illegal", message: types === GOOD_TYPES ? "Choose a Townsfolk or an Outsider of this script." : "Choose a Minion or a Demon of this script." } };
  if (exclude.includes(role.id)) return { evaluation: { kind: "illegal", message: FALSE_INFORMATION_REFUSED } };
  return { roleId: role.id };
}

/** SV-5j: the character the chosen player registers as to the Dreamer (null: a healthy Spy or Recluse, who may register as a character
 * of either team, so no token is certainly the true one). Shared by the evaluator and the descriptor's truth. */
function registeredCharacter(context: AbilityEvaluationContext, target: ParticipantBinding): { known: true; role: RoleDef | null } | { known: false; message: string } {
  if (spyRegistrationChoice(context.query, target) || recluseRegistrationChoice(context.query, target)) return { known: true, role: null };
  const character = context.query.registration(target, "dreamer").character;
  if (!character.known) return { known: false, message: character.reason };
  const role = context.query.roleOf(character.value);
  if (!role || (!GOOD_TYPES.includes(role.type) && !EVIL_TYPES.includes(role.type)))
    return { known: false, message: "This character is neither good nor evil by type: choose the Dreamer's tokens by hand." };
  return { known: true, role };
}

export const DREAMER: AbilityDescriptor = {
  roleId: "dreamer",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: DREAMER_TARGET, kind: "participant", source: "player", count: 1, constraints: ["notSelf"], label: "The player the Dreamer chooses" }],
  hooks: ["information", "registration"],
  informationActions: ["dreamer-first-night", "dreamer-other-night"],
  // "complex": the Night card's own Dreamer action taps the player and picks the tokens (never the generic single-tap flow).
  presentation: { complexity: "complex", action: "Choose a player: learn 1 good & 1 evil character" },
  evaluator: (context) => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    const target = participantsOf(context.inputs, DREAMER_TARGET)?.[0];
    const player = target ? context.query.participant(target) : null;
    if (!target || !player) return { kind: "illegal", message: "Choose one player." };
    if (player.isTraveler) return { kind: "illegal", message: "The Dreamer may not choose a Traveller." };
    const who = nameOf(context, target);
    if (context.mustBeFalse) {
      // SV-5j: under a Vortox (a drunk or poisoned Dreamer too) neither token is the character the player registers as: the Storyteller
      // picks both, the true one left out. A healthy Spy or Recluse may register as a character of either team, so no token is
      // certainly true and the Storyteller picks freely (their pick is also their ruling of that registration).
      const truth = registeredCharacter(context, target);
      if (!truth.known) return { kind: "unsupported", message: truth.message };
      const exclude = truth.role ? [truth.role.id] : [];
      const why = truth.role ? `A Vortox is in play: neither token may be the ${truth.role.name}.`
        : `A Vortox is in play. ${who} is the ${context.query.roleOf(player.actualRole)?.name ?? "Spy or Recluse"} and may register as another character: show two tokens that are false for how they register.`;
      const good = picked(context, subjectId(DREAMER_GOOD, target), GOOD_TYPES, "The good character shown", `${why} Choose the good character to show.`, exclude);
      if ("evaluation" in good) return good.evaluation;
      const evil = picked(context, subjectId(DREAMER_EVIL, target), EVIL_TYPES, "The evil character shown", `${why} Choose the evil character to show.`, exclude);
      if ("evaluation" in evil) return evil.evaluation;
      return deliver(context, target, good.roleId, evil.roleId);
    }
    const optional = !context.simulated && context.functioning && (spyRegistrationChoice(context.query, target) || recluseRegistrationChoice(context.query, target));
    if (context.simulated || !context.functioning || optional) {
      const why = context.simulated ? "Simulated wake: this player has no Dreamer ability."
        : !context.functioning ? "This Dreamer's ability is not functioning."
        : `${who} is the ${context.query.roleOf(player.actualRole)?.name ?? "Spy or Recluse"} and may register as a character of the other team.`;
      const good = picked(context, subjectId(DREAMER_GOOD, target), GOOD_TYPES, "The good character shown", `${why} Choose the good character to show.`);
      if ("evaluation" in good) return good.evaluation;
      const evil = picked(context, subjectId(DREAMER_EVIL, target), EVIL_TYPES, "The evil character shown", `${why} Choose the evil character to show.`);
      if ("evaluation" in evil) return evil.evaluation;
      return deliver(context, target, good.roleId, evil.roleId);
    }
    const character = context.query.registration(target, "dreamer").character;
    if (!character.known) return { kind: "unsupported", message: character.reason };
    const role = context.query.roleOf(character.value);
    const goodTeam = !!role && GOOD_TYPES.includes(role.type);
    if (!role || (!goodTeam && !EVIL_TYPES.includes(role.type))) return { kind: "unsupported", message: "This character is neither good nor evil by type: choose the Dreamer's tokens by hand." };
    const falseTypes = goodTeam ? EVIL_TYPES : GOOD_TYPES;
    const id = subjectId(goodTeam ? DREAMER_FALSE_EVIL : DREAMER_FALSE_GOOD, target);
    const other = picked(context, id, falseTypes, goodTeam ? "The false evil character" : "The false good character",
      `${who} is the ${role.name}. Choose a false ${goodTeam ? "evil" : "good"} character to show with it.`);
    if ("evaluation" in other) return other.evaluation;
    return goodTeam ? deliver(context, target, role.id, other.roleId) : deliver(context, target, other.roleId, role.id);
  },
  truth: (context) => {
    const target = participantsOf(context.inputs, DREAMER_TARGET)?.[0];
    if (!target || !context.query.participant(target)) return unknownTruth("Choose one player.");
    const truth = registeredCharacter(context, target);
    if (!truth.known) return unknownTruth(truth.message);
    const trueId = truth.role?.id;
    return knownTruth((value) => trueId !== undefined && value.kind === "role" && value.roleId === trueId
      && (value.requirementId === "goodCharacter" || value.requirementId === "evilCharacter"));
  },
};
