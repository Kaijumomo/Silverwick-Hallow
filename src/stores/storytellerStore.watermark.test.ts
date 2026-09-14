// Phase 9C.2A (OPUS-001) — store-level localSeq/sync watermark unit tests.
// These exercise useStorytellerStore directly, with no Firebase backend or
// writer involved: they prove the *store's own* bookkeeping contract that
// the reconnect machinery in storytellerSync.ts relies on.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "./storytellerStore";

const CODE = "WMRK2345";
const SESSION = "session-wm-1";

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    view: "home", localSeq: 0, sync: null,
  });
  localStorage.clear();
});

describe("localSeq: projected game mutations advance it", () => {
  it("newGame (creating game content) advances localSeq exactly once", () => {
    expect(useStorytellerStore.getState().localSeq).toBe(0);
    useStorytellerStore.getState().newGame("tb");
    expect(useStorytellerStore.getState().localSeq).toBe(1);
  });

  it("each subsequent game-content mutation advances localSeq by exactly one", () => {
    useStorytellerStore.getState().newGame("tb");
    const after1 = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().addPlayer("Alice");
    expect(useStorytellerStore.getState().localSeq).toBe(after1 + 1);
    const id = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().assignRole(id, "chef");
    expect(useStorytellerStore.getState().localSeq).toBe(after1 + 2);
    useStorytellerStore.getState().setShownRole(id, "chef");
    expect(useStorytellerStore.getState().localSeq).toBe(after1 + 3);
  });

  it("undo (restoring earlier game content) is itself new local intent and advances localSeq", () => {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    const beforeUndo = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().undo();
    expect(useStorytellerStore.getState().localSeq).toBe(beforeUndo + 1);
  });

  it("a no-op mutation (missing player id) does not advance localSeq", () => {
    useStorytellerStore.getState().newGame("tb");
    const before = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().renamePlayer("does-not-exist", "Nobody");
    expect(useStorytellerStore.getState().localSeq).toBe(before);
  });

  it("membership-affecting mutations (unseatPlayer) that alter game content advance localSeq", () => {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    const id = useStorytellerStore.getState().game!.seatOrder[0]!;
    const before = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().unseatPlayer(id);
    expect(useStorytellerStore.getState().localSeq).toBe(before + 1);
  });
});

describe("localSeq: UI-only/local-layout mutations never advance it", () => {
  beforeEach(() => useStorytellerStore.getState().newGame("tb"));

  it("selectPlayer does not advance localSeq", () => {
    const before = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().selectPlayer("someone");
    expect(useStorytellerStore.getState().localSeq).toBe(before);
  });
  it("setView does not advance localSeq", () => {
    const before = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().setView("home");
    expect(useStorytellerStore.getState().localSeq).toBe(before);
  });
  it("setGrimoireMode does not advance localSeq", () => {
    const before = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().setGrimoireMode("freeRoam");
    expect(useStorytellerStore.getState().localSeq).toBe(before);
  });
  it("setTokenPosition/clearTokenPositions do not advance localSeq", () => {
    const before = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().setTokenPosition("p1", 10, 20);
    useStorytellerStore.getState().clearTokenPositions();
    expect(useStorytellerStore.getState().localSeq).toBe(before);
  });
});

