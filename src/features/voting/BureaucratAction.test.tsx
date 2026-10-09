import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BureaucratAction } from "./BureaucratAction";
import { ReminderControls } from "@/features/reminders/ReminderControls";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { bind, proofGame, proofScript } from "@/test/proofFixtures";
import { voteWeight } from "@/stores/voting";
import { buildRegistry } from "@/data/roleRegistry";

const game = () => store.getState().game!;
function Panel({ visible = true }: { visible?: boolean }) {
  const g = store(s => s.game)!;
  return <BureaucratAction source={bind(g, "p0")} visible={visible} />;
}
function Reminders() { const g = store(s => s.game)!; return <ReminderControls player={g.players.p1!} />; }
beforeEach(() => {
  store.setState({ game: proofGame(["bureaucrat", "chef", "imp", "empath", "monk"]), lobby: null, undoStack: [], localSeq: 0,
    terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
  useSessionRuntime.setState({ backend: null, status: "idle" }); usePrivacyStore.getState().reset(); useTargetPicker.getState().cancel();
});
afterEach(cleanup);

it("one board pick applies authoritative selection and official notation in one Undo step", () => {
  render(<Panel />); const before = game();
  act(() => { pickSeatIfPicking(game(), "p1"); });
  expect(game().voting!.modifiers[0]).toMatchObject({ kind: "bureaucrat", source: { playerId: "p0" }, target: { playerId: "p1" }, appliesDay: 2 });
  expect(game().players.p1!.reminders).toEqual([expect.objectContaining({ label: "3 Votes", sourceCharacter: "bureaucrat" })]);
  expect(store.getState().undoStack).toEqual([before]); expect(store.getState().localSeq).toBe(1);
  expect(useTargetPicker.getState().active).toBeNull(); expect(screen.getByRole("status")).toHaveTextContent("3 Votes recorded for Player 1");
  act(() => store.getState().undo()); expect(game().voting).toBeUndefined(); expect(game().players.p1!.reminders).toEqual([]);
});
it("source cannot choose self; hidden or privacy-suppressed callbacks cannot write", () => {
  const view = render(<Panel />); const picker = useTargetPicker.getState().active!; const before = game();
  act(() => { pickSeatIfPicking(game(), "p0"); }); expect(game()).toBe(before);
  view.rerender(<Panel visible={false} />); expect(useTargetPicker.getState().active).toBeNull();
  act(() => picker.onPick(bind(game(), "p1"))); expect(game()).toBe(before);
  view.rerender(<Panel />); act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Bureaucrat voting ability")).toBeNull(); expect(useTargetPicker.getState().active).toBeNull();
});
it("official reminder action invokes the ability, while typing the same label stays inert", () => {
  render(<Reminders />);
  fireEvent.change(screen.getByRole("textbox", { name: "Reminder text" }), { target: { value: "3 Votes" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(game().voting).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Bureaucrat · 3 Votes" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply 3 Votes from Player 0" }));
  expect(voteWeight(game(), bind(game(), "p1"), { registry: buildRegistry(proofScript), script: proofScript })).toEqual({ known: true, value: 3 });
  expect(game().players.p1!.reminders).toHaveLength(2);
});

it("removing the linked official token stops its voting adjustment in the same Undo action", () => {
  render(<Reminders />);
  fireEvent.click(screen.getByRole("button", { name: "Bureaucrat · 3 Votes" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply 3 Votes from Player 0" }));
  const before = game(); const count = store.getState().undoStack.length;
  fireEvent.click(screen.getByRole("button", { name: "Remove 3 Votes reminder" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove 3 Votes reminder" }));
  expect(game().voting!.modifiers).toEqual([]); expect(game().players.p1!.reminders).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(count + 1);
  act(() => store.getState().undo()); expect(game().voting).toEqual(before.voting); expect(game().players.p1!.reminders).toEqual(before.players.p1!.reminders);
});
