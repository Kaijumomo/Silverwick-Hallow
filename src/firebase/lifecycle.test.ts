import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby, rejectJoinRequest } from "./lobby";
import { SessionWriter } from "./writer";
import { applyJoinIntent, joinLobby, leaveLobby, startPlayerHandshake } from "./playerSync";
import { startStorytellerSession, useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { requireActiveSession, retryTransient, sessionPath } from "./lifecycle";
import { revokePlayerAndCommit, seatPlayerAndCommit } from "./membershipCommands";

const code = "BCDF2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [] });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, error: null, presence: "unknown", online: {}, pending: 0 });
});
afterEach(async () => { cleanup(); for (const dispose of disposals.splice(0).reverse()) await dispose(); vi.useRealTimers(); });
async function setup(b = new MemoryRoomBackend()) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 2 });
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  return { b, session, lobby };
}
async function host(b = new MemoryRoomBackend()) {
  const ready = await setup(b);
  const writer = new SessionWriter(b, code, ready.session.id);
  const manager = await startStorytellerSession(b, ready.lobby, writer);
  disposals.push(async () => { manager.stop(); await writer.dispose(); });
  return { ...ready, writer, manager };
}
function player(b: MemoryRoomBackend) { const stop = startPlayerHandshake(b, code, "alice"); disposals.push(stop); return stop; }
async function seat(writer: SessionWriter) {
  await waitFor(() => expect(useStorytellerStore.getState().game?.pendingPlayers.alice).toBe("Alice"));
  const id = useStorytellerStore.getState().game!.seatOrder[0]!;
  await seatPlayerAndCommit(writer, code, "alice", id, null, () => useStorytellerStore.getState().assignPendingToSeat("alice", id));
  return id;
}

