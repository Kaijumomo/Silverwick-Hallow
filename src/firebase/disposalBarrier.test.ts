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

    // Hold back the very next /writer transaction — this is writer1's own
    // release() call, queued by its disposal once the upcoming retry's
    // cleanup fires (dispose() is chained, not called synchronously in the
    // cleanup itself).
    const originalTransaction = b.transaction.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let intercepted = false;
    b.transaction = async (path, change) => {
      if (path === `${root}/writer` && !intercepted) {
        intercepted = true;
        await gate;
      }
      return originalTransaction(path, change);
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

    b.transaction = originalTransaction;
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
