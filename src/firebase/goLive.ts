import { create } from "zustand";
import { isTabletTrial, TABLET_TRIAL_OFFLINE_MESSAGE } from "@/config/trial";
import { gameLifecycleToken, useStorytellerStore } from "@/stores/storytellerStore";
import { isFirebaseConfigured } from "./config";
import { friendlyFirebaseError, type FriendlyError } from "./errors";
import { requireActiveSession } from "./lifecycle";
import { createLobby } from "./lobby";
import { connectFirebase } from "./session";
import { closeSupersededLobby } from "./storytellerSync";

/**
 * The ONE Go Live sequence: create the lobby for the open game, then adopt it
 * (StorytellerSession then starts the fenced writer). It used to live inside
 * the Grimoire screen; the New Game flow's "Invite to phones" now owns it, so
 * it is a plain module with the same guards and no UI.
 *
 * ASTRA-10G-001: Go Live belongs to the game it started for. Every await
 * below can outlive that game (Finish game, Discard setup, New game), so the
 * continuation revalidates before creating and before adopting a lobby. A
 * lobby created for a game that is gone is closed authoritatively (the fenced
 * writer close), never attached or orphaned.
 */
export type GoLiveOutcome =
  /** The lobby is attached to this game; the writer startup now runs. */
  | { kind: "attached"; code: string }
  /** Firebase is not configured: nothing was created. The caller opens the
   * Firebase settings and may retry. */
  | { kind: "needsConfig" }
  /** Another Go Live is already in flight: nothing was started. */
  | { kind: "busy" }
  /** Not available here (Tablet Trial): nothing was started. */
  | { kind: "unavailable"; message: string }
  /** The game it started for is gone or ended; any lobby it created was
   * closed (or reported through the page-global cleanup warning). */
  | { kind: "superseded" }
  | { kind: "failed"; error: FriendlyError };

/** True while a Go Live is in flight. Module-wide, so two surfaces (or two
 * rapid taps) can never run two sequences. */
export const useGoLiveState = create<{ busy: boolean }>(() => ({ busy: false }));

export async function goLive(): Promise<GoLiveOutcome> {
  if (isTabletTrial) return { kind: "unavailable", message: TABLET_TRIAL_OFFLINE_MESSAGE };
  if (useGoLiveState.getState().busy) return { kind: "busy" };
  useGoLiveState.setState({ busy: true });
  try {
    if (!isFirebaseConfigured()) return { kind: "needsConfig" };
    const lifecycle = gameLifecycleToken();
    const stillEligible = () => {
      const now = useStorytellerStore.getState();
      return gameLifecycleToken() === lifecycle && !!now.game && now.game.phase !== "ended" && !now.lobby;
    };
    try {
      const { backend: b, uid } = await connectFirebase();
      if (!stillEligible()) return { kind: "superseded" };
      const { code } = await createLobby(b, uid);
      const session = await requireActiveSession(b, code);
      const created = { code, uid, sessionId: session.id, status: "live" as const };
      // setLobby itself also refuses an ended game (defense in depth).
      if (!stillEligible() || !useStorytellerStore.getState().setLobby(created)) {
        // A failed cleanup is reported by closeSupersededLobby itself into the
        // page-global runtime (ASTRA-10G-R1-001): the calling screen may
        // already be gone, so its own error state would never be seen.
        try { await closeSupersededLobby(b, created); }
        catch (closeError) {
          // eslint-disable-next-line no-console
          console.error("[goLive] superseded lobby close", closeError instanceof Error ? closeError.message : closeError);
        }
        return { kind: "superseded" };
      }
      return { kind: "attached", code };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[goLive]", e instanceof Error ? e.message : e);
      return { kind: "failed", error: friendlyFirebaseError(e, "st") };
    }
  } finally {
    useGoLiveState.setState({ busy: false });
  }
}
