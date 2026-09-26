import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  usePrivacyStore.setState({ enabled: false });
  storyteller.setState({ game: null, lobby: null, undoStack: [] });
  storyteller.getState().newGame("tb");
  storyteller.getState().addPlayer("Alice");
  const id = storyteller.getState().game!.seatOrder[0]!;
  storyteller.getState().assignRole(id, "chef");
  storyteller.getState().setStatus(id, "poisoned", true);
  storyteller.getState().addReminder(id, { id: "r1", label: "Secret reminder", lifetime: { kind: "manual" } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Storyteller privacy mode", () => {
  it("conceals token identity and effects while preserving the current game", () => {
    const view = render(<GameScreen />);
    expect(screen.getAllByText("Chef").length).toBeGreaterThan(0);
    // Phase 10B: the indicator artwork is decorative; the token's own
    // accessible name states the Effect in words.
    expect(document.querySelector('[data-effect-indicator="poisoned"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /Alice, seat 1, .*Poisoned/ })).toBeInTheDocument();
    expect(screen.getByText("Secret reminder")).toBeInTheDocument();
    const before = structuredClone(storyteller.getState().game);

    fireEvent.click(screen.getByRole("button", { name: "Enable Privacy Mode" }));

    expect(screen.getByRole("button", { name: "Disable Privacy Mode" })).toHaveTextContent("Privacy Mode On");
    expect(screen.queryByText("Chef")).toBeNull();
    expect(document.querySelector("[data-effect-indicator]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Poisoned/ })).toBeNull();
    expect(screen.queryByText("Secret reminder")).toBeNull();
    expect(screen.getByText("role hidden")).toBeInTheDocument();
    expect(storyteller.getState().game).toEqual(before);

    view.unmount();
    render(<GameScreen />);
    expect(screen.getByRole("button", { name: "Disable Privacy Mode" })).toBeInTheDocument();

    const seat = storyteller.getState().game!.seatOrder[0]!;
    storyteller.getState().removeReminder(seat, "r1");
    storyteller.getState().addReminder(seat, { id: "r2", label: "Updated while hidden", lifetime: { kind: "manual" } });
    expect(screen.queryByText("Updated while hidden")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disable Privacy Mode" }));
    expect(screen.getByText("Updated while hidden")).toBeInTheDocument();
    expect(screen.getAllByText("Chef").length).toBeGreaterThan(0);
  });
});
