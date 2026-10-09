import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { ReferenceWorkspace } from "@/features/almanac/ReferenceWorkspace";
import { InfoPanel } from "./InfoPanel";

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ status: "idle", backend: null });
  store.setState({ game: setupGame(undefined, { phase: "night", day: 1 }), lobby: null, terminalClose: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
});
afterEach(cleanup);
function Workspace() {
  const privacy = usePrivacyStore(s => s.enabled);
  return <ReferenceWorkspace enabled privacyMode={privacy} roles={setupScript.characters} scriptName="Test" info={<InfoPanel />}><div data-testid="private-board">Private grimoire</div></ReferenceWorkspace>;
}
function open() { render(<Workspace/>); fireEvent.click(screen.getByRole("button", { name: "Info" })); }

describe("Info integration", () => {
  it.each(["Demon", "Minion"])("opens a visible explanation for %s Information in a six-resident game", kind => {
    store.setState({ game: setupGame(["chef", "empath", "monk", "saint", "poisoner", "imp"]) });
    open(); const before = store.getState().game, undo = store.getState().undoStack;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${kind} Information`) }));
    const dialog = screen.getByRole("dialog", { name: `${kind} Information` });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/fewer than 7 residents/i);
    expect(within(dialog).queryByText(/Player \d/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Return to Info" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.getState().game).toBe(before); expect(store.getState().undoStack).toBe(undo);
  });
  it("opens an explanation when there is no evil Traveller", () => {
    open(); fireEvent.click(screen.getByRole("button", { name: /^Evil Traveller Information/ }));
    const dialog = screen.getByRole("dialog", { name: "Evil Traveller Information" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/No living, non-exiled evil Traveller/);
    expect(within(dialog).queryByText("Player 6")).toBeNull();
  });
  it.each(["Demon", "Minion", "Evil Traveller"])("opens the player-facing %s setup information when eligible without mutations", kind => {
    const game = store.getState().game!;
    if (kind === "Evil Traveller") store.setState({ game: { ...game,
      players: { ...game.players, traveler: { ...game.players.p0!, id: "traveler", seat: 7, name: "Visitor", isTraveler: true, actualRole: "gunslinger", shownRole: "gunslinger", actualAlignment: "evil" } },
      seatOrder: [...game.seatOrder, "traveler"],
    } });
    open(); const before = store.getState().game, undo = store.getState().undoStack;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${kind} Information`) }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: kind === "Demon" ? "Your Minions" : "Your Demon", level: 2 })).toBeVisible();
    expect(within(dialog).getByText(kind === "Demon" ? "Player 5" : "Player 6")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: /Return to Grimoire/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.getState().game).toBe(before); expect(store.getState().undoStack).toBe(undo);
  });
  it("uses the existing overlay/pin controls and preserves the panel on Return", () => {
    open();
    const board = screen.getByTestId("private-board");
    expect(board.parentElement).not.toHaveAttribute("data-reference-pinned");
    fireEvent.click(screen.getByRole("button", { name: "Pin Info panel" }));
    expect(board.parentElement).toHaveAttribute("data-reference-pinned");
    fireEvent.click(screen.getByRole("button", { name: "Did You Vote Today?" }));
    expect(screen.getByRole("dialog", { name: "Did You Vote Today?" })).toBeVisible();
    expect(board.closest("[inert]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Return to Grimoire/ }));
    expect(screen.getByRole("button", { name: "Unpin Info panel" })).toBeVisible();
    expect(board.closest("[inert]")).toBeNull();
  });
  it("character presentations use a selection mode without assignments or ownership badges", () => {
    open(); const before = store.getState().game, undo = store.getState().undoStack;
    fireEvent.click(screen.getByRole("button", { name: "You Are" }));
    const chooser = screen.getByRole("dialog", { name: "You Are" });
    fireEvent.change(within(chooser).getByRole("searchbox"), { target: { value: "Empath" } });
    fireEvent.click(within(chooser).getByRole("button", { name: "Empath" }));
    expect(screen.getByRole("dialog", { name: "You Are" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Return to Grimoire/ })).toBeVisible();
    expect(store.getState().game).toBe(before); expect(store.getState().undoStack).toBe(undo);
  });
  it("does not reopen a returned presentation when a later bluff edit changes the game", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "You Are Good" }));
    fireEvent.click(screen.getByRole("button", { name: /Return to Grimoire/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Demon bluff 1: add" }));
    const chooser = screen.getByRole("dialog", { name: "Demon bluff 1 of 3" });
    fireEvent.change(within(chooser).getByRole("searchbox"), { target: { value: "Monk" } });
    fireEvent.click(within(chooser).getByRole("button", { name: "Monk" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Return to review the current information.")).toBeNull();
    expect(screen.getByRole("button", { name: "Demon bluff 1: Monk" })).toBeVisible();
  });
  it("editing a bluff stays private and does not open a presentation", () => {
    open(); fireEvent.click(screen.getByRole("button", { name: "Demon bluff 1: add" }));
    const chooser = screen.getByRole("dialog", { name: "Demon bluff 1 of 3" });
    fireEvent.change(within(chooser).getByRole("searchbox"), { target: { value: "Monk" } });
    fireEvent.click(within(chooser).getByRole("button", { name: "Monk" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.getState().game!.players.p6!.privateInfo?.bluffs).toEqual(["monk"]);
    expect(store.getState().game!.players.p6!.publishedPacket).toBeUndefined();
    expect(screen.getByRole("button", { name: "Demon bluff 1: Monk" })).toBeVisible();
  });
  it("invalidates an open presentation when the game changes without exposing the board", () => {
    open(); fireEvent.click(screen.getByRole("button", { name: "You Are Good" }));
    act(() => store.setState({ game: { ...store.getState().game!, notes: "new state" } }));
    expect(screen.getByRole("dialog", { name: "Information changed" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "You Are Good" })).toBeNull();
    expect(screen.getByTestId("private-board").closest("[inert]")).toBeTruthy();
  });
  it("privacy removes the active chooser and does not reopen it after showing tokens", () => {
    open(); fireEvent.click(screen.getByRole("button", { name: "You Are" }));
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("requires explicit recipient choice when actual and apparent Demons coexist", () => {
    const game = store.getState().game!;
    store.setState({ game: { ...game, players: { ...game.players, p0: { ...game.players.p0!, actualRole: "lunatic", shownRole: "imp", behaviorMode: "fake_demon_behavior" } } } });
    open();
    expect(screen.getByRole("button", { name: "Demon bluff 1: add" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("group", { name: "Bluffs for" })).getByRole("button", { name: "Player 0 · apparent Demon" }));
    fireEvent.click(screen.getByRole("button", { name: "Demon bluff 1: add" }));
    const chooser = screen.getByRole("dialog", { name: "Demon bluff 1 of 3" });
    fireEvent.change(within(chooser).getByRole("searchbox"), { target: { value: "Monk" } });
    fireEvent.click(within(chooser).getByRole("button", { name: "Monk" }));
    expect(store.getState().game!.players.p0!.privateInfo?.bluffs).toEqual(["monk"]);
    expect(store.getState().game!.players.p6!.privateInfo?.bluffs).toBeUndefined();
  });
  it("never validates old setup names against a replacement game's fresh context", () => {
    open(); const button = screen.getByRole("button", { name: /Demon Information Minions/ });
    act(() => {
      const previous = store.getState().game!;
      store.setState({ game: { ...previous, players: { ...previous.players, p5: { ...previous.players.p5!, name: "New participant", participantId: "replacement" } } } });
      fireEvent.click(button);
    });
    const dialog = screen.queryByRole("dialog");
    if (dialog) expect(within(dialog).queryByText("Player 5")).toBeNull();
    else expect(screen.getByRole("alert")).toHaveTextContent(/game changed/i);
  });
  it("shows a policy refusal inside the active recipient dialog", () => {
    const game = store.getState().game!;
    store.setState({ game: { ...game, players: { ...game.players, p0: { ...game.players.p0!, actualRole: "poppygrower" }, p1: { ...game.players.p1!, actualRole: "spy", shownRole: "spy" } } } });
    open(); fireEvent.click(screen.getByRole("button", { name: /Minion Information Demon/ }));
    const dialog = screen.getByRole("dialog", { name: "Who is this information for?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Player 5" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Poppy Grower/);
  });
  it("shows active Fabled and Loric details without Info editing controls", () => {
    store.setState({ game: { ...store.getState().game!, fabled: ["toymaker"], lorics: ["pope"] } });
    open(); fireEvent.click(screen.getByRole("button", { name: "Toymaker" }));
    expect(screen.getByRole("dialog", { name: "Toymaker" })).toBeVisible();
    expect(screen.getByText("Selected during initial setup.")).toBeVisible();
    expect(within(screen.getByRole("dialog", { name: "Toymaker" })).queryByRole("button", { name: /remove|add/i })).toBeNull();
  });
});
