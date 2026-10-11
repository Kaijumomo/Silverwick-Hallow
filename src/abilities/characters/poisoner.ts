import type { AbilityDescriptor } from "../semantics";
import { firstParticipant, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Poisoner -- GUIDED. docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md Section 4.
 *
 * "Each night, choose a player: they are poisoned tonight and tomorrow day."
 * Any current participant (self / dead included). A functioning Poisoner
 * applies ONE sourced `poisoned` Effect (lifetime throughFollowingDay: expires
 * on entry to the next Night). Its persistence is `whileSourceFunctions`: the
 * Rules Query derives that it stops applying when the Poisoner dies, is
 * externally impaired or changes character. Self-poison persists without
 * recursively cancelling itself; the Rules Query excludes only that exact
 * self-effect while checking its source. An already impaired / simulated
 * Poisoner chooses, but produces no Effect.
 */
export const POISONER: AbilityDescriptor = {
  roleId: "poisoner",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player to poison" }],
  hooks: ["targeting"],
  sourcedEffects: [{ type: "poisoned", persistence: "whileSourceFunctions" }],
  presentation: { complexity: "simple", action: "Choose a player to poison." },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (!context.functioning) return nothing();
    return outcome([{ domain: "effect", intents: [{ kind: "apply", target: firstParticipant(context.inputs, "target"), effect: {
      type: "poisoned", source: context.actor.binding, sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" },
    } }] }]);
  },
};
