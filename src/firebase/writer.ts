import type { Json, RoomBackend } from "./backend";
import type { GuardStamp } from "@/stores/types";
import { guardSchema, leaseSchema, LifecycleError, requireActiveSession, retryTransient, sessionPath } from "./lifecycle";

export const LEASE_MS = 30_000;
/** Default synchronous fencing margin (Finding H1): the buffer, in ms,
 * subtracted from a lease's recorded expiry before it is treated as no
 * longer provably valid. Used twice — by `holdsAuthority` for its
 * synchronous pre-mutation check, and inside `renew()`'s own transaction
 * updater to decide whether the server lease record it observed is safely
 * continuous or must be treated as a gap. Comfortably smaller than the
 * renewal cadence (LEASE_MS / 3) so ordinary renewal never trips it, while
 * still absorbing clock-estimate slop around the instant of a destructive
 * commit. */
export const FENCE_MARGIN_MS = 1000;

/** A proof that this writer held (or validly reclaimed) the exclusive
 * `writer` lease continuously, returned by `reconfirmAuthority()`. Checked
 * synchronously via `holdsAuthority()` immediately before a destructive
 * mutation that must never apply against content compared under authority
 * that has since lapsed or been reclaimed after a gap (Finding H1). Not
 * itself proof of anything once time has passed or the writer has moved to
 * a new epoch — it must be re-validated at the point of use, not cached. */
export type AuthorityHandle = {
  epoch: number;
  expiresAt: number;
};

/** A coherent startup snapshot (Phase 9C.2B.1 revision): the `writeGuard`
 * this writer observed immediately after acquiring its lease, paired with an
 * AuthorityHandle for the SAME uninterrupted authority generation that guard
 * was read under. `start()` captures the handle BEFORE the (async) guard read
 * and synchronously re-proves it AFTER, so the two can never belong to
 * different generations: a writer that loses authority and later legitimately
 * reacquires cannot present a pre-gap guard beside a post-gap handle. The
 * automatic Storyteller startup consumes both together (Finding H1; the exact
 * G1->G2->reacquire gap Luna proved) — never a guard from one call and a
 * handle from a separate, later reconfirmAuthority() that could straddle a
 * takeover. */
export type StartupSnapshot = {
  observedGuard: GuardStamp | null;
  authorityHandle: AuthorityHandle;
};

function isPermissionDenied(error: unknown): boolean {
  if (error instanceof LifecycleError) return false;
  const code = typeof error === "object" && error !== null ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return /permission[_-]denied/i.test(code) || /permission[_-]denied/i.test(message);
}

/** One tab owns one lease. Every data write carries its token and revision;
 * Firebase rules fence delayed writes from expired or replaced writers. */
export class SessionWriter implements RoomBackend {
  onStop?: () => void;
  /** Fires with {token, revision} the instant a commit allocates that
   * revision — before the network round trip resolves. Phase 9C.2A plumbing
   * only; does not alter what Firebase writes or weaken retry/fencing. */
  onAttempt?: (guard: GuardStamp) => void;
  /** Fires with {token, revision} only when that exact commit has genuinely
   * succeeded AND this writer has not since terminally stopped — the same
   * gate `report(null)` already uses below, so a belated post-stop success
   * can never reach this hook either. */
  onAck?: (guard: GuardStamp) => void;
  private tail: Promise<unknown> = Promise.resolve();
  private abort = new AbortController();
  private revision = 0;
  private offset = 0;
  private stopped = false;
  private closing = false;
  private renewal: ReturnType<typeof setInterval> | undefined;
  /** The exact expiry this writer most recently, successfully wrote to the
   * server for its own lease (Finding H1). Updated on every successful
   * start()/renew(), never guessed or extrapolated between renewals. */
  private leaseExpiresAt = 0;
  /** Identifies one uninterrupted generation of this writer's authority.
   * Bumped by `renew()` whenever the server lease record its own committing
   * transaction observed proves authority was NOT continuously held by this
   * writer's current token since the prior renewal — never decided from
   * this writer's own pre-transaction bookkeeping, which can be stale by
   * the time the transaction actually commits (Finding H1: a renewal begun
   * while genuinely valid can still resume, after a real delay, into a gap
   * a different writer legitimately filled and vacated in between). A
   * handle from `reconfirmAuthority()` whose epoch no longer matches proves
   * this writer's hold was not continuous since that handle was issued,
   * even if `isStopped()` has not (yet) caught up. */
  private leaseEpoch = 0;
  readonly token = crypto.randomUUID();
  readonly root: string;
  private readonly direct: RoomBackend;

