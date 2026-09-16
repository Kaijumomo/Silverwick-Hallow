import { describe, it, expect } from "vitest";
import { fillRolePool } from "./fillRolePool";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { setupScript } from "@/test/setupFixtures";
import { SETUP_COUNTS } from "@/data/setupCounts";
import type { RoleDef } from "@/stores/types";

const BAG_TYPES = ["townsfolk", "outsider", "minion", "demon"] as const;
const TB = troubleBrewing.characters;

function countsOf(ids: string[], roleById: Map<string, RoleDef>) {
  const out = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of ids) {
    const t = roleById.get(id)?.type;
    if (t && (BAG_TYPES as readonly string[]).includes(t)) out[t as typeof BAG_TYPES[number]]++;
  }
  return out;
}
const tbById = new Map(TB.map(r => [r.id, r]));
const setupById = new Map(setupScript.characters.map(r => [r.id, r]));

// Two constant "random" closures with a provable, general Fisher-Yates outcome
// (verified by induction over shuffledPick's loop, not just spot-checked):
//   reverseRandom (always 0): j=0 every step, so the loop reduces to
//     "rotate the array left by one" -- shuffledPick(items, k) === items.slice(1, 1+k).
//   identityRandom (just under 1): j=floor(x*(i+1))=i every step (self-swap, no-op),
//     so shuffledPick(items, k) === items.slice(0, k) -- original order.
// Both are exact and deterministic, never probabilistic.
const reverseRandom = () => 0;
const identityRandom = () => 0.999999;
// The rotate-left derivation only holds once the Fisher-Yates loop actually
// runs (length >= 2); a single-item array has no swap to perform at all.
const rotateLeftPick = <T,>(items: T[], k: number) =>
  items.length <= 1 ? items.slice(0, k) : items.slice(1, 1 + k);
const identityPick = <T,>(items: T[], k: number) => items.slice(0, k);

const tbEligible = (type: typeof BAG_TYPES[number], exclude: string[] = []) =>
  TB.filter(r => r.type === type && r.id !== "baron" && !exclude.includes(r.id)).map(r => r.id);

