import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AbilityEntry } from "./AbilityEntry";
import { pickSeatIfPicking, useTargetPicker } from "./abilityUi";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { proofGame, proofScript } from "@/test/proofFixtures";

const game = () => store.getState().game!;
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
function Entry() {
  const player = store(state => state.game!.players.p0!);
  const privacy = usePrivacyStore(state => state.enabled);
  return privacy ? null : <AbilityEntry player={player} />;
}
beforeEach(() => {
  store.setState({ game: proofGame(["slayer", "imp", "scarletwoman", "chef", "monk"], "day", 2),
    lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.getState().cancel();
});
afterEach(cleanup);
const open = () => fireEvent.click(screen.getByRole("button", { name: "Use ability… (Slayer)" }));

it("Slayer board selection commits consumption, Imp death and mandatory succession once", () => {
  render(<Entry />); open();
  const before = game();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(store.getState().undoStack).toHaveLength(0);
  tap("p1");
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(game().players.p1!.alive).toBe(false);
  expect(game().players.p2!.actualRole).toBe("imp");
  expect(store.getState().undoStack).toHaveLength(1);
  expect(useTargetPicker.getState().active).toBeNull();
  act(() => store.getState().undo());
  expect(game().players.p0!.abilityUsed).toBe(before.players.p0!.abilityUsed);
  expect(game().players.p1!.alive).toBe(true);
  expect(game().players.p2!.actualRole).toBe("scarletwoman");
});

it.each([false, true])("Recluse choice %s resolves the entire shot once without Demon succession", demon => {
  store.setState({ game: proofGame(["slayer", "imp", "recluse", "scarletwoman", "monk"], "day", 2) });
  render(<Entry />); open(); const before = game(); tap("p2");
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toHaveLength(0);
  expect(screen.getByRole("region", { name: "Resolve Slayer shot" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Resolve Slayer shot" })).toHaveFocus();
  expect(useTargetPicker.getState().active).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: demon ? "Registers as Demon — resolve death" : "No death — does not register as Demon" }));
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(game().players.p2).toMatchObject({ alive: !demon, actualRole: "recluse", actualAlignment: "good" });
  expect(game().players.p1).toMatchObject({ alive: true, actualRole: "imp" });
  expect(game().players.p3!.actualRole).toBe("scarletwoman");
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => store.getState().undo());
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(game().players.p2!.alive).toBe(true);
});

it.each(["cancel", "privacy", "unmount", "state change"])("pending Recluse outcome cannot commit after %s", change => {
  store.setState({ game: proofGame(["slayer", "imp", "recluse", "scarletwoman", "monk"], "day", 2) });
  const view = render(<Entry />); open(); tap("p2");
  const held = screen.getByRole("button", { name: "Registers as Demon — resolve death" });
  if (change === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel shot" }));
  if (change === "privacy") act(() => usePrivacyStore.getState().setEnabled(true));
  if (change === "unmount") view.unmount();
  if (change === "state change") act(() => store.setState({ game: { ...game(), day: 3 } }));
  const before = game(); fireEvent.click(held);
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toHaveLength(0);
  expect(screen.queryByRole("region", { name: "Resolve Slayer shot" })).toBeNull();
});

it.each(["cancel", "privacy", "unmount", "state change"])("held Slayer selection cannot commit after %s", change => {
  const view = render(<Entry />); open();
  const held = useTargetPicker.getState().active!;
  if (change === "cancel") act(() => useTargetPicker.getState().cancel());
  if (change === "privacy") act(() => usePrivacyStore.getState().setEnabled(true));
  if (change === "unmount") view.unmount();
  if (change === "state change") act(() => store.setState({ game: { ...game(), day: 3 } }));
  const before = game();
  act(() => held.onPick({ playerId: "p1", participantId: before.players.p1!.participantId! }));
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toHaveLength(0);
  expect(useTargetPicker.getState().active).toBeNull();
});
