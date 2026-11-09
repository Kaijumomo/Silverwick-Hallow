import { declaredResult, useStorytellerStore, type TerminalIntent, type TerminalRecovery } from "@/stores/storytellerStore";
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
 *       drain, lease renewal and, for a declared result, the fresh
 *       Storyteller uid / roster / participant reads as a preflight
 *       (PR-10H-001: a failure there writes nothing terminal and leaves the
 *       session live); only then the fenced public/status=ended signal
 *       (players show "Ending..."; End Without Result, having no preflight,
 *       still sends it before the drain), then ONE fenced atomic commit that
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
 * landed but its response was lost -- 10H-AC-050) retains exactly that
 * commit's CONFIRMED outcome (ASTRA-10H-004), as an explicit tri-state: a
 * declared result read back from the Storyteller's result receipt, or a
 * confirmed absence of one (End Without Result). Either overrides this retry's
 * intent, so a different selection never rewrites the local history, the
 * local record and the players' results never disagree, and nothing is
 * published twice (the session can end only once; results are written only
 * in that commit). An outcome that cannot be confirmed fails closed.
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
    return { ok: false, message: useStorytellerStore.getState().terminalClose?.message ?? "This game is already being ended." };
  }
  const lobby = useStorytellerStore.getState().lobby;
  try {
    let recovery: TerminalRecovery = store.terminalClose?.confirmedRecovery ?? { kind: "fresh" };
    if (lobby) {
      const outcome = await closeMultiplayerSession({
        terminal: terminalPublication(lobby.code, lobby.sessionId ?? "", declared, game),
        readBackPublished: true,
        finishGame: true,
      });
      if (outcome.alreadyEnded) {
        // Read-back was requested, so an already-ended outcome always carries
        // its confirmed recovery; refuse rather than fall back to the intent.
        if (!outcome.recovery) throw new Error("The ended lobby's result could not be confirmed.");
        recovery = outcome.recovery;
      }
    }
    const result = useStorytellerStore.getState().finishGame(intent, recovery);
    if (!result.ok) {
      // Once the server has closed, a browser-storage refusal cannot turn it
      // back into a live session or allow a different retry winner. Retain
      // the confirmed outcome and retry only the local final save.
      const confirmed = recovery.kind !== "fresh" ? recovery
        : lobby ? (declared ? { kind: "endedWithResult" as const, result: declared } : { kind: "endedWithoutResult" as const })
        : undefined;
      useStorytellerStore.getState().failTerminalClose(result.message, confirmed);
    }
    return result;
  } catch (error) {
    if (lobby && !useStorytellerStore.getState().lobby) {
      // Detachment runs after remote closure. Zustand updates memory before
      // persistence, so a failed detach save can throw before the close's
      // confirmed receipt returns. Keep the exact session for read-back;
      // neither this request's winner nor a detached lobby proves its result.
      const message = `Ending needs recovery: ${lifecycleMessage(error)} Retry to confirm the saved result.`;
      useStorytellerStore.getState().failTerminalClose(message, undefined, lobby);
      return { ok: false, message };
    }
    const message = useStorytellerStore.getState().terminalClose?.recoveryPending
      ? `Ending recovery is still pending: ${lifecycleMessage(error)} Retry to confirm the saved result.`
      : `The game could not be ended: ${lifecycleMessage(error)} It is still live -- try again.`;
    useStorytellerStore.getState().failTerminalClose(message);
    return { ok: false, message };
  }
}
