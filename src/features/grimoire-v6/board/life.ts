import { captureVotingContext, useStorytellerStore, type LifeCommandResult } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import type { PlayerId } from "@/stores/types";

export type LifeAction = "die" | "revive" | "spendVote" | "restoreVote";

/**
 * The Details card's and radial menu's immediate Life actions. Every action submits the same
 * semantic command the old compact controls did (a revive is a resurrection, not a raw status
 * correction); execution and exile outcomes belong to voting. The command is bound to the occupant
 * that was drawn, so a seat replaced in between is refused as stale.
 * Returns a one-line message for the toast (a refusal, or a manual-reason note), or null.
 */
export function runLifeAction(playerId: PlayerId, participantId: string | undefined, action: LifeAction): string | null {
  const store = useStorytellerStore.getState;
  const game = store().game;
  const player = game?.players[playerId];
  if (!game || !player || player.isEmpty || !participantId || player.participantId !== participantId || usePrivacyStore.getState().enabled || store().terminalClose?.status === "closing")
    return "The player changed. Reopen their details before continuing.";
  if (game.phase !== "night" && game.phase !== "day") return "Life changes are available during the Night and the Day.";
  const s = store();
  const result: LifeCommandResult = action === "die" ? s.recordDeath(playerId, undefined, captureVotingContext())
    : action === "revive" ? s.resurrect(playerId)
    : action === "spendVote" ? s.spendGhostVote(playerId)
    : s.restoreGhostVote(playerId);
  if (result.ok) return result.manualReason ?? null;
  return result.message;
}
