import { declaredResult, useStorytellerStore, type TerminalIntent } from "@/stores/storytellerStore";
import type { SetupCommandResult } from "@/features/setup/setupReadiness";
import { lifecycleMessage } from "./lifecycle";
import { closeMultiplayerSession } from "./storytellerSync";
import { terminalPublication } from "./terminalResults";

/**
 * Phase 10H (10H-IMPLEMENTATION-CONTRACT-v1.0 §§14-15): the ONE terminal
 * lifecycle path for every explicit terminal intent -- Declare Good Victory,
 * Declare Evil Victory, and the exceptional End Without Result. Nothing is
 * inferred: there is no win-condition evaluation in 10H.
 *
 * Order (§15):
 *  1-3. the caller has confirmed; the intent is captured and gameplay mutation
 *       is locked at the store's commit seam (beginTerminalClose);
 *  4-9. with multiplayer attached, the existing authoritative close runs --
 *       fenced public/status=ended first (players show "Ending..."), drain,
 *       lease renewal, a fresh roster read, then ONE fenced atomic commit that
 *       ends the session, performs the existing teardown, clears reveal
 *       acknowledgements and writes results/{uid} for coherent participants of
 *       a declared result; the writer stops;
 *  10.  the lobby is detached locally (by the close itself, only on success);
 *  11.  only then the local game becomes the ended snapshot with its Game
 *       Result, Undo cleared (finishGame), and the lock is released;
 *  12.  any remote failure leaves the local game live and unchanged, releases
 *       the lock and keeps the intent for retry.
 *
 * A retry that finds the session already ended (an earlier attempt's commit
 * landed but its response was lost -- 10H-AC-050) retains exactly the result
 * that commit published, read back from the results collection, so the local
 * record and the players' results never disagree and nothing is published
 * twice (the session can end only once; results are written only in that
 * commit).
 */
export async function endGameWithIntent(intent: TerminalIntent): Promise<SetupCommandResult> {
  const store = useStorytellerStore.getState();
  const game = store.game;
  if (!game) return { ok: false, message: "No game is open." };
  if (game.phase === "ended") return { ok: false, message: "This game is already finished." };
  if (game.phase !== "night" && game.phase !== "day") {
    return { ok: false, message: "Only a game in play (Night or Day) can be finished. Discard a Setup instead." };
  }
  const declared = declaredResult(intent, game);
  if (declared === "invalid") return { ok: false, message: "Choose Good victory, Evil victory or End Without Result." };
  if (!store.beginTerminalClose(intent)) {
    return { ok: false, message: "This game is already being ended." };
  }
  try {
    let published: ReturnType<typeof readBack> = undefined;
    const lobby = useStorytellerStore.getState().lobby;
    if (lobby) {
      const outcome = await closeMultiplayerSession({
        terminal: terminalPublication(lobby.code, lobby.sessionId ?? "", declared, game),
        readBackPublished: true,
      });
      published = readBack(outcome);
    }
    const result = useStorytellerStore.getState().finishGame(intent, published);
    if (!result.ok) useStorytellerStore.getState().failTerminalClose(result.message);
    return result;
  } catch (error) {
    const message = `The game could not be ended: ${lifecycleMessage(error)} It is still live -- try again.`;
    useStorytellerStore.getState().failTerminalClose(message);
    return { ok: false, message };
  }
}

/** The published result to retain: only from an already-ended session that
 * actually published one; otherwise undefined (the intent itself is what the
 * successful close just published). */
function readBack(outcome: Awaited<ReturnType<typeof closeMultiplayerSession>>) {
  return outcome.alreadyEnded && outcome.published ? outcome.published : undefined;
}
