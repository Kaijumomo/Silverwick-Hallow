import type { AbilityDescriptor } from "../semantics";
import { ask, deathAttempt, firstParticipant, lifeOperation, nothing, survivedOutcome, tokenOutcome, requireLivingActor, deathOf } from "./shared";
import { scarletWomanSuccession } from "./scarletWoman";

/**
 * Vortox -- GUIDED (SV-5k, Sects & Violets). https://wiki.bloodontheclocktower.com/Vortox
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (Section 3, the shared death rule).
 *
 * "Each night*, choose a player: they die. Townsfolk abilities yield false info. Each day, if no-one is executed, evil wins."
 *
 * This descriptor is the kill only, the Imp's ordinary Demon kill with no star-pass (the No Dashii's pattern). One wake on every night
 * but the first, tapped on the board: any player; a dead target changes nothing; otherwise the shared Demon death gate decides (Monk,
 * Innkeeper, Soldier, Tea Lady, Fool ... exactly as for the Imp; a Pit-Hag's arbitrary deaths are the Storyteller's). A death puts the
 * Vortox's DEAD token on the target and records the Vortox as its cause (so the Sage's step needs no question). A Scarlet Woman who
 * might take over a dying Vortox (it chose itself) is outside verified rules: the action stays Manual.
 * Drunk or poisoned: the choice is made and nobody dies.
 * Its other two clauses are rules, not this wake: false Townsfolk information (src/abilities/falseInformation.ts, SV-5h) and the
 * no-execution ending (`captureVortoxNoExecution`, SV-5l). The kill is not information, so neither rule touches it.
 */
export const VORTOX: AbilityDescriptor = {
  roleId: "vortox",
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
    const targetAlive = context.query.trulyAlive(target);
    if (!targetAlive.known || !targetAlive.value) return nothing();
    const death = deathAttempt(context, target, "demon");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind === "survives") return survivedOutcome(death);
    const succession = scarletWomanSuccession(context.query, target);
    if (succession.kind !== "none") return { kind: "unsupported", message: succession.kind === "manual" ? succession.reason : "A Scarlet Woman succession for this Demon is not modeled -- resolve manually." };
    return tokenOutcome(context, "vortox", [lifeOperation([deathOf(target, death)])]);
  },
};
