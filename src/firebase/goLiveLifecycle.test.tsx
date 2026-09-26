// Go Live startup lifecycle hotfix. Reproduced production defect: deployed
// Firebase rules older than Phase 9R.6 deny the Storyteller's startup read of
// `membershipRevocations`, so the writer never went live; End Game then threw
// "Reconnect to the lobby before ending it" forever, and every failure read
// as "This session no longer permits the operation". These tests pin the
// hardened contract: the runtime never claims live before its initial
// acknowledged flush; a startup failure is attributed and recoverable (retry,
// authoritative close through the SessionWriter seam, and -- only for a lobby
// that never reached live -- a local-only Leave); End Game never marks the
// local game ended while an authoritative close failed; and the connection
// status is an in-flow banner, not a fixed overlay. The enforced-rules
// counterpart lives in goLiveRulesDrift.spec.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { RoomBackend } from "./backend";
import { MemoryRoomBackend } from "./memoryBackend";
import { attributeFirebaseError } from "./firebaseBackend";
import { createLobby } from "./lobby";
import { classifyStorytellerError, isTransient, LifecycleError, requireActiveSession } from "./lifecycle";
import { LEASE_MS, SessionWriter } from "./writer";
import { closeMultiplayerSession, leaveMultiplayerOffline, retryStorytellerSession, scopeKey, useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { ConnectionStatus } from "./StorytellerSession";

const firebase = vi.hoisted(() => ({ backend: null as RoomBackend | null }));
vi.mock("./session", () => ({
  connectFirebase: async () => {
    if (!firebase.backend) throw new Error("Firebase is not configured.");
    return { backend: firebase.backend, uid: "host" };
  },
}));

let codeCounter = 0;
let code = "";
let root = "";
beforeEach(() => {
  // A fresh lobby code per test: liveScopes (runtime memory of scopes that
  // reached live) is module-level, exactly as in the app.
  code = `GOLV${String(2000 + ++codeCounter).slice(-4).replace(/[01]/g, "9")}`;
  root = `lobbies/${code}`;
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "game" });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); firebase.backend = null; vi.restoreAllMocks(); });

/** A permission denial shaped like the Firebase SDK's, attributed the way the
 * production FirebaseRoomBackend attributes it. */
function denied(operation: string, path: string) {
  return attributeFirebaseError(Object.assign(new Error("PERMISSION_DENIED: Permission denied"), { code: "PERMISSION_DENIED" }), operation, path);
}
/** Deployed rules predating Phase 9R.6 have no read grant for this path. */
function denyRead(b: MemoryRoomBackend, suffix: string) {
  const get = b.get.bind(b);
  b.get = async path => { if (path === `${root}/${suffix}`) throw denied("get", path); return get(path); };
  return () => { b.get = get; };
}
/** Deny any multi-path update that touches `suffix` (e.g. the final close). */
function denyUpdate(b: MemoryRoomBackend, suffix: string) {
  const update = b.update.bind(b);
  b.update = async updates => {
    if (Object.keys(updates).some(path => path === `${root}/${suffix}` || path.startsWith(`${root}/${suffix}/`))) throw denied("update", Object.keys(updates).join(", "));
    return update(updates);
  };
  return () => { b.update = update; };
}

/** GameScreen.goLive, verbatim: create the lobby, then hand the session to the
 * app-level lifecycle hook, which owns writer startup. */
async function goLive(b: MemoryRoomBackend, before?: (sessionId: string) => void) {
  firebase.backend = b;
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 3 });
  useStorytellerStore.getState().addPlayer("Alice");
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  before?.(session.id);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  const exposed: unknown[] = [];
  const unsubscribe = useSessionRuntime.subscribe(state => { if (state.backend) exposed.push(state.backend); });
  const hook = renderHook(() => useStorytellerSync(b));
  return { session, lobby, exposed, unsubscribe, hook };
}
const settled = () => waitFor(() => expect(["live", "failed", "blocked"]).toContain(useSessionRuntime.getState().status));

