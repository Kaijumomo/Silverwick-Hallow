import type { AbilityDescriptor } from "../semantics";
import { ask, deathAttempt, firstParticipant, lifeOperation, nothing, outcome, requireLivingActor } from "./shared";
import { scarletWomanSuccession } from "./scarletWoman";

/**
 * No Dashii -- GUIDED (Treacherous 30th, owner-authorized; shared protection rules
 * of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 3).
 * https://wiki.bloodontheclocktower.com/No_Dashii
 *
 * "Each night*, choose a player: they die. Your 2 Townsfolk neighbors are poisoned."
 *
 *  - the kill is the Imp's ordinary Demon death: any target, a dead target does
 *    nothing, protection is asked through the shared death rule. There is NO
 *    star-pass. A Scarlet Woman that could take over a dying No Dashii is outside
 *    verified rules, so that case stays Manual.
 *  - the poison is PASSIVE and derived by the Rules Query from the seating and the
 *    actual characters (nearest Townsfolk each way, dead included, Outsiders /
 *    Minions / Travellers skipped; ambiguous registration -> Storyteller). It is
 *    never stored as an Effect, so it follows Pit-Hag changes immediately and ends
 *    when the No Dashii dies or stops functioning.
 *  - impaired / simulated: the choice is simulated; no death.
 */
export const NO_DASHII: AbilityDescriptor = {
  roleId: "nodashii",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player to kill" }],
  hooks: ["targeting", "death"],
  presentation: { complexity: "simple", action: "Choose a player to kill" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const target = firstParticipant(context.inputs, "target");
    if (!context.query.participant(target)?.alive) return nothing();
    const death = deathAttempt(context, target, "demon");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind === "survives") return nothing();
    const succession = scarletWomanSuccession(context.query, target);
    if (succession.kind !== "none") return { kind: "unsupported", message: succession.kind === "manual" ? succession.reason : "A Scarlet Woman succession for this Demon is not modeled -- resolve manually." };
    return outcome([lifeOperation([{ kind: "death", target }])]);
  },
};
