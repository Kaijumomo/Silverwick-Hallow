import { useEffect } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { canonicalJoin, cancelJoinRequest, knockOnLobby, normaliseCode } from "./lobby";
import { joinRequestPath, publicPath, rosterEntryPath, playerPath, presencePath } from "./paths";
import type { RoomBackend } from "./backend";
import { decodeJoinRequest, decodeRosterEntry, decodeSelfSnapshot, decodePublicSnapshot, SnapshotValidationError } from "./snapshots";
import { decodeSession, isTransient, leavePath, lifecycleMessage, LifecycleError, outcomePath, requireActiveSession, retryTransient, sessionPath } from "./lifecycle";

/** Explicit URL intent wins. An empty ?join= opens the join form; the same
 * nonempty code may resume only the same authenticated user's saved session. */
export function applyJoinIntent(explicitCode: string | undefined, uid: string): boolean {
  const saved = usePlayerStore.getState();
  if (saved.uid !== uid || (explicitCode !== undefined && (!normaliseCode(explicitCode) || normaliseCode(explicitCode) !== saved.code))) {
    saved.reset(); return false;
  }
  return !!saved.code;
}
export async function joinLobby(backend: RoomBackend, code: string, uid: string, name: string): Promise<void> {
  const ps = usePlayerStore.getState();
  ps.reset();
  ps.setStatus("knocking");
  try {
    const canonical = canonicalJoin(code, name);
    const abort = new AbortController();
    await retryTransient(async () => {
      await requireActiveSession(backend, canonical.code);
      const outcome = await backend.get(outcomePath(canonical.code, uid));
      if (outcome != null) {
        if (outcome !== "rejected" && outcome !== "revoked") throw new SnapshotValidationError();
        throw new LifecycleError(outcome, outcome === "rejected" ? "Your join request was rejected." : "Removed from lobby.");
      }
      await knockOnLobby(backend, canonical.code, uid, canonical.name);
    }, abort.signal);
    ps.setSession({ code: canonical.code, uid, requestedName: canonical.name });
    ps.setStatus("waiting");
  } catch (error) {
    ps.setStatus(error instanceof LifecycleError && ["notFound", "rejected", "revoked"].includes(error.kind) ? error.kind as "notFound" | "rejected" | "revoked" : "error", lifecycleMessage(error));
    if (error instanceof LifecycleError && error.kind === "ended") ps.setEnded();
  }
}

export async function leaveLobby(backend: RoomBackend) {
  const ps = usePlayerStore.getState();
  if (!ps.code || !ps.uid) { ps.reset(); return; }
  // A local cached ID is never authority: inspect the server binding.
  const binding = decodeRosterEntry(await backend.get(rosterEntryPath(ps.code, ps.uid)));
  if (binding.status === "invalid") throw new SnapshotValidationError();
  if (binding.status === "ready") {
    await backend.set(leavePath(ps.code, ps.uid), true);
    ps.setStatus("leaving");
  } else {
    await cancelJoinRequest(backend, ps.code, ps.uid);
    ps.reset();
  }
}

export function usePlayerSync(backend: RoomBackend | null, retry = 0) {
  const code = usePlayerStore(s => s.code);
  const uid = usePlayerStore(s => s.uid);
  useEffect(() => {
    if (!backend || !code || !uid) return;
    return startPlayerHandshake(backend, code, uid);
  }, [backend, code, uid, retry]);
}

/** The only player handshake. Saved IDs are hints; subscriptions are installed
 * from validated server membership, never from localStorage. */
