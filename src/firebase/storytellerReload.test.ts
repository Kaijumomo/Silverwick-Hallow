// Milestone 4, WP 4-3a: a Storyteller page reload takes control of its lobby straight back.
// Before: the reloaded tab could not prove the old page's lease was its own, waited for it to expire (up to 30 s)
// and showed "Multiplayer is not live" until the Storyteller pressed Retry. Now the closing page hands its lease
// back (pagehide), and when that hand-back did not reach Firebase the new page retries by itself until the old
// lease expires. Fencing is unchanged: a lease still held by a live tab is never taken (see writer.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "@/test/memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { EXIT_RECOVERY_MS, RECLAIM_ATTEMPTS, RECLAIM_DELAY_MS, useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import type { SessionWriter } from "./writer";

const code = "RELD2345";
const root = `lobbies/${code}`;

beforeEach(() => {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0, status: "idle", failure: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function setup(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 2 });
  useStorytellerStore.getState().setLobby({ code, uid: "host", sessionId: session.id, status: "live" as const });
}

/** The old page is gone: from now on nothing it sends to /writer (under its own token) reaches Firebase. The
 * memory backend enforces no Rules, so without this its late cleanup could even overwrite the new page's lease. */
function dropWritesOf(b: MemoryRoomBackend, token: string) {
  const original = b.set.bind(b);
  b.set = async (path, value) => {
    if (path === `${root}/writer` && (value as { token?: string } | null)?.token === token) return;
    return original(path, value);
  };
}

/** The production Rules for /writer (src/firebase/rules.json), which the memory backend does not enforce: a direct
 * write may not replace another token's still-valid lease. Without this, a never-live writer's own release would
 * clear the other tab's lease here, which Firebase refuses. */
function enforceLeaseRule(b: MemoryRoomBackend) {
  const original = b.set.bind(b);
  b.set = async (path, value) => {
    if (path === `${root}/writer`) {
      const current = await b.get(path) as { token: string; expiresAt: number } | undefined;
      if (current && current.token !== (value as { token?: string }).token && current.expiresAt > Date.now()) {
        throw Object.assign(new Error("PERMISSION_DENIED: Permission denied"), { code: "PERMISSION_DENIED" });
      }
    }
    return original(path, value);
  };
}

/** Unmounts the old page's hook and mounts a fresh one, as a reload does (module state survives in a test, so
 * the runtime is reset by hand to what a new page starts with). */
function reload(b: MemoryRoomBackend, old: { unmount: () => void }) {
  old.unmount();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, retry: 0, status: "idle", failure: null });
  return renderHook(() => useStorytellerSync(b));
}

