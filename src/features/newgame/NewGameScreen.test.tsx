import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewGameScreen } from "./NewGameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { SETUP_COUNTS } from "@/data/setupCounts";

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: {}, view: "newgame" });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const selectionCount = () => screen.getByText(/\/ \d+ roles selected/).textContent!;

describe("NewGameScreen Fill & Re-roll Bag", () => {
  it("fills an empty bag into a complete valid composition and offers Re-roll next", () => {
    render(<NewGameScreen />);
    expect(screen.getByText(/roles selected/)).toHaveTextContent(`0 / ${SETUP_COUNTS[5]!.townsfolk + SETUP_COUNTS[5]!.outsider + SETUP_COUNTS[5]!.minion + SETUP_COUNTS[5]!.demon} roles selected`);
    expect(screen.getByRole("button", { name: "Fill the Bag" })).toBeVisible();

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });

    const total = SETUP_COUNTS[5]!.townsfolk + SETUP_COUNTS[5]!.outsider + SETUP_COUNTS[5]!.minion + SETUP_COUNTS[5]!.demon;
    expect(selectionCount()).toBe(`${total} / ${total} roles selected`);
    expect(screen.getByRole("button", { name: "Re-roll Bag" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Fill the Bag" })).toBeNull();
  });

  it("preserves a manually pinned role across Fill and a subsequent Re-roll", () => {
    render(<NewGameScreen />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Empath" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" })); });
    expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");
  });

  it("L. changing player count after Fill does not silently regenerate the bag; Re-roll must be pressed explicitly", () => {
    render(<NewGameScreen />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    const fiveTotal = SETUP_COUNTS[5]!.townsfolk + SETUP_COUNTS[5]!.outsider + SETUP_COUNTS[5]!.minion + SETUP_COUNTS[5]!.demon;
    expect(selectionCount()).toBe(`${fiveTotal} / ${fiveTotal} roles selected`);

    // Move from 5 to 8 players via the stepper.
    for (let i = 0; i < 3; i++) act(() => { fireEvent.click(screen.getByRole("button", { name: "More players" })); });

    // The bag Silverwick already filled for 5 players is untouched -- still 5
    // roles selected -- even though the target is now 8. No silent reroll.
    const eightTotal = SETUP_COUNTS[8]!.townsfolk + SETUP_COUNTS[8]!.outsider + SETUP_COUNTS[8]!.minion + SETUP_COUNTS[8]!.demon;
    expect(selectionCount()).toBe(`${fiveTotal} / ${eightTotal} roles selected`);
    // The Storyteller must explicitly press Re-roll to complete the bag for the new count.
    expect(screen.getByRole("button", { name: "Re-roll Bag" })).toBeVisible();

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" })); });
    expect(selectionCount()).toBe(`${eightTotal} / ${eightTotal} roles selected`);
  });

  it("M. switching scripts resets any generated or pinned bag state -- nothing leaks into the new script", () => {
    render(<NewGameScreen />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Empath" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    expect(screen.getByRole("button", { name: "Re-roll Bag" })).toBeVisible();

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Sects & Violets" })); });

    expect(selectionCount()).toMatch(/^0 \//);
    expect(screen.getByRole("button", { name: "Fill the Bag" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Re-roll Bag" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Empath" })).toBeNull(); // Trouble Brewing tile is gone
  });

  it("O. Fill/Re-roll never touch Zustand game state or assign any player a role", () => {
    render(<NewGameScreen />);
    expect(store.getState().game).toBeNull();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Empath" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" })); });
    // dealRolePool()/newGame() are the only actions that create or touch game
    // state; neither Fill nor Re-roll called them.
    expect(store.getState().game).toBeNull();
  });
});
