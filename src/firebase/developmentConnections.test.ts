import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVELOPMENT_FIREBASE_APP_NAME, DEVELOPMENT_FIREBASE_CONFIG as approved } from "./development";

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn(), getDatabase: vi.fn(), getAuth: vi.fn(), signInAnonymously: vi.fn(),
}));
vi.mock("firebase/app", () => ({ initializeApp: sdk.initializeApp }));
vi.mock("firebase/auth", () => ({ getAuth: sdk.getAuth, signInAnonymously: sdk.signInAnonymously }));
vi.mock("firebase/database", async (original) => ({
  ...await original<typeof import("firebase/database")>(), getDatabase: sdk.getDatabase,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  sdk.initializeApp.mockImplementation((options, name = "[DEFAULT]") => ({ options, name }));
  sdk.getDatabase.mockImplementation(app => ({ app, kind: "database" }));
  sdk.getAuth.mockImplementation(app => ({ app, kind: "auth" }));
});

async function setup(env = { MODE: "development" }) {
  const config = await import("./config");
  config.__setEnvOverrideForTests(env);
  return { ...config, ...await import("./firebaseBackend") };
}

describe("guarded development SDK connections (Auth/database calls mocked)", () => {
  it("reuses only the exact approved named app without initiating authentication", async () => {
    const { initFirebase } = await setup();
    const first = initFirebase(approved);
    expect(initFirebase({ ...approved })).toEqual(first);
    expect(first.app.name).toBe(DEVELOPMENT_FIREBASE_APP_NAME);
    expect(first.db.app).toBe(first.app);
    expect(first.auth.app).toBe(first.app);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.signInAnonymously).not.toHaveBeenCalled();
  });

  it.each(Object.keys(approved) as (keyof typeof approved)[])("rejects missing %s before SDK access", async (key) => {
    const { initFirebase } = await setup();
    const cfg = { ...approved };
    delete (cfg as Partial<typeof approved>)[key];
    expect(() => initFirebase(cfg)).toThrow(/does not match/);
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.getDatabase).not.toHaveBeenCalled();
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it.each(Object.keys(approved) as (keyof typeof approved)[])("rejects changed %s even after a valid connection is cached", async (key) => {
    const { initFirebase } = await setup();
    const valid = initFirebase(approved);
    expect(() => initFirebase({ ...approved, [key]: "wrong-project" })).toThrow(/does not match/);
    expect(initFirebase(approved)).toEqual(valid);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.getAuth).toHaveBeenCalledTimes(1);
    expect(sdk.getDatabase).toHaveBeenCalledTimes(1);
  });

  it("does not reuse an unmarked default app when entering a marked development context", async () => {
    const { initFirebase, __setEnvOverrideForTests } = await setup({ MODE: "production" });
    const previous = initFirebase(approved);
    __setEnvOverrideForTests({ MODE: "production", VITE_FIREBASE_ENVIRONMENT: "development" });
    const development = initFirebase(approved);
    expect(previous.app.name).toBe("[DEFAULT]");
    expect(development.app.name).toBe(DEVELOPMENT_FIREBASE_APP_NAME);
    expect(development.app).not.toBe(previous.app);
    expect(development.db).not.toBe(previous.db);
    expect(development.auth).not.toBe(previous.auth);
  });

  it("cannot reuse Auth with a foreign API key and matching project/database labels", async () => {
    const { initFirebase, __setEnvOverrideForTests } = await setup({ MODE: "production" });
    const previous = initFirebase({ ...approved, apiKey: "foreign-key" });
    __setEnvOverrideForTests({ MODE: "development" });
    const development = initFirebase(approved);
    expect(development.auth).not.toBe(previous.auth);
    expect(development.auth.app.options.apiKey).toBe(approved.apiKey);
  });

  it("keeps the default app behavior for unmarked production configuration", async () => {
    const { initFirebase } = await setup({ MODE: "production" });
    const cfg = { apiKey: "legacy-key", projectId: "legacy-project", databaseURL: "https://legacy.firebaseio.com" };
    const result = initFirebase(cfg);
    expect(sdk.initializeApp).toHaveBeenCalledWith(cfg);
    expect(initFirebase(cfg)).toEqual(result);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of reusing cached Auth when default-app credentials change", async () => {
    const actual = await vi.importActual<typeof import("firebase/app")>("firebase/app");
    sdk.initializeApp.mockImplementation(actual.initializeApp);
    const { initFirebase } = await setup({ MODE: "production" });
    const cfg = { ...approved, apiKey: "old-key" };
    const previous = initFirebase(cfg);
    try {
      expect(() => initFirebase({ ...cfg, apiKey: "new-key" })).toThrow(/duplicate-app/);
      expect(initFirebase(cfg)).toEqual(previous);
      expect(sdk.getAuth).toHaveBeenCalledTimes(1);
    } finally { await actual.deleteApp(previous.app); }
  });

  it("rejects an already initialized named app with conflicting credentials", async () => {
    const actual = await vi.importActual<typeof import("firebase/app")>("firebase/app");
    const conflicting = actual.initializeApp({ ...approved, apiKey: "foreign-key" }, DEVELOPMENT_FIREBASE_APP_NAME);
    sdk.initializeApp.mockImplementation(actual.initializeApp);
    const { initFirebase } = await setup();
    try {
      expect(() => initFirebase(approved)).toThrow(/duplicate-app/);
      expect(sdk.getAuth).not.toHaveBeenCalled();
      expect(sdk.getDatabase).not.toHaveBeenCalled();
    } finally { await actual.deleteApp(conflicting); }
  });

  it("does not publish a partially initialized SDK cache after an initialization failure", async () => {
    const { initFirebase } = await setup({ MODE: "production" });
    const firstConfig = { ...approved, apiKey: "old-key" };
    const previous = initFirebase(firstConfig);
    sdk.getAuth.mockImplementationOnce(() => { throw new Error("Auth initialization failed"); });
    expect(() => initFirebase({ ...approved, apiKey: "new-key" })).toThrow(/initialization failed/);
    expect(initFirebase(firstConfig)).toEqual(previous);
  });
});
