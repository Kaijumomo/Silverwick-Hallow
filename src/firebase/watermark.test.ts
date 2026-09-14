// Phase 9C.2A (OPUS-001) — integration-level watermark tests: prove the
// real SessionWriter + storytellerSync.ts flush plumbing keeps ackedGuard
// and ackedGameSeq semantics correct end-to-end (not just at the isolated
// store-action level covered by storytellerStore.watermark.test.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { SessionWriter } from "./writer";
import { reportRuntimeError, startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { lifecycleMessage, requireActiveSession } from "./lifecycle";

const code = "WMIT2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0 });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function setup(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 2 });
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  return { session, lobby };
}
async function host(b: MemoryRoomBackend) {
  const ready = await setup(b);
  const writer = new SessionWriter(b, code, ready.session.id, error =>
    reportRuntimeError("write", error ? lifecycleMessage(error) : null));
  const manager = await startStorytellerSession(b, ready.lobby, writer);
  disposals.push(async () => { manager.stop(); await writer.dispose(); });
  return { ...ready, writer, manager };
}

describe("watermark integration: ackedGuard vs ackedGameSeq", () => {
  it("a successful projection flush advances ackedGameSeq to exactly the localSeq captured when that flush began, and a mutation during an in-flight flush remains dirty afterward", async () => {
    const b = new MemoryRoomBackend();
    await host(b);
    const seqAtHostReturn = useStorytellerStore.getState().localSeq;
    const sync1 = useStorytellerStore.getState().sync!;
    expect(sync1.ackedGameSeq).toBe(seqAtHostReturn); // the initial flush already acknowledged host()'s setup mutations

    // Hold the next write back after it has "landed" on the backend but
    // before its promise resolves, so a mutation can happen while the flush
    // is provably still in flight.
    const originalUpdate = b.update.bind(b);
    let releaseFlush: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseFlush = resolve; });
    let intercepted = false;
    b.update = async updates => {
      if (intercepted) return originalUpdate(updates);
      intercepted = true;
      await originalUpdate(updates);
      await gate;
    };

    useStorytellerStore.getState().addPlayer("Alice"); // schedules a flush; localSeq advances
    const seqAtFlushStart = useStorytellerStore.getState().localSeq;
    await waitFor(() => expect(intercepted).toBe(true));

    // Mutate again WHILE the first flush's commit is still in flight.
    useStorytellerStore.getState().addPlayer("Bob");
    const seqAfterSecondMutation = useStorytellerStore.getState().localSeq;
    expect(seqAfterSecondMutation).toBeGreaterThan(seqAtFlushStart);

    releaseFlush();
    await waitFor(() => expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(seqAtFlushStart));
    // The store remains dirty right after that: the second mutation's
    // localSeq is still ahead of what this first flush acknowledged.
    expect(useStorytellerStore.getState().localSeq).toBe(seqAfterSecondMutation);
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(useStorytellerStore.getState().sync!.ackedGameSeq);

    // The second flush (scheduled by Bob's addPlayer) eventually catches up.
    b.update = originalUpdate;
    await waitFor(() => expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(seqAfterSecondMutation));
  });

  it("a successful non-projection writer commit advances ackedGuard but never ackedGameSeq, even while local is dirty", async () => {
    const b = new MemoryRoomBackend();
    const { writer } = await host(b);
    useStorytellerStore.getState().addPlayer("Alice");
    await waitFor(() => expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));

    useStorytellerStore.getState().addPlayer("Carol");
    const localSeqNow = useStorytellerStore.getState().localSeq;
    const ackedGameSeqNow = useStorytellerStore.getState().sync!.ackedGameSeq;
    expect(localSeqNow).toBeGreaterThan(ackedGameSeqNow); // dirty: Carol's mutation is not yet flushed

    await writer.set(`${root}/storyteller/notes`, "membership-only ping"); // a real, successful, non-projection commit
    expect(useStorytellerStore.getState().sync!.ackedGuard).toBeTruthy();
    // ackedGameSeq must be untouched by this non-projection commit — the
    // store must still read as dirty by exactly the same margin.
    expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(ackedGameSeqNow);
    expect(useStorytellerStore.getState().localSeq).toBe(localSeqNow);
  });

  it("a belated success arriving after the writer has terminally stopped does not advance ackedGuard or ackedGameSeq", async () => {
    const b = new MemoryRoomBackend();
    const { writer } = await host(b);
    useStorytellerStore.getState().addPlayer("Alice");
    const originalUpdate = b.update.bind(b);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    b.update = async updates => {
      if (intercepted) return originalUpdate(updates);
      intercepted = true;
      const result = await originalUpdate(updates);
      await gate;
      return result;
    };
    useStorytellerStore.getState().addPlayer("Bob");
    await waitFor(() => expect(intercepted).toBe(true));

    const ackedGuardBeforeStop = useStorytellerStore.getState().sync!.ackedGuard;
    const ackedGameSeqBeforeStop = useStorytellerStore.getState().sync!.ackedGameSeq;
    writer.stop();
    expect(writer.isStopped()).toBe(true);
    release();
    await new Promise(resolve => setTimeout(resolve, 20));

    // The belated success must not have advanced either watermark past what
    // was true at the moment of the stop.
    expect(useStorytellerStore.getState().sync!.ackedGuard).toEqual(ackedGuardBeforeStop);
    expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(ackedGameSeqBeforeStop);
    b.update = originalUpdate;
  });
});
