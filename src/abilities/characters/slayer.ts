import type { AbilityDescriptor } from "../semantics";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import { scarletWomanSuccession } from "./scarletWoman";
import { recluseRegistrationChoice } from "./informationSupport";
import { answerOf, ask, deathAttempt, firstParticipant, lifeOperation, nameOf, nothing, outcome } from "./shared";

/**
 * Slayer -- GUIDED Day public claim. docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md
 * Section 10.
 *
 * "Once per game, during the day, publicly choose a player: if they are the
 * Demon, they die." Day / publicClaim / oncePerGame; any target (self and dead
 * included).
 *
 *  - A dead Slayer has no ability: no real guided use (notApplicable).
 *  - A living Slayer's use is ALWAYS spent (useAbility) -- impaired or not,
 *    kill or no kill -- in the same atomic Life transaction as any death.
 *  - Dead target -> no death. Otherwise the target's registration as a Demon
 *    TO THE SLAYER decides (an actual Demon registers; a Recluse / other
 *    ambiguity is an explicit Storyteller judgment).
 *  - Registers as a Demon and alive -> protectedFrom(target, "any") (Section 3):
 *    protected -> no death; unknown -> judgment; otherwise death.
 *  - Impaired: the use is spent, nobody dies. A simulated Slayer wake (e.g. a
 *    Drunk) has no ability, so nothing is recorded.
 */
export const registersAsDemonJudgment = (participantId: string) => `registersAsDemon:${participantId}`;

export const SLAYER: AbilityDescriptor = {
  roleId: "slayer",
  timing: ["day"],
  invocation: "publicClaim",
  usage: { kind: "oncePerGame" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player publicly chosen" }],
  hooks: ["targeting", "registration", "death"],
  presentation: { complexity: "simple", action: "Publicly choose a player" },
  evaluator: (context) => {
    if (!context.actor.player.alive) return { kind: "notApplicable", message: "A dead Slayer has no ability -- there is no real Slayer shot to record." };
    if (context.simulated) return nothing();
    const use = { kind: "useAbility" as const, target: context.actor.binding };
    const spent = () => outcome([lifeOperation([use])]);
    if (!context.functioning) return spent();
    const target = firstParticipant(context.inputs, "target");
    const alive = context.query.isAlive(target);
    if (!alive.known || !alive.value) return spent();
    const registration = context.query.registersAsType(target, "demon", "slayer");
    let demon: boolean;
    if (registration.known) demon = registration.value;
    else {
      // When death is certainly prevented, either optional registration has
      // the same result. Reuse the death query without accepting judgments:
      // arbitrary-death facts must still leave the whole action Manual.
      const possibleDeath = deathAttempt({ ...context, judgments: {} }, target, "any");
      if (possibleDeath.kind === "survives") return spent();
      if (possibleDeath.kind === "ask") return { kind: "unsupported", message: possibleDeath.message };
      if (!recluseRegistrationChoice(context.query, target)) return { kind: "unsupported", message: registration.reason };
      // The official Recluse choice is local to this target and this shot.
      // Legacy judgments must not unlock other unknown registration rules.
      const judged = answerOf(context.inputs, registersAsDemonJudgment(target.participantId), "boolean");
      if (!judged) return ask("Choose how the Recluse registers to this Slayer shot.", { id: registersAsDemonJudgment(target.participantId), kind: "boolean", source: "storyteller",
        label: `${nameOf(context, target)} registers as the Demon to the Slayer` });
      demon = judged.value;
    }
    if (!demon) return spent();
    const death = deathAttempt(context, target, "any");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind !== "dies") return spent();
    const succession = scarletWomanSuccession(context.query, target, "slayer");
    if (succession.kind === "manual") return { kind: "unsupported", message: succession.reason };
    const kill = lifeOperation([use, { kind: "death", target }]);
    return outcome(succession.kind === "successor"
      ? [kill, { domain: "role", intents: toldRoleChangeIntents(context.query.participant(succession.target)!, "imp") }]
      : [kill], succession.kind === "successor");
  },
};
