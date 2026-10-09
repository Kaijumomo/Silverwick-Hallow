import { expect, it } from "vitest";
import { storytellerGeometry } from "./storytellerGeometry";

it("matches the approved 20-player tablet design size, ring and half-seat start", () => {
  const layout = storytellerGeometry(1480, 924, 20)!;
  expect(layout).not.toBeNull();
  expect(layout.spec.disc).toBe(92);
  expect(layout.placement).toEqual({ rx: 630, ry: 331, cy: -15 });
  expect(layout.offsetX).toBe(-32);
  expect(layout.positions).toHaveLength(20);
  // Seat order is untouched, clockwise, with the top pair straddling centre.
  expect(layout.positions[0]!.x).toBeGreaterThan(-32);
  expect(layout.positions[19]!.x).toBeLessThan(-32);
  expect(layout.positions[0]!.y).toBeCloseTo(layout.positions[19]!.y, 5);
  expect(layout.positions[9]!.y).toBeGreaterThan(0);
});

it("keeps every designed disc/name inside the stage and retains safe small-screen fallback", () => {
  for (const [w, h] of [[1480, 924], [1280, 671], [1194, 785], [1180, 820], [1024, 768], [820, 1180]]) {
    for (const count of [5, 7, 10, 15, 20]) {
      const layout = storytellerGeometry(w!, h!, count);
      if (!layout) continue; // The existing collision-tested density handles it.
      expect(layout.spec.disc).toBeGreaterThanOrEqual(48);
      for (const point of layout.positions) {
        expect(Math.abs(point.x) + layout.spec.width / 2).toBeLessThan(w! / 2);
        expect(point.y - layout.spec.disc / 2).toBeGreaterThan(-h! / 2);
        expect(point.y + layout.spec.disc / 2 + 24).toBeLessThan(h! / 2);
      }
    }
  }
  expect(storytellerGeometry(355, 420, 20)).toBeNull();
  expect(storytellerGeometry(1200, 300, 20)).toBeNull();
});

it.each([[1280, 671, 70], [1194, 785, 72]])("keeps 20 readable named tokens in the Claude oval at %sx%s", (width, height, disc) => {
  const layout = storytellerGeometry(width!, height!, 20)!;
  expect(layout).not.toBeNull();
  expect(layout.spec.disc).toBe(disc);
  expect(layout.spec.text).toBe(true);
  expect(layout.placement.rx).toBeGreaterThan(layout.placement.ry * 1.5);
});

it.each([802, 866, 900, 1000])("shortens name pills before losing named tokens in a %spx pinned tablet board", width => {
  const layout = storytellerGeometry(width, 671, 20)!;
  expect(layout).not.toBeNull();
  expect(layout.spec.text).toBe(true);
  expect(layout.spec.disc).toBeGreaterThanOrEqual(48);
  expect(layout.spec.width).toBeGreaterThanOrEqual(layout.spec.disc);
  expect(layout.spec.width).toBeLessThan(104);
});
