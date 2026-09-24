import type { ParticipantId, PlayerSelfRecord, PlayerId, RoleId } from "@/stores/types";
import { useStorytellerStore } from "@/stores/storytellerStore";
import type { RoomBackend } from "./backend";
import {
  readRosterBindings,
  revokePlayerMembership,
  seatPlayer,
  type RevocationAction,
  type SeatParticipant,
} from "./lobby";
import { leavePath, travelerChoicePath } from "./lifecycle";

export class MembershipOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipOperationError";
  }
}

/**
 * Seat remotely first, then commit the local queue/seat mutation. If the
 * local seat changed while the network request was in flight, compensate by
 * revoking the just-created binding before surfacing the failure.
 *
 * Phase 9R.2 (Astra R1): `participant` is the participation instance this
 * binding seats -- the caller mints it once and hands the SAME ParticipantId
 * to its local commit (assignPendingToSeat), so the server-side record and
 * the local occupant can later be proven to be one instance. Omitted only
 * by legacy/test callers, which then create a record-less binding.
 */
export async function seatPlayerAndCommit(
  backend: RoomBackend,
  code: string,
  uid: string,
  playerId: PlayerId,
  selfRecord: PlayerSelfRecord | null,
  commitLocal: () => boolean,
  participant: SeatParticipant | null = null,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => seatPlayerAndCommit(inner, code, uid, playerId, selfRecord, commitLocal, participant));
  await seatPlayer(backend, code, uid, playerId, selfRecord, participant);
  if (commitLocal()) return;

  try {
    await revokePlayerMembership(backend, code, playerId);
  } catch {
    throw new MembershipOperationError(
      "Firebase accepted the seat, but the local seat changed before it could be committed. Ask the Storyteller to verify this seat.",
    );
  }
  throw new MembershipOperationError(
    "The seat changed before assignment could be committed; the Firebase membership was rolled back.",
  );
}

/**
 * Phase 9R.6: a Firebase-first revocation's local occupancy completion,
 * with the Storyteller's intent made structural rather than inferred from
 * whichever callback happens to run. `action` is recorded durably in the
 * same server commit as the revocation (membershipRevocations/{uid}), so a
 * reconnect that finds `commit` never ran completes exactly this action for
 * exactly the participation instance `occupant` named -- never degrading a
 * remove to an unseat, and never acting on a later occupant of the seat.
 */
export type OccupancyCompletion = {
  action: RevocationAction;
  /** The seat's current local occupant (null when empty/absent), read inside
   * the writer's exclusive section immediately before the server commit. */
  occupant: () => ParticipantId | null;
  /** Applies `action` locally. Idempotent: false means another local event
   * already reached the desired removed/unseated state. */
  commit: () => boolean;
};

/** The production completion: `action` applied to the Storyteller store's
 * own seat `playerId` through the existing unseatPlayer()/removePlayer()
 * commands -- never a second local mutation path. */
export function storytellerOccupancyCompletion(action: RevocationAction, playerId: PlayerId): OccupancyCompletion {
  return {
    action,
    occupant: () => {
      const game = useStorytellerStore.getState().game;
      const seat = game && Object.prototype.hasOwnProperty.call(game.players, playerId) ? game.players[playerId] : undefined;
      return seat && !seat.isEmpty && seat.participantId ? seat.participantId : null;
    },
    commit: () => action === "remove"
      ? useStorytellerStore.getState().removePlayer(playerId)
      : useStorytellerStore.getState().unseatPlayer(playerId),
  };
}

/** Revoke remote membership first, then apply the local removal/unseat.
 * Phase 9R.6: the revocation commit carries the durable receipt of
 * `completion` (see revokePlayerMembership); a refused or failed server
 * revocation never reaches `completion.commit`. */
export async function revokePlayerAndCommit(
  backend: RoomBackend,
  code: string,
  playerId: PlayerId,
  completion: OccupancyCompletion,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => revokePlayerAndCommit(inner, code, playerId, completion));
  await revokePlayerMembership(backend, code, playerId, completion);
  completion.commit();
}

/**
 * Explicit Storyteller acceptance of a player's leave request (Phase 9C.3,
 * OPUS-003). The requesting uid's playerId is re-resolved from the CURRENT
 * live roster — a playerId captured earlier by the calling UI is never
 * trusted, since the binding may have moved on since the request was last
 * observed. When a binding still exists this reuses the existing
 * Firebase-first revocation path (revokePlayerMembership, then the local
 * commit) unchanged: the same one write path atomically clears the roster
 * binding and private projection, sets the existing "revoked" outcome, and
 * clears the leave request — the seat itself is left as an empty/planned
 * seat, never removed. When the uid no longer has a binding (it left, or
 * the request is otherwise stale), this is pure cleanup: only the leave
 * request is cleared, and no unrelated local seat is touched.
 *
 * Phase 9R.6: `completionFor` receives the freshly-resolved playerId. An
 * accepted departure is always an unseat -- a completion declaring any
 * other action is refused before anything is written.
 */
export async function acceptLeaveRequest(
  backend: RoomBackend,
  code: string,
  uid: string,
  completionFor: (playerId: PlayerId) => OccupancyCompletion,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => acceptLeaveRequest(inner, code, uid, completionFor));
  const bindings = await readRosterBindings(backend, code);
  const playerId = bindings[uid];
  if (!playerId) {
    await backend.set(leavePath(code, uid), null);
    return;
  }
  const completion = completionFor(playerId);
  if (completion.action !== "unseat") {
    throw new MembershipOperationError("An accepted leave request only unseats the player; the seat itself is kept.");
  }
  await revokePlayerAndCommit(backend, code, playerId, completion);
}

/**
 * Explicit Storyteller rejection ("keep seated") of a player's leave
 * request. Clears only leaveRequests/{uid} through the Storyteller's
 * existing fenced writer path — never roster, the private projection,
 * outcomes, or any local Storyteller/seat state.
 */
export async function rejectLeaveRequest(backend: RoomBackend, code: string, uid: string): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => rejectLeaveRequest(inner, code, uid));
  await backend.set(leavePath(code, uid), null);
}

/**
 * Applies a player's self-chosen Traveler character (Phase 9 Setup
 * finalization B4, revised). The requesting uid's playerId is re-resolved
 * from the CURRENT live roster -- a playerId observed earlier by the
 * calling watcher is never trusted, mirroring acceptLeaveRequest.
 * `commitLocal` receives this freshly-resolved id and decides whether to
 * apply it. Precedence: a current Storyteller-assigned Traveler character
 * always wins over an older pending player choice -- the caller applies the
 * choice only when the seat is still a Traveler with NO character assigned
 * yet; once any character is assigned (by this exact choice, a Storyteller
 * override, or a status change), the request is stale/superseded and this
 * function still clears it without commitLocal changing the role. This is
 * the exact same assignRole() command the Storyteller's own manual Traveler
 * override uses, never a second mutation path. Always clears the request
 * node afterward, whether or not a binding was found (stale requests are
 * pure cleanup) -- the player may resubmit if the seat's binding recovers.
 */
export async function applyTravelerChoice(
  backend: RoomBackend,
  code: string,
  uid: string,
  roleId: RoleId,
  commitLocal: (playerId: PlayerId, roleId: RoleId) => void,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => applyTravelerChoice(inner, code, uid, roleId, commitLocal));
  const bindings = await readRosterBindings(backend, code);
  const playerId = bindings[uid];
  if (playerId) commitLocal(playerId, roleId);
  await backend.set(travelerChoicePath(code, uid), null);
}
