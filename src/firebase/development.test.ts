import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { __setEnvOverrideForTests, getConfigSource, loadFirebaseConfig, saveFirebaseConfig } from "./config";
import { DEVELOPMENT_FIREBASE_APP_NAME, DEVELOPMENT_FIREBASE_CONFIG as approved, isApprovedDevelopmentConfig } from "./development";
import { initFirebase } from "./firebaseBackend";

vi.mock("firebase/app", () => ({ initializeApp: vi.fn() }));
vi.mock("firebase/auth", () => ({ getAuth: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock("firebase/database", async (original) => ({
  ...await original<typeof import("firebase/database")>(), getDatabase: vi.fn(),
}));

const developmentEnv = {
  MODE: "development", VITE_FIREBASE_ENVIRONMENT: "development",
  VITE_FIREBASE_API_KEY: approved.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: approved.authDomain,
  VITE_FIREBASE_DATABASE_URL: approved.databaseURL,
  VITE_FIREBASE_PROJECT_ID: approved.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: approved.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: approved.messagingSenderId,
  VITE_FIREBASE_APP_ID: approved.appId,
};
const production = { ...approved, projectId: "mobile-botc", databaseURL: "https://mobile-botc-default-rtdb.firebaseio.com" };

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); __setEnvOverrideForTests(developmentEnv); });
afterEach(() => { __setEnvOverrideForTests(null); localStorage.clear(); });

describe("development Firebase isolation", () => {
  it("resolves only the exact registered development app", () => {
    expect(loadFirebaseConfig()).toEqual(approved);
    expect(getConfigSource()).toBe("env");
  });
  it.each([
    ["projectId", "mobile-botc"], ["apiKey", "different-project-api-key"],
    ["appId", "1:724867369205:web:22fc48e6e35f9e27c0ddbc"],
    ["authDomain", "mobile-botc.firebaseapp.com"],
    ["databaseURL", "https://mobile-botc-default-rtdb.firebaseio.com"],
    ["databaseURL", "https://silverwick-hollow-default-rtdb.firebaseio.com.evil.test"],
    ["databaseURL", "https://silverwick-hollow-default-rtdb.firebaseio.com?ns=mobile-botc-default-rtdb"],
    ["databaseURL", "http://silverwick-hollow-default-rtdb.firebaseio.com"],
    ["storageBucket", "mobile-botc.firebasestorage.app"],
    ["messagingSenderId", "724867369205"],
  ])("rejects a mismatched %s before any SDK initialization", (key, value) => {
    const mixed = { ...approved, [key]: value };
    expect(isApprovedDevelopmentConfig(mixed)).toBe(false);
    expect(() => initFirebase(mixed)).toThrow(/does not match/);
    expect(initializeApp).not.toHaveBeenCalled();
    expect(getDatabase).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
  });
  it("rejects unreviewed extra SDK options", () => {
    expect(() => initFirebase({ ...approved, extra: "unreviewed" } as typeof approved)).toThrow(/does not match/);
  });
  it.each([{}, { VITE_FIREBASE_API_KEY: approved.apiKey }])("never falls back to a saved production config", (partial) => {
    localStorage.setItem("new-blood-fb-config", JSON.stringify(production));
    __setEnvOverrideForTests({ MODE: "development", ...partial });
    expect(loadFirebaseConfig()).toBeNull();
    expect(getConfigSource()).toBe("none");
  });
  it("fails closed when environment values are mixed with production", () => {
    localStorage.setItem("new-blood-fb-config", JSON.stringify(approved));
    __setEnvOverrideForTests({ ...developmentEnv, VITE_FIREBASE_PROJECT_ID: "mobile-botc" });
    expect(loadFirebaseConfig()).toBeNull();
  });
  it("prevents browser configuration overrides without changing saved values", () => {
    localStorage.setItem("new-blood-fb-config", JSON.stringify(production));
    expect(() => saveFirebaseConfig(production)).toThrow(/overrides are disabled/);
    expect(localStorage.getItem("new-blood-fb-config")).toBe(JSON.stringify(production));
    expect(loadFirebaseConfig()).toEqual(approved);
  });
  it.each([
    { ...developmentEnv, VITE_FIREBASE_ENVIRONMENT: "production" },
    { ...developmentEnv, MODE: "production" },
  ])("retains the guard when either mode or marker identifies development", (env) => {
    __setEnvOverrideForTests(env);
    expect(() => initFirebase(production)).toThrow(/does not match/);
  });
  it("allows the exact app through the guard without signing in or enrolling a UID", () => {
    const app = { options: approved } as ReturnType<typeof initializeApp>;
    vi.mocked(initializeApp).mockReturnValue(app);
    expect(() => initFirebase(approved)).not.toThrow();
    expect(initializeApp).toHaveBeenCalledWith(approved, DEVELOPMENT_FIREBASE_APP_NAME);
    expect(getAuth).toHaveBeenCalledWith(app);
    expect(getDatabase).toHaveBeenCalledWith(app);
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});
