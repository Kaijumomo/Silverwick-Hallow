import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { PlayerDrawer } from "./PlayerDrawer";
import { roles } from "@/test/fixtures";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";

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
  store.getState().addReminder(current().id, { id: "r1", label: "Poisoned", lifetime: { kind: "manual" } });
  store.getState().addReminder(current().id, { id: "r2", label: "Secret note", lifetime: { kind: "manual" } });

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

it("Phase 9R.4 (B9): the drawer's Reminder controls go through addReminder/removeReminder -- no Live History in Setup, structured History in Live Play", () => {
  render(<Drawer />);
  const input = screen.getByPlaceholderText("Add reminder…");
  const history = () => store.getState().game!.history;

  fireEvent.change(input, { target: { value: "Setup mark" } });
  fireEvent.click(screen.getByRole("button", { name: "add" }));
  expect(current().reminders).toMatchObject([{ label: "Setup mark", lifetime: { kind: "manual" } }]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Setup mark" }));
  expect(current().reminders).toEqual([]);
  expect(history()).toEqual([]);

  act(() => store.setState({ game: { ...store.getState().game!, phase: "night", day: 1 } }));
  fireEvent.change(input, { target: { value: "Live mark" } });
  fireEvent.click(screen.getByRole("button", { name: "add" }));
  expect(history().at(-1)).toMatchObject({ category: "reminder", change: { kind: "added", item: { label: "Live mark" } } });
  fireEvent.click(screen.getByRole("button", { name: "Remove Live mark" }));
  expect(current().reminders).toEqual([]);
  expect(history().at(-1)).toMatchObject({ category: "reminder", change: { kind: "removed", item: { label: "Live mark" } } });
  expect(history()).toHaveLength(2);
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

// Phase 9C.5 (OPUS-005): ST notes become component-local draft state.
// Typing must never reach the store; a boundary (blur or close) commits the
// final value exactly once.
describe("ST notes edit-session boundary (Phase 9C.5)", () => {
  const notesField = () => screen.getByPlaceholderText("Private notes for this seat…");

  it("typing stays local; blur commits exactly once with one meaningful undo entry, and undo restores the prior value", () => {
    const id = current().id;
    store.getState().setNotes(id, "A");
    const seqBefore = store.getState().localSeq;
    const undoLengthBefore = store.getState().undoStack.length;
    render(<Drawer />);
    const notes = notesField();
    const gameBeforeTyping = store.getState().game;

    fireEvent.change(notes, { target: { value: "AB" } });
    fireEvent.change(notes, { target: { value: "AB2" } });
    fireEvent.change(notes, { target: { value: "B" } });

    // Before blur: authoritative state, localSeq, and undo are all untouched,
    // and the `game` reference itself never changed (no reference-change
    // notification attributable to typing).
    expect(notes).toHaveValue("B");
    expect(current().stNotes).toBe("A");
    expect(store.getState().localSeq).toBe(seqBefore);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore);
    expect(store.getState().game).toBe(gameBeforeTyping);

    fireEvent.blur(notes);

    expect(current().stNotes).toBe("B");
    expect(store.getState().localSeq).toBe(seqBefore + 1);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);
    expect(store.getState().undoStack.at(-1)!.players[id]!.stNotes).toBe("A");

    // A subsequent close after the blur must not create a second commit.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(current().stNotes).toBe("B");
    expect(store.getState().localSeq).toBe(seqBefore + 1);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);

    store.getState().undo();
    expect(current().stNotes).toBe("A");
  });

  it("closing a still-dirty drawer (no prior blur) commits the draft exactly once", () => {
    store.getState().setNotes(current().id, "A");
    const seqBefore = store.getState().localSeq;
    const undoLengthBefore = store.getState().undoStack.length;
    render(<Drawer />);
    fireEvent.change(notesField(), { target: { value: "B" } });
    expect(current().stNotes).toBe("A");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(current().stNotes).toBe("B");
    expect(store.getState().localSeq).toBe(seqBefore + 1);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);
  });

  it("an edit session that ends back at the original value produces zero authoritative mutations", () => {
    store.getState().setNotes(current().id, "A");
    const seqBefore = store.getState().localSeq;
    const undoLengthBefore = store.getState().undoStack.length;
    render(<Drawer />);
    const notes = notesField();

    fireEvent.change(notes, { target: { value: "AB" } });
    fireEvent.change(notes, { target: { value: "A" } });
    fireEvent.blur(notes);

    expect(current().stNotes).toBe("A");
    expect(store.getState().localSeq).toBe(seqBefore);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(store.getState().localSeq).toBe(seqBefore);
    expect(store.getState().undoStack.length).toBe(undoLengthBefore);
  });

  it("switching to a different player resets the draft from that player's committed notes", () => {
    store.getState().setNotes(current().id, "Alice's notes");
    store.getState().addPlayer("Bob");
    const bobId = store.getState().game!.seatOrder[1]!;
    store.getState().setNotes(bobId, "Bob's notes");

    function TwoPlayerDrawer({ playerId }: { playerId: string }) {
      const p = store(s => s.game!.players[playerId]!);
      return <PlayerDrawer player={p} />;
    }
    const view = render(<TwoPlayerDrawer playerId={current().id} />);
    expect(notesField()).toHaveValue("Alice's notes");
    fireEvent.change(notesField(), { target: { value: "unsaved edit" } });
    expect(notesField()).toHaveValue("unsaved edit");

    view.rerender(<TwoPlayerDrawer playerId={bobId} />);
    expect(notesField()).toHaveValue("Bob's notes");
    // The abandoned draft for Alice never reached the store.
    expect(store.getState().game!.players[current().id]!.stNotes).toBe("Alice's notes");
  });

  // Luna High verification revision: the Privacy Mode safe-view shell must
  // share the same close/commit boundary as the normal drawer, so switching
  // to Privacy Mode mid-edit never silently discards a dirty draft.
  describe("Privacy Mode dismissal commits a dirty notes draft (Luna High revision)", () => {
    it("the privacy-safe Close button commits the dirty draft exactly once", () => {
      const id = current().id;
      store.getState().setNotes(id, "A");
      const seqBefore = store.getState().localSeq;
      const undoLengthBefore = store.getState().undoStack.length;
      render(<Drawer />);

      fireEvent.change(notesField(), { target: { value: "B" } });
      expect(current().stNotes).toBe("A");

      act(() => usePrivacyStore.getState().setEnabled(true));
      // Switching to the privacy-safe view must not itself commit or
      // discard the still-dirty draft.
      expect(screen.getByText("Storyteller details are hidden while Privacy Mode is on.")).toBeInTheDocument();
      expect(current().stNotes).toBe("A");
      expect(store.getState().localSeq).toBe(seqBefore);
      expect(store.getState().undoStack.length).toBe(undoLengthBefore);

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(current().stNotes).toBe("B");
      expect(store.getState().localSeq).toBe(seqBefore + 1);
      expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);
    });

    it("dismissing the privacy-safe drawer with Escape commits the dirty draft exactly once", () => {
      const id = current().id;
      store.getState().setNotes(id, "A");
      const seqBefore = store.getState().localSeq;
      const undoLengthBefore = store.getState().undoStack.length;
      render(<Drawer />);

      fireEvent.change(notesField(), { target: { value: "B" } });
      act(() => usePrivacyStore.getState().setEnabled(true));
      expect(current().stNotes).toBe("A");

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });

      expect(current().stNotes).toBe("B");
      expect(store.getState().localSeq).toBe(seqBefore + 1);
      expect(store.getState().undoStack.length).toBe(undoLengthBefore + 1);
    });
  });
});

