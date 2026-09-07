import type { Json, RoomBackend } from "./backend";
import { guardSchema, leaseSchema, LifecycleError, requireActiveSession, retryTransient, sessionPath } from "./lifecycle";

export const LEASE_MS = 30_000;

/** One tab owns one lease. Every data write carries its token and revision;
 * Firebase rules fence delayed writes from expired or replaced writers. */
export class SessionWriter implements RoomBackend {
  onStop?: () => void;
  private tail: Promise<unknown> = Promise.resolve();
  private abort = new AbortController();
  private revision = 0;
  private offset = 0;
  private stopped = false;
  private closing = false;
  private renewal: ReturnType<typeof setInterval> | undefined;
  readonly token = crypto.randomUUID();
  readonly root: string;
  private readonly direct: RoomBackend;

  assertActive() {
    if (this.stopped) throw new LifecycleError("cancelled", "Session cancelled.");
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
  async start() {
    this.assertActive();
    const session = await requireActiveSession(this.raw, this.code);
    if (session.id !== this.sessionId) throw new LifecycleError("invalid", "Saved game does not match this lobby.");
    const offset = await this.raw.get(".info/serverTimeOffset");
    this.offset = typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
    await this.renew();
    if (this.stopped) { await this.release(); throw new LifecycleError("cancelled", "Session cancelled."); }
    const guard = await this.raw.get(`${this.root}/writeGuard`);
    this.assertActive();
    if (guard != null) this.revision = guardSchema.parse(guard).revision;
    this.renewal = setInterval(() => {
      void retryTransient(() => this.renew(), this.abort.signal).catch(error => { this.stop(); this.report(error); });
    }, LEASE_MS / 3);
  }
  private async renew() {
    if (this.stopped) throw new LifecycleError("cancelled", "Session closed.");
    const now = Date.now() + this.offset;
    const acquired = await this.raw.transaction(`${this.root}/writer`, current => {
      if (this.stopped) return undefined;
      const lease = current == null ? null : leaseSchema.parse(current);
      if (lease && lease.token !== this.token && lease.expiresAt > now) return undefined;
      return { token: this.token, expiresAt: now + LEASE_MS };
    });
    if (!acquired) throw new LifecycleError("conflict", "Another Storyteller tab controls this lobby. Close it, then retry after 30 seconds.");
  }
  private async release() {
    await this.raw.transaction(`${this.root}/writer`, current => {
      const lease = leaseSchema.safeParse(current);
      return lease.success && lease.data.token === this.token ? { token: this.token, expiresAt: 0 } : undefined;
    });
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
    const payload = { ...updates, [guardPath]: { token: this.token, revision } };
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
    this.report(null);
  }
  get(path: string) { return this.raw.get(path); }
  subscribe(path: string, cb: (raw: unknown) => void, error?: (error: unknown) => void) { return this.raw.subscribe(path, cb, error); }
  set(path: string, value: Json) { return this.update({ [path]: value }); }
  update(updates: Record<string, Json>) { return this.runExclusive(backend => backend.update(updates)); }
  setIfAbsent(): Promise<{ committed: true } | { committed: false; existing: Json }> { return Promise.reject(new Error("Cannot claim through an active writer.")); }
  transaction(): Promise<boolean> { return Promise.reject(new Error("Cannot transact outside the writer queue.")); }
  onDisconnectSet(path: string, value: Json) { return this.raw.onDisconnectSet(path, value); }
}
