/**
 * Firebase Realtime Database's own key restrictions: an object property
 * name may not contain `.`, `#`, `$`, `[`, or `]`, and (since keys become
 * path segments) may not contain `/` either. These are the actual
 * constraints the Firebase RTDB SDK enforces on every property name in a
 * write -- not an invented stricter rule.
 */
const ILLEGAL_KEY_CHARACTERS = /[.#$[\]/]/;

/**
 * Phase 9R.1 Astra remediation (Finding A4): pure, read-only check that a
 * plain-data value is safe to write to Firebase RTDB -- specifically,
 * that no object property name anywhere in it (at any depth, including
 * inside arrays) uses a character Firebase itself forbids.
 *
 * A checkpoint can be valid JSON and pass the current Zod game schema
 * while still containing a Firebase-illegal key: `z.record`'s key schema
 * only constrains key LENGTH (`.min(1)`), never which characters are
 * allowed, so e.g. `statuses["bad.key"] = true` parses cleanly. Adopting
 * such a checkpoint as Current State would only surface the problem
 * later, at the next real Firebase projection -- after it is already
 * authoritative. This check is meant to run BEFORE that adoption (see
 * readCheckpoint in storytellerSync.ts).
 *
 * Never mutates its input, never renames or strips anything -- it only
 * reports whether the value is safe. Every valid value (including any
 * punctuation Firebase does allow) is left unaffected; only the illegal
 * characters above make a key reject. JSON parsing already excludes
 * JavaScript-only values (undefined, functions, symbols; NaN/Infinity
 * degrade to null) from remote checkpoint input before this ever runs,
 * so this deliberately does not special-case them.
 */
export function isFirebaseSafeValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isFirebaseSafeValue);
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (key.length === 0 || ILLEGAL_KEY_CHARACTERS.test(key)) return false;
      if (!isFirebaseSafeValue(nested)) return false;
    }
  }
  return true;
}
