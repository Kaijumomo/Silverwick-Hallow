import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
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
