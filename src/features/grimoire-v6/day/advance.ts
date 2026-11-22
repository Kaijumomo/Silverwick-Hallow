import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
import { executionAdvice, executionChoiceNames, executionDeathKnown } from "@/stores/executionAdvice";
import { executionsAt } from "@/stores/lifeEvents";
import { currentVotingState } from "@/stores/voting";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { roman } from "../ringLayout";
import { flash, showVeil, useV6Ui } from "../v6Store";

/** An execution has already been recorded for this Day (so the block no longer waits on one). */
export function dayHasExecution(game: StorytellerLobbyRecord): boolean {
  const result = executionsAt(game, { phase: "day", day: game.day });
  return (result.status === "known" ? result.events : result.recorded).length > 0;
}

/** The nominee still on the block, or null once the day's execution is recorded (or the block is a tie). */
export function blockNominee(game: StorytellerLobbyRecord) {
  if (dayHasExecution(game)) return null;
  const block = currentVotingState(game).block;
  return block?.nominee ? { nominee: block.nominee, tally: block.tally } : null;
}

/**
 * "Begin Night N": closes the vote that is waiting on its acknowledgement and enters Night through the
 * ordinary phase command. A vote still under way, or a supported exile still without its outcome, is
 * the Storyteller's to settle first -- the nomination card is reopened on it instead.
 */
export function advanceToNight(ctx: V6Ctx): boolean {
  const { game, voting } = ctx;
  const round = voting?.round ?? null;
  if (round?.status === "voting") { voting?.show(); flash("Finish the vote first."); return false; }
  if (round?.mode === "exile" && round.result === "exilePassed") { voting?.show(); flash("Resolve the supported exile first."); return false; }
  if (round && voting && !voting.run({ kind: "acknowledge", roundId: round.id }, captureVotingContext())) { voting.show(); return false; }
  const result = useStorytellerStore.getState().advancePhase(captureVotingContext());
  if (!result.ok) { flash(result.message); return false; }
  const ui = useV6Ui.getState();
  ui.set({ panel: "night", slay: null, card: false, popMode: "main" });
  showVeil(`Night ${roman(game.day + 1)}`, "The town sleeps", false);
  return true;
}

/**
 * The dock's "Execute <name>": when the rules positively establish that the execution kills the nominee on the block (no Fool, sober
 * Sailor, Pacifist in play or unknown protection), it is recorded as "died" right away and the dock offers Begin Night, as after any
 * execution. Anything less certain returns false and the existing "Did they die?" card opens instead.
 */
export function executeBlockIfKnown(ctx: V6Ctx): boolean {
  const { game, voting } = ctx;
  const block = blockNominee(game);
  if (!block || !voting || !ctx.script) return false;
  const player = game.players[block.nominee.playerId];
  if (!player || player.isEmpty || !player.alive || !player.participantId || player.participantId !== block.nominee.participantId) return false;
  const env = { script: ctx.script, registry: ctx.registry };
  if (executionAdvice(game, player.id, env) || executionChoiceNames(game.players).length || !executionDeathKnown(game, player.id, env)) return false;
  if (!voting.run({ kind: "execution", target: { playerId: player.id, participantId: player.participantId }, outcome: "died" }, captureVotingContext())) return false;
  voting.close();
  flash(`${player.name} is executed. Begin the night when ready.`);
  return true;
}
