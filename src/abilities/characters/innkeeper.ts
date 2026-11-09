import type { AbilityDescriptor } from "../semantics";
import { ask, followUpParticipant, nameOf, nothing, outcome, participantsOf, requireLivingActor, subjectId } from "./shared";

/**
 * Innkeeper -- GUIDED (Treacherous 30th).
 *
 * Owner-authorized addition for Treacherous 30th (Milestone 2, slice 2B), built on the shared
 * protection and impairment rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 3).
 *
 * "Each night*, choose 2 players: they can't die tonight, but 1 is drunk until
 * dusk." Other Nights only; two distinct current participants (themself and the
 * dead are structurally legal choices).
 *
 * A functioning Innkeeper applies, through ONE ordered Effect operation:
 *  - a sourced `cannotDie` Effect on each chosen player (lifetime untilDawn),
 *    the all-causes protection -- never conflated with Monk's Demon-only
 *    `safeFromDemon`;
 *  - a sourced `drunk` Effect on the ONE chosen player the Storyteller picks
 *    (lifetime throughFollowingDay, which expires on entry to the next Night,
 *    i.e. at dusk). Which of the two is a Storyteller choice, asked as a
 *    follow-up bound to this exact pair: the answer collected for one pair can
 *    never be consumed for another.
 *
 * Both Effects are `whileSourceFunctions`: if the Innkeeper dies, is impaired
 * or changes character, neither the protection nor the drunkenness applies
 * (derived, never rewritten). An impaired / simulated Innkeeper chooses but
 * produces no Effect at all, as the official rules say.
 */
export const DRUNK_ONE = "innkeeper:drunk";

export const INNKEEPER: AbilityDescriptor = {
  roleId: "innkeeper",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "targets", kind: "participant", source: "player", count: 2, constraints: ["distinct"], label: "The two players protected" }],
  hooks: ["targeting", "death"],
  sourcedEffects: [
    { type: "cannotDie", persistence: "whileSourceFunctions" },
    { type: "drunk", persistence: "whileSourceFunctions" },
  ],
  presentation: { complexity: "complex", action: "Choose 2 players: they cannot die tonight, but one is drunk" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (!context.functioning) return nothing();
    const targets = participantsOf(context.inputs, "targets")!;
    const id = subjectId(DRUNK_ONE, ...targets);
    const answer = followUpParticipant(context, context.inputs, id);
    if (!answer) return ask("Choose which of the two protected players is drunk until dusk.",
      { id, kind: "participant", source: "storyteller", label: "The protected player who is drunk" });
    if ("refusal" in answer) return answer.refusal;
    const drunk = answer.binding;
    if (!targets.some((target) => target.participantId === drunk.participantId)) {
      return { kind: "illegal", message: `${nameOf(context, drunk)} was not one of the two chosen players.` };
    }
    const source = { source: context.actor.binding, sourceCharacter: "innkeeper" } as const;
    return outcome([{ domain: "effect", intents: [
      ...targets.map((target) => ({ kind: "apply" as const, target, effect: { type: "cannotDie", ...source, lifetime: { kind: "untilDawn" as const } } })),
      { kind: "apply" as const, target: drunk, effect: { type: "drunk", ...source, lifetime: { kind: "throughFollowingDay" as const } } },
    ] }]);
  },
};
