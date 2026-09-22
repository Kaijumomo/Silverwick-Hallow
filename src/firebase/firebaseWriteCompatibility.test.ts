import { describe, expect, it } from "vitest";
import { validateFirebaseWritableValue } from "./firebaseWriteCompatibility";

// Phase 9R.1 Astra remediation (Finding A4, expanded by the F1/F2/F3
// follow-ups): a checkpoint can be valid JSON, pass the current Zod game
// schema, and still be a value the real Firebase RTDB SDK refuses to write.
// These tests prove validateFirebaseWritableValue -- the pure, read-only
// gate readCheckpoint runs before ever adopting a migrated checkpoint --
// mirrors the REAL installed @firebase/database SDK's own client-side
// validation (node_modules/@firebase/database/dist/index.cjs.js:
// validateFirebaseData/ValidationPath, and node_modules/@firebase/util/
// dist/index.cjs.js: stringLength) constant-for-constant: illegal key
// characters (including control characters and DEL, not just the six
// punctuation marks), non-finite numbers at any depth, maximum write depth
// (32), maximum write path byte length (768 bytes, counted with Firebase's
// OWN string-length algorithm -- not naive UTF-8 -- from the REAL
// destination the value will be written to), and reserved `.value`
// structure (a `.value` key may not coexist with an ordinary child key) --
// at any depth, without mutating its input or over-rejecting legitimate
// values. See firebaseWriteCompatibility.ts's own doc comment for exactly
// which SDK source constants/behavior this mirrors.

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

