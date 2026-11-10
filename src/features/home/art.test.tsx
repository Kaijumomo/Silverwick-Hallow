// Package 1: official art is used only when it is really installed locally (tablet Home and its Reference overlay).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HomeV6 } from "@/features/grimoire-v6/home/HomeV6";
import { CAROUSEL_ORBIT, EDITION_LOGO } from "./art";
import { useStorytellerStore as store } from "@/stores/storytellerStore";

const present = new Set<string>();
class FakeImage {
  onload: (() => void) | null = null;
  set src(value: string) {
    if (present.has(value)) queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  present.clear();
  vi.stubGlobal("Image", FakeImage);
  store.setState({ game: null, view: "home" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openReference = async () => {
  render(<HomeV6 navigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^Character Reference/ }));
  await act(async () => {});
};
/** The orbit icons drawn on the Carousel button, by file. */
const orbitIcons = () => [...screen.getByRole("img", { name: "The Carousel" }).querySelectorAll<HTMLElement>("span")]
  .map((el) => /url\("?([^")]+)"?\)/.exec(el.style.backgroundImage)?.[1]).filter((src): src is string => !!src);

describe("official art on the tablet Home's Reference", () => {
  it("draws only the Carousel orbit icons whose files really load", async () => {
    for (const src of CAROUSEL_ORBIT.slice(0, 4)) present.add(src);
    await openReference();
    expect(orbitIcons()).toEqual(CAROUSEL_ORBIT.slice(0, 4));
  });

  it("no orbit icon at all when none is installed", async () => {
    await openReference();
    expect(orbitIcons()).toHaveLength(0);
  });

  it("the overlay header uses the logo, named for assistive tech, when it loads", async () => {
    present.add(EDITION_LOGO.tb!);
    await openReference();
    fireEvent.click(screen.getAllByRole("button", { name: /characters$/ })[0]!);
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 2, name: "Trouble Brewing" }).querySelector("img")).not.toBeNull();
  });
});

describe("committed art", () => {
  it("the orbit has the design's eight icons and every referenced file ships in public/", async () => {
    const { existsSync } = await import("node:fs");
    expect(CAROUSEL_ORBIT).toHaveLength(8);
    for (const src of [...Object.values(EDITION_LOGO), ...CAROUSEL_ORBIT]) {
      expect(existsSync(`public${src}`), src).toBe(true);
    }
  });
});

describe("added-character art", () => {
  it("every self-hosted character icon exists in public/", async () => {
    const { existsSync } = await import("node:fs");
    const { localCharacterArt } = await import("./art");
    for (const id of ["shugenja", "harpy", "summoner", "kazali", "lordoftyphon", "leviathan", "deusexfiasco", "ferryman"]) {
      expect(existsSync(`public${localCharacterArt(id)}`), id).toBe(true);
    }
  });
});
