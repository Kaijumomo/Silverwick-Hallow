import type { PlayerSelfRecord, PlayerId, RoleId } from "@/stores/types";
import type { RoomBackend } from "./backend";
import {
  readRosterBindings,
  revokePlayerMembership,
  seatPlayer,
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
