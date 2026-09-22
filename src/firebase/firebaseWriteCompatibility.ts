/**
 * Phase 9R.1 Astra remediation (Findings F1, F2, F3): a checkpoint can be
 * valid JSON, pass the current game schema, and still be a value the real
 * Firebase RTDB SDK refuses to write -- the schema only constrains the
 * SHAPE of Silverwick's own data model, never the destination-relative
 * key-character, numeric, nesting-depth, path-byte-length, or reserved-key
 * rules the SDK enforces client-side on every write.
 *
 * This module answers exactly one question, mirroring the real installed
 * @firebase/database SDK's own client-side validation
 * (validateFirebaseData/ValidationPath in
 * node_modules/@firebase/database/dist/index.cjs.js, and
 * @firebase/util's own stringLength in
 * node_modules/@firebase/util/dist/index.cjs.js) as the ground truth --
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
 *  - maximum path length: 768 bytes -- MAX_PATH_LENGTH_BYTES, counted with
 *    Firebase's OWN string-length algorithm (see firebaseStringLength's own
 *    doc comment below -- Finding F3 -- for exactly why this is NOT the
 *    same as a standards-compliant UTF-8 byte count). Path length is
 *    measured from the ACTUAL destination the value will be written to
 *    (`basePathSegments`), not from the value's own root -- each key
 *    encountered while recursing into the value becomes another path
 *    segment on top of that destination, exactly like a real write.
 *  - reserved `.value` structure (Finding F2): a node containing a
 *    `.value` key may not simultaneously contain any "actual child" key
 *    (any key other than `.value`, `.priority`, or `.sv`) -- see check()'s
 *    own doc comment for exactly which combinations this does and does not
 *    reject, mirroring validateFirebaseData's own `hasDotValue`/
 *    `hasActualChild` logic exactly (including that `.value`/`.priority`/
 *    `.sv` are individually never key-character-validated, and that
 *    `.priority`'s VALUE is never type-checked here -- see that same doc
 *    comment for why that specific check is genuinely unreachable through
 *    Silverwick's own write path).
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

export type FirebaseWriteValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Phase 9R.1 Astra remediation (Finding F3): mirrors @firebase/util's own
 * `stringLength()` EXACTLY, including its deliberate imprecision for an
 * unmatched/lone UTF-16 surrogate -- this is NOT a standards-compliant
 * UTF-8 byte count (e.g. `TextEncoder().encode(value).length`), and using
 * one instead of the other is exactly Astra's F3 reproduction: Firebase's
 * OWN ValidationPath (node_modules/@firebase/database/dist/index.cjs.js)
 * calls `util.stringLength()` for every path segment's byte accounting, so
 * Silverwick's gate must match THAT function's actual behavior, not a
 * "more correct" one -- even where that behavior is itself an
 * approximation Firebase's own SDK carries.
 *
 * The algorithm (ported verbatim from @firebase/util/dist/index.cjs.js's
 * `stringLength`): walk UTF-16 code units one at a time.
 *  - c < 128           -> +1 byte  (ASCII)
 *  - 128 <= c < 2048    -> +2 bytes (2-byte UTF-8 range)
 *  - 0xD800 <= c <= 0xDBFF (a UTF-16 LEAD/high surrogate) -> +4 bytes, AND
 *    unconditionally skip the NEXT code unit -- WITHOUT checking whether
 *    it is actually a valid trail surrogate. A lone lead surrogate at the
 *    end of a string, or one immediately followed by an ordinary
 *    character, is therefore still charged 4 bytes as if it completed a
 *    real pair, and in the latter case the character that would have been
 *    the trail surrogate is silently never counted at all.
 *  - otherwise (covers ordinary BMP characters >= 2048 that are not lead
 *    surrogates, AND a lone/unmatched TRAIL surrogate 0xDC00-0xDFFF, which
 *    never matches the lead-surrogate range test above) -> +3 bytes.
 *
 * This asymmetry (a lone lead surrogate silently swallows the next code
 * unit and still costs 4 bytes; a lone trail surrogate costs 3 bytes and
 * consumes nothing else) is Firebase's own, not Silverwick's invention.
 * Never "fixed" or normalized here -- a checkpoint containing a genuinely
 * malformed/unmatched surrogate (reachable via raw JSON text, which
 * preserves it as an escaped code unit) must be counted exactly as
 * Firebase's own SDK would count it, so this gate's accept/reject verdict
 * matches the real SDK's, not a more "correct" Unicode-aware one.
 */
function firebaseStringLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 128) {
      bytes += 1;
    } else if (c < 2048) {
      bytes += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++; // Firebase's own algorithm blindly skips the assumed trail surrogate.
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isValidFirebaseKey(key: string): boolean {
  return key.length > 0 && !ILLEGAL_KEY_CHARACTERS.test(key);
}

type PathState = { byteLength: number; depth: number };

/** Mirrors ValidationPath's constructor: the required '/' separators
 * (at least one) plus each segment's own Firebase-string-length. */
function initialPathState(segments: readonly string[]): PathState {
  let byteLength = Math.max(1, segments.length);
  for (const segment of segments) byteLength += firebaseStringLength(segment);
  return { byteLength, depth: segments.length };
}

/** Mirrors validationPathPush: one more '/' once the path is non-empty,
 * plus the new segment's own Firebase-string-length. */
function pushSegment(path: PathState, segment: string): PathState {
  return {
    byteLength: path.byteLength + (path.depth > 0 ? 1 : 0) + firebaseStringLength(segment),
    depth: path.depth + 1,
  };
}

/**
 * Phase 9R.1 Astra remediation (Finding F2): mirrors validateFirebaseData's
 * own per-node loop exactly (node_modules/@firebase/database/dist/
 * index.cjs.js), rather than the simpler "exempt these three keys from the
 * character check" approximation Finding F1 shipped with. For each key in
 * an object node: a literal `.value` key is tracked but NEVER
 * character-validated and NEVER counted as an "actual child"; `.priority`/
 * `.sv` are likewise never character-validated and never counted as
 * "actual children"; every OTHER key ("actual child") IS
 * character-validated exactly as before. Once every child has been
 * recursed into (matching the SDK's own post-loop check -- a deeper
 * illegal-key or depth/byte-length/non-finite-number error anywhere below
 * surfaces first, exactly like the real SDK), a node with BOTH a `.value`
 * key AND at least one actual child is rejected -- `.value` asserts "this
 * node IS a leaf (with this value)"; an actual child key asserts "this
 * node has real children"; the two are structurally contradictory. `.value`
 * alongside ONLY `.priority`/`.sv` (or nothing else) is Firebase's own
 * valid representation of a prioritized leaf / a server-value leaf and is
 * never rejected by this rule.
 *
 * `.priority`'s own VALUE is deliberately never type-checked against
 * Firebase's isValidPriority (string/number/null/{.sv}) here: the real SDK
 * only runs that specific check inside validateFirebaseMergeDataArg, for a
 * merge-update key that ends in literal ".priority" (i.e. the SDK's own
 * `update(ref, values)` treats a TOP-LEVEL key like "a/b/.priority" as a
 * distinct write target and priority-type-checks THAT value) -- never for
 * a `.priority` key found while recursing into an ordinary nested value
 * via validateFirebaseData (which is exactly how Silverwick's own writes
 * reach every `.priority` occurrence this gate could ever see: `rtdbUpdate`
 * in firebaseBackend.ts always passes full destination paths like
 * "lobbies/<code>/storyteller" as the update's own top-level keys, with the
 * entire game object nested underneath as ONE of those keys' values, never
 * as a key of its own ending in ".priority"). Adding that check here would
 * therefore reject values the real SDK genuinely accepts through
 * Silverwick's actual write shape -- exactly the "invented, stricter rule"
 * this module's own contract forbids.
 */
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
    let hasDotValue = false;
    let hasActualChild = false;
    for (const [key, nested] of entries) {
      if (key === ".value") {
        hasDotValue = true;
      } else if (key !== ".priority" && key !== ".sv") {
        hasActualChild = true;
        if (!isValidFirebaseKey(key)) {
          return `contains an invalid key ("${key}"). Keys must be non-empty strings and can't contain ".", "#", "$", "/", "[", "]", or control characters.`;
        }
      }
      const err = check(nested, pushSegment(path, key));
      if (err) return err;
    }
    if (hasDotValue && hasActualChild) {
      return `contains ".value" alongside an ordinary child key, which Firebase RTDB does not allow at the same location.`;
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
