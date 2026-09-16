import { describe, it, expect } from "vitest";
import {
  SETUP_COUNTS, MIN_PLAYERS, MAX_PLAYERS, MAX_TRAVELERS, MAX_TOTAL_PLAYERS,
  minTravelersForTotal, maxTravelersForTotal, clampTravelersForTotal, ordinaryFromPlan,
} from "./setupCounts";

describe("SETUP_COUNTS", () => {
  it("is defined for every integer from MIN_PLAYERS to MAX_PLAYERS", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(SETUP_COUNTS[n], `missing entry for ${n} players`).toBeDefined();
    }
  });

  it("sum of all role counts equals the player count for every entry", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const c = SETUP_COUNTS[n];
      const sum = c.townsfolk + c.outsider + c.minion + c.demon;
      expect(sum, `counts for ${n} players sum to ${sum}, expected ${n}`).toBe(n);
    }
  });

  it("always has exactly 1 demon", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      expect(SETUP_COUNTS[n].demon, `${n} players should have 1 demon`).toBe(1);
    }
  });
});

// Phase 9 Setup finalization B4: ordinary players = total participants -
// Travelers, hard-bounded to [MIN_PLAYERS, MAX_PLAYERS]. Every worked
// example from the task spec, both accepted and rejected.
describe("ordinaryFromPlan (Phase 9 Setup finalization B4)", () => {
  it.each([
    [10, 0, 10],
    [10, 1, 9],
    [10, 2, 8],
    [15, 0, 15],
    [16, 1, 15],
    [18, 3, 15],
    [20, 5, 15],
    [10, 5, 5],
  ])("%i total / %i Travelers -> ordinary %i", (total, travelers, expected) => {
    expect(ordinaryFromPlan(total, travelers)).toBe(expected);
  });

  it("never produces ordinary below MIN_PLAYERS regardless of an excessive Traveler count", () => {
    expect(ordinaryFromPlan(5, 1)).toBe(MIN_PLAYERS); // "5/1 -> invalid" clamps to the floor, never negative
    expect(ordinaryFromPlan(10, 6)).toBe(MIN_PLAYERS); // "10/6 -> invalid" clamps to the floor, not 4
  });

  it("never produces ordinary above MAX_PLAYERS regardless of a total above the cap with 0 Travelers", () => {
    expect(ordinaryFromPlan(16, 0)).toBe(MAX_PLAYERS);
    expect(ordinaryFromPlan(20, 0)).toBe(MAX_PLAYERS);
  });
});

describe("clampTravelersForTotal / minTravelersForTotal / maxTravelersForTotal", () => {
  it("rejects 5/1: at the floor total, no Traveler count is legal", () => {
    expect(maxTravelersForTotal(5)).toBe(0);
    expect(clampTravelersForTotal(5, 1)).toBe(0);
    expect(ordinaryFromPlan(5, clampTravelersForTotal(5, 1))).toBe(5);
  });

  it("rejects 10/6: clamps down to the largest legal Traveler count for that total", () => {
    expect(maxTravelersForTotal(10)).toBe(5);
    expect(clampTravelersForTotal(10, 6)).toBe(5);
  });

  it("enforces the minimum Traveler count once total exceeds MAX_PLAYERS", () => {
    expect(minTravelersForTotal(16)).toBe(1);
    expect(minTravelersForTotal(18)).toBe(3);
    expect(minTravelersForTotal(20)).toBe(5);
    expect(clampTravelersForTotal(16, 0)).toBe(1);
    expect(clampTravelersForTotal(18, 0)).toBe(3);
    expect(clampTravelersForTotal(20, 0)).toBe(5);
  });

  it("never exceeds the Traveler catalogue size", () => {
    expect(maxTravelersForTotal(MAX_TOTAL_PLAYERS)).toBe(MAX_TRAVELERS);
    expect(clampTravelersForTotal(MAX_TOTAL_PLAYERS, MAX_TRAVELERS + 5)).toBe(MAX_TRAVELERS);
  });

  it("keeps ordinary within [MIN_PLAYERS, MAX_PLAYERS] for every total/Traveler pair in range", () => {
    for (let total = MIN_PLAYERS; total <= MAX_TOTAL_PLAYERS; total++) {
      for (let travelers = 0; travelers <= MAX_TRAVELERS; travelers++) {
        const ordinary = ordinaryFromPlan(total, travelers);
        expect(ordinary).toBeGreaterThanOrEqual(MIN_PLAYERS);
        expect(ordinary).toBeLessThanOrEqual(MAX_PLAYERS);
      }
    }
  });
});
