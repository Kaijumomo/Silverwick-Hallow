import { describe, expect, it } from "vitest";
import { isFirebaseSafeValue } from "./firebaseKeySafety";

// Phase 9R.1 Astra remediation (Finding A4): a checkpoint can be valid JSON
// and pass the current Zod game schema while still containing an object
// property name Firebase RTDB cannot store -- z.record's key schema only
// constrains key LENGTH, never which characters are allowed. These tests
// prove isFirebaseSafeValue -- the pure, read-only gate readCheckpoint runs
// before ever adopting a migrated checkpoint -- catches exactly that class
// of defect, at any depth, without mutating its input or over-rejecting
// legitimate values.

describe("isFirebaseSafeValue", () => {
  it("accepts plain primitives and null", () => {
    expect(isFirebaseSafeValue(1)).toBe(true);
    expect(isFirebaseSafeValue("hello")).toBe(true);
    expect(isFirebaseSafeValue(true)).toBe(true);
    expect(isFirebaseSafeValue(false)).toBe(true);
    expect(isFirebaseSafeValue(null)).toBe(true);
  });

  it("accepts an object whose keys use only Firebase-legal characters, including common valid punctuation", () => {
    expect(isFirebaseSafeValue({
      poisoned: true, "manual:poisoned": 1, "seat-0": "x", a_b: "y", "1:demonInfo": "z",
    })).toBe(true);
  });

  it.each([
    ["a dot", "bad.key"],
    ["a hash", "bad#key"],
    ["a dollar sign", "bad$key"],
    ["an open bracket", "bad[key"],
    ["a close bracket", "bad]key"],
    ["a forward slash", "bad/key"],
  ])("rejects a top-level object key containing %s", (_label, key) => {
    expect(isFirebaseSafeValue({ [key]: true })).toBe(false);
  });

  it('Astra\'s exact reproduction: statuses["bad.key"] = true is rejected', () => {
    expect(isFirebaseSafeValue({ statuses: { "bad.key": true } })).toBe(false);
  });

  it("rejects an illegal key at any depth, including inside arrays and several levels deep", () => {
    expect(isFirebaseSafeValue({ players: { a: { statuses: { "bad.key": true } } } })).toBe(false);
    expect(isFirebaseSafeValue({ history: [{ change: { from: { "bad#key": 1 } } }] })).toBe(false);
    // Deeper than the game schema itself reaches -- proves the recursion
    // has no artificial depth limit.
    expect(isFirebaseSafeValue({ a: { b: { c: { d: { e: { "bad$key": 1 } } } } } })).toBe(false);
    // An array element's own nested object key.
    expect(isFirebaseSafeValue([{ ok: true }, { "bad/key": 1 }])).toBe(false);
  });

  it("valid values -- including every legitimate character in an existing key or a value -- remain accepted, never over-rejected", () => {
    expect(isFirebaseSafeValue({
      code: "ABCD1234",
      notes: "Contains punctuation: !@%^&*()-_=+{}|;:'\",<>?~`.#$[]/", // VALUES may contain anything
      players: {
        "p-1": { name: "Alice", reminders: [{ id: "legacy-a-0", label: "Red Herring" }] },
      },
    })).toBe(true);
  });

  it("never mutates its input", () => {
    const value = { statuses: { "bad.key": true }, ok: [1, 2, { fine: true }] };
    const before = structuredClone(value);
    const result = isFirebaseSafeValue(value);
    expect(result).toBe(false);
    expect(value).toEqual(before);
  });

  it("arrays are traversed by element value only -- their own numeric indices are never treated as object keys", () => {
    expect(isFirebaseSafeValue([{ ok: true }, { alsoOk: 2 }, "plain string", 42, null])).toBe(true);
  });

  it("an empty object/array is safe", () => {
    expect(isFirebaseSafeValue({})).toBe(true);
    expect(isFirebaseSafeValue([])).toBe(true);
  });
});
