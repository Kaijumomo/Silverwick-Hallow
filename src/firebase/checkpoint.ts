import type { PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import { MAX_AUTH_UID_LENGTH } from "./authUid";
import { validateFirebaseWritableValue, type FirebaseWriteValidationResult } from "./firebaseWriteCompatibility";
import { checkpointPathSegments } from "./paths";
import { MAX_ROOM_CODE_SHAPE } from "./roomCode";

/**
 * PHASE10F Section 44, SOL-10F-E1: the derived recovery checkpoint.
 *
 * Besides the structured Storyteller game, every projection writes
 * `lobbies/{code}/checkpoint` -- ONE string leaf holding the whole game and
 * the live UID -> PlayerId roster. Firebase limits a string leaf to 10 MiB
 * (mirrored by validateFirebaseWritableValue, SOL-10F-D1), so individually
 * valid game leaves can still add up to a checkpoint Firebase refuses.
 *
 * Pure (no Firebase SDK, no I/O), so both the production writer and the
 * Storyteller store use it.
 */

/** The ONE production checkpoint representation. writeProjections writes
 * exactly this string; every checkpoint preflight measures exactly this
 * string. Never re-implement it. */
export function serializeCheckpoint(game: StorytellerLobbyRecord, roster: Readonly<Record<string, string>>): string {
  return JSON.stringify({ game, roster });
}

/**
 * Lone UTF-16 trail surrogates (U+DC00..U+DFFF): two in a row never form a
 * pair, so JSON.stringify (well-formed since ES2019) escapes EVERY one of
 * them as the six ASCII characters `\udcXX` -- the most any single character
 * can cost once serialized (see the proof below).
 */
const TRAIL_SURROGATE_BASE = 0xdc00;
const TRAIL_SURROGATE_COUNT = 0x400;

/** A stand-in for an authenticated UID that serializes to the maximum any
 * supported UID can: MAX_AUTH_UID_LENGTH characters of six escaped bytes
 * each. Distinct for distinct `index` (its base-1024 digits), so an envelope
 * roster can hold one per seat. Never a real UID; never written anywhere. */
export function worstCaseUid(index: number): string {
  let uid = "";
  let rest = index;
  for (let i = 0; i < MAX_AUTH_UID_LENGTH; i++) {
    uid += String.fromCharCode(TRAIL_SURROGATE_BASE + (rest % TRAIL_SURROGATE_COUNT));
    rest = Math.floor(rest / TRAIL_SURROGATE_COUNT);
  }
  return uid;
}

/**
 * The conservative supported-roster envelope for `games`: one entry for EVERY
 * PlayerId record in any of them, each keyed by a distinct worstCaseUid.
 *
 * Why no supported roster can serialize longer (so a checkpoint that fits with
 * this envelope fits with the real roster):
 *
 * 1. Values. The roster is written only by the lease-holding Storyteller
 *    (Firebase Rules), only by seatPlayer (lobby.ts), which binds a UID to a
 *    seat of the Storyteller's game and refuses a second UID for a seat
 *    already bound -- so the roster is injective and every value is a
 *    PlayerId with its own record in the game. Removing a seat revokes its
 *    binding on the server BEFORE the local removal (revokePlayerAndCommit);
 *    a seating that fails locally is revoked inside the same writer lane, so
 *    no projection runs in between (and a failed revocation stops the writer
 *    until reconnect, below); membership transitions clear Undo, so
 *    Undo never restores a game without a bound seat; and reconnect revokes
 *    every binding whose seat the reconciled game lacks before its first
 *    projection (performMembershipRevocations precedes finishLive). Hence a
 *    real roster's values are a subset of this envelope's values -- each
 *    serialized identically, since they are the same strings.
 *    (MAX_TOTAL_PLAYERS bounds that seat count for a supported game; the
 *    envelope counts the actual records instead, which is never fewer.)
 * 2. Keys. Every roster key is an authenticated UID of at most
 *    MAX_AUTH_UID_LENGTH characters (authUid.ts). JSON.stringify emits each
 *    UTF-16 unit as itself, a two-character escape (`\"`, `\\`, `\n`, ...),
 *    a valid surrogate pair (two units, 4 Firebase bytes), or a six-character
 *    `\uXXXX` escape, and firebaseStringLength charges at most 3 bytes for a
 *    BMP unit -- so one character (unit or code point) costs at most 6
 *    serialized bytes, and every worstCaseUid key costs exactly that maximum.
 * 3. Shape. JSON.stringify(object) is `{` + entries joined by `,` + `}`, each
 *    entry `"key":value`: removing an entry or shortening a key can only
 *    shorten it. JSON.stringify never emits a lone surrogate, so
 *    firebaseStringLength of the whole checkpoint is the sum over its parts.
 *
 * Seat sets of several games (e.g. the Current State and a planned
 * replacement) are united, so the envelope covers whichever is written.
 */
export function supportedRosterEnvelope(...games: readonly StorytellerLobbyRecord[]): Record<string, PlayerId> {
  const seats = new Set<PlayerId>();
  for (const game of games) for (const playerId of Object.keys(game.players)) seats.add(playerId);
  const envelope: Record<string, PlayerId> = {};
  [...seats].forEach((playerId, index) => { envelope[worstCaseUid(index)] = playerId; });
  return envelope;
}

/**
 * The conservative checkpoint for `planned`: the largest string any supported
 * roster, under any lobby, can make the writer's checkpoint of that game.
 *
 * The game's own `code` and `storytellerUid` are what setLobby stamps when a
 * room is created (game.code = the room code, storytellerUid = the
 * Storyteller's UID), so they are measured at their supported maximum too: a
 * full-length room code (MAX_ROOM_CODE_SHAPE; every supported code has exactly
 * that many single-byte characters) and a worstCaseUid. Built with the SAME
 * serializer the writer uses.
 */
export function serializeCheckpointEnvelope(
  planned: StorytellerLobbyRecord,
  ...alsoSeatsOf: readonly StorytellerLobbyRecord[]
): string {
  const game: StorytellerLobbyRecord = { ...planned, code: MAX_ROOM_CODE_SHAPE, storytellerUid: worstCaseUid(0) };
  return serializeCheckpoint(game, supportedRosterEnvelope(planned, ...alsoSeatsOf));
}

/** SOL-10F-E1 pre-commit proof: can `planned` be checkpointed with ANY roster
 * that may accompany it, under ANY lobby? Judged by the SAME Firebase
 * validator the writer applies to its exact checkpoint. */
export function validateCheckpointEnvelope(
  planned: StorytellerLobbyRecord,
  ...alsoSeatsOf: readonly StorytellerLobbyRecord[]
): FirebaseWriteValidationResult {
  return validateFirebaseWritableValue(serializeCheckpointEnvelope(planned, ...alsoSeatsOf), checkpointPathSegments(MAX_ROOM_CODE_SHAPE));
}