describe("Go Live startup", () => {
  it("1. happy path: lobby -> writer lease -> initial projection -> runtime live", async () => {
    const b = new MemoryRoomBackend();
    const { exposed } = await goLive(b);
    expect(useSessionRuntime.getState().status).toBe("connecting");
    await settled();
    const runtime = useSessionRuntime.getState();
    expect(runtime.status).toBe("live");
    expect(runtime.backend).toBeInstanceOf(SessionWriter);
    expect(runtime.failure).toBeNull();
    expect(runtime.error).toBeNull();
    expect(exposed.length).toBeGreaterThan(0);
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: (runtime.backend as SessionWriter).token });
    expect(await b.get(`${root}/checkpoint`)).toEqual(expect.any(String));
    expect(await b.get(`${root}/public`)).toMatchObject({ code });
    expect(useStorytellerStore.getState().sync?.ackedGuard).not.toBeNull();
  });

  it("2. initial projection denied: never exposes a live backend, reports an attributed rules failure, advances nothing", async () => {
    const b = new MemoryRoomBackend();
    denyUpdate(b, "checkpoint");
    const { exposed } = await goLive(b);
    await settled();
    const runtime = useSessionRuntime.getState();
    expect(runtime.status).toBe("failed");
    expect(exposed).toEqual([]);
    expect(runtime.backend).toBeNull();
    expect(runtime.failure?.category).toBe("rules");
    // Plain language for the Storyteller; the path stays in the diagnostic.
    expect(runtime.error).toBe(runtime.failure!.message);
    expect(runtime.error).not.toMatch(/lobbies\/|PERMISSION_DENIED|no longer permits/);
    expect(runtime.failure!.diagnostic).toContain(`${root}/checkpoint`);
    // Neither side is falsely advanced.
    expect(await b.get(`${root}/checkpoint`)).toBeUndefined();
    expect(await b.get(`${root}/public`)).toBeUndefined();
    const sync = useStorytellerStore.getState().sync!;
    expect(sync.ackedGuard).toBeNull();
    expect(sync.ackedGameSeq).toBeLessThan(useStorytellerStore.getState().localSeq);
    // The lobby association and local game are untouched.
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    expect(useStorytellerStore.getState().game?.phase).toBe("setup");
  });

  it("the exact production defect: a denied startup read of membershipRevocations is a rules failure, not 'session no longer permits'", async () => {
    const b = new MemoryRoomBackend();
    denyRead(b, "membershipRevocations");
    const { exposed } = await goLive(b);
    await settled();
    expect(useSessionRuntime.getState().status).toBe("failed");
    expect(exposed).toEqual([]);
    expect(useSessionRuntime.getState().failure).toMatchObject({ category: "rules" });
    expect(useSessionRuntime.getState().failure!.diagnostic).toContain(`get ${root}/membershipRevocations`);
    expect(useSessionRuntime.getState().error).toMatch(/database rules/);
  });

  it("3a. writer acquisition blocked by another tab's valid lease: authority conflict, never live", async () => {
    const b = new MemoryRoomBackend();
    const { exposed } = await goLive(b, () => { void b.set(`${root}/writer`, { token: "other-tab", expiresAt: Date.now() + LEASE_MS }); });
    await settled();
    expect(useSessionRuntime.getState().status).toBe("failed");
    expect(exposed).toEqual([]);
    expect(useSessionRuntime.getState().failure?.category).toBe("authority");
    expect(useSessionRuntime.getState().error).toMatch(/Another Storyteller tab/);
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: "other-tab" });
  });

  it("3b. writer acquisition denied by the server: rules failure, never live", async () => {
    const b = new MemoryRoomBackend();
    const transaction = b.transaction.bind(b);
    b.transaction = async (path, change) => { if (path === `${root}/writer`) throw denied("transaction", path); return transaction(path, change); };
    const { exposed } = await goLive(b);
    await settled();
    expect(useSessionRuntime.getState().status).toBe("failed");
    expect(exposed).toEqual([]);
    expect(useSessionRuntime.getState().failure?.category).toBe("rules");
  });

  it("4. retry after a recoverable startup failure goes live through the existing retry seam", async () => {
    const b = new MemoryRoomBackend();
    const get = b.get.bind(b);
    let failures = 1;
    b.get = async path => {
      if (path === `${root}/membershipRevocations` && failures-- > 0) throw new Error("network offline");
      return get(path);
    };
    await goLive(b);
    await settled();
    expect(useSessionRuntime.getState().status).toBe("failed");
    expect(useSessionRuntime.getState().failure?.category).toBe("network");
    act(() => { retryStorytellerSession(); });
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    expect(useSessionRuntime.getState().backend).not.toBeNull();
    expect(useSessionRuntime.getState().error).toBeNull();
    expect(useSessionRuntime.getState().failure).toBeNull();
    expect(await b.get(`${root}/checkpoint`)).toEqual(expect.any(String));
  });
});

