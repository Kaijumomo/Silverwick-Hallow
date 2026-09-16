import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewGameScreen } from "./NewGameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { MIN_PLAYERS, MAX_PLAYERS, SETUP_COUNTS } from "@/data/setupCounts";

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: {}, view: "newgame" });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("A. New Game planning UI remains", () => {
  it("shows script selection, the planned player stepper, and the full composition table", () => {
    const { container } = render(<NewGameScreen />);
    expect(screen.getByRole("button", { name: "Trouble Brewing" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sects & Violets" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Bad Moon Rising" })).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Import" })).toBeVisible();

    expect(container.querySelector(".ng-stepper-value")).toHaveTextContent(`${MIN_PLAYERS} players`);

    const table = screen.getByRole("table", { name: "Player count reference" });
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const row = screen.getByRole("row", { name: new RegExp(`^${n} `) });
      expect(table).toContainElement(row);
    }
  });

  it("highlights the currently selected player-count row", () => {
    const { container } = render(<NewGameScreen />);
    const initialRow = screen.getByRole("row", { name: new RegExp(`^${MIN_PLAYERS} `) });
    expect(initialRow).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("row", { name: /^8 / }));
    expect(screen.getByRole("row", { name: /^8 / })).toHaveAttribute("aria-selected", "true");
    expect(initialRow).toHaveAttribute("aria-selected", "false");
    expect(container.querySelector(".ng-stepper-value")).toHaveTextContent("8 players");
  });
});

describe("B. Role selection is no longer owned by New Game", () => {
  it("shows no ordinary role grid, Fill/Re-roll, or Fabled/Loric selectors", () => {
    render(<NewGameScreen />);
    expect(screen.queryByRole("button", { name: "Fill the Bag" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-roll Bag" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Empath" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Imp" })).toBeNull();
    expect(screen.queryByText("Fabled & Lorics")).toBeNull();
    expect(screen.queryByText(/roles selected/)).toBeNull();
  });
});

describe("C. New Game enters the Grimoire with planning data", () => {
  it("creating a setup for Trouble Brewing @ 8 players produces the Grimoire with an empty pool", async () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^8 / }));
    fireEvent.click(screen.getByRole("button", { name: /Create setup/ }));
    await waitFor(() => expect(store.getState().game).not.toBeNull());

    const game = store.getState().game!;
    expect(game.scriptId).toBe("tb");
    expect(game.plannedPlayerCount).toBe(8);
    expect(game.rolePool).toEqual([]);
    expect(game.fabled).toEqual([]);
    expect(game.lorics).toEqual([]);
    expect(store.getState().view).toBe("game");
  });

  it("creating a setup with the default player count uses the minimum stepper value", async () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Create setup/ }));
    await waitFor(() => expect(store.getState().game).not.toBeNull());
    expect(store.getState().game!.plannedPlayerCount).toBe(MIN_PLAYERS);
    expect(store.getState().game!.rolePool).toEqual([]);
  });

  it.each(Object.keys(SETUP_COUNTS).map(Number))(
    "creating a setup for %i players always starts with an empty ordinary role pool",
    async (count) => {
      render(<NewGameScreen />);
      fireEvent.click(screen.getByRole("row", { name: new RegExp(`^${count} `) }));
      fireEvent.click(screen.getByRole("button", { name: /Create setup/ }));
      await waitFor(() => expect(store.getState().game).not.toBeNull());
      expect(store.getState().game!.rolePool).toEqual([]);
      expect(store.getState().game!.plannedPlayerCount).toBe(count);
    }
  );
});
