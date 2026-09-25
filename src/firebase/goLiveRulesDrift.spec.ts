// @vitest-environment jsdom
// Go Live against ENFORCED rules (emulator), through the real
// FirebaseRoomBackend, the real app-level lifecycle hook and the real End
// Game path. Reproduces the production defect deterministically: deployed
// rules that predate Phase 9R.6 (no `membershipRevocations` grant) deny the
// Storyteller's startup read, so the writer never goes live; under those same
// rules even the fenced close's final cleanup is denied. Proves the hardened
// contract against real rules: attributed failure, no live backend, no false
// End Game, fencing intact, and the local-only Leave for a lobby that never
// reached live. The "current rules" block proves the same path is healthy
// once the repository's rules are deployed. No rules are loosened: the drift
// variant is derived at runtime by REMOVING a grant from rules.json.
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Database } from "firebase/database";
import type { RoomBackend } from "./backend";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { createLobby } from "./lobby";
import { LifecycleError, requireActiveSession } from "./lifecycle";
import { LEASE_MS, SessionWriter } from "./writer";
import { closeMultiplayerSession, leaveMultiplayerOffline, scopeKey, useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { useStorytellerStore } from "@/stores/storytellerStore";

const firebase = vi.hoisted(() => ({ backend: null as RoomBackend | null }));
vi.mock("./session", () => ({
  connectFirebase: async () => {
    if (!firebase.backend) throw new Error("Firebase is not configured.");
    return { backend: firebase.backend, uid: "drift-st" };
  },
}));

const CURRENT_RULES = readFileSync(resolve(__dirname, "rules.json"), "utf8");
/** rules.json as deployed before Phase 9R.6: identical except that the
 * `membershipRevocations` grant does not exist yet. */
function preRevocationRules(): string {
  const rules = JSON.parse(CURRENT_RULES);
  delete rules.rules.lobbies.$code.membershipRevocations;
  return JSON.stringify(rules);
}

const uid = "drift-st";
let env: RulesTestEnvironment;
let counter = 0;
let code = "";
async function startEnvironment(rules: string) {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
    throw new Error("A local RTDB emulator is required. Run npm run test:rules.");
  }
  const [host, port] = address.split(":");
  env = await initializeTestEnvironment({ projectId: "demo-silverwick-rules", database: { host, port: Number(port), rules } });
}
beforeEach(async () => {
  await env.clearDatabase();
  code = `DRFT${["BCDF", "GHJK", "MNPQ", "RSTV", "WXYZ"][counter++ % 5]}`;
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "game" });
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  // Let the unmounted hook's disposal barrier release its lease before the
  // next clearDatabase().
  await new Promise(resolve => setTimeout(resolve, 300));
  firebase.backend = null;
  vi.restoreAllMocks();
});

