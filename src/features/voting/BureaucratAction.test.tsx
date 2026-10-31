import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BureaucratAction } from "./BureaucratAction";
import { captureVotingContext, useStorytellerStore as store } from "@/stores/storytellerStore";
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
const apply = () => store.getState().resolveVoting({ kind: "bureaucrat", modifierId: "mod-1", source: bind(game(), "p0"), target: bind(game(), "p1"),
  code: game().code, day: game().day, expectedRevision: game().voting?.revision ?? 0 } as never, captureVotingContext());

// Package 4: the Reminder controls panel is retired; the ability command and the linked-token removal (board/marks.ts) are
// the same coordinator commands, so they are driven directly.
it("official ability invokes the voting adjustment, while a typed reminder with the same label stays inert", () => {
  store.getState().addReminder("p1", { label: "3 Votes" });
  expect(game().players.p1!.reminders).toHaveLength(1);
  expect(game().voting).toBeUndefined();
  expect(apply().ok).toBe(true);
  expect(voteWeight(game(), bind(game(), "p1"), { registry: buildRegistry(proofScript), script: proofScript })).toEqual({ known: true, value: 3 });
  expect(game().players.p1!.reminders).toHaveLength(2);
});

it("removing the linked official token stops its voting adjustment in the same Undo action", () => {
  expect(apply().ok).toBe(true);
  const before = game(); const count = store.getState().undoStack.length;
  const modifier = game().voting!.modifiers[0]!;
  const result = store.getState().resolveVoting({ kind: "removeModifier", modifierId: modifier.id, code: game().code, day: game().day, expectedRevision: game().voting!.revision } as never, captureVotingContext());
  expect(result.ok).toBe(true);
  expect(game().voting!.modifiers).toEqual([]); expect(game().players.p1!.reminders).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(count + 1);
  act(() => store.getState().undo()); expect(game().voting).toEqual(before.voting); expect(game().players.p1!.reminders).toEqual(before.players.p1!.reminders);
});
