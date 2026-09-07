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
  expect(screen.getByText("Simulated information · Alice")).toBeInTheDocument();
  expect(screen.queryByText("Fake minions:")).toBeNull();
  expect(screen.queryByText("Bluffs:")).toBeNull();
  expect(screen.queryByText(/Fake Demon information/)).toBeNull();
});

it("Marionette shown as Fortune Teller gets simulated information, not Demon/Minion controls", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Marionette minion" }));
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.click(perception.getByRole("button", { name: "Fortune Teller townsfolk" }));
  expect(screen.getByText("Simulated information · Alice")).toBeInTheDocument();
  expect(screen.queryByText("Fake minions:")).toBeNull();
  expect(screen.queryByText("Bluffs:")).toBeNull();
});

it("Lunatic shown as Imp retains fake Demon controls", () => {
  render(<Drawer />);
  fireEvent.click(screen.getByRole("button", { name: "Lunatic outsider" }));
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  fireEvent.change(perception.getByLabelText("Mode:"), { target: { value: "fake_demon_behavior" } });
  fireEvent.click(perception.getByRole("button", { name: "Imp demon" }));
  expect(screen.getByText("Fake minions:")).toBeInTheDocument();
  expect(screen.getByText("Bluffs:")).toBeInTheDocument();
  expect(screen.getByText("Fake Demon information · Alice")).toBeInTheDocument();
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
  expect(screen.getByText("Demon bluff delivery · Alice")).toBeInTheDocument();
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
