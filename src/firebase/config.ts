// Firebase config resolution order:
//   1. Vite env vars (VITE_FIREBASE_*) — primary path for production.
//      Local dev: .env.development pins the approved isolated app; connections
//      are allowed only when every identifier matches that isolated app.
//      Cloudflare Pages: set these 7 vars in Settings → Environment Variables:
//        VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN,
//        VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID,
//        VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID,
//        VITE_FIREBASE_APP_ID
//   2. localStorage — legacy fallback for unmarked non-development builds.
//      Development builds never read or save a browser configuration override.
// The apiKey is public by Firebase design; the auth boundary is the security
// rules at src/firebase/rules.json. Do NOT put service account keys in env.

import { isTabletTrial, TABLET_TRIAL_OFFLINE_MESSAGE } from "@/config/trial";
import { isApprovedDevelopmentConfig } from "./development";

const STORAGE_KEY = "new-blood-fb-config";

export type FirebaseAppConfig = {
  apiKey: string;
  authDomain?: string;
  databaseURL: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
};

export type ConfigSource = "env" | "localStorage" | "none";

/** Override for tests — when set, replaces import.meta.env reads. */
type EnvBag = Record<string, string | undefined>;
let envOverride: EnvBag | null = null;
export function __setEnvOverrideForTests(env: EnvBag | null): void {
  envOverride = env;
}

function environment(): EnvBag | undefined {
  return envOverride ?? (import.meta as ImportMeta & { env?: EnvBag }).env;
}

export function isDevelopmentFirebaseEnvironment(): boolean {
  const env = environment();
  // MODE cannot be overridden by an .env file. The explicit marker also
  // protects a development-configured build made with --mode production.
  return env?.MODE === "development" || env?.VITE_FIREBASE_ENVIRONMENT === "development";
}

/** Runs before SDK initialization and before cached SDK instances are reused. */
export function assertFirebaseConnectionAllowed(cfg: FirebaseAppConfig): void {
  if (!isDevelopmentFirebaseEnvironment()) return;
  if (!isApprovedDevelopmentConfig(cfg)) {
    throw new Error("Development Firebase configuration does not match the approved silverwick-hollow app.");
  }
  // Admission to game data is still enforced by administrator-owned UID/game
  // grants in development Rules. Valid configuration does not enroll a user.
}

export function loadFirebaseConfig(): FirebaseAppConfig | null {
  if (isTabletTrial) return null;
  const envCfg = readFromEnv();
  if (isDevelopmentFirebaseEnvironment()) {
    return envCfg && isApprovedDevelopmentConfig(envCfg) ? envCfg : null;
  }
  if (envCfg) return envCfg;
  return readFromStorage();
}

export function getConfigSource(): ConfigSource {
  if (isTabletTrial) return "none";
  if (isDevelopmentFirebaseEnvironment()) return loadFirebaseConfig() ? "env" : "none";
  if (readFromEnv()) return "env";
  if (readFromStorage()) return "localStorage";
  return "none";
}

export function saveFirebaseConfig(cfg: FirebaseAppConfig): void {
  if (isTabletTrial) throw new Error(TABLET_TRIAL_OFFLINE_MESSAGE);
  if (!isValidConfig(cfg)) {
    throw new Error(
      "Invalid Firebase config: apiKey, databaseURL, and projectId are required."
    );
  }
  if (isDevelopmentFirebaseEnvironment()) {
    throw new Error("Development Firebase configuration is fixed by the development build; browser overrides are disabled.");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearFirebaseConfig(): void {
  if (isTabletTrial) return;
  localStorage.removeItem(STORAGE_KEY);
}

export function isFirebaseConfigured(): boolean {
  return loadFirebaseConfig() !== null;
}

function readFromEnv(): FirebaseAppConfig | null {
  // Test override beats real env so localStorage-fallback tests can isolate.
  const env = environment();
  if (!env) return null;
  const cfg: FirebaseAppConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || undefined,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL ?? "",
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
    appId: env.VITE_FIREBASE_APP_ID || undefined,
  };
  return isValidConfig(cfg) ? cfg : null;
}

function readFromStorage(): FirebaseAppConfig | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidConfig(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isValidConfig(v: unknown): v is FirebaseAppConfig {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as FirebaseAppConfig).apiKey === "string" &&
    (v as FirebaseAppConfig).apiKey.length > 0 &&
    typeof (v as FirebaseAppConfig).databaseURL === "string" &&
    (v as FirebaseAppConfig).databaseURL.length > 0 &&
    typeof (v as FirebaseAppConfig).projectId === "string" &&
    (v as FirebaseAppConfig).projectId.length > 0
  );
}
