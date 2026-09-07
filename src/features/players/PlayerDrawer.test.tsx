import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { PlayerDrawer } from "./PlayerDrawer";

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [] });
  store.getState().newGame("tb");
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
