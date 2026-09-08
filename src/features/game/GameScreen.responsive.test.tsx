import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";

let narrow = false;
const mediaListeners = new Set<() => void>();
const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];

function setNarrow(value: boolean) {
  act(() => {
    narrow = value;
    mediaListeners.forEach(listener => listener());
  });
}

function resizeStage(stage: Element, width: number, height: number) {
  const observer = observers.find(item => item.targets.has(stage));
  expect(observer, "the available stage is observed independently of the canvas").toBeDefined();
  act(() => observer!.callback([
    { target: stage, contentRect: { width, height } } as ResizeObserverEntry,
  ], {} as ResizeObserver));
}

beforeEach(() => {
  narrow = false;
  mediaListeners.clear();
  observers.length = 0;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    media: query,
    get matches() { return narrow; },
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
  })));
  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  });
  usePrivacyStore.setState({ enabled: false });
  storyteller.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, grimoireMode: "ring" });
  storyteller.getState().newGame("tb", { plannedPlayerCount: 5 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("responsive Storyteller workspace", () => {
  it("recalculates from stage width and height and caps large workspaces", () => {
    const view = render(<GameScreen />);
    const stage = view.container.querySelector(".grimoire-stage")!;
    const canvas = view.container.querySelector(".grimoire")!;
    resizeStage(stage, 1040, 540);
    expect(canvas).toHaveStyle({ width: "540px", height: "540px" });
    resizeStage(stage, 472, 980);
    expect(canvas).toHaveStyle({ width: "472px", height: "472px" });
    fireEvent.click(screen.getByRole("button", { name: "Close setup panel" }));
    resizeStage(stage, 1800, 1200);
    expect(canvas).toHaveStyle({ width: "720px", height: "720px" });
  });

  it("preserves the practical diameter as seat count changes from 5 through 15", () => {
    const view = render(<GameScreen />);
    const stage = view.container.querySelector(".grimoire-stage")!;
    const canvas = view.container.querySelector(".grimoire")!;
    resizeStage(stage, 1000, 650);
    for (const count of [5, 7, 12, 15]) {
      act(() => {
        while (storyteller.getState().game!.seatOrder.length < count) storyteller.getState().addEmptySeat();
      });
      expect(view.container.querySelectorAll(".token.empty-seat")).toHaveLength(count);
      expect(canvas).toHaveStyle({ width: "650px", height: "650px" });
    }
  });

  it("isolates mobile Setup and prevents focus from escaping to an underlying seat", () => {
    narrow = true;
    const view = render(<GameScreen />);
    const dialog = screen.getByRole("dialog", { name: "Setup" });
    const seat = view.container.querySelector<HTMLElement>(".token.empty-seat")!;
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(view.container.querySelector(".game")).toHaveAttribute("data-setup-foreground", "true");
    expect(seat.closest("[inert]")).not.toBeNull();
    expect(view.container.querySelector(".phase-bar")).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    act(() => seat.focus());
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("closes auto-opened mobile Setup and restores access and focus to More actions", () => {
    narrow = true;
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Close setup panel" }));
    expect(screen.queryByRole("dialog", { name: "Setup" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".game")).not.toHaveAttribute("data-setup-foreground");
    expect(view.container.querySelector(".grimoire-wrap")).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("switches an open Setup between desktop sidebar and mobile foreground on resize", () => {
    const view = render(<GameScreen />);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Setup" })).not.toBeInTheDocument();
    setNarrow(true);
    expect(screen.getByRole("dialog", { name: "Setup" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Setup helper" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")).toHaveAttribute("inert");
    setNarrow(false);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Setup" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("removes active Setup when privacy is enabled and clears its background isolation", () => {
    narrow = true;
    const view = render(<GameScreen />);
    const before = structuredClone(storyteller.getState().game);
    expect(screen.getByRole("dialog", { name: "Setup" })).toBeInTheDocument();
    // An external privacy change must also cleanly dismiss the foreground surface.
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(screen.queryByRole("dialog", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Setup helper" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".game")).not.toHaveAttribute("data-setup-foreground");
    expect(view.container.querySelector(".grimoire-wrap")).not.toHaveAttribute("inert");
    expect(storyteller.getState().game).toEqual(before);
    expect(document.body.style.overflow).not.toBe("hidden");
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(screen.getByRole("dialog", { name: "Setup" })).toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")).toHaveAttribute("inert");
  });
});
