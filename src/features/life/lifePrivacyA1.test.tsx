import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { GameScreen } from "@/features/game/GameScreen";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { DayResolutionPanel, DuskReview } from "./DayResolution";
import { LifeEventsPanel } from "./LifeEventsPanel";
import type { PlayerId } from "@/stores/types";

// Phase 10A Astra remediation, Package A1:
//  - 10A-ASTRA-003: Privacy Mode removes Storyteller-private Life Event
//    snapshots from the DOM (not merely hides them).
//  - 10A-ASTRA-002 (UI defense in depth): a pending confirmation is dropped
//    when the participant, moment or Privacy Mode changes.

const HISTORIC = "Zanzibar"; // the name recorded in the Life Event snapshot
const CURRENT = "Quill";     // the player's current public name

const state = () => store.getState();
const game = () => state().game!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Day 1 with a recorded execution whose snapshot name ("Zanzibar")
 * differs from the executee's current public name ("Quill"). */
function dayWithRenamedExecutee(): PlayerId[] {
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  [HISTORIC, "Bea", "Cy", "Di", "Ed", "Flo", "Gus"].forEach((n) => state().addPlayerToSeat(n));
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(game().players[id]!.actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  expect(state().advancePhase().ok).toBe(true);
  const ids = [...game().seatOrder];
  expect(state().recordExecution(ids[0]!, "died").ok).toBe(true);
  state().renamePlayer(ids[0]!, CURRENT);
  expect(game().lifeEventWindow.events[0]!.subject.nameAtTime).toBe(HISTORIC);
  return ids;
}

/** Neither visible text nor any queryable DOM content (attributes,
 * accessible names) may carry the private snapshot. */
function expectNoPrivateEventData() {
  expect(document.body.textContent ?? "").not.toContain(HISTORIC);
  expect(document.body.innerHTML).not.toContain(HISTORIC);
  expect(screen.queryByText(new RegExp(HISTORIC))).toBeNull();
  expect(screen.queryAllByRole("dialog").some((d) => (d.textContent ?? "").includes("executed"))).toBe(false);
}

describe("10A-ASTRA-003: event-bearing dialogs opened under Privacy Mode render nothing private", () => {
  it("Day Resolution, Dusk Review and Life events never put the snapshot in the DOM", () => {
    dayWithRenamedExecutee();
    // Control: without Privacy Mode the snapshot is shown.
    const control = render(<DayResolutionPanel onClose={() => {}} />);
    expect(screen.getByText(`${HISTORIC} — executed — died`)).toBeInTheDocument();
    control.unmount();

    usePrivacyStore.setState({ enabled: true });
    const closes = [vi.fn(), vi.fn(), vi.fn()];
    render(<>
      <DayResolutionPanel onClose={closes[0]!} />
      <LifeEventsPanel onClose={closes[1]!} />
      <DuskReview onClose={closes[2]!} onRecord={() => {}} onContinue={() => {}} />
    </>);
    expectNoPrivateEventData();
    // Final remediation: each closes itself -- no dormant "safe" dialog stays
    // mounted, and there is no way to continue unseen.
    for (const close of closes) expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue to Night/ })).toBeNull();
  });

  it("GameScreen hides the Day resolution and Life events entry points under Privacy Mode", () => {
    dayWithRenamedExecutee();
    usePrivacyStore.setState({ enabled: true });
    render(<GameScreen />);
    expect(screen.queryByRole("button", { name: "Day resolution" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Life events" })).toBeNull();
    // The dusk review is private: Day -> Night waits for Privacy Mode to end.
    expect(screen.getByRole("button", { name: "→ Night" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "→ Night" }));
    expectNoPrivateEventData();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("10A-ASTRA-003: turning Privacy Mode on while a dialog is open removes it", () => {
  it.each([
    ["Day resolution", "Day resolution"],
    ["Life events", "Life events"],
    ["Dusk Review", "→ Night"],
  ])("%s", (_label, opener) => {
    dayWithRenamedExecutee();
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: opener }));
    expect(document.body.textContent).toContain(HISTORIC);
    act(() => { usePrivacyStore.setState({ enabled: true }); });
    expectNoPrivateEventData();
    expect(screen.queryByRole("dialog")).toBeNull();
    // It does not come back with stale content when Privacy Mode ends.
    act(() => { usePrivacyStore.setState({ enabled: false }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(HISTORIC);
  });

  it("component-level: the panels unmount their private content as soon as Privacy Mode turns on", () => {
    dayWithRenamedExecutee();
    render(<>
      <DayResolutionPanel onClose={() => {}} />
      <LifeEventsPanel onClose={() => {}} />
      <DuskReview onClose={() => {}} onRecord={() => {}} onContinue={() => {}} />
    </>);
    expect(screen.getAllByText(new RegExp(HISTORIC)).length).toBeGreaterThan(0);
    act(() => { usePrivacyStore.setState({ enabled: true }); });
    expectNoPrivateEventData();
  });
});

describe("10A-ASTRA-002 (UI defense in depth): pending confirmations are dropped on context change", () => {
  function travelerDay(): PlayerId {
    dayWithRenamedExecutee();
    state().addToPendingQueue("uid-tess", "Tess");
    state().addEmptySeat();
    const seat = game().seatOrder.at(-1)!;
    expect(state().assignPendingToSeat("uid-tess", seat)).toBe(true);
    state().assignRole(seat, "thief");
    return seat;
  }
  function Drawer({ id }: { id: PlayerId }) { const p = store((s) => s.game!.players[id]!); return <PlayerDrawer player={p} />; }

  it("replacing the participant at the same PlayerId drops the pending confirmation", () => {
    const seat = travelerDay();
    render(<Drawer id={seat} />);
    fireEvent.click(screen.getByRole("button", { name: "Executed — died" }));
    expect(screen.getByRole("button", { name: "Record anyway" })).toBeInTheDocument();
    act(() => {
      state().unseatPlayer(seat);
      state().addToPendingQueue("uid-bob", "Bob");
      state().assignPendingToSeat("uid-bob", seat);
    });
    expect(screen.queryByRole("button", { name: "Record anyway" })).toBeNull();
    expect(game().players[seat]).toMatchObject({ name: "Bob", alive: true });
  });

  it("a moment change drops the pending confirmation", () => {
    const seat = travelerDay();
    render(<Drawer id={seat} />);
    fireEvent.click(screen.getByRole("button", { name: "Executed — died" }));
    expect(screen.getByRole("button", { name: "Record anyway" })).toBeInTheDocument();
    act(() => { state().advancePhase(); });
    expect(screen.queryByRole("button", { name: "Record anyway" })).toBeNull();
  });

  it("confirming the SAME participant at the same moment still works through the UI", () => {
    const seat = travelerDay();
    render(<Drawer id={seat} />);
    fireEvent.click(screen.getByRole("button", { name: "Executed — died" }));
    expect(screen.getByText(/is a Traveler/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record anyway" }));
    // Day 1 already has an execution: that exceptional case is confirmed
    // separately, never implied by the first confirmation.
    expect(game().players[seat]!.alive).toBe(true);
    expect(screen.getByText(/already recorded for Day 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record anyway" }));
    expect(game().players[seat]!.alive).toBe(false);
  });

  it("Day resolution: switching the executee drops the pending confirmation", () => {
    const seat = travelerDay();
    render(<DayResolutionPanel onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Executee"), { target: { value: seat } });
    fireEvent.click(screen.getByRole("button", { name: "Died" }));
    expect(screen.getByRole("button", { name: "Record anyway" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Executee"), { target: { value: game().seatOrder[1]! } });
    expect(screen.queryByRole("button", { name: "Record anyway" })).toBeNull();
  });
});