describe("sync metadata: ensureSyncScope", () => {
  it("establishes fresh sync metadata for a brand new scope", () => {
    useStorytellerStore.getState().ensureSyncScope(CODE, SESSION);
    expect(useStorytellerStore.getState().sync).toEqual({
      code: CODE, sessionId: SESSION, ackedGuard: null, ackedGameSeq: 0, lastAttempt: null,
    });
  });

  it("is a no-op when sync already matches this exact scope — never overwrites existing evidence", () => {
    useStorytellerStore.getState().ensureSyncScope(CODE, SESSION);
    useStorytellerStore.getState().noteWriterAttempt(CODE, SESSION, { token: "writer-A", revision: 3 });
    useStorytellerStore.getState().noteWriterAck(CODE, SESSION, { token: "writer-A", revision: 2 });
    const before = useStorytellerStore.getState().sync;
    // Simulates "creating a replacement SessionWriter": startStorytellerSession
    // calls ensureSyncScope again on every reconnect for the same scope.
    useStorytellerStore.getState().ensureSyncScope(CODE, SESSION);
    expect(useStorytellerStore.getState().sync).toEqual(before);
  });

  it("replaces sync metadata outright on a genuine scope change", () => {
    useStorytellerStore.getState().ensureSyncScope(CODE, SESSION);
    useStorytellerStore.getState().noteWriterAck(CODE, SESSION, { token: "writer-A", revision: 5 });
    useStorytellerStore.getState().ensureSyncScope("OTHR6789", "other-session");
    expect(useStorytellerStore.getState().sync).toEqual({
      code: "OTHR6789", sessionId: "other-session", ackedGuard: null, ackedGameSeq: 0, lastAttempt: null,
    });
  });
});

describe("sync metadata: noteWriterAttempt / noteWriterAck (writer-authority acknowledgement)", () => {
  beforeEach(() => useStorytellerStore.getState().ensureSyncScope(CODE, SESSION));

  it("noteWriterAttempt records lastAttempt without touching ackedGuard, and does not touch game/localSeq", () => {
    const beforeSeq = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().noteWriterAttempt(CODE, SESSION, { token: "writer-A", revision: 1 });
    expect(useStorytellerStore.getState().sync).toMatchObject({ lastAttempt: { token: "writer-A", revision: 1 }, ackedGuard: null });
    expect(useStorytellerStore.getState().localSeq).toBe(beforeSeq);
  });

  it("noteWriterAck advances ackedGuard and clears the exactly-matching lastAttempt", () => {
    useStorytellerStore.getState().noteWriterAttempt(CODE, SESSION, { token: "writer-A", revision: 1 });
    useStorytellerStore.getState().noteWriterAck(CODE, SESSION, { token: "writer-A", revision: 1 });
    expect(useStorytellerStore.getState().sync).toMatchObject({ ackedGuard: { token: "writer-A", revision: 1 }, lastAttempt: null });
  });

  it("noteWriterAck does NOT clear an unrelated (non-matching) lastAttempt", () => {
    useStorytellerStore.getState().noteWriterAttempt(CODE, SESSION, { token: "writer-A", revision: 2 });
    // A different (already-acked) commit's ack arrives; must not clobber the newer pending attempt.
    useStorytellerStore.getState().noteWriterAck(CODE, SESSION, { token: "writer-A", revision: 1 });
    expect(useStorytellerStore.getState().sync).toMatchObject({ ackedGuard: { token: "writer-A", revision: 1 }, lastAttempt: { token: "writer-A", revision: 2 } });
  });

  it("creating a replacement writer (re-running ensureSyncScope for the same scope) does NOT overwrite an unresolved lastAttempt", () => {
    useStorytellerStore.getState().noteWriterAttempt(CODE, SESSION, { token: "writer-A", revision: 4 });
    useStorytellerStore.getState().ensureSyncScope(CODE, SESSION); // simulates a fresh SessionWriter's startStorytellerSession call
    expect(useStorytellerStore.getState().sync?.lastAttempt).toEqual({ token: "writer-A", revision: 4 });
  });

  it("attempts/acks for a non-matching scope are ignored (never combine values across scopes)", () => {
    useStorytellerStore.getState().noteWriterAttempt("OTHR6789", "other-session", { token: "writer-X", revision: 9 });
    expect(useStorytellerStore.getState().sync).toMatchObject({ code: CODE, sessionId: SESSION, lastAttempt: null });
  });
});

