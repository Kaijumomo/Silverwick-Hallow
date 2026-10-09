import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { InfoPresentationBoundary, useShowPlayerPresentation } from "./InfoPresentationBoundary";
import { PlayersWorkspace } from "@/features/players/PlayersWorkspace";

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ status: "idle", backend: null });
  store.setState({ game: setupGame(["drunk", "imp"], { phase: "day", day: 2 }), lobby: null,
    terminalClose: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
});
afterEach(cleanup);
const player = () => store.getState().game!.players.p0!;
const open = () => renderHook(useShowPlayerPresentation, { wrapper: ({ children }) =>
  <InfoPresentationBoundary><main data-testid="private-board">Secret grimoire{children}</main></InfoPresentationBoundary> });

describe("Show player presentation", () => {
  it("opens from the actual popup, dismisses it, and returns keyboard focus to the selected grimoire token", () => {
    store.setState({ selectedPlayerId: "p0" });
    const before = store.getState().game, undo = store.getState().undoStack;
    render(<PlayersWorkspace enabled roles={setupScript.characters} onMore={() => {}} advancedPlayerId={null}>
      <main className="grimoire"><button className="token" data-player-id="p0">Player token</button></main>
    </PlayersWorkspace>);
    fireEvent.click(screen.getByRole("button", { name: "Show player" }));
    expect(screen.getByRole("dialog", { name: "You Are" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Close player details" })).toBeNull();
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Washerwoman" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Return to Grimoire" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Player token" })).toHaveFocus();
    expect(store.getState().game).toBe(before); expect(store.getState().undoStack).toBe(undo);
  });
  it("shows only the shown identity and leaves game, Undo, deliveries and initial reveal unchanged", () => {
    const before = store.getState().game, undo = store.getState().undoStack;
    const { result } = open();
    act(() => { expect(result.current(player())).toBeUndefined(); });
    const dialog = screen.getByRole("dialog", { name: "You Are" });
    expect(within(dialog).getByRole("heading", { name: "Washerwoman" })).toBeVisible();
    expect(within(dialog).queryByText(/Drunk|Player 0|shown|actual/i)).toBeNull();
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByTestId("private-board").closest("[inert]")).toBeTruthy();
    expect(store.getState().game).toBe(before); expect(store.getState().undoStack).toBe(undo);
  });
  it.each(["", "unresolved-character"])("never falls back to actual identity for shown role %s", shownRole => {
    const game = store.getState().game!;
    store.setState({ game: { ...game, players: { ...game.players, p0: { ...player(), shownRole } } } });
    const { result } = open();
    act(() => { expect(result.current(player())).toMatch(/shown character/); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("resolves a Traveler shown character using the owned role registry", () => {
    const game = store.getState().game!;
    store.setState({ game: { ...game, players: { ...game.players, p0: { ...player(), isTraveler: true, actualRole: "bureaucrat", shownRole: "bureaucrat" } } } });
    const { result } = open();
    act(() => { expect(result.current(player())).toBeUndefined(); });
    expect(within(screen.getByRole("dialog", { name: "You Are" })).getByRole("heading", { name: "Bureaucrat" })).toBeVisible();
  });
  it.each(["replacement", "privacy", "writer", "closing"])("refuses a stale callback after %s changes", change => {
    const { result } = open(), original = player(), callback = result.current;
    act(() => {
      const game = store.getState().game!;
      if (change === "replacement") store.setState({ game: { ...game, players: { ...game.players, p0: { ...original, participantId: "new-person" } } } });
      if (change === "privacy") usePrivacyStore.setState({ enabled: true });
      if (change === "writer") store.setState({ lobby: { code: "CHANGED" } as NonNullable<ReturnType<typeof store.getState>["lobby"]> });
      if (change === "closing") store.setState({ terminalClose: { status: "closing" } as NonNullable<ReturnType<typeof store.getState>["terminalClose"]> });
      expect(callback(original)).toMatch(/changed/);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps the board covered and removes shown identity when the participant changes after opening", () => {
    const { result } = open(); act(() => { result.current(player()); });
    act(() => {
      const game = store.getState().game!;
      store.setState({ game: { ...game, players: { ...game.players, p0: { ...player(), participantId: "replacement" } } } });
    });
    expect(screen.getByRole("dialog", { name: "Information changed" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Washerwoman" })).toBeNull();
    expect(screen.getByTestId("private-board").closest("[inert]")).toBeTruthy();
  });
});
