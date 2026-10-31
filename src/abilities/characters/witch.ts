import type { AbilityDescriptor } from "../semantics";
import { firstParticipant, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Witch -- GUIDED-PARTIAL (Treacherous 30th, owner-authorized; matrix Section 1
 * persistence rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md).
 * https://wiki.bloodontheclocktower.com/Witch
 *
 * "Each night, choose a player: if they nominate tomorrow, they die. If just 3
 * players live, you lose this ability."
 *
 * A functioning Witch applies ONE sourced `witchCurse` Effect (lifetime
 * throughFollowingDay: it ends on entry to the next Night -- the curse lasts one
 * Day). The Effect applies only while the Witch functions (`whileSourceFunctions`).
 * With just three living non-Traveller players the Witch has lost the ability: the
 * choice is recorded but no curse is applied. An impaired / simulated Witch chooses
 * but curses no one.
 *
 * The death itself is a Day event: when a cursed player nominates, the nomination
 * card tells the Storyteller and offers the death through the ordinary Life command.
 * Nominations continue as normal.
 */
export const livingNonTravellers = (players: Record<string, { isEmpty?: boolean; alive: boolean; isTraveler?: boolean }>): number =>
  Object.values(players).filter((p) => !p.isEmpty && p.alive && !p.isTraveler).length;

export const WITCH: AbilityDescriptor = {
  roleId: "witch",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player to curse" }],
  hooks: ["targeting"],
  sourcedEffects: [{ type: "witchCurse", persistence: "whileSourceFunctions" }],
  presentation: { complexity: "simple", action: "Choose a player to curse" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (!context.functioning) return nothing();
    if (livingNonTravellers(context.query.game.players) <= 3) return nothing();
    return outcome([{ domain: "effect", intents: [{ kind: "apply", target: firstParticipant(context.inputs, "target"), effect: {
      type: "witchCurse", source: context.actor.binding, sourceCharacter: "witch", lifetime: { kind: "throughFollowingDay" },
    } }] }]);
  },
};
