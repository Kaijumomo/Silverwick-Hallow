import { describe, expect, it } from "vitest";
import { validateFirebaseWritableValue } from "./firebaseWriteCompatibility";

// Phase 9R.1 Astra remediation (Finding A4, expanded by the F1 follow-up): a
// checkpoint can be valid JSON, pass the current Zod game schema, and still
// be a value the real Firebase RTDB SDK refuses to write. These tests prove
// validateFirebaseWritableValue -- the pure, read-only gate readCheckpoint
// runs before ever adopting a migrated checkpoint -- mirrors the REAL
// installed @firebase/database SDK's own client-side validation
// (node_modules/@firebase/database/dist/index.cjs.js: validateFirebaseData/
// ValidationPath) constant-for-constant: illegal key characters (including
// control characters and DEL, not just the six punctuation marks), non-finite
// numbers at any depth, maximum write depth (32), and maximum write path
// byte length (768 UTF-8 bytes, counted from the REAL destination the value
// will be written to) -- at any depth, without mutating its input or
// over-rejecting legitimate values. See firebaseWriteCompatibility.ts's own
// doc comment for exactly which SDK source constants/behavior this mirrors.

const emptyBase: string[] = [];

describe("validateFirebaseWritableValue: key character legality", () => {
  it("accepts plain primitives and null", () => {
    expect(validateFirebaseWritableValue(1, emptyBase).ok).toBe(true);
    expect(validateFirebaseWritableValue("hello", emptyBase).ok).toBe(true);
    expect(validateFirebaseWritableValue(true, emptyBase).ok).toBe(true);
    expect(validateFirebaseWritableValue(false, emptyBase).ok).toBe(true);
    expect(validateFirebaseWritableValue(null, emptyBase).ok).toBe(true);
  });

  it("accepts an object whose keys use only Firebase-legal characters, including common valid punctuation", () => {
    expect(validateFirebaseWritableValue({
      poisoned: true, "manual:poisoned": 1, "seat-0": "x", a_b: "y", "1:demonInfo": "z",
    }, emptyBase).ok).toBe(true);
  });

  it.each([
    ["a dot", "bad.key"],
    ["a hash", "bad#key"],
    ["a dollar sign", "bad$key"],
    ["an open bracket", "bad[key"],
    ["a close bracket", "bad]key"],
    ["a forward slash", "bad/key"],
    ["a NUL control character (U+0000)", "bad\u0000key"],
    ["a newline (U+000A) -- Astra's exact reproduction", "bad\nkey"],
    ["a tab (U+0009)", "bad\tkey"],
    ["the last illegal control character (U+001F)", "bad\u001Fkey"],
    ["DEL (U+007F) -- Astra's exact reproduction", "bad\u007Fkey"],
  ])("rejects a top-level object key containing %s", (_label, key) => {
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(false);
  });

  it("U+0020 (space), immediately outside the illegal control-character range, remains a legal key character -- the boundary is exact, not off-by-one", () => {
    expect(validateFirebaseWritableValue({ "bad key": true }, emptyBase).ok).toBe(true);
  });

  it('Astra\'s exact reproduction: statuses["bad.key"] = true is rejected', () => {
    expect(validateFirebaseWritableValue({ statuses: { "bad.key": true } }, emptyBase).ok).toBe(false);
  });

  it("rejects an illegal key at any depth, including inside arrays and several levels deep", () => {
    expect(validateFirebaseWritableValue({ players: { a: { statuses: { "bad.key": true } } } }, emptyBase).ok).toBe(false);
    expect(validateFirebaseWritableValue({ history: [{ change: { from: { "bad#key": 1 } } }] }, emptyBase).ok).toBe(false);
    expect(validateFirebaseWritableValue({ a: { b: { c: { d: { e: { "bad$key": 1 } } } } } }, emptyBase).ok).toBe(false);
    expect(validateFirebaseWritableValue([{ ok: true }, { "bad/key": 1 }], emptyBase).ok).toBe(false);
  });

  it("valid values -- including every legitimate character in an existing key or a value -- remain accepted, never over-rejected", () => {
    expect(validateFirebaseWritableValue({
      code: "ABCD1234",
      notes: "Contains punctuation: !@%^&*()-_=+{}|;:'\",<>?~`.#$[]/\n", // VALUES may contain anything, including control chars
      players: {
        "p-1": { name: "Alice", reminders: [{ id: "legacy-a-0", label: "Red Herring" }] },
      },
    }, emptyBase).ok).toBe(true);
  });

  it("array elements' own numeric indices ('0', '1', ...) never fail the character-legality check", () => {
    expect(validateFirebaseWritableValue([{ ok: true }, { alsoOk: 2 }, "plain string", 42, null], emptyBase).ok).toBe(true);
  });

  it("never mutates its input", () => {
    const value = { statuses: { "bad.key": true }, ok: [1, 2, { fine: true }] };
    const before = structuredClone(value);
    const result = validateFirebaseWritableValue(value, emptyBase);
    expect(result.ok).toBe(false);
    expect(value).toEqual(before);
  });

  it("an empty object/array is safe", () => {
    expect(validateFirebaseWritableValue({}, emptyBase).ok).toBe(true);
    expect(validateFirebaseWritableValue([], emptyBase).ok).toBe(true);
  });
});

