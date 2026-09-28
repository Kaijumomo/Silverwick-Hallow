// Phase 10D: the Player Drawer's Role/perception workflow. Routine operation
// stays fast (one tap, no forms); "Clear role" is gone; every picker offers
// only what the Role seam accepts; changes are bound to the participation the
// drawer rendered (stale -> refused inline, never overwritten); advanced
// correction is progressively disclosed; Privacy Mode renders no Role detail;
// an unsafe Shown Role surfaces a Storyteller-only "Needs check".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { PlayerDrawer } from "./PlayerDrawer";
import { TravelerArrival } from "./TravelerArrival";
import type { PlayerId } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const roleHistory = () => game().history.filter((h) => h.category === "role");

function SeatDrawer({ seat }: { seat: PlayerId }) {
  const p = store((s) => s.game!.players[seat]!);
  return <PlayerDrawer player={p} />;
}
const behaviorSection = () => within(screen.getByText("Behavior & deception").closest("section")!);
const actualSection = () => within(screen.getByText("Actual role (ST private)").closest("section")!);

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

describe("no 'Clear role', and pickers offer only what the seam accepts", () => {
  it("the ordinary live Drawer has no Clear role action (before assignment, before Reveal, and in live play)", () => {
    const { unmount } = render(<SeatDrawer seat={idOf("Alice")} />);
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
    fireEvent.click(within(screen.getByText("Actual role (ST private)").closest("section")!).getByRole("button", { name: "Chef townsfolk" }));
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
    unmount();
    goLive();
    render(<SeatDrawer seat={holder("chef")} />);
    expect(screen.queryByRole("button", { name: /clear role/i })).toBeNull();
  });

  it("the Actual and Shown pickers never offer a Traveler, Fabled or Loric character (an ordinary player)", () => {
    goLive();
    render(<SeatDrawer seat={holder("chef")} />);
    for (const section of [actualSection(), behaviorSection()]) {
      const titles = section.getAllByText(/^(townsfolk|outsider|minion|demon|traveler|fabled|loric)$/, { selector: ".role-picker-group-title" }).map((el) => el.textContent);
      expect(titles.length).toBeGreaterThan(0);
      expect(titles.every((t) => ["townsfolk", "outsider", "minion", "demon"].includes(t!))).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /Thief traveler/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Djinn/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bootlegger/ })).toBeNull();
  });
});

describe("routine operation goes through the Role seam", () => {
  it("picking a new Actual role in live play is ONE commit: one Undo entry, one localSeq step, one Role History record; perception is unchanged", () => {
    goLive();
    const id = holder("chef");
    const before = player(id);
    render(<SeatDrawer seat={id} />);
    const seq = state().localSeq;
    fireEvent.click(actualSection().getByRole("button", { name: "Saint outsider" }));
    expect(state().localSeq).toBe(seq + 1);
    expect(state().undoStack).toHaveLength(1);
    expect(player(id)).toMatchObject({ actualRole: "saint", shownRole: before.shownRole, shownAlignment: before.shownAlignment });
    expect(roleHistory()).toHaveLength(1);
    expect(roleHistory()[0]).not.toHaveProperty("correction");
  });

  it("'Also show the player the new role' commits the Actual change and the explicit perception in the SAME resolution", () => {
    goLive();
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Also show the player the new role" }));
    const seq = state().localSeq;
    fireEvent.click(actualSection().getByRole("button", { name: "Monk townsfolk" }));
    expect(state().localSeq).toBe(seq + 1);
    expect(state().undoStack).toHaveLength(1);
    expect(player(id)).toMatchObject({ actualRole: "monk", shownRole: "monk", shownAlignment: null });
    expect(roleHistory()).toHaveLength(1); // perception writes no Role History
    act(() => state().undo());
    expect(player(id).actualRole).toBe("chef");
    expect(player(id).shownRole).toBe("chef");
  });

  it("'Show assigned role' and picking the identical shown role are true no-ops (no Undo, no localSeq, nothing cleared)", () => {
    goLive();
    const id = holder("chef");
    state().setShownAlignment(id, "evil");
    state().setPrivateText(id, "draft");
    render(<SeatDrawer seat={id} />);
    const undo = state().undoStack.length; const seq = state().localSeq;
    fireEvent.click(screen.getByRole("button", { name: "Show assigned role" }));
    fireEvent.click(behaviorSection().getByRole("button", { name: "Chef townsfolk" }));
    expect(state().undoStack).toHaveLength(undo);
    expect(state().localSeq).toBe(seq);
    expect(player(id)).toMatchObject({ shownRole: "chef", shownAlignment: "evil", privateInfo: { extraText: "draft" } });
  });

  it("Shown alignment, behavior mode and 'clear' are explicit perception changes; a refusal is shown inline and changes nothing", () => {
    goLive();
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    fireEvent.click(behaviorSection().getByRole("button", { name: "evil" }));
    expect(player(id).shownAlignment).toBe("evil");
    fireEvent.change(behaviorSection().getByLabelText("Mode:"), { target: { value: "custom" } });
    expect(player(id).behaviorMode).toBe("custom");
    fireEvent.click(behaviorSection().getByRole("button", { name: "clear" }));
    expect(player(id)).toMatchObject({ shownRole: null, shownAlignment: null });
    // No alignment without a character: refused, explained, nothing changed.
    const before = player(id);
    fireEvent.click(behaviorSection().getByRole("button", { name: "good" }));
    expect(player(id)).toBe(before);
    expect(screen.getByRole("alert")).toHaveTextContent(/choose a character to show/i);
  });
});

