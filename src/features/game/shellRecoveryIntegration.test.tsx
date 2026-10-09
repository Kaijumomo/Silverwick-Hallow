import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GameScreen } from "./GameScreen";
import { FinishGameDialog } from "./ResultDeclaration";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { participantStepKey } from "@/stores/nightProgress";
import { proofGame, proofScript } from "@/test/proofFixtures";
import { finishGame } from "@/test/finishGame";

const state = () => store.getState();
const game = () => state().game!;
const stepKey = (id: string) => participantStepKey(game().players[id]!.participantId!, game().players[id]!.shownRole!);
const phaseDock = () => within(document.querySelector<HTMLElement>(".grimoire-phase-dock")!);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  usePrivacyStore.getState().reset();
  useShellStore.getState().reset();
  useTargetPicker.getState().cancel();
  useSessionRuntime.setState({ backend: null, status: "idle", leaveRequests: {}, online: {}, pending: 0 });
  store.setState({ game: proofGame(["poisoner", "monk", "imp", "empath", "chef"]), customScripts: { [proofScript.id]: proofScript },
    lobby: null, sync: null, localSeq: 0, undoStack: [], seatSwapUndo: [], finishedGameUndo: null,
    canUndoFinishedGame: false, terminalClose: null, selectedPlayerId: null, tokenPositions: {}, view: "game" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("whole shell recovery integration", () => {
  it("shows a layout Undo storage refusal without changing the board or game", () => {
    state().moveToken("p0", 100, 120);
    render(<GameScreen />);
    const before = game();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    fireEvent.click(phaseDock().getByRole("button", { name: /Undo/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not save|storage/i);
    expect(state().tokenPositions.p0).toEqual({ x: 100, y: 120 });
    expect(state().undoStack).toHaveLength(1);
    expect(game()).toBe(before);
  });

  it("one visible Undo restores a completed Night ability, associated history and its actor after automatic advancement", () => {
    vi.useFakeTimers();
    render(<GameScreen />);
    const poisoner = stepKey("p0");
    const monk = stepKey("p1");
    expect(useShellStore.getState().nightCursor?.stepKey).toBe(poisoner);
    fireEvent.click(screen.getByRole("button", { name: /^Player 4, seat 5/ }));
    expect(game().players.p4!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
    expect(game().nightProgress[`2:${poisoner}`]?.status).toBe("done");
    expect(state().undoStack).toHaveLength(1);
    act(() => vi.advanceTimersByTime(2300));
    expect(useShellStore.getState().nightCursor?.stepKey).toBe(monk);
    fireEvent.click(phaseDock().getByRole("button", { name: /Undo/ }));
    expect(game().players.p4!.effects).toEqual([]);
    expect(game().nightProgress[`2:${poisoner}`]).toBeUndefined();
    expect(game().history).toEqual([]);
    expect(state().undoStack).toEqual([]);
    expect(useShellStore.getState().nightCursor?.stepKey).toBe(poisoner);
    expect(useShellStore.getState().litActor?.playerId).toBe("p0");
    act(() => vi.advanceTimersByTime(5000));
    expect(useShellStore.getState().nightCursor?.stepKey).toBe(poisoner);
  });

  it("the ended pill recovers the live game after reload and preserves the earlier contextual change", async () => {
    state().recordDeath("p4");
    const live = structuredClone(game());
    const view = render(<GameScreen />);
    const savedCursor = { day: 2, stepKey: stepKey("p1") };
    act(() => useShellStore.getState().setNightCursor(savedCursor));
    await finishGame({ choice: "evil" });
    expect(game().phase).toBe("ended");
    const key = store.persist.getOptions().name!;
    const saved = localStorage.getItem(key)!;
    view.unmount();
    useShellStore.getState().resetGameScope();
    store.setState({ game: null, finishedGameUndo: null, canUndoFinishedGame: false });
    localStorage.setItem(key, saved);
    await act(async () => store.persist.rehydrate());
    render(<GameScreen />);
    expect(phaseDock().getByText(/Evil wins/)).toBeInTheDocument();
    fireEvent.click(phaseDock().getByRole("button", { name: /Undo/ }));
    expect(game()).toEqual(live);
    expect(state().lobby).toBeNull();
    expect(state().sync).toBeNull();
    expect(state().undoStack).toHaveLength(1);
    expect(useShellStore.getState().nightCursor).toEqual(savedCursor);
    expect(useShellStore.getState().litActor?.playerId).toBe("p1");
  });

  it("New game in the finished pill returns to the main screen without replacing the final snapshot", async () => {
    render(<GameScreen />);
    await finishGame({ choice: "good" });
    const ended = game();
    fireEvent.click(phaseDock().getByRole("button", { name: "New game" }));
    expect(state().view).toBe("home");
    expect(game()).toBe(ended);
    expect(game().result?.winner).toBe("good");
  });

  it("New game in the victory scene also returns home without creating a replacement", async () => {
    render(<GameScreen />);
    await finishGame({ choice: "good", review: false });
    const ended = game();
    fireEvent.click(screen.getByText("Game details & history"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Good Wins" })).getByRole("button", { name: "New game" }));
    expect(state().view).toBe("home");
    expect(game()).toBe(ended);
  });

  it("privacy cancels live targeting and removes the final private scene without mutating the game", async () => {
    render(<GameScreen />);
    expect(useTargetPicker.getState().active).not.toBeNull();
    const live = game();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(useTargetPicker.getState().active).toBeNull();
    expect(document.body).not.toHaveTextContent(/Poisoner is awake/);
    expect(game()).toBe(live);
    act(() => usePrivacyStore.getState().setEnabled(false));
    await finishGame({ choice: "evil", review: false });
    expect(screen.getByRole("dialog", { name: "Evil Wins" })).toBeInTheDocument();
    const ended = game();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("dialog", { name: "Evil Wins" })).toBeNull();
    expect(document.querySelector(".shell-result-team-token")).toBeNull();
    expect(game()).toBe(ended);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.queryByRole("dialog", { name: "Evil Wins" })).toBeNull();
  });

  it("a confirmed online ending awaiting local save cannot be cancelled into live play", async () => {
    store.setState({ terminalClose: { status: "failed", intent: { kind: "declare", winner: "good" }, message: "Allow browser storage and retry.",
      confirmedRecovery: { kind: "endedWithResult", result: { winner: "good", declaredAt: { phase: "night", day: 2 } } } } });
    const close = vi.fn();
    const ended = vi.fn();
    render(<FinishGameDialog onClose={close} onEnded={ended} multiplayer={false} />);
    expect(screen.getByRole("button", { name: "Keep playing" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(document.querySelector(".shell-ending-backdrop")!);
    expect(close).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Retry|Good wins/ })));
    expect(ended).toHaveBeenCalledOnce();
    expect(game()).toMatchObject({ phase: "ended", result: { winner: "good" } });
    expect(state().lobby).toBeNull();
  });
});
