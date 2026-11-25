import type { AbilityOperation } from "@/stores/abilityResolution";
import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { answerOf, ask, firstParticipant, nameOf, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Sailor -- GUIDED (BM-1b, Bad Moon Rising). https://wiki.bloodontheclocktower.com/Sailor (saved revision 1768)
 *
 * Built on the shared protection and impairment rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 3).
 *
 * "Each night, choose an alive player: either you or they are drunk until dusk. You can't die." Every night including the first.
 * How to run: "Each night, wake the Sailor. They point at any player. ... Either the Sailor or this chosen player becomes drunk."
 * The Storyteller decides who; the page's "usually the Townsfolk" is a tendency, so nothing is pre-selected.
 *
 *  - One alive player is chosen (a dead pick is refused: "the Storyteller prompts them to choose again").
 *  - Choosing themself: the Sailor is the drunk one; there is nothing to ask.
 *  - Choosing another player: ONE Storyteller ruling (the tap-ruling card on the Night card): is the chosen player the drunk one, or the
 *    Sailor? The answer records ONE sourced `drunk` Effect (official DRUNK token), lifetime throughFollowingDay (it ends when the next
 *    night begins, i.e. at dusk), persistence whileSourceFunctions: if the Sailor dies, is made drunk or poisoned, or changes character,
 *    the other player is sober again at once, as the Abilities page says (derived, never rewritten). A Sailor who made themself drunk
 *    stays drunk through the overlay in poisonerRules.ts (isSailorSelfEffect), exactly like the Innkeeper's.
 *  - Drunk or poisoned Sailor (or a Drunk who believes it): "the choice is made and nothing happens"; nothing is asked.
 *  - "You can't die" is the life-rules row (passiveRules.ts), read by the shared death gate for every cause but the Assassin.
 * The same Sailor's earlier DRUNK (a corrected pick tonight) is replaced.
 */
export const SAILOR_TARGET = "target";
/** The Storyteller's ruling for this chosen player: true = the CHOSEN player is drunk, false = the Sailor is. */
export const sailorDrunkId = (participantId: string) => `sailor:chosenDrunk:${JSON.stringify(participantId)}`;
export const SAILOR_RULING_PREFIX = "sailor:chosenDrunk:";

export const SAILOR: AbilityDescriptor = {
  roleId: "sailor",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: SAILOR_TARGET, kind: "participant", source: "player", constraints: ["alive"], label: "The alive player the Sailor chooses" }],
  hooks: ["targeting", "death"],
  sourcedEffects: [{ type: "drunk", persistence: "whileSourceFunctions" }],
  presentation: { complexity: "simple", action: "Choose an alive player" },
  evaluator: (context): AbilityEvaluation => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    // "the choice is made and nothing happens": a drunk or poisoned Sailor makes nobody drunk, and nothing is asked.
    if (context.simulated || !context.functioning) return nothing();
    const { query } = context;
    const me = context.actor.binding;
    const target = firstParticipant(context.inputs, SAILOR_TARGET);
    const picked = query.participant(target);
    if (!picked) return { kind: "stale", message: "The chosen player is no longer in that seat." };
    if (!picked.alive) return { kind: "illegal", message: "Choose an alive player." };
    let drunk = target;
    if (picked.participantId !== me.participantId) {
      const id = sailorDrunkId(picked.participantId!);
      const answer = answerOf(context.inputs, id, "boolean");
      const name = nameOf(context, target);
      if (!answer) return ask(`Who is drunk until dusk: ${nameOf(context, me)} or ${name}?`, { id, kind: "boolean", source: "storyteller", label: `${name} is drunk (otherwise the Sailor)` });
      if (!answer.value) drunk = me;
    }
    const players = Object.values(query.game.players);
    // The same Sailor's earlier DRUNK (a corrected pick tonight) is replaced.
    const earlier = players.flatMap((player) => player.isEmpty || !player.participantId ? [] : player.effects
      .filter((effect) => effect.type === "drunk" && effect.state === "active" && effect.sourceCharacter === "sailor"
        && effect.sourceParticipant?.kind === "participant" && effect.sourceParticipant.participantId === me.participantId)
      .map((effect) => ({ kind: "remove" as const, target: { playerId: player.id, participantId: player.participantId! }, effectId: effect.id })));
    const operation: AbilityOperation = { domain: "effect", intents: [
      ...earlier,
      { kind: "apply", target: drunk, effect: { type: "drunk", source: me, sourceCharacter: "sailor", lifetime: { kind: "throughFollowingDay" } } },
    ] };
    return outcome([operation]);
  },
};
