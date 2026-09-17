import { useEffect, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { seatPlayerAndCommit } from "@/firebase/membershipCommands";
import { rejectJoinRequest } from "@/firebase/lobby";
import { lifecycleMessage } from "@/firebase/lifecycle";
import type { RoomBackend } from "@/firebase/backend";
import type { PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import { Modal } from "@/components/Modal";
import { arrivalsAreTravelers } from "@/stores/travelers";

// Fallback shape when no game is open yet -- matches the pre-Setup, no
// occupants state arrivalsAreTravelers would see for a brand-new game.
const NO_GAME: Pick<StorytellerLobbyRecord, "day" | "setupRolesRevealed" | "players" | "seatOrder"> =
  { day: 0, setupRolesRevealed: false, players: {}, seatOrder: [] };

const firstEmptySeatId = (game: Pick<StorytellerLobbyRecord, "players" | "seatOrder"> | null | undefined): PlayerId | undefined =>
  game?.seatOrder.find((id) => game.players[id]?.isEmpty);

type Props = {
  /** A specific empty seat to fill -- the existing "empty seat -> choose
   * waiting player" workflow. Omit to open as a general waiting-queue view
   * (Phase 9 Setup finalization B4): the same assignment resolves against
   * whichever empty seat is first in seat order at the moment of the click,
   * through this exact same command/backend path -- never a second
   * membership path. */
  seatPlayerId?: PlayerId;
  seatNumber?: number;
  backend: RoomBackend | null;
  code: string;
  onClose: () => void;
  onRemoveSeat?: () => void;
  /** Default the "Arriving as a Traveler" checkbox on for this specific
   * target seat -- used by the "Add Traveler" workflow, whose seat is
   * deliberately ordinary-neutral at creation (Phase 9 Setup finalization,
   * Section 3.E): the seat record itself never signals the intended
   * designation, so this is a UI-only hint instead. */
  defaultTraveler?: boolean;
};

export function SeatAssignPopup({ seatPlayerId, seatNumber, backend, code, onClose, onRemoveSeat, defaultTraveler = false }: Props) {
  const pendingPlayers = useStorytellerStore((s) => s.game?.pendingPlayers ?? {});
  const activeArrival = useStorytellerStore((s) => arrivalsAreTravelers(s.game ?? NO_GAME));
  const queueTargetSeatId = useStorytellerStore((s) => seatPlayerId ?? firstEmptySeatId(s.game));
  const assignPendingToSeat = useStorytellerStore((s) => s.assignPendingToSeat);
  const removePendingPlayer = useStorytellerStore((s) => s.removePendingPlayer);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traveler, setTraveler] = useState(() => defaultTraveler || !!(queueTargetSeatId && useStorytellerStore.getState().game?.players[queueTargetSeatId]?.isTraveler));
  // Queue mode's target seat shifts to the next empty seat after each
  // assignment -- keep the manual default in sync with whichever seat is
  // next, rather than carrying over a stale checkbox value.
  useEffect(() => {
    setTraveler(defaultTraveler || !!(queueTargetSeatId && useStorytellerStore.getState().game?.players[queueTargetSeatId]?.isTraveler));
  }, [queueTargetSeatId, defaultTraveler]);

  const entries = Object.entries(pendingPlayers);
  const queueMode = seatPlayerId === undefined;
  const noSeatAvailable = queueMode && !queueTargetSeatId;

  const handleAssign = async (uid: string) => {
    if (busyUid) return;
    setError(null);
    // Resolve fresh at click time: in queue mode, an earlier assignment in
    // this same session may have already consumed the previously-first
    // empty seat.
    const targetSeatId = seatPlayerId ?? firstEmptySeatId(useStorytellerStore.getState().game);
    if (!targetSeatId) { setError("No empty seats available."); return; }
    setBusyUid(uid);
    try {
      if (code && !backend) throw new Error("Connection unavailable. Reconnect before assigning a seat.");
      if (backend && code) {
        // selfRecord must stay null here: Setup identity publication is
        // governed by the Phase 9C.4 projection barrier (see
        // projectLobbyToSelfMap), not by seating. Production seating must
        // never seed a player self record directly.
        await seatPlayerAndCommit(
          backend,
          code,
          uid,
          targetSeatId,
          null,
          () => assignPendingToSeat(uid, targetSeatId),
        );
      } else if (!assignPendingToSeat(uid, targetSeatId)) {
        return;
      }
      const store = useStorytellerStore.getState();
      // Re-read after the Firebase-first command: play may have begun while
      // assignment was pending. Never undo the command's Traveler default.
      if (!arrivalsAreTravelers(store.game ?? NO_GAME)) store.setIsTraveler(targetSeatId, traveler);
      if (useStorytellerStore.getState().game?.players[targetSeatId]?.isTraveler) {
        store.selectPlayer(targetSeatId);
      }
      if (!queueMode) onClose();
    } catch (e) {
      setError(lifecycleMessage(e));
    } finally {
      setBusyUid(null);
    }
  };

  const handleReject = async (uid: string) => {
    if (busyUid) return;
    setBusyUid(uid); setError(null);
    try {
      if (code && !backend) throw new Error("Connection unavailable.");
      if (code && backend) await rejectJoinRequest(backend, code, uid);
      removePendingPlayer(uid);
    } catch (error) { setError(lifecycleMessage(error)); }
    finally { setBusyUid(null); }
  };

  return (
    <Modal title={queueMode ? "Waiting queue" : `Assign player to seat ${seatNumber}`} onClose={onClose} className="seat-assign-popup">
        {noSeatAvailable && <p className="seat-assign-empty">No empty seats available. Add a seat first.</p>}
        {!noSeatAvailable && (activeArrival ? <p>Arriving as a Traveler</p> : <label className="drawer-row"><input type="checkbox" checked={traveler} disabled={busyUid !== null}
          onChange={e => setTraveler(e.target.checked)} />Arriving as a Traveler</label>)}

        {entries.length === 0 ? (
          <p className="seat-assign-empty">No players waiting yet.</p>
        ) : (
          <ul className="seat-assign-list">
            {entries.map(([uid, name]) => (
              <li key={uid} className="seat-assign-row">
                <span className="seat-assign-name">{name}</span>
                <div className="seat-assign-actions">
                  <button className="btn btn-sm btn-gold" onClick={() => handleAssign(uid)} disabled={busyUid !== null || noSeatAvailable}>
                    {busyUid === uid ? "Assigning…" : "Assign"}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleReject(uid)} disabled={busyUid !== null}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
        {onRemoveSeat && (
          <div className="seat-assign-footer">
            <button className="btn btn-sm btn-danger" onClick={onRemoveSeat}>
              Remove unused seat
            </button>
          </div>
        )}
    </Modal>
  );
}
