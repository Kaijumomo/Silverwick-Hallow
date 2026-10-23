import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { SetupOverlays } from "./SetupOverlays";
import { useSetupFlow } from "./flow";

// Phase 9 Setup finalization B4: the "N in queue" indicator becomes
// directly actionable, reusing the exact same SeatAssignPopup component and
// assignPendingToSeat/removePendingPlayer command path as the existing
// "empty seat -> choose waiting player" workflow -- never a second
// membership path.
const state = () => store.getState();
const game = () => state().game!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [] });
  state().newGame("tb");
  state().addEmptySeat();
  state().addToPendingQueue("uid-1", "Alice");
  store.setState({ lobby: { code: "ABCD2345", uid: "host", sessionId: "test-session", status: "live" } });
  useSetupFlow.getState().set({ queueOpen: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Waiting queue direct access (Phase 9 Setup finalization B4)", () => {
  it("makes the queue indicator open a popup listing waiting players with Assign/Reject actions", () => {
    render(<SetupOverlays />);
    const pill = screen.getByRole("button", { name: /1 waiting/ });
    fireEvent.click(pill);
    expect(screen.getByText("Waiting queue")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  // The unified Grimoire shows the queue pill only for a live lobby, where Assign / Reject go through the membership backend
  // (covered by membershipCommands / lifecycle tests). The local commands behind them are the store contract:
  it("Assign uses the assignPendingToSeat command and empties the queue", () => {
    expect(state().assignPendingToSeat("uid-1", game().seatOrder[0]!)).toBe(true);
    const seatId = game().seatOrder.find((id) => game().players[id]!.name === "Alice");
    expect(seatId).toBeDefined();
    expect(game().players[seatId!]!.isEmpty).toBe(false);
    expect(game().pendingPlayers).toEqual({});
  });

  it("Reject removes the waiting player without seating them", () => {
    state().removePendingPlayer("uid-1");
    expect(game().pendingPlayers).toEqual({});
    expect(Object.values(game().players).some((p) => p.name === "Alice")).toBe(false);
  });

  it("processes multiple waiting players one after another", () => {
    state().addEmptySeat();
    state().addToPendingQueue("uid-2", "Bob");
    expect(state().assignPendingToSeat("uid-1", game().seatOrder[0]!)).toBe(true);
    expect(game().pendingPlayers).toEqual({ "uid-2": "Bob" });
    expect(state().assignPendingToSeat("uid-2", game().seatOrder[1]!)).toBe(true);
    expect(game().pendingPlayers).toEqual({});
    expect(Object.values(game().players).filter((p) => !p.isEmpty)).toHaveLength(2);
  });

  it("disables Assign and explains when no empty seats remain", () => {
    // Consume the only empty seat first.
    state().addToPendingQueue("uid-2", "Bob");
    const onlySeat = game().seatOrder[0]!;
    state().assignPendingToSeat("uid-1", onlySeat);
    render(<SetupOverlays />);
    fireEvent.click(screen.getByRole("button", { name: /1 waiting/ }));
    expect(screen.getByText("No empty seats available. Add a seat first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
  });
});
