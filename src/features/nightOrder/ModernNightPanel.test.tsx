import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "./ModernNightPanel";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { clearNightActionCorrections } from "@/stores/nightActionCorrection";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { proofGame, proofScript } from "@/test/proofFixtures";

function Guide({ visible = true }: { visible?: boolean }) {
  const game = store(s => s.game)!;
  return <ModernNightPanel game={game} script={proofScript} visible={visible} onClose={() => {}} />;
}
const game = () => store.getState().game!;
const current = () => useShellStore.getState().nightCursor?.stepKey;
const key = (id: string) => participantStepKey(game().players[id]!.participantId!, game().players[id]!.shownRole!);
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
beforeEach(() => {
  vi.useFakeTimers();
  store.setState({ game: proofGame(["poisoner", "monk", "imp", "empath", "chef"]), lobby: null, undoStack: [], localSeq: 0,
    customScripts: { [proofScript.id]: proofScript } });
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel(); clearNightActionCorrections();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("resolves a direct board target once, holds the result briefly, and advances only after commit", () => {
  render(<Guide />);
  expect(current()).toBe(key("p0"));
  expect(useShellStore.getState().litActor?.playerId).toBe("p0");
  expect(useTargetPicker.getState().active).not.toBeNull();
  tap("p4");
  expect(game().players.p4!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  expect(game().nightProgress[`2:${key("p0")}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  expect(current()).toBe(key("p0"));
  expect(screen.getByRole("status")).toHaveTextContent("Resolved");
  act(() => vi.advanceTimersByTime(2200));
  expect(current()).toBe(key("p1"));
  expect(useShellStore.getState().litActor?.playerId).toBe("p1");
});

it("Previous does not change game state and a new target moves the resolved effect atomically", () => {
  render(<Guide />); tap("p4");
  act(() => vi.advanceTimersByTime(2200));
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "‹ Previous" }));
  expect(current()).toBe(key("p0")); expect(game()).toBe(before);
  tap("p3");
  expect(game().players.p4!.effects).toHaveLength(0);
  expect(game().players.p3!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  expect(store.getState().undoStack).toHaveLength(2);
});

it("a hidden panel suspends targeting and reopening continues the same step", () => {
  const view = render(<Guide />);
  const stalePick = useTargetPicker.getState().active!;
  const before = game();
  view.rerender(<Guide visible={false} />);
  expect(useTargetPicker.getState().active).toBeNull();
  act(() => stalePick.onPick({ playerId: "p4", participantId: game().players.p4!.participantId! }));
  expect(game()).toBe(before);
  view.rerender(<Guide />);
  expect(current()).toBe(key("p0"));
  expect(useTargetPicker.getState().active).not.toBeNull();
});

it("cancel leaves normal inspection available until targeting is resumed", () => {
  render(<Guide />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel selection" }));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(pickSeatIfPicking(game(), "p4")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Choose on board" }));
  expect(useTargetPicker.getState().active).not.toBeNull();
});

it("invalid Monk self-target neither resolves nor advances", () => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p1") });
  render(<Guide />);
  const before = game(); tap("p1");
  expect(game()).toBe(before); expect(current()).toBe(key("p1"));
  expect(screen.getByRole("alert")).toHaveTextContent("can't be chosen");
  act(() => vi.advanceTimersByTime(5000));
  expect(current()).toBe(key("p1"));
});

it("judgment and information actions keep the existing workspace and never resolve merely by tapping", () => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p3") });
  render(<Guide />);
  expect(useTargetPicker.getState().active).toBeNull();
  const before = game();
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  expect(screen.getByRole("dialog").parentElement).toHaveAttribute("id", "action-card-dock-host");
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(game()).toBe(before); expect(current()).toBe(key("p3"));
});

it("manual navigation and privacy cancel delayed advancement and pending picks", () => {
  render(<Guide />); tap("p4");
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  const chosen = current();
  act(() => vi.advanceTimersByTime(5000)); expect(current()).toBe(chosen);
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(useShellStore.getState().litActor).toBeNull();
  expect(screen.queryByLabelText("Night 2 guide")).toBeNull();
});

it("later resolved work prevents an unsafe retarget while Previous remains usable", () => {
  render(<Guide />); tap("p4"); act(() => vi.advanceTimersByTime(2200)); tap("p3");
  fireEvent.click(screen.getByRole("button", { name: "‹ Previous" }));
  expect(current()).toBe(key("p0"));
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.getByText(/game changed after this action|cannot be safely retargeted/i)).toBeInTheDocument();
});

it("Undo during the result restores targeting without an old delayed advance", () => {
  render(<Guide />); tap("p4");
  act(() => store.getState().undo());
  expect(game().players.p4!.effects).toHaveLength(0);
  expect(useTargetPicker.getState().active).not.toBeNull();
  act(() => vi.advanceTimersByTime(5000));
  expect(current()).toBe(key("p0"));
  tap("p3");
  expect(game().players.p3!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
});

it("the roster fallback resolves through the same command and eligibility as board targeting", () => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p1") });
  render(<Guide />);
  const details = screen.getByText("Choose from roster").closest("details")!;
  fireEvent.click(screen.getByText("More options"));
  expect(details.querySelectorAll(".modern-night-roster button")).toHaveLength(4);
  expect([...details.querySelectorAll(".modern-night-roster button")].some(button => button.textContent === "Player 1")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Player 4" }));
  expect(game().players.p4!.effects).toEqual([expect.objectContaining({ type: "safeFromDemon" })]);
  expect(store.getState().undoStack).toHaveLength(1);
});

it.each(["privacy", "unmount"])("a captured target callback cannot commit after %s", mode => {
  const view = render(<Guide />);
  const stalePick = useTargetPicker.getState().active!;
  const before = game();
  const undo = store.getState().undoStack;
  if (mode === "privacy") act(() => usePrivacyStore.getState().setEnabled(true));
  else view.unmount();
  act(() => stalePick.onPick({ playerId: "p4", participantId: before.players.p4!.participantId! }));
  expect(game()).toBe(before);
  expect(store.getState().undoStack).toBe(undo);
  expect(useTargetPicker.getState().active).toBeNull();
});
