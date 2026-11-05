import type { AbilityDescriptor } from "../semantics";
import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { ask, deathAttempt, lifeOperation, nothing, outcome, participantsOf, requireLivingActor } from "./shared";
import { scarletWomanSuccession } from "./scarletWoman";

export const SHABALOTH_CHOSEN = "shabalothChosen";
export const SHABALOTH_ALIVE = "shabalothAlive";

/** Every authoritative Shabaloth token (the DEAD of its two chosen players, the ALIVE of a regurgitated one) this Shabaloth placed. */
export function shabalothTokens(query: RulesQuery, shabaloth: ParticipantBinding): { holder: ParticipantBinding; effectId: string; type: string }[] {
  const out: { holder: ParticipantBinding; effectId: string; type: string }[] = [];
  for (const type of [SHABALOTH_CHOSEN, SHABALOTH_ALIVE]) {
    const holders = query.factHolders(type);
    if (!holders.known) continue;
    for (const { holder, effectId } of holders.value) {
      const effect = query.participant(holder)?.effects.find((candidate) => candidate.id === effectId);
      if (effect?.sourceParticipant?.kind === "participant" && effect.sourceParticipant.participantId === shabaloth.participantId) out.push({ holder, effectId, type });
    }
  }
  return out;
}

/**
 * The dead players this Shabaloth may regurgitate at this Dusk: chosen on ITS PREVIOUS NIGHT (the DEAD token it placed then,
 * including a player who was already dead or protected when attacked) and dead now. Empty unless the Shabaloth is alive and its
 * ability functions tonight. Once it acts tonight its old tokens move, so the choice never lingers.
 */
export function regurgitable(query: RulesQuery, shabaloth: ParticipantBinding): { target: ParticipantBinding; effectId: string }[] {
  const moment = query.moment();
  const self = query.participant(shabaloth);
  if (!moment || moment.phase !== "night" || moment.day < 2 || !self?.alive) return [];
  const functioning = query.abilityFunctions(shabaloth);
  if (!functioning.known || !functioning.value) return [];
  const tokens = shabalothTokens(query, shabaloth);
  // "A dead player" -- one a night: once someone has been brought back tonight, nobody else is offered.
  const tonight = (id: { holder: ParticipantBinding; effectId: string }) => {
    const appliedAt = query.participant(id.holder)?.effects.find((candidate) => candidate.id === id.effectId)?.appliedAt;
    return appliedAt?.phase === "night" && appliedAt.day === moment.day;
  };
  if (tokens.some((token) => token.type === SHABALOTH_ALIVE && tonight(token))) return [];
  return tokens.flatMap(({ holder, effectId, type }) => {
    const effect = query.participant(holder)?.effects.find((candidate) => candidate.id === effectId);
    const previous = effect?.appliedAt?.phase === "night" && effect.appliedAt.day === moment.day - 1;
    return type === SHABALOTH_CHOSEN && previous && query.participant(holder)?.alive === false ? [{ target: holder, effectId }] : [];
  });
}

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
 *  - a chosen player who dies, or was already dead, carries the Shabaloth's official DEAD token (an authoritative
 *    Effect); a protected survivor does not. It MOVES to the new targets each time the Shabaloth acts. The Dusk regurgitation reads it (regurgitable()).
 *  - regurgitation itself is the Storyteller's optional Dusk choice (see the Night engine);
 *    a Scarlet Woman that could take over a dying Shabaloth stays Manual.
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
    // The DEAD tokens move to the chosen players who died tonight or were already dead (the same player twice carries one). Per the wiki
    // only a chosen player who dies is marked DEAD; a protected survivor keeps no token, and nothing is regurgitable from it.
    const died = new Set(deaths.map((death) => death.target.participantId));
    const chosen = [first!, second!].filter((target, index, all) => all.findIndex((other) => other.participantId === target.participantId) === index
      && (died.has(target.participantId) || !context.query.participant(target)?.alive));
    const intents = [
      ...shabalothTokens(context.query, context.actor.binding).map(({ holder, effectId }) => ({ kind: "remove" as const, target: holder, effectId })),
      ...chosen.map((target) => ({ kind: "apply" as const, target,
        effect: { type: SHABALOTH_CHOSEN, source: context.actor.binding, sourceCharacter: "shabaloth", lifetime: { kind: "manual" as const } } })),
    ];
    // Both chosen players survived (protected) with none already dead and no earlier tokens: there is no token to move, so no effect step.
    const operations: AbilityOperation[] = [...(deaths.length ? [lifeOperation(deaths)] : []), ...(intents.length ? [{ domain: "effect" as const, intents }] : [])];
    if (!operations.length) return nothing();
    return outcome(operations, operations.length > 1);
  },
};
