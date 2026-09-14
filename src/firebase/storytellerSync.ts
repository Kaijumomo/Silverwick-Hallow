import { useEffect, useRef } from "react";
import { create } from "zustand";
import { z } from "zod";
import { selectScriptById, useStorytellerStore, type LobbyConnection } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { GuardStamp } from "@/stores/types";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { writeProjections } from "./sync";
import { revokePlayerAndCommit } from "./membershipCommands";
import { revokePlayerMembership } from "./lobby";
import type { RoomBackend } from "./backend";
import type { OnlineMap } from "@/stores/projections";
import { decodePresence, decodeRoster, decodeJoinRequests, SnapshotValidationError } from "./snapshots";
import { SessionWriter, FENCE_MARGIN_MS, type AuthorityHandle } from "./writer";
import { decodeSession, guardSchema, isTransient, leaseSchema, lifecycleMessage, LifecycleError, sessionPath } from "./lifecycle";
import { connectFirebase } from "./session";
import { decideReconnect, type CheckpointState, type ReconnectIncoherentReason } from "./reconnectDecision";

/** Runtime (never persisted) reconnect status. Section 12 (Phase 9C.2A):
 * persisted status is never trusted as reconnect-decision evidence — every
 * session start/reload derives this fresh from current local sync metadata,
 * current server guard/checkpoint, and current writer authority. "live"
 * covers both KEEP_LOCAL and RESTORE, which are both fully-applied,
 * normally-running outcomes from the caller's point of view. */
export type ReconnectRuntimeStatus =
  | { status: "live" }
  | { status: "conflict"; remoteGuard: GuardStamp | null }
  | { status: "incoherent"; reason: ReconnectIncoherentReason };

type Runtime = {
  backend: SessionWriter | null;
  /** Source-keyed runtime errors. `error` below is derived from this map so a
   * success can clear only the source it owns, never an unrelated failure. */
  errors: Partial<Record<string, string>>;
  error: string | null;
  presence: "unknown" | "ready" | "error";
  online: OnlineMap;
  pending: number;
  retry: number;
  reconnect: ReconnectRuntimeStatus;
};
export const useSessionRuntime = create<Runtime>(() => ({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0, reconnect: { status: "live" } }));
export const retryStorytellerSession = () => useSessionRuntime.setState(s => ({ retry: s.retry + 1 }));
/** Central ownership for `useSessionRuntime.error`: each source may set or
 * clear only its own entry; the derived field is recomputed from the rest. */
export function reportRuntimeError(source: string, message: string | null) {
  const errors = { ...useSessionRuntime.getState().errors };
  if (message != null) errors[source] = message; else delete errors[source];
  const values = Object.values(errors).filter((value): value is string => !!value);
  useSessionRuntime.setState({ errors, error: values.length ? values.join(" ") : null });
}
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
  // Phase 9C.2A (OPUS-001), section 10 — deterministic disposal barrier.
  // A React effect cleanup cannot itself be async, so the previous writer's
  // dispose() (which releases its lease) would otherwise run fire-and-
  // forget while a replacement effect (self-reconnect, retry, rapid double
  // reconnect) immediately constructs and starts the next writer — racing
  // the still-in-flight release against the new lease acquisition. This ref
  // persists across effect re-runs on this component instance and holds
  // "the promise that settles once every earlier writer either released its
  // lease or reached its own safe failure." Each effect's own startup waits
  // on it before calling start(); each effect's own disposal is chained
  // after its own startup attempt settles, so the chain stays strictly
  // sequential in acquisition order — not just "wait for the immediately
  // prior one," which alone would not protect a third rapid reconnect
  // against a second one that never got far enough to start.
  const disposalBarrier = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!backend || !lobby) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    const writer = new SessionWriter(backend, lobby.code, lobby.sessionId ?? "", error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
    const previousDisposal = disposalBarrier.current;
    const started = previousDisposal.then(() => {
      if (cancelled) return undefined;
      return startStorytellerSession(backend, lobby, writer).then(session => {
        if (cancelled) { session.stop(); return; }
        // stop/close are always assigned, regardless of outcome: for
        // "conflict"/"incoherent" they still let this hook's own
        // unmount/retry stop the parked writer, and close() itself refuses
        // (rather than silently doing something wrong) until the conflict
        // is resolved. useSessionRuntime.backend is claimed by
        // startStorytellerSession's own finishLive() only for a "live"
        // outcome — it is deliberately not touched here.
        stop = session.stop;
        closeCurrent = session.close;
      });
    }).catch(error => {
      writer.stop();
      if (!cancelled) { reportRuntimeError("session", lifecycleMessage(error)); useSessionRuntime.setState({ backend: null }); }
    });
    return () => {
      cancelled = true;
      closeCurrent = null;
      writer.stop();
      stop?.();
      // Chained after this writer's own startup attempt (which itself
      // waited on `previousDisposal`) rather than fired immediately: this
      // keeps disposals ordered the same as acquisitions even when a writer
      // is cancelled before it ever got to start() — a fast-resolving
      // dispose() for a writer that never held a lease must not let a LATER
      // writer's start() race ahead of an EARLIER writer's still-in-flight
      // release.
      disposalBarrier.current = started.catch(() => {}).then(() =>
        writer.dispose().catch(error => {
          // Expiry recovers a release which cannot reach Firebase.
          reportRuntimeError("write", lifecycleMessage(error));
        })
      );
      useSessionRuntime.setState({ backend: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
    };
  }, [backend, lobby?.code, lobby?.sessionId, retry]);
}

