import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { PlayerDrawer } from "./PlayerDrawer";
import { TravelerArrival } from "./TravelerArrival";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { projectToSelf } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";

let id: string;
beforeEach(() => {
  usePrivacyStore.setState({ enabled: false }); store.setState({ game: null, lobby: null, undoStack: [] });
  store.getState().newGame("tb"); store.getState().addPlayer("Visitor");
  id = store.getState().game!.seatOrder[0]!;
  // Phase 9 Setup finalization B4 revision: setIsTraveler refuses ordinary
  // -> Traveler once occupied ordinary would drop below 5 -- seed enough
  // extra ordinary players first (unrelated to this suite's actual focus).
  // Each needs a real canonical actual role: travelerDemonInformation's
  // "complex setup" check treats any unassigned seat as disqualifying.
  for (const role of ["chef", "empath", "fortuneteller", "undertaker", "monk"]) {
    store.getState().addPlayer("Extra " + role);
    store.getState().assignRole(store.getState().game!.seatOrder.at(-1)!, role);
  }
  store.getState().setIsTraveler(id, true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Drawer() { const p = store(s => s.game!.players[id]!); return <PlayerDrawer player={p} />; }
it("offers compact public character and distinct actual alignment choices", () => {
  render(<Drawer />);
  fireEvent.change(screen.getByLabelText("Public character"), { target: { value: "scapegoat" } });
  fireEvent.click(screen.getByRole("button", { name: "Good" }));
  expect(screen.getByText("Ready for play")).toBeInTheDocument();
  expect(screen.queryByText("Behavior & deception")).toBeNull();
  const p = store.getState().game!.players[id]!;
  // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION, Section
  // 7): the actual alignment reaches the Traveler's own self view privately
  // and automatically -- there is no separate "show alignment" workflow.
  expect(projectToSelf(p, buildRegistry(troubleBrewing))).toEqual({ shownRole: "scapegoat", shownAlignment: "good" });
  expect(screen.queryByRole("button", { name: "Show alignment to Traveler" })).toBeNull();
});
it("evil arrival offers a private candidate and explicit delivery controls", () => {
  store.getState().assignRole(id, "thief"); store.getState().addPlayer("Demon player");
  store.getState().assignRole(store.getState().game!.seatOrder.at(-1)!, "imp");
  render(<Drawer />); fireEvent.click(screen.getByRole("button", { name: "Evil" }));
  fireEvent.click(screen.getByRole("button", { name: "Prepare Demon information" }));
  expect(screen.getByRole("button", { name: "Show Demon to Traveler" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Information given in person" }));
  expect(screen.queryByRole("button", { name: "Prepare Demon information" })).toBeNull();
});
it("Privacy Mode removes secret content from the DOM and preserves public character", () => {
  store.getState().assignRole(id, "thief"); store.getState().setTravelerAlignment(id, "evil");
  render(<Drawer />); act(() => usePrivacyStore.setState({ enabled: true }));
  expect(screen.getByText("Traveler: Thief")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: /Actual Traveler alignment/ })).toBeNull();
  expect(screen.queryByText(/Demon/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Evil" })).toBeNull();
});
it("the arrival component independently respects Privacy Mode", () => {
  store.getState().assignRole(id, "thief"); usePrivacyStore.setState({ enabled: true });
  render(<TravelerArrival playerId={id} />);
  expect(screen.getByText("Traveler: Thief")).toBeInTheDocument(); expect(screen.queryByRole("button")).toBeNull();
});
it("Night Assistant resolves late personal procedure once without global first-night state", () => {
  store.getState().assignRole(id, "apprentice"); store.getState().setTravelerAlignment(id, "good");
  store.setState({ game: { ...store.getState().game!, phase: "night", day: 4 } });
  function Panel() { const game = store(s => s.game!); return <NightOrderPanel game={game} script={troubleBrewing} onClose={() => {}} />; }
  render(<Panel />); expect(screen.getByText(/Storyteller timing check/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(store.getState().game!.players[id]!.travelerArrival!.firstNightComplete).toBe(true);
  expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  expect(store.getState().game!.day).toBe(4);
});
it("records exile without the departure confirmation or membership removal", () => {
  render(<Drawer />); fireEvent.click(screen.getByRole("button", { name: "Exile Traveler" }));
  const p = store.getState().game!.players[id]!; expect(p).toMatchObject({ alive: false, exiled: true });
  expect(screen.getByRole("button", { name: "Traveler leaves game" })).toBeInTheDocument();
});
