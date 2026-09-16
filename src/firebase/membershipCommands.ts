import type { PlayerSelfRecord, PlayerId, RoleId } from "@/stores/types";
import type { RoomBackend } from "./backend";
import {
  readRosterBindings,
  revokePlayerMembership,
  seatPlayer,
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
 */
export async function seatPlayerAndCommit(
  backend: RoomBackend,
  code: string,
  uid: string,
  playerId: PlayerId,
  selfRecord: PlayerSelfRecord | null,
  commitLocal: () => boolean,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => seatPlayerAndCommit(inner, code, uid, playerId, selfRecord, commitLocal));
  await seatPlayer(backend, code, uid, playerId, selfRecord);
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

/** Revoke remote membership first, then apply the local removal/unseat. */
export async function revokePlayerAndCommit(
  backend: RoomBackend,
  code: string,
  playerId: PlayerId,
  commitLocal: () => boolean,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => revokePlayerAndCommit(inner, code, playerId, commitLocal));
  await revokePlayerMembership(backend, code, playerId);
  // Both local mutations are idempotent: false means another local event
  // already reached the desired removed/unseated state.
  commitLocal();
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
 */
export async function acceptLeaveRequest(
  backend: RoomBackend,
  code: string,
  uid: string,
  commitLocal: (playerId: PlayerId) => boolean,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => acceptLeaveRequest(inner, code, uid, commitLocal));
  const bindings = await readRosterBindings(backend, code);
  const playerId = bindings[uid];
  if (!playerId) {
    await backend.set(leavePath(code, uid), null);
    return;
  }
  await revokePlayerAndCommit(backend, code, playerId, () => commitLocal(playerId));
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
 * finalization B4). The requesting uid's playerId is re-resolved from the
 * CURRENT live roster -- a playerId observed earlier by the calling watcher
 * is never trusted, mirroring acceptLeaveRequest. `commitLocal` receives
 * this freshly-resolved id and decides whether to apply it (it re-checks
 * the player is still a Traveler and does not already carry this role,
 * since the request may have been superseded by a Storyteller override or
 * a status change since it was submitted) -- this is the exact same
 * assignRole() command the Storyteller's own manual Traveler override
 * uses, never a second mutation path. Always clears the request node
 * afterward, whether or not a binding was found (stale requests are pure
 * cleanup) -- the player may resubmit if the seat's binding recovers.
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
