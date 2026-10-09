import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PopoverReminders } from "@/features/players/PopoverReminders";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { proofGame, proofScript } from "@/test/proofFixtures";

const game = () => store.getState().game!;
function View() { const value = store(s => s.game)!; return <PopoverReminders player={value.players.p1!} />; }
const tap = () => fireEvent.click(screen.getByRole("button", { name: "Remove Poisoned reminder" }));
beforeEach(() => {
  vi.useFakeTimers();
  const value = proofGame(["poisoner", "chef"]);
  value.players.p1!.reminders = [{ id: "note", label: "Poisoned", sourceCharacter: "poisoner" }];
  store.setState({ game: value, lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  usePrivacyStore.setState({ enabled: false }); useSessionRuntime.setState({ backend: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("arms without a write, silently expires at three seconds, then requires two new taps", () => {
  render(<View />); const before = game(); tap();
  expect(game()).toBe(before); expect(screen.getByText("Tap to remove")).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove Poisoned reminder" })).toHaveAttribute("data-removal-armed", "true");
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.queryByText("Tap to remove")).toBeNull(); expect(game()).toBe(before);
  tap(); expect(game()).toBe(before); tap();
  expect(game().players.p1!.reminders).toEqual([]); expect(store.getState().undoStack).toHaveLength(1);
  expect(game().players.p1!.effects).toEqual([]);
  act(() => store.getState().undo()); expect(game().players.p1!.reminders[0]?.id).toBe("note");
});
it.each(["privacy", "state"] as const)("discards an armed removal after %s changes", kind => {
  render(<View />); tap();
  if (kind === "privacy") {
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(screen.queryByText("Tap to remove")).toBeNull();
    act(() => usePrivacyStore.setState({ enabled: false }));
  } else act(() => store.setState({ game: { ...game(), notes: "changed" } }));
  tap(); expect(game().players.p1!.reminders).toHaveLength(1);
  expect(store.getState().undoStack).toHaveLength(0);
});