describe("multiplayer lifecycle", () => {
  it.each([
    ["drunk", "chef", "good"],
    ["marionette", "washerwoman", "good"],
    ["lunatic", "imp", "evil"],
  ])("AUD-004: %s perception survives retry, navigation, player refresh and host recovery", async (actual, shown, alignment) => {
    const { b, writer, manager, lobby, session } = await host();
    await joinLobby(b, code, "alice", "Alice");
    const off = player(b);
    const id = await seat(writer);
    const store = useStorytellerStore;
    store.getState().assignRole(id, actual!);
    await waitFor(async () => expect(await b.get(`${root}/storyteller/players/${id}/actualRole`)).toBe(actual));
    expect(await b.get(`${root}/player/${id}`)).toBeUndefined();
    expect(usePlayerStore.getState().self).toBeNull();
    const update = b.update.bind(b);
    const attempts: unknown[] = [];
    b.update = async values => {
      const self = values[`${root}/player/${id}`];
      if (self) {
        attempts.push(self);
        if (attempts.length === 1) throw new Error("network offline");
      }
      await update(values);
    };
    store.getState().setShownRole(id, shown!);
    store.getState().setView("home");
    await waitFor(() => expect(usePlayerStore.getState().self).toEqual({ shownRole: shown, shownAlignment: alignment }), { timeout: 3000 });
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    for (const self of attempts) expect(self).toEqual({ shownRole: shown, shownAlignment: alignment });
    b.update = update;
    off();
    usePlayerStore.getState().reset();
    usePlayerStore.getState().setSession({ code, uid: "alice", requestedName: "Alice" });
    player(b);
    await waitFor(() => expect(usePlayerStore.getState().self).toEqual({ shownRole: shown, shownAlignment: alignment }));
    manager.stop();
    await writer.dispose();
    // A stale local edit must not replace the acknowledged shown identity.
    store.getState().setShownRole(id, "saint");
    const replacement = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });
    expect(store.getState().game!.players[id]!.shownRole).toBe(shown);
    expect(store.getState().game!.players[id]!.actualRole).toBe(actual);
    expect(await b.get(`${root}/player/${id}`)).toEqual({ shownRole: shown, shownAlignment: alignment });
    store.getState().setShownRole(id, null);
    await waitFor(() => expect(usePlayerStore.getState().self).toBeNull());
    expect(await b.get(`${root}/player/${id}`)).toBeUndefined();
    store.getState().setShownRole(id, shown!);
    await waitFor(() => expect(usePlayerStore.getState().self?.shownRole).toBe(shown));
    await revokePlayerAndCommit(replacement, code, id, () => store.getState().unseatPlayer(id));
    expect(await b.get(`${root}/player/${id}`)).toBeUndefined();
    await waitFor(() => expect(usePlayerStore.getState().self).toBeNull());
  });

  it("creates, joins with canonical inputs, accepts, and subscribes only after server membership", async () => {
    const { b, writer } = await host();
    await joinLobby(b, " bcdf-2345 ", "alice", "  Alice  ");
    player(b);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("waiting"));
    expect(usePlayerStore.getState().requestedName).toBe("Alice");
    expect(b.subscribePaths.some(path => path.includes('/player/'))).toBe(false);
    const id = await seat(writer);
    await waitFor(() => expect(usePlayerStore.getState().playerId).toBe(id));
    expect(await b.get(`${root}/joinRequests/alice`)).toBeUndefined();
    expect(useStorytellerStore.getState().game!.players[id]!.isEmpty).toBe(false);
  });

  it("rejection ends waiting and survives refresh", async () => {
    const { b, writer } = await host();
    await joinLobby(b, code, "alice", "Alice");
    const stop = player(b);
    await rejectJoinRequest(writer, code, "alice");
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("rejected"));
    stop(); player(b);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("rejected"));
  });

  it("cancels a pending request before clearing local state", async () => {
    const { b } = await setup();
    await joinLobby(b, code, "alice", "Alice");
    await leaveLobby(b);
    expect(await b.get(`${root}/joinRequests/alice`)).toBeUndefined();
    expect(usePlayerStore.getState().code).toBeNull();
  });

  it("a failed cancellation keeps the session recoverable", async () => {
    const { b } = await setup();
    await joinLobby(b, code, "alice", "Alice");
    b.set = async () => { throw new Error("offline"); };
    await expect(leaveLobby(b)).rejects.toThrow("offline");
    expect(usePlayerStore.getState().code).toBe(code);
  });

  it("nonexistent, legacy and malformed codes return controlled outcomes", async () => {
    const b = new MemoryRoomBackend();
    await joinLobby(b, code, "alice", "Alice");
    expect(usePlayerStore.getState().status).toBe("notFound");
    await b.set(`${root}/storytellerUid`, "old-host");
    await joinLobby(b, code, "alice", "Alice");
    expect(usePlayerStore.getState().status).toBe("notFound");
    await joinLobby(b, "123", "alice", "Alice");
    expect(usePlayerStore.getState().status).toBe("error");
    expect(await b.get(`${root}/joinRequests`)).toBeUndefined();
  });

  it("ended sessions cannot begin a new join", async () => {
    const { b, session } = await setup();
    await b.set(sessionPath(code), { ...session, state: "ended" });
    await joinLobby(b, code, "alice", "Alice");
    expect(usePlayerStore.getState().status).toBe("ended");
    expect(await b.get(`${root}/joinRequests/alice`)).toBeUndefined();
  });

  it("accepted refresh ignores a stale saved player ID and recovers the authoritative seat", async () => {
    const { b, writer } = await host();
    await joinLobby(b, code, "alice", "Alice");
    const id = await seat(writer);
    usePlayerStore.getState().setPlayerId("wrong-saved-id");
    player(b);
    await waitFor(() => expect(usePlayerStore.getState().playerId).toBe(id));
    expect(b.subscribePaths).not.toContain(`${root}/player/wrong-saved-id`);
  });

  it("waiting refresh observes the existing request without duplicating it", async () => {
    const { b } = await setup();
    await joinLobby(b, code, "alice", "Alice");
    const before = b.writeLog.filter(w => w.path === `${root}/joinRequests/alice`).length;
    player(b);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("waiting"));
    expect(b.writeLog.filter(w => w.path === `${root}/joinRequests/alice`)).toHaveLength(before);
  });

  it("explicit links override stale sessions while absent intent preserves matching reconnect", () => {
    usePlayerStore.getState().setSession({ code, uid: "alice", requestedName: "Alice" });
    expect(applyJoinIntent(undefined, "alice")).toBe(true);
    expect(applyJoinIntent("bcdf-2345", "alice")).toBe(true);
    expect(applyJoinIntent("WXYZ6789", "alice")).toBe(false);
    expect(usePlayerStore.getState().code).toBeNull();
    usePlayerStore.getState().setSession({ code, uid: "alice", requestedName: "Alice" });
    expect(applyJoinIntent("", "alice")).toBe(false);
  });

  it("saved sessions are discarded if authenticated UID changed", () => {
    usePlayerStore.getState().setSession({ code, uid: "alice", requestedName: "Alice" });
    expect(applyJoinIntent(undefined, "bob")).toBe(false);
    expect(usePlayerStore.getState().code).toBeNull();
  });

  it("new Game B detaches Game A synchronously and cannot project into its lobby", async () => {
    const { b, writer } = await host();
    await writer.set(`${root}/public`, { code, marker: "A" });
    useStorytellerStore.getState().newGame("snv");
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useStorytellerStore.getState().game!.code).toBe("");
    await expect(writer.set(`${root}/public`, { marker: "B" })).rejects.toThrow();
    expect(await b.get(`${root}/public`)).toEqual({ code, marker: "A" });
  });

  it("Storyteller Home navigation keeps the session hook and sync alive", async () => {
    const { b } = await setup();
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().backend).not.toBeNull());
    await act(async () => { useStorytellerStore.getState().setView("home"); useStorytellerStore.getState().addPlayer("Home edit"); });
    await waitFor(async () => expect(JSON.stringify(await b.get(`${root}/public`))).toContain("Home edit"));
  });

  it("presence read errors clear online knowledge rather than claiming offline", async () => {
    const b = new MemoryRoomBackend();
    const original = b.subscribe.bind(b);
    b.subscribe = (path, receive, onError) => {
      if (path === `${root}/presence`) { onError?.(new Error("PERMISSION_DENIED")); return () => {}; }
      return original(path, receive, onError);
    };
    await host(b);
    expect(useSessionRuntime.getState().presence).toBe("error");
    expect(useSessionRuntime.getState().online).toEqual({});
    expect(useSessionRuntime.getState().error).not.toBeNull();
  });

  it("serializes delayed projections and drains them before ending", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    await writer.start(); disposals.push(() => writer.dispose());
    const original = b.update.bind(b);
    let release!: () => void;
    b.update = async updates => {
      if (updates[`${root}/public/day`] === 7) await new Promise<void>(resolve => { release = resolve; });
      await original(updates);
    };
    const projection = writer.set(`${root}/public/day`, 7);
    await waitFor(() => expect(release).toBeDefined());
    const closing = writer.close([]);
    await waitFor(async () => expect(await b.get(`${root}/public/status`)).toBe("ended"));
    await expect(writer.set(`${root}/public/day`, 8)).rejects.toThrow();
    release(); await projection; await closing;
    expect(await b.get(sessionPath(code))).toMatchObject({ state: "ended" });
    expect(await b.get(`${root}/public/status`)).toBe("ended");
  });

  it("temporary network errors actually retry the write", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    await writer.start(); disposals.push(() => writer.dispose());
    const original = b.update.bind(b);
    let calls = 0;
    b.update = async updates => { if (++calls < 3) throw new Error("network offline"); await original(updates); };
    await writer.set(`${root}/public/day`, 1);
    expect(calls).toBe(3);
    expect(await b.get(`${root}/public/day`)).toBe(1);
  });

  it("lost acknowledgement uses its receipt without duplicating an applied write", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    await writer.start(); disposals.push(() => writer.dispose());
    const original = b.update.bind(b);
    let calls = 0;
    b.update = async updates => { calls++; await original(updates); throw new Error("network timeout"); };
    await writer.set(`${root}/public/day`, 1);
    expect(calls).toBe(1);
  });

  it("authorization errors fail once, and transient retry budgets terminate", async () => {
    const denied = vi.fn(async () => { throw new Error("PERMISSION_DENIED"); });
    await expect(retryTransient(denied, new AbortController().signal)).rejects.toThrow();
    expect(denied).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const done = expect(retryTransient(offline, new AbortController().signal)).rejects.toThrow();
    await vi.runAllTimersAsync(); await done;
    expect(offline).toHaveBeenCalledTimes(4);
  });

  it("ending cancels retry backoff and does not retry stale data", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    await writer.start(); disposals.push(() => writer.dispose());
    const original = b.update.bind(b);
    let failed = 0;
    b.update = async updates => { if (updates[`${root}/public/day`] === 9) { failed++; throw new Error("offline"); } await original(updates); };
    const pending = expect(writer.set(`${root}/public/day`, 9)).rejects.toThrow();
    await waitFor(() => expect(failed).toBe(1));
    await writer.close([]); await pending;
    expect(failed).toBe(1);
    expect(await b.get(`${root}/public/status`)).toBe("ended");
  });

  it("second writer is detected and an expired lease is reclaimable", async () => {
    const { b, session } = await setup();
    const first = new SessionWriter(b, code, session.id);
    const second = new SessionWriter(b, code, session.id);
    await first.start(); disposals.push(() => first.dispose(), () => second.dispose());
    await expect(second.start()).rejects.toThrow(/Another Storyteller/);
    await b.set(`${root}/writer`, { token: first.token, expiresAt: 0 });
    await second.start();
    expect(await b.get(`${root}/writer`)).toMatchObject({ token: second.token });
  });

  it("a takeover restores the acknowledged checkpoint instead of replaying stale local game", async () => {
    const { b, lobby, session } = await setup();
    const saved = { ...useStorytellerStore.getState().game!, day: 6 };
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: saved, roster: {} }));
    const writer = new SessionWriter(b, code, session.id);
    const manager = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { manager.stop(); await writer.dispose(); });
    expect(useStorytellerStore.getState().game!.day).toBe(6);
  });

  it("reconciles a revoked seat from an older checkpoint before the first takeover write", async () => {
    const { b, lobby, session } = await setup();
    const initial = useStorytellerStore.getState().game!;
    const id = initial.seatOrder[0]!;
    const staleGame = {
      ...initial,
      players: { ...initial.players, [id]: { ...initial.players[id]!, name: "Alice", isEmpty: false } },
    };
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: staleGame, roster: { alice: id } }));
    const writer = new SessionWriter(b, code, session.id);
    const manager = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { manager.stop(); await writer.dispose(); });
    expect(useStorytellerStore.getState().game!.players[id]!.isEmpty).toBe(true);
    expect(await b.get(`${root}/roster`)).toBeUndefined();
  });

  it("cancelled session startup cannot install listeners or publish a checkpoint", async () => {
    const { b, lobby, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    let release!: () => void;
    const originalGet = b.get.bind(b);
    b.get = async path => {
      if (path === `${root}/checkpoint`) await new Promise<void>(resolve => { release = resolve; });
      return originalGet(path);
    };
    const starting = startStorytellerSession(b, lobby, writer);
    await waitFor(() => expect(release).toBeDefined());
    writer.stop();
    release();
    await expect(starting).rejects.toMatchObject({ kind: "cancelled" });
    expect(b.subscribePaths).toEqual([]);
    expect(b.writeLog.some(write => write.path === `${root}/checkpoint`)).toBe(false);
    await writer.dispose();
  });

  it("seated leave is acknowledged by the existing membership command", async () => {
    const { b, writer } = await host();
    await joinLobby(b, code, "alice", "Alice"); player(b);
    const id = await seat(writer);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("seated"));
    await leaveLobby(b);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("revoked"));
    expect(await b.get(`${root}/roster/alice`)).toBeUndefined();
    expect(useStorytellerStore.getState().game!.players[id]!.isEmpty).toBe(true);
  });

  it("revocation remains terminal after reconnect and cannot be undone locally", async () => {
    const { b, writer } = await host();
    await joinLobby(b, code, "alice", "Alice");
    const id = await seat(writer);
    useStorytellerStore.getState().setAlive(id, false);
    await revokePlayerAndCommit(writer, code, id, () => useStorytellerStore.getState().removePlayer(id));
    useStorytellerStore.getState().undo();
    expect(useStorytellerStore.getState().game!.players[id]).toBeUndefined();
    player(b);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("revoked"));
  });
});
