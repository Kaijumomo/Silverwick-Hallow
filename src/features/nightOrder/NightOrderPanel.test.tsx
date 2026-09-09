import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NightOrderPanel } from "./NightOrderPanel";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { AlmanacBody } from "@/features/almanac/AlmanacBody";
import { canonicalRoles } from "@/data/canonical";

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [] });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
});
afterEach(cleanup);
function Night() {
  const game = store(s => s.game)!;
  return <NightOrderPanel game={game} script={troubleBrewing} onClose={() => {}} />;
}
function setup() {
  store.getState().newGame("tb");
  store.getState().addPlayer("Alice");
  const id = store.getState().game!.seatOrder[0]!;
  store.getState().assignRole(id, "empath");
  store.getState().setShownRole(id, "empath");
  store.getState().setPlannedPlayerCount(1);
  expect(store.getState().advancePhase().ok).toBe(true);
}
it("custom steps can be added, edited, completed, and restored across remount without sending information", () => {
  setup();
  const players = store.getState().game!.players;
  const view = render(<Night />);
  fireEvent.click(screen.getByRole("button", { name: "Add custom night step" }));
  let card = screen.getByText("Custom night step").closest(".step-card")! as HTMLElement;
  fireEvent.change(within(card).getByRole("textbox"), { target: { value: "Confirm the delayed information in person." } });
  fireEvent.blur(within(card).getByRole("textbox"));
  fireEvent.click(within(card).getByRole("button", { name: "Done" }));
  expect(store.getState().game!.players).toEqual(players);
  expect(Object.values(store.getState().game!.nightProgress)).toContainEqual({
    status: "done", notes: "Confirm the delayed information in person.",
  });
  view.unmount();
  render(<Night />);
  card = screen.getByText("Custom night step").closest(".step-card")! as HTMLElement;
  expect(within(card).getByRole("textbox")).toHaveValue("Confirm the delayed information in person.");
  expect(card).toHaveAttribute("data-status", "done");
  expect(document.body).not.toHaveTextContent(/packet|fingerprint|source revision/i);
});
it("Privacy Mode conceals canonical instructions, warnings and custom notes without changing gameplay", () => {
  setup();
  store.getState().setNightStepNotes(1, "manual:test", "Hidden team information");
  render(<Night />);
  const before = store.getState().game;
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.getByRole("status")).toHaveTextContent("Privacy Mode On");
  expect(screen.queryByText("Empath")).toBeNull();
  expect(screen.queryByDisplayValue("Hidden team information")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add custom night step" })).toBeNull();
  expect(store.getState().game).toBe(before);
  act(() => usePrivacyStore.getState().setEnabled(false));
  expect(screen.getByDisplayValue("Hidden team information")).toBeInTheDocument();
});
it("small games do not show an automatic bluff send task; reference provenance is human-readable", () => {
  setup();
  render(<Night />);
  expect(screen.getByText("Starting information — small game")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send bluffs" })).toBeNull();
  cleanup();
  render(<AlmanacBody roles={canonicalRoles(["king"])} />);
  fireEvent.click(screen.getByText("King"));
  expect(screen.getByText("Official · experimental")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Wiki ↗" })).toBeInTheDocument();
});
