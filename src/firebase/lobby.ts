// Lobby lifecycle: code generation, ST claim, player join knock, ST seating.
// All side-effects go through the injected RoomBackend.

import type { Json, RoomBackend } from "./backend";
import {
  joinRequestPath,
  joinRequestsPath,
  lobbyStatusPath,
  membershipRevocationPath,
  playerPath,
  rosterEntryPath,
  rosterParticipantPath,
  rosterPath,
  storytellerPath,
  storytellerUidPath,
} from "./paths";
import type { ParticipantId, PlayerId, PlayerSelfRecord } from "@/stores/types";
import { sessionPath, outcomePath, leavePath, LifecycleError } from "./lifecycle";
import { decodeRosterEntry, decodeRosterParticipant, decodeJoinRequests, decodeRoster, decodeLobbyStatus, reportSnapshotProblem, SnapshotValidationError, subscribeDecoded, DATA_ERROR_MESSAGE, CONNECTION_ERROR_MESSAGE } from "./snapshots";

// Confusable-glyph-free alphabet (no 0/O, 1/I/L). 30 chars, ~656bn 8-char codes.
const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";

/** Format a raw 8-char code for display as "XXXX-XXXX". Shorter codes returned as-is. */
export function formatCode(code: string): string {
  if (code.length === 8) return `${code.slice(0, 4)}-${code.slice(4)}`;
  return code;
}

/** Strip hyphens and uppercase — normalise user-typed codes before matching. */
export function normaliseCode(raw: string): string {
  return raw.replace(/-/g, "").toUpperCase().trim();
}

export function canonicalJoin(code: string, name: string) {
  const canonicalCode = normaliseCode(code);
  const canonicalName = name.trim();
  if (!/^[A-Z0-9]{8}$/.test(canonicalCode)) throw new LifecycleError("invalid", "Enter a valid eight-character lobby code.");
  if (!canonicalName || canonicalName.length > 20 || /[\r\n\t]/.test(canonicalName)) throw new LifecycleError("invalid", "Enter a name of 1–20 characters on one line.");
  return { code: canonicalCode, name: canonicalName };
}

export function generateCode(length = 8): string {
  let out = "";
  const arr =
    typeof globalThis.crypto !== "undefined"
      ? globalThis.crypto.getRandomValues(new Uint8Array(length))
      : null;
  for (let i = 0; i < length; i++) {
    const r = arr ? arr[i]! : Math.floor(Math.random() * 256);
    out += ALPHABET[r % ALPHABET.length];
  }
  return out;
}

const MAX_CREATE_ATTEMPTS = 20;

export async function createLobby(
  backend: RoomBackend,
  uid: string,
  options: { codeGenerator?: () => string } = {}
): Promise<{ code: string }> {
  const gen = options.codeGenerator ?? (() => generateCode());
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = gen();
    const claim = await backend.setIfAbsent(storytellerUidPath(code), uid);
    if (claim.committed) {
      await backend.set(sessionPath(code), { version: 2, id: crypto.randomUUID(), state: "active" });
      return { code };
    }
  }
  throw new Error(
    `Could not allocate a lobby code after ${MAX_CREATE_ATTEMPTS} attempts.`
  );
}

// ---------------------------------------------------------------------------
// Requests and authoritative membership (see PROTOCOL.md)
// ---------------------------------------------------------------------------
// Names live only in joinRequests/{uid}. Only the ST writes roster/{uid}.

/** Player creates a bounded request; never writes an authoritative binding. */
export async function knockOnLobby(
  backend: RoomBackend,
  code: string,
  uid: string,
  requestedName: string
): Promise<void> {
  const trimmed = requestedName.trim();
  if (!trimmed) throw new Error("Name is required.");
  if (trimmed.length > 20 || /[\r\n\t]/.test(trimmed)) {
    throw new Error("Name must be a single line of at most 20 characters.");
  }
  // A seated reconnect needs no request. Rules enforce this independently.
  if ((await readOwnRosterEntry(backend, code, uid)).phase === "seated") return;
  await backend.setIfAbsent(joinRequestPath(code, uid), trimmed);
}