describe("End Game / abandon contract", () => {
  it("5. a normal live session closes authoritatively before local completion", async () => {
    const b = new MemoryRoomBackend();
    const { session } = await goLive(b);
    await settled();
    expect(useSessionRuntime.getState().status).toBe("live");
    await act(async () => { await closeMultiplayerSession(); useStorytellerStore.getState().endGame(); });
    expect(await b.get(`${root}/session`)).toEqual({ version: 2, id: session.id, state: "ended" });
    expect(await b.get(`${root}/checkpoint`)).toBeUndefined();
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("6a. a startup that never went live is closed authoritatively through a fresh fenced SessionWriter", async () => {
    const b = new MemoryRoomBackend();
    denyRead(b, "membershipRevocations");
    const { session } = await goLive(b);
    await settled();
    expect(useSessionRuntime.getState().status).toBe("failed");
    await act(async () => { await closeMultiplayerSession(); });
    expect(await b.get(`${root}/session`)).toEqual({ version: 2, id: session.id, state: "ended" });
    expect(await b.get(`${root}/public/status`)).toBe("ended");
    // Fenced: the close carried a writer guard, and released its own lease.
    expect(await b.get(`${root}/writeGuard`)).toMatchObject({ revision: expect.any(Number) });
    expect(await b.get(`${root}/writer`)).toMatchObject({ expiresAt: 0 });
    expect(useStorytellerStore.getState().lobby).toBeNull();
    // Ending the lobby alone does not end the local game.
    expect(useStorytellerStore.getState().game).not.toBeNull();
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
  });

  it("6b. when that close also fails, End Game leaves lobby and game untouched and offers local-only Leave", async () => {
    const b = new MemoryRoomBackend();
    denyRead(b, "membershipRevocations");
    // Pre-9R.6 rules also refuse the final close cleanup, which deletes
    // membershipRevocations.
    denyUpdate(b, "membershipRevocations");
    const { session } = await goLive(b);
    await settled();
    // The same handler GameScreen's End Game button runs.
    const endGame = vi.spyOn(useStorytellerStore.getState(), "endGame");
    let rejected: unknown = null;
    await act(async () => {
      try { await closeMultiplayerSession(); useStorytellerStore.getState().endGame(); }
      catch (error) { rejected = error; }
    });
    expect(rejected).not.toBeNull();
    expect(endGame).not.toHaveBeenCalled();
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    expect(useStorytellerStore.getState().game).not.toBeNull();
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("active");
    const runtime = useSessionRuntime.getState();
    expect(runtime.closeFailed).toBe(true);
    expect(runtime.leaveOffer).toBe(scopeKey({ code, sessionId: session.id }));
    expect(runtime.errors.close).toMatch(/could not be ended/);

    // A repeated close attempt (which re-observes our own earlier close
    // sentinel) keeps the offer: eligibility is "never reached live".
    await act(async () => { await closeMultiplayerSession().catch(() => {}); });
    expect(useSessionRuntime.getState().leaveOffer).toBe(scopeKey({ code, sessionId: session.id }));

    render(<ConnectionStatus />);
    const game = useStorytellerStore.getState().game;
    fireEvent.click(screen.getByRole("button", { name: "Leave multiplayer — keep game offline" }));
    // Leave re-proves the server evidence before clearing the lobby.
    await waitFor(() => expect(useStorytellerStore.getState().lobby).toBeNull());
    expect(useStorytellerStore.getState().game).toBe(game);
    expect(useStorytellerStore.getState().game?.phase).toBe("setup");
    expect(endGame).not.toHaveBeenCalled();
    // Local only: nothing on the server was deleted.
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("active");
  });

  it("6c. a session that previously reached live never gets the local-only Leave", async () => {
    const b = new MemoryRoomBackend();
    await goLive(b);
    await settled();
    expect(useSessionRuntime.getState().status).toBe("live");
    // A later reconnect fails at startup, and so does the close.
    denyRead(b, "membershipRevocations");
    denyUpdate(b, "membershipRevocations");
    act(() => { retryStorytellerSession(); });
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("failed"));
    await act(async () => { await closeMultiplayerSession().catch(() => {}); });
    expect(useSessionRuntime.getState().closeFailed).toBe(true);
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
    expect(await leaveMultiplayerOffline()).toBe(false);
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    render(<ConnectionStatus />);
    expect(screen.queryByRole("button", { name: /Leave multiplayer/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Try ending again" })).toBeInTheDocument();
  });

  it("6d. server evidence of a published session (a checkpoint) also withholds Leave, even with no local evidence", async () => {
    const b = new MemoryRoomBackend();
    denyRead(b, "membershipRevocations");
    denyUpdate(b, "membershipRevocations");
    // Another device already went live on this session: its (valid)
    // checkpoint exists.
    await goLive(b, () => {
      const game = { ...useStorytellerStore.getState().game!, code };
      void b.set(`${root}/checkpoint`, JSON.stringify({ game, roster: {} }));
    });
    await settled();
    expect(useSessionRuntime.getState().status).toBe("failed");
    await act(async () => { await closeMultiplayerSession().catch(() => {}); });
    expect(useSessionRuntime.getState().closeFailed).toBe(true);
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
    expect(await leaveMultiplayerOffline()).toBe(false);
  });

  it("7. writer fencing stays intact: the failed-start close refuses to override another writer's valid lease", async () => {
    const b = new MemoryRoomBackend();
    denyRead(b, "membershipRevocations");
    // The writer rule that fences a lease (rules.json `writer/.write`): a
    // foreign token's still-valid lease cannot be overwritten. The emulator
    // counterpart in goLiveRulesDrift.spec.ts proves this under real rules.
    const set = b.set.bind(b);
    b.set = async (path, value) => {
      if (path === `${root}/writer`) {
        const current = await b.get(path) as { token: string; expiresAt: number } | undefined;
        const next = value as { token: string };
        if (current && current.token !== next.token && current.expiresAt > Date.now()) throw denied("set", path);
      }
      return set(path, value);
    };
    const { session } = await goLive(b);
    await settled();
    // Another Storyteller tab legitimately acquires the lease in between.
    await set(`${root}/writer`, { token: "other-tab", expiresAt: Date.now() + LEASE_MS });
    let rejected: unknown = null;
    await act(async () => { await closeMultiplayerSession().catch(error => { rejected = error; }); });
    expect(rejected).toBeInstanceOf(LifecycleError);
    expect((rejected as LifecycleError).kind).toBe("conflict");
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: "other-tab" });
    expect(await b.get(`${root}/session`)).toEqual({ version: 2, id: session.id, state: "active" });
    expect(await b.get(`${root}/public/status`)).toBeUndefined();
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    expect(useSessionRuntime.getState().failure?.category).toBe("authority");
  });

  it("7b. a live writer is still fenced: a second writer cannot acquire its lease", async () => {
    const b = new MemoryRoomBackend();
    const { session } = await goLive(b);
    await settled();
    const second = new SessionWriter(b, code, session.id);
    await expect(second.start()).rejects.toMatchObject({ kind: "conflict" });
    second.stop();
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: (useSessionRuntime.getState().backend as SessionWriter).token });
  });
});

