import { useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { seatPlayerAndCommit } from "@/firebase/membershipCommands";
import type { RoomBackend } from "@/firebase/backend";
import type { PlayerId } from "@/stores/types";

type Props = {
  seatPlayerId: PlayerId;
  seatNumber: number;
  backend: RoomBackend | null;
  code: string;
  onClose: () => void;
};

export function SeatAssignPopup({ seatPlayerId, seatNumber, backend, code, onClose }: Props) {
  const pendingPlayers = useStorytellerStore((s) => s.game?.pendingPlayers ?? {});
  const assignPendingToSeat = useStorytellerStore((s) => s.assignPendingToSeat);
  const removePendingPlayer = useStorytellerStore((s) => s.removePendingPlayer);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(pendingPlayers);

  const handleAssign = async (uid: string) => {
    if (busyUid) return;
    setError(null);
    setBusyUid(uid);
    try {
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
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign this player.");
    } finally {
      setBusyUid(null);
    }
  };

  const handleReject = (uid: string) => {
    removePendingPlayer(uid);
  };

  return (
    <>
      <div className="seat-assign-backdrop" onClick={onClose} />
      <div className="seat-assign-popup" role="dialog" aria-label={`Assign player to seat ${seatNumber}`}>
        <div className="seat-assign-header">
          <span className="seat-assign-title">Assign to Seat {seatNumber}</span>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

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
      </div>
    </>
  );
}
