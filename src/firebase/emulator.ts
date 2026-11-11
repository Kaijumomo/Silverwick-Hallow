import { connectDatabaseEmulator, type Database } from "firebase/database";
import { connectAuthEmulator, type Auth } from "firebase/auth";

// Local multi-device test harness only (docs/TEST_FIREBASE.md, Milestone 4 WP 4-1b).
//
// `__SILVERWICK_EMULATOR_HOST__` is a build-time constant (vite.config.ts) taken from the
// SILVERWICK_EMULATOR_HOST environment variable of the machine that builds. It is "" in every
// ordinary build (Cloudflare production and previews, `npm run build`), so the bundler drops
// this branch and the emulator code entirely; scripts/harness checks that. The harness build
// sets it to a loopback host, and the development-pinned configuration is still required, so
// the local emulators only ever stand in for the isolated test project, never for production.
declare const __SILVERWICK_EMULATOR_HOST__: string | undefined;

export const EMULATOR_PORTS = Object.freeze({ auth: 9099, database: 9000 });
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

/** The emulator host this build was made for ("" in every ordinary build). Undefined in Vitest. */
export const BUILD_EMULATOR_HOST: string =
  typeof __SILVERWICK_EMULATOR_HOST__ === "string" ? __SILVERWICK_EMULATOR_HOST__ : "";

/** Validates a requested emulator host: loopback only. */
export function localEmulatorHost(requested: string): string | null {
  const host = requested.trim();
  if (!host) return null;
  if (!LOOPBACK.has(host)) throw new Error(`SILVERWICK_EMULATOR_HOST must be a loopback host, not "${host}".`);
  return host;
}

export function connectLocalEmulators(db: Database, auth: Auth, host: string): void {
  connectDatabaseEmulator(db, host, EMULATOR_PORTS.database);
  connectAuthEmulator(auth, `http://${host}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
}
