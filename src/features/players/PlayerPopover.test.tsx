import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { PlayerPopover } from "./PlayerPopover";
import { TRAVELERS } from "@/data/travelers";
import { iconUrlFor } from "@/data/iconUrl";

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: setupGame(["chef", "imp"]), lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const callbacks = () => ({ onChangeCharacter: vi.fn(), onSwapSeats: vi.fn(), onMore: vi.fn(), onClose: vi.fn() });
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
  fireEvent.click(screen.getByRole("button", { name: "Swap seats" }));
  fireEvent.click(screen.getByRole("button", { name: "More settings" }));
  expect(actions.onChangeCharacter).toHaveBeenCalledOnce();
  expect(actions.onSwapSeats).toHaveBeenCalledOnce();
  expect(actions.onMore).toHaveBeenCalledOnce();
  expect(store.getState().game).toBe(game);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("removes all private content and editor drafts under privacy", () => {
  render(<View {...callbacks()} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit reminders" }));
  fireEvent.change(screen.getByLabelText("Reminder text"), { target: { value: "Private draft" } });
  act(() => usePrivacyStore.setState({ enabled: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.textContent).not.toContain("Chef");
  act(() => usePrivacyStore.setState({ enabled: false }));
  expect(screen.queryByLabelText("Reminder text")).toBeNull();
  expect(store.getState().game!.players.p0!.reminders).toHaveLength(0);
});

it("ended games expose no mutation controls", () => {
  store.setState({ game: { ...store.getState().game!, phase: "ended" } });
  render(<View {...callbacks()} />);
  expect(screen.getByText(/Game ended/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change character" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Swap seats" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit effects" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Record death" })).toBeNull();
});

it("reuses semantic life commands and existing notation editor", () => {
  store.setState({ game: { ...store.getState().game!, phase: "day", day: 1 } });
  render(<View {...callbacks()} />);
  fireEvent.click(screen.getByRole("button", { name: "Record death" }));
  expect(store.getState().game!.players.p0!.alive).toBe(false);
  expect(store.getState().game!.players.p1!.alive).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Edit reminders" }));
  fireEvent.change(screen.getByLabelText("Reminder text"), { target: { value: "Watch this player" } });
  fireEvent.submit(screen.getByRole("form", { name: "Add reminder" }));
  expect(store.getState().game!.players.p0!.reminders[0]!.label).toBe("Watch this player");
  expect(store.getState().game!.players.p1!.reminders).toHaveLength(0);
});

it("focuses its heading and Escape requests close", () => {
  const actions = callbacks();
  render(<View {...actions} />);
  expect(screen.getByRole("heading", { name: /Player 0/ })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(actions.onClose).toHaveBeenCalledOnce();
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
  expect(dialog.querySelector(".player-popover-scroll")?.contains(screen.getByRole("button", { name: "Swap seats" }))).toBe(false);
  expect(store.getState().game).toBe(game);
});
