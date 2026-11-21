import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { madnessAllowsExecution } from "@/abilities/characters/cerenovus";
import { executionAdvice, executionChoiceNames, executionSpendsAbility } from "@/stores/executionAdvice";
import { executionsAt } from "@/stores/lifeEvents";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
import { currentVotingState } from "@/stores/voting";
import { twinPairOf } from "@/stores/twinPair";
import type { LifeConfirmationToken } from "@/stores/lifeResolution";
import type { ExecutionOutcome, STPlayerRecord } from "@/stores/types";
import type { VotingIntent } from "@/stores/votingTypes";
import type { V6Ctx } from "../ctx";
import { chooseAsk, confirmAsk, flash } from "../v6Store";

/**
 * SV-4b: the Storyteller's own execution from a seat's menu -- the Cerenovus's penalty and the Mutant's "at any time"
 * (https://wiki.bloodontheclocktower.com/Cerenovus, https://wiki.bloodontheclocktower.com/Mutant). The app never decides that a mad
 * player failed to try: the Storyteller opens the seat and taps Execute, and may always decline ("might").
 *
 * - In the Day it is an execution recorded through the ordinary execution command (the Saint capture, the Undertaker's reading and the
 *   day's execution count all stay right). It records "died" when nothing prevents it, asks the existing "Did they die?" question when the
 *   rules gate (the Fool, a sober Sailor, the Devil's Advocate, a Pacifist in play) says survival is possible, and records "already
 *   dead" for a dead player. A second execution that Day asks the existing "Record an additional execution?" confirmation. The dock then
 *   offers Begin Night, as after any execution ("If you execute them during the day ... go to the night phase").
 * - At night the Life Event model records no executions, so this is an ordinary death and the Day's one execution stays free
 *   (the Mutant page: "An execution may still happen the next day"). A death carries no execution evidence, so a Saint or a Good Twin,
 *   whose execution may decide the game, gets one reminder line.
 */

/** Whether the seat's menu offers Execute: a live madness from a functioning Cerenovus, or a living Mutant. Never in Privacy Mode. */
export function executeOffered(ctx: V6Ctx, player: STPlayerRecord | undefined): boolean {
  const { game } = ctx;
  if (!player || player.isEmpty || !player.participantId || ctx.privacy || ctx.ended || (game.phase !== "day" && game.phase !== "night")) return false;
  // A dead player can only be "executed" in the Day (recorded as already dead): at night there is no death left to record.
  if (!player.alive && game.phase !== "day") return false;
  if (player.alive && player.actualRole === "mutant") return true;
  const query = createRulesQuery(game, { registry: ctx.registry, script: ctx.script ?? null, semantics: CANONICAL_ABILITY_SEMANTICS });
  return madnessAllowsExecution(query, { playerId: player.id, participantId: player.participantId });
}

/** One line for a night execution whose Day equivalent would decide the game (an ordinary death records no execution evidence). */
export function nightExecutionWarning(player: STPlayerRecord, players: Readonly<Record<string, STPlayerRecord>> = {}): string | null {
  if (player.actualRole === "saint") return `${player.name || "The Saint"} is the Saint: an execution may end the game. Check before ending.`;
  // SV-4d: "If the good player is executed, evil wins": the Good Twin of a standing pair.
  const pair = twinPairOf(players);
  if (pair.kind === "single" && pair.valid && pair.good?.id === player.id && (pair.evil.alive || pair.evil.effects.some((effect) => effect.state === "active" && effect.type === "retainsAbility"))) return `${player.name || "The Good Twin"} is the Good Twin: an execution may end the game. Check before ending.`;
  return null;
}

type Settled = { ok: true; manualReason?: string } | { ok: false; code?: string; message: string; confirmation?: LifeConfirmationToken };

/** Runs the confirmation loop the planner asks for (a Traveller executee, an additional execution), one question at a time. Null = declined. */
async function withConfirmations(attempt: (tokens: LifeConfirmationToken[]) => Settled): Promise<Settled | null> {
  const tokens: LifeConfirmationToken[] = [];
  for (let round = 0; round < 3; round++) {
    const result = attempt(tokens);
    if (result.ok || result.code !== "needsConfirmation" || !result.confirmation) return result;
    if (!(await confirmAsk("Confirm", result.message, "Record it"))) return null;
    tokens.push(result.confirmation);
  }
  return { ok: false, message: "The confirmations did not settle. Review the player and try again." };
}

/** The seat menu's Execute. The seat must still be the one that was drawn; a changed game is refused as stale. */
export async function runExecute(ctx: V6Ctx, player: STPlayerRecord): Promise<void> {
  const store = useStorytellerStore;
  const game = store.getState().game;
  const name = player.name || "That player";
  const current = game?.players[player.id];
  if (!game || game !== ctx.game || !current || current.isEmpty || !player.participantId || current.participantId !== player.participantId) {
    flash("The player changed. Reopen their menu before continuing."); return;
  }
  if (!executeOffered(ctx, current)) { flash(`${name} cannot be executed from here right now.`); return; }

  if (game.phase === "night") {
    const result = store.getState().recordDeath(player.id, undefined, captureVotingContext());
    if (!result.ok) { flash(result.message); return; }
    flash([`${name} is executed at night: recorded as a death. Today's execution is still free.`, nightExecutionWarning(current, game.players)].filter(Boolean).join(" "));
    return;
  }

  // Day: the outcome follows the rules gate, and the Storyteller is asked only where the gate says survival is possible.
  const environment = ctx.script ? { script: ctx.script, registry: ctx.registry } : undefined;
  let outcome: ExecutionOutcome = "alreadyDead";
  if (current.alive) {
    const advice = executionAdvice(game, current.id, environment);
    const choices = executionChoiceNames(game.players);
    if (advice || choices.length) {
      const body = [...choices.map((who) => `${who} may apply: you decide whether an executed good player survives.`), advice?.note ?? null].filter(Boolean).join(" ");
      const answer = await chooseAsk(`Did ${name} die?`, body, "Yes · died", "No · survived");
      if (!answer) return;
      outcome = answer === "first" ? "died" : "survived";
    } else outcome = "died";
  }
  if (store.getState().game !== game) { flash("The game changed. Choose Execute again."); return; }

  const spends = outcome === "survived" && executionSpendsAbility(game, current.id, environment);
  const executedToday = executionsAt(game, { phase: "day", day: game.day });
  const already = (executedToday.status === "known" ? executedToday.events : executedToday.recorded).length > 0;
  const done = await withConfirmations((tokens) => already
    // A second execution is never refused by the Voting store's own rule: it is the planner's explicit "additional execution" question.
    ? store.getState().recordExecution(current.id, outcome, { confirmations: tokens, spendsAbility: spends }, undefined, captureVotingContext())
    : store.getState().resolveVoting({ kind: "execution", target: { playerId: current.id, participantId: player.participantId! }, outcome,
      confirmations: tokens, code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision } as VotingIntent, captureVotingContext()));
  if (!done) return;
  if (!done.ok) { flash(done.message); return; }
  flash(done.manualReason ?? (outcome === "survived" ? `${name} survives the execution. Begin the night when ready.`
    : outcome === "alreadyDead" ? `${name} is already dead: the execution is recorded. Begin the night when ready.` : `${name} is executed. Begin the night when ready.`));
}
