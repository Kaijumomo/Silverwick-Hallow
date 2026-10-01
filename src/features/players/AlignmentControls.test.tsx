// Phase 10E: Storyteller alignment UI. Actual Alignment truth (Alignment seam)
// and player-facing alignment (Phase 10D perception seam) are separate
// surfaces; the normal action is one tap, correction and overrides are
// progressively disclosed, every action is bound to the record the drawer
// RENDERED, and Privacy Mode renders none of it.
// Traceability: 10E-AC-40, 10E-AC-41, 10E-AC-36 (UI), 10E-AC-38 (UI side),
// PHASE10E.md 15 (ordinary disclosure cue).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { projectToSelf } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { PlayerDrawer } from "./PlayerDrawer";
import { TravelerArrival } from "./TravelerArrival";
import { ActualAlignmentControls, PlayerFacingAlignmentControls, alignmentViewOverridden, playerFacingAlignmentId } from "./AlignmentControls";
import type { PlayerId } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const alignmentHistory = () => game().history.filter((h) => h.category === "alignment");
const registry = buildRegistry(setupScript);

function SeatDrawer({ seat }: { seat: PlayerId }) {
  const p = store((s) => s.game!.players[seat]!);
  return <PlayerDrawer player={p} />;
}
const alignmentSection = () => within(screen.getByText("Alignment (ST private)").closest("section")!);
const actualGroup = () => within(screen.getByRole("group", { name: /^Actual (Traveler )?alignment/ }));
const facingGroup = () => within(screen.getByRole("group", { name: "Player-facing alignment" }));
/** Opens the player-facing override disclosure and returns queries scoped to
 * THAT <details> element. Its buttons appear after React's asynchronous
 * disclosure-state work, so the async lookup must search only this container:
 * a whole-document role query over a large drawer can exceed Testing
 * Library's default wait budget under the parallel runner (Phase 10E
 * test-harness remediation). */
function openOverrides() {
  const disclosure = within(screen.getByText("Override what they are told…").closest("details")!);
  fireEvent.click(disclosure.getByText("Override what they are told…"));
  return disclosure;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"].forEach((n) => state().addPlayerToSeat(n));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function deal() {
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
}
function goLive() {
  deal();
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}
function liveTraveler() {
  goLive();
  state().addPlayer("Zed");
  const zed = idOf("Zed");
  state().assignRole(zed, "thief");
  return zed;
}

