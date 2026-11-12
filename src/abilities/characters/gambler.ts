import type { AbilityDescriptor } from "../semantics";
import { answerOf, ask, deathAttempt, firstParticipant, lifeOperation, nothing, survivedOutcome, tokenOutcome, requireLivingActor, subjectId } from "./shared";

/**
 * Gambler -- GUIDED (Treacherous 30th, owner-authorized; shared protection rules
 * of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 3).
 * https://wiki.bloodontheclocktower.com/Gambler
 *
 * "Each night*, choose a player & guess their character: if you guess wrong,
 * you die." Other Nights only. The Gambler may choose any player, dead or alive,
 * even themself, and is never told the answer.
 *
 * The chosen player's character is what they REGISTER as to the Gambler. When
 * that registration is ambiguous (Spy / Recluse) the Storyteller judges it. A
 * wrong guess is a death of the Gambler from a non-Demon cause (protection is
 * asked for "any"). A right guess changes nothing. Impaired / simulated: the
 * choice is simulated and nothing happens.
 */

export const GAMBLER: AbilityDescriptor = {
  roleId: "gambler",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [
    { id: "target", kind: "participant", source: "player", label: "The player chosen" },
    { id: "guess", kind: "character", source: "player", label: "The character guessed" },
  ],
  hooks: ["targeting", "registration", "death"],
  presentation: { complexity: "complex", action: "Choose a player and guess their character" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const target = firstParticipant(context.inputs, "target");
    const guess = answerOf(context.inputs, "guess", "character");
    if (!guess || guess.roleIds.length !== 1) return { kind: "illegal", message: "Guess exactly one character." };
    const guessed = guess.roleIds[0]!;

    const registered = context.query.registration(target, "gambler").character;
    let actual: string;
    if (registered.known) actual = registered.value;
    else {
      const id = subjectId("gambler:registered", target);
      const judged = answerOf(context.judgments, id, "character");
      if (!judged || judged.roleIds.length !== 1) return ask(registered.reason,
        { id, kind: "character", source: "judgment", label: "The character the chosen player registers as to the Gambler" });
      actual = judged.roleIds[0]!;
    }
    if (actual === guessed) return nothing();

    const death = deathAttempt(context, context.actor.binding, "any");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind === "survives") return survivedOutcome(death);
    return tokenOutcome(context, "gambler", [lifeOperation([{ kind: "death", target: context.actor.binding }])]);
  },
};
