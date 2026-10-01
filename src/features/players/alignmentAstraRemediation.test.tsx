// Phase 10E Astra remediation (PHASE10E.md 26), UI side:
//  - SOL-10E-A1: the Player Drawer exposes the Setup Traveler toggle only in
//    Setup before Reveal (ASTRA-10E-001);
//  - SOL-10E-A4: "Player view differs" is ONE unresolved gameplay-disclosure
//    question -- resolved when the view agrees, cleared by a correction, never
//    revived, never inherited by a replacement participant (ASTRA-10E-004).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { PlayerDrawer } from "./PlayerDrawer";
import { ActualAlignmentControls } from "./AlignmentControls";
import type { PlayerId } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;

function SeatDrawer({ seat }: { seat: PlayerId }) {
  const p = store((s) => s.game!.players[seat]!);
  return <PlayerDrawer player={p} />;
}
/** The Actual Alignment controls for a SEAT, deliberately not keyed by the
 * participant: a replacement occupant arrives as a new `player` prop on the
 * same mounted component, so only the component's own state model can keep a
 * cue from being inherited. */
function SeatAlignment({ seat }: { seat: PlayerId }) {
  const p = store((s) => s.game!.players[seat]!);
  return <ActualAlignmentControls player={p} />;
}
const actualGroup = () => within(screen.getByRole("group", { name: /^Actual (Traveler )?alignment/ }));
const cue = () => screen.queryByText(/Player view differs/);
const overrides = () => {
  const disclosure = within(screen.getByText("Override what they are told…").closest("details")!);
  if (!(screen.getByText("Override what they are told…").closest("details") as HTMLDetailsElement).open) {
    fireEvent.click(disclosure.getByText("Override what they are told…"));
  }
  return disclosure;
};
const corrections = () => {
  const summary = screen.getByText("Correct the recorded alignment…");
  const details = summary.closest("details") as HTMLDetailsElement;
  if (!details.open) fireEvent.click(summary);
  return within(details);
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"].forEach((n) => state().addPlayerToSeat(n));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function goLive() {
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}

describe("SOL-10E-A1: the Setup Traveler toggle is actionable only in Setup before Reveal", () => {
  it("Setup before Reveal: the toggle designates", () => {
    const alice = idOf("Alice");
    render(<SeatDrawer seat={alice} />);
    fireEvent.click(screen.getByRole("button", { name: "Not a traveler" }));
    expect(player(alice).isTraveler).toBe(true);
  });

  it("an ended pre-Reveal snapshot and Live Play expose no toggle (status only), and nothing can mutate", () => {
    const alice = idOf("Alice");
    state().setActualAlignment(alice, "evil");
    expect(state().setPhase("ended").ok).toBe(true);
    const { unmount } = render(<SeatDrawer seat={alice} />);
    expect(screen.queryByRole("button", { name: "Not a traveler" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Traveler" })).toBeNull();
    expect(screen.getByText(/Traveler status is set up only during Setup/)).toBeInTheDocument();
    expect(player(alice)).toMatchObject({ isTraveler: false, actualAlignment: "evil" });
    unmount();
    store.setState({ game: null });
    state().newGame(setupScript.id, { plannedPlayerCount: 7 });
    ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"].forEach((n) => state().addPlayerToSeat(n));
    goLive();
    render(<SeatDrawer seat={holder("chef")} />);
    expect(screen.queryByRole("button", { name: "Not a traveler" })).toBeNull();
    expect(screen.getByText(/Traveler status is set up only during Setup/)).toBeInTheDocument();
  });
});

describe("SOL-10E-A4: the gameplay disclosure advisory lifecycle", () => {
  it("1-5: gameplay change -> cue; view updated -> resolved; later correction -> not revived; outstanding cue + correction -> cleared; new gameplay change -> may arm again", async () => {
    goLive();
    const chef = holder("chef");
    state().setShownAlignment(chef, null);
    render(<SeatDrawer seat={chef} />);
    // 1. A gameplay change leaves the player told Good (derived) while Actual is Evil.
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(cue()).toBeInTheDocument();
    // 2. The Storyteller tells them Evil: the question is resolved.
    fireEvent.click(await overrides().findByRole("button", { name: "Shown Evil" }));
    expect(cue()).toBeNull();
    // 3. A later correction to Good makes the view differ again -- but a
    //    correction never revives the resolved gameplay advisory.
    fireEvent.click(await corrections().findByRole("button", { name: "Correct to Good" }));
    expect(player(chef)).toMatchObject({ actualAlignment: "good", shownAlignment: "evil" });
    expect(cue()).toBeNull();
    // 4. A fresh gameplay question (Not told; Good -> Evil) is outstanding...
    fireEvent.click(overrides().getByRole("button", { name: "Not told" }));
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(cue()).toBeInTheDocument();
    //    ... and a correction clears it, although the view still differs.
    fireEvent.click(corrections().getByRole("button", { name: "Correct to Good" }));
    expect(player(chef)).toMatchObject({ actualAlignment: "good", shownAlignment: "undisclosed" });
    expect(cue()).toBeNull();
    // 5. A later independent gameplay change may arm a new advisory.
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(cue()).toBeInTheDocument();
  });

  it("a correction to the same final Actual as an outstanding gameplay cue still clears it", async () => {
    goLive();
    const chef = holder("chef");
    state().setShownAlignment(chef, null);
    render(<SeatDrawer seat={chef} />);
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(cue()).toBeInTheDocument();
    // Correcting the record (here: back to Good, then forward to Evil again by
    // correction) never re-arms; an accepted correction disarms immediately.
    fireEvent.click(await corrections().findByRole("button", { name: "Correct to Good" }));
    fireEvent.click(corrections().getByRole("button", { name: "Correct to Evil" }));
    expect(player(chef).actualAlignment).toBe("evil");
    expect(cue()).toBeNull();
  });

  it("6. a replacement participant never inherits the previous occupant's cue (same mounted controls)", () => {
    goLive();
    const seat = holder("chef");
    state().setShownAlignment(seat, null);
    render(<SeatAlignment seat={seat} />);
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(cue()).toBeInTheDocument();
    act(() => {
      state().unseatPlayer(seat);
      state().addToPendingQueue("uid-new", "Newbie");
      expect(state().assignPendingToSeat("uid-new", seat)).toBe(true);
    });
    const newcomer = player(seat);
    // Make the newcomer's situation match the old cue exactly (an ordinary
    // Chef told Good whose Actual is Evil) without any gameplay change of theirs.
    act(() => {
      store.setState({ game: { ...game(), players: { ...game().players, [seat]: { ...newcomer, isTraveler: false, actualRole: "chef", shownRole: "chef",
        shownAlignment: null, actualAlignment: "evil" } } } });
    });
    expect(player(seat).participantId).toBe(newcomer.participantId);
    expect(cue()).toBeNull();
  });
});