describe("10E-AC-40: Actual Alignment truth in the Player Drawer", () => {
  it("every occupied ordinary participant has a private Actual Alignment surface; the normal tap is a gameplay change", () => {
    goLive();
    const chef = holder("chef");
    render(<SeatDrawer seat={chef} />);
    const group = actualGroup();
    expect(group.getByText("Good", { selector: ".label" })).toBeInTheDocument();
    expect(group.getByRole("button", { name: "Good" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(group.getByRole("button", { name: "Evil" }));
    expect(player(chef).actualAlignment).toBe("evil");
    expect(alignmentHistory()).toHaveLength(1);
    expect(alignmentHistory()[0]).not.toHaveProperty("correction");
    expect(actualGroup().getByText("Evil", { selector: ".label" })).toBeInTheDocument();
  });

  it("correction is a closed disclosure; opened, it records a CORRECTION", async () => {
    goLive();
    const chef = holder("chef");
    render(<SeatDrawer seat={chef} />);
    expect(alignmentSection().queryByRole("button", { name: "Correct to Evil" })).toBeNull();
    fireEvent.click(screen.getByText("Correct the recorded alignment…"));
    fireEvent.click(await alignmentSection().findByRole("button", { name: "Correct to Evil" }));
    expect(player(chef).actualAlignment).toBe("evil");
    expect(alignmentHistory()[0]).toMatchObject({ correction: true });
  });

  it("before Reveal no correction is offered (a plain change already repairs Setup); after Reveal the normal tap is locked and correction remains", async () => {
    deal();
    const { unmount } = render(<SeatDrawer seat={holder("chef")} />);
    expect(screen.queryByText("Correct the recorded alignment…")).toBeNull();
    expect(actualGroup().getByRole("button", { name: "Evil" })).toBeEnabled();
    unmount();
    expect(state().revealRoles().ok).toBe(true);
    const chef = holder("chef");
    render(<SeatDrawer seat={chef} />);
    expect(actualGroup().getByRole("button", { name: "Evil" })).toBeDisabled();
    expect(screen.getByText(/use a correction to repair the recorded alignment/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Correct the recorded alignment…"));
    fireEvent.click(await alignmentSection().findByRole("button", { name: "Correct to Evil" }));
    expect(player(chef).actualAlignment).toBe("evil");
    expect(game().history).toEqual([]);
  });

  it("an ended game shows the recorded alignment with no actions", () => {
    goLive();
    state().setPhase("ended");
    render(<SeatDrawer seat={holder("chef")} />);
    expect(actualGroup().queryByRole("button")).toBeNull();
    expect(screen.getByText(/alignments are frozen/)).toBeInTheDocument();
    expect(screen.queryByText("Correct the recorded alignment…")).toBeNull();
  });

  it("a drawer rendered for an older state never overwrites: the click is refused stale, inline, changing nothing", () => {
    goLive();
    const chef = holder("chef");
    const rendered = player(chef);
    render(<PlayerDrawer player={rendered} />);
    expect(state().setActualAlignment(chef, "evil")).toMatchObject({ ok: true });
    const after = player(chef);
    const seq = state().localSeq;
    fireEvent.click(actualGroup().getByRole("button", { name: "Good" }));
    expect(player(chef)).toBe(after);
    expect(state().localSeq).toBe(seq);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/nothing was changed/i);
    expect(alert.textContent).not.toMatch(/\b(good|evil)\b/i);
  });

  it("a drawer rendered for Alice never changes Bob after the seat is reused", () => {
    goLive();
    const seat = holder("chef");
    render(<PlayerDrawer player={player(seat)} />);
    state().unseatPlayer(seat);
    state().addToPendingQueue("uid-bob", "Bob2");
    expect(state().assignPendingToSeat("uid-bob", seat)).toBe(true);
    const bob = player(seat);
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(player(seat)).toBe(bob);
    expect(screen.getByRole("alert")).toHaveTextContent(/nothing was changed/i);
  });
});

describe("10E-AC-41: player-facing alignment -- Normal by default, overrides disclosed, override cue", () => {
  it("Normal needs no action and shows no cue; an explicit override shows 'View overridden'; Not told omits the alignment for the player", async () => {
    goLive();
    const chef = holder("chef");
    state().setShownAlignment(chef, null);
    render(<SeatDrawer seat={chef} />);
    expect(facingGroup().getByRole("button", { name: "Normal (Good)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("View overridden")).toBeNull();
    expect(screen.queryByRole("button", { name: "Shown Evil" })).toBeNull(); // overrides are disclosed, not shown
    fireEvent.click(await openOverrides().findByRole("button", { name: "Shown Evil" }));
    expect(player(chef).shownAlignment).toBe("evil");
    expect(screen.getByText("View overridden")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not told" }));
    expect(player(chef).shownAlignment).toBe("undisclosed");
    expect(projectToSelf(player(chef), registry)).toEqual({ shownRole: "chef" });
    expect(screen.getByText("View overridden")).toBeInTheDocument();
    fireEvent.click(facingGroup().getByRole("button", { name: "Normal (Good)" }));
    expect(player(chef).shownAlignment).toBeNull();
    expect(screen.queryByText("View overridden")).toBeNull();
    expect(alignmentHistory()).toEqual([]); // perception writes no Alignment History
    expect(player(chef).actualAlignment).toBe("good");
  });

  it("a Traveler's Normal follows their Actual Alignment; overrides go through the same perception seam; no copy action exists", async () => {
    const zed = liveTraveler();
    render(<SeatDrawer seat={zed} />);
    expect(screen.getByRole("group", { name: /Actual Traveler alignment/ })).toBeInTheDocument();
    expect(facingGroup().getByRole("button", { name: "Normal (not chosen)" })).toBeInTheDocument();
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(facingGroup().getByRole("button", { name: "Normal (Evil)" })).toHaveAttribute("aria-pressed", "true");
    expect(projectToSelf(player(zed), registry)).toEqual({ shownRole: "thief", shownAlignment: "evil" });
    expect(screen.queryByRole("button", { name: /show alignment to traveler/i })).toBeNull();
    fireEvent.click(await openOverrides().findByRole("button", { name: "Shown Good" }));
    expect(player(zed)).toMatchObject({ actualAlignment: "evil", shownAlignment: "good" });
    expect(screen.getByText("View overridden")).toBeInTheDocument();
    // A later Actual change still withdraws any packet (the label stays Good).
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed), publishedPacket: { id: "k", payload: { shownRole: "thief", shownAlignment: "good" } } } } } });
    fireEvent.click(actualGroup().getByRole("button", { name: "Good" }));
    expect(player(zed).publishedPacket).toBeUndefined();
    expect(projectToSelf(player(zed), registry)!.shownAlignment).toBe("good");
  });

});

// SOL-10E-R1 (PHASE10E.md 15 / 25, 10E-AC-41): "View overridden" is semantic --
// a meaningful departure from what Normal CURRENTLY tells the player, never
// mere non-null storage. Stored values are never normalized to suppress it.
describe("SOL-10E-R1: semantic 'View overridden'", () => {
  const cue = () => screen.queryByText("View overridden");
  const traveler = () => {
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    state().assignRole(zed, "thief");
    return zed;
  };

  it("a normal Deal's explicit stored alignment equal to Normal shows no cue -- and is not rewritten", () => {
    goLive();
    const chef = holder("chef");
    const imp = holder("imp");
    expect(player(chef).shownAlignment).toBe("good"); // Setup's dealtIdentity stores the derived value explicitly
    expect(player(imp).shownAlignment).toBe("evil");
    for (const id of [chef, imp]) {
      const { unmount } = render(<SeatDrawer seat={id} />);
      expect(cue()).toBeNull();
      expect(screen.queryByRole("button", { name: "Shown Good" })).toBeNull(); // nothing to disclose: closed
      unmount();
    }
    expect(player(chef).shownAlignment).toBe("good"); // never auto-cleared
    expect(player(imp).shownAlignment).toBe("evil");
    expect(alignmentViewOverridden(player(chef), registry)).toBe(false);
    expect(alignmentViewOverridden(player(imp), registry)).toBe(false);
  });

  it("an explicit ordinary alignment differing from Normal shows the cue (Good where Normal is Evil, Evil where Normal is Good)", () => {
    goLive();
    const chef = holder("chef");
    const imp = holder("imp");
    state().setShownAlignment(chef, "evil");
    state().setShownAlignment(imp, "good");
    for (const id of [chef, imp]) {
      const { unmount } = render(<SeatDrawer seat={id} />);
      expect(cue()).toBeInTheDocument();
      unmount();
    }
    expect(alignmentViewOverridden(player(chef), registry)).toBe(true);
    expect(alignmentViewOverridden(player(imp), registry)).toBe(true);
  });

  it("a Traveler's explicit value equal to their Actual Alignment shows no cue; a differing one does", () => {
    goLive();
    const zed = traveler();
    state().setTravelerAlignment(zed, "evil");
    state().setShownAlignment(zed, "evil");
    const { unmount } = render(<SeatDrawer seat={zed} />);
    expect(cue()).toBeNull();
    unmount();
    state().setShownAlignment(zed, "good");
    render(<SeatDrawer seat={zed} />);
    expect(cue()).toBeInTheDocument();
  });

  it.each(["good", "evil"] as const)("a Traveler with unresolved Actual Alignment and explicit %s shows the cue", (value) => {
    goLive();
    const zed = traveler();
    expect(player(zed).actualAlignment).toBeUndefined();
    state().setShownAlignment(zed, value);
    render(<SeatDrawer seat={zed} />);
    expect(cue()).toBeInTheDocument();
  });

  it("Not told (undisclosed) always shows the cue -- ordinary, resolved Traveler and unresolved Traveler", () => {
    goLive();
    const chef = holder("chef");
    const zed = traveler();
    const yan = (() => { state().addPlayer("Yan"); const id = idOf("Yan"); state().assignRole(id, "beggar"); return id; })();
    state().setTravelerAlignment(zed, "good");
    for (const id of [chef, zed, yan]) {
      state().setShownAlignment(id, "undisclosed");
      const { unmount } = render(<SeatDrawer seat={id} />);
      expect(cue()).toBeInTheDocument();
      unmount();
      expect(alignmentViewOverridden(player(id), registry)).toBe(true);
    }
  });

  it("Normal (null) never shows the cue", () => {
    goLive();
    const zed = traveler();
    for (const id of [holder("chef"), zed]) {
      state().setShownAlignment(id, null);
      const { unmount } = render(<SeatDrawer seat={id} />);
      expect(cue()).toBeNull();
      unmount();
    }
  });

  it("when Normal later changes, an already-stored explicit value becomes meaningfully overridden and the cue appears by itself", () => {
    goLive();
    // Traveler: explicit Good equal to Actual Good -> the Actual becomes Evil.
    const zed = traveler();
    state().setTravelerAlignment(zed, "good");
    state().setShownAlignment(zed, "good");
    const { unmount } = render(<SeatDrawer seat={zed} />);
    expect(cue()).toBeNull();
    act(() => { state().setTravelerAlignment(zed, "evil"); });
    expect(cue()).toBeInTheDocument();
    expect(player(zed).shownAlignment).toBe("good"); // the stored value itself never moved
    unmount();
    // Ordinary: the dealt explicit Good stays, but the Shown Role becomes an
    // Evil character, so Normal now tells Evil.
    const chef = holder("chef");
    render(<SeatDrawer seat={chef} />);
    expect(cue()).toBeNull();
    act(() => { state().setPerception(chef, { shownRole: "imp", shownAlignment: "good" }); });
    expect(player(chef).shownAlignment).toBe("good");
    expect(cue()).toBeInTheDocument();
  });
});

describe("PHASE10E.md 15: ordinary disclosure advisory", () => {
  it("after an ordinary Actual change, a concise cue says the player view differs and directs to the perception control; it never decides disclosure", async () => {
    goLive();
    const chef = holder("chef");
    state().setShownAlignment(chef, null);
    render(<SeatDrawer seat={chef} />);
    expect(screen.queryByText(/Player view differs/)).toBeNull();
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(screen.getByText(/Player view differs from the new alignment/)).toBeInTheDocument();
    expect(player(chef).shownAlignment).toBeNull(); // nothing was decided automatically
    fireEvent.click(screen.getByRole("button", { name: "Review player view" }));
    expect(document.activeElement).toBe(document.getElementById(playerFacingAlignmentId(player(chef))));
    // The Storyteller chooses to tell them Evil: the views agree, the cue goes.
    fireEvent.click(await openOverrides().findByRole("button", { name: "Shown Evil" }));
    expect(screen.queryByText(/Player view differs/)).toBeNull();
  });

  it("SOL-10E-R2: a correction reaching the same final Actual Alignment never arms the advisory (Live Play and after Reveal)", async () => {
    goLive();
    const chef = holder("chef");
    state().setShownAlignment(chef, null);
    render(<SeatDrawer seat={chef} />);
    fireEvent.click(screen.getByText("Correct the recorded alignment…"));
    fireEvent.click(await alignmentSection().findByRole("button", { name: "Correct to Evil" }));
    expect(player(chef).actualAlignment).toBe("evil");
    expect(alignmentHistory().at(-1)).toMatchObject({ correction: true });
    // The player view does differ (derived Good vs Actual Evil), yet a repair
    // of the record is not a newly experienced change: no advisory.
    expect(projectToSelf(player(chef), registry)!.shownAlignment).toBe("good");
    expect(screen.queryByText(/Player view differs/)).toBeNull();
    // A later GAMEPLAY change does arm it when the view differs.
    fireEvent.click(actualGroup().getByRole("button", { name: "Good" }));
    expect(screen.queryByText(/Player view differs/)).toBeNull(); // Good again: the derived Good now matches
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(screen.getByText(/Player view differs from the new alignment/)).toBeInTheDocument();
  });

  it("SOL-10E-R2: in the Reveal window only corrections are possible, and they never arm the advisory", async () => {
    deal();
    expect(state().revealRoles().ok).toBe(true);
    const imp = holder("imp");
    state().setShownAlignment(imp, null);
    render(<SeatDrawer seat={imp} />);
    fireEvent.click(screen.getByText("Correct the recorded alignment…"));
    fireEvent.click(await alignmentSection().findByRole("button", { name: "Correct to Good" }));
    expect(player(imp).actualAlignment).toBe("good");
    expect(screen.queryByText(/Player view differs/)).toBeNull();
  });

  it("no cue when the player view already matches, and none for a Traveler (Normal follows Actual)", () => {
    goLive();
    const chef = holder("chef");
    state().setShownAlignment(chef, "evil");
    const { unmount } = render(<SeatDrawer seat={chef} />);
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(screen.queryByText(/Player view differs/)).toBeNull();
    unmount();
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    state().assignRole(zed, "thief");
    render(<SeatDrawer seat={zed} />);
    fireEvent.click(actualGroup().getByRole("button", { name: "Evil" }));
    expect(screen.queryByText(/Player view differs/)).toBeNull();
  });
});

describe("10E-AC-36: Privacy Mode suppresses private alignment values, controls, cues and refusal detail", () => {
  it("the drawer safe view and the standalone controls render no alignment detail", () => {
    const zed = liveTraveler();
    const chef = holder("chef");
    state().setActualAlignment(chef, "evil");
    state().setShownAlignment(chef, "undisclosed");
    state().setTravelerAlignment(zed, "evil");
    usePrivacyStore.setState({ enabled: true });
    for (const id of [chef, zed]) {
      const { container, unmount } = render(<SeatDrawer seat={id} />);
      for (const text of [/Actual alignment/, /Player-facing alignment/, /View overridden/, /Correct the recorded alignment/, /Not told/, /\bEvil\b/]) {
        expect(screen.queryByText(text)).toBeNull();
      }
      expect(container.textContent).not.toMatch(/evil|undisclosed/i);
      unmount();
    }
    const { container } = render(<><ActualAlignmentControls player={player(chef)} /><PlayerFacingAlignmentControls player={player(chef)} /><TravelerArrival playerId={zed} /></>);
    expect(screen.queryByRole("group", { name: /alignment/i })).toBeNull();
    expect(container.textContent).not.toMatch(/evil|alignment/i);
  });

  it("an inline refusal disappears when Privacy Mode turns on", () => {
    goLive();
    const chef = holder("chef");
    render(<PlayerDrawer player={player(chef)} />);
    state().setActualAlignment(chef, "evil");
    fireEvent.click(actualGroup().getByRole("button", { name: "Good" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Traveler arrival uses the same seams", () => {
  it("an unresolved Traveler after Reveal may receive a starting alignment from the arrival controls; then it is locked until Night 1", async () => {
    deal();
    expect(state().revealRoles().ok).toBe(true);
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    render(<SeatDrawer seat={zed} />);
    fireEvent.click(actualGroup().getByRole("button", { name: "Good" }));
    expect(player(zed).actualAlignment).toBe("good");
    await waitFor(() => expect(actualGroup().getByRole("button", { name: "Evil" })).toBeDisabled());
    expect(game().history).toEqual([]);
  });
});
