import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { EffectRecord } from "@/stores/types";
import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { answerOf, ask, firstParticipant, nameOf, outcome, requireLivingActor } from "./shared";

/**
 * Exorcist -- GUIDED (BM-1c, Bad Moon Rising). https://wiki.bloodontheclocktower.com/Exorcist (saved revision 2973)
 *
 * Built on the shared protection and impairment rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 3).
 *
 * "Each night*, choose a player (different to last night): the Demon, if chosen, learns who you are then doesn't wake tonight."
 * Other nights only. How to run: the Exorcist points; mark the player with CHOSEN; if the Demon was chosen, wake the Demon, show THIS
 * CHARACTER SELECTED YOU and the Exorcist token, point at the Exorcist, put the Demon to sleep, and do not wake the Demon again for
 * their own ability tonight. "Any other Demon abilities still function": only the ordinary night wake is suppressed.
 *
 *  - Any player may be chosen, dead or alive, the Exorcist included. Last night's pick is refused ("Choose a different player"); the
 *    pick counts even when the Exorcist was drunk or poisoned that night, because a choice was made (the Devil's Advocate's rule).
 *  - The pick is ONE Storyteller fact `exorcistChosen` on the chosen player (official CHOSEN token), with no source (the Exorcist is a
 *    participant parameter, the Devil's Advocate's pattern, so a drunk Exorcist's pick is recorded too), with no end:
 *    the older CHOSEN of the same Exorcist moves to the new pick (PO 2026-11-12, option A), and it survives the Exorcist's death (so
 *    it is NOT in the source-loss cleanup list). It also carries `exorcised`: true only when a FUNCTIONING Exorcist chose a player who
 *    registers as the Demon -- so the Demon is told (the card's Wake row) and their ordinary wake tonight is suppressed.
 *  - A player who might register as the Demon (a Recluse or Spy) is the Storyteller's one ruling, asked on the Night card; nothing is
 *    pre-selected. A Lunatic or Marionette is not the Demon. Drunk or poisoned (or a Drunk shown the Exorcist): the pick is recorded
 *    and CHOSEN placed, but nobody is told and nothing is asked.
 *  - The suppression itself is ONE shared rule, `exorcisedDemonReason`, read by the planner for any Demon's ordinary night wake; no
 *    Demon's own file knows about the Exorcist. "Does the Exorcist function" is read live, so a late drunk or poison on the Exorcist
 *    leaves no stale block.
 */
export const EXORCIST_TARGET = "target";
export const EXORCIST_CHOSEN = "exorcistChosen";
/** The Effect parameter that says the Demon was told and does not wake tonight. */
export const EXORCISED_PARAMETER = "exorcised";
/** The Effect parameter that names the Exorcist who chose (the Effect has no source, so it is admitted when the Exorcist is drunk too). */
export const EXORCIST_PARAMETER = "exorcist";
/** The Storyteller's ruling for a chosen player who might register as the Demon: true = they register as the Demon. */
export const exorcistRegistersAsDemonId = (participantId: string) => `exorcist:registersAsDemon:${JSON.stringify(participantId)}`;
export const EXORCIST_RULING_PREFIX = "exorcist:registersAsDemon:";
export const EXORCISED_REASON = "The Exorcist chose the Demon tonight. The Demon does not use their ability tonight.";

/** Every CHOSEN this Exorcist placed: the holder, the Effect, and the night it was placed on. */
export function exorcistChoices(query: RulesQuery, exorcist: ParticipantBinding): { holder: ParticipantBinding; effectId: string; night: number | null }[] {
  const holders = query.factHolders(EXORCIST_CHOSEN);
  if (!holders.known) return [];
  return holders.value.flatMap(({ holder, effectId }) => {
    const effect = query.participant(holder)?.effects.find((candidate) => candidate.id === effectId);
    const chooser = effect?.parameters?.[EXORCIST_PARAMETER];
    if (!effect || chooser?.kind !== "participant" || chooser.participants[0]?.participantId !== exorcist.participantId) return [];
    return [{ holder, effectId, night: effect.appliedAt?.phase === "night" ? effect.appliedAt.day : null }];
  });
}