/** Player cancels their request, or the ST rejects it. Does not revoke a seat. */
export async function cancelJoinRequest(backend: RoomBackend, code: string, uid: string): Promise<void> {
  await backend.set(joinRequestPath(code, uid), null);
}

/** ST-only membership revocation. Rules deny subsequent private reads.
 * Phase 9R.2: the binding's participant record goes with it, atomically. */
export async function revokeMembership(backend: RoomBackend, code: string, uid: string): Promise<void> {
  await backend.update({
    [rosterEntryPath(code, uid)]: null, [rosterParticipantPath(code, uid)]: null,
    [outcomePath(code, uid)]: "revoked", [leavePath(code, uid)]: null,
  });
}

export async function rejectJoinRequest(backend: RoomBackend, code: string, uid: string): Promise<void> {
  if (backend.runExclusive) return backend.runExclusive(inner => rejectJoinRequest(inner, code, uid));
  if ((await readOwnRosterEntry(backend, code, uid)).phase === "seated") {
    throw new MembershipConflictError("This player has already been seated. Use unseat or remove instead.");
  }
  await backend.update({ [joinRequestPath(code, uid)]: null, [outcomePath(code, uid)]: "rejected" });
}

/**
 * Phase 9R.2 (Astra R1): the participation instance a roster binding seats --
 * the ParticipantId the Storyteller's local occupancy commit will use for
 * this exact binding, plus the seat-time name. Stored Storyteller-only at
 * rosterParticipants/{uid}, beside roster/{uid}, so that recovery can PROVE
 * (by ParticipantId equality, never by UID/name/seat) whether a recovered
 * game's occupant of that seat is this binding's participant.
 */
export type SeatParticipant = { participantId: ParticipantId; name: string };

/**
 * ST-side: atomically write the player's projection AND bind roster/{uid} to
 * the new playerId. The atomicity is critical when a self projection is
 * available — without it, the player would see roster/{uid} === playerId
 * before player/{playerId} exists.
 *
 * If `selfRecord` is null (no published identity yet), the roster bind is
 * written and any stale self record is deleted. The player reads `null`
 * until the ST establishes shown identity and the next sync publishes it.
 * The UI handles "no role yet" via the sealed-card placeholder.
 */
export async function seatPlayer(
  backend: RoomBackend,
  code: string,
  uid: string,
  playerId: PlayerId,
  selfRecord: PlayerSelfRecord | null,
  participant: SeatParticipant | null = null,
): Promise<void> {
  const bindings = await readRosterBindings(backend, code);
  const existingForUid = bindings[uid];
  if (existingForUid && existingForUid !== playerId) {
    throw new MembershipConflictError("This UID is already bound to another seat.");
  }
  const existingForPlayer = Object.entries(bindings).find(
    ([boundUid, boundPlayerId]) => boundPlayerId === playerId && boundUid !== uid,
  );
  if (existingForPlayer) {
    throw new MembershipConflictError("This seat is already bound to another UID.");
  }
  const updates: Record<string, Json> = {
    [rosterEntryPath(code, uid)]: playerId,
    // Phase 9R.2 (Astra R1): the binding and the record of which
    // participation instance it seats are written together, in this one
    // update. A binding created without a participant (legacy callers)
    // explicitly clears any record, so a stale record can never pair with a
    // newer binding.
    [rosterParticipantPath(code, uid)]: participant
      ? { playerId, participantId: participant.participantId, name: participant.name }
      : null,
    [joinRequestPath(code, uid)]: null,
    [outcomePath(code, uid)]: null,
    // Phase 9R.6: seating this UID into a new participation instance
    // retires any receipt of an earlier revocation of it, in this same
    // update. (A stale receipt is inert anyway -- it only ever matches its
    // own ParticipantId, and this seat gets a fresh one.)
    [membershipRevocationPath(code, uid)]: null,
  };
  // An unrevealed seat must not retain an earlier occupant's projection.
  updates[playerPath(code, playerId)] = selfRecord as unknown as Json;
  await backend.update(updates);
}

/**
 * Phase 9R.6: the local occupancy completion a Storyteller revocation owes.
 * "unseat" keeps the seat/PlayerId as an empty seat (unseatPlayer); "remove"
 * deletes the seat itself (removePlayer). Explicit, never inferred.
 */
