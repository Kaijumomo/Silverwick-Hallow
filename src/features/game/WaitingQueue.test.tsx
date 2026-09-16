import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { GameScreen } from "./GameScreen";

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
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Waiting queue direct access (Phase 9 Setup finalization B4)", () => {
  it("makes the queue indicator open a popup listing waiting players with Assign/Reject actions", () => {
    render(<GameScreen />);
    const pill = screen.getByRole("button", { name: /1 in queue/ });
    fireEvent.click(pill);
    expect(screen.getByText("Waiting queue")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("Assign uses the same assignPendingToSeat path as the seat-first workflow", () => {
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /1 in queue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const seatId = game().seatOrder.find((id) => game().players[id]!.name === "Alice");
    expect(seatId).toBeDefined();
    expect(game().players[seatId!]!.isEmpty).toBe(false);
    expect(game().pendingPlayers).toEqual({});
  });

  it("Reject removes the waiting player without seating them", () => {
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /1 in queue/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(game().pendingPlayers).toEqual({});
    expect(Object.values(game().players).some((p) => p.name === "Alice")).toBe(false);
  });

  it("processes multiple waiting players in one session without closing between assignments", () => {
    state().addEmptySeat();
    state().addToPendingQueue("uid-2", "Bob");
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /2 in queue/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Assign" })[0]!);
    // The popup stays open in queue mode -- the second waiting player is
    // still there to process next.
    expect(screen.getByText("Waiting queue")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(game().pendingPlayers).toEqual({});
    expect(Object.values(game().players).filter((p) => !p.isEmpty)).toHaveLength(2);
  });

  it("disables Assign and explains when no empty seats remain", () => {
    // Consume the only empty seat first.
    state().addToPendingQueue("uid-2", "Bob");
    const onlySeat = game().seatOrder[0]!;
    state().assignPendingToSeat("uid-1", onlySeat);
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /1 in queue/ }));
    expect(screen.getByText("No empty seats available. Add a seat first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
  });
});
