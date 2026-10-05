import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { PlayerDrawer } from "./PlayerDrawer";
import { roles } from "@/test/fixtures";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { choose, chooseSegmentValue, hasChoice, pickRoleNamed } from "@/test/pickers";

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
  pickRoleNamed("Actual role", "Chef townsfolk");
  expect(current().actualRole).toBe("chef");
  expect(current().shownRole).toBeNull();
  expect(screen.getByText("Role not revealed yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Normal (—)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show assigned role" }));
  expect(current().shownRole).toBe("chef");
  expect(screen.getByRole("button", { name: "Normal (Good)" })).toBeInTheDocument();
});

it("Drunk has explicit shown-role controls even before a behavior mode is selected", () => {
  render(<Drawer />);
  pickRoleNamed("Actual role", "Drunk outsider");
  expect(screen.queryByRole("button", { name: "Show assigned role" })).toBeNull();
  const perception = within(screen.getByText("Behavior & deception").closest("section")!);
  pickRoleNamed("Shown role", "Chef townsfolk");
  expect(current().actualRole).toBe("drunk");
  expect(current().shownRole).toBe("chef");
  fireEvent.click(perception.getByRole("button", { name: "Clear Shown role" }));
  expect(current().shownRole).toBeNull();
  expect(screen.getByText("Role not revealed yet")).toBeInTheDocument();
});

it("Drunk shown as Empath gets simulated information, not Demon/Minion controls", () => {
  render(<Drawer />);
  pickRoleNamed("Actual role", "Drunk outsider");
  pickRoleNamed("Shown role", "Empath townsfolk");
  expect(screen.queryByLabelText("Information")).toBeNull();
  expect(screen.queryByText("Players shown as Minions:")).toBeNull();
  expect(screen.queryByText("Bluffs:")).toBeNull();
  expect(screen.queryByText(/Fake Demon information/)).toBeNull();
});

it("Marionette shown as Fortune Teller gets simulated information, not Demon/Minion controls", () => {
  render(<Drawer />);
  pickRoleNamed("Actual role", "Marionette minion");
  pickRoleNamed("Shown role", "Fortune Teller townsfolk");
  expect(screen.queryByLabelText("Information")).toBeNull();
  expect(screen.queryByText("Players shown as Minions:")).toBeNull();
  expect(screen.queryByText("Bluffs:")).toBeNull();
});

it("Lunatic shown as Imp retains fake Demon controls", () => {
  render(<Drawer />);
  pickRoleNamed("Actual role", "Lunatic outsider");
  chooseSegmentValue("Mode", "fake_demon_behavior");
  pickRoleNamed("Shown role", "Imp demon");
  expect(screen.getByText("Players shown as Minions:")).toBeInTheDocument();
  expect(screen.getByText("Bluffs:")).toBeInTheDocument();
  expect(screen.getByText("Demon setup information")).toBeInTheDocument();
});

it("normal players do not receive an unnecessary packet panel", () => {
  render(<Drawer />);
  pickRoleNamed("Actual role", "Chef townsfolk");
  expect(screen.queryByText(/Simulated information ·/)).toBeNull();
  expect(screen.queryByText(/Demon bluff delivery ·/)).toBeNull();
  expect(screen.queryByText("Information to send")).toBeNull();
});