describe("sync metadata: acknowledgeGameFlush (game-content acknowledgement is separate from writer-authority acknowledgement)", () => {
  beforeEach(() => useStorytellerStore.getState().ensureSyncScope(CODE, SESSION));

  it("advances ackedGameSeq to exactly the given seqAtFlush", () => {
    useStorytellerStore.getState().acknowledgeGameFlush(CODE, SESSION, 5);
    expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(5);
  });

  it("never regresses ackedGameSeq", () => {
    useStorytellerStore.getState().acknowledgeGameFlush(CODE, SESSION, 5);
    useStorytellerStore.getState().acknowledgeGameFlush(CODE, SESSION, 2);
    expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(5);
  });

  it("a successful non-projection writer commit (noteWriterAck alone) never advances ackedGameSeq", () => {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice"); // localSeq now > 0, dirty
    const dirtySeq = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().noteWriterAttempt(CODE, SESSION, { token: "writer-A", revision: 1 });
    useStorytellerStore.getState().noteWriterAck(CODE, SESSION, { token: "writer-A", revision: 1 });
    expect(useStorytellerStore.getState().sync?.ackedGuard).toEqual({ token: "writer-A", revision: 1 });
    expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(0);
    expect(useStorytellerStore.getState().localSeq).toBe(dirtySeq); // still dirty: localSeq > ackedGameSeq
  });

  it("acknowledgements for a non-matching scope are ignored", () => {
    useStorytellerStore.getState().acknowledgeGameFlush("OTHR6789", "other-session", 5);
    expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(0);
  });
});

describe("restoreRemoteCheckpoint", () => {
  const remoteGame = () => useStorytellerStore.getState().game!;

  beforeEach(() => {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().ensureSyncScope("", SESSION); // matches the local game's default code ""
  });

  it("replaces game, clears undo/selectedPlayerId, and does NOT bump localSeq", () => {
    useStorytellerStore.getState().selectPlayer(useStorytellerStore.getState().game!.seatOrder[0]!);
    const beforeSeq = useStorytellerStore.getState().localSeq;
    const incoming = { ...remoteGame(), day: 6 };
    useStorytellerStore.getState().restoreRemoteCheckpoint(incoming, { token: "writer-remote", revision: 9 });
    expect(useStorytellerStore.getState().game!.day).toBe(6);
    expect(useStorytellerStore.getState().undoStack).toEqual([]);
    expect(useStorytellerStore.getState().selectedPlayerId).toBeNull();
    expect(useStorytellerStore.getState().localSeq).toBe(beforeSeq);
  });

  it("makes the restored game clean: ackedGameSeq is set to the current localSeq, dirty becomes false", () => {
    const seqBeforeRestore = useStorytellerStore.getState().localSeq;
    useStorytellerStore.getState().restoreRemoteCheckpoint(remoteGame(), { token: "writer-remote", revision: 9 });
    const { localSeq, sync } = useStorytellerStore.getState();
    expect(localSeq).toBe(seqBeforeRestore);
    expect(sync?.ackedGameSeq).toBe(seqBeforeRestore);
    expect(localSeq).toBeLessThanOrEqual(sync!.ackedGameSeq); // dirty = localSeq > ackedGameSeq is false
  });

  it("sets ackedGuard to the newly accepted remote guard", () => {
    useStorytellerStore.getState().restoreRemoteCheckpoint(remoteGame(), { token: "writer-remote", revision: 9 });
    expect(useStorytellerStore.getState().sync?.ackedGuard).toEqual({ token: "writer-remote", revision: 9 });
  });

  it("a game mutation applied AFTER restore (e.g. membership reconciliation) is new local intent and advances localSeq again, making the store dirty for the initial flush", () => {
    useStorytellerStore.getState().restoreRemoteCheckpoint(remoteGame(), { token: "writer-remote", revision: 9 });
    const { localSeq: seqAfterRestore, sync } = useStorytellerStore.getState();
    expect(seqAfterRestore).toBe(sync!.ackedGameSeq); // clean right after restore
    const id = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().unseatPlayer(id); // simulates membership reconciliation revoking a stale seat
    expect(useStorytellerStore.getState().localSeq).toBe(seqAfterRestore + 1);
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(useStorytellerStore.getState().sync!.ackedGameSeq); // dirty again
  });
});
