import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { canonicalRoles } from "@/data/canonical";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { setupGame } from "@/test/setupFixtures";
import { PlayersWorkspace } from "./PlayersWorkspace";
import { usePlayersInteraction } from "./PlayersInteraction";
import type { StorytellerLobbyRecord } from "@/stores/types";

const assigned = ["chef", "washerwoman", "empath", "poisoner", "imp"];
const script = { id: "players-workspace-test", name: "Trouble Brewing", characters: canonicalRoles([...assigned, "librarian", "baron", "saint", "drunk"]) };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useShellStore.getState().reset();
  const game = setupGame(assigned, { scriptId: script.id, setupRolesDealt: true, setupRolesRevealed: false });
  store.setState({ game, lobby: null, undoStack: [], selectedPlayerId: null, customScripts: { [script.id]: script }, tokenPositions: {}, grimoireMode: "ring" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function TestBoard() {
  const interaction = usePlayersInteraction();
  return <div>Board<button onClick={() => interaction?.tap("p1")}>Tap second token</button></div>;
}
function workspace() {
  return render(<PlayersWorkspace enabled roles={script.characters} onMore={vi.fn()} advancedPlayerId={null}><TestBoard /></PlayersWorkspace>);
}
function openPlayers() { fireEvent.click(screen.getByRole("button", { name: "Players" })); }
function chooseForFirst() {
  act(() => store.getState().selectPlayer("p0"));
  fireEvent.click(screen.getAllByRole("button", { name: "Change character" })[0]!);
}
function setGame(patch: Partial<StorytellerLobbyRecord>) { store.setState({ game: { ...store.getState().game!, ...patch } }); }

describe("Players workspace integration", () => {
  it("opens Distribute Roles for a genuinely new game before any reserved seats are filled", () => {
    store.getState().newGame(script.id, { plannedPlayerCount: 5 });
    const before = store.getState().game;
    workspace(); openPlayers();
    const open = screen.getByRole("button", { name: "Distribute Roles" });
    expect(open).toBeEnabled();
    fireEvent.click(open);
    expect(screen.getByRole("dialog", { name: "Distribute Roles" })).toBeVisible();
    expect(screen.getByText("Trouble Brewing · 5 residents · 0 travelers")).toBeVisible();
    // Recipient readiness guards the final deal, never the opening button.
    expect(screen.getByRole("button", { name: "Distribute to 0 residents" })).toBeDisabled();
    expect(store.getState().game).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("opens and completes distribution from a new game populated through the actual seating actions", () => {
    store.getState().newGame(script.id, { plannedPlayerCount: 5 });
    for (const name of ["Ada", "Bram", "Cleo", "Dmitri", "Elspeth"]) store.getState().addPlayerToSeat(name);
    const before = store.getState().game!;
    const undoCount = store.getState().undoStack.length;
    workspace(); openPlayers();
    fireEvent.click(screen.getByRole("button", { name: "Distribute Roles" }));
    expect(screen.getByRole("dialog", { name: "Distribute Roles" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Distribute to 5 residents" })).toBeDisabled();
    for (const name of ["Chef", "Washerwoman", "Empath", "Poisoner", "Imp"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name: "Distribute to 5 residents" })).toBeEnabled();
    expect(store.getState().game).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Distribute to 5 residents" }));
    expect(screen.queryByRole("dialog", { name: "Distribute Roles" })).not.toBeInTheDocument();
    expect(Object.values(store.getState().game!.players).map(player => player.actualRole).sort()).toEqual([...assigned].sort());
    expect(store.getState().game).toMatchObject({ setupRolesDealt: true, setupRolesRevealed: false, phase: "setup" });
    expect(store.getState().undoStack).toHaveLength(undoCount + 1);
  });

  it("cancels an edited distribution draft without changing assignments, game state or Undo", () => {
    const before = store.getState().game;
    workspace(); openPlayers();
    fireEvent.click(screen.getByRole("button", { name: "Distribute Roles" }));
    fireEvent.click(screen.getByRole("button", { name: "Chef" }));
    fireEvent.click(screen.getByRole("button", { name: "Librarian" }));
    fireEvent.click(screen.getByRole("button", { name: "Close character chooser" }));
    expect(store.getState().game).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exchanges occupied characters only during private setup, preserving seats and participant identities", () => {
    const before = store.getState().game!;
    workspace(); chooseForFirst();
    fireEvent.click(screen.getByRole("button", { name: "Washerwoman, in use by Player 1" }));
    const after = store.getState().game!;
    expect(after.players.p0!.actualRole).toBe("washerwoman");
    expect(after.players.p1!.actualRole).toBe("chef");
    expect(after.seatOrder).toEqual(before.seatOrder);
    for (const id of before.seatOrder) {
      expect(after.players[id]!.participantId).toBe(before.players[id]!.participantId);
      expect(after.players[id]!.seat).toBe(before.players[id]!.seat);
    }
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("changes only the selected player's actual character during play, without silently changing shown identity", () => {
    setGame({ phase: "day", day: 1, setupRolesRevealed: true });
    const before = store.getState().game!;
    workspace(); chooseForFirst();
    fireEvent.click(screen.getByRole("button", { name: "Washerwoman, in use by Player 1" }));
    const after = store.getState().game!;
    expect(after.players.p0!.actualRole).toBe("washerwoman");
    expect(after.players.p0!.shownRole).toBe(before.players.p0!.shownRole);
    for (const id of before.seatOrder.slice(1)) expect(after.players[id]).toEqual(before.players[id]);
    expect(after.seatOrder).toEqual(before.seatOrder);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("refuses ordinary assignment changes after Reveal and before Night 1", () => {
    setGame({ setupRolesRevealed: true });
    const before = store.getState().game;
    workspace(); chooseForFirst();
    fireEvent.click(screen.getByRole("button", { name: "Washerwoman, in use by Player 1" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/revealed setup is locked/);
    expect(store.getState().game).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("refuses a chooser opened for an occupant who has since been replaced", () => {
    workspace(); chooseForFirst();
    const before = store.getState().game!;
    act(() => setGame({ players: { ...before.players, p0: { ...before.players.p0!, participantId: "new-participant", name: "Replacement" } } }));
    const replacement = store.getState().game;
    fireEvent.click(screen.getByRole("button", { name: "Librarian" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The game changed");
    expect(store.getState().game).toBe(replacement);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("closes private chooser content under Privacy and does not reopen the popover afterward", () => {
    workspace(); chooseForFirst();
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Chef");
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(store.getState().selectedPlayerId).toBeNull();
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("keeps one supporting panel and preserves pinning when switching tabs", () => {
    const view = workspace(); openPlayers();
    fireEvent.click(screen.getByRole("button", { name: "Pin Players panel" }));
    expect(view.container.querySelector(".reference-workspace")).toHaveAttribute("data-reference-pinned");
    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    expect(screen.getByRole("complementary", { name: "Reference" })).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "Players" })).not.toBeInTheDocument();
    expect(view.container.querySelector(".reference-workspace")).toHaveAttribute("data-reference-pinned");
    fireEvent.click(screen.getByRole("button", { name: "Players" }));
    expect(screen.getByRole("button", { name: "Unpin Players panel" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close Players panel" }));
    expect(view.container.querySelector(".reference-workspace")).not.toHaveAttribute("data-reference-pinned");
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("swaps seat positions through the board while every participant keeps their character and reminders", () => {
    setGame({ phase: "day", day: 1, setupRolesRevealed: true });
    const before = store.getState().game!;
    workspace();
    act(() => store.getState().selectPlayer("p0"));
    fireEvent.click(screen.getByRole("button", { name: "Swap seats" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/Tap another token to swap seats with Player 0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tap second token" }));
    const after = store.getState().game!;
    expect(after.seatOrder.slice(0, 2)).toEqual(["p1", "p0"]);
    for (const id of before.seatOrder) {
      const { seat: _beforeSeat, ...beforePlayer } = before.players[id]!;
      const { seat: _afterSeat, ...afterPlayer } = after.players[id]!;
      expect(afterPlayer).toEqual(beforePlayer);
    }
    expect(store.getState().undoStack).toHaveLength(1);
    act(() => store.getState().undo());
    expect(store.getState().game!.seatOrder).toEqual(before.seatOrder);
  });

  it("cancels seat selection from the touch prompt without mutating the game", () => {
    const before = store.getState().game;
    workspace();
    act(() => store.getState().selectPlayer("p0"));
    fireEvent.click(screen.getByRole("button", { name: "Swap seats" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Tap another token to swap seats/)).not.toBeInTheDocument();
    expect(store.getState().game).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });
});
