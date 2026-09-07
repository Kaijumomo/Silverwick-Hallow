import type { PlayerSelfRecord, PlayerId } from "@/stores/types";
import type { RoomBackend } from "./backend";
import {
  revokePlayerMembership,
  seatPlayer,
} from "./lobby";

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