export type RevocationAction = "unseat" | "remove";

/**
 * Phase 9R.6: what revokePlayerMembership needs to record a durable
 * revocation receipt. `occupant` reads the ParticipantId currently occupying
 * the seat in the Storyteller's local Current State (null when the seat is
 * empty or absent); it is called synchronously immediately before the
 * server commit, after every read, so it names exactly the participation
 * instance the caller's local completion will end.
 */
export type RevocationCompletion = { action: RevocationAction; occupant: () => ParticipantId | null };

/**
 * Revoke the UID bound to a local player seat and delete its private
 * projection in one Storyteller-authorized multi-path update. Repeating the
 * operation is safe: an already-absent binding still clears the stale private
 * path, if any.
 *
 * Phase 9R.6: when the caller owes a local occupancy completion
 * (`completion`), the SAME update also writes membershipRevocations/{uid} =
 * {playerId, participantId, action} -- durable proof, for a reconnect that
 * finds the local completion never landed, of exactly which participation
 * instance was revoked and how its seat must be completed. The
 * ParticipantId comes from the binding's rosterParticipants record when one
 * exists (it must name this seat, and must agree with the local occupant --
 * a contradiction refuses the whole revocation before anything is written);
 * for a legacy record-less binding, from the local occupant this very
 * writer lineage is publishing to that binding. With neither, there is no
 * participation instance to complete and no receipt is written. Never a
 * name, UID, seat, or regenerated id.
 */
export async function revokePlayerMembership(
  backend: RoomBackend,
  code: string,
  playerId: PlayerId,
  completion: RevocationCompletion | null = null,
): Promise<{ uid: string | null }> {
  const bindings = await readRosterBindings(backend, code);
  const matches = Object.entries(bindings).filter(([, boundPlayerId]) => boundPlayerId === playerId);
  if (matches.length > 1) {
    throw new MembershipConflictError("This seat is bound to more than one UID.");
  }
  const uid = matches[0]?.[0] ?? null;
  const updates: Record<string, Json> = {
    [playerPath(code, playerId)]: null,
  };
  if (uid) {
    updates[rosterEntryPath(code, uid)] = null;
    updates[rosterParticipantPath(code, uid)] = null;
    updates[outcomePath(code, uid)] = "revoked";
    updates[leavePath(code, uid)] = null;
    if (completion) {
      const record = decodeRosterParticipant(await backend.get(rosterParticipantPath(code, uid)));
      if (record.status === "invalid") {
        reportSnapshotProblem("roster participant", record.issues);
        throw new SnapshotValidationError();
      }
      // Read last, synchronously, with no await before the commit below.
      const occupant = completion.occupant();
      let participantId: ParticipantId | null = occupant;
      if (record.status === "ready") {
        if (record.data.playerId !== playerId) {
          throw new MembershipConflictError("This seat's membership record names a different seat. Reconnect before changing it.");
        }
        if (occupant !== null && occupant !== record.data.participantId) {
          throw new MembershipConflictError("This seat's occupant is not the participant its membership record names. Reconnect before changing it.");
        }
        participantId = record.data.participantId;
      }
      if (participantId) {
        updates[membershipRevocationPath(code, uid)] = { playerId, participantId, action: completion.action };
      }
    }
  }
  await backend.update(updates);
  return { uid };
}

/** Roster values are bindings, even if the matching local seat is absent. */
export type RosterEntry =
  | { uid: string; phase: "seated"; playerId: PlayerId };

export class MembershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipConflictError";
  }
}

/** Read and validate the authoritative UID → playerId bindings. */
export async function readRosterBindings(
  backend: RoomBackend,
  code: string,
): Promise<Record<string, string>> {
  const snapshot = decodeRoster(await backend.get(rosterPath(code)));
  if (snapshot.status === "invalid") {
    reportSnapshotProblem("roster", snapshot.issues);
    throw new SnapshotValidationError();
  }
  return snapshot.status === "ready" ? snapshot.data : {};
}