export function startPlayerHandshake(backend: RoomBackend, code: string, uid: string) {
  const abort = new AbortController();
  let active = true;
  let queued = false;
  let dirty = false;
  let bound: string | null = null;
  let publicSubscribed = false;
  let privateOff = () => {};
  let publicOff = () => {};
  let cancelPresence: (() => Promise<void>) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanups: (() => void)[] = [];
  const ps = () => usePlayerStore.getState();
  const current = () => active && ps().code === code && ps().uid === uid;
  ps().setPlayerId(null); ps().setSelf(null); ps().setPublic(null);
  ps().setRemoteData({ membership: "ready", request: "ready", self: "waiting", public: "waiting" });
  ps().setStatus("reconnecting");
  const stop = () => {
    active = false; abort.abort();
    cleanups.splice(0).forEach(off => off());
    privateOff(); publicOff(); clearInterval(heartbeat);
    void (async () => {
      try { await cancelPresence?.(); await backend.set(presencePath(code, uid), { online: false, lastSeen: Date.now() }); }
      catch { /* Disconnect handler or server expiry marks the device stale. */ }
    })();
  };
  const terminal = (kind: "ended" | "rejected" | "revoked" | "notFound", message: string) => {
    if (!current()) return;
    ps().setSelf(null); ps().setPlayerId(null); ps().setPublic(null);
    ps().setRemoteData({ membership: "ready", request: "ready", self: "waiting", public: "waiting" });
    if (kind === "ended") ps().setEnded(); else ps().setStatus(kind, message);
    stop();
  };
  const fail = (error: unknown) => {
    if (!current()) return;
    ps().setSelf(null); ps().setPublic(null);
    ps().setStatus("error", lifecycleMessage(error));
  };
  const watch = (path: string, receive: (value: unknown) => void) => {
    let off = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const listen = () => {
      off = backend.subscribe(path, value => {
        if (!current()) return;
        try { receive(value); } catch (error) { fail(error); }
      }, error => {
        if (!current()) return;
        fail(error);
        if (isTransient(error) && attempts++ < 3) timer = setTimeout(() => { off(); listen(); }, 250 * 2 ** (attempts - 1));
        else schedule(); // Reconcile denied private/public reads with terminal membership/session.
      });
    };
    listen();
    return () => { off(); clearTimeout(timer); };
  };
  const startPresence = async () => {
    if (heartbeat || cancelPresence || !current()) return;
    try {
      cancelPresence = await backend.onDisconnectSet(presencePath(code, uid), { online: false, lastSeen: Date.now() });
      if (!current()) { await cancelPresence(); return; }
      const write = () => backend.set(presencePath(code, uid), { online: true, lastSeen: Date.now() });
      await write();
      if (!current()) return;
      heartbeat = setInterval(() => { void write().catch(fail); }, 15_000);
    } catch (error) { fail(error); }
  };
  const reconcile = async () => {
    const session = decodeSession(await backend.get(sessionPath(code)));
    if (!current()) return;
    if (!session) { terminal("notFound", "This lobby does not exist or has expired."); return; }
    if (session.state === "ended") { terminal("ended", "This game has ended."); return; }
    const outcome = await backend.get(outcomePath(code, uid));
    if (!current()) return;
    if (outcome != null) {
      if (outcome !== "rejected" && outcome !== "revoked") throw new SnapshotValidationError();
      terminal(outcome, outcome === "rejected" ? "Your join request was rejected." : "Removed from lobby."); return;
    }
    let membership = decodeRosterEntry(await backend.get(rosterEntryPath(code, uid)));
    const request = decodeJoinRequest(await backend.get(joinRequestPath(code, uid)));
    if (membership.status === "waiting" && request.status === "waiting") membership = decodeRosterEntry(await backend.get(rosterEntryPath(code, uid)));
    if (!current()) return;
    if (membership.status === "invalid" || request.status === "invalid") throw new SnapshotValidationError();
    if (membership.status !== "ready" && request.status !== "ready") {
      // A request is only a pending artifact. Its disappearance (or a
      // transiently stale roster read) is not authoritative rejection or
      // revocation; those outcomes are written explicitly above. Keep the
      // handshake alive so an accepted seat can recover when its binding
      // becomes visible, regardless of listener ordering.
      if (ps().status !== "waiting" && ps().status !== "seated") ps().setStatus("reconnecting");
      return;
    }
    ps().setRemoteData({ membership: "ready", request: "ready" });
    if (membership.status === "ready") {
      const id = membership.data;
      ps().setPlayerId(id);
      if (ps().status !== "leaving") ps().setStatus("seated");
      if (bound !== id) {
        bound = id; privateOff(); ps().setSelf(null);
        privateOff = watch(playerPath(code, id), raw => {
          const self = decodeSelfSnapshot(raw);
          ps().setSelf(self.status === "ready" ? self.data : null);
          ps().setRemoteData({ self: self.status });
        });
      }
    } else {
      // A missing binding is also ambiguous until the Storyteller writes the
      // explicit revoked outcome. Keep reconnecting rather than converting a
      // stale roster snapshot into a terminal removal.
      ps().setStatus(bound ? "reconnecting" : "waiting");
      if (request.status === "ready") usePlayerStore.setState({ requestedName: request.data });
    }
    if (!publicSubscribed) {
      publicSubscribed = true;
      publicOff = watch(publicPath(code), raw => {
        const decoded = decodePublicSnapshot(raw, code);
        if (decoded.status === "ended" || (decoded.status === "ready" && decoded.data.status === "ended")) { terminal("ended", "This game has ended."); return; }
        ps().setPublic(decoded.status === "ready" ? decoded.data : null);
        ps().setRemoteData({ public: decoded.status });
      });
    }
    await startPresence();
  };
  function schedule() {
    if (!current()) return;
    dirty = true;
    if (queued) return;
    queued = true;
    void (async () => {
      try {
        while (dirty && current()) {
          dirty = false;
          await retryTransient(reconcile, abort.signal, () => { if (current()) ps().setStatus("reconnecting"); });
        }
      } catch (error) { fail(error); }
      finally { queued = false; }
    })();
  }
  // These non-private paths are independently authorized for this UID.
  for (const path of [sessionPath(code), outcomePath(code, uid), rosterEntryPath(code, uid), joinRequestPath(code, uid)]) cleanups.push(watch(path, schedule));
  schedule();
  return stop;
}
