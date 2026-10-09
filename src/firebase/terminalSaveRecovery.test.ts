import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { endGameWithIntent } from "./terminal";

const { close } = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("./storytellerSync", () => ({ closeMultiplayerSession: close }));
const state = () => store.getState();

beforeEach(() => {
  close.mockReset();
  localStorage.clear();
  store.setState({ game: setupGame(undefined, { phase: "day", day: 2, code: "ABCD", storytellerUid: "host" }),
    customScripts: { [setupScript.id]: setupScript }, lobby: { code: "ABCD", uid: "host", sessionId: "session-1", status: "live" },
    sync: null, localSeq: 0, undoStack: [], seatSwapUndo: [], terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false });
});
afterEach(() => vi.restoreAllMocks());

describe("confirmed session closure followed by failed browser save", () => {
  it.each(["good", "evil", null] as const)("locks detach-save failure until the server's %s outcome is recovered", async winner => {
    const key = store.persist.getOptions().name!;
    const originalSet = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key && JSON.parse(value).state.lobby === null) throw new Error("detach save refused");
      originalSet.call(this, name, value);
    });
    close.mockImplementationOnce(async () => {
      state().setLobby(null);
      return { alreadyEnded: false };
    });
    expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false });
    expect(state().terminalClose).toMatchObject({ status: "failed", recoveryPending: true });
    expect(state().terminalClose?.confirmedRecovery).toBeUndefined();
    expect(state().lobby).toMatchObject({ code: "ABCD", sessionId: "session-1" });
    storage.mockRestore();
    const before = state().game;
    state().recordDeath("p0");
    state().clearTerminalClose();
    state().newGame("tb");
    expect(state().game).toBe(before);
    expect(localStorage.getItem(`${key}-ending`)).not.toBeNull();
    close.mockImplementationOnce(async () => {
      state().setLobby(null);
      return { alreadyEnded: true, recovery: winner
        ? { kind: "endedWithResult", result: { winner, declaredAt: { phase: "day", day: 2 } } }
        : { kind: "endedWithoutResult" } };
    });
    expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toEqual({ ok: true });
    expect(state().game?.phase).toBe("ended");
    expect(state().game?.result?.winner ?? null).toBe(winner);
    expect(close).toHaveBeenCalledTimes(2);
    expect(state().lobby).toBeNull();
    expect(localStorage.getItem(`${key}-ending`)).toBeNull();
  });

  it("refuses a remote close before network work if its recovery journal cannot be saved", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false });
    expect(close).not.toHaveBeenCalled();
    expect(state().game?.phase).toBe("day");
  });

  it("survives selective final-save refusal and reload, then reads back the actual server winner", async () => {
    const key = store.persist.getOptions().name!;
    const originalSet = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key && JSON.parse(value).state.game?.phase === "ended") throw new Error("final save refused");
      originalSet.call(this, name, value);
    });
    close.mockImplementationOnce(async () => { state().setLobby(null); return { alreadyEnded: false }; });
    expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false });
    const saved = localStorage.getItem(key)!;
    expect(JSON.parse(saved).state.lobby).toBeNull();
    expect(localStorage.getItem(`${key}-ending`)).not.toBeNull();
    storage.mockRestore();
    store.setState({ game: null, lobby: null, terminalClose: null });
    localStorage.setItem(key, saved);
    await store.persist.rehydrate();
    expect(state().terminalClose).toMatchObject({ status: "failed", recoveryPending: true });
    expect(state().lobby).toMatchObject({ code: "ABCD", sessionId: "session-1" });
    const recovered = state().game;
    state().recordDeath("p0");
    state().clearTerminalClose();
    expect(state().game).toBe(recovered);
    expect(state().terminalClose?.recoveryPending).toBe(true);
    // The pre-close intent is not evidence of the winner. A receipt from a
    // prior committed retry always wins over that intent.
    close.mockImplementationOnce(async () => {
      state().setLobby(null);
      return { alreadyEnded: true, recovery: { kind: "endedWithResult", result: { winner: "evil", declaredAt: { phase: "day", day: 2 } } } };
    });
    expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toEqual({ ok: true });
    expect(state().game).toMatchObject({ phase: "ended", result: { winner: "evil" } });
    expect(state().lobby).toBeNull();
    expect(localStorage.getItem(`${key}-ending`)).toBeNull();
  });

  it.each(["malformed", "other game", "other session binding"])("rejects a %s recovery journal on reload", async corruption => {
    const key = store.persist.getOptions().name!;
    const journal = { game: structuredClone(state().game), lobby: { ...state().lobby! }, intent: { kind: "declare", winner: "good" } };
    if (corruption === "other game") journal.game!.players.p0!.participantId = "another-person";
    if (corruption === "other session binding") journal.lobby.code = "OTHER";
    localStorage.setItem(`${key}-ending`, corruption === "malformed" ? "{bad" : JSON.stringify(journal));
    await store.persist.rehydrate();
    expect(state().terminalClose).toBeNull();
    expect(state().game?.phase).toBe("day");
  });

  it.each(["good", "evil"] as const)("retries only the local %s result, keeping mutations locked and the remote session closed", async winner => {
    let storageFailure: ReturnType<typeof vi.spyOn>;
    close.mockImplementation(async () => {
      state().setLobby(null);
      storageFailure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
      return { alreadyEnded: false };
    });
    expect(await endGameWithIntent({ kind: "declare", winner })).toMatchObject({ ok: false });
    expect(state().terminalClose).toMatchObject({ status: "failed", confirmedRecovery: { kind: "endedWithResult", result: { winner } } });
    storageFailure!.mockRestore();
    const before = state().game;
    state().recordDeath("p0");
    state().clearTerminalClose();
    state().newGame("tb");
    state().endGame();
    expect(state().game).toBe(before);
    expect(state().setLobby({ code: "ABCD", uid: "host", sessionId: "session-1", status: "live" })).toBe(false);
    expect(await endGameWithIntent({ kind: "declare", winner: winner === "good" ? "evil" : "good" })).toEqual({ ok: true });
    expect(state().game).toMatchObject({ phase: "ended", result: { winner } });
    expect(close).toHaveBeenCalledTimes(1);
    expect(state().undoFinishedGame()).toMatchObject({ ok: true });
    expect(state().lobby).toBeNull();
    expect(state().game).toMatchObject({ phase: "day", code: "", storytellerUid: "local" });
  });
});
