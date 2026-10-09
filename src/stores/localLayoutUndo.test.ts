import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";

const state = () => store.getState();
const key = store.persist.getOptions().name!;
beforeEach(() => {
  localStorage.clear();
  store.setState({ game: setupGame(undefined, { phase: "night", day: 2 }), lobby: null, sync: null, localSeq: 0,
    customScripts: { [setupScript.id]: setupScript }, undoStack: [], seatSwapUndo: [], localLayoutUndo: [],
    tokenPositions: {}, finishedGameUndo: null, canUndoFinishedGame: false, terminalClose: null });
});
afterEach(() => vi.restoreAllMocks());

describe("local token-layout Undo in chronological order", () => {
  it("one completed move and its Undo preserve the authoritative game reference and writer sequence", () => {
    const game = state().game;
    expect(state().moveToken("p0", 100, 200)).toEqual({ ok: true });
    expect(state().game).toBe(game);
    expect(state().localSeq).toBe(0);
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(state().tokenPositions).toEqual({});
    expect(state().game).toBe(game);
    expect(state().localSeq).toBe(0);
  });

  it("a move, game action, and reset reverse in that order without resetting unrelated game state", () => {
    state().moveToken("p0", 100, 200);
    state().recordDeath("p0");
    const dead = state().game;
    const seq = state().localSeq;
    state().resetTokenPositions();
    expect(state().undoStack).toHaveLength(3);
    expect(state().tokenPositions).toEqual({});
    state().undo();
    expect(state().tokenPositions.p0).toEqual({ x: 100, y: 200 });
    expect(state().game).toBe(dead);
    expect(state().localSeq).toBe(seq);
    state().undo();
    expect(state().game?.players.p0?.alive).toBe(true);
    const live = state().game;
    const undoneSeq = state().localSeq;
    state().undo();
    expect(state().tokenPositions).toEqual({});
    expect(state().game).toBe(live);
    expect(state().localSeq).toBe(undoneSeq);
  });

  it("layout Undo does not rewind a later note edit that deliberately has no Undo snapshot", () => {
    state().moveToken("p0", 100, 200);
    state().setNightStepNotes(2, "manual:review", "Keep this correction");
    const before = state().game;
    state().undo();
    expect(state().tokenPositions).toEqual({});
    expect(state().game).toBe(before);
    expect(state().game?.nightProgress["2:manual:review"]?.notes).toBe("Keep this correction");
  });

  it("preserves local inverses through reload, finishing and reopening", async () => {
    state().moveToken("p0", 100, 200);
    state().finishGame({ kind: "declare", winner: "good" });
    const saved = localStorage.getItem(key)!;
    store.setState({ game: null, undoStack: [], localLayoutUndo: [], finishedGameUndo: null });
    localStorage.setItem(key, saved);
    await store.persist.rehydrate();
    expect(state().undoFinishedGame().ok).toBe(true);
    const live = state().game;
    const seq = state().localSeq;
    state().undo();
    expect(state().tokenPositions).toEqual({});
    expect(state().game).toBe(live);
    expect(state().localSeq).toBe(seq);
  });

  it("bounds/reindexes layout history to twenty operations and ignores no-op moves/reset", () => {
    expect(state().resetTokenPositions().ok).toBe(true);
    expect(state().undoStack).toHaveLength(0);
    for (let x = 1; x <= 24; x++) state().moveToken("p0", x, 0);
    state().moveToken("p0", 24, 0);
    expect(state().undoStack).toHaveLength(20);
    expect(state().localLayoutUndo).toHaveLength(20);
    for (let n = 0; n < 20; n++) state().undo();
    expect(state().tokenPositions.p0).toEqual({ x: 4, y: 0 });
    expect(state().localSeq).toBe(0);
  });

  it("refuses unsaveable layout changes and Undo before publishing any local changes", () => {
    state().moveToken("p0", 100, 200);
    const before = state();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(state().resetTokenPositions().ok).toBe(false);
    expect(state()).toBe(before);
    state().undo();
    expect(state()).toBe(before);
  });

  it("discards malformed/stale layout metadata without discarding the saved game", async () => {
    state().moveToken("p0", 100, 200);
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.state.localLayoutUndo[0].seats[0].participantId = "someone-else";
    localStorage.setItem(key, JSON.stringify(saved));
    await store.persist.rehydrate();
    expect(state().game?.phase).toBe("night");
    expect(state().localLayoutUndo).toEqual([null]);
  });
});
