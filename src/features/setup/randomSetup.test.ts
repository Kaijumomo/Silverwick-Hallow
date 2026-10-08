import { describe, expect, it } from "vitest";
import { canonicalRoles } from "@/data/canonical";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { SETUP_COUNTS } from "@/data/setupCounts";
import { TRAVELERS } from "@/data/travelers";
import type { RoleDef } from "@/stores/types";
import { emptyCounts, isBagType } from "./setupPolicies";
import { randomSetup } from "./randomSetup";

const TB = troubleBrewing.characters;
const identityRandom = () => 0.999999;
const prioritize = (...ids: string[]) => [
  ...TB.filter(r => ids.includes(r.id)), ...TB.filter(r => !ids.includes(r.id)),
];
function countsOf(pool: string[], roles: RoleDef[]) {
  const byId = new Map(roles.map(r => [r.id, r]));
  const counts = emptyCounts();
  for (const id of pool) {
    const type = byId.get(id)?.type;
    if (type && isBagType(type)) counts[type]++;
  }
  return counts;
}

describe("randomSetup", () => {
  it("draws Baron randomly and adjusts the bag automatically across every supported resident count", () => {
    const characters = prioritize("baron");
    for (let count = 5; count <= 15; count++) {
      const result = randomSetup({ scriptCharacters: characters, targetPlayerCount: count, random: identityRandom });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const base = SETUP_COUNTS[count]!;
      expect(result.pool).toContain("baron");
      expect(result.pool).toHaveLength(count);
      expect(new Set(result.pool).size).toBe(count);
      expect(result.composition).toEqual({ ...base, townsfolk: base.townsfolk - 2, outsider: base.outsider + 2 });
      expect(countsOf(result.pool, characters)).toEqual(result.composition);
    }
  });

  it("uses the standard composition when the random selection does not include Baron", () => {
    const result = randomSetup({ scriptCharacters: TB, targetPlayerCount: 8, random: identityRandom });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool).not.toContain("baron");
    expect(result.composition).toEqual(SETUP_COUNTS[8]);
    expect(countsOf(result.pool, TB)).toEqual(result.composition);
  });

  it("can generate a Baron setup even when the script cannot supply the unmodified Townsfolk count", () => {
    const characters = canonicalRoles(["chef", "empath", "monk", "saint", "recluse", "baron", "imp"]);
    const result = randomSetup({ scriptCharacters: characters, targetPlayerCount: 7, random: identityRandom });
    expect(result.ok).toBe(true);
    if (result.ok) expect(new Set(result.pool)).toEqual(new Set(characters.map(r => r.id)));
  });

  it.each([
    ["fanggu", 8, { townsfolk: 4, outsider: 2, minion: 1, demon: 1 }],
    ["vigormortis", 8, { townsfolk: 6, outsider: 0, minion: 1, demon: 1 }],
    ["vigormortis", 7, { townsfolk: 5, outsider: 0, minion: 1, demon: 1 }],
  ] as const)("uses the policy engine for %s at %i residents", (demon, targetPlayerCount, expected) => {
    const characters = [...canonicalRoles([demon]), ...TB.filter(r => r.type !== "demon" && r.id !== "baron")];
    const result = randomSetup({ scriptCharacters: characters, targetPlayerCount, random: identityRandom });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.composition).toEqual(expected);
      expect(countsOf(result.pool, characters)).toEqual(expected);
    }
  });

  it("does not mutate input definitions or modifier lists and excludes Traveler seats from the bag", () => {
    const scriptCharacters = structuredClone([...TB, ...TRAVELERS]);
    const fabledIds: string[] = [];
    const input = { scriptCharacters, targetPlayerCount: 8, fabledIds, random: identityRandom };
    const before = JSON.stringify({ scriptCharacters, fabledIds });
    const result = randomSetup(input);
    expect(JSON.stringify({ scriptCharacters, fabledIds })).toBe(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool).toHaveLength(8);
    expect(result.pool.every(id => TB.some(r => r.id === id))).toBe(true);
    expect(result.generated).toEqual(result.pool);
    result.pool.pop();
    expect(result.generated).toHaveLength(8);
  });

  it("produces different complete drafts under different controlled random sources", () => {
    const first = randomSetup({ scriptCharacters: TB, targetPlayerCount: 8, random: identityRandom });
    const second = randomSetup({ scriptCharacters: TB, targetPlayerCount: 8, random: () => 0 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.pool).not.toEqual(second.pool);
    expect(first.pool).toHaveLength(8);
    expect(second.pool).toHaveLength(8);
  });

  it("refuses multiple count modifiers rather than treating the result as standard", () => {
    const characters = [...canonicalRoles(["fanggu"]), ...prioritize("baron").filter(r => r.type !== "demon")];
    const result = randomSetup({ scriptCharacters: characters, targetPlayerCount: 8, random: identityRandom });
    expect(result).toMatchObject({ ok: false, failure: { reason: "uncertain-setup" } });
    expect(result).not.toHaveProperty("pool");
  });

  it("requires a manual choice for Godfather's multiple supported compositions", () => {
    const characters = [...canonicalRoles(["godfather"]), ...TB];
    const result = randomSetup({ scriptCharacters: characters, targetPlayerCount: 8, random: identityRandom });
    expect(result).toMatchObject({ ok: false, failure: { reason: "multiple-candidates", candidates: [
      { townsfolk: 6, outsider: 0, minion: 1, demon: 1 },
      { townsfolk: 4, outsider: 2, minion: 1, demon: 1 },
    ] } });
  });

  it("validates good characters after the draw, including uncertain setups and jinxes", () => {
    for (const characters of [
      [...canonicalRoles(["atheist"]), ...TB],
      [...canonicalRoles(["balloonist"]), ...TB],
      [...canonicalRoles(["alhadikhia", "princess"]), ...TB.filter(r => r.type !== "demon")],
    ]) {
      const result = randomSetup({ scriptCharacters: characters, targetPlayerCount: 8, random: identityRandom });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("pool");
    }
  });

  it("does not assume homebrew or modified canonical characters have standard composition", () => {
    for (const role of [
      { id: "homebrew", name: "Custom", type: "townsfolk", ability: "Custom setup.", provenance: { status: "homebrew" } } as RoleDef,
      { ...TB.find(r => r.id === "chef")!, ability: "Changed setup." },
    ]) {
      const result = randomSetup({ scriptCharacters: [role, ...TB], targetPlayerCount: 7, random: identityRandom });
      expect(result).toMatchObject({ ok: false, failure: { reason: "uncertain-setup" } });
    }
  });

  it("respects first-definition ownership for legacy duplicate role IDs", () => {
    const chef = TB.find(r => r.id === "chef")!;
    const result = randomSetup({ scriptCharacters: [chef, { ...chef, type: "minion" }, ...TB], targetPlayerCount: 7, random: identityRandom });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pool.filter(id => id === "chef")).toHaveLength(1);
      expect(countsOf(result.pool, TB)).toEqual(SETUP_COUNTS[7]);
    }
  });

  it("fails safely for unknown or ambiguous active modifiers", () => {
    for (const fabledIds of [["unknown"], ["sentinel"], ["bootlegger"]]) {
      const result = randomSetup({ scriptCharacters: TB, targetPlayerCount: 8, fabledIds, random: identityRandom });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("pool");
    }
  });

  it.each([null, 4, 16])("refuses unsupported resident count %s", targetPlayerCount => {
    expect(randomSetup({ scriptCharacters: TB, targetPlayerCount })).toMatchObject({
      ok: false, failure: { reason: "unsupported-count" },
    });
  });

  it("reports insufficient characters without returning a partial bag", () => {
    const result = randomSetup({ scriptCharacters: canonicalRoles(["baron", "imp", "chef"]), targetPlayerCount: 7, random: identityRandom });
    expect(result).toMatchObject({ ok: false, failure: { reason: "insufficient-roles" } });
    expect(result).not.toHaveProperty("pool");
  });
});
