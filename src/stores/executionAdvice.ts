import { interactionCoverageEligibility } from "@/abilities/automationEligibility";
import { createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import type { PlayerId, StorytellerLobbyRecord } from "./types";

/**
 * LS-1: what the shared death gate says about an EXECUTION of one player. Advice for the Storyteller, never a decision: the
 * Storyteller records the actual outcome ("died" / "survived") exactly as before, and may always override.
 *
 * - `survives`: the gate knows this execution does not kill (the Fool's first death, a sober Sailor, known protection).
 *   `spends`: the survival uses up the player's own ability (the Fool), so recording "survived" also records that use.
 * - A Pacifist in play makes the Fool's survival ambiguous (who saved them is the Storyteller's choice, and the Fool does not
 *   use its ability when someone else protects it), so nothing is spent automatically and the note says so.
 * - Unknown protection (custom or generic Protected markers) gives no advice here: the Storyteller decides, as before.
 *
 * Causes: "any". The Soldier and the Monk protect from the Demon only, so they never advise on an execution.
 */
export type ExecutionAdvice = { kind: "survives"; spends: boolean; note: string } | { kind: "ambiguous"; note: string };

export function executionAdvice(game: StorytellerLobbyRecord, playerId: PlayerId, environment?: RulesQueryEnvironment): ExecutionAdvice | null {
  const player = game.players[playerId];
  if (!environment || !player || player.isEmpty || !player.participantId || !player.alive) return null;
  // Advice follows the same line automation draws: every character in play must be reviewed (a Sailor's nightly drunk choice, a Devil's Advocate's protection and the like are not modelled).
  const query = createRulesQuery(game, environment);
  if (interactionCoverageEligibility(query, ["pacifist"]).kind === "manual") return null; // the Pacifist is handled below
  const outcome = query.deathOutcome({ playerId, participantId: player.participantId }, "any");
  if (!outcome.known || outcome.value.kind !== "survives") return null;
  const pacifist = Object.values(game.players).some(p => !p.isEmpty && p.alive && p.actualRole === "pacifist");
  if (outcome.value.spends && pacifist) {
    return { kind: "ambiguous", note: `${player.name} is a Fool whose ability is unused, and a Pacifist is in play: if the Fool survives, you decide whether the Fool's ability or the Pacifist did it. Nothing is spent automatically.` };
  }
  if (outcome.value.spends) {
    return { kind: "survives", spends: true, note: `${player.name} is a Fool with the ability unused: the Fool survives this execution, and recording "survived" also uses up the ability.` };
  }
  return { kind: "survives", spends: false, note: `${player.name} is protected from this death: they survive the execution.` };
}

/** Whether recording `survived` for this execution also records the player's own ability use (the Fool). Pure; used by the voting plan. */
export const executionSpendsAbility = (game: StorytellerLobbyRecord, playerId: PlayerId, environment?: RulesQueryEnvironment): boolean => {
  const advice = executionAdvice(game, playerId, environment);
  return advice?.kind === "survives" && advice.spends;
};