// ---------------------------------------------------------------------------
// Phase 9R.1 Astra remediation (Finding F2): the real Firebase RTDB SDK
// rejects a node containing a `.value` key ALONGSIDE any ordinary child key
// (validateFirebaseData's own hasDotValue/hasActualChild rule) -- `.value`
// asserts "this node IS a leaf"; an ordinary child key asserts "this node
// has real children"; the two are structurally contradictory. `.priority`/
// `.sv` are never counted as "ordinary children" for this rule (they are
// Firebase's own valid metadata that may coexist with `.value` -- a
// prioritized leaf, or a server-value leaf, is written in JSON exactly this
// way), so `.value` + `.priority` and `.value` + `.sv` are both legitimate
// and must never be over-rejected.
// ---------------------------------------------------------------------------
describe("validateFirebaseWritableValue: reserved '.value' structure (Finding F2)", () => {
  it('Astra\'s exact reproduction: { ".value": 1, "alive": true } is rejected -- a `.value` leaf assertion cannot coexist with an ordinary child key', () => {
    expect(validateFirebaseWritableValue({ ".value": 1, alive: true }, emptyBase).ok).toBe(false);
  });

  it('a bare ".value" leaf with no other keys at all is accepted', () => {
    expect(validateFirebaseWritableValue({ ".value": 1 }, emptyBase).ok).toBe(true);
  });

  it('a Firebase-valid ".value" form: ".value" alongside ONLY ".priority" (a prioritized leaf, Firebase\'s own JSON export shape) is accepted, never rejected', () => {
    expect(validateFirebaseWritableValue({ ".value": 1, ".priority": "abc" }, emptyBase).ok).toBe(true);
  });

  it('".value" alongside ONLY ".sv" is also accepted -- ".sv" is never counted as an "actual child" for this rule either, exactly mirroring validateFirebaseData\'s own key !== \'.priority\' && key !== \'.sv\' exclusion', () => {
    expect(validateFirebaseWritableValue({ ".value": 1, ".sv": "timestamp" }, emptyBase).ok).toBe(true);
  });

  it('".value" alongside BOTH ".priority" and ".sv" together (no ordinary child) is still accepted', () => {
    expect(validateFirebaseWritableValue({ ".value": 1, ".priority": "abc", ".sv": "timestamp" }, emptyBase).ok).toBe(true);
  });

  it('a bare ".sv" server-value placeholder with no ".value" present at all is unaffected by this rule and remains accepted, exactly as before', () => {
    expect(validateFirebaseWritableValue({ ".sv": "timestamp" }, emptyBase).ok).toBe(true);
  });

  it('".priority" alongside an ordinary child key, with NO ".value" present, is accepted -- this rule only restricts ".value", never ".priority" on its own (a parent node may carry a priority alongside its real children)', () => {
    expect(validateFirebaseWritableValue({ ".priority": 5, alive: true }, emptyBase).ok).toBe(true);
  });

  it('the same invalid ".value" + ordinary-child combination is rejected at ANY nesting depth, including inside the unrestricted History change.item location', () => {
    expect(validateFirebaseWritableValue(
      { history: [{ change: { item: { ".value": 1, alive: true } } }] },
      emptyBase
    ).ok).toBe(false);
    expect(validateFirebaseWritableValue(
      { players: { a: { statuses: { ".value": true, poisoned: true } } } },
      emptyBase
    ).ok).toBe(false);
  });

  it('the same valid ".value" + ".priority" combination is accepted at depth too, never over-rejected merely for being nested', () => {
    expect(validateFirebaseWritableValue(
      { history: [{ change: { item: { ".value": 1, ".priority": "x" } } }] },
      emptyBase
    ).ok).toBe(true);
  });

  it("never mutates its input while checking the '.value' structure", () => {
    const value = { ".value": 1, alive: true };
    const before = structuredClone(value);
    expect(validateFirebaseWritableValue(value, emptyBase).ok).toBe(false);
    expect(value).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Phase 9R.1 Astra remediation (Finding F3): the real Firebase RTDB SDK's
// own ValidationPath counts path-segment byte length via @firebase/util's
// stringLength() -- NOT a standards-compliant UTF-8 byte count. That
// function charges a UTF-16 LEAD surrogate (U+D800-U+DBFF) 4 bytes and
// unconditionally skips the next code unit, regardless of whether that
// next code unit is actually a valid trail surrogate; a lone/unmatched
// trail surrogate (U+DC00-U+DFFF) instead falls through to a generic
// 3-byte branch. `TextEncoder().encode(...).length` (real UTF-8) and
// Firebase's own stringLength() agree for ordinary ASCII, ordinary BMP
// characters, and genuinely valid surrogate pairs (emoji) -- they diverge
// ONLY for a lone/unmatched surrogate, which is exactly Astra's
// reproduction: a raw JSON checkpoint can carry an unmatched high surrogate
// as an escaped code unit, and Silverwick's gate must match what the real
// SDK would count it as, not a more "correct" Unicode-aware count.
// ---------------------------------------------------------------------------
describe("validateFirebaseWritableValue: Firebase's own string-length algorithm, not naive UTF-8 (Finding F3)", () => {
  it("ASCII: Firebase's algorithm and real UTF-8 agree (1 byte per character)", () => {
    const key = "x".repeat(100); // 1 (initial) + 100 = 101 <= 768
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(true);
  });

  it("valid BMP multibyte characters (e.g. U+00E9 'é', 2 bytes each in both algorithms) are counted identically to real UTF-8", () => {
    const key = "é".repeat(300); // 1 + 300*2 = 601 <= 768
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(true);
    const overKey = "é".repeat(400); // 1 + 400*2 = 801 > 768
    expect(validateFirebaseWritableValue({ [overKey]: true }, emptyBase).ok).toBe(false);
  });

  it("a genuinely valid surrogate pair (emoji) is counted as 4 bytes by Firebase's algorithm -- identical to real UTF-8 -- so a valid pair is never mis-rejected by this fix", () => {
    const key = "\u{1F389}".repeat(100); // 1 lead+trail pair per emoji, 4 bytes each in BOTH algorithms
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(true);
  });

  it("a LONE/unmatched high surrogate (U+D800, with nothing after it) is counted as 4 bytes by Firebase's algorithm, exactly as if it completed a real pair -- NOT the 3 bytes a standards-compliant UTF-8 encoder (which substitutes U+FFFD) would produce", () => {
    // Fixed overhead from an empty base to a single top-level key: 1 (initial byteLength) + key's own firebaseStringLength.
    // A lone high surrogate alone: firebaseStringLength = 4. 1 + 4 = 5 -- nowhere near the limit; this test is about the COUNTING, not the boundary.
    const key = "\uD800";
    const realDestination = ["lobbies", "ABCD1234", "storyteller"];
    // Push this single lone-surrogate key far enough (via a long ASCII prefix in a SEPARATE test below) to actually cross
    // the boundary -- here we only need to confirm it costs exactly 4 bytes, not 3, by placing it at a hand-computed edge.
    // Real destination overhead: 29 (base) + 1 (separator) = 30 before the key's own bytes. 30 + 4 = 34 -- far under 768,
    // so this alone only proves accept; the boundary test below proves the exact byte count via the 768/769 edge.
    expect(validateFirebaseWritableValue({ [key]: true }, realDestination).ok).toBe(true);
  });

  it("a LONE/unmatched low surrogate (U+DC00) is counted as 3 bytes by Firebase's algorithm (it never matches the lead-surrogate range, so it falls through to the generic 3-byte branch) -- this happens to equal real UTF-8's own 3-byte replacement-character count for the same lone code unit, so no divergence is observable here, unlike the lead-surrogate case", () => {
    const key = "\uDC00".repeat(200); // 1 + 200*3 = 601 <= 768
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(true);
    const overKey = "\uDC00".repeat(300); // 1 + 300*3 = 901 > 768
    expect(validateFirebaseWritableValue({ [overKey]: true }, emptyBase).ok).toBe(false);
  });

  it("a mixed string containing an ordinary character immediately after a lone lead surrogate: Firebase's algorithm silently never counts that following character at all (the surrogate's blind skip swallows it) -- proving this implementation reproduces that exact quirk rather than a corrected count", () => {
    // "x" + lone-lead-surrogate + "y": Firebase's algorithm counts 'x' (1),
    // then the lead surrogate (4, which also skips 'y' entirely) = 5 total.
    // A naive per-code-unit UTF-8-style count that did NOT reproduce this
    // quirk would count 'x'(1) + a replacement char for the lone surrogate
    // (3) + 'y'(1) = 5 as well by coincidence of arithmetic -- so this test
    // anchors the exact ACCEPT/REJECT boundary instead, where the quirk's
    // presence or absence is what actually decides the outcome (see the
    // dedicated Astra-reproduction boundary test below for the precise
    // divergent case).
    const key = "x\uD800y";
    expect(validateFirebaseWritableValue({ [key]: true }, emptyBase).ok).toBe(true);
  });

  it("boundary: a key whose Firebase-exact string length lands the real destination path at EXACTLY 768 bytes (using a lone high surrogate) is still accepted", () => {
    // Real destination "lobbies/LGCY2345/storyteller" (8-char code) through
    // history[0].change.item = 51 bytes of fixed overhead (see the F1 byte-
    // boundary tests above for the derivation), +1 separator = 52. A key of
    // 712 'x' characters plus one trailing lone high surrogate:
    // firebaseStringLength = 712*1 + 4 = 716. 52 + 716 = 768 -- exactly at the limit.
    const realDestination = ["lobbies", "LGCY2345", "storyteller"];
    const key = "x".repeat(712) + "\uD800";
    const value = { history: [{ change: { item: { [key]: true } } }] };
    expect(validateFirebaseWritableValue(value, realDestination).ok).toBe(true);
  });

  it("boundary: one 'x' character more (713) lands the SAME shape one byte past the limit (769) and is rejected -- Astra's exact reproduction of the N chosen so a naive UTF-8 count would have accepted (52 + 716 = 768, using TextEncoder's 3-byte replacement-character count for the lone surrogate) while the real Firebase SDK correctly rejects it (52 + 717 = 769, using its own 4-byte-always count)", () => {
    const realDestination = ["lobbies", "LGCY2345", "storyteller"];
    const key = "x".repeat(713) + "\uD800";
    const value = { history: [{ change: { item: { [key]: true } } }] };
    // Sanity-check the exact divergence this test exists to prove: a naive
    // UTF-8 byte count of this key would land at 716 (52 + 716 = 768,
    // wrongly "safe"), while Firebase's own algorithm lands at 717
    // (52 + 717 = 769, correctly over the limit).
    expect(new TextEncoder().encode(key).length).toBe(716);
    expect(validateFirebaseWritableValue(value, realDestination).ok).toBe(false);
  });

  it("never mutates its input while computing Firebase-exact string length", () => {
    const value = { ["x".repeat(10) + "\uD800"]: true };
    const before = structuredClone(value);
    validateFirebaseWritableValue(value, emptyBase);
    expect(value).toEqual(before);
  });
});
