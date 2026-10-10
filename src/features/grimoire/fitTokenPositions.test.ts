import { expect, it } from "vitest";
import { fitTokenPositions } from "./fitTokenPositions";

it("separates clipped saved tokens from each other and from unchanged seats without mutating their intent", () => {
  const points = [{ x: 450, y: 0 }, { x: 330, y: 0 }, { x: 160, y: 0 }];
  const saved = structuredClone(points);
  const result = fitTokenPositions(points, { x: 200, y: 300 }, { width: 100, height: 100 });
  expect(points).toEqual(saved);
  expect(result[2]).toEqual(points[2]);
  result.forEach((p, i) => {
    expect(Math.abs(p.x)).toBeLessThanOrEqual(200);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(300);
    result.slice(i + 1).forEach(q => expect(Math.abs(p.x-q.x) >= 104 || Math.abs(p.y-q.y) >= 104).toBe(true));
  });
  expect(fitTokenPositions(points, { x: 600, y: 300 }, { width: 100, height: 100 })).toEqual(saved);
});

it("preserves deliberately overlapping in-bounds free movement", () => {
  const points = [{ x: 12, y: 20 }, { x: 14, y: 20 }];
  expect(fitTokenPositions(points, { x: 200, y: 300 }, { width: 100, height: 100 })).toEqual(points);
});

it("keeps a saved in-bounds token accessible when a pinned canonical seat moves onto it", () => {
  const points = [{ x: 150, y: 0 }, { x: 150, y: 0 }];
  const result = fitTokenPositions(points, { x: 250, y: 300 }, { width: 100, height: 100 }, [true, false]);
  expect(result[1]).toEqual(points[1]);
  expect(Math.abs(result[0]!.x-result[1]!.x) >= 104 || Math.abs(result[0]!.y-result[1]!.y) >= 104).toBe(true);
  expect(fitTokenPositions(points, { x: 500, y: 300 }, { width: 100, height: 100 })).toEqual(points);
});
