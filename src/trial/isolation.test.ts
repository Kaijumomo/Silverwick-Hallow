import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/trial", () => ({ isTabletTrial: true, TABLET_TRIAL_OFFLINE_MESSAGE: "Local tablet trial: online disabled." }));
vi.mock("@/firebase/firebaseBackend", () => { throw new Error("The trial must never import the Firebase SDK backend"); });
import { __setEnvOverrideForTests, clearFirebaseConfig, getConfigSource, isFirebaseConfigured, loadFirebaseConfig, saveFirebaseConfig } from "@/firebase/config";
import { connectFirebase, getActiveBackend, getActiveUid } from "@/firebase/session";

afterEach(() => { __setEnvOverrideForTests(null); localStorage.clear(); });
describe("tablet trial is offline despite configuration", () => {
  it("ignores environment and saved configuration without deleting the user's configuration", () => {
    const config = { apiKey: "example", databaseURL: "https://example.invalid", projectId: "example" };
    localStorage.setItem("new-blood-fb-config", JSON.stringify(config));
    __setEnvOverrideForTests({ VITE_FIREBASE_API_KEY: "example", VITE_FIREBASE_DATABASE_URL: "https://example.invalid", VITE_FIREBASE_PROJECT_ID: "example" });
    expect(loadFirebaseConfig()).toBeNull();
    expect(getConfigSource()).toBe("none");
    expect(isFirebaseConfigured()).toBe(false);
    expect(() => saveFirebaseConfig(config)).toThrow(/online disabled/);
    clearFirebaseConfig();
    expect(localStorage.getItem("new-blood-fb-config")).toBe(JSON.stringify(config));
  });
  it("rejects explicit connections and backend access before loading Firebase", async () => {
    await expect(connectFirebase()).rejects.toThrow(/online disabled/);
    await expect(connectFirebase()).rejects.toThrow(/online disabled/);
    expect(getActiveBackend).toThrow(/online disabled/);
    expect(getActiveUid).toThrow(/online disabled/);
  });
});
