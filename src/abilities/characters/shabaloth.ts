import type { AbilityDescriptor } from "../semantics";
import { ask, deathAttempt, lifeOperation, nothing, tokenOutcome, participantsOf, requireLivingActor } from "./shared";
import { scarletWomanSuccession } from "./scarletWoman";

/**
 * Shabaloth -- GUIDED-PARTIAL (Treacherous 30th, owner-authorized; shared
 * protection rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix
 * Section 3). https://wiki.bloodontheclocktower.com/Shabaloth
 *
 * "Each night*, choose 2 players: they die. A dead player you chose last night
 * might be regurgitated." Other Nights only; the two players are attacked one
 * at a time, in the order chosen.
 *
 *  - each attack is an ordinary Demon death: a dead target does nothing, a
 *    protected target survives (unknown protection -> judgment). The second attack
 *    is judged against the state after the first.
 *  - if protection of the second target would differ depending on whether the
 *    first death happened, the order matters and the whole action stays Manual.
 *  - NOT modeled: regurgitation (the Storyteller brings one player back by hand
 *    with the Life tools, and their ability is restored by hand). A Scarlet Woman
 *    that could take over a dying Shabaloth stays Manual.
 *  - impaired / simulated: the choices are simulated; nobody dies.
 */
export const SHABALOTH: AbilityDescriptor = {
  roleId: "shabaloth",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "targets", kind: "participant", source: "player", count: 2, label: "The two players to kill, in order" }],
  hooks: ["targeting", "death"],
  presentation: { complexity: "complex", action: "Choose 2 players to kill" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const [first, second] = participantsOf(context.inputs, "targets")!;
    const deaths: { kind: "death"; target: NonNullable<typeof first> }[] = [];
    let query = context.query;
    for (const [index, target] of [first!, second!].entries()) {
      if (!query.participant(target)?.alive) continue;
      const scope = { id: `shabaloth:${index + 1}:${JSON.stringify([first!.participantId, second!.participantId])}`, label: `attack ${index + 1}` };
      const death = deathAttempt(context, target, "demon", query, scope);
      if (death.kind === "ask") return ask(death.message, death.requirement);
      if (death.kind === "survives") continue;
      const succession = scarletWomanSuccession(query, target);
      if (succession.kind !== "none") return { kind: "unsupported", message: succession.kind === "manual" ? succession.reason : "A Scarlet Woman succession for this Demon is not modeled -- resolve manually." };
      deaths.push({ kind: "death", target });
      if (index === 0 && second && second.participantId !== target.participantId) {
        const before = context.query.protectedFrom(second, "demon");
        const after = query.assumingAlive(target, false).protectedFrom(second, "demon");
        if (before.known !== after.known || (before.known && after.known && before.value !== after.value)) {
          return { kind: "unsupported", message: "Whether the second attack is prevented depends on the first death happening first -- the order matters, so resolve it manually." };
        }
      }
      query = query.assumingAlive(target, false);
    }
    return deaths.length ? tokenOutcome(context, "shabaloth", [lifeOperation(deaths)], deaths.length > 1) : nothing();
  },
};
