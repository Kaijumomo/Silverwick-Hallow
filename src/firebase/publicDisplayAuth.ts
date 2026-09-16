// Phase 9C.6 (OPUS-002): Storyteller-owned Public Display capability
// lifecycle. This module centralizes every security-specific operation for
// authorizing a genuinely separate-device Public Display: token minting,
// capability decode/ensure/rotate, and a display client's own per-UID
// enrollment. `displayAccess` / `displayMembers` authorize ONLY
// `lobbies/{code}/public` — never player-private, Storyteller, or checkpoint
// data (see rules.json and PATH_AUDIT.md). It is security metadata, not game
// state: nothing here touches useStorytellerStore.game, persistence,
// checkpoints, projections, undo, or localSeq.

import { z } from "zod";
import type { Json, RoomBackend } from "./backend";
import { displayAccessPath, displayMemberPath } from "./paths";

export const DISPLAY_ACCESS_VERSION = 1 as const;
export const PUBLIC_DISPLAY_TOKEN_LENGTH = 43;
export const PUBLIC_DISPLAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** URL fragment key carrying the bearer capability token (never an ordinary
 * query parameter — see buildPublicDisplayLink). */
export const DISPLAY_TOKEN_FRAGMENT_KEY = "displayToken";

export class PublicDisplayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicDisplayAuthError";
  }
}

export function isValidDisplayToken(token: unknown): token is string {
  return typeof token === "string" && PUBLIC_DISPLAY_TOKEN_PATTERN.test(token);
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 !== undefined) out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 !== undefined) out += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Mints a fresh capability token: exactly 32 cryptographically secure random
 * bytes, encoded as unpadded base64url (43 characters). Never falls back to
 * Math.random — if secure randomness is unavailable, this fails closed with
 * a generic error that never includes token contents (there are none yet).
 */
export function generatePublicDisplayToken(): string {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new PublicDisplayAuthError("Secure randomness is unavailable in this browser.");
  }
  const bytes = cryptoObj.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(bytes);
  /* c8 ignore next 3 -- defensive: toBase64Url(32 bytes) is always 43 valid base64url chars. */
  if (!isValidDisplayToken(token)) {
    throw new PublicDisplayAuthError("Failed to generate a valid display token.");
  }
  return token;
}

const displayAccessSchema = z
  .object({
    version: z.literal(DISPLAY_ACCESS_VERSION),
    sessionId: z.string().min(1),
    token: z.string().regex(PUBLIC_DISPLAY_TOKEN_PATTERN),
  })
  .strict();

export type DisplayAccessRecord = z.infer<typeof displayAccessSchema>;

/**
 * Decodes the Storyteller-owned `displayAccess` record. Returns null for
 * anything that is not exactly the expected shape — absent, wrong version,
 * a malformed/wrong-length/wrong-alphabet token, an empty sessionId, or
 * unknown children — and never throws. This function does not know the
 * current session id; `ensurePublicDisplayAccess` compares that separately.
 */
export function decodeDisplayAccess(raw: unknown): DisplayAccessRecord | null {
  if (raw == null) return null;
  const parsed = displayAccessSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function displayAccessJson(sessionId: string, token: string): Json {
  return { version: DISPLAY_ACCESS_VERSION, sessionId, token };
}

async function ensureInner(backend: RoomBackend, code: string, sessionId: string): Promise<string> {
  const existing = decodeDisplayAccess(await backend.get(displayAccessPath(code)));
  if (existing && existing.sessionId === sessionId) return existing.token;
  // Absent, malformed, wrong version, or bound to a different session: always
  // mint a NEW token rather than preserving the old one under a new session
  // id. A session mismatch is deliberately treated as rotation so a stale
  // displayMembers binding can never reactivate under a later session.
  const token = generatePublicDisplayToken();
  await backend.update({ [displayAccessPath(code)]: displayAccessJson(sessionId, token) });
  return token;
}

/**
 * Read-first and LOAD-BEARING (Phase 9C.6, section 7): reuses a valid
 * current-session capability with ZERO writes, so routine display-link setup
 * on Storyteller reconnect never advances writeGuard and never manufactures
 * a reconnect conflict for another Storyteller device that had nothing to do
 * with the display link. Only commits when the stored record is absent,
 * malformed, the wrong version, or bound to a different session id. Runs
 * through `writer.runExclusive` when available (the live SessionWriter),
 * so this can never race `rotatePublicDisplayAccess` or another queued
 * Storyteller command — no second serialization mechanism.
 */
export async function ensurePublicDisplayAccess(
  writer: RoomBackend,
  code: string,
  sessionId: string,
): Promise<string> {
  if (writer.runExclusive) return writer.runExclusive(inner => ensureInner(inner, code, sessionId));
  return ensureInner(writer, code, sessionId);
}

async function rotateInner(backend: RoomBackend, code: string, sessionId: string): Promise<string> {
  const token = generatePublicDisplayToken();
  await backend.update({ [displayAccessPath(code)]: displayAccessJson(sessionId, token) });
  return token;
}

/**
 * Always mints and writes a fresh capability, unconditionally — never reuses
 * or reads first. Rotation immediately revokes every existing
 * `displayMembers/{uid}` binding: their stored token no longer equals the
 * current capability, so the `/public` rule denies them on their very next
 * read with no further write required. Old bindings are intentionally never
 * enumerated or deleted.
 */
export async function rotatePublicDisplayAccess(
  writer: RoomBackend,
  code: string,
  sessionId: string,
): Promise<string> {
  if (writer.runExclusive) return writer.runExclusive(inner => rotateInner(inner, code, sessionId));
  return rotateInner(writer, code, sessionId);
}

/**
 * A display client's own enrollment write: binds the connecting UID's own
 * `displayMembers/{uid}` to the capability token carried by its fragment
 * link. This is only a fast-fail local format check — the server rule in
 * rules.json is the real authorization boundary. A stale or foreign token is
 * expected to be rejected there and surfaces to the caller as an ordinary
 * permission error; this function never includes the token itself in any
 * error it throws.
 */
export async function authorizePublicDisplay(
  backend: RoomBackend,
  code: string,
  uid: string,
  token: string,
): Promise<void> {
  if (!isValidDisplayToken(token)) throw new PublicDisplayAuthError("This display link is invalid.");
  await backend.set(displayMemberPath(code, uid), token);
}

/**
 * Extracts and locally validates a `#displayToken=<TOKEN>` bearer capability
 * from a URL fragment (e.g. `location.hash`). Returns null for a missing or
 * malformed token. Local validation is a fast-fail convenience only, never a
 * substitute for the server rule.
 */
export function parseDisplayTokenFromFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const token = new URLSearchParams(raw).get(DISPLAY_TOKEN_FRAGMENT_KEY);
  return isValidDisplayToken(token) ? token : null;
}

/**
 * Builds the bearer Public Display link for the CURRENT origin/path — never
 * a hardcoded deployment hostname. The capability token is placed in the URL
 * FRAGMENT, never an ordinary query parameter: fragments are never sent to a
 * server in a request line, so the token does not land in typical server
 * access logs.
 */
export function buildPublicDisplayLink(
  location: { origin: string; pathname: string },
  code: string,
  token: string,
): string {
  const url = new URL(location.pathname, location.origin);
  url.search = `?display=public&code=${encodeURIComponent(code)}`;
  url.hash = `${DISPLAY_TOKEN_FRAGMENT_KEY}=${token}`;
  return url.toString();
}
