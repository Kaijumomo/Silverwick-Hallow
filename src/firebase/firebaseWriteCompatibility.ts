/**
 * Phase 9R.1 Astra remediation (Finding F1): a checkpoint can be valid JSON,
 * pass the current game schema, and still be a value the real Firebase RTDB
 * SDK refuses to write -- the schema only constrains the SHAPE of Silverwick's
 * own data model, never the destination-relative key-character, numeric,
 * nesting-depth, or path-byte-length rules the SDK enforces client-side on
 * every write.
 *
 * This module answers exactly one question, mirroring the real installed
 * @firebase/database SDK's own client-side validation
 * (validateFirebaseData/ValidationPath in
 * node_modules/@firebase/database/dist/index.cjs.js) as the ground truth --
 * never a stricter, invented rule:
 *
 *   "Would Firebase accept `value` if it were written to the real
 *    destination path `basePathSegments` names?"
 *
 * Constraints replicated (see the SDK source for exact behavior):
 *  - illegal key characters: `[ ] . # $ /` and control characters
 *    U+0000-U+001F and U+007F (DEL) -- INVALID_KEY_REGEX_.
 *  - non-finite numbers (NaN, +/-Infinity) anywhere in the value --
 *    isInvalidJSONNumber.
 *  - maximum path depth: 32 segments -- MAX_PATH_DEPTH.
 *  - maximum path length: 768 UTF-8 bytes -- MAX_PATH_LENGTH_BYTES. Path
 *    length is measured from the ACTUAL destination the value will be
 *    written to (`basePathSegments`), not from the value's own root --
 *    each key encountered while recursing into the value becomes another
 *    path segment on top of that destination, exactly like a real write.
 *
 * Deliberately not replicated: the 10 MiB single-string-leaf size limit
 * (MAX_LEAF_SIZE_) -- unreachable for any string this codebase's schema
 * produces (Storyteller notes/names are human-typed, nowhere near 10 MiB),
 * and the task's own guidance is not to overbuild for values that can't be
 * reached. JSON parsing already excludes JavaScript-only values (undefined,
 * functions, symbols) from remote checkpoint input, so those are not
 * special-cased either.
 *
 * Pure, read-only, deterministic: never mutates its input, never performs
 * a real Firebase write, and returns only a compatibility verdict.
 */

const ILLEGAL_KEY_CHARACTERS = /[[\].#$/\u0000-\u001F\u007F]/;
const MAX_PATH_DEPTH = 32;
const MAX_PATH_LENGTH_BYTES = 768;
/** Firebase's own reserved per-node metadata keys -- never produced by
 * Silverwick's schema, but exempted from the illegal-key check for
 * fidelity with the real SDK (see validateFirebaseData's own `key !==
 * '.priority' && key !== '.sv'`/`key === '.value'` handling) rather than
 * inventing a stricter rule than Firebase actually enforces. */
const EXEMPT_KEYS = new Set([".value", ".priority", ".sv"]);

export type FirebaseWriteValidationResult = { ok: true } | { ok: false; message: string };

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isValidFirebaseKey(key: string): boolean {
  return key.length > 0 && !ILLEGAL_KEY_CHARACTERS.test(key);
}

type PathState = { byteLength: number; depth: number };

/** Mirrors ValidationPath's constructor: the required '/' separators
 * (at least one) plus each segment's own UTF-8 byte length. */
function initialPathState(segments: readonly string[]): PathState {
  let byteLength = Math.max(1, segments.length);
  for (const segment of segments) byteLength += utf8ByteLength(segment);
  return { byteLength, depth: segments.length };
}

/** Mirrors validationPathPush: one more '/' once the path is non-empty,
 * plus the new segment's own UTF-8 byte length. */
function pushSegment(path: PathState, segment: string): PathState {
  return {
    byteLength: path.byteLength + (path.depth > 0 ? 1 : 0) + utf8ByteLength(segment),
    depth: path.depth + 1,
  };
}

function check(value: unknown, path: PathState): string | null {
  // Mirrors validationPathCheckValid, called immediately once a segment
  // is pushed (and once, at construction, for the base destination path
  // itself) -- BEFORE looking at what the value at that path even is.
  if (path.byteLength > MAX_PATH_LENGTH_BYTES) {
    return `has a key path longer than ${MAX_PATH_LENGTH_BYTES} bytes (${path.byteLength}).`;
  }
  if (path.depth > MAX_PATH_DEPTH) {
    return `path specified exceeds the maximum depth that can be written (${MAX_PATH_DEPTH}).`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return `contains ${String(value)}, which Firebase RTDB cannot store.`;
  }
  if (value !== null && typeof value === "object") {
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value as Record<string, unknown>);
    for (const [key, nested] of entries) {
      if (!EXEMPT_KEYS.has(key) && !isValidFirebaseKey(key)) {
        return `contains an invalid key ("${key}"). Keys must be non-empty strings and can't contain ".", "#", "$", "/", "[", "]", or control characters.`;
      }
      const err = check(nested, pushSegment(path, key));
      if (err) return err;
    }
  }
  return null;
}

/**
 * Would the real Firebase RTDB SDK accept `value` written to the real
 * destination `basePathSegments` names? `basePathSegments` is the
 * production write path's own segments (e.g. `["lobbies", code,
 * "storyteller"]` for the Storyteller-private game projection) --
 * counted toward depth/path-length exactly as the real SDK counts a
 * write's own destination path before ever looking at the value being
 * written there.
 */
export function validateFirebaseWritableValue(
  value: unknown,
  basePathSegments: readonly string[]
): FirebaseWriteValidationResult {
  const message = check(value, initialPathState(basePathSegments));
  return message ? { ok: false, message } : { ok: true };
}
