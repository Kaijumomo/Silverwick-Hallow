import { describe, expect, it } from "vitest";
import { parseClocktowerScript } from "./customScript";

describe("parseClocktowerScript — top-level shape", () => {
  it("rejects a non-array input", () => {
    const r = parseClocktowerScript("not an array");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/array/i);
  });

  it("rejects an empty array", () => {
    const r = parseClocktowerScript([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least one character/i);
  });

  it("rejects a meta-only array", () => {
    const r = parseClocktowerScript([{ id: "_meta", name: "X" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least one character/i);
  });
});

describe("parseClocktowerScript — string id references", () => {
  it("resolves an exact-match official role id", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "Tiny" },
      "washerwoman",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.characters).toHaveLength(1);
      expect(r.script.characters[0]!.id).toBe("washerwoman");
      expect(r.script.characters[0]!.type).toBe("townsfolk");
    }
  });

  it("normalizes dashed/underscored ids during lookup", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "Tiny" },
      "snake-charmer",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.script.characters[0]!.id).toBe("snakecharmer");
  });

  it("rejects an unknown official role id with usable error", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "Bad" },
      "nonexistent",
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Unknown official role id/i);
      expect(r.error).toMatch(/nonexistent/);
    }
  });
});

describe("parseClocktowerScript — homebrew character objects", () => {
  it("renames `team` to `type`", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "HB" },
      { id: "homebrew", name: "Q", team: "townsfolk", ability: "x" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.characters[0]!.type).toBe("townsfolk");
      // The `team` key should be gone after normalization
      expect((r.script.characters[0] as Record<string, unknown>).team).toBeUndefined();
    }
  });

  it("preserves unknown homebrew fields via .passthrough()", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "HB" },
      {
        id: "homebrew",
        name: "Q",
        team: "townsfolk",
        customField: "preserve me",
        art: { svg: "<svg/>" },
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const c = r.script.characters[0] as Record<string, unknown>;
      expect(c.customField).toBe("preserve me");
      expect(c.art).toEqual({ svg: "<svg/>" });
    }
  });

  it("accepts `description` as an alias for `ability`", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "HB" },
      { id: "homebrew", name: "Q", team: "townsfolk", description: "alt-ability" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.script.characters[0]!.ability).toBe("alt-ability");
  });

  it("normalizes the British spelling 'traveller' to 'traveler'", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "HB" },
      { id: "homebrew", name: "Q", team: "traveller", ability: "x" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.script.characters[0]!.type).toBe("traveler");
  });

  it("rejects a character missing id with index in error", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "Bad" },
      { name: "NoId", team: "townsfolk" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/index 1/);
      expect(r.error).toMatch(/id/);
    }
  });

  it("rejects a character with an invalid type", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "Bad" },
      { id: "q", name: "Q", type: "wizard" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/type/);
  });
});

describe("parseClocktowerScript — meta extraction", () => {
  it("uses the name from _meta", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "My Cool Script" },
      "imp",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.name).toBe("My Cool Script");
      expect(r.script.id).toMatch(/^my-cool-script$/);
    }
  });

  it("captures author when present", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "X", author: "Jane" },
      "imp",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.script.author).toBe("Jane");
  });

  it("falls back to a unique id when no meta is given", () => {
    const r = parseClocktowerScript(["imp"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.name).toBe("Custom script");
      expect(r.script.id).toMatch(/^custom-/);
    }
  });
});

describe("parseClocktowerScript — mixed script", () => {
  it("accepts a mix of official ids and homebrew objects", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "Mixed" },
      "washerwoman",
      "imp",
      { id: "newrole", name: "New Role", team: "outsider", ability: "x" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.script.characters).toHaveLength(3);
      expect(r.script.characters.map((c) => c.id)).toEqual([
        "washerwoman",
        "imp",
        "newrole",
      ]);
    }
  });
});

// SOL-10D-C03: RoleId is the character identity key -- a NEW import may not
// carry two character entries with the same RoleId, however each entered.
describe("parseClocktowerScript — SOL-10D-C03 duplicate RoleIds are rejected", () => {
  const rejected = (input: unknown[], id: string) => {
    const r = parseClocktowerScript(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Duplicate character id/);
      expect(r.error).toContain(`"${id}"`);
    }
  };

  it("official string + official string", () => {
    rejected(["chef", "chef"], "chef");
  });

  it("official string, then a custom object with the same id", () => {
    rejected(["chef", { id: "chef", name: "Homebrew Chef", team: "townsfolk", ability: "x" }], "chef");
  });

  it("a custom object, then the official string with the same id", () => {
    rejected([{ id: "chef", name: "Homebrew Chef", team: "minion", ability: "x" }, "chef"], "chef");
  });

  it("two custom objects with the same id", () => {
    rejected([
      { id: "brewer", name: "Brewer", team: "townsfolk", ability: "x" },
      { id: "brewer", name: "Brewer Two", team: "outsider", ability: "y" },
    ], "brewer");
  });

  it("official strings that RESOLVE to the same RoleId (normalized spellings) are duplicates too", () => {
    rejected(["snake-charmer", "snake_charmer"], "snakecharmer");
    rejected(["Chef", "chef"], "chef");
  });

  it("a duplicate of a Traveler / Loric id is rejected like any other", () => {
    rejected(["thief", { id: "thief", name: "Homebrew Thief", team: "townsfolk", ability: "x" }], "thief");
    rejected([{ id: "bigwig", name: "Bigwig", team: "townsfolk", ability: "x" }, "bigwig"], "bigwig");
  });

  it("the error names the index of the duplicate entry (after any _meta)", () => {
    const r = parseClocktowerScript([{ id: "_meta", name: "Dup" }, "chef", "imp", "chef"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at index 3/);
  });

  it("a new import is never silently deduplicated", () => {
    const r = parseClocktowerScript(["washerwoman", "chef", "chef"]);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("chef") });
  });

  it("distinct RoleIds still import normally (official, homebrew, and a homebrew reusing a Loric id once)", () => {
    const r = parseClocktowerScript([
      { id: "_meta", name: "Distinct" },
      "washerwoman", "imp",
      { id: "brewer", name: "Brewer", team: "townsfolk", ability: "x" },
      { id: "bigwig", name: "Bigwig (homebrew)", team: "townsfolk", ability: "y" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.script.characters.map((c) => c.id)).toEqual(["washerwoman", "imp", "brewer", "bigwig"]);
  });
});
