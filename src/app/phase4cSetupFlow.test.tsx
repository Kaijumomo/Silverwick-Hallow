// Package 4C: Home v6 -> New Game -> script -> Fabled & Loric -> Prepare the town -> seat -> distribute -> reveal ->
// Begin Night 1, rendered through the real App shell, offline. Nothing here reaches Firebase.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { useSetupFlow } from "@/features/grimoire-v6/setup/flow";

vi.mock("@/firebase/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/config")>();
  return { ...actual, isFirebaseConfigured: () => false };
});

const state = () => store.getState();
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const home = () => expect(screen.getByText(/A Blood on the Clocktower companion/)).toBeInTheDocument();
const clickAsync = async (name: string | RegExp) => { await act(async () => { click(name); }); };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null, joined: [], presence: "unknown", status: "idle" });
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], localSeq: 0, sync: null, selectedPlayerId: null });
  useV6Ui.getState().set({ wiz: null, picker: null, seatMode: false, prepEdit: null, panel: null });
  useSetupFlow.getState().set({ busy: false, lobby: "idle", notice: null, gathered: false, queueOpen: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Home v6 routing", () => {
  it("shows Home with no Resume row while no game exists, and New game opens the wizard in the Grimoire", () => {
    render(<App />);
    home();
    expect(screen.queryByText("Resume game")).toBeNull();
    click(/New game/);
    expect(state().view).toBe("newgame");
    expect(useV6Ui.getState().wiz?.step).toBe("script");
    expect(screen.getByText("Choose a script")).toBeInTheDocument();
    expect(screen.queryByText("Resume game")).toBeNull();
  });

  it("offers Resume for a game in progress, a review row for a finished one, and clears the wizard", () => {
    store.getState().newGame("tb", { plannedPlayerCount: 5, keepView: true });
    store.setState({ view: "home" });
    useV6Ui.getState().set({ wiz: { step: "town", script: "tb", customName: null, count: 5, extras: [], focus: null, xtab: "fabled" } });
    render(<App />);
    expect(screen.getByText("Resume game")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Resume game"));
    expect(state().view).toBe("game");
    expect(useV6Ui.getState().wiz).toBeNull();
  });

  it("returns to Home when the wizard's Home button is pressed", () => {
    render(<App />);
    click(/New game/);
    click(/‹ Home/);
    expect(state().view).toBe("home");
    home();
  });

  it("falls back to Home instead of an empty screen when the view is a game that no longer exists", () => {
    store.setState({ view: "game", game: null });
    render(<App />);
    home();
  });
});

describe("offline New Game flow in the unified Grimoire", () => {
  it("Home -> script -> extras -> Prepare the town -> seat -> distribute -> reveal -> Begin Night 1", async () => {
    render(<App />);
    click(/New game/);
    click(/Trouble Brewing/);
    for (let i = 0; i < 5; i++) click("One fewer player");
    expect(useV6Ui.getState().wiz!.count).toBe(5);
    click(/Fabled & Loric ›/);
    await clickAsync(/Skip to the town/);
    expect(state().game!.phase).toBe("setup");
    expect(state().lobby).toBeNull(); // Offline stays offline: no lobby is created
    click("In person");
    for (const name of ["Ada", "Bram", "Cleo", "Dmitri", "Elspeth"]) {
      fireEvent.change(screen.getByPlaceholderText(/Name for seat|Add another player/), { target: { value: name } });
      click("Name seat");
    }
    await clickAsync("Begin the night");
    const seated = Object.values(state().game!.players).filter((p) => !p.isEmpty);
    expect(seated.length).toBeGreaterThanOrEqual(5);
    expect(state().game!.seatOrder.map((id) => state().game!.players[id]!.name).slice(0, 5)).toEqual(["Ada", "Bram", "Cleo", "Dmitri", "Elspeth"]);
    expect(state().game!.phase).toBe("setup"); // entering the Grimoire does not start Night 1

    // Initial role distribution is Setup-only: the dock offers it, the picker deals the staged pool.
    fireEvent.click(screen.getAllByRole("button", { name: "Deal roles" })[0]!);
    expect(screen.getByText("Distribute Roles")).toBeInTheDocument();
    for (const role of ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${role}`) }));
    }
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Distribute to/ })); });
    expect(state().game!.setupRolesDealt).toBe(true);
    expect(Object.values(state().game!.players).filter((p) => !p.isEmpty).map((p) => p.actualRole).sort())
      .toEqual(["chef", "empath", "imp", "poisoner", "washerwoman"]);

    // Reveal, then Begin Night 1 from the dock: the Grimoire never starts the night by itself.
    expect(state().game!.phase).toBe("setup");
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Reveal roles" }).at(-1)!); });
    expect(state().game!.setupRolesRevealed).toBe(true);
    expect(state().game!.phase).toBe("setup");
    await clickAsync("Begin Night 1");
    expect(state().game!.phase).toBe("night");
    expect(state().game!.day).toBe(1);
  });
});
