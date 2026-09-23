import { useEffect, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { seatPlayerAndCommit } from "@/firebase/membershipCommands";
import { newParticipantId } from "@/stores/participants";
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
};

export function SeatAssignPopup({ seatPlayerId, seatNumber, backend, code, onClose, onRemoveSeat }: Props) {
  const pendingPlayers = useStorytellerStore((s) => s.game?.pendingPlayers ?? {});
  const activeArrival = useStorytellerStore((s) => arrivalsAreTravelers(s.game ?? NO_GAME));
  const queueTargetSeatId = useStorytellerStore((s) => seatPlayerId ?? firstEmptySeatId(s.game));
  // Set once "Add Traveler" reserved this exact seat (Phase 9 Setup
  // finalization, FINAL POPULATION CLOSURE Section 3): the store's own
  // arrivalPlayer() already guarantees occupying it becomes a Traveler, so
  // this is display-only here -- never re-derived after assignment (that
  // was Section 5's timing bug) and never itself the thing that decides.
  const reservedTraveler = useStorytellerStore((s) => !!(queueTargetSeatId && s.game?.players[queueTargetSeatId]?.plannedTravelerSeat));
  const assignPendingToSeat = useStorytellerStore((s) => s.assignPendingToSeat);
  const removePendingPlayer = useStorytellerStore((s) => s.removePendingPlayer);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traveler, setTraveler] = useState(false);
  // Queue mode's target seat shifts to the next empty seat after each
  // assignment -- keep the manual default in sync with whichever seat is
  // next, rather than carrying over a stale checkbox value. A seat that is
  // already guaranteed to become a Traveler (arrival cap or reservation)
  // shows fixed text instead of a checkbox, so there is nothing to default.
  useEffect(() => { setTraveler(false); }, [queueTargetSeatId]);

  const entries = Object.entries(pendingPlayers);
  const queueMode = seatPlayerId === undefined;
  const noSeatAvailable = queueMode && !queueTargetSeatId;
  // Fixed ("will arrive as a Traveler") vs a free Storyteller choice --
  // never both at once, and the reservation is exactly as authoritative as
  // the arrival-cap policy, never a lesser hint.
  const guaranteedTraveler = activeArrival || reservedTraveler;

  const handleAssign = async (uid: string) => {
    if (busyUid) return;
    setError(null);
    // Resolve fresh at click time: in queue mode, an earlier assignment in
    // this same session may have already consumed the previously-first
    // empty seat.
    const targetSeatId = seatPlayerId ?? firstEmptySeatId(useStorytellerStore.getState().game);
    if (!targetSeatId) { setError("No empty seats available."); return; }
    // FINAL POPULATION CLOSURE, Section 5: capture the Storyteller's
    // explicit choice BEFORE seating -- the store's own fill command
    // (arrivalPlayer, via assignPendingToSeat) already and atomically
    // handles the arrival-cap/reservation cases using state as it stood
    // before this seat was touched. This only ever needs to apply an
    // explicit manual choice the store had no way to know about, and must
    // never be re-derived from post-fill occupancy (that was the bug: an
    // assignment that itself pushed ordinary occupancy to the cap could
    // make a later arrivalsAreTravelers() recheck spuriously suppress the
    // very choice just made).
    const requestedTraveler = traveler;
    setBusyUid(uid);
    try {
      if (code && !backend) throw new Error("Connection unavailable. Reconnect before assigning a seat.");
      if (backend && code) {
        // Phase 9R.2 (Astra R1): mint this seating's participation instance
        // ONCE, so the server's rosterParticipants record and the local
        // occupant name the same ParticipantId -- recovery can then prove
        // (or disprove) that a recovered game's occupant of this seat is
        // this binding's participant.
        const name = useStorytellerStore.getState().game?.pendingPlayers[uid];
        if (!name) throw new Error("This player is no longer waiting.");
        const participant = { participantId: newParticipantId(), name };
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
          () => assignPendingToSeat(uid, targetSeatId, participant.participantId),
          participant,
        );
      } else if (!assignPendingToSeat(uid, targetSeatId)) {
        return;
      }
      const store = useStorytellerStore.getState();
      const seated = store.game?.players[targetSeatId];
      if (requestedTraveler && seated && !seated.isEmpty && !seated.isTraveler) store.setIsTraveler(targetSeatId, true);
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
        {!noSeatAvailable && (guaranteedTraveler ? <p>Arriving as a Traveler{reservedTraveler && !activeArrival ? " (reserved)" : ""}</p> : <label className="drawer-row"><input type="checkbox" checked={traveler} disabled={busyUid !== null}
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