describe("HOTFIX-RV-001: local-only Leave fails closed without authoritative server proof", () => {
  /** The exact pre-9R.6 drift: startup denied at membershipRevocations, and
   * the fenced close's final cleanup denied too. */
  async function failedStartWithFailedClose(b: MemoryRoomBackend, before?: (sessionId: string) => void) {
    denyRead(b, "membershipRevocations");
    denyUpdate(b, "membershipRevocations");
    const started = await goLive(b, before);
    await settled();
    expect(useSessionRuntime.getState().status).toBe("failed");
    return started;
  }
  async function attemptEnd() {
    let rejected: unknown = null;
    await act(async () => { await closeMultiplayerSession().catch(error => { rejected = error; }); });
    expect(rejected).not.toBeNull();
    expect(useSessionRuntime.getState().closeFailed).toBe(true);
  }

  it("1. checkpoint read denied, no local live evidence: Leave is not offered", async () => {
    const b = new MemoryRoomBackend();
    await failedStartWithFailedClose(b);
    expect(useStorytellerStore.getState().sync?.ackedGuard ?? null).toBeNull();
    denyRead(b, "checkpoint");
    await attemptEnd();
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
    expect(await leaveMultiplayerOffline()).toBe(false);
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    render(<ConnectionStatus />);
    expect(screen.queryByRole("button", { name: /Leave multiplayer/ })).toBeNull();
  });

  it("1b. checkpoint read unavailable (network) or Firebase unreachable, no local live evidence: Leave is not offered", async () => {
    const b = new MemoryRoomBackend();
    await failedStartWithFailedClose(b);
    const get = b.get.bind(b);
    b.get = async path => { if (path === `${root}/checkpoint`) throw new Error("network offline"); return get(path); };
    await attemptEnd();
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();

    firebase.backend = null; // connectFirebase itself now fails
    await attemptEnd();
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
    expect(await leaveMultiplayerOffline()).toBe(false);
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
  });

  it("2. another device published a checkpoint that this device cannot read: Leave is not offered", async () => {
    const b = new MemoryRoomBackend();
    await failedStartWithFailedClose(b, () => {
      // Another Storyteller device took this session live: its checkpoint
      // exists, and this device recorded no acknowledged guard for it.
      const game = { ...useStorytellerStore.getState().game!, code };
      void b.set(`${root}/checkpoint`, JSON.stringify({ game, roster: {} }));
    });
    expect(await b.get(`${root}/checkpoint`)).toEqual(expect.any(String));
    expect(useStorytellerStore.getState().sync?.ackedGuard ?? null).toBeNull();
    denyRead(b, "checkpoint");
    await attemptEnd();
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
    expect(await leaveMultiplayerOffline()).toBe(false);
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
  });

  it("3. an authoritative read proving no checkpoint, in the known startup-failure case, keeps Leave offered after the close fails", async () => {
    const b = new MemoryRoomBackend();
    const { session } = await failedStartWithFailedClose(b);
    await attemptEnd();
    expect(await b.get(`${root}/checkpoint`)).toBeUndefined();
    expect(useSessionRuntime.getState().leaveOffer).toBe(scopeKey({ code, sessionId: session.id }));
    const game = useStorytellerStore.getState().game;
    expect(await leaveMultiplayerOffline()).toBe(true);
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useStorytellerStore.getState().game).toBe(game);
  });

  it("a standing offer is re-proven when chosen: if the proof is now unavailable, Leave refuses and is withdrawn", async () => {
    const b = new MemoryRoomBackend();
    const { session } = await failedStartWithFailedClose(b);
    await attemptEnd();
    expect(useSessionRuntime.getState().leaveOffer).toBe(scopeKey({ code, sessionId: session.id }));
    denyRead(b, "checkpoint");
    expect(await leaveMultiplayerOffline()).toBe(false);
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
    expect(useSessionRuntime.getState().errors.close).toMatch(/could not be confirmed/);
  });

  it("a standing offer is re-proven when chosen: a checkpoint published since the offer refuses Leave", async () => {
    const b = new MemoryRoomBackend();
    await failedStartWithFailedClose(b);
    await attemptEnd();
    expect(useSessionRuntime.getState().leaveOffer).not.toBeNull();
    await b.set(`${root}/checkpoint`, "published since the offer");
    expect(await leaveMultiplayerOffline()).toBe(false);
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
  });

  it("local evidence can disqualify: an accepted guard for this scope withholds Leave even with no checkpoint", async () => {
    const b = new MemoryRoomBackend();
    await failedStartWithFailedClose(b, sessionId => {
      useStorytellerStore.setState({ sync: { code, sessionId, ackedGuard: { token: "earlier-writer", revision: 3 }, ackedGameSeq: 0, lastAttempt: null } });
    });
    expect(await b.get(`${root}/checkpoint`)).toBeUndefined();
    await attemptEnd();
    expect(useSessionRuntime.getState().leaveOffer).toBeNull();
    expect(await leaveMultiplayerOffline()).toBe(false);
  });
});

