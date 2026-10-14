import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PopoverReminders } from "@/features/players/PopoverReminders";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { setupGame, setupScript } from "@/test/setupFixtures";

const game = () => store.getState().game!;
function View() { const current = store(s => s.game)!; return <PopoverReminders player={current.players.p0!} />; }
beforeEach(() => {
  localStorage.clear(); usePrivacyStore.setState({ enabled: false }); useSessionRuntime.setState({ backend: null, status: "idle" });
  const value = setupGame(["drunk", "chef", "imp"], { setupRolesDealt: true }); value.players.p0!.shownRole = null;
  store.setState({ game: value, lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript } });
  store.getState().setShownRole("p0", "monk");
});
afterEach(cleanup);

it("official Drunk token removes only its notation through the existing two-tap UI and Undo restores it", () => {
  render(<View />); const before = game(); const initialUndo = store.getState().undoStack.length;
  const remove = () => fireEvent.click(screen.getByRole("button", { name: "Remove Is The Drunk reminder" }));
  remove(); expect(game()).toBe(before); expect(screen.getByText("Tap to remove")).toBeVisible();
  remove(); expect(game().players.p0!.reminders).toEqual([]);
  expect(game().players.p0).toMatchObject({ actualRole: "drunk", shownRole: "monk", effects: [] });
  expect(store.getState().undoStack).toHaveLength(initialUndo + 1);
  act(() => store.getState().undo()); expect(game().players.p0!.reminders).toEqual(before.players.p0!.reminders);
  act(() => usePrivacyStore.setState({ enabled: true })); expect(screen.queryByRole("button", { name: /Drunk/ })).toBeNull();
});
