import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moonBackdrop } from "@/features/grimoire-v6/boardArt";
import { useV6Ui, veilChange } from "@/features/grimoire-v6/v6Store";
import { calmCss, parseStutter, stutterFlags, VEIL_LATE_MS } from "./stutterDiag";

afterEach(() => { vi.useRealTimers(); useV6Ui.getState().set({ veil: null }); });

describe("stutter test switches (preview-only)", () => {
  it("are all off unless the URL asks", () => {
    const none = { mist: "v2", veilLate: false, restOff: false, calm: false, meter: false, sky: "canvas" };
    expect(parseStutter("")).toEqual(none);
    expect(parseStutter("?mist=bogus&veil=early&rest=on&calm=0&meter=yes&sky=dom")).toEqual(none);
    expect(parseStutter("?mist=soft&veil=late&rest=off&calm=1&meter=1&sky=v2")).toEqual({ mist: "soft", veilLate: true, restOff: true, calm: true, meter: true, sky: "v2" });
    expect(parseStutter("?mist=off&sky=main")).toEqual({ ...none, mist: "off", sky: "main" });
    expect(stutterFlags).toEqual(none);
    expect(calmCss(stutterFlags)).toBe("");
    expect(calmCss({ ...stutterFlags, calm: true })).toContain('[style*="swTwinkle"]');
  });

  it("draws the sky on a canvas by default; with sky=v2 the V2 mist, a filter-free mist with soft, and none with off", () => {
    expect(renderToStaticMarkup(moonBackdrop(true) as ReactElement)).toMatch(/^<canvas aria-hidden="true"/);
    const drifting = (html: string) => html.match(/swDrift/g)?.length ?? 0;
    const v2 = renderToStaticMarkup(moonBackdrop(true, "v2", false) as ReactElement);
    expect(drifting(v2)).toBe(2);
    expect(v2).toContain("blur(28px)");
    const soft = renderToStaticMarkup(moonBackdrop(true, "soft", false) as ReactElement);
    expect(drifting(soft)).toBe(2);
    expect(soft).not.toContain("blur(28px)");
    expect(drifting(renderToStaticMarkup(moonBackdrop(true, "off", false) as ReactElement))).toBe(0);
  });

  it("makes the change and starts the veil together by default", () => {
    const change = vi.fn(() => true);
    expect(veilChange("Day I", "Dawn", true, change)).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    expect(useV6Ui.getState().veil?.label).toBe("Day I");
    const refused = vi.fn(() => false);
    useV6Ui.getState().set({ veil: null });
    expect(veilChange("Day II", "Dawn", true, refused)).toBe(false);
    expect(useV6Ui.getState().veil).toBeNull();
  });

  it("with veil=late starts the veil first, ignores a second tap, and removes the veil if the change is refused", () => {
    vi.useFakeTimers();
    const change = vi.fn(() => true);
    expect(veilChange("Night II", "Sleep", false, change, true)).toBe(true);
    expect(change).not.toHaveBeenCalled();
    expect(useV6Ui.getState().veil?.label).toBe("Night II");
    expect(veilChange("Night II", "Sleep", false, change, true)).toBe(false);
    vi.advanceTimersByTime(VEIL_LATE_MS);
    expect(change).toHaveBeenCalledTimes(1);
    expect(useV6Ui.getState().veil?.label).toBe("Night II");

    expect(veilChange("Day II", "Dawn", true, () => false, true)).toBe(true);
    vi.advanceTimersByTime(VEIL_LATE_MS);
    expect(useV6Ui.getState().veil).toBeNull();
  });
});
