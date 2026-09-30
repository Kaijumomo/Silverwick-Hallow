import type { ParticipantId, PlayerSelfRecord, PlayerId, RoleId, StorytellerLobbyRecord } from "@/stores/types";
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
import { rosterParticipantPath } from "./paths";
import { decodeRosterParticipant } from "./snapshots";

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

/** The participation instance a Traveler choice is applied to: the roster
 * binding's playerId plus the ParticipantId the AUTHORITATIVE
 * rosterParticipants record names for it. */
export type TravelerChoiceBinding = { playerId: PlayerId; participantId: ParticipantId };

/**
 * Phase 10D (ASTRA-10D-001): ONE observed Traveler request, bound at
 * observation time to the participation instance that then held the seat. The
 * player-written request carries only a character id; the ParticipantId comes
 * from the Storyteller's own Current State and stays Storyteller-private (no
 * player-visible field, no request nonce).
 */
export type ObservedTravelerChoice = TravelerChoiceBinding & { roleId: RoleId };

/** The participation instance `playerId`'s seat holds in `game`, or null while
 * it holds none (absent, empty, or no ParticipantId). */
function seatParticipation(game: StorytellerLobbyRecord | null | undefined, playerId: PlayerId): ParticipantId | null {
  const occupant = game && Object.prototype.hasOwnProperty.call(game.players, playerId) ? game.players[playerId] : undefined;
  return occupant && !occupant.isEmpty && occupant.participantId ? occupant.participantId : null;
}

/**
 * Binds a request observed for `playerId` (the live roster's binding of the
 * requesting uid) to the participation instance the Storyteller's seat holds
 * NOW. Null while the seat holds no participation: nothing is processed until
 * the request can be observed for one.
 */
export function observeTravelerChoice(playerId: PlayerId, roleId: RoleId): ObservedTravelerChoice | null {
  const participantId = seatParticipation(useStorytellerStore.getState().game, playerId);
  return participantId ? { playerId, participantId, roleId } : null;
}

/**
 * Phase 10D (CLOSURE-02): the participation each pending request would be
 * observed for right now (see observeTravelerChoice), as one comparable value.
 * A request deferred only because its seat holds no participation yet is
 * retried exactly when this changes -- the Storyteller's own seating commit, a
 * recovered occupant, a new participation of the same seat -- and is then
 * observed for, and validated against, that participation. Storyteller-local
 * (never published); ignores every other game change.
 */
export function pendingTravelerChoiceParticipation(
  game: StorytellerLobbyRecord | null | undefined,
  choices: Record<string, { playerId: PlayerId | null }>,
): string {
  return JSON.stringify(Object.values(choices).map(({ playerId }) => playerId ? seatParticipation(game, playerId) : null));
}

/**
 * The production local commit of a Traveler choice (Phase 10D): the choice is
 * applied through the Role seam, BOUND to the participation instance the
 * authoritative roster record named (`binding.participantId`) and to the
 * observed unassigned Traveler state (expected blank Role, expected Traveler
 * status). Nothing is applied -- and the request is simply cleared by the
 * caller -- when the local occupant is not that participant, is not a Traveler,
 * or already has a character (a Storyteller override, or this exact choice
 * already applied); the seam itself also refuses such a request as stale.
 * Never a second mutation path.
 */
export function commitTravelerChoiceLocally(binding: TravelerChoiceBinding, roleId: RoleId): void {
  const store = useStorytellerStore.getState();
  const game = store.game;
  const player = game && Object.prototype.hasOwnProperty.call(game.players, binding.playerId) ? game.players[binding.playerId] : undefined;
  if (!player?.isTraveler || player.actualRole || player.participantId !== binding.participantId) return;
  store.resolveRoles({ intents: [{
    kind: "changeActualRole", target: binding, expectedActualRole: "", expectedIsTraveler: true, actualRole: roleId,
  }] });
}

/**
 * Applies a player's self-chosen Traveler character (Phase 9 Setup
 * finalization B4, revised; Phase 10D participation binding). The participation
 * instance is never read from the player-written request (which carries only a
 * character id) and never inferred from a seat, name or UID.
 *
 * Phase 10D (ASTRA-10D-001): the callback is bound to the request AND to the
 * participation it was OBSERVED for (`observed`, see observeTravelerChoice),
 * and inside the fenced writer's exclusive section -- before anything local
 * changes -- it re-establishes all of:
 *  1. the request still exists remotely with the observed character, so a
 *     request that was consumed or cleared never re-applies (not even after an
 *     Undo returns the participant to blank), and a callback observed for an
 *     earlier request never applies or consumes a LATER request generation.
 *     CLOSURE-01 (Sol-amended): a pending request is immutable for the player
 *     -- the rules admit only a create or a same-value resubmit, never a
 *     replacement or deletion -- and every Storyteller-side write that clears
 *     it (this command, revocation, seating) runs in this same exclusive
 *     section. So the value read here is exactly the value this callback
 *     later clears; a different value can only be a new request made after
 *     an earlier one was legitimately cleared. This is not a general
 *     compare-and-consume: it relies on that immutability rule;
 *  2. the uid's CURRENT roster binding is the observed seat;
 *  3. the authoritative `rosterParticipants/{uid}` record (Storyteller-only,
 *     written with the binding in one fenced update) names the observed
 *     ParticipantId and seat;
 *  4. ASTRA-FINAL-01: after the last await, the writer executing this
 *     operation is still active -- a FINAL synchronous writer-lifetime gate
 *     (`backend.assertActive`), with no await between it and the local
 *     mutation. A writer that stopped while a read above was in flight (its
 *     lease lost, another tab taking over) never mutates local Current State;
 *     server writes stay fenced by Firebase as before;
 *  5. `commitLocal`: the local occupant still is that participant and still an
 *     unassigned Traveler, submitted through the Role seam with the expected
 *     state blank / Traveler (so a Storyteller-assigned character wins).
 *
 * The request is cleared (fenced, idempotent -- never replayed) only when it
 * provably belongs to the observed participation (1-3 hold: applied, or
 * superseded by a Storyteller assignment / status change) or provably to NO
 * participation (the uid has no binding; a player can write one only while
 * bound). A request the binding or record attributes to ANOTHER participation
 * -- or that cannot be attributed (no valid record) -- is neither applied nor
 * consumed by this callback: a request left by an earlier participation never
 * reaches its replacement, and a replacement's own request is processed by
 * its own observation. Revocation and re-seating also clear
 * `travelerChoices/{uid}` in their own fenced multi-path update (lobby.ts).
 */
export async function applyTravelerChoice(
  backend: RoomBackend,
  code: string,
  uid: string,
  observed: ObservedTravelerChoice,
  commitLocal: (binding: TravelerChoiceBinding, roleId: RoleId) => void,
): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => applyTravelerChoice(inner, code, uid, observed, commitLocal));
  const request = travelerChoicePath(code, uid);
  if ((await backend.get(request)) !== observed.roleId) return;
  const playerId = (await readRosterBindings(backend, code))[uid];
  if (!playerId) {
    await backend.set(request, null);
    return;
  }
  if (playerId !== observed.playerId) return;
  const record = decodeRosterParticipant(await backend.get(rosterParticipantPath(code, uid)));
  if (record.status !== "ready" || record.data.playerId !== observed.playerId ||
    record.data.participantId !== observed.participantId) return;
  // ASTRA-FINAL-01: final writer-lifetime gate. Synchronous and immediately
  // before the local Role mutation -- no await in between.
  backend.assertActive?.();
  commitLocal({ playerId: observed.playerId, participantId: observed.participantId }, observed.roleId);
  await backend.set(request, null);
}