describe("Storyteller reload (WP 4-3a)", () => {
  it("pagehide hands the live writer's lease back at once and stops that writer", async () => {
    const b = new MemoryRoomBackend();
    await setup(b);
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const writer = useSessionRuntime.getState().backend as SessionWriter;

    act(() => { window.dispatchEvent(new Event("pagehide")); });

    await waitFor(async () => expect(await b.get(`${root}/writer`)).toEqual({ token: writer.token, expiresAt: 0 }));
    expect(writer.isStopped()).toBe(true);
  });

  it("beforeunload hands the lease back too, and a page that stays after all takes control back by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const b = new MemoryRoomBackend();
    await setup(b);
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const writer = useSessionRuntime.getState().backend as SessionWriter;

    act(() => { window.dispatchEvent(new Event("beforeunload")); window.dispatchEvent(new Event("pagehide")); });
    await waitFor(async () => expect(await b.get(`${root}/writer`)).toEqual({ token: writer.token, expiresAt: 0 }));
    expect(writer.isStopped()).toBe(true);

    // No unload followed (for example a cancelled navigation): nothing happens until EXIT_RECOVERY_MS, then a new
    // writer goes live.
    await act(async () => { vi.advanceTimersByTime(EXIT_RECOVERY_MS - 100); });
    expect(useSessionRuntime.getState().backend).toBeNull();
    await act(async () => { vi.advanceTimersByTime(200); });
    await waitFor(() => {
      expect(useSessionRuntime.getState().status).toBe("live");
      expect(useSessionRuntime.getState().backend).not.toBe(writer);
    });
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: (useSessionRuntime.getState().backend as SessionWriter).token });
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();
  });

  it("the reloaded page goes live with no wait and no error when the hand-back reached Firebase", async () => {
    const b = new MemoryRoomBackend();
    await setup(b);
    const first = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const old = useSessionRuntime.getState().backend as SessionWriter;

    act(() => { window.dispatchEvent(new Event("pagehide")); });
    await waitFor(async () => expect(await b.get(`${root}/writer`)).toMatchObject({ expiresAt: 0 }));
    dropWritesOf(b, old.token); // the old page is gone: its effect cleanup can no longer release anything
    reload(b, first);

    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    expect(useSessionRuntime.getState().backend).not.toBe(old);
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: (useSessionRuntime.getState().backend as SessionWriter).token });
  });

  it("when the hand-back never arrived, the reloaded page waits quietly and takes control once the old lease expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const b = new MemoryRoomBackend();
    await setup(b);
    const first = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const oldToken = (useSessionRuntime.getState().backend as SessionWriter).token;

    // The page vanished without its pagehide write landing: its lease stays on the server, still valid.
    dropWritesOf(b, oldToken);
    enforceLeaseRule(b);
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    reload(b, first);
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: oldToken });

    // Not live yet, but no failure, no error and no Retry: the status reads "Reconnecting to the lobby…".
    await waitFor(() => expect(useSessionRuntime.getState().failure).toBeNull());
    await act(async () => { await Promise.resolve(); });
    expect(useSessionRuntime.getState().status).toBe("reconnecting");
    expect(useSessionRuntime.getState().error).toBeNull();
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();

    // The old lease expires (it is no longer renewed); the next automatic retry takes control.
    const expired = { token: oldToken, expiresAt: Date.now() - 1 };
    await MemoryRoomBackend.prototype.set.call(b, `${root}/writer`, expired);
    await act(async () => { vi.advanceTimersByTime(RECLAIM_DELAY_MS); });
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    expect(useSessionRuntime.getState().errors.session).toBeUndefined();
    expect(await b.get(`${root}/writer`)).not.toMatchObject({ token: oldToken });
  });

  it("a lease another live tab keeps renewing is never taken: the automatic retries run out and Retry is offered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const b = new MemoryRoomBackend();
    await setup(b);
    // Another tab holds a valid lease and keeps it valid for the whole test.
    await b.set(`${root}/writer`, { token: "other-tab", expiresAt: Date.now() + 10 * 60_000 });
    enforceLeaseRule(b);
    let tries = 0;
    const transaction = b.transaction.bind(b);
    b.transaction = (path, change) => { if (path === `${root}/writer`) tries++; return transaction(path, change); };
    renderHook(() => useStorytellerSync(b));

    // The first attempt plus RECLAIM_ATTEMPTS automatic ones, each refused; meanwhile no failure is shown.
    for (let i = 1; i <= RECLAIM_ATTEMPTS; i++) {
      await waitFor(() => expect(tries).toBe(i));
      await waitFor(() => expect(useSessionRuntime.getState().failure).toBeNull());
      expect(useSessionRuntime.getState().status).toBe("connecting"); // this scope never went live in this page
      expect(useSessionRuntime.getState().errors.session).toBeUndefined();
      await act(async () => { vi.advanceTimersByTime(RECLAIM_DELAY_MS); });
    }
    await waitFor(() => expect(tries).toBe(RECLAIM_ATTEMPTS + 1));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("failed"));
    expect(useSessionRuntime.getState().failure?.category).toBe("authority");
    expect(useSessionRuntime.getState().errors.session).toMatch(/Another Storyteller tab controls this lobby/);
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: "other-tab" });
  });
  it("leaving the lobby while waiting makes no further attempt", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const b = new MemoryRoomBackend();
    await setup(b);
    await b.set(`${root}/writer`, { token: "other-tab", expiresAt: Date.now() + 10 * 60_000 });
    enforceLeaseRule(b);
    let tries = 0;
    const transaction = b.transaction.bind(b);
    b.transaction = (path, change) => { if (path === `${root}/writer`) tries++; return transaction(path, change); };
    const hook = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(tries).toBe(1));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    hook.unmount();
    await act(async () => { vi.advanceTimersByTime(RECLAIM_DELAY_MS * (RECLAIM_ATTEMPTS + 1)); });
    expect(tries).toBe(1);
  });
});
