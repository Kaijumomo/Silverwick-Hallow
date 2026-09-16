import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
  // standardRoles(6) includes exactly one concealed role (Drunk, the single
  // outsider slot), giving a real dealt pool that exercises the reveal
  // boundary against one unresolved and several already-ready players.
  store.getState().newGame(setupScript.id, { plannedPlayerCount: 6, plannedRoles: standardRoles(6) });
  for (let i = 0; i < 6; i++) store.getState().addPlayerToSeat("Player " + i);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const openSetup = () => fireEvent.click(screen.getByRole("button", { name: "setup" }));
const drunkId = () => Object.values(store.getState().game!.players).find(p => p.actualRole === "drunk")!.id;

describe("Q. Minimal Setup UI after Deal, before Reveal", () => {
  it("shows a compact readiness status, disables Reveal Roles, and marks only the unresolved token", () => {
    act(() => { store.getState().dealRolePool(); });
    render(<GameScreen />);
    openSetup();

    expect(screen.getByText("Roles dealt privately · 5/6 ready")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reveal Roles" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Begin Night 1" })).toBeNull();

    // Exactly one token carries the indicator -- the unresolved Drunk.
    expect(screen.getAllByText("Needs shown role")).toHaveLength(1);
  });

  it("the token indicator disappears immediately once that player's shown identity becomes ready", () => {
    act(() => { store.getState().dealRolePool(); });
    render(<GameScreen />);
    openSetup();
    expect(screen.getAllByText("Needs shown role")).toHaveLength(1);

    act(() => { store.getState().setShownRole(drunkId(), "chef"); });

    expect(screen.queryByText("Needs shown role")).toBeNull();
    expect(screen.getByText("6/6 ready to reveal")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reveal Roles" })).toBeEnabled();
  });
});

describe("H. Night 1 requires both Deal and explicit Reveal", () => {
  it("Deal alone never unlocks Begin Night 1; Reveal Roles completes the path to it", () => {
    act(() => { store.getState().dealRolePool(); store.getState().setShownRole(drunkId(), "chef"); });
    render(<GameScreen />);
    openSetup();

    expect(screen.queryByRole("button", { name: "Begin Night 1" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reveal Roles" }));
    expect(store.getState().game!.setupRolesRevealed).toBe(true);
    expect(screen.getByText("Roles revealed")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Begin Night 1" }));
    expect(store.getState().game!.phase).toBe("night");
  });
});
