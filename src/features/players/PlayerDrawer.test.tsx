import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { PlayerDrawer } from "./PlayerDrawer";
import { roles } from "@/test/fixtures";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { usePrivacyStore } from "@/stores/privacyStore";

const qaScript = { ...troubleBrewing, id: "qa", characters: [...troubleBrewing.characters, roles.marionette!, roles.lunatic!] };

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: { qa: qaScript } });
  store.getState().newGame("qa");
  store.getState().addPlayer("Alice");
});
afterEach(cleanup);
function Drawer() {
  const p = store(s => Object.values(s.game!.players)[0]!);
  return <PlayerDrawer player={p} />;
}
const current = () => Object.values(store.getState().game!.players)[0]!;

it("manual actual assignment waits for the explicit show action", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Chef townsfolk" }));
  expect(current().actualRole).toBe("chef");
  expect(current().shownRole).toBeNull();
  expect(screen.getByText("Role not revealed yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "auto (—)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show assigned role" }));
  expect(current().shownRole).toBe("chef");
  expect(screen.getByRole("button", { name: "auto (good)" })).toBeInTheDocument();
});

it("Drunk has explicit shown-role controls even before a behavior mode is selected", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Drunk outsider" }));
  expect(screen.queryByRole("button", { name: "Show assigned role" })).toBeNull();
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.click(perception.getByRole("button", { name: "Chef townsfolk" }));
  expect(current().actualRole).toBe("drunk");
  expect(current().shownRole).toBe("chef");
  fireEvent.click(perception.getByRole("button", { name: "clear" }));
  expect(current().shownRole).toBeNull();
  expect(screen.getByText("Role not revealed yet")).toBeInTheDocument();
});

it("Drunk shown as Empath gets simulated information, not Demon/Minion controls", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Drunk outsider" }));
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.click(perception.getByRole("button", { name: "Empath townsfolk" }));
  expect(screen.queryByLabelText("Information")).toBeNull();
  expect(screen.queryByText("Players shown as Minions:")).toBeNull();
  expect(screen.queryByText("Bluffs:")).toBeNull();
  expect(screen.queryByText(/Fake Demon information/)).toBeNull();
});

it("Marionette shown as Fortune Teller gets simulated information, not Demon/Minion controls", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Marionette minion" }));
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.click(perception.getByRole("button", { name: "Fortune Teller townsfolk" }));
  expect(screen.queryByLabelText("Information")).toBeNull();
  expect(screen.queryByText("Players shown as Minions:")).toBeNull();
  expect(screen.queryByText("Bluffs:")).toBeNull();
});

it("Lunatic shown as Imp retains fake Demon controls", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Lunatic outsider" }));
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.change(perception.getByLabelText("Mode:"), { target: { value: "fake_demon_behavior" } });
  fireEvent.click(perception.getByRole("button", { name: "Imp demon" }));
  expect(screen.getByText("Players shown as Minions:")).toBeInTheDocument();
  expect(screen.getByText("Bluffs:")).toBeInTheDocument();
  expect(screen.getByText("Demon setup information")).toBeInTheDocument();
});

it("normal players do not receive an unnecessary packet panel", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Chef townsfolk" }));
  expect(screen.queryByText(/Simulated information ·/)).toBeNull();
  expect(screen.queryByText(/Demon bluff delivery ·/)).toBeNull();
  expect(screen.queryByText("Information to send")).toBeNull();
});

it("normal Demon keeps the bluff editor without an extra freeform packet editor", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Imp demon" }));
  expect(screen.getByText("Demon bluffs (ST private)")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Send bluffs" })).toHaveLength(1);
  expect(screen.queryByText("Information to send")).toBeNull();
});

it("changing Lunatic behavior to Drunk or Normal prunes incompatible packet fields", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Lunatic outsider" }));
  const behavior = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.change(behavior.getByLabelText("Mode:"), { target: { value: "fake_demon_behavior" } });
  fireEvent.click(behavior.getByRole("button", { name: "Imp demon" }));
  const selected = Object.values(store.getState().game!.players)[0]!.id;
  store.getState().setFakeMinions(selected, []);
  store.getState().setBluffs(selected, ["chef"]);
  store.getState().setBehaviorMode(selected, "drunk_fake_role_behavior");
  expect(store.getState().game!.players[selected]!.privateInfo).toBeUndefined();
  store.getState().setBluffs(selected, ["chef"]);
  store.getState().setBehaviorMode(selected, "normal");
  expect(store.getState().game!.players[selected]!.privateInfo).toBeUndefined();
});

it("privacy mode keeps the player drawer safe and restores it when disabled", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Drunk outsider" }));
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.click(perception.getByRole("button", { name: "Empath townsfolk" }));
  store.getState().setReminders(current().id, ["Poisoned", "Secret note"]);

  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.getByText("Storyteller details are hidden while Privacy Mode is on.")).toBeInTheDocument();
  expect(screen.getByText("Alice")).toBeInTheDocument();
  expect(screen.getByText("seat 1")).toBeInTheDocument();
  expect(screen.queryByText("Actual role (ST private)")).toBeNull();
  expect(screen.queryByText("Drunk")).toBeNull();
  expect(screen.queryByText("Empath")).toBeNull();
  expect(screen.queryByText("Poisoned")).toBeNull();
  expect(screen.queryByText("Secret note")).toBeNull();

  act(() => usePrivacyStore.getState().setEnabled(false));
  expect(screen.getByText("Actual role (ST private)")).toBeInTheDocument();
  expect(screen.getAllByText("Drunk").length).toBeGreaterThan(0);
});

it("Lunatic bluff picker allows an in-play good character", () => {
  const id = current().id;
  store.getState().assignRole(id, "lunatic");
  store.getState().setBehaviorMode(id, "fake_demon_behavior");
  store.getState().setShownRole(id, "imp");
  store.getState().addPlayer("Bob");
  const bob = store.getState().game!.seatOrder[1]!;
  store.getState().assignRole(bob, "chef");
  render(<Drawer />);
  const setup = within(screen.getByText("Demon setup information").closest("section")!);
  fireEvent.click(setup.getByRole("button", { name: "Chef townsfolk" }));
  expect(current().privateInfo?.bluffs).toEqual(["chef"]);
});

it("keeps drawer focus contained across privacy changes and restores the seat on Escape", () => {
  function SelectedDrawer() {
    const selected = store(s => s.selectedPlayerId);
    const player = store(s => Object.values(s.game!.players)[0]!);
    return <>
      <button onClick={() => store.getState().selectPlayer(player.id)}>Alice seat</button>
      {selected && <PlayerDrawer player={player} />}
    </>;
  }
  render(<SelectedDrawer />);
  const seat = screen.getByRole("button", { name: "Alice seat" });
  seat.focus(); fireEvent.click(seat);
  const name = screen.getByRole("textbox", { name: "Player name" });
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: "Alice edited" } });
  expect(name).toHaveFocus();
  fireEvent.keyDown(name, { key: "Tab", shiftKey: true });
  expect(screen.getByRole("button", { name: "Unseat player" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(name).toHaveFocus();
  act(() => usePrivacyStore.getState().setEnabled(true));
  const close = screen.getByRole("button", { name: "Close" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Tab" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(close).toHaveFocus();
  expect(seat).toHaveAttribute("inert");
  act(() => usePrivacyStore.getState().setEnabled(false));
  expect(screen.getByRole("textbox", { name: "Player name" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(seat).toHaveFocus();
  expect(seat).not.toHaveAttribute("inert");
});
