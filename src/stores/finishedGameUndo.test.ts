import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameLifecycleToken, useStorytellerStore as store } from "./storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { StorytellerGamePersistedSchema } from "./schemas";
import { useShellStore } from "./shellStore";
import { participantStepKey } from "./nightProgress";

const state = () => store.getState();
const key = store.persist.getOptions().name!;
beforeEach(() => {
  localStorage.clear();
  useShellStore.getState().reset();
  store.setState({
    game: setupGame(undefined, { phase: "night", day: 2 }), lobby: null, sync: null,
    customScripts: { [setupScript.id]: setupScript }, undoStack: [], seatSwapUndo: [],
    finishedGameUndo: null, canUndoFinishedGame: false, terminalClose: null,
    tokenPositions: {}, localSeq: 0, view: "game",
  });
});
afterEach(() => vi.restoreAllMocks());

describe("local finished-game recovery", () => {
  it.each(["good", "evil"] as const)("restores the complete live snapshot and prior Undo after %s wins", winner => {
    state().recordDeath("p0");
    state().setTokenPosition("p0", 28, 42);
    const live = structuredClone(state().game);
    const undo = structuredClone(state().undoStack);
    const lifecycle = gameLifecycleToken();
    expect(state().finishGame({ kind: "declare", winner })).toEqual({ ok: true });
    expect(state().canUndoFinishedGame).toBe(true);
    // Ordinary Undo remains fenced; only explicit ending recovery can reopen.
    state().undo();
    expect(state().game?.phase).toBe("ended");
    expect(state().undoFinishedGame()).toEqual({ ok: true });
    expect(state().game).toEqual(live);
    expect(state().undoStack).toEqual(undo);
    expect(state().tokenPositions.p0).toEqual({ x: 28, y: 42 });
    expect(state().canUndoFinishedGame).toBe(false);
    expect(gameLifecycleToken()).toBe(lifecycle + 2);
    state().undo();
    expect(state().game?.players.p0?.alive).toBe(true);
  });

  it("survives reload and can undo an ending without a declared result", async () => {
    state().finishGame({ kind: "noResult" });
    const saved = localStorage.getItem(key)!;
    store.setState({ game: null, finishedGameUndo: null, canUndoFinishedGame: false });
    localStorage.setItem(key, saved);
    await store.persist.rehydrate();
    expect(state().game?.phase).toBe("ended");
    expect(state().canUndoFinishedGame).toBe(true);
    expect(state().undoFinishedGame().ok).toBe(true);
    expect(state().game?.phase).toBe("night");
    expect(StorytellerGamePersistedSchema.safeParse(state().game).success).toBe(true);
  });

  it.each(["valid", "wrong day", "unknown step", "malformed"])("restores only a validated Night cursor after reload: %s", async kind => {
    const player = state().game!.players.p4!;
    const cursor = { day: 2, stepKey: participantStepKey(player.participantId!, player.shownRole!) };
    useShellStore.getState().setNightCursor(cursor);
    state().finishGame({ kind: "noResult" });
    const saved = JSON.parse(localStorage.getItem(key)!);
    if (kind === "wrong day") saved.state.finishedGameUndo.nightCursor.day = 1;
    if (kind === "unknown step") saved.state.finishedGameUndo.nightCursor.stepKey = "p:missing:imp";
    if (kind === "malformed") saved.state.finishedGameUndo.nightCursor = "bad";
    useShellStore.getState().resetGameScope();
    localStorage.setItem(key, JSON.stringify(saved));
    await store.persist.rehydrate();
    expect(state().undoFinishedGame().ok).toBe(true);
    expect(state().game?.phase).toBe("night");
    expect(useShellStore.getState().nightCursor).toEqual(kind === "valid" ? cursor : null);
  });

  it("detaches all recovered snapshots from the former remote session", () => {
    store.setState({ game: { ...state().game!, code: "ABCD", storytellerUid: "host" } });
    state().recordDeath("p0");
    state().finishGame({ kind: "declare", winner: "evil" });
    expect(state().undoFinishedGame()).toMatchObject({ ok: true, message: expect.stringContaining("local in-person") });
    expect(state().lobby).toBeNull();
    expect(state().sync).toBeNull();
    expect(state().game).toMatchObject({ code: "", storytellerUid: "local" });
    state().undo();
    expect(state().game).toMatchObject({ code: "", storytellerUid: "local" });
  });

  it.each(["finish", "reopen"])("refuses %s without changing state when browser storage fails", operation => {
    if (operation === "reopen") state().finishGame({ kind: "noResult" });
    const before = state();
    const lifecycle = gameLifecycleToken();
    const saved = localStorage.getItem(key);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const result = operation === "finish" ? state().finishGame({ kind: "noResult" }) : state().undoFinishedGame();
    expect(result).toMatchObject({ ok: false });
    expect(state()).toBe(before);
    expect(gameLifecycleToken()).toBe(lifecycle);
    expect(localStorage.getItem(key)).toBe(saved);
  });

  it.each(["mismatched", "malformed"])("drops %s recovery on reload while keeping the final game", async corruption => {
    state().finishGame({ kind: "noResult" });
    const saved = JSON.parse(localStorage.getItem(key)!);
    if (corruption === "mismatched") saved.state.finishedGameUndo.live.players.p0.name = "Someone else";
    else saved.state.finishedGameUndo.undoStack = "invalid";
    localStorage.setItem(key, JSON.stringify(saved));
    await store.persist.rehydrate();
    expect(state().game?.phase).toBe("ended");
    expect(state().finishedGameUndo).toBeNull();
    expect(state().canUndoFinishedGame).toBe(false);
    expect(state().undoFinishedGame().ok).toBe(false);
  });

  it("never exposes an old game's recovery after replacement or discard", () => {
    state().finishGame({ kind: "noResult" });
    state().newGame("tb");
    expect(state().finishedGameUndo).toBeNull();
    expect(state().canUndoFinishedGame).toBe(false);
    expect(state().undoFinishedGame().ok).toBe(false);
    store.setState({ game: setupGame(undefined, { phase: "day", day: 1 }) });
    state().finishGame({ kind: "noResult" });
    state().endGame();
    expect(state().finishedGameUndo).toBeNull();
  });
});
