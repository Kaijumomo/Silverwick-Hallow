import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";

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
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const stage = view.container.querySelector(".grimoire-stage")!;
    const canvas = view.container.querySelector(".grimoire")!;
    // Phase 10H (§§5.1, 6.1): the Table is an oval fitted to the measured
    // stage rectangle (tableStage) instead of a height-bound circle -- still
    // recalculated from both dimensions and still capped on large workspaces.
    resizeStage(stage, 1040, 540);
    expect(canvas).toHaveStyle({ width: "1040px", height: "540px" });
    resizeStage(stage, 472, 980);
    expect(canvas).toHaveStyle({ width: "472px", height: "900px" });
    fireEvent.click(screen.getByRole("button", { name: "Close setup panel" }));
    resizeStage(stage, 1800, 1200);
    expect(canvas).toHaveStyle({ width: "1735px", height: "900px" });
  });

  it("preserves the practical diameter as seat count changes from 5 through 15", () => {
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const stage = view.container.querySelector(".grimoire-stage")!;
    const canvas = view.container.querySelector(".grimoire")!;
    resizeStage(stage, 1000, 650);
    for (const count of [5, 7, 12, 15]) {
      act(() => {
        while (storyteller.getState().game!.seatOrder.length < count) storyteller.getState().addEmptySeat();
      });
      expect(view.container.querySelectorAll(".token.empty-seat")).toHaveLength(count);
      expect(canvas).toHaveStyle({ width: "1000px", height: "650px" });
    }
  });

  // Phase 10H (contract §10, S2; 10H-AC-025) amends the 10G mobile Setup
  // foreground: Setup is a Grimoire-centred stage workspace -- on a phone the
  // ONE bottom workspace beside the Table -- never a modal takeover page.
  it("Phase 10H: mobile Setup is the non-modal bottom workspace; the Table stays operable", () => {
    narrow = true;
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const panel = screen.getByRole("complementary", { name: "Setup helper" });
    const seat = view.container.querySelector<HTMLElement>(".token.empty-seat")!;
    expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
    expect(view.container.querySelector(".game-body")).toContainElement(panel);
    expect(seat.closest("[inert]")).toBeNull();
    expect(view.container.querySelector(".phase-bar")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).not.toBe("hidden");
    act(() => seat.focus());
    expect(seat).toHaveFocus();
  });

  it("closes mobile Setup and returns focus to More actions", () => {
    narrow = true;
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    fireEvent.click(screen.getByRole("button", { name: "Close setup panel" }));
    expect(screen.queryByRole("complementary", { name: "Setup helper" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")!.closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("Phase 10H: an open Setup stays the same non-modal workspace across a desktop / phone resize", () => {
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    setNarrow(true);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Setup" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")!.closest("[inert]")).toBeNull();
    setNarrow(false);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("removes active Setup when privacy is enabled, and nothing is isolated", () => {
    narrow = true;
    const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "setup" })); // deliberately open Setup
    const before = structuredClone(storyteller.getState().game);
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(screen.queryByRole("complementary", { name: "Setup helper" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".grimoire-wrap")!.closest("[inert]")).toBeNull();
    expect(storyteller.getState().game).toEqual(before);
    expect(document.body.style.overflow).not.toBe("hidden");
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(screen.getByRole("complementary", { name: "Setup helper" })).toBeInTheDocument();
  });
});

// Phase 10H pre-checkpoint (Forward rule; 10H-AC-067): on tablet and phone
// widths the compact command bar collapses SECONDARY actions into More
// actions, but the current phase-advance primary stays directly in the bar.
describe("Phase 10H: the phase-advance primary is never collapsed into the overflow", () => {
  function playing(phase: "night" | "day") {
    storyteller.setState({
      game: setupGame(standardRoles(5), { phase, day: 1, setupRolesDealt: true, setupRolesRevealed: true }),
      customScripts: { [setupScript.id]: setupScript },
    });
  }

  it.each([["night", "→ Day"], ["day", "→ Night"]] as const)("%s at compact width: %s sits in the bar, outside More actions", (phase, label) => {
    narrow = true;
    playing(phase);
    const view = render(<GameScreen />);
    const advance = screen.getByRole("button", { name: label });
    const bar = view.container.querySelector(".phase-bar")!;
    expect(advance).toHaveClass("phase-advance");
    expect(advance.parentElement).toHaveClass("phase-primary");
    expect(advance.parentElement!.parentElement).toBe(bar);
    expect(advance.closest(".phase-bar-right")).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    expect(advance).toBeEnabled();
    expect(advance).not.toHaveAttribute("aria-describedby");
  });

  it("under Privacy Mode the advance stays visible, disabled, with an adjacent visible reason in words", () => {
    narrow = true;
    playing("night");
    usePrivacyStore.setState({ enabled: true });
    render(<GameScreen />);
    const advance = screen.getByRole("button", { name: "→ Day" });
    expect(advance).toBeDisabled();
    const reasonId = advance.getAttribute("aria-describedby")!;
    const reason = document.getElementById(reasonId)!;
    expect(reason).toHaveTextContent("Turn off Privacy Mode first");
    expect(reason.parentElement).toBe(advance.parentElement);
    // The visible words -- not the hover title -- are the accessible description.
    expect(advance).toHaveAccessibleDescription("Turn off Privacy Mode first");
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(advance).toBeEnabled();
    expect(document.getElementById(reasonId)).toBeNull();
  });
});
