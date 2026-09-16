import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript } from "@/test/setupFixtures";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
  store.getState().newGame(setupScript.id, { plannedPlayerCount: 5 });
  for (let i = 0; i < 5; i++) store.getState().addPlayerToSeat("Player " + i);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const openSetup = () => fireEvent.click(screen.getByRole("button", { name: "setup" }));
const closeSetup = () => fireEvent.click(screen.getByRole("button", { name: "Close setup panel" }));

describe("D. Setup does not auto-open", () => {
  it("entering the Grimoire shows neither the Setup workspace nor a required action -- Go Live and Setup are both merely available", () => {
    render(<GameScreen />);
    expect(screen.queryByRole("complementary", { name: "Setup helper" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
    expect(screen.getByRole("button", { name: "setup" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Go live" })).toBeVisible();
  });
});

describe("E/F. Setup and Go Live work in either order, neither a prerequisite for the other", () => {
  it("Setup can be opened, filled, and edited entirely before any lobby exists", () => {
    render(<GameScreen />);
    expect(store.getState().lobby).toBeNull();
    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Choose roles" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" }));
    expect(store.getState().game!.rolePool.length).toBeGreaterThan(0);
    expect(store.getState().lobby).toBeNull();
  });

  it("Go Live remains available with an empty, unbuilt bag, and Setup can still be opened afterward", () => {
    render(<GameScreen />);
    expect(store.getState().game!.rolePool).toEqual([]);
    expect(screen.getByRole("button", { name: "Go live" })).toBeEnabled();
    // The createLobby/Firebase session plumbing is covered by its own tests;
    // GameScreen's Setup state reads only `game` and `script`, never
    // `lobby`, so establishing a live lobby directly proves the same
    // independence without re-testing the connect flow here.
    act(() => { store.getState().setLobby({ code: "ABCD1234", uid: "st", status: "live" }); });
    expect(store.getState().game!.rolePool).toEqual([]);
    openSetup();
    expect(screen.getByRole("button", { name: "Choose roles" })).toBeVisible();
  });
});

describe("G/H. Go Live preserves Setup state, and live bag edits preserve the lobby", () => {
  it("a partially built bag, Fabled, and Lorics survive Go Live untouched", () => {
    render(<GameScreen />);
    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Choose roles" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" }));
    fireEvent.click(screen.getByText("Fabled & Lorics"));
    fireEvent.click(screen.getByRole("button", { name: "Toymaker" }));
    fireEvent.click(screen.getByRole("button", { name: "Storm Catcher" }));

    const poolBefore = [...store.getState().game!.rolePool];
    const fabledBefore = [...store.getState().game!.fabled];
    const loricsBefore = [...store.getState().game!.lorics];
    expect(poolBefore.length).toBeGreaterThan(0);

    act(() => { store.getState().setLobby({ code: "ABCD1234", uid: "st", status: "live" }); });

    expect(store.getState().game!.rolePool).toEqual(poolBefore);
    expect(store.getState().game!.fabled).toEqual(fabledBefore);
    expect(store.getState().game!.lorics).toEqual(loricsBefore);
    // Setup remains open and editable -- Go Live did not close it.
    expect(screen.getByRole("button", { name: "Re-roll Bag" })).toBeVisible();
  });

  it("editing the bag, Fill/Re-roll, and modifiers while live never close or recreate the lobby", () => {
    render(<GameScreen />);
    act(() => { store.getState().setLobby({ code: "ABCD1234", uid: "st", status: "live" }); });
    const before = store.getState().lobby;
    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Choose roles" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" }));
    fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" }));
    fireEvent.click(screen.getByText("Fabled & Lorics"));
    fireEvent.click(screen.getByRole("button", { name: "Toymaker" }));
    fireEvent.click(screen.getByRole("button", { name: "Toymaker" })); // toggle off again

    // Same lobby object (same code/session) -- not closed, rotated, or recreated.
    expect(store.getState().lobby).toBe(before);
    expect(store.getState().lobby).toEqual({ code: "ABCD1234", uid: "st", status: "live" });
    // The panel and its edits are still live, not torn down by any of this.
    expect(screen.getByRole("button", { name: "Re-roll Bag" })).toBeVisible();
  });
});

describe("I. Planned and seated counts are shown distinctly", () => {
  it("shows Planned and Seated separately and never collapses one into the other", () => {
    render(<GameScreen />);
    openSetup();
    expect(screen.getByLabelText("Players")).toHaveValue(5);
    expect(screen.getByText("Seated: 5")).toBeVisible();

    act(() => { store.getState().unseatPlayer(store.getState().game!.seatOrder[0]!); });
    expect(screen.getByLabelText("Players")).toHaveValue(5); // planned unchanged
    expect(screen.getByText("Seated: 4")).toBeVisible(); // seated reflects reality
  });
});

describe("M. Setup panel close/reopen preserves pinned vs. generated state", () => {
  it("a pinned role survives close and reopen, and Re-roll still protects it", () => {
    render(<GameScreen />);
    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Choose roles" }));
    fireEvent.click(screen.getByRole("button", { name: "Empath" })); // manual pin
    fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" }));
    expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");

    closeSetup();
    expect(screen.queryByRole("button", { name: "Empath" })).toBeNull();

    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Edit roles" }));
    expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" }));
    expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");
  });
});
