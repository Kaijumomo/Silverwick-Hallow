import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { registerVotingAuthorityReader } from "@/firebase/votingAuthority";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { PopoverReminders } from "./PopoverReminders";

const state = () => store.getState();
const game = () => state().game!;
function View() { return <PopoverReminders player={store(s => s.game!.players.p0!)} />; }
const poisonButton = () => screen.getByRole("button", { name: "Remove Poisoned effect from Poisoner" });
const removePoison = () => { fireEvent.click(poisonButton()); fireEvent.click(poisonButton()); };
const addPoison = (id = "second", suppressed = false) => {
  expect(state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: "p0", participantId: game().players.p0!.participantId! },
    effect: { id, type: "poisoned", sourceCharacter: "poisoner", source: { playerId: "p1", participantId: game().players.p1!.participantId! }, lifetime: { kind: "manual" } } }] }).ok).toBe(true);
  if (suppressed) expect(state().resolveEffects({ intents: [{ kind: "suppress", target: { playerId: "p0", participantId: game().players.p0!.participantId! }, effectId: id }] }).ok).toBe(true);
};

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  const initial = setupGame(["chef", "poisoner", "monk", "imp"], { phase: "night", day: 2 });
  store.setState({ game: initial, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
  addPoison("poison");
  expect(state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: "p0", participantId: game().players.p0!.participantId! },
    effect: { id: "safe", type: "safeFromDemon", sourceCharacter: "monk", source: { playerId: "p2", participantId: game().players.p2!.participantId! }, lifetime: { kind: "untilDawn" } } }] }).ok).toBe(true);
  store.setState({ undoStack: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); registerVotingAuthorityReader(() => null); });

it("uses the existing arming appearance and silently restores after three seconds", () => {
  vi.useFakeTimers(); render(<View />); const before = state();
  fireEvent.click(poisonButton());
  expect(poisonButton()).toHaveAttribute("data-removal-armed", "true");
  expect(poisonButton()).toHaveTextContent("Tap to remove");
  expect(state()).toBe(before);
  act(() => vi.advanceTimersByTime(3000));
  expect(poisonButton()).not.toHaveAttribute("data-removal-armed");
  expect(poisonButton()).toHaveTextContent("Poisoned");
  expect(state()).toBe(before);
  fireEvent.click(poisonButton()); expect(state()).toBe(before);
});

it.each(["Poisoned", "Safe"])("removes only the exact %s effect, records one Undo, and preserves completed gameplay", label => {
  render(<View />); const before = game();
  const button = screen.getByRole("button", { name: label === "Poisoned" ? "Remove Poisoned effect from Poisoner" : "Remove Safe effect from Monk" });
  fireEvent.click(button); fireEvent.click(button);
  expect(game().players.p0!.effects.map(e => e.id)).toEqual([label === "Poisoned" ? "safe" : "poison"]);
  expect(game().nightProgress).toEqual(before.nightProgress);
  expect(game().informationDeliveries).toEqual(before.informationDeliveries);
  expect(game().players.p0!.alive).toBe(before.players.p0!.alive);
  expect(state().undoStack).toHaveLength(1);
  act(() => state().undo()); expect(game()).toEqual(before);
});

it.each([false, true])("keeps one visual but preserves independent records when removal is ambiguous (suppressed: %s)", suppressed => {
  addPoison("second", suppressed); render(<View />); const before = state();
  expect(screen.getAllByRole("button", { name: "Remove Poisoned effect from Poisoner" })).toHaveLength(1);
  removePoison(); expect(state()).toBe(before);
  expect(screen.getByRole("alert")).toHaveTextContent("Use More settings");
  expect(game().players.p0!.effects).toHaveLength(3);
});

it("keeps same-label notation inert with a separate arming identity", () => {
  const target = { playerId: "p0", participantId: game().players.p0!.participantId! };
  state().resolveReminders({ intents: [{ kind: "place", target, reminder: { id: "effect:poisoner:poisoned", label: "Poisoned", sourceCharacter: "poisoner" } }] });
  render(<View />); const before = game();
  fireEvent.click(poisonButton());
  const note = screen.getByRole("button", { name: "Remove Poisoned reminder" });
  fireEvent.click(note); expect(game()).toBe(before);
  expect(poisonButton()).not.toHaveAttribute("data-removal-armed");
  fireEvent.click(note); expect(game().players.p0!.reminders).toHaveLength(0);
  expect(game().players.p0!.effects).toEqual(before.players.p0!.effects);
});