/**
 * Reconcile authoritative (live, server-side) roster state against whichever
 * game state currently survives in the local store — regardless of whether
 * it got there via KEEP_LOCAL or RESTORE (Phase 9C.2A, section 9).
 *
 * `priorRoster` — a previously-believed uid->seat snapshot to diff against
 * — is optional and used for exactly one purpose: catching a seat whose
 * OWN earlier binding has since vanished from the live roster (someone left
 * while this device could not observe it) so it can be unseated. This is
 * deliberately NOT generalized to "any occupied seat with no live claimant
 * is stale": a great many seats are legitimately occupied by a name the
 * Storyteller typed locally (addPlayer/addPlayerToSeat) and were NEVER
 * bound to any uid at all — that is a normal, permanent feature of this
 * app, not staleness. Only a seat this device once actually believed was
 * uid-bound (per `priorRoster`) can be judged stale by its absence now.
 * RESTORE supplies the checkpoint's own embedded roster as `priorRoster`
 * (this is the exact reconciliation the old checkpoint-only code
 * performed). KEEP_LOCAL has no such prior snapshot to diff against and
 * passes null, skipping this specific check — live watchers (re)installed
 * right after this function returns cover departures going forward.
 *
 * The second pass is unconditional and roster-embedding-independent: a
 * live-claimed uid whose local seat is still empty is recovered from
 * pendingPlayers, or, failing that, its stale remote binding is revoked.
 * Membership-driven changes made here flow through the normal store
 * actions, so they participate in localSeq/dirty tracking exactly like any
 * other Storyteller mutation. Does not redesign the Phase 9C.3 leave
 * workflow.
 */
