import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "./testGuide";
import { marksOn, removeMarkLabelled } from "./v6Night";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { butlerReminderOrigin } from "@/stores/butlerSelection";
import { bind, impair, patchPlayer, proofGame, proofScript, reseat } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
const closed = vi.fn();
const spyKey = () => participantStepKey(game().players.p3!.participantId!, "spy");
const atSpy = () => expect(useShellStore.getState().nightCursor?.stepKey).toBe(spyKey());
const butlerKey = () => participantStepKey(game().players.p0!.participantId!, "butler");
function Guide({ visible = true }: { visible?: boolean }) {
  return <ModernNightPanel game={store(s => s.game!)} script={proofScript} visible={visible} onClose={closed} />;
}
function initial(modify: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord = g => g) {
  let g = proofGame(["butler", "chef", "soldier", "spy", "imp"], "night", 1);
  Object.values(g.players).forEach(p => { p.packetEpoch = `epoch-${p.id}`; });
  g = modify(g);
  store.setState({ game: g, lobby: null, undoStack: [], terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: 1, stepKey: butlerKey() });
  return g;
}
const guide = () => render(<StrictMode><Guide /></StrictMode>);
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));

beforeEach(() => {
  usePrivacyStore.getState().reset(); useShellStore.getState().reset();
  useSessionRuntime.setState({ backend: null }); useTargetPicker.getState().cancel(); closed.mockReset();
});
afterEach(() => { cleanup(); useTargetPicker.getState().cancel(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("B7 Butler Night UI", () => {
  it("opens direct board selection with official instructions and no extra action confirmation", () => {
    initial(); guide();
    expect(useTargetPicker.getState().active?.label).toBe("Butler: choose a Master");
    expect(screen.getByText(/Each night, choose a player \(not yourself\)/)).toBeInTheDocument();
    expect(screen.getByText("Tap another player to choose a Master.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resolve|Apply|Continue action/i })).toBeNull();
  });
  it("excludes self but permits a dead Master", () => {
    const before = initial(g => patchPlayer(g, "p1", { alive: false })); guide();
    const eligible = useTargetPicker.getState().active!.eligible!;
    expect(eligible.has(before.players.p0!.participantId!)).toBe(false);
    expect(eligible.has(before.players.p1!.participantId!)).toBe(true);
    tap("p0"); expect(game()).toBe(before); expect(useTargetPicker.getState().active).not.toBeNull();
    tap("p1"); expect(game().players.p1!.reminders).toHaveLength(1);
    expect(game().players.p1!.alive).toBe(false);
  });
  it("records selection once, stays on Butler until Next, and Undo restores the prior state", () => {
    vi.useFakeTimers(); const before = initial(); guide();
    tap("p1");
    expect(game().players.p1!.reminders[0]).toMatchObject({ label: "Master", sourceCharacter: "butler", sourceParticipant: { playerId: "p0", participantId: before.players.p0!.participantId } });
    expect(game().nightProgress[`1:${butlerKey()}`]?.status).toBe("done");
    expect(store.getState().undoStack).toHaveLength(1);
    expect(useTargetPicker.getState().active).toBeNull();
    expect(screen.getByText("Master: Player 1")).toBeTruthy();
    act(() => vi.advanceTimersByTime(3500));
    expect(useShellStore.getState().nightCursor?.stepKey).toBe(butlerKey());
    expect(closed).not.toHaveBeenCalled();
    next(); atSpy();
    expect(store.getState().undoStack).toHaveLength(1);
    act(() => store.getState().undo()); expect(game()).toEqual(before);
  });
  it.each(["poisoned", "drunk", "abilityLost"])("%s Butler remains manual with instructions and Next only", type => {
    initial(g => impair(g, "p0", type)); guide();
    expect(useTargetPicker.getState().active).toBeNull();
    expect(screen.getByText(/Each night, choose a player \(not yourself\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resolve|Apply|Continue action/i })).toBeNull();
    next();
    expect(game().nightProgress[`1:${butlerKey()}`]?.status).toBe("done");
    expect(Object.values(game().players).flatMap(p => p.reminders)).toEqual([]);
    atSpy();
  });
  it("Privacy removes the Night content and cancels captured callbacks", () => {
    const before = initial(); guide(); const stale = useTargetPicker.getState().active!.onPick;
    act(() => usePrivacyStore.setState({ enabled: true }));
    expect(useTargetPicker.getState().active).toBeNull();
    expect(screen.queryByRole("region", { name: "Night 1 guide" })).toBeNull();
    act(() => stale(bind(before, "p1"))); expect(game()).toBe(before);
    act(() => usePrivacyStore.setState({ enabled: false }));
    expect(useTargetPicker.getState().active?.label).toBe("Butler: choose a Master");
  });
  it("a captured callback cannot redirect to a replacement participant", () => {
    initial(); guide(); const before = game(), stale = useTargetPicker.getState().active!.onPick;
    act(() => store.setState({ game: reseat(before, "p1") }));
    const replacement = game();
    act(() => stale(bind(before, "p1"))); expect(game()).toBe(replacement);
    expect(game().players.p1!.reminders).toEqual([]);
  });
  it("hiding the Night panel cancels a pending selection", () => {
    const before = initial(); const rendered = guide(); const stale = useTargetPicker.getState().active!.onPick;
    rendered.rerender(<StrictMode><Guide visible={false} /></StrictMode>);
    expect(useTargetPicker.getState().active).toBeNull();
    act(() => stale(bind(before, "p1"))); expect(game()).toBe(before);
  });
  it("failed persistence keeps state unchanged and permits retry without duplicate completion", () => {
    const before = initial(); guide();
    const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    tap("p1");
    expect(game()).toBe(before); expect(store.getState().undoStack).toEqual([]);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(useTargetPicker.getState().active).not.toBeNull();
    failure.mockRestore(); tap("p1");
    expect(game().players.p1!.reminders).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("equivalent manual Master stays stored behind one token; removing it takes away only the generated selection", () => {
    initial(); store.getState().resolveReminders({ intents: [{ kind: "place", target: bind(game(), "p1"), reminder: { label: "Master", sourceCharacter: "butler" } }] });
    const manual = game().players.p1!.reminders[0]!;
    guide(); tap("p1"); cleanup();
    const selected = game();
    expect(marksOn("p1").filter((m) => /Master/.test(m.label))).toHaveLength(1);
    expect(removeMarkLabelled("p1", /Master/)).toEqual({ ok: true });
    expect(game().players.p1!.reminders).toEqual([manual]);
    expect(game().nightProgress[`1:${butlerKey()}`]?.status).toBe("done");
    expect(game().players.p1!.reminders.some(r => butlerReminderOrigin(r))).toBe(false);
    act(() => store.getState().undo()); expect(game()).toEqual(selected);
  });
});