it("re-arms after an intervening game change instead of applying a stale second tap", () => {
  render(<View />); fireEvent.click(poisonButton());
  act(() => state().setNotes("p3", "Changed")); const changed = state();
  fireEvent.click(poisonButton()); expect(state()).toBe(changed);
  expect(poisonButton()).toHaveAttribute("data-removal-armed", "true");
});

it("refuses a stale rendered participant", () => {
  const player = game().players.p0!; render(<PopoverReminders player={player} />);
  act(() => store.setState({ game: { ...game(), players: { ...game().players, p0: { ...player, participantId: "replacement" } } } }));
  const before = state(); removePoison(); expect(state()).toBe(before);
  expect(screen.getByRole("alert")).toHaveTextContent("Reopen their details");
});

it("does not carry an armed token to another inspected player in the same game", () => {
  state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: "p3", participantId: game().players.p3!.participantId! },
    effect: { id: "other-poison", type: "poisoned", sourceCharacter: "poisoner", source: { playerId: "p1", participantId: game().players.p1!.participantId! }, lifetime: { kind: "manual" } } }] });
  const { rerender } = render(<PopoverReminders player={game().players.p0!} />);
  fireEvent.click(poisonButton());
  rerender(<PopoverReminders player={game().players.p3!} />);
  const before = state(); fireEvent.click(poisonButton()); expect(state()).toBe(before);
  expect(poisonButton()).toHaveAttribute("data-removal-armed", "true");
});

it.each(["writer", "reconnect", "recovery"])("refuses effect removal after %s authority changes", kind => {
  let writer: string | null = "writer";
  registerVotingAuthorityReader(() => writer);
  store.setState({ game: { ...game(), code: "ABCDEF", storytellerUid: "host" }, lobby: { code: "ABCDEF", uid: "host", status: "live", sessionId: "session" } });
  render(<View />); fireEvent.click(poisonButton());
  if (kind === "writer") writer = "replacement";
  else if (kind === "reconnect") act(() => store.setState({ lobby: { ...state().lobby!, status: "reconnecting" } }));
  else act(() => store.setState({ terminalClose: { status: "failed", recoveryPending: true } as never }));
  const before = state(); fireEvent.click(poisonButton()); expect(state()).toBe(before);
});

it("does not carry an armed removal into a rerender with a replacement writer", () => {
  let writer = "first-writer";
  registerVotingAuthorityReader(() => writer);
  store.setState({ game: { ...game(), code: "ABCDEF", storytellerUid: "host" }, lobby: { code: "ABCDEF", uid: "host", status: "live", sessionId: "session" } });
  const { rerender } = render(<View />); fireEvent.click(poisonButton());
  writer = "replacement-writer"; rerender(<View />);
  const before = state(); fireEvent.click(poisonButton()); expect(state()).toBe(before);
  expect(poisonButton()).toHaveAttribute("data-removal-armed", "true");
});

it("hides token controls under privacy and disarms them when returning", () => {
  render(<View />); fireEvent.click(poisonButton()); const before = game();
  act(() => usePrivacyStore.setState({ enabled: true })); expect(screen.queryByText("Poisoned")).toBeNull();
  act(() => usePrivacyStore.setState({ enabled: false })); fireEvent.click(poisonButton());
  expect(game()).toBe(before); expect(poisonButton()).toHaveAttribute("data-removal-armed", "true");
});

it("disables effect removal in ended games", () => {
  store.setState({ game: { ...game(), phase: "ended" } }); render(<View />);
  expect(poisonButton()).toBeDisabled(); const before = state(); removePoison(); expect(state()).toBe(before);
});

it("preserves all authoritative state when durable storage refuses removal", () => {
  render(<View />); const before = state(); const saved = localStorage.getItem("new-blood-st");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  removePoison(); expect(state()).toBe(before); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it("reloads exact effect removal and retains its Undo snapshot", async () => {
  render(<View />); const before = game(); removePoison(); const expected = game();
  const saved = localStorage.getItem("new-blood-st")!; cleanup();
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved);
  await store.persist.rehydrate(); expect(game()).toEqual(expected); expect(state().undoStack).toHaveLength(1);
  state().undo(); expect(game()).toEqual(before);
});
