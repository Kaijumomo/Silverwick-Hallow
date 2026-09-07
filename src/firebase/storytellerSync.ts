import { useEffect } from "react";
import { create } from "zustand";
import { z } from "zod";
import { selectScriptById, useStorytellerStore, type LobbyConnection } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { buildRegistry } from "@/data/roleRegistry";
import { writeProjections } from "./sync";
import { revokePlayerAndCommit } from "./membershipCommands";
import { revokePlayerMembership } from "./lobby";
import type { RoomBackend } from "./backend";
import type { OnlineMap } from "@/stores/projections";
import { decodePresence, decodeRoster, decodeJoinRequests, SnapshotValidationError } from "./snapshots";
import { SessionWriter } from "./writer";
import { decodeSession, isTransient, leaseSchema, lifecycleMessage, LifecycleError, sessionPath } from "./lifecycle";
import { connectFirebase } from "./session";

type Runtime = {
  backend: SessionWriter | null;
  error: string | null;
  presence: "unknown" | "ready" | "error";
  online: OnlineMap;
  pending: number;
  retry: number;
};
export const useSessionRuntime = create<Runtime>(() => ({ backend: null, error: null, presence: "unknown", online: {}, pending: 0, retry: 0 }));
export const retryStorytellerSession = () => useSessionRuntime.setState(s => ({ retry: s.retry + 1 }));
let closeCurrent: (() => Promise<void>) | null = null;

export async function closeMultiplayerSession() {
  const lobby = useStorytellerStore.getState().lobby;
  if (!lobby) return;
  const { backend } = await connectFirebase();
  const session = decodeSession(await backend.get(sessionPath(lobby.code)));
  if (!session || session.state === "ended") {
    useStorytellerStore.getState().setLobby(null);
    return;
  }
  if (!closeCurrent) throw new LifecycleError("conflict", "Reconnect to the lobby before ending it or starting another game.");
  await closeCurrent();
}

/** Session lifetime, independent of the currently visible Storyteller screen. */
export function useStorytellerSync(backend: RoomBackend | null) {
  const lobby = useStorytellerStore(s => s.lobby);
  const retry = useSessionRuntime(s => s.retry);
  useEffect(() => {
    if (!backend || !lobby) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    const writer = new SessionWriter(backend, lobby.code, lobby.sessionId ?? "", error =>
      useSessionRuntime.setState({ error: error ? lifecycleMessage(error) : null }));
    useSessionRuntime.setState({ backend: null, error: null, presence: "unknown", online: {}, pending: 0 });
    void startStorytellerSession(backend, lobby, writer).then(session => {
      if (cancelled) { session.stop(); return; }
      stop = session.stop;
      closeCurrent = session.close;
      useSessionRuntime.setState({ backend: writer });
    }).catch(error => {
      writer.stop();
      void writer.dispose().catch(() => {});
      if (!cancelled) useSessionRuntime.setState({ backend: null, error: lifecycleMessage(error) });
    });
    return () => {
      cancelled = true;
      closeCurrent = null;
      writer.stop();
      stop?.();
      void writer.dispose().catch(error => {
        // Expiry recovers a release which cannot reach Firebase.
        useSessionRuntime.setState({ error: lifecycleMessage(error) });
      });
      useSessionRuntime.setState({ backend: null, presence: "unknown", online: {}, pending: 0 });
    };
  }, [backend, lobby?.code, lobby?.sessionId, retry]);
}