describe("validateFirebaseWritableValue: non-finite numbers at any depth", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("rejects a top-level %s value", (_label, n) => {
    expect(validateFirebaseWritableValue(n, emptyBase).ok).toBe(false);
  });

  it("rejects a non-finite number nested inside an UNRESTRICTED schema location (a History change snapshot), at any depth", () => {
    expect(validateFirebaseWritableValue(
      { history: [{ change: { from: { score: Infinity }, to: { score: 1 } } }] },
      emptyBase
    ).ok).toBe(false);
    expect(validateFirebaseWritableValue(
      { history: [{ change: { item: { nested: { deeper: { value: -Infinity } } } } }] },
      emptyBase
    ).ok).toBe(false);
    expect(validateFirebaseWritableValue({ informationDeliveries: [{ values: [{ value: NaN }] }] }, emptyBase).ok).toBe(false);
  });

  it("finite numbers -- including negative, zero, and very large-but-finite values -- remain accepted", () => {
    expect(validateFirebaseWritableValue({ a: -3, b: 0, c: Number.MAX_SAFE_INTEGER, d: 3.14159 }, emptyBase).ok).toBe(true);
  });
});

describe("validateFirebaseWritableValue: maximum write depth (32)", () => {
  function nestedObject(depth: number): unknown {
    let value: unknown = true;
    for (let i = 0; i < depth; i++) value = { a: value };
    return value;
  }

  it("exactly 32 levels of nesting from an empty base path is still accepted", () => {
    expect(validateFirebaseWritableValue(nestedObject(32), emptyBase).ok).toBe(true);
  });

  it("33 levels of nesting from an empty base path is rejected -- one level past the real SDK's own MAX_PATH_DEPTH", () => {
    expect(validateFirebaseWritableValue(nestedObject(33), emptyBase).ok).toBe(false);
  });

  it("Astra's reproduction class: a History change.item nested roughly 33 levels deep is rejected", () => {
    const value = { history: [{ change: { item: nestedObject(30) } }] }; // history(1) + [0](2) + change(3) + item(4) + 30 more = 34
    expect(validateFirebaseWritableValue(value, emptyBase).ok).toBe(false);
  });
});

describe("validateFirebaseWritableValue: maximum write path byte length (768 UTF-8 bytes), accounting for the real destination", () => {
  it("a single-key value whose path reaches EXACTLY 768 bytes from an empty base is still accepted", () => {
    // empty-base initial byteLength = max(1,0) = 1; pushing one key of
    // length N (no separator needed, depth was 0) yields 1 + N.
    // 1 + 767 = 768 -- exactly at the limit.
    const key = "x".repeat(767);
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(true);
  });

  it("one byte past that (769) is rejected", () => {
    const key = "x".repeat(768);
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(false);
  });

  it("Unicode/multibyte content: the byte limit is measured in UTF-8 bytes, never JS string .length -- a key of 300 emoji (JS .length 600, well under 768) is still correctly rejected because its real UTF-8 encoding is 1200 bytes", () => {
    const key = "\u{1F389}".repeat(300); // U+1F389 PARTY POPPER: 2 UTF-16 code units (length 2), 4 UTF-8 bytes
    expect(key.length).toBe(600); // if this implementation used JS .length, it would look "under the limit"
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(false);
  });

  it("Unicode/multibyte content that genuinely stays under the byte limit is still accepted", () => {
    const key = "\u{1F389}".repeat(100); // 100 * 4 = 400 UTF-8 bytes -- well under 768
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(true);
  });

  it("destination context matters: the SAME value structure passes from a trivial base path but fails once counted from the REAL production destination", () => {
    // Real destination: ["lobbies", "ABCD1234", "storyteller"] --
    // "lobbies"(7) + "ABCD1234"(8) + "storyteller"(11) = 26, plus
    // max(1,3) = 3 separators => initial byteLength 29, depth 3.
    const realDestination = ["lobbies", "ABCD1234", "storyteller"];
    // A 749-byte key: from an empty base, 1 (initial) + 749 = 750 <= 768 (safe).
    // From the real destination, 29 + 1 (separator) + 749 = 779 > 768 (unsafe).
    const key = "x".repeat(749);
    const value = { [key]: true };
    expect(validateFirebaseWritableValue(value, emptyBase).ok).toBe(true);
    expect(validateFirebaseWritableValue(value, realDestination).ok).toBe(false);
  });

  it("a short, realistic value comfortably fits under the real destination's byte budget", () => {
    const realDestination = ["lobbies", "ABCD1234", "storyteller"];
    expect(validateFirebaseWritableValue({ code: "ABCD1234", notes: "ordinary notes" }, realDestination).ok).toBe(true);
  });
});
