import { beforeEach, describe, expect, it } from "vitest";
import { buildDayTown } from "@/features/grimoire-v6/day/test/dayFixture";
import { takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { compactUndoStack, expandUndoStack, SHARED_HISTORY_PREFIX } from "./undoPersistence";
import type { PlayerId, StorytellerLobbyRecord } from "./types";

const KEY = "new-blood-st";
const state = () => store.getState();
const game = () => state().game!;
const saved = () => JSON.parse(localStorage.getItem(KEY)!) as { version: number; state: Record<string, any> };
const binding = (id: PlayerId) => ({ playerId: id, participantId: game().players[id]!.participantId! });
const toggle = (id: PlayerId, on: boolean) => expect(state().setManualEffect(binding(id), "poisoned", on)).toMatchObject({ ok: true });

async function reload(raw = localStorage.getItem(KEY)!) {
  store.setState({ game: null, undoStack: [], finishedGameUndo: null, canUndoFinishedGame: false });
  localStorage.setItem(KEY, raw);
  await store.persist.rehydrate();
}

const record = (id: string) => ({ id, category: "effect", summary: id }) as unknown as StorytellerLobbyRecord["history"][number];
const gameWith = (ids: string[]) => ({ history: ids.map(record), day: ids.length }) as unknown as StorytellerLobbyRecord;

describe("F-01 compact saved Undo snapshots (pure)", () => {
  it("saves a snapshot whose History is a prefix of the base as a marker, and restores an independent copy", () => {
    const base = gameWith(["a", "b", "c"]);
    const older = { ...gameWith(["a", "b"]), history: base.history.slice(0, 2).map((r) => ({ ...r })) };
    const [compact] = compactUndoStack([older], base) as Record<string, unknown>[];
    expect(compact!.history).toEqual({ [SHARED_HISTORY_PREFIX]: 2 });
    expect(compact!.day).toBe(2);
    expect(older.history).toHaveLength(2); // the in-memory snapshot is never changed

    const [restored] = expandUndoStack(JSON.parse(JSON.stringify([compact])), JSON.parse(JSON.stringify(base))) as StorytellerLobbyRecord[];
    expect(restored).toEqual(older);
  });

  it("saves in full any snapshot that is not proven to share its History", () => {
    const base = gameWith(["a", "b", "c"]);
    const diverged = gameWith(["a", "x"]);
    const longer = gameWith(["a", "b", "c", "d"]);
    expect(compactUndoStack([diverged, longer], base)).toEqual([diverged, longer]);
    expect(compactUndoStack([diverged], null)).toEqual([diverged]);
  });

  it("leaves any marker that does not fit its base for validation to reject", () => {
    const base = gameWith(["a"]);
    for (const history of [{ [SHARED_HISTORY_PREFIX]: 2 }, { [SHARED_HISTORY_PREFIX]: -1 }, { [SHARED_HISTORY_PREFIX]: 0.5 },
      { [SHARED_HISTORY_PREFIX]: "1" }, { [SHARED_HISTORY_PREFIX]: 1, extra: true }]) {
      const entry = { day: 1, history };
      expect(expandUndoStack([entry], base)).toEqual([entry]);
    }
    expect(expandUndoStack([{ history: { [SHARED_HISTORY_PREFIX]: 0 } }], { history: "bad" })).toEqual([{ history: { [SHARED_HISTORY_PREFIX]: 0 } }]);
    expect(expandUndoStack("not a stack", base)).toBe("not a stack");
  });
});

describe("F-01 compact saved Undo snapshots (store)", () => {
  beforeEach(() => {
    localStorage.clear();
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false, sync: null });
  });

  it("saves every Undo snapshot of a live game without repeating its History, and reload restores the identical Undo stack", async () => {
    const { ids } = buildDayTown(3);
    for (let i = 0; i < 24; i++) toggle(ids.Ada!, i % 2 === 0);
    const before = structuredClone(state().undoStack);
    expect(before).toHaveLength(20);

    const stored = saved().state.undoStack as Record<string, unknown>[];
    expect(stored).toHaveLength(20);
    for (const entry of stored) expect(entry.history).toEqual({ [SHARED_HISTORY_PREFIX]: expect.any(Number) });

    const live = structuredClone(game());
    await reload();
    expect(game()).toEqual(live);
    expect(state().undoStack).toEqual(before);

    // Undo after a reload walks back through exactly the same games.
    for (let i = before.length - 1; i >= 0; i--) { state().undo(); expect(game()).toEqual(before[i]); }
  });

  it("keeps the saved state bounded as History grows", () => {
    const { ids } = buildDayTown(2);
    const names = Object.keys(ids);
    for (let i = 0; i < 300; i++) toggle(ids[names[i % names.length]!]!, Math.floor(i / names.length) % 2 === 0);
    const g = game();
    expect(g.history.length).toBeGreaterThan(300);
    const withoutHistory = JSON.stringify({ ...g, history: [] }).length;
    // The current game once, plus 20 snapshots that each carry everything but History.
    expect(localStorage.getItem(KEY)!.length).toBeLessThan(JSON.stringify(g).length + 20 * withoutHistory + 64 * 1024);
  });

  it("saves in full a snapshot whose History is not shared with the current game, and restores it unchanged", async () => {
    buildDayTown(2);
    const foreign = structuredClone(game());
    foreign.history = foreign.history.slice(1);
    store.setState({ undoStack: [...state().undoStack, foreign] });
    // Any later save (a layout-only change here) writes the stack.
    store.setState({ tokenPositions: { ...state().tokenPositions } });
    const stored = saved().state.undoStack as Record<string, unknown>[];
    expect(stored.at(-1)!.history).toEqual(foreign.history);
    const before = structuredClone(state().undoStack);
    await reload();
    expect(state().undoStack).toEqual(before);
  });

  it("resets a save whose marker has been tampered with, exactly like any other corrupt Undo snapshot", async () => {
    const { ids } = buildDayTown(2);
    toggle(ids.Ada!, true);
    const raw = saved();
    raw.state.undoStack[0].history = { [SHARED_HISTORY_PREFIX]: game().history.length + 5 };
    takeMigrationResetFlag();
    await reload(JSON.stringify(raw));
    expect(state().game).toBeNull();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("saves the finished-game recovery Undo stack compactly, and Undo of the ending still restores the live game after a reload", async () => {
    const { ids } = buildDayTown(2);
    for (let i = 0; i < 4; i++) toggle(ids.Ada!, i % 2 === 0);
    const live = structuredClone(game());
    const liveUndo = structuredClone(state().undoStack);
    expect(state().finishGame({ kind: "declare", winner: "good" })).toMatchObject({ ok: true });
    const recovery = saved().state.finishedGameUndo as { undoStack: Record<string, unknown>[] };
    expect(recovery.undoStack.length).toBeGreaterThan(0);
    for (const entry of recovery.undoStack) expect(entry.history).toEqual({ [SHARED_HISTORY_PREFIX]: expect.any(Number) });

    await reload();
    expect(state().canUndoFinishedGame).toBe(true);
    expect(state().undoFinishedGame()).toMatchObject({ ok: true });
    expect(game()).toEqual(live);
    expect(state().undoStack).toEqual(liveUndo);
  });
});
