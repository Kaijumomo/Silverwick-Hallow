import { gameLifecycleToken, useStorytellerStore } from "@/stores/storytellerStore";
import { goLive, type GoLiveOutcome } from "@/firebase/goLive";
import { closeMultiplayerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";
import { FABLED_CHOICES } from "./setupFlowModel";

/**
 * The New Game flow's lifecycle actions. Steps I and II are a local draft;
 * these run only from Step III, in the one order that keeps session authority,
 * recovery and identity intact:
 *   replace   confirm, close the previous lobby authoritatively, then newGame
 *   Live      newGame (stay on the flow), then goLive (the shared Go Live)
 *   leave     close the lobby authoritatively FIRST; discard the pristine
 *             setup game only after the close succeeded
 */
export type SetupPlan = { scriptId: string; total: number; travellers: number; extras: string[] };

type Prepared = { ok: true } | { ok: false; cancelled?: true; message?: string };

const fabledIds = new Set(FABLED_CHOICES.map((role) => role.id));

function planOptions(plan: SetupPlan) {
  return {
    plannedPlayerCount: plan.total,
    plannedTravelerCount: plan.travellers,
    plannedFabled: plan.extras.filter((id) => fabledIds.has(id)),
    plannedLorics: plan.extras.filter((id) => !fabledIds.has(id)),
  };
}

/** Confirms replacing an existing game, then closes its lobby (if any). */
async function retirePreviousGame(): Promise<Prepared> {
  const { game } = useStorytellerStore.getState();
  if (game && !window.confirm(game.phase === "ended"
    ? "Start a new game? The finished game's review record will be replaced."
    : "Start a new game? The current game will be discarded.")) return { ok: false, cancelled: true };
  try { await closeMultiplayerSession(); }
  catch (error) {
    // closeMultiplayerSession recorded the classified failure and any recovery option.
    return { ok: false, message: useSessionRuntime.getState().errors.close ?? lifecycleMessage(error) };
  }
  return { ok: true };
}

export type StartOutcome =
  | { kind: "cancelled" }
  | { kind: "error"; message: string }
  | { kind: "created" };

/** Offline "Seat the town": one atomic newGame with the seat names, opening the Grimoire. */
export async function startOffline(plan: SetupPlan, names: string[]): Promise<StartOutcome> {
  const prepared = await retirePreviousGame();
  if (!prepared.ok) return prepared.cancelled ? { kind: "cancelled" } : { kind: "error", message: prepared.message ?? "Could not start the game." };
  const created = useStorytellerStore.getState().newGame(plan.scriptId, { ...planOptions(plan), plannedSeatNames: names });
  return created ? { kind: "created" } : { kind: "error", message: "A game is being finished. Try again in a moment." };
}

/** Live "Invite to phones", first half: the pristine setup game is created
 * while the flow stays on screen. The caller then shows the Live screen and
 * runs `retryLive` (the shared Go Live) so connecting is visible. */
export async function createLiveGame(plan: SetupPlan): Promise<StartOutcome> {
  const prepared = await retirePreviousGame();
  if (!prepared.ok) return prepared.cancelled ? { kind: "cancelled" } : { kind: "error", message: prepared.message ?? "Could not start the game." };
  const created = useStorytellerStore.getState().newGame(plan.scriptId, { ...planOptions(plan), keepView: true });
  return created ? { kind: "created" } : { kind: "error", message: "A game is being finished. Try again in a moment." };
}

/** Go Live for the setup game already open: the first attempt, a retry after a failure, or after saving the Firebase settings. */
export const retryLive = (): Promise<GoLiveOutcome> => goLive();

export type LeaveOutcome = { kind: "left" } | { kind: "stayed"; message: string };

/** Leaves the Live screen. A lobby is closed authoritatively first; the
 * pristine setup game is discarded only after that succeeded. A refused
 * discard leaves everything as it was. */
export async function leaveLive(): Promise<LeaveOutcome> {
  const lifecycle = gameLifecycleToken();
  if (useStorytellerStore.getState().lobby) {
    try { await closeMultiplayerSession(); }
    catch (error) {
      return { kind: "stayed", message: useSessionRuntime.getState().errors.close ?? lifecycleMessage(error) };
    }
  }
  const { game, lobby } = useStorytellerStore.getState();
  if (!game) return { kind: "left" };
  if (lobby) return { kind: "stayed", message: "The lobby is still open. Try again." };
  return useStorytellerStore.getState().discardSetupGame(lifecycle)
    ? { kind: "left" }
    : { kind: "stayed", message: "This game can no longer be discarded from here." };
}
