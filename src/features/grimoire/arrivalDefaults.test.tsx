import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { selectSetupContext } from "@/features/setup/setupContext";
import { travelerGuidance } from "@/stores/travelers";
import { GrimoireCircle } from "./GrimoireCircle";
import { SeatAssignPopup } from "./SeatAssignPopup";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { usePrivacyStore } from "@/stores/privacyStore";

const state = () => store.getState();
const game = () => state().game!;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: setupGame(standardRoles(5)), lobby: null, undoStack: [], selectedPlayerId: null,
    customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["addPlayer", "addPlayerToSeat"] as const)("setup %s keeps ordinary setup semantics", command => {
  state()[command]("New player");
  const p = game().players[game().seatOrder.at(-1)!]!;
  expect(p.isTraveler).toBe(false); expect(p.travelerArrival).toBeUndefined();
  expect(game().plannedPlayerCount).toBe(5);
  expect(selectSetupContext(game()).population.occupiedNonTravelerCount).toBe(6);
});

it.each(["day", "night"] as const)("all generic %s arrival commands enforce Traveler without UI flags", phase => {
  // A pre-existing, preassigned empty seat must not donate an ordinary role.
  state().addEmptySeat(); const empty = game().seatOrder.at(-1)!;
  state().assignRole(empty, "washerwoman"); state().showAssignedRole(empty);
  store.setState({ game: { ...game(), phase, day: 4 } });
  const before = selectSetupContext(game()).assigned;
  state().addPlayerToSeat("Fills planned seat");
  state().addPlayer("Direct arrival");
  state().addPlayerToSeat("No empty seats");
  state().addEmptySeat(); const online = game().seatOrder.at(-1)!;
  state().addToPendingQueue("uid", "Approved arrival");
  expect(state().assignPendingToSeat("uid", online)).toBe(true);
  const context = selectSetupContext(game());
  expect(context.assigned).toEqual(before);
  expect(context.population).toMatchObject({ occupiedNonTravelerCount: 5, occupiedTravelerCount: 4, totalPhysicalSeatCount: 9 });
  expect(game()).toMatchObject({ phase, day: 4, plannedPlayerCount: 5 });
  for (const p of context.travelers) {
    expect(p).toMatchObject({ actualRole: "", shownRole: null, shownAlignment: null,
      travelerArrival: { demonInfoComplete: false, firstNightComplete: false } });
    expect(p.actualAlignment).toBeUndefined();
    expect(travelerGuidance(p)).toEqual(["Choose a Traveler character.", "Choose actual alignment privately."]);
  }
});

it.each(["setup", "day", "night"] as const)("approved filling of an old empty seat during %s uses the command default", phase => {
  state().addEmptySeat(); const id = game().seatOrder.at(-1)!;
  state().addToPendingQueue("uid", "Visitor");
  store.setState({ game: { ...game(), phase } });
  render(<SeatAssignPopup seatPlayerId={id} seatNumber={6} backend={null} code="" onClose={() => {}} />);
  if (phase !== "setup") {
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Arriving as a Traveler")).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(game().players[id]!.isTraveler).toBe(phase !== "setup");
  expect(game().plannedPlayerCount).toBe(5);
});

it("an open setup seating popup cannot undo the active-game default", () => {
  state().addEmptySeat(); const id = game().seatOrder.at(-1)!;
  state().addToPendingQueue("uid", "Visitor");
  render(<SeatAssignPopup seatPlayerId={id} seatNumber={6} backend={null} code="" onClose={() => {}} />);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  act(() => store.setState({ game: { ...game(), phase: "night", day: 1 } }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(game().players[id]!.isTraveler).toBe(true);
  expect(state().selectedPlayerId).toBe(id);
});

it("occupied ordinary seats reject arrival assignment and keep identity", () => {
  store.setState({ game: { ...game(), phase: "day", day: 3 } });
  const id = game().seatOrder[0]!; const before = game().players[id];
  state().addToPendingQueue("uid", "Reconnect");
  expect(state().assignPendingToSeat("uid", id)).toBe(false);
  state().bindRosterUid("uid", id);
  expect(game().players[id]).toEqual(before);
  expect(game().players[id]!.isTraveler).toBe(false);
});

it("setup offers ordinary addition and explicit Traveler addition", () => {
  vi.spyOn(window, "prompt").mockReturnValue("Visitor");
  render(<GrimoireCircle />);
  fireEvent.click(screen.getByRole("button", { name: "Add player" }));
  expect(game().players[game().seatOrder.at(-1)!]!.isTraveler).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Add Traveler" }));
  expect(game().players[game().seatOrder.at(-1)!]!.isTraveler).toBe(true);
  expect(state().selectedPlayerId).toBe(game().seatOrder.at(-1));
});

it.each(["day", "night"] as const)("%s generic add opens Traveler onboarding", phase => {
  store.setState({ game: { ...game(), phase, day: 4 } });
  vi.spyOn(window, "prompt").mockReturnValue("Visitor");
  function View() { const p = store(s => s.selectedPlayerId ? s.game?.players[s.selectedPlayerId] : undefined);
    return <><GrimoireCircle />{p && <PlayerDrawer player={p} />}</>; }
  render(<View />);
  fireEvent.click(screen.getAllByRole("button", { name: "Add Traveler" })[0]!);
  expect(screen.getByLabelText("Public character")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: /Actual Traveler alignment/ })).toBeInTheDocument();
  expect(game().plannedPlayerCount).toBe(5); expect(game().phase).toBe(phase);
});
