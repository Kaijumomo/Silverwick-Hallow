import { afterEach, describe, expect, it, vi } from "vitest";

const realStorage = window.localStorage;

async function loadAt(url: string) {
  window.history.pushState({}, "", url);
  vi.resetModules();
  return import("./revealRoute");
}

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: realStorage, configurable: true });
  window.history.pushState({}, "", "/");
});

describe("diagnostic Reveal test page route", () => {
  it("does nothing on the normal app routes", async () => {
    for (const url of ["/", "/?diag=nonoise", "/diag-reveal-not", "/?page=home"]) {
      const { isRevealPage } = await loadAt(url);
      expect(isRevealPage).toBe(false);
      expect(window.localStorage).toBe(realStorage);
    }
  });

  it("on /diag-reveal and ?page=reveal swaps in a private in-memory storage", async () => {
    for (const url of ["/diag-reveal", "/diag-reveal/?diag=nomultiply", "/?page=reveal"]) {
      realStorage.setItem("new-blood-st", "REAL");
      const { isRevealPage } = await loadAt(url);
      expect(isRevealPage).toBe(true);
      expect(window.localStorage).not.toBe(realStorage);
      expect(window.localStorage.getItem("new-blood-st")).toBeNull();
      window.localStorage.setItem("new-blood-st", "SIMULATED");
      expect(window.localStorage.getItem("new-blood-st")).toBe("SIMULATED");
      expect(Object.keys(window.localStorage)).toEqual([]);
      Object.defineProperty(window, "localStorage", { value: realStorage, configurable: true });
      expect(realStorage.getItem("new-blood-st")).toBe("REAL");
      realStorage.removeItem("new-blood-st");
    }
  });
});
