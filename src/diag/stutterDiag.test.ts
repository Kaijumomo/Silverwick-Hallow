import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moonBackdrop } from "@/features/grimoire-v6/boardArt";
import { useV6Ui, veilChange } from "@/features/grimoire-v6/v6Store";
import { parseStutter, stutterFlags, VEIL_LATE_MS } from "./stutterDiag";

afterEach(() => { vi.useRealTimers(); useV6Ui.getState().set({ veil: null }); });

describe("stutter test switches (preview-only)", () => {
  it("are all off unless the URL asks", () => {
    expect(parseStutter("")).toEqual({ mist: "v2", veilLate: false });
    expect(parseStutter("?mist=bogus&veil=early")).toEqual({ mist: "v2", veilLate: false });
    expect(parseStutter("?mist=soft&veil=late")).toEqual({ mist: "soft", veilLate: true });
    expect(parseStutter("?mist=off")).toEqual({ mist: "off", veilLate: false });
    expect(stutterFlags).toEqual({ mist: "v2", veilLate: false });
  });

  it("draws the V2 mist by default, a filter-free mist with soft, and none with off", () => {
    const drifting = (html: string) => html.match(/swDrift/g)?.length ?? 0;
    const v2 = renderToStaticMarkup(moonBackdrop(true) as ReactElement);
    expect(drifting(v2)).toBe(2);
    expect(v2).toContain("blur(28px)");
    const soft = renderToStaticMarkup(moonBackdrop(true, "soft") as ReactElement);
    expect(drifting(soft)).toBe(2);
    expect(soft).not.toContain("blur(28px)");
    expect(drifting(renderToStaticMarkup(moonBackdrop(true, "off") as ReactElement))).toBe(0);
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