describe("participation-bound and stale-safe", () => {
  it("a Drawer rendered for one participant never overwrites its replacement: the change is refused stale, inline", () => {
    goLive();
    const seat = holder("chef");
    const stale = player(seat);
    render(<PlayerDrawer player={stale} />);
    state().unseatPlayer(seat);
    state().addToPendingQueue("uid-new", "Newbie");
    expect(state().assignPendingToSeat("uid-new", seat)).toBe(true);
    const replacement = player(seat);
    const seq = state().localSeq;
    fireEvent.click(actualSection().getByRole("button", { name: "Saint outsider" }));
    expect(player(seat)).toBe(replacement);
    expect(state().localSeq).toBe(seq);
    expect(screen.getByRole("alert")).toHaveTextContent(/nothing was changed/i);
    // The refusal names no character.
    expect(screen.getByRole("alert").textContent).not.toMatch(/saint|chef/i);
  });
});

describe("advanced correction is progressively disclosed", () => {
  it("no correction control before the Reveal; after Night 1 begins it is a closed disclosure whose picker records a CORRECTION and keeps abilityUsed", async () => {
    render(<SeatDrawer seat={idOf("Alice")} />);
    expect(screen.queryByText("Correct the recorded role…")).toBeNull();
    cleanup();
    goLive();
    const id = holder("chef");
    state().setAbilityUsed(id, true);
    render(<SeatDrawer seat={id} />);
    const summary = screen.getByText("Correct the recorded role…");
    const picker = () => actualSection().queryAllByRole("button", { name: "Saint outsider" });
    expect(picker()).toHaveLength(1); // only the ordinary Actual picker: the correction picker is closed
    fireEvent.click(summary);
    await waitFor(() => expect(picker()).toHaveLength(2));
    const correctionPicker = within(summary.closest("details")!);
    fireEvent.click(correctionPicker.getByRole("button", { name: "Saint outsider" }));
    expect(player(id)).toMatchObject({ actualRole: "saint", abilityUsed: true });
    expect(roleHistory()).toHaveLength(1);
    expect(roleHistory()[0]!.correction).toBe(true);
  });

  it("between the initial Reveal and Night 1 the ordinary picker stays read-only and a correction repairs the starting assignment (no History)", async () => {
    state().setRolePool(standardRoles(7));
    state().dealRolePool();
    for (const id of game().seatOrder) needsShownIdentity(player(id).actualRole) ? state().setShownRole(id, "chef") : state().showAssignedRole(id);
    expect(state().revealRoles().ok).toBe(true);
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    expect(screen.getByText(/starting ordinary assignment is locked/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Correct the recorded role…"));
    const disclosure = within(screen.getByText("Correct the recorded role…").closest("details")!);
    fireEvent.click(await disclosure.findByRole("button", { name: "Saint outsider" }));
    expect(player(id).actualRole).toBe("saint");
    expect(game().history).toHaveLength(0);
    expect(game().phase).toBe("setup");
  });
});

describe("Traveler public character", () => {
  function travelerSeat() {
    goLive();
    state().addPlayer("Zed");
    return idOf("Zed");
  }
  it("choosing a Traveler character goes through the seam; the placeholder is not a selectable 'clear'", () => {
    const zed = travelerSeat();
    render(<SeatDrawer seat={zed} />);
    const select = screen.getByLabelText("Public character") as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: "Choose Traveler" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "thief" } });
    expect(player(zed)).toMatchObject({ actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief" });
    expect(roleHistory()).toHaveLength(1);
    fireEvent.change(select, { target: { value: "" } });
    expect(player(zed).actualRole).toBe("thief");
  });

  it("the Traveler picker lists the canonical catalogue (including Cacklejack)", () => {
    const zed = travelerSeat();
    render(<TravelerArrival playerId={zed} />);
    expect(screen.getByRole("option", { name: "Cacklejack" })).toBeInTheDocument();
  });
});

describe("Privacy Mode", () => {
  it("renders no Role transition detail: the safe view has no pickers, corrections, perception controls or role names, and a refusal never names a character", () => {
    goLive();
    const id = holder("chef");
    render(<SeatDrawer seat={id} />);
    expect(screen.getByText("Correct the recorded role…")).toBeInTheDocument();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.getByText("Storyteller details are hidden while Privacy Mode is on.")).toBeInTheDocument();
    expect(screen.queryByText("Correct the recorded role…")).toBeNull();
    expect(screen.queryByText("Actual role (ST private)")).toBeNull();
    expect(screen.queryByText("Behavior & deception")).toBeNull();
    expect(screen.queryByRole("button", { name: /Saint outsider|Chef townsfolk/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Chef|Saint|Imp\b/);
    // Turning Privacy Mode off restores the drawer; it does not resurrect stale detail.
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.getByText("Correct the recorded role…")).toBeInTheDocument();
  });
});

describe("Needs check for an unsafe Shown Role (Storyteller-only)", () => {
  function plantUnsafe() {
    goLive();
    const id = holder("chef");
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), shownRole: "not-a-role" } } } });
    return id;
  }
  it("the Drawer says so and stays usable; choosing what to show resolves it", () => {
    const id = plantUnsafe();
    render(<SeatDrawer seat={id} />);
    expect(screen.getByText(/the shown character cannot be sent/i)).toBeInTheDocument();
    fireEvent.click(behaviorSection().getByRole("button", { name: "Librarian townsfolk" }));
    expect(player(id).shownRole).toBe("librarian");
    expect(screen.queryByText(/the shown character cannot be sent/i)).toBeNull();
  });

  it("the Grimoire token carries a concise 'Needs check' -- and under Privacy Mode nothing is rendered at all", () => {
    const id = plantUnsafe();
    render(<GrimoireCircle />);
    const token = screen.getByRole("button", { name: new RegExp(`^${player(id).name}, seat`) });
    expect(token.getAttribute("aria-label")).toMatch(/needs check/i);
    expect(within(token).getByText("Needs check")).toBeInTheDocument();
    act(() => usePrivacyStore.getState().setEnabled(true));
    const hidden = screen.getByRole("button", { name: new RegExp(`^${player(id).name}, seat`) });
    expect(hidden.getAttribute("aria-label")).not.toMatch(/needs check/i);
    expect(within(hidden).queryByText("Needs check")).toBeNull();
  });
});
