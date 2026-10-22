import { describe, expect, it } from "vitest";
import {
  crescentRadius, plateMaxWidth, seatAngles, seatPoints, seatSizeFor, seatsAreClear, STAGE_HEIGHT, STAGE_WIDTH, tableRadii,
} from "./townSquareGeometry";

describe("Town Square geometry (Package 4G, Decision 15)", () => {
  it("steps the seat size down with the seat count, exactly as the v5 prototype does", () => {
    expect(seatSizeFor(5)).toEqual({ disc: 150, name: 28 });
    expect(seatSizeFor(6)).toEqual({ disc: 150, name: 28 });
    expect(seatSizeFor(10)).toEqual({ disc: 136, name: 26 });
    expect(seatSizeFor(13)).toEqual({ disc: 122, name: 24 });
    expect(seatSizeFor(16)).toEqual({ disc: 108, name: 22 });
    expect(seatSizeFor(20)).toEqual({ disc: 94, name: 20 });
  });

  it("widens the table above 12 seats and sizes the Crescent Ring from it", () => {
    expect(tableRadii(12)).toEqual({ rx: 800, ry: 380 });
    expect(tableRadii(13)).toEqual({ rx: 860, ry: 400 });
    expect(crescentRadius(12)).toBe(274);
    expect(crescentRadius(15)).toBe(288);
  });

  it("starts seat 1 at the top and spaces the seats at equal arc length", () => {
    const [first] = seatPoints(15);
    expect(first).toEqual({ x: 960, y: 548 - 400 - 12 });
    const angles = seatAngles(12);
    expect(angles).toHaveLength(12);
    expect(angles[0]).toBeCloseTo(-Math.PI / 2);
    expect(new Set(seatPoints(12).map((p) => `${p.x},${p.y}`)).size).toBe(12);
  });

  for (let count = 5; count <= 20; count++) {
    it(`keeps ${count} seats clear of each other and inside the stage`, () => {
      const cap = plateMaxWidth(count);
      expect(cap).toBeGreaterThanOrEqual(96);
      expect(seatsAreClear(count, cap)).toBe(true);
      const { disc } = seatSizeFor(count);
      for (const p of seatPoints(count)) {
        expect(p.x - disc / 2).toBeGreaterThan(0);
        expect(p.x + disc / 2).toBeLessThan(STAGE_WIDTH);
        expect(p.y - disc / 2).toBeGreaterThan(0);
        expect(p.y + disc / 2).toBeLessThan(STAGE_HEIGHT);
      }
    });
  }

  it("leaves room for a typical first name at every count", () => {
    for (let count = 5; count <= 20; count++) {
      const { name } = seatSizeFor(count);
      // A 9-letter name at the count's own type size, plus the seat number and padding.
      const typical = Math.round(9 * name * 0.55 + name * 0.78 + 8 + 28);
      expect(plateMaxWidth(count)).toBeGreaterThanOrEqual(Math.min(typical, 150));
    }
  });
});
