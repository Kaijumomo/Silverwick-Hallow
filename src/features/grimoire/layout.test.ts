import { describe, expect, it } from "vitest";
import { fitTokenRing, grimoireDiameter, ringRadius, seatPosition, tokenSizeForCount } from "./layout";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("bounded Storyteller workspace", () => {
  it.each([
    [472, 980, 472],
    [1040, 540, 540],
    [1800, 1200, 720],
    [0, 500, 0],
    [500, 0, 0],
  ])("bounds a %i by %i workspace to %i", (width, height, expected) => {
    expect(grimoireDiameter(width, height)).toBe(expected);
  });

  it.each([5, 7, 12, 15])("keeps every full token envelope inside safe margins for %i seats", (count) => {
    for (const [width, height] of [[472, 980], [1040, 540], [1800, 1200]]) {
      const diameter = grimoireDiameter(width!, height!);
      const tokenWidth = Math.max(tokenSizeForCount(count), 130);
      // Includes the disc, labels, seat number and a multi-line reminder stack.
      const tokenHeight = tokenSizeForCount(count) + 110;
      const discSize = tokenSizeForCount(count);
      const ring = fitTokenRing(diameter, discSize, Array.from({ length: count }, () => ({ width: tokenWidth, height: tokenHeight })));
      for (let seat = 0; seat < count; seat++) {
        const point = seatPosition(seat, count, ring.radius);
        const x = point.x + ring.x;
        const y = point.y + ring.y;
        expect(Math.abs(x) + tokenWidth / 2).toBeLessThanOrEqual(diameter / 2 - 16 + 1e-9);
        expect(y - discSize / 2).toBeGreaterThanOrEqual(-diameter / 2 + 16 - 1e-9);
        expect(y + tokenHeight - discSize / 2).toBeLessThanOrEqual(diameter / 2 - 16 + 1e-9);
      }
    }
  });

  it("allows top-seat reminders to extend inward without reducing the other seats' operating area", () => {
    const tokens = Array.from({ length: 15 }, () => ({ width: 100, height: 120 }));
    const ordinary = fitTokenRing(720, 72, tokens);
    tokens[0] = { width: 130, height: 170 };
    expect(fitTokenRing(720, 72, tokens).radius).toBeCloseTo(ordinary.radius);
  });

  it("does not push seats outside a collapsed stage with an artificial minimum radius", () => {
    expect(fitTokenRing(0, 110, [{ width: 110, height: 180 }]).radius).toBe(0);
    expect(fitTokenRing(100, 110, [{ width: 110, height: 180 }]).radius).toBe(0);
  });
});

describe("seatPosition", () => {
  it("seat 0 is at top of circle (0, -r)", () => {
    const p = seatPosition(0, 4, 100);
    expect(close(p.x, 0)).toBe(true);
    expect(close(p.y, -100)).toBe(true);
  });

  it("seat 1 of 4 is at right (r, 0)", () => {
    const p = seatPosition(1, 4, 100);
    expect(close(p.x, 100)).toBe(true);
    expect(close(p.y, 0)).toBe(true);
  });

  it("seat 2 of 4 is at bottom (0, r)", () => {
    const p = seatPosition(2, 4, 100);
    expect(close(p.x, 0)).toBe(true);
    expect(close(p.y, 100)).toBe(true);
  });

  it("seat 3 of 4 is at left (-r, 0)", () => {
    const p = seatPosition(3, 4, 100);
    expect(close(p.x, -100)).toBe(true);
    expect(close(p.y, 0)).toBe(true);
  });

  it("seats are evenly spaced on the ring (sum to zero)", () => {
    const N = 12;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < N; i++) {
      const p = seatPosition(i, N, 200);
      sx += p.x;
      sy += p.y;
    }
    expect(close(sx, 0, 1e-6)).toBe(true);
    expect(close(sy, 0, 1e-6)).toBe(true);
  });

  it("each seat sits exactly on the ring (distance = radius)", () => {
    const N = 9;
    const R = 137;
    for (let i = 0; i < N; i++) {
      const p = seatPosition(i, N, R);
      const d = Math.sqrt(p.x * p.x + p.y * p.y);
      expect(Math.abs(d - R)).toBeLessThan(1e-9);
    }
  });

  it("zero or negative seat counts return origin", () => {
    expect(seatPosition(0, 0, 100)).toEqual({ x: 0, y: 0 });
  });
});

describe("ringRadius", () => {
  it("scales with container size", () => {
    const r600 = ringRadius(600, 90);
    const r900 = ringRadius(900, 90);
    expect(r900).toBeGreaterThan(r600);
  });

  it("never returns less than minimum", () => {
    expect(ringRadius(40, 90)).toBeGreaterThanOrEqual(60);
  });
});

describe("tokenSizeForCount", () => {
  it("shrinks tokens as player count grows", () => {
    expect(tokenSizeForCount(5)).toBeGreaterThan(tokenSizeForCount(15));
  });
});
