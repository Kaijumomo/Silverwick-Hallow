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
import { impair, proofGame, proofScript } from "@/test/proofFixtures";

const game = () => store.getState().game!;
const key = (id: string) => participantStepKey(game().players[id]!.participantId!, game().players[id]!.shownRole!);
const current = () => useShellStore.getState().nightCursor?.stepKey;
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
function Guide({ onClose = () => {} }: { onClose?: () => void }) {
  const state = store(s => s.game)!;
  return <ModernNightPanel game={state} script={proofScript} visible onClose={onClose} />;
}
beforeEach(() => {
  vi.useFakeTimers();
  store.setState({ game: proofGame(["poisoner", "monk", "imp", "empath", "chef"]), lobby: null,
    undoStack: [], localSeq: 0, terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
  useSessionRuntime.setState({ backend: null, status: "idle" });
  usePrivacyStore.setState({ enabled: false });
  useShellStore.getState().reset();
  useTargetPicker.getState().cancel(); clearNightActionCorrections();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["p0", "p1"])("%s target applies once and Next only navigates after an unlimited pause", actor => {
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key(actor) });
  render(<Guide />); tap("p4");
  const committed = game(); const undo = store.getState().undoStack; const seq = store.getState().localSeq;
  expect(committed.players.p4!.effects).toHaveLength(1);
  expect(committed.nightProgress[`2:${key(actor)}`]?.status).toBe("done");
  act(() => vi.advanceTimersByTime(60_000));
  expect(current()).toBe(key(actor)); expect(game()).toBe(committed);
  expect(screen.queryByRole("button", { name: /^(Apply|Resolve|Confirm)$/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(current()).not.toBe(key(actor));
  expect(game()).toBe(committed); expect(store.getState().undoStack).toBe(undo); expect(store.getState().localSeq).toBe(seq);
});

it("rehydrated Poisoner completion cannot replay the transaction without its local correction receipt", async () => {
  const view = render(<Guide />); tap("p4");
  const committed = game(); const saved = localStorage.getItem("new-blood-st")!;
  view.unmount(); clearNightActionCorrections();
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved);
  await act(async () => { await store.persist.rehydrate(); });
  expect(game()).toEqual(committed);
  useShellStore.getState().setNightCursor({ day: 2, stepKey: key("p0") });
  render(<Guide />);
  expect(useTargetPicker.getState().active).toBeNull();
  const restored = game(); const undo = store.getState().undoStack;
  tap("p3"); act(() => vi.advanceTimersByTime(60_000));
  expect(game()).toBe(restored); expect(current()).toBe(key("p0"));
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(game()).toBe(restored); expect(store.getState().undoStack).toBe(undo);
});

it("self-poisoning uses direct selection and one action; Next only navigates", () => {
  render(<Guide />); const before = game();
  tap("p0");
  const committed = game();
  expect(committed.players.p0!.effects).toEqual([expect.objectContaining({ type: "poisoned", sourceCharacter: "poisoner" })]);
  expect(committed.nightProgress[`2:${key("p0")}`]?.status).toBe("done");
  expect(screen.queryByRole("button", { name: /resolve|confirm|apply/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(game()).toBe(committed);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => store.getState().undo()); expect(game()).toEqual(before);
});

it("an impaired Poisoner completes without poison and later sobriety cannot invent the missed effect", () => {
  store.setState({ game: impair(game(), "p0") });
  render(<Guide />); tap("p4");
  expect(game().players.p4!.effects).toEqual([]);
  expect(game().nightProgress[`2:${key("p0")}`]?.status).toBe("done");
  act(() => store.setState({ game: { ...game(), players: { ...game().players, p0: { ...game().players.p0!, effects: [] } } } }));
  expect(useTargetPicker.getState().active).toBeNull();
  act(() => vi.advanceTimersByTime(60_000));
  expect(game().players.p4!.effects).toEqual([]); expect(current()).toBe(key("p0"));
});

it("the last direct action still offers Next to close without advancing the game phase", () => {
  store.setState({ game: proofGame(["poisoner", "chef"], "night", 2) });
  const close = vi.fn(); render(<Guide onClose={close} />); tap("p1");
  const committed = game(); const undo = store.getState().undoStack;
  expect(screen.getByRole("button", { name: "Next ›" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(close).toHaveBeenCalledTimes(1); expect(game()).toBe(committed);
  expect(game().phase).toBe("night"); expect(store.getState().undoStack).toBe(undo);
});

it("storage refusal leaves Poisoner pending and does not report a recorded action", () => {
  render(<Guide />); const before = game(); const undo = store.getState().undoStack;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  tap("p4");
  expect(game()).toBe(before); expect(store.getState().undoStack).toBe(undo);
  expect(game().nightProgress[`2:${key("p0")}`]).toBeUndefined();
  expect(screen.getByRole("alert")).toBeVisible(); expect(screen.queryByRole("status")).toBeNull();
  act(() => vi.advanceTimersByTime(60_000)); expect(current()).toBe(key("p0"));
});
