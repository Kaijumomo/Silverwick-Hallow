// The Deal card (Role Dealing design), rendered through the real App shell, offline. Nothing here reaches Firebase.
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
const clickAsync = async (name: string | RegExp) => { await act(async () => { click(name); }); };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null, joined: [], presence: "unknown", status: "idle" });
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], localSeq: 0, sync: null, selectedPlayerId: null });
  useV6Ui.getState().reset();
  useSetupFlow.getState().set({ busy: false, lobby: "idle", notice: null, gathered: false, queueOpen: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function toDistribute() {
  render(<App />);
  click(/New game/);
  click(/Trouble Brewing/);
  for (let i = 0; i < 5; i++) click("One fewer player");
  click(/Fabled & Loric ›/);
  await clickAsync(/Skip to the town/);
  click("In person");
  for (const name of ["Ada", "Bram", "Cleo", "Dmitri", "Elspeth"]) {
    fireEvent.change(screen.getByPlaceholderText(/Name for seat|Add another player/), { target: { value: name } });
    click("Name seat");
  }
  fireEvent.click(screen.getAllByRole("button", { name: "Deal roles" })[0]!);
  for (const role of ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"]) fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${role}`) }));
}

describe("The Deal card", () => {
  it("Place one by one opens the card; tokens go to seats and show on the board; Seal deals exactly that draft", async () => {
    await toDistribute();
    expect(screen.getByRole("button", { name: /Deal randomly to 5 players/ })).toBeInTheDocument();
    click("Place one by one");
    expect(screen.getByRole("dialog", { name: "The Deal" })).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();
    expect(screen.getByText("5 left to deal")).toBeInTheDocument();
    expect(screen.getByText("awaiting a token")).toBeInTheDocument();
    expect(screen.getByText("Draw a token from the bag")).toBeInTheDocument();
    expect(screen.queryByText("Prepare the town")).toBeNull();
    expect(state().game!.setupRolesDealt).not.toBe(true);

    // Ada draws the Imp; Bram is up next. The board shows the draft at Ada's seat.
    click("Give Imp to Ada");
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Give Chef to Bram" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Seat 1, Ada, Imp/ })).toBeInTheDocument();
    expect(state().game!.setupRolesDealt).not.toBe(true);

    // The seat can be changed from the board.
    fireEvent.keyDown(screen.getByRole("button", { name: /Seat 4, Dmitri/ }), { key: "Enter" });
    expect(screen.getByRole("button", { name: "Give Chef to Dmitri" })).toBeInTheDocument();
    click("Give Chef to Dmitri");

    // The seal waits until every player holds a token.
    expect(screen.getByText("3 left to deal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shuffle the rest" }));
    expect(screen.queryByText("Shuffle the rest")).toBeNull();
    await clickAsync("Seal the Grimoire");
    expect(state().game!.setupRolesDealt).toBe(true);
    const g = state().game!;
    expect(g.players[g.seatOrder[0]!]!.actualRole).toBe("imp");
    expect(g.players[g.seatOrder[3]!]!.actualRole).toBe("chef");
    expect(g.seatOrder.map((id) => g.players[id]!.actualRole).sort()).toEqual(["chef", "empath", "imp", "poisoner", "washerwoman"]);
    expect(screen.queryByRole("dialog", { name: "The Deal" })).toBeNull();
    expect(useV6Ui.getState().deal).toBeNull();
  });

  it("‹ Composition goes back to Distribute Roles with the same bag and deals nothing", async () => {
    await toDistribute();
    click("Place one by one");
    click("Give Imp to Ada");
    click(/Composition/);
    expect(screen.getByText("Distribute Roles")).toBeInTheDocument();
    expect(useV6Ui.getState().pickSel).toHaveLength(5);
    expect(state().game!.setupRolesDealt).not.toBe(true);
  });

  it("Hide tokens hides the card and every dealt token, and showing them again restores the draft", async () => {
    await toDistribute();
    click("Place one by one");
    click("Give Imp to Ada");
    expect(screen.getByRole("button", { name: /Seat 1, Ada, Imp/ })).toBeInTheDocument();
    act(() => { usePrivacyStore.setState({ enabled: true }); });
    expect(screen.queryByRole("dialog", { name: "The Deal" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Imp/ })).toBeNull();
    expect(screen.queryByText("Give Chef to Bram")).toBeNull();
    act(() => { usePrivacyStore.setState({ enabled: false }); });
    expect(screen.getByRole("dialog", { name: "The Deal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Seat 1, Ada, Imp/ })).toBeInTheDocument();
  });
});
