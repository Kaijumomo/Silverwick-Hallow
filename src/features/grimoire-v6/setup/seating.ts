import { useStorytellerStore } from "@/stores/storytellerStore";
import { seatPlayerAndCommit } from "@/firebase/membershipCommands";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";
import { newParticipantId } from "@/stores/participants";
import { MIN_PLAYERS } from "@/data/setupCounts";
import { selectSetupContext } from "@/features/setup/setupContext";
import { flash, useV6Ui } from "../v6Store";
import { useSetupFlow } from "./flow";

/**
 * Seating, as plain actions over the existing membership and seat commands. Nothing here invents a second membership
 * path: a waiting player is seated through the same Firebase-first command (and the same locally committed
 * `assignPendingToSeat`) the waiting-queue popup uses, and nobody is ever seated without the Storyteller's tap.
 */
const store = () => useStorytellerStore.getState();
const ui = () => useV6Ui.getState();

export const emptySeats = (game: NonNullable<ReturnType<typeof store>["game"]>): string[] =>
  game.seatOrder.filter((id) => game.players[id]?.isEmpty);

/** The waiting queue in arrival order (insertion order of the pending record). */
export const waitingOf = (game: { pendingPlayers?: Record<string, string> } | null | undefined): { uid: string; name: string }[] =>
  Object.entries(game?.pendingPlayers ?? {}).map(([uid, name]) => ({ uid, name }));

/** Seats the waiting player `uid` in the empty seat `seatId`. Returns whether the seat was committed. */
export async function assignWaiting(uid: string, seatId: string): Promise<boolean> {
  const state = store();
  const game = state.game;
  if (!game || game.phase !== "setup") return false;
  if (!game.players[seatId]?.isEmpty) { flash("That seat is taken."); return false; }
  const name = game.pendingPlayers[uid];
  if (!name) { flash("This player is no longer waiting."); return false; }
  const runtime = useSessionRuntime.getState();
  const code = state.lobby?.code ?? "";
  try {
    if (code && !runtime.backend) throw new Error("Connection unavailable. Reconnect before assigning a seat.");
    if (code && runtime.backend) {
      // One participation instance, minted once: the server record and the local occupant name the same ParticipantId.
      const participant = { participantId: newParticipantId(), name };
      await seatPlayerAndCommit(runtime.backend, code, uid, seatId, null,
        () => store().assignPendingToSeat(uid, seatId, participant.participantId), participant);
    } else if (!state.assignPendingToSeat(uid, seatId)) {
      return false;
    }
    return true;
  } catch (error) {
    flash(lifecycleMessage(error));
    return false;
  }
}

/** Index of the next empty seat after `from`, wrapping, or -1. */
export function nextEmptyIndex(from: number): number {
  const game = store().game;
  if (!game) return -1;
  const n = game.seatOrder.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (game.players[game.seatOrder[i]!]?.isEmpty) return i;
  }
  return -1;
}

/** Guided seating: the person tapped sits in the seat the guide is on, then the guide moves to the next empty seat. */
export async function seatPersonAtCursor(person: { uid: string } | { playerId: string }): Promise<void> {
  const game = store().game;
  if (!game) return;
  const k = Math.min(ui().seatCur, game.seatOrder.length - 1);
  const seatId = game.seatOrder[k];
  if (!seatId) return;
  const here = game.players[seatId];
  if ("uid" in person) {
    if (!here?.isEmpty) { flash("That seat is taken. Pick an empty seat, or tap a seated player to swap."); return; }
    if (await assignWaiting(person.uid, seatId)) advanceCursor(k);
    return;
  }
  const mover = game.players[person.playerId];
  if (!mover || mover.isEmpty) return;
  if (mover.id === seatId) { advanceCursor(k); return; }
  if (here?.isEmpty) {
    // Positional exchange with an empty seat: identities and memberships stay with their players.
    const order = [...game.seatOrder];
    const j = order.indexOf(mover.id);
    [order[k], order[j]] = [order[j]!, order[k]!];
    store().setSeatOrder(order);
    advanceCursor(k);
    return;
  }
  if (!here) return;
  const result = store().swapPlayerSeats(
    { playerId: mover.id, participantId: mover.participantId! },
    { playerId: here.id, participantId: here.participantId! });
  if (!result.ok) { flash(result.message ?? "Those seats cannot be swapped."); return; }
  advanceCursor(k);
}

function advanceCursor(from: number): void {
  const next = nextEmptyIndex(from);
  ui().set({ seatCur: next < 0 ? from : next });
}

/** "Arrival order": every waiting player takes the next empty seat, first to arrive first. */
export async function seatInArrivalOrder(): Promise<void> {
  for (const { uid } of waitingOf(store().game)) {
    const game = store().game;
    const seatId = game ? emptySeats(game)[0] : undefined;
    if (!seatId) break;
    if (!(await assignWaiting(uid, seatId))) break;
  }
  const game = store().game;
  if (game) ui().set({ seatCur: Math.max(0, game.seatOrder.findIndex((id) => game.players[id]?.isEmpty)) });
}

/**
 * Offline "Begin the night": the gathering ends once five seats carry a typed name. A seat the Storyteller left
 * unnamed keeps its number as "Player N" (a real person at the table), so the plan is never silently shortened.
 */
export function beginOffline(): boolean {
  const game = store().game;
  if (!game) return false;
  const named = game.seatOrder.filter((id) => !game.players[id]?.isEmpty).length;
  if (named < MIN_PLAYERS) { flash(`Name at least ${MIN_PLAYERS} seats to begin.`); return false; }
  for (const id of emptySeats(game)) {
    const seat = store().game?.players[id];
    if (seat?.isEmpty) store().addPlayerToSeat(`Player ${seat.seat + 1}`, id);
  }
  useSetupFlow.getState().set({ gathered: true });
  ui().set({ lobbyName: "" });
  return true;
}

/** Offline name entry: the next empty seat, in seat order, takes the typed name. */
export function nameNextSeat(raw: string): boolean {
  const name = raw.trim().slice(0, 20);
  const game = store().game;
  if (!name || !game) return false;
  const before = JSON.stringify(game.players);
  store().addPlayerToSeat(name, emptySeats(game)[0]);
  const after = store().game;
  if (!after || JSON.stringify(after.players) === before) { flash("There is no room for another player."); return false; }
  return true;
}

/** One more / one fewer seat in the plan (offline). The plan only changes in lockstep with physical seats. */
export function changeSeatCount(delta: 1 | -1): void {
  const game = store().game;
  if (!game) return;
  if (delta > 0) {
    const before = game.seatOrder.length;
    store().addEmptySeat();
    if ((store().game?.seatOrder.length ?? before) === before) flash("A town holds at most 20 players.");
    return;
  }
  const context = selectSetupContext(game);
  const floor = Math.max(MIN_PLAYERS, 0);
  if (context.population.totalPhysicalSeatCount <= floor) { flash(`A town needs at least ${MIN_PLAYERS} players.`); return; }
  const empties = emptySeats(game);
  const target = [...empties].reverse()[0];
  if (!target) { flash("Remove a name first: only an empty seat can be released."); return; }
  store().removePlayer(target);
}
