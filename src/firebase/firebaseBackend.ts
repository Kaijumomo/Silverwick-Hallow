// Real Firebase RTDB implementation of RoomBackend. Constructed lazily —
// the SDK is not initialized until a lobby is actually created or joined.

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set as rtdbSet,
  get as rtdbGet,
  update as rtdbUpdate,
  onValue,
  onDisconnect as rtdbOnDisconnect,
  runTransaction,
  type Database,
} from "firebase/database";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import type { FirebaseAppConfig } from "./config";
import type { Json, RoomBackend, Unsubscribe } from "./backend";

let cachedApp: FirebaseApp | null = null;
let cachedDb: Database | null = null;
let cachedAuth: Auth | null = null;
let cachedUid: string | null = null;
let cachedConfigKey: string | null = null;

function configKey(c: FirebaseAppConfig): string {
  return `${c.projectId}|${c.databaseURL}`;
}

export function initFirebase(cfg: FirebaseAppConfig): {
  app: FirebaseApp;
  db: Database;
  auth: Auth;
} {
  const key = configKey(cfg);
  if (cachedApp && cachedDb && cachedAuth && cachedConfigKey === key) {
    return { app: cachedApp, db: cachedDb, auth: cachedAuth };
  }
  // Re-initialize if config changed (e.g., user updated credentials).
  cachedApp = initializeApp(cfg);
  cachedDb = getDatabase(cachedApp);
  cachedAuth = getAuth(cachedApp);
  cachedConfigKey = key;
  cachedUid = null;
  return { app: cachedApp, db: cachedDb, auth: cachedAuth };
}

export async function ensureAuthUid(auth: Auth): Promise<string> {
  await auth.authStateReady();
  if (auth.currentUser?.uid) {
    cachedUid = auth.currentUser.uid;
    return cachedUid;
  }
  // auth.currentUser is null — token may have expired. Never serve stale
  // cachedUid here; always re-authenticate to get a fresh, valid UID.
  cachedUid = null;
  const cred = await signInAnonymously(auth);
  cachedUid = cred.user.uid;
  return cachedUid;
}

/** Durable, developer-facing error attribution: records which Firebase
 * operation and path a failed request targeted, as a non-enumerable
 * `firebaseOperation` property on the SDK's own error object. The error's
 * identity, `message` and `code` are untouched, so every existing
 * classification (transient retry, permission denial, lease release) behaves
 * exactly as before. Read back by `firebaseOperationOf` (lifecycle.ts); never
 * shown to ordinary users. */
export function attributeFirebaseError(error: unknown, operation: string, path: string): unknown {
  if (typeof error === "object" && error !== null && !Object.prototype.hasOwnProperty.call(error, "firebaseOperation")) {
    try {
      Object.defineProperty(error, "firebaseOperation", { value: `${operation} ${path}`, enumerable: false, configurable: true });
    } catch { /* a frozen error stays unattributed */ }
  }
  return error;
}

/** Runs `run` synchronously (as the previous `async` methods did) and always
 * settles as a promise: an SDK call that throws synchronously -- e.g. an
 * invalid value rejected before any request exists -- becomes a rejection,
 * exactly like an `async` method body. */
function attributed<T>(operation: string, path: string, run: () => Promise<T>): Promise<T> {
  let pending: Promise<T>;
  try { pending = run(); }
  catch (error) { return Promise.reject(attributeFirebaseError(error, operation, path)); }
  return pending.catch(error => { throw attributeFirebaseError(error, operation, path); });
}

export class FirebaseRoomBackend implements RoomBackend {
  constructor(private db: Database) {}

  transaction(path: string, change: (current: unknown) => Json | undefined): Promise<boolean> {
    return attributed("transaction", path, async () => (await runTransaction(ref(this.db, path), change, { applyLocally: false })).committed);
  }

  set(path: string, value: Json): Promise<void> {
    return attributed("set", path, () => rtdbSet(ref(this.db, path), value));
  }

  get(path: string): Promise<unknown> {
    return attributed("get", path, async () => {
      // .info nodes are maintained by the SDK, not server REST reads.
      if (path.startsWith(".info/")) return new Promise((resolve, reject) => {
        onValue(ref(this.db, path), snapshot => resolve(snapshot.val()), reject, { onlyOnce: true });
      });
      const snap = await rtdbGet(ref(this.db, path));
      if (!snap.exists()) return undefined;
      return snap.val();
    });
  }

  update(updates: Record<string, Json>): Promise<void> {
    // Firebase update() takes a flat map of paths → values relative to the
    // database root, which is exactly the shape we already produce.
    return attributed("update", Object.keys(updates).join(", "), () => rtdbUpdate(ref(this.db), updates as Record<string, unknown>));
  }

  async setIfAbsent(
    path: string,
    value: Json
  ): Promise<{ committed: true } | { committed: false; existing: Json }> {
    let existingValue: Json | undefined;
    const result = await attributed("setIfAbsent", path, () => runTransaction(ref(this.db, path), (current) => {
      if (current === null) return value;
      existingValue = current as Json;
      return; // abort — leave existing value
    }));
    if (result.committed) return { committed: true };
    return {
      committed: false,
      existing: (existingValue ?? (result.snapshot.val() as Json)) as Json,
    };
  }

  subscribe(path: string, cb: (value: unknown) => void, onError?: (error: unknown) => void): Unsubscribe {
    const r = ref(this.db, path);
    const off = onValue(r, (snap) => {
      cb(snap.exists() ? snap.val() : undefined);
    }, onError && (error => onError(attributeFirebaseError(error, "subscribe", path))));
    return off;
  }

  async onDisconnectSet(
    path: string,
    value: Json
  ): Promise<() => Promise<void>> {
    const od = rtdbOnDisconnect(ref(this.db, path));
    await od.set(value as unknown as object);
    return async () => {
      await od.cancel();
    };
  }
}
