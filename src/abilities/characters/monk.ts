import type { AbilityDescriptor } from "../semantics";
import { firstParticipant, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Monk -- GUIDED. docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md Section 5.
 *
 * "Each night*, choose a player (not yourself): they are safe from the Demon
 * tonight." Other Nights only; not self; the target may otherwise be alive or
 * dead. A functioning Monk applies ONE sourced `safeFromDemon` Effect
 * (lifetime untilDawn) -- Demon-specific protection, distinct from Cannot die
 * (Rules Query answers it only for a `"demon"` cause). Persistence
 * `whileSourceFunctions`: if the Monk loses the ability before the Demon
 * resolves, the protection no longer applies (derived, never rewritten). An
 * impaired / simulated Monk chooses, but produces no protection.
 */
export const MONK: AbilityDescriptor = {
  roleId: "monk",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", constraints: ["notSelf"], label: "The player to protect" }],
  hooks: ["targeting", "death"],
  sourcedEffects: [{ type: "safeFromDemon", persistence: "whileSourceFunctions" }],
  presentation: { complexity: "simple", action: "Choose a player to protect from the Demon" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (!context.functioning) return nothing();
    return outcome([{ domain: "effect", intents: [{ kind: "apply", target: firstParticipant(context.inputs, "target"), effect: {
      type: "safeFromDemon", source: context.actor.binding, sourceCharacter: "monk", lifetime: { kind: "untilDawn" },
    } }] }]);
  },
};
