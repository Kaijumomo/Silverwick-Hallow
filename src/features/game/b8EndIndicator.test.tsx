import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { setupGame, setupScript } from "@/test/setupFixtures";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.getState().reset(); useShellStore.getState().reset();
  const game = setupGame(["saint", "chef", "soldier", "poisoner", "imp"], { phase: "day", day: 1, setupRolesDealt: true, setupRolesRevealed: true });
  store.setState({ game, customScripts: { [setupScript.id]: setupScript }, lobby: null, terminalClose: null, undoStack: [], selectedPlayerId: null, localSeq: 0 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("adds only the End control marker after qualification; Undo and privacy remove it without declaring a result", () => {
  render(<GameScreen />);
  expect(screen.queryByLabelText("Game-ending condition verified")).toBeNull();
  act(() => { expect(store.getState().recordExecution("p0", "died").ok).toBe(true); });
  const marker = screen.getByLabelText("Game-ending condition verified");
  expect(marker.textContent).toBe("!");
  expect(marker.closest("button")).toBe(screen.getByRole("button", { name: "End game" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(store.getState().game!.phase).toBe("day");
  expect(store.getState().game!.result).toBeUndefined();
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Game-ending condition verified")).toBeNull();
  expect(screen.getByRole("button", { name: "End game" })).not.toHaveAttribute("title");
  act(() => usePrivacyStore.getState().setEnabled(false));
  expect(screen.getByLabelText("Game-ending condition verified")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "End game" }));
  expect(screen.getByRole("dialog", { name: "End the game" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Good wins" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Evil wins" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
  act(() => { store.getState().undo(); });
  expect(screen.queryByLabelText("Game-ending condition verified")).toBeNull();
  expect(store.getState().game!.players.p0!.alive).toBe(true);
});