it("normal Demon keeps the bluff editor without an extra freeform packet editor", () => {
  render(<Drawer />);
  pickRoleNamed("Actual role", "Imp demon");
  expect(screen.getByText("Demon bluffs (ST private)")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Send bluffs" })).toHaveLength(1);
  expect(screen.queryByText("Information to send")).toBeNull();
});

it("changing Lunatic behavior to Drunk or Normal prunes incompatible packet fields", () => {
  render(<Drawer />);
  pickRoleNamed("Actual role", "Lunatic outsider");
  chooseSegmentValue("Mode", "fake_demon_behavior");
  pickRoleNamed("Shown role", "Imp demon");
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
  pickRoleNamed("Actual role", "Drunk outsider");
  pickRoleNamed("Shown role", "Empath townsfolk");
  store.getState().addReminder(current().id, { id: "r1", label: "Poisoned" });
  store.getState().addReminder(current().id, { id: "r2", label: "Secret note" });

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

// Phase 10C: the drawer's Reminder controls now go through the bound
// Reminder seam (resolveReminders); v21 History names its operation and a
// Setup Reminder is created at {setup, 0} with no History.
it("Phase 9R.4 (B9) / 10C: the drawer's Reminder controls go through the Reminder seam -- no Live History in Setup, structured History in Live Play", () => {
  render(<Drawer />);
  const input = screen.getByPlaceholderText("Add reminder…");
  const history = () => store.getState().game!.history;

  fireEvent.change(input, { target: { value: "Setup mark" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(current().reminders).toMatchObject([{ label: "Setup mark", createdAt: { phase: "setup", day: 0 } }]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Setup mark reminder" }));
  expect(current().reminders).toEqual([]);
  expect(history()).toEqual([]);

  act(() => store.setState({ game: { ...store.getState().game!, phase: "night", day: 1 } }));
  fireEvent.change(input, { target: { value: "Live mark" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(history().at(-1)).toMatchObject({ category: "reminder", reminderOperation: "place", change: { kind: "added", item: { label: "Live mark" } } });
  fireEvent.click(screen.getByRole("button", { name: "Remove Live mark reminder" }));
  expect(current().reminders).toEqual([]);
  expect(history().at(-1)).toMatchObject({ category: "reminder", reminderOperation: "remove", change: { kind: "removed", item: { label: "Live mark" } } });
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
  pickRoleNamed("Add bluff", "Chef townsfolk", screen.getByText("Demon setup information").closest("section")!);
  expect(current().privateInfo?.bluffs).toEqual(["chef"]);
});

// Phase 10H (contract §§5.1, 9, I1): the participant workspace is NON-MODAL --
// it never inerts the Table or traps focus. (Amends the Phase 9 modal-drawer
// focus test: the Inspector is a complementary region beside the Grimoire.)
// Focus moves to the Inspector heading on open, is never left on a control
// that disappeared (Privacy Mode), and Escape returns it to the seat.
it("Phase 10H: the Inspector is non-modal -- the seat stays operable, focus is predictable across Privacy Mode, Escape restores the seat", () => {
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
  const inspector = screen.getByRole("complementary", { name: "Participant: Alice" });
  expect(inspector).not.toHaveAttribute("aria-modal");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("heading", { name: /Alice/ })).toHaveFocus();
  // Non-modal: nothing outside is inert, the page does not lock, and focus may
  // leave the Inspector for the Table and come back.
  expect(seat).not.toHaveAttribute("inert");
  expect(document.body.style.overflow).not.toBe("hidden");
  act(() => seat.focus());
  expect(seat).toHaveFocus();
  const name = screen.getByRole("textbox", { name: "Player name" });
  act(() => name.focus());
  act(() => usePrivacyStore.getState().setEnabled(true));
  // The private control is gone (DOM absence); focus lands on the heading.
  expect(screen.queryByRole("textbox", { name: "Player name" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Player" })).toHaveFocus();
  expect(seat).not.toHaveAttribute("inert");
  act(() => usePrivacyStore.getState().setEnabled(false));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(seat).toHaveFocus();
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

  // Phase 10H (contract §9) amends Phase 9C.5: a seat change COMMITS the draft
  // to the participant it was written for (never to the next one), and the
  // next participant's draft starts from their own committed notes.
  it("Phase 10H: switching to a different player commits the draft to the player it was written for, then shows the next player's notes", () => {
    store.getState().setNotes(current().id, "Alice's notes");
    store.getState().addPlayer("Bob");
    const bobId = store.getState().game!.seatOrder[1]!;
    store.getState().setNotes(bobId, "Bob's notes");
    const seqBefore = store.getState().localSeq;

    function TwoPlayerDrawer({ playerId }: { playerId: string }) {
      const p = store(s => s.game!.players[playerId]!);
      return <PlayerDrawer player={p} />;
    }
    const view = render(<TwoPlayerDrawer playerId={current().id} />);
    expect(notesField()).toHaveValue("Alice's notes");
    fireEvent.change(notesField(), { target: { value: "unsaved edit" } });
    expect(store.getState().localSeq).toBe(seqBefore); // typing stays local

    view.rerender(<TwoPlayerDrawer playerId={bobId} />);
    expect(notesField()).toHaveValue("Bob's notes");
    // Exactly one commit, to Alice -- Bob's notes are untouched.
    expect(store.getState().game!.players[current().id]!.stNotes).toBe("unsaved edit");
    expect(store.getState().game!.players[bobId]!.stNotes).toBe("Bob's notes");
    expect(store.getState().localSeq).toBe(seqBefore + 1);
  });

  // Phase 10H (contract §9: "Privacy/lifecycle teardown discards uncommitted
  // drafts rather than silently committing") amends the Phase 9C.5 Luna High
  // revision: turning Privacy Mode on DISCARDS a dirty draft -- it is never
  // committed by the privacy-safe Close or Escape, and it never reappears.
  describe("Phase 10H: Privacy Mode teardown discards a dirty notes draft", () => {
    it("the privacy-safe Close commits nothing; the draft is gone when Privacy Mode ends", () => {
      const id = current().id;
      store.getState().setNotes(id, "A");
      const seqBefore = store.getState().localSeq;
      const undoLengthBefore = store.getState().undoStack.length;
      render(<Drawer />);

      fireEvent.change(notesField(), { target: { value: "B" } });
      expect(current().stNotes).toBe("A");

      act(() => usePrivacyStore.getState().setEnabled(true));
      expect(screen.getByText("Storyteller details are hidden while Privacy Mode is on.")).toBeInTheDocument();
      expect(screen.queryByPlaceholderText("Private notes for this seat…")).toBeNull();
      act(() => usePrivacyStore.getState().setEnabled(false));
      expect(notesField()).toHaveValue("A");
      act(() => usePrivacyStore.getState().setEnabled(true));

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(current().stNotes).toBe("A");
      expect(store.getState().localSeq).toBe(seqBefore);
      expect(store.getState().undoStack.length).toBe(undoLengthBefore);
    });

    it("dismissing the privacy-safe Inspector with Escape commits nothing", () => {
      const id = current().id;
      store.getState().setNotes(id, "A");
      const seqBefore = store.getState().localSeq;
      render(<Drawer />);

      fireEvent.change(notesField(), { target: { value: "B" } });
      act(() => usePrivacyStore.getState().setEnabled(true));
      expect(current().stNotes).toBe("A");

      fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Escape" });

      expect(current().stNotes).toBe("A");
      expect(store.getState().localSeq).toBe(seqBefore);
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
    pickRoleNamed("Actual role", "Drunk outsider", actualRoleSection);

    expect(store.getState().game!.players[target]!.actualRole).toBe("drunk");
    expect(store.getState().game!.players[target]!.shownRole).toBeNull(); // reset, never preserved
  });

  it("offers Swap role with… listing the other occupied ordinary players, and performs the swap", () => {
    const g = dealtGame();
    const [a, b] = g.seatOrder as [string, string];
    render(<DrawerFor id={a} />);
    const roleBBefore = store.getState().game!.players[b]!.actualRole;
    const roleABefore = store.getState().game!.players[a]!.actualRole;

    choose("Swap role with", b);

    expect(store.getState().game!.players[a]!.actualRole).toBe(roleBBefore);
    expect(store.getState().game!.players[b]!.actualRole).toBe(roleABefore);
  });

  it("Setup refinement controls disappear once Reveal has completed", () => {
    const g = dealtGame();
    store.getState().revealRoles();
    render(<DrawerFor id={g.seatOrder[0]!} />);

    expect(hasChoice("Swap role with")).toBe(false);
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
    expect(hasChoice("Actual role", actualRoleSection)).toBe(false);
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

  it("FINAL SETUP INTEGRATION REVISION Section 2: the generic role picker returns once gameplay begins (the Setup Traveler toggle does not -- SOL-10E-A1)", () => {
    const g = dealtGame();
    store.getState().revealRoles();
    store.setState({ game: { ...store.getState().game!, phase: "night", day: 1 } });
    const target = g.seatOrder[0]!;
    render(<DrawerFor id={target} />);

    expect(screen.queryByText(/locked until Night 1 begins/)).toBeNull();
    const actualRoleSection = screen.getByText("Actual role (ST private)").closest("section")!;
    pickRoleNamed("Actual role", "Drunk outsider", actualRoleSection);
    expect(store.getState().game!.players[target]!.actualRole).toBe("drunk");
    // PHASE10E.md 26 (SOL-10E-A1): the Setup Traveler designation is not
    // actionable in Live Play; the status is shown, never toggled here.
    expect(screen.queryByRole("button", { name: "Not a traveler" })).toBeNull();
    expect(screen.getByText(/Traveler status is set up only during Setup/)).toBeInTheDocument();
  });

  it("outside the refinement window, the actual-role picker keeps the generic assignRole() behavior", () => {
    render(<Drawer />); // fresh, non-dealt game from the outer beforeEach
    expect(hasChoice("Swap role with")).toBe(false);
    pickRoleNamed("Actual role", "Chef townsfolk");
    expect(current().actualRole).toBe("chef");
    const actualRoleSection = screen.getByText("Actual role (ST private)").closest("section")!;
    pickRoleNamed("Actual role", "Drunk outsider", actualRoleSection);
    // Generic assignRole() preserves whatever shown identity already existed
    // (here, still unrevealed) rather than resetting it for the new role.
    expect(current().shownRole).toBeNull();
  });
});
