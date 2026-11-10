// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RoleDefSchema } from "@/stores/schemas";
import { TRAVELERS, getTraveler, listTravelers } from "./travelers";
import { BUILTIN_SCRIPTS } from "./scripts";

describe("TRAVELERS registry", () => {
  it("contains the base 15 travelers (5 each across tb/snv/bmr) plus experimentals", () => {
    expect(TRAVELERS.length).toBeGreaterThanOrEqual(15);
    const byEdition = new Map<string, number>();
    for (const t of TRAVELERS) {
      byEdition.set(t.edition!, (byEdition.get(t.edition!) ?? 0) + 1);
    }
    expect(byEdition.get("tb")).toBe(5);
    expect(byEdition.get("snv")).toBe(5);
    expect(byEdition.get("bmr")).toBe(5);
    // Experimental travellers may grow over time; just assert they exist.
    expect(byEdition.get("experimental") ?? 0).toBeGreaterThan(0);
  });

  it("every traveler validates against RoleDefSchema", () => {
    for (const t of TRAVELERS) {
      const r = RoleDefSchema.safeParse(t);
      expect(r.success, `${t.id} failed validation`).toBe(true);
    }
  });

  it("every traveler has type=traveler", () => {
    for (const t of TRAVELERS) expect(t.type).toBe("traveler");
  });

  it("no traveler-id collides with a base-edition character", () => {
    const baseIds = new Set<string>();
    for (const s of Object.values(BUILTIN_SCRIPTS)) {
      for (const c of s.characters) baseIds.add(c.id);
    }
    for (const t of TRAVELERS) {
      expect(baseIds.has(t.id), `${t.id} collides with base char`).toBe(false);
    }
  });

  it("getTraveler returns the role, undefined for unknown", () => {
    expect(getTraveler("scapegoat")?.name).toBe("Scapegoat");
    expect(getTraveler("nope")).toBeUndefined();
  });

  it("listTravelers returns the registry", () => {
    expect(listTravelers()).toBe(TRAVELERS);
  });
});