function backend(): FirebaseRoomBackend {
  return new FirebaseRoomBackend(env.authenticatedContext(uid).database() as unknown as Database);
}
/** GameScreen.goLive, then the app-level lifecycle hook. */
async function goLive(b: FirebaseRoomBackend) {
  firebase.backend = b;
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 3 });
  useStorytellerStore.getState().addPlayer("Alice");
  await createLobby(b, uid, { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  useStorytellerStore.getState().setLobby({ code, uid, sessionId: session.id, status: "live" });
  const exposed: unknown[] = [];
  const unsubscribe = useSessionRuntime.subscribe(state => { if (state.backend) exposed.push(state.backend); });
  renderHook(() => useStorytellerSync(b));
  await waitFor(() => expect(["live", "failed", "blocked"]).toContain(useSessionRuntime.getState().status), { timeout: 8000 });
  unsubscribe();
  return { session, exposed };
}
async function serverSession(): Promise<{ state: string } | null> {
  let value: { state: string } | null = null;
  await env.withSecurityRulesDisabled(async ctx => { value = (await ctx.database().ref(`lobbies/${code}/session`).once("value")).val(); });
  return value;
}

describe("Go Live under deployed rules that predate Phase 9R.6", () => {
  beforeAll(async () => { await startEnvironment(preRevocationRules()); });
  afterAll(async () => { await env.cleanup(); });

  test("DRIFT-1: the startup read of membershipRevocations is denied; the writer never goes live and the failure is attributed to the rules", async () => {
    const { exposed } = await goLive(backend());
    const runtime = useSessionRuntime.getState();
    expect(runtime.status).toBe("failed");
    expect(exposed).toEqual([]);
    expect(runtime.backend).toBeNull();
    expect(runtime.failure?.category).toBe("rules");
    expect(runtime.failure?.diagnostic).toContain(`get lobbies/${code}/membershipRevocations`);
    expect(runtime.error).not.toMatch(/lobbies\/|no longer permits/);
    // Nothing was published: the code was never exposed to players.
    const b = backend();
    expect(await b.get(`lobbies/${code}/checkpoint`)).toBeUndefined();
    expect(await b.get(`lobbies/${code}/public`)).toBeUndefined();
  });

  test("DRIFT-2: End Game cannot close under those rules, so it ends nothing locally; Leave keeps the game offline and deletes nothing", async () => {
    const { session } = await goLive(backend());
    const endGame = vi.spyOn(useStorytellerStore.getState(), "endGame");
    let rejected: unknown = null;
    await act(async () => {
      try { await closeMultiplayerSession(); useStorytellerStore.getState().endGame(); }
      catch (error) { rejected = error; }
    });
    // The fenced close's final cleanup deletes membershipRevocations, which
    // these rules do not grant: a real permission denial.
    expect(String((rejected as Error | null)?.message)).toMatch(/permission/i);
    expect(endGame).not.toHaveBeenCalled();
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    expect(useStorytellerStore.getState().game).not.toBeNull();
    expect((await serverSession())?.state).toBe("active");
    expect(useSessionRuntime.getState().closeFailed).toBe(true);
    expect(useSessionRuntime.getState().leaveOffer).toBe(scopeKey({ code, sessionId: session.id }));

    const game = useStorytellerStore.getState().game;
    expect(leaveMultiplayerOffline()).toBe(true);
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useStorytellerStore.getState().game).toBe(game);
    expect(endGame).not.toHaveBeenCalled();
    expect((await serverSession())?.state).toBe("active");
  });

  test("DRIFT-3: the failed-start close is fenced by the real writer rule: another tab's valid lease wins", async () => {
    const { session } = await goLive(backend());
    // Another Storyteller tab (same owner, own connection) takes the lease
    // once the failed startup writer's lease is released.
    const other = new SessionWriter(backend(), code, session.id);
    await env.withSecurityRulesDisabled(async ctx => { await ctx.database().ref(`lobbies/${code}/writer`).set({ token: "stale", expiresAt: 0 }); });
    await other.start();
    let rejected: unknown = null;
    await act(async () => { await closeMultiplayerSession().catch(error => { rejected = error; }); });
    expect(rejected).toBeInstanceOf(LifecycleError);
    expect((rejected as LifecycleError).kind).toBe("conflict");
    expect(await backend().get(`lobbies/${code}/writer`)).toMatchObject({ token: other.token });
    expect((await serverSession())?.state).toBe("active");
    other.stop();
    await other.dispose();
  });
});

describe("Go Live under the repository's current rules", () => {
  beforeAll(async () => { await startEnvironment(CURRENT_RULES); });
  afterAll(async () => { await env.cleanup(); });

  test("CURRENT-1: the identical path goes live, and End Game closes authoritatively before local completion", async () => {
    const { session, exposed } = await goLive(backend());
    expect(useSessionRuntime.getState().status).toBe("live");
    expect(exposed.length).toBeGreaterThan(0);
    expect(useSessionRuntime.getState().failure).toBeNull();
    expect(await backend().get(`lobbies/${code}/checkpoint`)).toEqual(expect.any(String));
    await act(async () => { await closeMultiplayerSession(); useStorytellerStore.getState().endGame(); });
    expect(await serverSession()).toEqual({ version: 2, id: session.id, state: "ended" });
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  test("CURRENT-2: a live writer's lease still fences a second writer under real rules", async () => {
    const { session } = await goLive(backend());
    const live = useSessionRuntime.getState().backend as SessionWriter;
    const second = new SessionWriter(backend(), code, session.id);
    await expect(second.start()).rejects.toMatchObject({ kind: "conflict" });
    second.stop();
    expect(await backend().get(`lobbies/${code}/writer`)).toMatchObject({ token: live.token });
    expect((await backend().get(`lobbies/${code}/writer`) as { expiresAt: number }).expiresAt).toBeLessThanOrEqual(Date.now() + LEASE_MS + 5000);
  });
});
