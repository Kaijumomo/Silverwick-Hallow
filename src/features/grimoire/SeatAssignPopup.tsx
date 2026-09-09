import { useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { seatPlayerAndCommit } from "@/firebase/membershipCommands";
import { rejectJoinRequest } from "@/firebase/lobby";
import { lifecycleMessage } from "@/firebase/lifecycle";
import type { RoomBackend } from "@/firebase/backend";
import type { PlayerId } from "@/stores/types";
import { Modal } from "@/components/Modal";
import { arrivalsAreTravelers } from "@/stores/travelers";

type Props = {
  seatPlayerId: PlayerId;
  seatNumber: number;
  backend: RoomBackend | null;
  code: string;
  onClose: () => void;
  onRemoveSeat?: () => void;
};

export function SeatAssignPopup({ seatPlayerId, seatNumber, backend, code, onClose, onRemoveSeat }: Props) {
  const pendingPlayers = useStorytellerStore((s) => s.game?.pendingPlayers ?? {});
  const activeArrival = useStorytellerStore((s) => arrivalsAreTravelers(s.game?.phase ?? "setup"));
  const assignPendingToSeat = useStorytellerStore((s) => s.assignPendingToSeat);
  const removePendingPlayer = useStorytellerStore((s) => s.removePendingPlayer);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traveler, setTraveler] = useState(() => !!useStorytellerStore.getState().game?.players[seatPlayerId]?.isTraveler);

  const entries = Object.entries(pendingPlayers);

  const handleAssign = async (uid: string) => {
    if (busyUid) return;
    setError(null);
    setBusyUid(uid);
    try {
      if (code && !backend) throw new Error("Connection unavailable. Reconnect before assigning a seat.");
      if (backend && code) {
        await seatPlayerAndCommit(
          backend,
          code,
          uid,
          seatPlayerId,
          null,
          () => assignPendingToSeat(uid, seatPlayerId),
        );
      } else if (!assignPendingToSeat(uid, seatPlayerId)) {
        return;
      }
      const store = useStorytellerStore.getState();
      // Re-read after the Firebase-first command: play may have begun while
      // assignment was pending. Never undo the command's Traveler default.
      if (!arrivalsAreTravelers(store.game?.phase ?? "setup")) store.setIsTraveler(seatPlayerId, traveler);
      if (useStorytellerStore.getState().game?.players[seatPlayerId]?.isTraveler) {
        store.selectPlayer(seatPlayerId);
      }
      onClose();
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
    <Modal title={`Assign player to seat ${seatNumber}`} onClose={onClose} className="seat-assign-popup">
        {activeArrival ? <p>Arriving as a Traveler</p> : <label className="drawer-row"><input type="checkbox" checked={traveler} disabled={busyUid !== null}
          onChange={e => setTraveler(e.target.checked)} />Arriving as a Traveler</label>}

        {entries.length === 0 ? (
          <p className="seat-assign-empty">No players waiting yet.</p>
        ) : (
          <ul className="seat-assign-list">
            {entries.map(([uid, name]) => (
              <li key={uid} className="seat-assign-row">
                <span className="seat-assign-name">{name}</span>
                <div className="seat-assign-actions">
                  <button className="btn btn-sm btn-gold" onClick={() => handleAssign(uid)} disabled={busyUid !== null}>
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