export async function startStorytellerSession(raw: RoomBackend, lobby: LobbyConnection, writer: SessionWriter) {
  const sameSession = () => {
    const current = useStorytellerStore.getState().lobby;
    return current?.code === lobby.code && current.sessionId === lobby.sessionId;
  };
  const assertCurrent = () => {
    writer.assertActive();
    if (!sameSession()) throw new LifecycleError("cancelled", "Session changed during reconnect.");
  };
  await writer.start();
  const checkpoint = await raw.get(`lobbies/${lobby.code}/checkpoint`);
  assertCurrent();
  if (checkpoint != null) {
    if (typeof checkpoint !== "string") throw new SnapshotValidationError();
    const restored = z.object({ game: StorytellerGamePersistedSchema, roster: z.record(z.string().min(1)) }).safeParse(JSON.parse(checkpoint));
    if (!restored.success || restored.data.game.code !== lobby.code) throw new SnapshotValidationError();
    const membership = decodeRoster(await raw.get(`lobbies/${lobby.code}/roster`));
    assertCurrent();
    if (membership.status !== "ready") throw new SnapshotValidationError();
    // A takeover must start from the last acknowledged remote game, never
    // upload an old tab's localStorage snapshot over the current game.
    if (useStorytellerStore.getState().lobby?.code === lobby.code) {
      useStorytellerStore.setState({ game: restored.data.game, undoStack: [], selectedPlayerId: null });
      const currentSeats = new Set(Object.values(membership.data));
      for (const [uid, id] of Object.entries(restored.data.roster)) {
        if (membership.data[uid] !== id && !currentSeats.has(id)) useStorytellerStore.getState().unseatPlayer(id);
      }
      // A crash can occur between the remote membership ACK and the next
      // checkpoint. Recover known pending seats, revoke unresolvable binds.
      for (const [uid, id] of Object.entries(membership.data)) {
        const state = useStorytellerStore.getState();
        if (state.game?.players[id]?.isEmpty && state.game.pendingPlayers[uid]) state.assignPendingToSeat(uid, id);
        if (!state.game?.players[id] || useStorytellerStore.getState().game?.players[id]?.isEmpty) await revokePlayerMembership(writer, lobby.code, id);
      }
    }
  }
  let stopped = false;
  let closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let roster: Record<string, string> = {};
  let presence: Record<string, { online: boolean; lastSeen: number }> = {};
  let requests: Record<string, string> = {};
  const errors = new Map<string, string>();
  const cleanups: (() => void)[] = [];
  const leaving = new Set<string>();
  const report = (source: string, error?: unknown) => {
    if (error) errors.set(source, lifecycleMessage(error)); else errors.delete(source);
    useSessionRuntime.setState({ error: [...errors.values()].join(" ") || null });
  };
  const updateOnline = () => {
    const online: OnlineMap = {};
    for (const [uid, id] of Object.entries(useSessionRuntime.getState().presence === "ready" ? roster : {})) {
      const p = presence[uid];
      if (p && (!p.online || Date.now() - p.lastSeen < 45_000)) online[id] = p.online;
    }
    useSessionRuntime.setState({ online, pending: Object.keys(requests).filter(uid => presence[uid]?.online).length });
  };
  const flush = (initial = false) => writer.runExclusive(async inner => {
    const state = useStorytellerStore.getState();
    if (stopped || closing || !sameSession() || !state.game || state.game.code !== lobby.code) return;
    const script = selectScriptById(state, state.game.scriptId);
    if (!script) throw new SnapshotValidationError();
    const membership = decodeRoster(await inner.get(`lobbies/${lobby.code}/roster`));
    if (membership.status !== "ready") throw new SnapshotValidationError();
    await writeProjections({ backend: inner, code: lobby.code, stState: state.game, registry: buildRegistry(script), online: useSessionRuntime.getState().online, membership: membership.data });
  }).then(() => report("write"), error => {
    report("write", error);
    if (initial) throw error;
  });
  const schedule = () => {
    if (stopped || closing || timer) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, 200);
  };
  const watch = (suffix: string, receive: (value: unknown) => void) => {
    if (stopped) return;
    let off = () => {};
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const listen = () => {
      off = raw.subscribe(`lobbies/${lobby.code}/${suffix}`, value => {
        if (stopped) return;
        try { receive(value); report(suffix); }
        catch (error) {
          report(suffix, error);
          if (suffix === "presence") useSessionRuntime.setState({ presence: "error", online: {} });
        }
      }, error => {
        if (stopped) return;
        report(suffix, error);
        if (suffix === "presence") useSessionRuntime.setState({ presence: "error", online: {} });
        if (isTransient(error) && attempts++ < 3) {
          retryTimer = setTimeout(() => { off(); listen(); }, 250 * 2 ** (attempts - 1));
        }
      });
      if (stopped) off();
    };
    listen();
    cleanups.push(() => { off(); clearTimeout(retryTimer); });
  };
  watch("session", value => {
    const session = decodeSession(value);
    if (!session || session.id !== lobby.sessionId || session.state === "ended") {
      stop();
      useSessionRuntime.setState({ backend: null });
      throw new LifecycleError("ended", "This lobby has ended or expired. Start a new local game.");
    }
  });
  watch("writer", value => {
    const lease = leaseSchema.parse(value);
    if (lease.token !== writer.token) {
      stop();
      useSessionRuntime.setState({ backend: null });
      throw new LifecycleError("conflict", "Another Storyteller tab now controls this lobby.");
    }
  });
  watch("presence", value => {
    const decoded = decodePresence(value);
    if (decoded.status !== "ready") throw new SnapshotValidationError();
    presence = decoded.data;
    useSessionRuntime.setState({ presence: "ready" });
    updateOnline(); schedule();
  });
  watch("roster", value => {
    const decoded = decodeRoster(value);
    if (decoded.status !== "ready") throw new SnapshotValidationError();
    roster = decoded.data; updateOnline(); schedule();
  });
  watch("joinRequests", value => {
    const decoded = decodeJoinRequests(value);
    if (decoded.status !== "ready") throw new SnapshotValidationError();
    requests = decoded.data;
    const state = useStorytellerStore.getState();
    if (!sameSession() || !state.game) return;
    // Local queue removal is delayed by the writer queue until seating's
    // local commit finishes; a server ACK must not erase its input first.
    void writer.runExclusive(async () => {
      if (!sameSession()) return;
      const s = useStorytellerStore.getState();
      for (const uid of Object.keys(s.game?.pendingPlayers ?? {})) if (!requests[uid]) s.removePendingPlayer(uid);
      for (const [uid, name] of Object.entries(requests)) s.addToPendingQueue(uid, name);
    }).catch(error => report("requests", error));
    updateOnline();
  });
  watch("leaveRequests", value => {
    const leaves = z.record(z.literal(true)).parse(value ?? {});
    for (const uid of Object.keys(leaves)) {
      if (leaving.has(uid)) continue;
      leaving.add(uid);
      void writer.runExclusive(async inner => {
        const bindings = decodeRoster(await inner.get(`lobbies/${lobby.code}/roster`));
        if (bindings.status !== "ready") throw new SnapshotValidationError();
        const id = bindings.data[uid];
        if (id) await revokePlayerAndCommit(inner, lobby.code, id, () => useStorytellerStore.getState().unseatPlayer(id));
        else await inner.set(`lobbies/${lobby.code}/leaveRequests/${uid}`, null);
      }).catch(error => report("leave", error)).finally(() => leaving.delete(uid));
    }
  });
  if (stopped) throw new LifecycleError("cancelled", "Session stopped during reconnect.");
  const unsubStore = useStorytellerStore.subscribe((state, previous) => {
    if (!sameSession()) { stop(); return; }
    if (state.game !== previous.game || state.customScripts !== previous.customScripts) schedule();
  });
  cleanups.push(unsubStore);
  const stalePresence = setInterval(updateOnline, 15_000);
  cleanups.push(() => clearInterval(stalePresence));
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    cleanups.splice(0).forEach(off => off());
    writer.stop();
    useSessionRuntime.setState({ backend: null, presence: "unknown", online: {} });
  }
  writer.onStop = stop;
  // Establish the first acknowledged checkpoint before exposing membership
  // controls. A takeover must always have a remote recovery point.
  clearTimeout(timer); timer = undefined;
  try { await flush(true); assertCurrent(); }
  catch (error) { stop(); throw error; }
  return {
    stop,
    close: async () => {
      closing = true; clearTimeout(timer);
      try {
        await writer.close(useStorytellerStore.getState().game?.seatOrder ?? []);
        stop();
        if (sameSession()) useStorytellerStore.getState().setLobby(null);
      } catch (error) { report("close", error); throw error; }
    },
  };
}
