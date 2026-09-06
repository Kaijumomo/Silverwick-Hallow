// Lobby lifecycle: code generation, ST claim, player join knock, ST seating.
// All side-effects go through the injected RoomBackend.

import type { Json, RoomBackend } from "./backend";
import {
  joinRequestPath,
  joinRequestsPath,
  lobbyStatusPath,
  playerPath,
  rosterEntryPath,
  rosterPath,
  storytellerPath,
  storytellerUidPath,
} from "./paths";
import type { PlayerId, PlayerSelfRecord } from "@/stores/types";
import { decodeRosterEntry, decodeJoinRequests, decodeRoster, decodeLobbyStatus, reportSnapshotProblem, SnapshotValidationError, subscribeDecoded, DATA_ERROR_MESSAGE, CONNECTION_ERROR_MESSAGE } from "./snapshots";

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

/** ST-only membership revocation. Rules deny subsequent private reads. */
export async function revokeMembership(backend: RoomBackend, code: string, uid: string): Promise<void> {
  await backend.set(rosterEntryPath(code, uid), null);
}

/**
 * ST-side: atomically write the player's projection AND bind roster/{uid} to
 * the new playerId. The atomicity is critical when a self projection is
 * available — without it, the player would see roster/{uid} === playerId
 * before player/{playerId} exists.
 *
 * If `selfRecord` is null (the seat has no role yet), only the roster bind
 * is written. The player will read `null` from `player/{playerId}` until
 * the ST assigns a role and the next sync write fills it in. The UI handles
 * "no role yet" gracefully via the sealed-card placeholder.
 */
export async function seatPlayer(
  backend: RoomBackend,
  code: string,
  uid: string,
  playerId: PlayerId,
  selfRecord: PlayerSelfRecord | null
): Promise<void> {
  const updates: Record<string, Json> = {
    [rosterEntryPath(code, uid)]: playerId,
    [joinRequestPath(code, uid)]: null,
  };
  if (selfRecord) {
    updates[playerPath(code, playerId)] = selfRecord as unknown as Json;
  }
  await backend.update(updates);
}

/** Roster values are bindings, even if the matching local seat is absent. */
export type RosterEntry =
  | { uid: string; phase: "seated"; playerId: PlayerId };

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
 * ST-side: mark a lobby as ended and scrub private data.
 * Writes `status = "ended"` first so players redirect immediately, then
 * fire-and-forgets a best-effort multi-path null to clear `storyteller/`
 * and each `player/{id}` (private data). `roster/` and `public/` are left
 * intact — players need roster membership to read `public/` (see rules.json).
 */
export async function endLobby(
  backend: RoomBackend,
  code: string,
  playerIds?: PlayerId[]
): Promise<void> {
  await backend.set(lobbyStatusPath(code), "ended");
  // Best-effort scrub — null values delete nodes in RTDB multi-path updates.
  const cleanups: Record<string, Json> = { [storytellerPath(code)]: null };
  for (const pid of playerIds ?? []) {
    cleanups[playerPath(code, pid)] = null;
  }
  backend.update(cleanups).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn("[endLobby cleanup]", e instanceof Error ? e.message : e);
  });
}

/**
 * Read lobby status once. Absent means the lobby is active (pre-close
 * lobbies have no status node). Returns "ended" only when explicitly set.
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
 * Subscribe to lobby status changes. Fires immediately with the current
 * status, then on every change. Used by player clients to detect when the
 * ST has ended the game and tear down their session cleanly.
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