async function reconcileMembership(
  writer: SessionWriter,
  code: string,
  membership: Record<string, string>,
  priorRoster: Record<string, string> | null,
) {
  if (priorRoster) {
    const currentSeats = new Set(Object.values(membership));
    for (const [uid, id] of Object.entries(priorRoster)) {
      if (membership[uid] !== id && !currentSeats.has(id)) useStorytellerStore.getState().unseatPlayer(id);
    }
  }
  // A crash can occur between the remote membership ACK and the next
  // checkpoint/flush. Recover known pending seats, revoke unresolvable binds.
  for (const [uid, id] of Object.entries(membership)) {
    const state = useStorytellerStore.getState();
    if (state.game?.players[id]?.isEmpty && state.game.pendingPlayers[uid]) state.assignPendingToSeat(uid, id);
    if (!state.game?.players[id] || useStorytellerStore.getState().game?.players[id]?.isEmpty) await revokePlayerMembership(writer, code, id);
  }
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
  // Phase 9C.2A (OPUS-001): establish/preserve this scope's sync metadata,
  // and wire writer-authority acknowledgement plumbing, before any commit
  // can possibly happen. ensureSyncScope is a no-op when sync already
  // matches this exact (code, sessionId) — a replacement SessionWriter must
  // never overwrite the previous writer's unresolved lastAttempt evidence.
  const scopeSessionId = lobby.sessionId ?? "";
  useStorytellerStore.getState().ensureSyncScope(lobby.code, scopeSessionId);
  writer.onAttempt = guard => useStorytellerStore.getState().noteWriterAttempt(lobby.code, scopeSessionId, guard);
  writer.onAck = guard => useStorytellerStore.getState().noteWriterAck(lobby.code, scopeSessionId, guard);
  // The guard observed after lease acquisition, before this writer has
  // committed anything — belongs to whichever writer committed last (or
  // null on a brand new lobby). Compared against the persisted baseline by
  // the reconnect decision (Phase 9C.2A, section 5/6); adopted as the new
  // baseline on RESTORE.
  const observedGuard = await writer.start();

  // --- Lifecycle state (Phase 9C.2A, section 11) --------------------------
  // Declared, and the writer's stop hook wired, BEFORE any checkpoint
  // read/comparison/restore below. A lease-renewal failure during that
  // window now flips `stopped` immediately, so the checks threaded through
  // the block below cancel the reconnect attempt cleanly instead of racing
  // a stale restore or leaking watchers installed after the writer died.
  let stopped = false;
  let closing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let roster: Record<string, string> = {};
  let presence: Record<string, { online: boolean; lastSeen: number }> = {};
  let requests: Record<string, string> = {};
  const cleanups: (() => void)[] = [];
  const leaving = new Set<string>();
  const report = (source: string, error?: unknown) => reportRuntimeError(source, error ? lifecycleMessage(error) : null);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    cleanups.splice(0).forEach(off => off());
    writer.stop();
    useSessionRuntime.setState({ backend: null, presence: "unknown", online: {} });
  }
  // Wired here — before the checkpoint read/restore/reconcile window below,
  // not after live watchers are installed — so a lease-renewal failure
  // during that window flips `stopped` immediately (Phase 9C.2A, section
  // 11). Every watcher installer below already self-guards on `stopped`,
  // so once this is wired, no watcher can be installed after a stop.
  writer.onStop = stop;

  const updateOnline = () => {
    const online: OnlineMap = {};
    for (const [uid, id] of Object.entries(useSessionRuntime.getState().presence === "ready" ? roster : {})) {
      const p = presence[uid];
      if (p && (!p.online || Date.now() - p.lastSeen < 45_000)) online[id] = p.online;
    }
    useSessionRuntime.setState({ online, pending: Object.keys(requests).filter(uid => presence[uid]?.online).length });
  };
  const flush = (initial = false) => {
    // Captured the same moment the flushed game snapshot is captured, inside
    // the queued operation body (not at schedule time) — this is exactly
    // "seqAtFlush" (Phase 9C.2A, section 3). A mutation that lands after
    // this capture but before the commit resolves must NOT be acknowledged
    // by this flush; it stays dirty for the next one.
    let seqAtFlush: number | undefined;
    return writer.runExclusive(async inner => {
      const state = useStorytellerStore.getState();
      if (stopped || closing || !sameSession() || !state.game || state.game.code !== lobby.code) return;
      seqAtFlush = state.localSeq;
      const script = selectScriptById(state, state.game.scriptId);
      if (!script) throw new SnapshotValidationError();
      const membership = decodeRoster(await inner.get(`lobbies/${lobby.code}/roster`));
      if (membership.status !== "ready") throw new SnapshotValidationError();
      await writeProjections({ backend: inner, code: lobby.code, stState: state.game, registry: buildRegistry(script), online: useSessionRuntime.getState().online, membership: membership.data });
    }).then(() => {
      // This flush's commit may have been in flight before a terminal stop
      // (e.g. a real lease-renewal denial) landed it successfully afterward.
      // Ownership of the "write" error belongs to the stop, not to this
      // belated success — only a genuine restart may clear it. The same gate
      // protects ackedGameSeq: a belated post-stop success must never
      // advance it (Phase 9C.2A, section 1/3 — the stopped-writer invariant).
      if (!writer.isStopped()) {
        report("write");
        // A membership-only/no-op runExclusive operation never reaches this
        // point with seqAtFlush set (the early return above leaves it
        // undefined), so a non-projection commit never advances this.
        if (seqAtFlush !== undefined) {
          useStorytellerStore.getState().acknowledgeGameFlush(lobby.code, lobby.sessionId ?? "", seqAtFlush);
        }
      }
    }, error => {
      report("write", error);
      if (initial) throw error;
    });
  };
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
  // Shared "go live" tail: install watchers, do the initial acknowledged
  // flush, and return the live session handle. Defined once here and
  // invoked either immediately below (for the automatic KEEP_LOCAL/RESTORE
  // outcomes) or later, by resolveReconnectConflict, once an explicit
  // choice has been re-validated (Phase 9C.2A, section 8) — "no second
  // write path": both routes funnel through this exact same code.
  async function finishLive() {
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
    // A stop occurring specifically during the six watch() installations
    // just above (e.g. an immediately-observed ended session) is caught
    // here, before unsubStore/stalePresence go live and before the initial
    // flush.
    if (stopped) throw new LifecycleError("cancelled", "Session stopped during reconnect.");
    const unsubStore = useStorytellerStore.subscribe((state, previous) => {
      if (!sameSession()) { stop(); return; }
      if (state.game !== previous.game || state.customScripts !== previous.customScripts) schedule();
    });
    cleanups.push(unsubStore);
    const stalePresence = setInterval(updateOnline, 15_000);
    cleanups.push(() => clearInterval(stalePresence));
    // Establish the first acknowledged checkpoint before exposing membership
    // controls. A takeover must always have a remote recovery point.
    clearTimeout(timer); timer = undefined;
    try { await flush(true); assertCurrent(); }
    catch (error) { stop(); throw error; }
    useSessionRuntime.setState({ backend: writer, reconnect: { status: "live" } });
    return {
      outcome: "live" as const,
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

  // --- Phase 9C.2A (OPUS-001), sections 5-7: the pure reconnect decision --
  // Capture the local comparison sequence BEFORE the one async read below
  // (steps 1-3). Read and validate the checkpoint (step 4) — this is the
  // ONLY await between capturing localSeq and running the decision; the
  // remote side (checkpoint contents, observed guard) is fixed and
  // protected by the held lease, so nothing here re-fetches it. If local
  // changed during that single await, re-capture it fresh before deciding
  // (steps 6-7) — there is no further await before applying the decision,
  // so a single re-capture is sufficient; local cannot change again in
  // between.
  let comparisonSeq = useStorytellerStore.getState().localSeq;
  const { state: checkpointState, restored } = await readCheckpoint(raw, lobby);
  assertCurrent();
  if (stopped) throw new LifecycleError("cancelled", "Session stopped during reconnect.");
  if (useStorytellerStore.getState().localSeq !== comparisonSeq) {
    comparisonSeq = useStorytellerStore.getState().localSeq;
  }
  const scope = { code: lobby.code, sessionId: scopeSessionId };
  const decision = decideReconnect({
    localGameInScope: useStorytellerStore.getState().game?.code === lobby.code,
    localSeq: comparisonSeq,
    sync: useStorytellerStore.getState().sync,
    scope,
    checkpoint: checkpointState,
    remoteGuard: observedGuard,
  });

  // Finding B1: a recognized lost acknowledgement must become durable
  // accepted evidence SYNCHRONOUSLY — before any later await gives a
  // subsequent writer attempt (membership reconciliation, the initial
  // flush inside finishLive(), anything else below) a chance to allocate,
  // and overwrite `lastAttempt` with, another revision before the recovery
  // is durable. No await occurs between decideReconnect returning this
  // outcome and this call.
  if (decision.type === "KEEP_LOCAL" && decision.reason === "lost_ack_recovered") {
    useStorytellerStore.getState().promoteRecoveredAck(lobby.code, scopeSessionId, decision.recoveredGuard);
  }

  // Invalid checkpoint with no evidenced local claim at stake: nothing
  // local is at risk, so preserve the pre-9C.2A hard-failure behavior
  // instead of inventing a new automatic outcome for this specific reason.
  if (decision.type === "INCOHERENT" && decision.reason === "invalid_checkpoint") {
    throw new SnapshotValidationError();
  }

  if (decision.type === "CONFLICT" || decision.type === "INCOHERENT") {
    // Neither side is written here. Reconciliation is deferred until a
    // side is selected (section 9) — neither game state has been accepted
    // yet. No watchers install, no initial flush runs; writer authority
    // (and its lease renewal) is retained so the compared remote state
    // stays frozen while the Storyteller decides (section 7). This is
    // represented as an explicit outcome, not thrown as a normal
    // session-start failure.
    useSessionRuntime.setState({
      reconnect: decision.type === "CONFLICT"
        ? { status: "conflict", remoteGuard: observedGuard }
        : { status: "incoherent", reason: decision.reason },
    });
    if (decision.type === "CONFLICT") {
      // CONFLICT is only ever reached with a valid, parsed checkpoint and a
      // non-null remote guard (the decision's own rule ordering routes
      // "no checkpoint"/"invalid checkpoint"/"no baseline"/"rewind" to
      // other outcomes first) — narrow to the non-null GuardStamp the state
      // machine guarantees here (Finding H2). Checkpoint CONTENT is
      // deliberately not cached alongside it: resolution re-reads the
      // checkpoint fresh, gated by this guard identity alone, never by a
      // cached serialization (see resolveReconnectConflict).
      if (!observedGuard) throw new Error("Invariant violated: CONFLICT reached with a null remote guard.");
      currentConflict = { raw, lobby, writer, snapshotGuard: observedGuard, finishLive };
    }
    return {
      outcome: decision.type === "CONFLICT" ? "conflict" as const : "incoherent" as const,
      stop: () => { if (currentConflict?.writer === writer) currentConflict = null; stop(); },
      close: async () => { throw new LifecycleError("conflict", "Resolve the reconnect conflict before ending this lobby."); },
    };
  }

  // KEEP_LOCAL or RESTORE: apply (RESTORE only), then reconcile against the
  // live roster — regardless of which side survived (section 9); a
  // takeover must never upload an old tab's localStorage snapshot over a
  // genuinely newer remote game (RESTORE), nor discard newer unacknowledged
  // local work merely because a checkpoint happens to exist (KEEP_LOCAL).
  if (decision.type === "RESTORE" && restored && sameSession()) {
    useStorytellerStore.getState().restoreRemoteCheckpoint(restored.game, observedGuard);
  }
  const membership = decodeRoster(await raw.get(`lobbies/${lobby.code}/roster`));
  assertCurrent();
  if (membership.status !== "ready") throw new SnapshotValidationError();
  if (sameSession()) await reconcileMembership(writer, lobby.code, membership.data, decision.type === "RESTORE" ? restored?.roster ?? null : null);
  if (stopped) throw new LifecycleError("cancelled", "Session stopped during reconnect.");

  return finishLive();
}

type PendingConflict = {
  raw: RoomBackend;
  lobby: LobbyConnection;
  writer: SessionWriter;
  /** The writeGuard observed when CONFLICT was raised — the SOLE identity
   * used to detect remote staleness on resolution (Finding H2). Compared
   * against a fresh read (token AND revision, exact match) before applying
   * an explicit choice, never through decideReconnect again. Always
   * non-null: decideReconnect's own rule ordering only ever reaches
   * CONFLICT after establishing a valid checkpoint and a non-null
   * remoteGuard (narrowed at the one call site that constructs this).
   * Checkpoint CONTENT is deliberately not cached here — writeProjections
   * is the sole checkpoint writer, and Firebase rules require every
   * checkpoint write to be part of an update whose writeGuard revision
   * strictly advances, so guard equality against this snapshot alone
   * already proves the checkpoint has not changed through the supported
   * production write path. Comparing serialized checkpoint content in
   * addition to this — as an earlier revision did — made conflict
   * revalidation sensitive to object-key insertion order, Zod output
   * ordering, and stripped-unknown-keys differences between the object
   * pipeline that produced the snapshot and the one that reads it back,
   * which could report a semantically-unchanged checkpoint as stale
   * indefinitely. */
  snapshotGuard: GuardStamp;
  finishLive: () => Promise<{ outcome: "live"; stop: () => void; close: () => Promise<void> }>;
};
let currentConflict: PendingConflict | null = null;

async function readCheckpoint(
  raw: RoomBackend,
  lobby: LobbyConnection,
): Promise<{ state: CheckpointState; restored: { game: StorytellerLobbyRecord; roster: Record<string, string> } | null }> {
  const checkpoint = await raw.get(`lobbies/${lobby.code}/checkpoint`);
  if (checkpoint == null) return { state: { kind: "absent" }, restored: null };
  if (typeof checkpoint !== "string") return { state: { kind: "invalid" }, restored: null };
  let json: unknown;
  try { json = JSON.parse(checkpoint); }
  catch { return { state: { kind: "invalid" }, restored: null }; }
  const parsed = z.object({ game: StorytellerGamePersistedSchema, roster: z.record(z.string().min(1)) }).safeParse(json);
  if (!parsed.success || parsed.data.game.code !== lobby.code) return { state: { kind: "invalid" }, restored: null };
  return { state: { kind: "valid" }, restored: parsed.data };
}

export type ConflictResolutionResult = "applied" | "stale" | "none";

/**
 * Explicit conflict resolution (Phase 9C.2A, section 8) — architecture only;
 * the polished conflict UX itself is a later 9C.2 stage. This is
 * deliberately a DIFFERENT operation from the automatic decision function:
 * it never calls decideReconnect and never lets a stale choice through.
 * Before applying either choice it re-confirms writer authority, re-reads
 * the current guard (Finding H2: the sole staleness signal — never a
 * checkpoint-content comparison), and synchronously re-proves that
 * authority is STILL continuously held through the instant immediately
 * before any destructive local mutation (Finding H1). If authority was
 * lost — at reconfirmation, or found lapsed by the synchronous gate right
 * before applying — or the remote has moved on, the choice is not applied
 * ("stale") — the caller (a later UI stage) is expected to return to
 * comparison/observing, e.g. via retryStorytellerSession().
 */
export async function resolveReconnectConflict(choice: "keepLocal" | "useRemote"): Promise<ConflictResolutionResult> {
  const pending = currentConflict;
  if (!pending) return "none";
  currentConflict = null; // consumed exactly once, whichever way this resolves
  const { raw, lobby, writer } = pending;
  if (writer.isStopped()) return "stale";

  // Re-confirm ACTUAL server writer authority before trusting anything
  // else (Luna review, Finding 2). A different Storyteller writer can
  // acquire the server lease while this writer's own isStopped() still
  // reads false and writeGuard remains unchanged (the new writer simply
  // hasn't published a projection yet) — isStopped() alone cannot detect
  // that. reconfirmAuthority() reuses the exact same lease-renewal
  // transaction the writer's own renewal interval already runs; it
  // resolves only if this writer still owns, or can validly reclaim, the
  // exclusive lease, and returns an AuthorityHandle representing that
  // confirmed continuous-authority interval (Finding H1) — re-validated
  // synchronously via holdsAuthority() immediately before the destructive
  // mutation below, never trusted as still current after the reads that
  // follow: those reads can outlive the 30-second lease, and a single
  // isStopped() check taken before them is not enough (Astra's exact
  // reproduction) — no second write/authority path either way.
  let authority: AuthorityHandle;
  try {
    authority = await writer.reconfirmAuthority();
  } catch {
    return "stale";
  }

  const guardRaw = await raw.get(`lobbies/${lobby.code}/writeGuard`);
  const currentGuard = guardRaw != null ? guardSchema.parse(guardRaw) : null;

  // Checkpoint CONTENT is read fresh here, as needed to obtain the actual
  // remote game for "useRemote" — never compared byte-for-byte against a
  // cached snapshot (Finding H2 — see PendingConflict's own doc comment
  // for why guard equality alone already proves the checkpoint has not
  // changed through the supported production path). Skipped for
  // "keepLocal", which never needs remote game content.
  let restored: { game: StorytellerLobbyRecord; roster: Record<string, string> } | null = null;
  if (choice === "useRemote") {
    restored = (await readCheckpoint(raw, lobby)).restored;
  }

  if (writer.isStopped()) return "stale";

  if (currentGuard === null || currentGuard.token !== pending.snapshotGuard.token || currentGuard.revision !== pending.snapshotGuard.revision) {
    return "stale"; // remote has moved on since CONFLICT was raised
  }

  // Synchronous authority gate (Finding H1): NOTHING awaits between this
  // check and the destructive mutation it guards below (for "useRemote";
  // for "keepLocal" it still gates reconciliation, which can itself mutate
  // local game state, for the same reason). If this writer's continuous
  // hold on the exact interval `authority` represents has lapsed, or been
  // reclaimed after a gap, since reconfirmAuthority() above — even though
  // isStopped() may still read false, not having caught up yet — the
  // choice is stale rather than applied against content whose authority
  // is no longer provable.
  if (!writer.holdsAuthority(authority, FENCE_MARGIN_MS)) return "stale";

  const inScope = () => {
    const current = useStorytellerStore.getState().lobby;
    return current?.code === lobby.code && current.sessionId === lobby.sessionId;
  };
  if (choice === "useRemote") {
    if (!restored) return "stale"; // guard matched but the checkpoint failed to validate — never silently apply
    if (inScope()) useStorytellerStore.getState().restoreRemoteCheckpoint(restored.game, currentGuard);
  }
  // "keepLocal": retain local state exactly as-is — nothing to apply here.
  const membership = decodeRoster(await raw.get(`lobbies/${lobby.code}/roster`));
  if (membership.status !== "ready") throw new SnapshotValidationError();
  if (inScope()) await reconcileMembership(writer, lobby.code, membership.data, choice === "useRemote" ? restored!.roster : null);

  const live = await pending.finishLive();
  closeCurrent = live.close;
  return "applied";
}
