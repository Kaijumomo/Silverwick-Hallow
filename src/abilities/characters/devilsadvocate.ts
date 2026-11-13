import type { AbilityDescriptor } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { firstParticipant, nameOf, nothing, outcome, requireLivingActor } from "./shared";

export const SURVIVES_EXECUTION = "survivesExecution";
export const DEVILS_ADVOCATE_CHOICE = "devilsAdvocateChoice";

/** This Devil's Advocate's recorded choices (Storyteller facts with no source; the chooser is named in the `devilsAdvocate` parameter)
 * and the night each was made. */
export function devilsAdvocateChoices(query: RulesQuery, devilsAdvocate: ParticipantBinding): { holder: ParticipantBinding; effectId: string; night: number | null }[] {
  const holders = query.factHolders(DEVILS_ADVOCATE_CHOICE);
  if (!holders.known) return [];
  return holders.value.flatMap(({ holder, effectId }) => {
    const effect = query.participant(holder)?.effects.find((candidate) => candidate.id === effectId);
    const chooser = effect?.parameters?.devilsAdvocate;
    if (!effect || chooser?.kind !== "participant" || chooser.participants[0]?.participantId !== devilsAdvocate.participantId) return [];
    return [{ holder, effectId, night: effect.appliedAt?.phase === "night" ? effect.appliedAt.day : null }];
  });
}

/**
 * Devil's Advocate -- GUIDED (Bad Moon Rising; LS-2c of the life rules), built on the shared protection rules of
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 3). https://wiki.bloodontheclocktower.com/Devil%27s_Advocate
 *
 * "Each night, choose a living player (different to last night): if executed tomorrow, they don't die." First and other nights; one
 * living player (the existing "alive" constraint, which also refuses a Zombuul that registers as dead); themself allowed.
 *
 *  - The choice is remembered as the Storyteller fact `devilsAdvocateChoice` (no source; the chooser is a participant parameter), like
 *    the Shabaloth's remembered choice. It is recorded even when the Devil's Advocate is drunk or poisoned, because the page says they
 *    "cannot choose the same player two nights in a row, whether or not that player was saved" (a choice was made). Choosing last
 *    night's player is refused.
 *  - A functioning Devil's Advocate also applies ONE sourced `survivesExecution` Effect (official SURVIVES EXECUTION token), lifetime
 *    throughFollowingDay (it ends at dusk), persistence whileSourceFunctions: it stops applying if the Devil's Advocate dies, is
 *    impaired or changes character (derived, never rewritten). The death gate reads it for the cause "execution" only.
 *  - An impaired Devil's Advocate chooses but protects nobody. A simulated wake (a Drunk who believes it) changes nothing.
 * Older remembered choices of this Devil's Advocate are tidied up when a functioning one acts; last night's is kept until the next night.
 */
export const DEVILS_ADVOCATE: AbilityDescriptor = {
  roleId: "devilsadvocate",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", constraints: ["alive"], label: "The player to protect" }],
  hooks: ["targeting", "death"],
  sourcedEffects: [{ type: SURVIVES_EXECUTION, persistence: "whileSourceFunctions" }],
  independentFacts: [DEVILS_ADVOCATE_CHOICE],
  presentation: { complexity: "simple", action: "Choose a living player to protect from execution." },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated) return nothing();
    const night = context.query.moment();
    if (!night || night.phase !== "night") return { kind: "notApplicable", message: "The Devil's Advocate chooses at night." };
    const target = firstParticipant(context.inputs, "target");
    const choices = devilsAdvocateChoices(context.query, context.actor.binding);
    if (choices.some((choice) => choice.night === night.day - 1 && choice.holder.participantId === target.participantId)) {
      return { kind: "illegal", message: `${nameOf(context, target)} was chosen last night. Choose a different player.` };
    }
    const fact = { kind: "apply" as const, target, effect: { type: DEVILS_ADVOCATE_CHOICE, lifetime: { kind: "manual" as const },
      parameters: { devilsAdvocate: { kind: "participant" as const, participants: [context.actor.binding] } } } };
    if (!context.functioning) return outcome([{ domain: "effect", intents: [fact] }]);
    // Tidy: every earlier choice except last night's (still needed tomorrow night) goes; tonight's own earlier one is replaced.
    const stale = choices.filter((choice) => choice.night !== night.day - 1);
    return outcome([
      { domain: "effect", intents: [
        ...stale.map(({ holder, effectId }) => ({ kind: "remove" as const, target: holder, effectId })),
        { kind: "apply" as const, target, effect: { type: SURVIVES_EXECUTION, source: context.actor.binding, sourceCharacter: "devilsadvocate", lifetime: { kind: "throughFollowingDay" as const } } },
      ] },
      { domain: "effect", intents: [fact] },
    ]);
  },
};
