import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";

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
  storyteller.getState().addReminder(id, { id: "r1", label: "Secret reminder" });
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
    storyteller.getState().addReminder(seat, { id: "r2", label: "Updated while hidden" });
    expect(screen.queryByText("Updated while hidden")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disable Privacy Mode" }));
    expect(screen.getByText("Updated while hidden")).toBeInTheDocument();
    expect(screen.getAllByText("Chef").length).toBeGreaterThan(0);
  });
});

// Phase 10D (CLOSURE-03): the Almanac lists the script's characters and the
// Traveler catalogue as Role resolution defines them -- one entry per RoleId,
// the canonical Traveler over a legacy script's homebrew definition of the id.
describe("CLOSURE-03: the Almanac follows canonical Traveler precedence", () => {
  it("a legacy script whose FIRST 'thief' is a homebrew Demon lists ONE Thief -- the canonical Traveler", () => {
    const legacy = { id: "legacy-thief", name: "Legacy", characters: [
      { id: "thief", name: "Homebrew Thief", type: "demon" as const, ability: "Homebrew Demon." },
      ...troubleBrewing.characters,
    ] };
    storyteller.setState({ game: null, lobby: null, undoStack: [], customScripts: { [legacy.id]: legacy } });
    storyteller.getState().newGame(legacy.id);
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Almanac" }));
    const almanac = within(screen.getByRole("dialog"));
    expect(almanac.queryByText("Homebrew Thief")).toBeNull();
    const thieves = almanac.getAllByText("Thief", { selector: ".almanac-name" });
    expect(thieves).toHaveLength(1);
    expect(thieves[0]).toHaveClass("type-traveler");
    expect(almanac.getAllByText("Chef", { selector: ".almanac-name" })).toHaveLength(1);
  });
});