describe("Pre-Reveal Setup refinement (Phase 9 Setup finalization B3)", () => {
  function dealtGame() {
    const g = setupGame(standardRoles(5), { setupRolesDealt: true, setupRolesRevealed: false });
    store.setState({ game: g, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
    return g;
  }
  function DrawerFor({ id }: { id: string }) {
    const p = store((s) => s.game!.players[id]!);
    return <PlayerDrawer player={p} />;
  }

  it("routes the actual-role picker through the Setup-specific override, resetting shown identity for the new assignment", () => {
    const g = dealtGame();
    const target = g.seatOrder[0]!; // washerwoman, shown washerwoman
    render(<DrawerFor id={target} />);
    expect(screen.getByText(
      "Setup refinement: changing the actual role resets this player's shown identity for the new assignment."
    )).toBeVisible();

    const actualRoleSection = screen.getByText("Actual role (ST private)").closest("section")!;
    fireEvent.click(within(actualRoleSection).getByRole("button", { name: "Drunk outsider" }));

    expect(store.getState().game!.players[target]!.actualRole).toBe("drunk");
    expect(store.getState().game!.players[target]!.shownRole).toBeNull(); // reset, never preserved
  });

  it("offers Swap role with… listing the other occupied ordinary players, and performs the swap", () => {
    const g = dealtGame();
    const [a, b] = g.seatOrder as [string, string];
    render(<DrawerFor id={a} />);
    const roleBBefore = store.getState().game!.players[b]!.actualRole;
    const roleABefore = store.getState().game!.players[a]!.actualRole;

    fireEvent.change(screen.getByLabelText("Swap role with…"), { target: { value: b } });

    expect(store.getState().game!.players[a]!.actualRole).toBe(roleBBefore);
    expect(store.getState().game!.players[b]!.actualRole).toBe(roleABefore);
  });

  it("Setup refinement controls disappear once Reveal has completed", () => {
    const g = dealtGame();
    store.getState().revealRoles();
    render(<DrawerFor id={g.seatOrder[0]!} />);

    expect(screen.queryByLabelText("Swap role with…")).toBeNull();
    expect(screen.queryByText(/^Setup refinement:/)).toBeNull();
  });

  it("FINAL SETUP INTEGRATION REVISION Section 2: between Reveal and Night 1, the ordinary role picker is read-only -- never a fallback to assignRole()", () => {
    const g = dealtGame();
    store.getState().revealRoles();
    const target = g.seatOrder[0]!;
    const before = store.getState().game!.players[target]!.actualRole;
    render(<DrawerFor id={target} />);

    const actualRoleSection = screen.getByText("Actual role (ST private)").closest("section")!;
    expect(within(actualRoleSection).getByText(/locked until Night 1 begins/)).toBeInTheDocument();
    expect(within(actualRoleSection).queryByRole("button", { name: "Drunk outsider" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear role" })).toBeNull();
    expect(store.getState().game!.players[target]!.actualRole).toBe(before);
  });

  it("FINAL SETUP INTEGRATION REVISION Section 2: Traveler status is locked and hidden once roles are revealed", () => {
    const g = dealtGame();
    store.getState().revealRoles();
    render(<DrawerFor id={g.seatOrder[0]!} />);

    expect(screen.getByText(/Traveler status is locked in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not a traveler" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Traveler" })).toBeNull();
  });

  it("FINAL SETUP INTEGRATION REVISION Section 2: the generic role picker and Traveler toggle return once gameplay begins", () => {
    const g = dealtGame();
    store.getState().revealRoles();
    store.setState({ game: { ...store.getState().game!, phase: "night", day: 1 } });
    const target = g.seatOrder[0]!;
    render(<DrawerFor id={target} />);

    expect(screen.queryByText(/locked until Night 1 begins/)).toBeNull();
    const actualRoleSection = screen.getByText("Actual role (ST private)").closest("section")!;
    fireEvent.click(within(actualRoleSection).getByRole("button", { name: "Drunk outsider" }));
    expect(store.getState().game!.players[target]!.actualRole).toBe("drunk");
    expect(screen.queryByRole("button", { name: "Not a traveler" })).not.toBeNull();
  });

  it("outside the refinement window, the actual-role picker keeps the generic assignRole() behavior", () => {
    render(<Drawer />); // fresh, non-dealt game from the outer beforeEach
    expect(screen.queryByLabelText("Swap role with…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chef townsfolk" }));
    expect(current().actualRole).toBe("chef");
    const actualRoleSection = screen.getByText("Actual role (ST private)").closest("section")!;
    fireEvent.click(within(actualRoleSection).getByRole("button", { name: "Drunk outsider" }));
    // Generic assignRole() preserves whatever shown identity already existed
    // (here, still unrevealed) rather than resetting it for the new role.
    expect(current().shownRole).toBeNull();
  });
});