describe("resume hardening", () => {
  it("a resumed tab whose lease may have lapsed revalidates through the existing retry seam", async () => {
    const b = new MemoryRoomBackend();
    await goLive(b);
    await settled();
    const first = useSessionRuntime.getState().backend as SessionWriter;
    const retry = useSessionRuntime.getState().retry;

    // Lease still provably held: resuming does nothing.
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(useSessionRuntime.getState().retry).toBe(retry);
    expect(first.leaseMayHaveLapsed()).toBe(false);

    // The tab slept past its lease without renewing.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + LEASE_MS + 5_000);
    expect(first.leaseMayHaveLapsed()).toBe(true);
    act(() => { window.dispatchEvent(new Event("pageshow")); });
    expect(useSessionRuntime.getState().retry).toBe(retry + 1);
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const second = useSessionRuntime.getState().backend as SessionWriter;
    expect(second).not.toBe(first);
    expect(first.isStopped()).toBe(true);
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: second.token });
    // Reconnect, not a fresh start: the scope had reached live before.
    expect(useStorytellerStore.getState().sync?.ackedGuard?.token).toBe(second.token);
  });
});

describe("connection status presentation", () => {
  it("8. renders as a compact in-flow banner with status/alert semantics, never the old fixed overlay", async () => {
    const b = new MemoryRoomBackend();
    denyRead(b, "membershipRevocations");
    await goLive(b);
    const view = render(<ConnectionStatus />);
    expect(view.container.querySelector(".connection-status[role='status']")?.textContent).toMatch(/Connecting to the lobby/);
    await settled();
    view.rerender(<ConnectionStatus />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("connection-status");
    expect(alert).not.toHaveClass("lobby-error");
    expect(alert.querySelector(".connection-status-message")?.textContent).not.toMatch(/lobbies\/|PERMISSION_DENIED/);
    const technical = alert.querySelector(".connection-status-diagnostic");
    expect(technical).not.toBeNull();
    expect(technical?.textContent).toContain("rules");
    expect(technical?.textContent).toContain("code=PERMISSION_DENIED");
    expect(technical?.textContent).toContain(`operation=get ${root}/membershipRevocations`);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End multiplayer" })).toBeInTheDocument();
    // Leave is not offered until an authoritative close has been attempted.
    expect(screen.queryByRole("button", { name: /Leave multiplayer/ })).toBeNull();
    expect(screen.queryByText(/reclaim expired writer/)).toBeNull();

    const css = readFileSync(resolve(__dirname, "../styles/components.css"), "utf8");
    expect(css).not.toMatch(/\.lobby-error\s*\{/);
    const block = css.match(/\.connection-status\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).not.toBe("");
    expect(block).not.toMatch(/position\s*:\s*(fixed|absolute)/);
  });

  it("renders nothing while live and healthy", async () => {
    const b = new MemoryRoomBackend();
    await goLive(b);
    await settled();
    const { container } = render(<ConnectionStatus />);
    expect(container.innerHTML).toBe("");
  });
});

describe("error classification", () => {
  const permission = () => Object.assign(new Error("PERMISSION_DENIED: Permission denied"), { code: "PERMISSION_DENIED" });
  it("distinguishes startup rules failures, expired live writers, conflicts, ended sessions and network loss", () => {
    expect(classifyStorytellerError(attributeFirebaseError(permission(), "get", "lobbies/X/membershipRevocations"), "startup").category).toBe("rules");
    expect(classifyStorytellerError(attributeFirebaseError(permission(), "update", "lobbies/X/public"), "startup").category).toBe("rules");
    expect(classifyStorytellerError(attributeFirebaseError(permission(), "update", "lobbies/X/public"), "live").category).toBe("expired");
    expect(classifyStorytellerError(attributeFirebaseError(permission(), "subscribe", "lobbies/X/presence"), "live").category).toBe("rules");
    expect(classifyStorytellerError(permission(), "live", "read").category).toBe("rules");
    expect(classifyStorytellerError(new LifecycleError("conflict", "Another Storyteller tab controls this lobby."), "startup").category).toBe("authority");
    expect(classifyStorytellerError(new LifecycleError("ended", "This game has ended."), "live").category).toBe("ended");
    expect(classifyStorytellerError(new Error("network offline"), "live").category).toBe("network");
  });

  it("keeps the Firebase path in the diagnostic only, and attribution never changes the error's message, code or retry class", () => {
    const error = attributeFirebaseError(permission(), "get", "lobbies/X/membershipRevocations") as Error & { code: string };
    expect(error.message).toBe("PERMISSION_DENIED: Permission denied");
    expect(error.code).toBe("PERMISSION_DENIED");
    expect(Object.keys(error)).not.toContain("firebaseOperation");
    expect(isTransient(error)).toBe(false);
    const failure = classifyStorytellerError(error, "startup");
    expect(failure.message).not.toMatch(/lobbies\/|membershipRevocations|PERMISSION/);
    expect(failure.diagnostic).toContain("get lobbies/X/membershipRevocations");
    const network = attributeFirebaseError(new Error("network offline"), "get", "lobbies/X/roster");
    expect(isTransient(network)).toBe(true);
  });
});
