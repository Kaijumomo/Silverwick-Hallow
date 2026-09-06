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

export class FirebaseRoomBackend implements RoomBackend {
  constructor(private db: Database) {}

  async set(path: string, value: Json): Promise<void> {
    await rtdbSet(ref(this.db, path), value);
  }

  async get(path: string): Promise<unknown> {
    const snap = await rtdbGet(ref(this.db, path));
    if (!snap.exists()) return undefined;
    return snap.val();
  }

  async update(updates: Record<string, Json>): Promise<void> {
    // Firebase update() takes a flat map of paths → values relative to the
    // database root, which is exactly the shape we already produce.
    await rtdbUpdate(ref(this.db), updates as Record<string, unknown>);
  }

  async setIfAbsent(
    path: string,
    value: Json
  ): Promise<{ committed: true } | { committed: false; existing: Json }> {
    let existingValue: Json | undefined;
    const result = await runTransaction(ref(this.db, path), (current) => {
      if (current === null) return value;
      existingValue = current as Json;
      return; // abort — leave existing value
    });
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
    }, onError);
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
