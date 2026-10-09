import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { choose, chosen } from "@/test/pickers";

let narrow = false;
const listeners = new Set<() => void>();
const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];
const state = () => storyteller.getState();
function resize(stage: Element, width: number, height: number) {
  const observer = observers.find(item => item.targets.has(stage));
  expect(observer).toBeDefined();
  act(() => observer!.callback([{ target: stage, contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver));
}
const geometry = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".grimoire .token")]
  .map(token => [token.style.left, token.style.top, token.style.width, token.style.height]);
function playing(phase: "day" | "night" = "night") {
  storyteller.setState({ game: setupGame(["monk", "imp", "empath", "chef", "washerwoman"],
    { phase, day: 2, setupRolesDealt: true, setupRolesRevealed: true }),
    customScripts: { [setupScript.id]: setupScript } });
  return render(<GameScreen />);
}
const actor = (container: HTMLElement) => container.querySelector<HTMLElement>(".grimoire .token.acting")!;
const hideNight = () => fireEvent.click(screen.getByRole("button", { name: "Close Night panel" }));
const openNight = () => fireEvent.click(screen.getByRole("button", { name: "Night" }));
const card = () => screen.getByRole("dialog", { name: /^Imp/ });
const slot = () => card().querySelector<HTMLElement>("[data-pick-slot]")!.dataset.pickSlot!;
function impDraft() {
  const view = playing();
  fireEvent.click(screen.getByRole("button", { name: /^Imp Player 1/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  const pick = slot();
  choose(pick, "p2", card());
  return { view, pick };
}

beforeEach(() => {
  narrow = false; listeners.clear(); observers.length = 0;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, get matches() { return narrow; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) })));
  vi.stubGlobal("ResizeObserver", class {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  });
  usePrivacyStore.setState({ enabled: false }); useShellStore.getState().reset(); useTargetPicker.getState().cancel();
  storyteller.setState({ game: null, lobby: null, sync: null, terminalClose: null, undoStack: [], seatSwapUndo: [],
    selectedPlayerId: null, grimoireMode: "ring", tokenPositions: {}, finishedGameUndo: null, canUndoFinishedGame: false });
  state().newGame("tb", { plannedPlayerCount: 5 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("single responsive Storyteller board", () => {
  it("recalculates canonical geometry from measured width and height without capping the movement canvas", () => {
    const view = render(<GameScreen />);
    const stage = view.container.querySelector(".grimoire-stage")!;
    const canvas = view.container.querySelector<HTMLElement>(".grimoire")!;
    resize(stage, 1040, 540); const wide = geometry(view.container);
    resize(stage, 472, 980); expect(geometry(view.container)).not.toEqual(wide);
    const tall = geometry(view.container);
    resize(stage, 1800, 1200); expect(geometry(view.container)).not.toEqual(tall);
    expect(canvas).toHaveAttribute("data-mode", "freeRoam");
    expect(canvas.style.width).toBe(""); expect(canvas.style.height).toBe("");
    expect(view.container.querySelector(".grimoire")).toBe(canvas);
  });

  it("retains one canvas and usable seats as population grows from 5 to 20", () => {
    const view = render(<GameScreen />);
    const canvas = view.container.querySelector(".grimoire")!;
    resize(view.container.querySelector(".grimoire-stage")!, 1480, 924);
    for (const count of [5, 7, 12, 15, 20]) {
      act(() => { while (state().game!.seatOrder.length < count) state().addEmptySeat(); });
      expect(canvas.querySelectorAll(".token.empty-seat")).toHaveLength(count);
      for (const token of canvas.querySelectorAll<HTMLElement>(".token")) expect(parseFloat(token.style.width)).toBeGreaterThanOrEqual(44);
      expect(view.container.querySelector(".grimoire")).toBe(canvas);
      expect(view.container.querySelector(".table-replaced")).toBeNull();
    }
  });

  it("phone Players is nonmodal and keeps the grimoire keyboard accessible", () => {
    narrow = true; const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Players" }));
    expect(screen.getByRole("complementary", { name: "Players" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    const seat = view.container.querySelector<HTMLElement>(".token.empty-seat")!;
    expect(seat.closest("[inert]")).toBeNull(); act(() => seat.focus()); expect(seat).toHaveFocus();
  });

  it("closing phone Players restores focus to its rail button", () => {
    narrow = true; render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Players" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Players panel" }));
    expect(screen.queryByRole("complementary", { name: "Players" })).toBeNull();
    expect(screen.getByRole("button", { name: "Players" })).toHaveFocus();
  });

  it("keeps the same Players workspace through the phone boundary", () => {
    render(<GameScreen />); fireEvent.click(screen.getByRole("button", { name: "Players" }));
    const panel = screen.getByRole("complementary", { name: "Players" });
    for (const value of [true, false]) {
      act(() => { narrow = value; listeners.forEach(listener => listener()); });
      expect(screen.getByRole("complementary", { name: "Players" })).toBe(panel);
      expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    }
  });

  it("privacy removes the active Players surface without changing the game or reopening on return", () => {
    narrow = true; const view = render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Players" }));
    const before = structuredClone(state().game); const positions = geometry(view.container);
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(geometry(view.container)).toEqual(positions); expect(state().game).toEqual(before);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it.each([["night", "Begin Day"], ["day", "Begin Night 3"]] as const)("keeps %s phase advance directly in the bottom pill on a phone", (phase, name) => {
    narrow = true; playing(phase);
    const advance = screen.getByRole("button", { name });
    expect(advance.closest(".grimoire-phase-dock")).not.toBeNull();
    expect(advance.parentElement).toHaveClass("phase-primary");
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(advance).toBeEnabled();
  });

  it("privacy disables phase advance with an adjacent accessible reason", () => {
    narrow = true; playing(); act(() => usePrivacyStore.getState().setEnabled(true));
    const advance = screen.getByRole("button", { name: "Begin Day" });
    expect(advance).toBeDisabled();
    expect(advance).toHaveAccessibleDescription("Turn off Privacy Mode first");
    expect(document.getElementById(advance.getAttribute("aria-describedby")!)?.parentElement).toBe(advance.parentElement);
    act(() => usePrivacyStore.getState().setEnabled(false)); expect(advance).toBeEnabled();
  });
});

describe("Night navigation and recovery in the single shell", () => {
  it("closes and reopens the same Night guide while leaving the board available", () => {
    const view = playing(); const before = state().game;
    hideNight(); expect(screen.queryByRole("region", { name: "Night 2 guide" })).toBeNull();
    expect(view.container.querySelector(".grimoire")).toBeInTheDocument();
    openNight(); expect(screen.getByRole("region", { name: "Night 2 guide" })).toBeVisible();
    expect(state().game).toBe(before);
  });

  it("hiding a direct Night action invalidates a captured target and actor tap resumes its step", () => {
    const view = playing(); const pending = useTargetPicker.getState().active!;
    expect(pending).not.toBeNull(); const before = state().game; const cursor = useShellStore.getState().nightCursor;
    hideNight(); expect(useTargetPicker.getState().active).toBeNull();
    act(() => pending.onPick({ playerId: "p2", participantId: before!.players.p2!.participantId! }));
    expect(state().game).toBe(before);
    fireEvent.click(actor(view.container));
    expect(screen.getByRole("region", { name: "Night 2 guide" })).toBeVisible();
    expect(useShellStore.getState().nightCursor).toEqual(cursor);
    expect(useTargetPicker.getState().active).not.toBeNull();
  });

  it("hiding a detailed action and reopening by its actor keeps the same draft repeatedly", () => {
    const { view, pick } = impDraft(); const before = state().game;
    expect(card().parentElement).toHaveAttribute("id", "action-card-dock-host");
    for (let repeat = 0; repeat < 3; repeat++) {
      hideNight(); expect(screen.queryByRole("dialog", { name: /^Imp/ })).toBeNull();
      fireEvent.click(actor(view.container));
      expect(chosen(pick, card())).toBe("p2");
    }
    expect(state().game).toBe(before);
  });

  it("inspecting another participant while Night is hidden preserves its actor and draft", () => {
    const { view, pick } = impDraft();
    hideNight();
    fireEvent.click(view.container.querySelector<HTMLElement>('.grimoire [data-player-id="p3"]')!);
    expect(state().selectedPlayerId).toBe("p3");
    expect(screen.queryByRole("region", { name: "Night 2 guide" })).toBeNull();
    fireEvent.click(actor(view.container));
    expect(chosen(pick, card())).toBe("p2");
    expect(state().selectedPlayerId).toBeNull();
  });

  it("changing the current actor invalidates the prior draft", () => {
    impDraft(); hideNight(); openNight();
    fireEvent.click(screen.getByRole("button", { name: /^Monk Player 0/ }));
    expect(screen.queryByRole("dialog", { name: /^Imp/ })).toBeNull();
    expect(useShellStore.getState().litActor?.playerId).toBe("p0");
    expect(screen.getByRole("article", { name: "Current action: Monk" })).toBeVisible();
  });

  it("privacy removes private Night and Info content and holds token geometry across a concealed resize", () => {
    const view = playing();
    const stage = view.container.querySelector(".grimoire-stage")!;
    resize(stage, 1024, 768);
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    fireEvent.click(screen.getByText("Game rules & modifiers"));
    fireEvent.click(screen.getByRole("button", { name: "Pin Info panel" }));
    const before = geometry(view.container);
    act(() => usePrivacyStore.getState().setEnabled(true)); resize(stage, 1480, 924);
    expect(geometry(view.container)).toEqual(before);
    expect(document.body).not.toHaveTextContent(/Monk|Game rule facts|guided resolution/);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(geometry(view.container)).not.toEqual(before);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("retains the advanced Night workspace as a contextual route", () => {
    playing(); fireEvent.click(screen.getByRole("button", { name: "Additional night controls" }));
    expect(screen.getByRole("complementary", { name: "Night 2 order" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to guided night" }));
    expect(screen.getByRole("region", { name: "Night 2 guide" })).toBeVisible();
  });
});
