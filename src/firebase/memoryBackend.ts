import type { Json, RoomBackend, Unsubscribe } from "./backend";

// In-process backend used by vitest tests. Maintains the data tree as a
// single nested object, with the same path semantics as RTDB ("a/b/c").
//
// Not exported from the user-facing app. Importable from tests only.

type Listener = (value: Json | undefined) => void;

function splitPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function readPath(root: Record<string, unknown>, path: string): Json | undefined {
  const segs = splitPath(path);
  let cur: unknown = root;
  for (const s of segs) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[s];
    if (cur === undefined) return undefined;
  }
  return cur as Json;
}

function writePath(
  root: Record<string, unknown>,
  path: string,
  value: Json | undefined
): void {
  const segs = splitPath(path);
  if (segs.length === 0) return;
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    const next = cur[s];
    if (next === null || typeof next !== "object") {
      cur[s] = {};
    }
    cur = cur[s] as Record<string, unknown>;
  }
  const leaf = segs[segs.length - 1]!;
  // Match RTDB semantics: writing null OR undefined deletes the node.
  if (value === undefined || value === null) {
    delete cur[leaf];
  } else {
    cur[leaf] = value;
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export class MemoryRoomBackend implements RoomBackend {
  private root: Record<string, unknown> = {};
  private listeners: Map<string, Set<Listener>> = new Map();
  /** Records every set/update path written, in order. Available to tests. */
  public readonly writeLog: { path: string; value: Json | undefined }[] = [];
  /** Records every path that was subscribed to. Available to tests. */
  public readonly subscribePaths: string[] = [];

  reset() {
    this.root = {};
    this.listeners.clear();
    this.writeLog.length = 0;
    this.subscribePaths.length = 0;
  }

  private notify(path: string) {
    // Fire any listener whose path is `path` or a prefix/descendant — RTDB
    // semantics fire ancestor watchers when a descendant changes. For the
    // tests we care about, an exact-match plus ancestor strategy is enough.
    for (const [watchPath, set] of this.listeners) {
      if (path === watchPath || path.startsWith(watchPath + "/") || watchPath.startsWith(path + "/")) {
        const value = clone(readPath(this.root, watchPath));
        for (const cb of set) cb(value);
      }
    }
  }

  async set(path: string, value: Json): Promise<void> {
    writePath(this.root, path, clone(value));
    this.writeLog.push({ path, value: clone(value) });
    this.notify(path);
  }

  async get(path: string): Promise<unknown> {
    return clone(readPath(this.root, path));
  }

  async update(updates: Record<string, Json>): Promise<void> {
    // Apply atomically (no mid-step listener fires)
    for (const [path, value] of Object.entries(updates)) {
      writePath(this.root, path, clone(value));
      this.writeLog.push({ path, value: clone(value) });
    }
    // Notify after all writes settle.
    const seen = new Set<string>();
    for (const path of Object.keys(updates)) {
      if (seen.has(path)) continue;
      seen.add(path);
      this.notify(path);
    }
  }

  async setIfAbsent(
    path: string,
    value: Json
  ): Promise<{ committed: true } | { committed: false; existing: Json }> {
    const existing = readPath(this.root, path);
    if (existing !== undefined) {
      return { committed: false, existing: clone(existing)! };
    }
    writePath(this.root, path, clone(value));
    this.writeLog.push({ path, value: clone(value) });
    this.notify(path);
    return { committed: true };
  }

  subscribe(path: string, cb: (value: unknown) => void, _onError?: (error: unknown) => void): Unsubscribe {
    this.subscribePaths.push(path);
    let set = this.listeners.get(path);
    if (!set) {
      set = new Set();
      this.listeners.set(path, set);
    }
    set.add(cb);
    // Fire immediately with current value
    cb(clone(readPath(this.root, path)));
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.listeners.delete(path);
    };
  }

  /**
   * No-op in memory: there is no real "disconnect" event in tests.
   * Returns a no-op cancel. Tests that need to assert disconnect-fire
   * behaviour should call the returned cancel — or write directly to the path.
   */
  async onDisconnectSet(_path: string, _value: Json): Promise<() => Promise<void>> {
    return async () => {};
  }
}