  assertActive() {
    if (this.stopped) throw new LifecycleError("cancelled", "Session cancelled.");
  }

  /** Whether a terminal writer/session/lease failure has already stopped this
   * writer. A commit that was in flight before that point may still resolve
   * successfully afterward (Firebase accepted it before the stop); ownership
   * of the "write" error belongs to the stop, not to that belated success. */
  isStopped() {
    return this.stopped;
  }

  constructor(private raw: RoomBackend, readonly code: string, readonly sessionId: string, private report: (error: unknown | null) => void = () => {}) {
    this.root = `lobbies/${code}`;
    this.direct = {
      get: (path) => this.get(path), subscribe: (path, cb, err) => this.subscribe(path, cb, err),
      set: (path, value) => this.commit({ [path]: value }), update: (updates) => this.commit(updates),
      setIfAbsent: async () => { throw new Error("Writer commands cannot claim lobby identities."); },
      transaction: async () => { throw new Error("Use the session writer for mutations."); },
      onDisconnectSet: (path, value) => this.onDisconnectSet(path, value),
    };
  }
  /** Acquires the lease and returns a coherent {observedGuard, authorityHandle}
   * StartupSnapshot (Phase 9C.2B.1 revision). `observedGuard` is the server
   * guard observed immediately after this writer acquired its lease — the raw
   * value stored at `writeGuard` before this writer has committed anything, or
   * null if none exists yet (a brand new lobby). This is `writeGuard` as data,
   * not as this writer's own identity: its token (if any) belongs to whichever
   * writer committed last, never to `this.token`. `authorityHandle` proves the
   * uninterrupted authority generation that same guard was read under: it is
   * captured before the guard read and synchronously re-proven after, so the
   * caller can gate every subsequent reconnect step on it (holdsAuthority) and
   * know guard and authority are one generation. Reconnect compares against
   * `observedGuard`, never a snapshot taken before the lease was held; a lease
   * that lapses or is reclaimed during the guard read rejects here instead. */
  async start(): Promise<StartupSnapshot> {
    this.assertActive();
    const session = await requireActiveSession(this.raw, this.code);
    if (session.id !== this.sessionId) throw new LifecycleError("invalid", "Saved game does not match this lobby.");
    const offset = await this.raw.get(".info/serverTimeOffset");
    this.offset = typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
    await this.renew();
    if (this.stopped) {
      // This writer's own later dispose() (always invoked by the disposal
      // barrier once this rejection settles) is the canonical place a
      // release failure surfaces; here, the session was cancelled — that is
      // always the right error to throw regardless of this best-effort
      // early release attempt's own outcome.
      await this.release().catch(() => {});
      throw new LifecycleError("cancelled", "Session cancelled.");
    }
    // Phase 9C.2B.1 (revision): capture the AuthorityHandle for the generation
    // renew() just established BEFORE the async writeGuard read below, then
    // synchronously re-prove it AFTER (holdsAuthority, no await in between) —
    // so the guard this returns and the handle that authorizes every later
    // reconnect step are bound to ONE uninterrupted authority generation. If
    // this writer's lease lapses, or is reclaimed after a gap, while the guard
    // read is in flight, the re-check rejects the guard rather than accepting
    // one read under authority that is no longer the generation this handle
    // represents (Finding H1; the G1->G2->reacquire gap Luna proved once lived
    // in the old start()/reconfirmAuthority() boundary, where a post-gap valid
    // handle could silently legitimize a pre-gap guard).
    const authorityHandle: AuthorityHandle = { epoch: this.leaseEpoch, expiresAt: this.leaseExpiresAt };
    const guard = await this.raw.get(`${this.root}/writeGuard`);
    this.assertActive();
    if (!this.holdsAuthority(authorityHandle, FENCE_MARGIN_MS)) {
      throw new LifecycleError("conflict", "Another Storyteller tab controls this lobby. Close it, then retry after 30 seconds.");
    }
    const observed = guard != null ? guardSchema.parse(guard) : null;
    if (observed) this.revision = observed.revision;
    this.renewal = setInterval(() => {
      void retryTransient(() => this.renew(), this.abort.signal).catch(error => { this.stop(); this.report(error); });
    }, LEASE_MS / 3);
    return { observedGuard: observed, authorityHandle };
  }
  private async renew() {
    if (this.stopped) throw new LifecycleError("cancelled", "Session closed.");
    // Continuity (Finding H1) is decided from the server lease record the
    // transaction invocation that actually COMMITS observed — never from a
    // `now` or reclaim/no-reclaim decision made before this transaction was
    // even awaited. A renewal that begins while this writer's lease is
    // still genuinely valid can still resume, after a real delay, into a
    // gap a different writer legitimately filled and released in between;
    // deciding from pre-transaction bookkeeping would miss exactly that.
    let observation: { continuous: boolean; expiresAt: number } | null = null;
    const acquired = await this.raw.transaction(`${this.root}/writer`, current => {
      // Firebase may invoke this updater more than once per transaction
      // (local-cache retry, server contention) before one invocation's
      // return value actually commits. The capture is therefore reset at
      // the very start of every invocation and never accumulated across
      // retries — only the invocation associated with the eventual commit
      // may leave a non-null observation behind, and an aborted invocation
      // (stopped, or blocked by a foreign valid lease) always leaves it
      // null.
      observation = null;
      if (this.stopped) return undefined;
      const now = Date.now() + this.offset;
      const lease = current == null ? null : leaseSchema.parse(current);
      if (lease && lease.token !== this.token && lease.expiresAt > now) return undefined;
      const continuous = lease != null && lease.token === this.token && lease.expiresAt > now + FENCE_MARGIN_MS;
      const expiresAt = now + LEASE_MS;
      observation = { continuous, expiresAt };
      return { token: this.token, expiresAt };
    });
    if (!acquired) throw new LifecycleError("conflict", "Another Storyteller tab controls this lobby. Close it, then retry after 30 seconds.");
    // TS cannot narrow `observation` itself across the closure that mutates
    // it (it stays typed as the pre-transaction `null` at this point), so
    // this asserts the declared type back so `if (!settled)` below narrows
    // normally — a type-system workaround only, not a runtime assumption:
    // the defensive check right after still fails closed for real.
    const settled = observation as { continuous: boolean; expiresAt: number } | null;
    // Defensive: a committed transaction's winning invocation always sets
    // `observation` immediately before returning the value that commits, so
    // this should be unreachable — but fail closed rather than assume
    // continuity if it is ever somehow reached.
    if (!settled) throw new LifecycleError("conflict", "Lease renewal could not be verified.");
    // Synchronous — no await/Promise boundary between this decision and the
    // expiry it commits alongside it — so nothing else can observe one
    // updated without the other.
    if (!settled.continuous) this.leaseEpoch++;
    this.leaseExpiresAt = settled.expiresAt;
  }
  /** Synchronously re-proves current server writer authority by reusing the
   * exact same lease-acquisition/renewal transaction the renewal interval
   * already runs — not a second authority path. Resolves only when this
   * writer still owns, or can validly reclaim, the exclusive `writer`
   * lease (rejecting, exactly like renew()/start() do, if another writer's
   * lease is currently valid); a successful call also extends that lease
   * by another LEASE_MS. Production behavior — real callers (explicit
   * reconnect-conflict resolution) rely on this to confirm authority
   * before applying a Storyteller's choice, not a test-only hook.
   *
   * Returns an AuthorityHandle (Finding H1) representing the confirmed
   * continuous-authority interval as of THIS call — it is a snapshot, not
   * a live claim, and must be re-validated via `holdsAuthority()`
   * synchronously, immediately before any destructive use, never cached
   * across an intervening await. */
  async reconfirmAuthority(): Promise<AuthorityHandle> {
    await this.renew();
    return { epoch: this.leaseEpoch, expiresAt: this.leaseExpiresAt };
  }
  /** Synchronous production check (Finding H1): does this writer still
   * provably hold the exact continuous-authority interval `handle`
   * represents, with at least `marginMs` of headroom before it could have
   * lapsed? No I/O, no await — callers gate a destructive mutation on this
   * with nothing else in between, so a lease that lapses or gets reclaimed
   * DURING a slow intervening read (the exact race Astra reproduced: reads
   * outliving the 30s lease before `useRemote` replaced local game state)
   * is caught here rather than trusted on stale evidence. Deliberately more
   * than `!isStopped()` alone: the passive renewal interval only notices a
   * lapse on its own ~10s cadence, so a check that only asked "has anything
   * already stopped this writer" could still read true during exactly the
   * window this exists to close. */
  holdsAuthority(handle: AuthorityHandle, marginMs: number): boolean {
    if (this.stopped) return false;
    if (this.leaseEpoch !== handle.epoch) return false;
    const now = Date.now() + this.offset;
    return now + marginMs < this.leaseExpiresAt;
  }
  /** Releases this writer's lease with a fenced, single direct write rather
   * than a transaction (Finding H3): a transaction's updater can be invoked
   * against a locally-cached, possibly-stale `null` view of `/writer` and
   * legitimately abort without ever reaching the server — `dispose()` must
   * never resolve as if released when that happened. `set()` instead goes
   * straight to the server; Firebase rules (unchanged) already enforce the
   * exact fencing this needs: our own token may always release itself,
   * `expiresAt: 0` is explicitly permitted regardless of session state, and
   * a foreign token's still-valid lease cannot be overwritten. */
  private async release(): Promise<void> {
    // Independent of `this.abort` — stop() (always called before dispose()
    // reaches here) aborts that controller, and reusing it would make
    // disposal cancel its own release attempt before a single request went
    // out. Fresh per call; nothing else needs to cancel a release in flight.
    const controller = new AbortController();
    try {
      await retryTransient(() => this.raw.set(`${this.root}/writer`, { token: this.token, expiresAt: 0 }), controller.signal);
      return; // The server accepted the write: release is confirmed.
    } catch (error) {
      if (!isPermissionDenied(error)) throw error; // Network/other failure: server state unproven — propagate.
    }
    // Denied: this token no longer unconditionally owns the write. Read
    // current server truth to classify WHY, rather than guessing.
    const current = await this.raw.get(`${this.root}/writer`);
    const lease = leaseSchema.safeParse(current);
    if (!lease.success) return; // Absent/malformed: no valid lease exists to hold us back.
    const now = Date.now() + this.offset;
    if (lease.data.token !== this.token) return; // A foreign token already owns it, valid or not — we are not the owner either way.
    if (lease.data.expiresAt <= now) return; // Our own record is already expired server-side.
    // Our own token still shows a currently-valid lease and the direct
    // write was still denied: the release did not genuinely happen.
    throw new LifecycleError("conflict", "Could not confirm the writer lease was released.");
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    clearInterval(this.renewal);
    this.onStop?.();
    // Release only after any already-sent write settles. A crashed/offline tab
    // needs no cleanup write: the server lease expires by itself.
  }
  async dispose() {
    this.stop();
    await this.tail.catch(() => {});
    await this.release();
  }
  runExclusive<T>(operation: (backend: RoomBackend) => Promise<T>): Promise<T> {
    if (this.stopped || this.closing) return Promise.reject(new LifecycleError("cancelled", "This lobby is closing or no longer writable."));
    const result = this.tail.then(() => {
      if (this.stopped || this.closing) throw new LifecycleError("cancelled", "Session stopped.");
      return operation(this.direct);
    });
    this.tail = result.catch(() => {});
    return result;
  }
  async close(_playerIds: string[]) {
    this.closing = true;
    this.abort.abort(); // Cancel pending retries before draining the queue.
    clearInterval(this.renewal);
    this.abort = new AbortController();
    try {
      if (this.stopped) throw new LifecycleError("cancelled", "Reconnect before closing this lobby.");
      // Publish the terminal public signal before waiting on an in-flight
      // projection. Join rules reject new requests as soon as this arrives;
      // the guard also fences a delayed projection that lacks the ended mark.
      const signalRevision = ++this.revision;
      await retryTransient(() => this.raw.update({
        [`${this.root}/public/status`]: "ended",
        [`${this.root}/writeGuard`]: { token: this.token, revision: signalRevision },
      }), this.abort.signal);
      await this.tail;
      if (this.stopped) throw new LifecycleError("cancelled", "Reconnect before closing this lobby.");
      await this.renew();
      const cleanup: Record<string, Json> = {
        [sessionPath(this.code)]: { version: 2, id: this.sessionId, state: "ended" },
        [`${this.root}/public/status`]: "ended",
        [`${this.root}/roster`]: null, [`${this.root}/joinRequests`]: null,
        [`${this.root}/leaveRequests`]: null, [`${this.root}/player`]: null,
        [`${this.root}/storyteller`]: null, [`${this.root}/checkpoint`]: null,
      };
      await this.commit(cleanup);
      this.stop();
    } catch (error) { this.report(error); throw error; }
  }
  private async commit(updates: Record<string, Json>) {
    if (this.stopped) throw new LifecycleError("cancelled", "Session stopped.");
    if (Object.keys(updates).some(path => !path.startsWith(this.root + "/"))) throw new LifecycleError("invalid", "A write targeted another lobby.");
    const revision = ++this.revision;
    const guardPath = `${this.root}/writeGuard`;
    const stamp: GuardStamp = { token: this.token, revision };
    const payload = { ...updates, [guardPath]: stamp };
    this.onAttempt?.(stamp);
    try { await retryTransient(async () => {
      // Read the receipt on retry: an acknowledged server write with a lost
      // response must not be repeated under a different revision.
      const receipt = await this.raw.get(guardPath);
      if (receipt != null) {
        const guard = guardSchema.parse(receipt);
        if (guard.token === this.token && guard.revision === revision) return;
      }
      await this.raw.update(payload);
    }, this.abort.signal, attempt => this.report(new Error(`Network unavailable; retry ${attempt} of 3 scheduled.`))); }
    catch (error) {
      // Close cancels old retries intentionally, without abandoning its own
      // final terminal write. All other exhausted/permanent failures stop
      // automatic writers until explicit reconnect.
      if (!this.closing) this.stop();
      throw error;
    }
    // A commit sent before a terminal stop (e.g. a real lease-renewal denial)
    // can still land successfully afterward. That belated success belongs to
    // this one write, not to the writer's lifetime — it must not clear an
    // error the stop already surfaced, nor advance any reconnect watermark.
    // Once stopped, only a genuine restart (a new writer/session) may clear
    // the "write" error or the acknowledgement state.
    if (!this.stopped) { this.report(null); this.onAck?.(stamp); }
  }
  get(path: string) { return this.raw.get(path); }
  subscribe(path: string, cb: (raw: unknown) => void, error?: (error: unknown) => void) { return this.raw.subscribe(path, cb, error); }
  set(path: string, value: Json) { return this.update({ [path]: value }); }
  update(updates: Record<string, Json>) { return this.runExclusive(backend => backend.update(updates)); }
  setIfAbsent(): Promise<{ committed: true } | { committed: false; existing: Json }> { return Promise.reject(new Error("Cannot claim through an active writer.")); }
  transaction(): Promise<boolean> { return Promise.reject(new Error("Cannot transact outside the writer queue.")); }
  onDisconnectSet(path: string, value: Json) { return this.raw.onDisconnectSet(path, value); }
}
