// Phase 9C.2A (OPUS-001), section 10 — deterministic disposal barrier.
// Proves the self-reconnect disposal race is closed: a replacement writer
// must not attempt lease acquisition while the previous writer's disposal
// (which releases that same lease) is still in flight.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { retryStorytellerSession, useSessionRuntime, useStorytellerSync } from "./storytellerSync";

const code = "DISP2345";
const root = `lobbies/${code}`;

beforeEach(() => {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0 });
});
afterEach(() => { cleanup(); });

async function setup(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 2 });
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  return { session, lobby };
}

describe("disposal barrier: rapid retry / double reconnect", () => {
  it("a replacement writer waits for the previous writer's lease release before acquiring — no spurious 'another tab' failure", async () => {
    const b = new MemoryRoomBackend();
    await setup(b);
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().backend).not.toBeNull());
    const writer1 = useSessionRuntime.getState().backend!;

    // Hold back the very next /writer set() — this is writer1's own
    // release() call (Finding H3: release is now a single fenced set(), not
    // a transaction), queued by its disposal once the upcoming retry's
    // cleanup fires (dispose() is chained, not called synchronously in the
    // cleanup itself).
    const originalSet = b.set.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let intercepted = false;
    b.set = async (path, value) => {
      if (path === `${root}/writer` && !intercepted) {
        intercepted = true;
        await gate;
      }
      return originalSet(path, value);
    };

    act(() => { retryStorytellerSession(); });
    await waitFor(() => expect(intercepted).toBe(true));

    // While writer1's release is artificially stuck, the replacement writer
    // must NOT have attempted (and failed) its own acquisition — that would
    // surface as a "session" runtime error ("Another Storyteller tab
    // controls this lobby"). This is exactly what a fire-and-forget dispose
    // (no barrier) would produce here.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();
    expect(useSessionRuntime.getState().backend).toBeNull(); // not yet re-acquired

    b.set = originalSet;
    releaseGate();

    await waitFor(() => expect(useSessionRuntime.getState().backend).not.toBeNull());
    expect(useSessionRuntime.getState().backend).not.toBe(writer1);
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: useSessionRuntime.getState().backend!.token });
  });

  it("three rapid reconnects in a row settle on exactly one live writer, with no session error along the way", async () => {
    const b = new MemoryRoomBackend();
    await setup(b);
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().backend).not.toBeNull());

    act(() => {
      retryStorytellerSession();
      retryStorytellerSession();
      retryStorytellerSession();
    });

    await waitFor(() => expect(useSessionRuntime.getState().backend).not.toBeNull(), { timeout: 3000 });
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: useSessionRuntime.getState().backend!.token });
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.2B.3 — remount/listener characterization (test-only; production
// lifecycle code is not touched by this item unless this test uncovers a
// concrete integrity defect). Investigates the real component/session
// remount sequence — old instance disposal, a delayed writer release,
// immediate replacement startup, and first writer/listener notifications —
// through the actual useStorytellerSync hook (not a direct SessionWriter/
// startStorytellerSession call, which the Phase 9C.2B.1 suite already
// covers). Counts MemoryRoomBackend's own listener map directly (there is
// no public "how many watchers are active" API) to prove listeners are
// torn down, not merely superseded.
// ---------------------------------------------------------------------------
describe("Phase 9C.2B.3 characterization: remount / first-listener race", () => {
  function totalListenerCount(b: MemoryRoomBackend): number {
    const listeners = (b as unknown as { listeners: Map<string, Set<unknown>> }).listeners;
    let total = 0;
    for (const set of listeners.values()) total += set.size;
    return total;
  }

  it("a remount tears down the old instance's listeners synchronously and the old writer can never publish again, even while its own release is still stuck in flight", async () => {
    const b = new MemoryRoomBackend();
    await setup(b);
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().backend).not.toBeNull());
    const writer1 = useSessionRuntime.getState().backend!;

    const listenersBeforeRemount = totalListenerCount(b);
    expect(listenersBeforeRemount).toBeGreaterThan(0); // sanity: watchers really are installed

    // Stall writer1's own release() write (Finding H3's single fenced
    // set()) — the same technique the disposal-barrier suite above uses —
    // so its disposal stays genuinely in flight while the replacement
    // effect below starts immediately.
    const originalSet = b.set.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let intercepted = false;
    b.set = async (path, value) => {
      if (path === `${root}/writer` && !intercepted) {
        intercepted = true;
        await gate;
      }
      return originalSet(path, value);
    };

    act(() => { retryStorytellerSession(); });
    await waitFor(() => expect(intercepted).toBe(true));

    // The old instance's own effect cleanup tears down every watcher
    // synchronously (writer.stop() -> the session's own stop() ->
    // cleanups.splice(0).forEach(off => off())) — not deferred behind the
    // disposal barrier's own (still-stuck) release. No window exists where
    // both a dying old instance and a not-yet-live new one are watching
    // the same paths at once.
    expect(totalListenerCount(b)).toBe(0);

    // The old writer can never publish again: a commit attempted through
    // it now is rejected outright by its own runExclusive queue, never
    // silently queued to leak out once the artificial gate below lifts.
    const notesBeforeStaleWrite = await b.get(`${root}/storyteller/notes`);
    await expect(writer1.set(`${root}/storyteller/notes`, "stale, post-stop write")).rejects.toThrow();

    // The replacement is still waiting on the disposal barrier — genuinely
    // not live yet, not merely slow.
    expect(useSessionRuntime.getState().backend).toBeNull();

    b.set = originalSet;
    releaseGate();

    await waitFor(() => expect(useSessionRuntime.getState().backend).not.toBeNull());
    const writer2 = useSessionRuntime.getState().backend!;
    expect(writer2).not.toBe(writer1);
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();

    // Exactly one writer is recognized as authoritative by the server —
    // never both.
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: writer2.token });
    // The stale write attempted through the old (stopped) writer above
    // never actually reached the server — the field is exactly as it was
    // before that attempt, never the rejected writer's own value.
    expect(await b.get(`${root}/storyteller/notes`)).toBe(notesBeforeStaleWrite);
    // The replacement's own listeners are installed fresh — same shape as
    // a single live writer, never accumulated on top of a leaked old set.
    expect(totalListenerCount(b)).toBe(listenersBeforeRemount);
  });
});
