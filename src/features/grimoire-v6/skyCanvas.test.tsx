import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { moonBackdrop } from "./boardArt";
import { alternate, cover, cycle, ease, easeInOut, keyframes, SkyPainter, STARS } from "./skyCanvas";

describe("canvas sky (skyCanvas.ts)", () => {
  it("uses the CSS timing curves", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOut(0.25)).toBeCloseTo(0.1291, 3);
  });

  it("eases inside each keyframe interval, as CSS does", () => {
    const nebula: [number, number][] = [[0, 0], [0.5, 0.45], [1, 0]];
    expect(keyframes(nebula, 0)).toBe(0);
    expect(keyframes(nebula, 0.25)).toBeCloseTo(0.225, 6);
    expect(keyframes(nebula, 0.5)).toBeCloseTo(0.45, 6);
    expect(keyframes(nebula, 0.625)).toBeCloseTo(0.45 * (1 - easeInOut(0.25)), 6);
    expect(keyframes([[0, 0], [0.02, 1], [0.08, 0]], 0.05, (x) => x)).toBeCloseTo(0.5, 6);
  });

  it("starts animations after a positive delay and part-way through with a negative one", () => {
    expect(cycle(2000, 14, 3)).toBeNull();
    expect(cycle(3000, 14, 3)).toBe(0);
    expect(cycle(0, 4, -1)).toBeCloseTo(0.25, 6);
    expect(cycle(5000, 4)).toBeCloseTo(0.25, 6);
    expect(alternate(17_500, 70, false)).toBeCloseTo(0.25, 6);
    expect(alternate(87_500, 70, false)).toBeCloseTo(0.75, 6);
    expect(alternate(17_500, 70, true)).toBeCloseTo(0.75, 6);
  });

  it("fits the sky image like background-size: cover", () => {
    expect(cover(1586, 992, 0, 0, 1480, 924)).toEqual({ x: expect.closeTo(0, 6), y: expect.closeTo(-0.85, 2), w: expect.closeTo(1480, 6), h: expect.closeTo(925.70, 2) });
    expect(cover(1586, 992, 0, 0, 800, 1280).h).toBeCloseTo(1280, 6);
  });

  it("draws the same ninety stars as the V2 layers", () => {
    const html = renderToStaticMarkup(moonBackdrop(true, "v2", false) as ReactElement);
    const layered = [...html.matchAll(/left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)px[^"]*swTwinkle ([\d.]+)s ease-in-out (-?[\d.]+)s/g)];
    expect(layered).toHaveLength(90);
    layered.forEach(([, x, y, width, d, dl], i) => {
      const star = STARS[i]!;
      expect(+x!).toBeCloseTo(star.x, 6);
      expect(+y!).toBeCloseTo(star.y, 6);
      expect(+width!).toBeCloseTo(star.r * 2, 6);
      expect(+d!).toBeCloseTo(star.d, 6);
      expect(+dl!).toBeCloseTo(star.dl, 6);
    });
  });

  it("falls back to the V2 layers where no canvas can be drawn", () => {
    expect(() => new SkyPainter(document.createElement("canvas"), true)).toThrow();
    const { container } = render(moonBackdrop(true) as ReactElement);
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.innerHTML).toContain("swDrift");
  });
});
