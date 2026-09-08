import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GrimoireCircle } from "./GrimoireCircle";
import { useStorytellerStore as store } from "@/stores/storytellerStore";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  store.setState({ game: null, lobby: null, undoStack: [] });
  store.getState().newGame("tb", { plannedPlayerCount: 1 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("grimoire planned seats", () => {
  it("exposes empty seats as clear, keyboard-accessible controls", () => {
    render(<GrimoireCircle />);
    const seat = screen.getByRole("button", { name: /Empty seat 1/ });
    expect(seat).toHaveTextContent("Empty seat");
    expect(seat).toHaveAttribute("type", "button");
  });

  it("adds an explicit empty seat without changing existing seats", () => {
    render(<GrimoireCircle />);
    fireEvent.click(screen.getByRole("button", { name: "Add empty planned seat" }));
    expect(store.getState().game!.seatOrder).toHaveLength(2);
    expect(Object.values(store.getState().game!.players).filter((p) => p.isEmpty)).toHaveLength(2);
  });
});
