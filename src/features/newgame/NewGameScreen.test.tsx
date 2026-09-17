import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewGameScreen } from "./NewGameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { MIN_PLAYERS, MAX_PLAYERS, MAX_TOTAL_PLAYERS, SETUP_COUNTS } from "@/data/setupCounts";

const moreTravelers = () => screen.getByRole("button", { name: "More Travelers" });
const fewerTravelers = () => screen.getByRole("button", { name: "Fewer Travelers" });
const morePlayers = () => screen.getByRole("button", { name: "More players" });
const fewerPlayers = () => screen.getByRole("button", { name: "Fewer players" });
const ordinaryLine = () => screen.getByText(/^Ordinary:/);

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

describe("A2. Traveller-aware population UI (Phase 9 Setup finalization B4)", () => {
  it("shows a compact Travellers stepper defaulting to 0, an Ordinary line, and explanatory text", () => {
    const { container } = render(<NewGameScreen />);
    expect(moreTravelers()).toBeVisible();
    expect(fewerTravelers()).toBeVisible();
    expect(fewerTravelers()).toBeDisabled(); // 0 Travelers is already the floor for total=MIN_PLAYERS
    const stepperValues = container.querySelectorAll(".ng-stepper-value");
    expect(stepperValues[1]).toHaveTextContent("0 Travelers");
    expect(ordinaryLine()).toHaveTextContent(`Ordinary: ${MIN_PLAYERS}`);
    expect(screen.getByText("Composition is based on ordinary players. Travellers are separate.")).toBeVisible();
  });

  it("highlights the composition table row for the ordinary count, not total participants", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^10 / })); // sets ordinary (and total, 0 Travelers) to 10
    fireEvent.click(moreTravelers()); // 10 total / 1 Traveller -> ordinary 9
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 9");
    expect(screen.getByRole("row", { name: /^9 / })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("row", { name: /^10 / })).toHaveAttribute("aria-selected", "false");
  });

  it.each([
    [10, 0, 10], [10, 1, 9], [10, 2, 8], [15, 0, 15], [10, 5, 5],
  ])("total %i / %i Travellers -> ordinary %i", (total, travelers, ordinary) => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: new RegExp(`^${total} `) }));
    for (let i = 0; i < travelers; i++) fireEvent.click(moreTravelers());
    expect(ordinaryLine()).toHaveTextContent(`Ordinary: ${ordinary}`);
  });

  it("rejects 5/1: the Travellers stepper cannot increment at the floor total", () => {
    render(<NewGameScreen />); // default total is MIN_PLAYERS (5)
    expect(moreTravelers()).toBeDisabled();
    fireEvent.click(moreTravelers()); // no-op: stepper refuses past its own max
    expect(ordinaryLine()).toHaveTextContent(`Ordinary: ${MIN_PLAYERS}`);
  });

  it("rejects 10/6: the Travellers stepper stops incrementing once ordinary would drop below 5", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^10 / }));
    for (let i = 0; i < 6; i++) fireEvent.click(moreTravelers());
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 5"); // floored at 5, never 4
  });

  it("16/1 minimum: incrementing total above 15 with 0 Travellers auto-raises Travellers to keep ordinary at 15", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^15 / })); // 15 total / 0 Travellers
    fireEvent.click(morePlayers()); // -> 16 total
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 15");
    expect(fewerTravelers()).toBeDisabled(); // 1 Traveller is now the minimum for total 16
  });

  it("18/3 and 20/5 minimums: continuing to raise total keeps auto-raising the Traveller floor", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^15 / }));
    for (let i = 0; i < 3; i++) fireEvent.click(morePlayers()); // 15 -> 18
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 15");
    for (let i = 0; i < 2; i++) fireEvent.click(morePlayers()); // 18 -> 20
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 15");
  });

  it("lowering total back down never silently discards an explicit Traveller count that is still legal", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^15 / }));
    fireEvent.click(morePlayers()); // 16 total / 1 Traveller (auto-raised)
    fireEvent.click(fewerPlayers()); // back to 15 total -- 1 Traveller remains legal (0-10 range), so it is kept
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 14");
    expect(fewerTravelers()).toBeEnabled(); // still adjustable back down explicitly
  });

  it("caps supported total participants at 20, independent of the Traveller catalogue size (Phase 9 Setup finalization B4 revision)", () => {
    expect(MAX_TOTAL_PLAYERS).toBe(20);
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^15 / })); // 15 total / 0 Travellers
    for (let i = 0; i < 10; i++) fireEvent.click(morePlayers()); // attempt to push well past 20
    // The total stepper itself refuses past MAX_TOTAL_PLAYERS -- ordinary
    // stays pinned at the 15-player cap via the minimum Traveller floor.
    expect(morePlayers()).toBeDisabled();
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 15");
  });

  it("Traveller minimums above 15 total still work up to the new 20 cap", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^15 / }));
    for (let i = 0; i < 5; i++) fireEvent.click(morePlayers()); // 15 -> 20
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 15"); // 20/5 minimum
    expect(morePlayers()).toBeDisabled();
  });

  it("FINAL SETUP INTEGRATION REVISION Section 4: the composition table obeys the same 20-total cap as the stepper -- 15 Travellers, clicking the 15-ordinary row never creates 30", () => {
    const { container } = render(<NewGameScreen />);
    for (let i = 0; i < 15; i++) fireEvent.click(morePlayers()); // 5 -> 20 total, 0 Travellers
    for (let i = 0; i < 15; i++) fireEvent.click(moreTravelers()); // -> 20 total / 15 Travellers / 5 ordinary
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 5");
    // Click the 15-ordinary row: naive total = 15 ordinary + 15 Travellers =
    // 30. The selected ordinary count must be preserved and the Traveller
    // count reduced to the largest legal value instead -- total must remain
    // capped at 20 (15 ordinary / 5 Travellers here), never 30.
    fireEvent.click(screen.getByRole("row", { name: /^15 / }));
    expect(ordinaryLine()).toHaveTextContent("Ordinary: 15");
    expect(container.querySelector(".ng-stepper-value")).toHaveTextContent("20 players");
    expect(screen.getByRole("row", { name: /^15 / })).toHaveAttribute("aria-selected", "true");
  });

  it("passes the intended Traveller count into game creation, distinct from total planned seats", async () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("row", { name: /^10 / }));
    fireEvent.click(moreTravelers());
    fireEvent.click(moreTravelers()); // 10 total / 2 Travellers -> ordinary 8
    fireEvent.click(screen.getByRole("button", { name: /Create setup/ }));
    await waitFor(() => expect(store.getState().game).not.toBeNull());
    const game = store.getState().game!;
    expect(game.plannedPlayerCount).toBe(10);
    expect(game.plannedTravelerCount).toBe(2);
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