describe("fillRolePool", () => {
  it("A. empty bag: fills a complete valid composition for a supported count, exactly under controlled RNG", () => {
    const result = fillRolePool({
      pinnedIds: [], targetPlayerCount: 8, scriptCharacters: TB, random: reverseRandom,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool).toHaveLength(8);
    expect(countsOf(result.pool, tbById)).toEqual(SETUP_COUNTS[8]);
    expect(new Set(result.pool).size).toBe(8);
    expect(result.generated).toEqual(result.pool); // nothing pinned, everything generated

    const expected = [
      ...rotateLeftPick(tbEligible("townsfolk"), 5),
      ...rotateLeftPick(tbEligible("outsider"), 1),
      ...rotateLeftPick(tbEligible("minion"), 1),
      ...rotateLeftPick(tbEligible("demon"), 1),
    ];
    expect(result.pool).toEqual(expected);
  });

  it("B. partial pinned bag: preserves pins and fills only the remaining slots", () => {
    const result = fillRolePool({
      pinnedIds: ["empath", "poisoner"], targetPlayerCount: 8, scriptCharacters: TB, random: reverseRandom,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool).toContain("empath");
    expect(result.pool).toContain("poisoner");
    expect(result.generated).not.toContain("empath");
    expect(result.generated).not.toContain("poisoner");
    expect(countsOf(result.pool, tbById)).toEqual(SETUP_COUNTS[8]);
    expect(result.generated).toHaveLength(6); // 8 total - 2 pinned

    const expected = [
      ...rotateLeftPick(tbEligible("townsfolk", ["empath"]), 4),
      ...rotateLeftPick(tbEligible("outsider"), 1),
      ...rotateLeftPick(tbEligible("minion", ["poisoner"]), 0),
      ...rotateLeftPick(tbEligible("demon"), 1),
    ];
    expect(result.generated).toEqual(expected);
  });

  it("C. re-roll preserves pinned roles while the generated portion changes under controlled RNG", () => {
    const pinnedIds = ["empath", "poisoner"];
    const first = fillRolePool({ pinnedIds, targetPlayerCount: 8, scriptCharacters: TB, random: reverseRandom });
    const second = fillRolePool({ pinnedIds, targetPlayerCount: 8, scriptCharacters: TB, random: identityRandom });
    expect(first.ok).toBe(true); expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    for (const pinned of pinnedIds) {
      expect(first.pool).toContain(pinned);
      expect(second.pool).toContain(pinned);
    }
    expect(new Set(first.generated)).not.toEqual(new Set(second.generated));
    const expectedSecond = [
      ...identityPick(tbEligible("townsfolk", ["empath"]), 4),
      ...identityPick(tbEligible("outsider"), 1),
      ...identityPick(tbEligible("minion", ["poisoner"]), 0),
      ...identityPick(tbEligible("demon"), 1),
    ];
    expect(second.generated).toEqual(expectedSecond);
  });

  it("D. repeated re-roll operations each remain valid and never accumulate stale generated roles", () => {
    const pinnedIds = ["empath", "poisoner"];
    for (const random of [reverseRandom, identityRandom, reverseRandom, identityRandom]) {
      const result = fillRolePool({ pinnedIds, targetPlayerCount: 8, scriptCharacters: TB, random });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.pool).toHaveLength(8);
      expect(result.generated).toHaveLength(6);
      expect(countsOf(result.pool, tbById)).toEqual(SETUP_COUNTS[8]);
    }
  });

  it("E. random selection is real: exact picks under two distinct controlled generators", () => {
    const reverse = fillRolePool({ pinnedIds: [], targetPlayerCount: 8, scriptCharacters: TB, random: reverseRandom });
    const identity = fillRolePool({ pinnedIds: [], targetPlayerCount: 8, scriptCharacters: TB, random: identityRandom });
    expect(reverse.ok).toBe(true); expect(identity.ok).toBe(true);
    if (!reverse.ok || !identity.ok) return;
    expect(reverse.generated).toEqual([
      ...rotateLeftPick(tbEligible("townsfolk"), 5),
      ...rotateLeftPick(tbEligible("outsider"), 1),
      ...rotateLeftPick(tbEligible("minion"), 1),
      "imp",
    ]);
    expect(identity.generated).toEqual([
      ...identityPick(tbEligible("townsfolk"), 5),
      ...identityPick(tbEligible("outsider"), 1),
      ...identityPick(tbEligible("minion"), 1),
      "imp",
    ]);
    expect(reverse.generated).not.toEqual(identity.generated);
  });

  it("F. count-changing role selected manually: Fill completes according to the analyzer-adjusted composition", () => {
    const result = fillRolePool({
      pinnedIds: ["baron"], targetPlayerCount: 7, scriptCharacters: TB, random: reverseRandom,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition).toEqual({ townsfolk: 3, outsider: 2, minion: 1, demon: 1 });
    expect(countsOf(result.pool, tbById)).toEqual({ townsfolk: 3, outsider: 2, minion: 1, demon: 1 });
    expect(result.pool).toContain("baron");
  });

  it("G. count-changing role not selected: Fill/Re-roll never introduces it automatically", () => {
    for (const random of [reverseRandom, identityRandom]) {
      const result = fillRolePool({ pinnedIds: [], targetPlayerCount: 8, scriptCharacters: TB, random });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.pool).not.toContain("baron");
    }
  });

  it("H. multiple composition candidates require an explicit choice before generation", () => {
    const attempt = fillRolePool({
      pinnedIds: ["godfather"], targetPlayerCount: 8, scriptCharacters: setupScript.characters, random: reverseRandom,
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.failure.reason).toBe("multiple-candidates");
    if (attempt.failure.reason !== "multiple-candidates") return;
    expect(attempt.failure.candidates).toEqual([
      { townsfolk: 6, outsider: 0, minion: 1, demon: 1 },
      { townsfolk: 4, outsider: 2, minion: 1, demon: 1 },
    ]);

    const chosen = attempt.failure.candidates[0]!;
    const result = fillRolePool({
      pinnedIds: ["godfather"], targetPlayerCount: 8, scriptCharacters: setupScript.characters,
      chosenComposition: chosen, random: reverseRandom,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(countsOf(result.pool, setupById)).toEqual(chosen);
  });

  it("I. unsupported/interacting setup refuses to guess and produces no pool", () => {
    const result = fillRolePool({
      pinnedIds: ["baron", "fanggu"], targetPlayerCount: 7, scriptCharacters: setupScript.characters, random: reverseRandom,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("uncertain-setup");
    expect(result).not.toHaveProperty("pool");
  });

  it("J. overfilled pinned type is never auto-corrected by removing a pin", () => {
    // TB @ 8 players allows exactly 1 Outsider; pin two.
    const result = fillRolePool({
      pinnedIds: ["drunk", "saint"], targetPlayerCount: 8, scriptCharacters: TB, random: reverseRandom,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("overfilled");
    if (result.failure.reason !== "overfilled") return;
    expect(result.failure.excess).toEqual({ outsider: 1 });
  });

  it("K. an already-complete pinned bag fills with nothing generated (no-op completion)", () => {
    const pinnedIds = ["washerwoman", "librarian", "investigator", "chef", "empath", "poisoner", "imp"];
    expect(countsOf(pinnedIds, tbById)).toEqual(SETUP_COUNTS[7]);
    const result = fillRolePool({ pinnedIds, targetPlayerCount: 7, scriptCharacters: TB, random: reverseRandom });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.generated).toEqual([]);
    expect(result.pool).toEqual(pinnedIds);
  });

  it("N. never includes Travelers, Fabled, or Lorics, even when the script list contains them", () => {
    for (const random of [reverseRandom, identityRandom]) {
      const result = fillRolePool({
        pinnedIds: [], targetPlayerCount: 8, scriptCharacters: setupScript.characters, random,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const id of result.pool) {
        const type = setupById.get(id)?.type;
        expect(type).not.toBe("traveler");
        expect(type).not.toBe("fabled");
        expect(type).not.toBe("loric");
      }
    }
  });

  it("O. never assigns roles to players: the result carries only role IDs, no player/seat data", () => {
    const result = fillRolePool({ pinnedIds: [], targetPlayerCount: 8, scriptCharacters: TB, random: reverseRandom });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Structural proof: the result type has no player/seat-shaped fields to leak into.
    expect(Object.keys(result).sort()).toEqual(["composition", "generated", "ok", "pool"]);
    expect(result.pool.every(id => typeof id === "string")).toBe(true);
  });

  it("refuses an unsupported player count instead of guessing", () => {
    const result = fillRolePool({ pinnedIds: [], targetPlayerCount: 3, scriptCharacters: TB, random: reverseRandom });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("unsupported-count");
  });

  it("refuses when the script can't supply enough eligible roles for a slot", () => {
    const tiny: RoleDef[] = TB.filter(r => ["washerwoman", "poisoner", "imp"].includes(r.id));
    const result = fillRolePool({ pinnedIds: [], targetPlayerCount: 7, scriptCharacters: tiny, random: reverseRandom });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("insufficient-roles");
  });
});
