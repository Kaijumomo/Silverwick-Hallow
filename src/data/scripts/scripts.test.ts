// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ScriptSchema } from "@/stores/schemas";
import { BUILTIN_SCRIPTS, listBuiltinScripts } from ".";

describe("Built-in scripts", () => {
  it("registers exactly tb, snv, and bmr", () => {
    expect(Object.keys(BUILTIN_SCRIPTS).sort()).toEqual(["bmr", "snv", "tb"]);
    expect(listBuiltinScripts()).toHaveLength(3);
  });

  it.each(Object.entries(BUILTIN_SCRIPTS))(
    "%s validates against ScriptSchema",
    (_id, script) => {
      const r = ScriptSchema.safeParse(script);
      expect(r.success).toBe(true);
      if (!r.success) console.error(r.error.issues);
    }
  );

  it("Trouble Brewing has 22 characters", () => {
    expect(BUILTIN_SCRIPTS.tb!.characters).toHaveLength(22);
  });

  it("Sects & Violets has 25 characters", () => {
    expect(BUILTIN_SCRIPTS.snv!.characters).toHaveLength(25);
  });

  it("Bad Moon Rising has 25 characters", () => {
    expect(BUILTIN_SCRIPTS.bmr!.characters).toHaveLength(25);
  });

  it("each character has at least one of: ability, type, name", () => {
    for (const [scriptId, script] of Object.entries(BUILTIN_SCRIPTS)) {
      for (const c of script.characters) {
        expect(c.id, `${scriptId}: role missing id`).toBeTruthy();
        expect(c.name, `${scriptId}/${c.id}: missing name`).toBeTruthy();
        expect(c.type, `${scriptId}/${c.id}: missing type`).toBeTruthy();
        expect(
          c.ability,
          `${scriptId}/${c.id}: missing ability`
        ).toBeTruthy();
      }
    }
  });

  it("each character has the script's edition", () => {
    for (const [id, script] of Object.entries(BUILTIN_SCRIPTS)) {
      for (const c of script.characters) {
        expect(c.edition, `${id}/${c.id}: missing edition`).toBe(id);
      }
    }
  });

  it("no role-id collisions across editions", () => {
    const seen = new Map<string, string>();
    for (const [scriptId, script] of Object.entries(BUILTIN_SCRIPTS)) {
      for (const c of script.characters) {
        const prior = seen.get(c.id);
        // Lunatic appears in both TB-as-deception-mode-only and BMR; we
        // only inline it in BMR, so cross-edition collisions should be empty.
        expect(prior, `${c.id} collision (${prior} vs ${scriptId})`).toBeUndefined();
        seen.set(c.id, scriptId);
      }
    }
  });

  it("night-order numbers, when present, are positive integers", () => {
    for (const script of Object.values(BUILTIN_SCRIPTS)) {
      for (const c of script.characters) {
        if (c.firstNight !== undefined) {
          expect(Number.isInteger(c.firstNight)).toBe(true);
          expect(c.firstNight).toBeGreaterThan(0);
        }
        if (c.otherNight !== undefined) {
          expect(Number.isInteger(c.otherNight)).toBe(true);
          expect(c.otherNight).toBeGreaterThan(0);
        }
      }
    }
  });
});