/** Whether this CHOSEN is tonight's, from an Exorcist that still functions, and told the Demon. */
function exorcisesTonight(query: RulesQuery, effect: EffectRecord): boolean {
  const moment = query.moment();
  if (!moment || moment.phase !== "night" || effect.type !== EXORCIST_CHOSEN || effect.state !== "active") return false;
  if (effect.appliedAt?.phase !== "night" || effect.appliedAt.day !== moment.day) return false;
  const told = effect.parameters?.[EXORCISED_PARAMETER];
  if (told?.kind !== "boolean" || !told.value) return false;
  const chooser = effect.parameters?.[EXORCIST_PARAMETER];
  if (chooser?.kind !== "participant" || !chooser.participants[0]) return false;
  const chooserId = chooser.participants[0].participantId;
  const sourcePlayer = Object.values(query.game.players).find((player) => !player.isEmpty && player.participantId === chooserId);
  if (!sourcePlayer?.participantId) return false;
  const functions = query.abilityFunctions({ playerId: sourcePlayer.id, participantId: sourcePlayer.participantId });
  return functions.known && functions.value;
}

/**
 * The shared "does not wake tonight" rule (BM-1c): the reason a Demon's ORDINARY night wake does not happen because a functioning
 * Exorcist chose them tonight, or null. Only the player's actual character matters (a Demon); triggered wakes, dusk steps and every
 * lasting power are other paths and never read this.
 */
export function exorcisedDemonReason(query: RulesQuery, demon: ParticipantBinding): string | null {
  const player = query.participant(demon);
  if (!player || query.roleOf(player.actualRole ?? "")?.type !== "demon") return null;
  return player.effects.some((effect) => exorcisesTonight(query, effect)) ? EXORCISED_REASON : null;
}

export const EXORCIST: AbilityDescriptor = {
  roleId: "exorcist",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: EXORCIST_TARGET, kind: "participant", source: "player", label: "The player to exorcise" }],
  hooks: ["targeting", "registration"],
  independentFacts: [EXORCIST_CHOSEN],
  presentation: { complexity: "simple", action: "Choose a player" },
  evaluator: (context): AbilityEvaluation => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    // A Drunk who believes they are the Exorcist is not the Exorcist: nothing is remembered.
    if (context.simulated) return outcome([]);
    const { query } = context;
    const night = query.moment();
    if (!night || night.phase !== "night") return { kind: "notApplicable", message: "The Exorcist chooses at night." };
    const me = context.actor.binding;
    const target = firstParticipant(context.inputs, EXORCIST_TARGET);
    const picked = query.participant(target);
    if (!picked) return { kind: "stale", message: "The chosen player is no longer in that seat." };
    const choices = exorcistChoices(query, me);
    if (choices.some((choice) => choice.night === night.day - 1 && choice.holder.participantId === target.participantId)) {
      return { kind: "illegal", message: `${nameOf(context, target)} was chosen last night. Choose a different player.` };
    }
    // The Demon is told only by a working Exorcist, and only when the chosen player registers as the Demon.
    let told = false;
    if (context.functioning) {
      const registers = query.registersAsType(target, "demon", "exorcist");
      // A dead former Demon (an Imp after its star pass) is not woken by default: the page is silent, so the Storyteller rules, nothing pre-selected.
      if (registers.known && (!registers.value || picked.alive)) told = registers.value;
      else {
        const id = exorcistRegistersAsDemonId(picked.participantId!);
        const answer = answerOf(context.inputs, id, "boolean");
        const name = nameOf(context, target);
        if (!answer) return ask(`${name} might register as the Demon.`, { id, kind: "boolean", source: "storyteller", label: `${name} registers as the Demon` });
        told = answer.value;
      }
    }
    // CHOSEN moves: every earlier pick of this Exorcist goes (last night's was only needed for the check above).
    const operation: AbilityOperation = { domain: "effect", intents: [
      ...choices.map(({ holder, effectId }) => ({ kind: "remove" as const, target: holder, effectId })),
      { kind: "apply", target, effect: { type: EXORCIST_CHOSEN, lifetime: { kind: "manual" }, parameters: {
        [EXORCIST_PARAMETER]: { kind: "participant", participants: [me] }, [EXORCISED_PARAMETER]: { kind: "boolean", value: told } } } },
    ] };
    return outcome([operation]);
  },
};
