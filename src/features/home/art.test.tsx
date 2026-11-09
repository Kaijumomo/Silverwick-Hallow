// Package 1: official art is used only when it is really installed locally.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";
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
  render(<HomeScreen navigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^Character Reference/ }));
  await act(async () => {});
};

describe("official art on the Reference tiles", () => {
  it("falls back to the marked temporary marks when no art is installed", async () => {
    await openReference();
    expect(document.querySelectorAll('.home-door-tile [data-temporary-art="true"]')).toHaveLength(4);
    expect(document.querySelector(".home-door-logo")).toBeNull();
    expect(document.querySelector(".home-door-orbit")).toBeNull();
  });

  it("shows the edition logos and the Carousel orbit once the files load; unavailable pieces stay temporary", async () => {
    for (const src of Object.values(EDITION_LOGO)) present.add(src);
    for (const src of CAROUSEL_ORBIT.slice(0, 4)) present.add(src);
    await openReference();
    expect(document.querySelectorAll(".home-door-logo")).toHaveLength(3);
    expect(document.querySelectorAll(".home-door-orbit-ring img")).toHaveLength(4);
    expect(document.querySelectorAll('.home-door-tile [data-temporary-art="true"]')).toHaveLength(0);
    expect(screen.getByRole("img", { name: "The Carousel" })).toBeInTheDocument();
  });

  it("only one logo present: the others keep their temporary marks", async () => {
    present.add(EDITION_LOGO.tb!);
    await openReference();
    expect(document.querySelectorAll(".home-door-logo")).toHaveLength(1);
    expect(document.querySelectorAll('.home-door-tile [data-temporary-art="true"]')).toHaveLength(3);
  });

  it("the overlay header uses the logo, named for assistive tech, when it loads", async () => {
    present.add(EDITION_LOGO.tb!);
    await openReference();
    fireEvent.click(screen.getByRole("button", { name: /Trouble Brewing/ }));
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
