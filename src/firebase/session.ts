// Active backend singleton. Set when the user configures Firebase (or in
// tests, when injecting a MemoryRoomBackend). The Firebase SDK is loaded
// lazily — `connectFirebase()` is the entry point that pulls in the SDK
// chunk on first use, so apps that never go live (or load a custom-script
// preview) don't pay the ~150kB gzipped Firebase cost.

import { loadFirebaseConfig } from "./config";
import type { RoomBackend } from "./backend";

let activeBackend: RoomBackend | null = null;
let activeUid: string | null = null;

export function getActiveBackend(): RoomBackend {
  if (!activeBackend) {
    throw new Error(
      "No active Firebase backend. Configure Firebase first via the Configure dialog."
    );
  }
  return activeBackend;
}

export function getActiveUid(): string {
  if (!activeUid) {
    throw new Error("Not authenticated. Call connectFirebase() first.");
  }
  return activeUid;
}

/**
 * Initialize Firebase from saved config and sign in anonymously.
 * Idempotent — safe to call repeatedly. Lazy-loads the Firebase SDK on
 * first call so the SDK is excluded from the initial bundle.
 */
let connecting: Promise<{ backend: RoomBackend; uid: string }> | null = null;
export function connectFirebase(): Promise<{ backend: RoomBackend; uid: string }> {
  if (!connecting) connecting = establishFirebase().finally(() => { connecting = null; });
  return connecting;
}

async function establishFirebase(): Promise<{ backend: RoomBackend; uid: string }> {
  const cfg = loadFirebaseConfig();
  if (!cfg) {
    throw new Error("Firebase is not configured.");
  }
  // Dynamic import — Firebase SDK lands in its own chunk.
  const { initFirebase, FirebaseRoomBackend, ensureAuthUid } = await import(
    "./firebaseBackend"
  );
  const { db, auth } = initFirebase(cfg);
  const uid = await ensureAuthUid(auth);
  if (!activeBackend) {
    activeBackend = new FirebaseRoomBackend(db);
  }
  activeUid = uid;
  return { backend: activeBackend, uid };
}

/**
 * Clear the cached backend and uid so the next `connectFirebase()` call
 * creates a fresh connection (e.g. after the user saves a new Firebase config).
 */
export function clearActiveBackend(): void {
  activeBackend = null;
  activeUid = null;
}

/** Test-only: replace the active backend and uid. */
export function __setActiveBackendForTests(
  backend: RoomBackend | null,
  uid: string | null
): void {
  activeBackend = backend;
  activeUid = uid;
}