export function classifyRoster(
  raw: Record<string, string> | null | undefined
): RosterEntry[] {
  if (!raw) return [];
  const entries: RosterEntry[] = [];
  for (const [uid, value] of Object.entries(raw)) {
    if (typeof value !== "string" || value.length === 0) continue;
    entries.push({ uid, phase: "seated", playerId: value });
  }
  return entries;
}

/** Read roster/{uid} once. Used by a player on (re)connect to discover their playerId. */
export async function readOwnRosterEntry(
  backend: RoomBackend,
  code: string,
  uid: string
): Promise<{ phase: "absent" } | { phase: "seated"; playerId: PlayerId }> {
  const value = await backend.get(rosterEntryPath(code, uid));
  const snapshot = decodeRosterEntry(value);
  if (snapshot.status === "invalid") {
    reportSnapshotProblem("roster entry", snapshot.issues);
    throw new SnapshotValidationError();
  }
  return snapshot.status === "waiting" ? { phase: "absent" } : { phase: "seated", playerId: snapshot.data };
}

/** ST-only request collection. Never classify request text as a player ID. */
export function watchJoinRequests(
  backend: RoomBackend,
  code: string,
  cb: (requests: Record<string, string>) => void,
  onInvalid?: (message: string) => void,
): () => void {
  return subscribeDecoded(backend, joinRequestsPath(code), decodeJoinRequests, (snapshot) => {
    if (snapshot.status === "ready") cb(snapshot.data);
    else if (snapshot.status === "invalid") onInvalid?.(DATA_ERROR_MESSAGE);
  }, () => onInvalid?.(CONNECTION_ERROR_MESSAGE));
}

// ---------------------------------------------------------------------------
// Lobby lifecycle — status
// ---------------------------------------------------------------------------

/**
 * Legacy status-only teardown retained for compatibility with older callers
 * and unit tests. Production Storyteller sessions use SessionWriter.close(),
 * which serializes the terminal session transition, fences stale writes, and
 * clears all lifecycle paths in one guarded update.
 */
export async function endLobby(
  backend: RoomBackend,
  code: string,
  playerIds?: PlayerId[]
): Promise<void> {
  await backend.set(lobbyStatusPath(code), "ended");
  // Null values delete nodes in an RTDB multi-path update.
  const cleanups: Record<string, Json> = { [storytellerPath(code)]: null };
  for (const pid of playerIds ?? []) {
    cleanups[playerPath(code, pid)] = null;
  }
  await backend.update(cleanups);
}

/**
 * Legacy status reader. New lifecycle code reads the validated v2 session
 * record instead; absent status is treated as active for old callers only.
 */
export async function checkLobbyStatus(
  backend: RoomBackend,
  code: string
): Promise<"active" | "ended"> {
  const val = await backend.get(lobbyStatusPath(code));
  const snapshot = decodeLobbyStatus(val);
  if (snapshot.status === "ready") return snapshot.data;
  if (snapshot.status === "invalid") reportSnapshotProblem("lobby status", snapshot.issues);
  throw new SnapshotValidationError();
}

/**
 * Legacy status subscription retained for old display callers. New player and
 * public flows subscribe to the validated v2 session record.
 */
export function watchLobbyStatus(
  backend: RoomBackend,
  code: string,
  cb: (status: "active" | "ended") => void,
  onInvalid?: (message: string) => void,
): () => void {
  return subscribeDecoded(backend, lobbyStatusPath(code), decodeLobbyStatus, (snapshot) => {
    if (snapshot.status === "ready") cb(snapshot.data);
    else if (snapshot.status === "invalid") onInvalid?.(DATA_ERROR_MESSAGE);
  }, () => onInvalid?.(CONNECTION_ERROR_MESSAGE));
}

/** Watch the full roster object for changes. */
export function watchRoster(
  backend: RoomBackend,
  code: string,
  cb: (raw: Record<string, string> | null) => void,
  onInvalid?: (message: string) => void,
): () => void {
  return subscribeDecoded(backend, rosterPath(code), decodeRoster, (snapshot) => {
    if (snapshot.status === "ready") cb(Object.keys(snapshot.data).length ? snapshot.data : null);
    else if (snapshot.status === "invalid") onInvalid?.(DATA_ERROR_MESSAGE);
  }, () => onInvalid?.(CONNECTION_ERROR_MESSAGE));
}
