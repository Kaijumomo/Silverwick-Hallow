import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { setupGame, setupScript } from "@/test/setupFixtures";

const state = () => store.getState();
const game = () => state().game!;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.getState().reset(); useShellStore.getState().reset();
  useSessionRuntime.setState({ backend: null, leaveRequests: {}, online: {}, pending: 0 });
  store.setState({ game: setupGame(["empath", "monk", "imp", "chef", "poisoner"], { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true }),
    lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
  expect(state().recordInformationDelivery("p0", "empath-other-night", [{ requirementId: "evilNeighbors", kind: "number", value: 1 }]).ok).toBe(true);
  expect(state().recordInformationDelivery("p0", "empath-other-night", [{ requirementId: "evilNeighbors", kind: "number", value: 2 }]).ok).toBe(true);
  expect(state().recordDeath("p3").ok).toBe(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const openRecords = () => {
  fireEvent.click(screen.getByRole("button", { name: "Info" }));
  fireEvent.click(screen.getByRole("button", { name: "Correct information records" }));
  return within(screen.getByRole("dialog", { name: "Information records" }));
};

describe("contextual information record recovery", () => {
  it("removes an older mistaken record from Info without undoing a later death or delivery", () => {
    render(<GameScreen />);
    expect(screen.queryByRole("button", { name: "Activity" })).toBeNull();
    const before = structuredClone(game());
    const records = openRecords();
    expect(records.getByRole("combobox", { name: "Filter by kind" })).toHaveValue("information");
    fireEvent.change(records.getByRole("combobox", { name: "Filter by participant" }), { target: { value: `p:${game().players.p0!.participantId}` } });
    const older = document.querySelector(`[data-activity-source="delivery"]`)!;
    fireEvent.click(within(older as HTMLElement).getByRole("button", { name: /Remove the record/ }));
    expect(records.getByText(/does not undo or unsay/)).toBeInTheDocument();
    fireEvent.click(records.getByRole("button", { name: "Remove record" }));
    expect(game().informationDeliveries).toEqual([before.informationDeliveries[1]]);
    expect(game().players).toEqual(before.players);
    expect(game().history).toEqual(before.history);
    expect(game().lifeEventWindow).toEqual(before.lifeEventWindow);
  });

  it("removes records from the private DOM on privacy activation and does not reopen them", () => {
    render(<GameScreen />); openRecords();
    const before = game();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("dialog", { name: "Information records" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove the record/ })).toBeNull();
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.queryByRole("dialog", { name: "Information records" })).toBeNull();
    expect(game()).toBe(before);
  });

  it("removes mutation controls when closure authority locks an already-open record review", () => {
    render(<GameScreen />); openRecords();
    const before = game();
    act(() => { state().beginTerminalClose({ kind: "declare", winner: "good" }); });
    expect(screen.queryByRole("button", { name: /Remove the record/ })).toBeNull();
    expect(game()).toBe(before);
  });
});
