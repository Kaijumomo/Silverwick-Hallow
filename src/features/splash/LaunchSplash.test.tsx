// Launch Orbit splash (design v7): when it plays, the token draw, skipping, and reduced motion.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { drawTokens, geometry, LaunchSplash, shouldPlaySplash, SPLASH_END, SPLASH_SESSION_KEY } from "./LaunchSplash";

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("when the splash plays", () => {
  it("plays on a normal launch", () => {
    expect(shouldPlaySplash("")).toBe(true);
    expect(shouldPlaySplash("?foo=1")).toBe(true);
  });
  it("never plays when the app is opened from a join link or QR code", () => {
    expect(shouldPlaySplash("?join=BCDF2345")).toBe(false);
    expect(shouldPlaySplash("?join=")).toBe(false);
  });
  it("never plays on the Public Display", () => {
    expect(shouldPlaySplash("?display=public&code=BCDF2345")).toBe(false);
  });
  it("plays once per tab: a reload back to Home does not replay it", () => {
    window.sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    expect(shouldPlaySplash("")).toBe(false);
  });
});

describe("the token draw", () => {
  it("is ten self-hosted tokens: 5 Townsfolk, 2 Outsiders, 1 Minion, 1 Demon, 1 Traveller", () => {
    for (const launch of [1, 2, 7, 42, 999]) {
      const t = drawTokens(launch);
      expect(t).toHaveLength(10);
      const count = (team: string) => t.filter((x) => x.team === team).length;
      expect([count("townsfolk"), count("outsider"), count("minion"), count("demon"), count("traveler")]).toEqual([5, 2, 1, 1, 1]);
      expect(new Set(t.map((x) => x.id)).size).toBe(10);
      for (const x of t) {
        expect(x.src).toMatch(/^\/art\/characters\//);
        expect(x.src).not.toMatch(/release\.botc\.app/);
      }
    }
  });
  it("is the same for a launch number and differs between launches", () => {
    expect(drawTokens(5).map((x) => x.id)).toEqual(drawTokens(5).map((x) => x.id));
    expect(drawTokens(5).map((x) => x.id)).not.toEqual(drawTokens(6).map((x) => x.id));
  });
});

describe("composition geometry", () => {
  it("uses the design's phone and tablet canvases", () => {
    expect(geometry(false)).toMatchObject({ W: 1080, H: 1920, K: 1, CX: 540, CY: 800, ART: 720, WORD_TOP: 1220, TK: 112 });
    const tab = geometry(true);
    expect(tab).toMatchObject({ W: 2960, H: 1848 });
    expect(tab.K).toBeCloseTo(1848 / 1500);
    expect(tab.CY).toBeCloseTo(1848 * 0.4);
  });
});

describe("LaunchSplash", () => {
  it("is decorative: hidden from assistive technology and marks the tab as played", () => {
    render(<LaunchSplash onDone={() => {}} />);
    expect(screen.getByTestId("launch-splash")).toHaveAttribute("aria-hidden", "true");
    expect(window.sessionStorage.getItem(SPLASH_SESSION_KEY)).toBe("1");
  });

  it("a tap skips it", () => {
    const onDone = vi.fn();
    render(<LaunchSplash onDone={onDone} />);
    fireEvent.click(screen.getByTestId("launch-splash"));
    fireEvent.click(screen.getByTestId("launch-splash"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a key press skips it", () => {
    const onDone = vi.fn();
    render(<LaunchSplash onDone={onDone} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends by itself after five seconds", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const onDone = vi.fn();
    render(<LaunchSplash onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(SPLASH_END * 1000 - 200); });
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("with reduced motion shows a still frame without orbiting tokens, then fades out quickly", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const onDone = vi.fn();
    render(<LaunchSplash onDone={onDone} />);
    const splash = screen.getByTestId("launch-splash");
    expect(splash.querySelectorAll("img")).toHaveLength(0);
    expect(splash).toHaveTextContent("Blood on the Clocktower Companion");
    act(() => { vi.advanceTimersByTime(1500); });
    expect(Number(splash.style.opacity)).toBeLessThan(1);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
