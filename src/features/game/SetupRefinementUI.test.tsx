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
  // standardRoles(5) has no concealed role, so identity readiness never
  // interferes with these refinement-focused proofs.
  store.getState().newGame(setupScript.id, { plannedPlayerCount: 5, plannedRoles: standardRoles(5) });
  for (let i = 0; i < 5; i++) store.getState().addPlayerToSeat("Player " + i);
  act(() => { store.getState().dealRolePool(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const openSetup = () => fireEvent.click(screen.getByRole("button", { name: "setup" }));
const seatOrder = () => store.getState().game!.seatOrder;
const rolesInSeatOrder = () => seatOrder().map(id => store.getState().game!.players[id]!.actualRole);

describe("Setup refinement UI (Phase 9 Setup finalization B3)", () => {
  it("shows Shuffle Roles and Edit Bag after Deal, before Reveal", () => {
    render(<GameScreen />);
    openSetup();
    expect(screen.getByRole("button", { name: "Shuffle Roles" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit Bag" })).toBeVisible();
  });

  it("Shuffle Roles redistributes the same characters under controlled RNG, without revealing", () => {
    render(<GameScreen />);
    openSetup();
    const before = [...rolesInSeatOrder()];

    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try { fireEvent.click(screen.getByRole("button", { name: "Shuffle Roles" })); }
    finally { random.mockRestore(); }

    const after = rolesInSeatOrder();
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
    expect(store.getState().game!.setupRolesRevealed).toBe(false);
  });

  it("Edit Bag stages changes locally and only Apply commits them", () => {
    render(<GameScreen />);
    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Edit Bag" }));
    expect(screen.getByText("Edit bag")).toBeVisible();

    // The current bag's Poisoner tile starts selected; deselecting it drops
    // the staged count below the ordinary population, disabling Apply.
    fireEvent.click(screen.getByRole("button", { name: "Poisoner" }));
    expect(screen.getByRole("button", { name: "Apply Bag Changes" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Baron" }));
    expect(screen.getByRole("button", { name: "Apply Bag Changes" })).toBeEnabled();

    const before = [...rolesInSeatOrder()];
    fireEvent.click(screen.getByRole("button", { name: "Apply Bag Changes" }));

    expect(screen.queryByText("Edit bag")).toBeNull(); // panel closes on success
    expect(rolesInSeatOrder()).not.toContain("poisoner");
    expect(rolesInSeatOrder()).toContain("baron");
    // Exactly the Poisoner holder changed.
    const changed = before.filter((r, i) => r !== rolesInSeatOrder()[i]);
    expect(changed).toEqual(["poisoner"]);
  });

  it("Cancel discards staged Edit Bag changes without mutating the live assignment", () => {
    render(<GameScreen />);
    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Edit Bag" }));
    const before = [...rolesInSeatOrder()];

    fireEvent.click(screen.getByRole("button", { name: "Poisoner" }));
    fireEvent.click(screen.getByRole("button", { name: "Baron" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Edit bag")).toBeNull();
    expect(rolesInSeatOrder()).toEqual(before);
  });

  it("Shuffle Roles and Edit Bag disappear once Reveal has completed", () => {
    render(<GameScreen />);
    openSetup();
    fireEvent.click(screen.getByRole("button", { name: "Reveal Roles" }));
    expect(store.getState().game!.setupRolesRevealed).toBe(true);

    expect(screen.queryByRole("button", { name: "Shuffle Roles" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Bag" })).toBeNull();
  });
});
