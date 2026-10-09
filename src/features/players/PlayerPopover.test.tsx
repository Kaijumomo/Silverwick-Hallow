import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { PlayerPopover } from "./PlayerPopover";
import { TRAVELERS } from "@/data/travelers";
import { iconUrlFor } from "@/data/iconUrl";
import { registerVotingAuthorityReader } from "@/firebase/votingAuthority";
import { captureVotingContext } from "@/stores/storytellerStore";
import { currentVotingState } from "@/stores/voting";

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: setupGame(["chef", "imp"]), lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); registerVotingAuthorityReader(() => null); });
const callbacks = () => ({ onChangeCharacter: vi.fn(), onSwapSeats: vi.fn(), onShowPlayer: vi.fn(), onMore: vi.fn(), onClose: vi.fn() });
function View(props: ReturnType<typeof callbacks>) {
  const player = store(s => s.game!.players.p0!);
  return <PlayerPopover player={player} {...props} />;
}

it("shows the canonical identity and delegates character/seat actions without mutations", () => {
  const actions = callbacks();
  const game = store.getState().game;
  render(<View {...actions} />);
  expect(screen.getByRole("heading", { name: "Chef" })).toBeInTheDocument();
  expect(screen.getByText(/You start knowing how many pairs/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Change character" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Swap seat" }));
  fireEvent.click(screen.getByRole("button", { name: "Show player" }));
  fireEvent.click(screen.getByRole("button", { name: "More settings" }));
  expect(actions.onChangeCharacter).toHaveBeenCalledOnce();
  expect(actions.onSwapSeats).toHaveBeenCalledOnce();
  expect(actions.onShowPlayer).toHaveBeenCalledOnce();
  expect(actions.onMore).toHaveBeenCalledOnce();
  expect(store.getState().game).toBe(game);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("removes all private content and resets the palette filter under privacy", () => {
  render(<View {...callbacks()} />);
  fireEvent.click(screen.getByRole("button", { name: /^All \d/ }));
  expect(screen.getByRole("button", { name: "Add Townsfolk reminder from Washerwoman" })).toBeInTheDocument();
  act(() => usePrivacyStore.setState({ enabled: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.textContent).not.toContain("Chef");
  act(() => usePrivacyStore.setState({ enabled: false }));
  expect(screen.queryByRole("button", { name: "Add Townsfolk reminder from Washerwoman" })).toBeNull();
  expect(store.getState().game!.players.p0!.reminders).toHaveLength(0);
});

it("ended games expose no mutation controls", () => {
  store.setState({ game: { ...store.getState().game!, phase: "ended" } });
  render(<View {...callbacks()} />);
  expect(screen.getByText(/Game ended/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change character" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Swap seat" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit effects" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Record death" })).toBeNull();
});

it("uses semantic Life and ghost-vote commands with no redundant same-state mutation", () => {
  store.setState({ game: setupGame(["washerwoman", "imp"], { phase: "day", day: 1 }) });
  render(<View {...callbacks()} />);
  expect(screen.queryByRole("button", { name: /Executed|Exiled/ })).toBeNull();
  expect(screen.queryByText("Correct status…")).toBeNull();
  expect(screen.getByRole("radio", { name: "Alive" })).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByRole("button", { name: "Ghost vote" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Dead" }));
  expect(store.getState().game!.players.p0!.alive).toBe(false);
  expect(store.getState().game!.players.p1!.alive).toBe(true);
  expect(store.getState().game!.lifeEventWindow.events.at(-1)?.kind).toBe("death");
  expect(screen.getByRole("radio", { name: "Dead" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "Ghost vote" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Ghost vote" }));
  expect(store.getState().game!.players.p0!.ghostVote).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Ghost vote" }));
  expect(store.getState().game!.players.p0!.ghostVote).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Alive" }));
  expect(store.getState().game!.players.p0!.alive).toBe(true);
  expect(store.getState().game!.lifeEventWindow.events.at(-1)?.kind).toBe("resurrection");
});

it("focuses its heading and Escape requests close", () => {
  const actions = callbacks();
  render(<View {...actions} />);
  expect(screen.getByRole("heading", { name: /Player 0/ })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(actions.onClose).toHaveBeenCalledOnce();
});

it("filters script reminder tokens by assigned roles including dead players, places and removes notation with Undo", () => {
  const game = setupGame(["washerwoman", "imp"], { phase: "day", day: 1 });
  game.players.p0!.alive = false;
  const characters = setupScript.characters.filter(r => ["washerwoman", "poisoner", "imp"].includes(r.id));
  store.setState({ game, customScripts: { [setupScript.id]: { ...setupScript, characters } } });
  render(<View {...callbacks()} />);
  expect(screen.getByRole("button", { name: "Add Townsfolk reminder from Washerwoman" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add Poisoned reminder from Poisoner" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^All \d/ }));
  expect(screen.queryByRole("button", { name: /Add 3 Votes reminder/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Add Poisoned reminder from Poisoner" })).toHaveAccessibleDescription("Notes do not apply effects.");
  fireEvent.click(screen.getByRole("button", { name: "Add Poisoned reminder from Poisoner" }));
  const placed = store.getState().game!.players.p0!;
  expect(placed.reminders).toEqual([expect.objectContaining({ label: "Poisoned", sourceCharacter: "poisoner" })]);
  expect(placed.effects).toHaveLength(0);
  expect(store.getState().game!.players.p1!.reminders).toHaveLength(0);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Remove Poisoned reminder" })).toHaveAccessibleDescription("Note Notes do not apply effects.");
  expect(within(screen.getByRole("button", { name: "Remove Poisoned reminder" })).getByText("Note")).toHaveClass("sr-only");
  fireEvent.click(screen.getByRole("button", { name: "Remove Poisoned reminder" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Poisoned reminder" }));
  expect(store.getState().game!.players.p0!.reminders).toHaveLength(0);
  act(() => store.getState().undo());
  expect(store.getState().game!.players.p0!.reminders[0]?.label).toBe("Poisoned");
});

it("uses custom script ownership and deduplicates reminder labels without importing canonical role mechanics", () => {
  const role = { ...setupScript.characters.find(r => r.id === "washerwoman")!, name: "Custom washer", reminders: ["Custom clue", "Custom clue"], remindersGlobal: ["Everywhere"], ability: "Custom rules", iconUrl: "https://example.test/custom.png" };
  store.setState({ game: setupGame(["washerwoman"]), customScripts: { [setupScript.id]: { ...setupScript, characters: [role] } } });
  render(<View {...callbacks()} />);
  expect(screen.getByRole("button", { name: "All 2" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Add Townsfolk/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add Custom clue reminder from Custom washer" }));
  expect(store.getState().game!.players.p0!.reminders[0]?.label).toBe("Custom clue");
});

it("refuses stale participant and game snapshots without touching the replacement occupant", () => {
  const game = setupGame(["washerwoman"], { phase: "day", day: 1 });
  store.setState({ game });
  render(<PlayerPopover player={game.players.p0!} {...callbacks()} />);
  act(() => store.setState({ game: { ...game, players: { p0: { ...game.players.p0!, participantId: "replacement" } } } }));
  fireEvent.click(screen.getByRole("radio", { name: "Dead" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Townsfolk reminder from Washerwoman" }));
  expect(store.getState().game!.players.p0!.alive).toBe(true);
  expect(store.getState().game!.players.p0!.reminders).toHaveLength(0);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("refuses Life and reminder changes when the captured online writer loses authority", () => {
  const game = setupGame(["washerwoman"], { phase: "day", day: 1 });
  const lobby = { code: "ABCDEF", uid: "local", sessionId: "writer", status: "live" as const };
  let writer: string | null = "writer-token";
  registerVotingAuthorityReader(() => writer);
  store.setState({ game, lobby });
  render(<View {...callbacks()} />);
  writer = null;
  fireEvent.click(screen.getByRole("radio", { name: "Dead" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Townsfolk reminder from Washerwoman" }));
  expect(store.getState().game).toBe(game);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("removes an official Bureaucrat reminder and its linked modifier together", () => {
  const game = setupGame(["washerwoman", "bureaucrat"], { phase: "night", day: 1 });
  game.players.p1!.isTraveler = true;
  store.setState({ game });
  const binding = (id: string) => ({ playerId: id, participantId: game.players[id]!.participantId! });
  const result = store.getState().resolveVoting({ kind: "bureaucrat", modifierId: "bureau-popover", source: binding("p1"), target: binding("p0"), code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision }, captureVotingContext());
  expect(result.ok).toBe(true);
  render(<View {...callbacks()} />);
  expect(screen.getByRole("button", { name: "Remove 3 Votes reminder" })).toHaveAccessibleDescription("Effect");
  expect(within(screen.getByRole("button", { name: "Remove 3 Votes reminder" })).getByText("Effect")).toHaveClass("sr-only");
  fireEvent.click(screen.getByRole("button", { name: "Remove 3 Votes reminder" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove 3 Votes reminder" }));
  expect(store.getState().game!.players.p0!.reminders).toHaveLength(0);
  expect(currentVotingState(store.getState().game!).modifiers).toHaveLength(0);
});

it("distinguishes a Poisoned note from an existing authoritative Poisoner effect without altering either", () => {
  const game = setupGame(["washerwoman", "poisoner"], { phase: "day", day: 1 });
  store.setState({ game });
  const target = { playerId: "p0", participantId: game.players.p0!.participantId! };
  const source = { playerId: "p1", participantId: game.players.p1!.participantId! };
  expect(store.getState().resolveEffects({ intents: [{ kind: "apply", target,
    effect: { id: "real-poison", type: "poisoned", source, sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" } } }] }).ok).toBe(true);
  const existingEffect = store.getState().game!.players.p0!.effects[0];
  render(<View {...callbacks()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add Poisoned reminder from Poisoner" }));
  const placed = screen.getByLabelText("Placed reminders");
  expect(within(placed).getByText(/Poisoned: Currently affecting/)).toHaveClass("sr-only");
  expect(within(placed).getByText("Note")).toHaveClass("sr-only");
  expect(screen.getByText("Notes do not apply effects.")).toHaveClass("sr-only");
  expect(store.getState().game!.players.p0!.effects).toEqual([existingEffect]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Poisoned reminder" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Poisoned reminder" }));
  expect(store.getState().game!.players.p0!.effects).toEqual([existingEffect]);
  expect(store.getState().game!.players.p0!.reminders).toHaveLength(0);
  act(() => store.getState().undo());
  expect(store.getState().game!.players.p0!.effects).toEqual([existingEffect]);
  expect(store.getState().game!.players.p0!.reminders[0]?.label).toBe("Poisoned");
});

it("uses canonical Traveler artwork despite a colliding script definition", () => {
  const traveler = TRAVELERS.find(role => role.id === "thief")!;
  const script = { ...setupScript, characters: [{ ...traveler, name: "Imposter", ability: "Not canonical", iconUrl: "https://invalid.test/imposter.png" }] };
  const game = setupGame(["thief"]);
  game.players.p0!.isTraveler = true;
  store.setState({ game, customScripts: { [script.id]: script } });
  render(<View {...callbacks()} />);
  expect(screen.getByRole("heading", { name: traveler.name })).toBeInTheDocument();
  expect(screen.queryByText("Imposter")).toBeNull();
  expect(document.querySelector(".player-popover-portrait img")).toHaveAttribute("src", iconUrlFor(traveler));
  expect(screen.getByText(traveler.ability!)).toBeInTheDocument();
});

it.each([
  { name: "Galaxy Tab S8 Ultra with pinned Players", left: 0, top: 0, width: 1108, height: 924, expectedHeight: 660 },
  { name: "short board above a legacy dock", left: 20, top: 70, width: 640, height: 360, expectedHeight: 328 },
])("keeps the card inside $name with a bounded scroll region", bounds => {
  vi.stubGlobal("innerWidth", 1480);
  vi.stubGlobal("innerHeight", 924);
  const rectangle = (left: number, top: number, width: number, height: number) => ({
    x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("grimoire-stage")) return rectangle(bounds.left, bounds.top, bounds.width, bounds.height);
    if (this.classList.contains("token")) return rectangle(bounds.left + bounds.width - 100, bounds.top + bounds.height - 100, 80, 80);
    if (this.classList.contains("player-popover")) return rectangle(0, 0, 316, 640);
    return rectangle(0, 0, 0, 0);
  });
  const game = store.getState().game;
  render(<><div className="grimoire-stage"><div className="grimoire"><button className="token" data-player-id="p0">Ada</button></div></div><View {...callbacks()} /></>);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveStyle({ maxHeight: `${bounds.expectedHeight}px`, width: "316px" });
  expect(Number.parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(bounds.left + 16);
  expect(Number.parseFloat(dialog.style.left) + 316).toBeLessThanOrEqual(bounds.left + bounds.width - 16);
  expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(bounds.top + 16);
  expect(Number.parseFloat(dialog.style.top) + Math.min(640, bounds.expectedHeight)).toBeLessThanOrEqual(bounds.top + bounds.height - 16);
  expect(dialog.querySelector(".player-popover-scroll")?.contains(screen.getByRole("button", { name: "Swap seat" }))).toBe(false);
  expect(store.getState().game).toBe(game);
});
