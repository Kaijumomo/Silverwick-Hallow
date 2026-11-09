// @vitest-environment jsdom
// PR #10's real setup actions and lifecycle hook against the reviewed
// development Rules. Authentication and administrator admission exist only
// inside the localhost emulator; no hosted Firebase connection is initialized.
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment, type TokenOptions } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Database } from "firebase/database";
import type { RoomBackend } from "./backend";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { knockOnLobby } from "./lobby";
import { SessionWriter } from "./writer";
import { useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { useGoLiveState } from "./goLive";
import { createLiveGame, leaveLive, retryLive } from "@/features/newgame/setupFlowActions";
import { useStorytellerStore } from "@/stores/storytellerStore";

const connection = vi.hoisted(() => ({ backend: null as RoomBackend | null, uid: "setup-st" }));
vi.mock("./session", () => ({ connectFirebase: async () => {
  if (!connection.backend) throw new Error("Local test backend missing.");
  return { backend: connection.backend, uid: connection.uid };
} }));
vi.mock("./config", async importOriginal => ({
  ...await importOriginal<typeof import("./config")>(),
  isFirebaseConfigured: () => true,
}));

const st = "setup-st";
const players = ["setup-one", "setup-two", "setup-three", "setup-four", "setup-five"];
const anonymous: TokenOptions = { firebase: { sign_in_provider: "anonymous", identities: {} } };
let env: RulesTestEnvironment;
const db = (uid: string) => env.authenticatedContext(uid, anonymous).database();
const backend = (uid: string) => new FirebaseRoomBackend(db(uid) as unknown as Database);
const settle = () => new Promise(resolve => setTimeout(resolve, 300));
async function adminUpdate(values: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async ctx => { await ctx.database().ref().update(values); });
}
async function adminRead(path: string): Promise<unknown> {
  let result: unknown;
  await env.withSecurityRulesDisabled(async ctx => { result = (await ctx.database().ref(path).once("value")).val(); });
  return result;
}
async function ready() {
  await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"), { timeout: 8000 });
}
async function arrivals(count: number) {
  await waitFor(() => expect(useSessionRuntime.getState().joined).toHaveLength(count), { timeout: 8000 });
}
beforeAll(async () => {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error("Local RTDB emulator required.");
  const [host, port] = address.split(":");
  env = await initializeTestEnvironment({ projectId: "demo-silverwick-rules", database: {
    host, port: Number(port), rules: readFileSync(resolve(__dirname, "development.multiplayer.rules.json"), "utf8"),
  } });
});
beforeEach(async () => {
  await env.clearDatabase();
  connection.uid = st;
  connection.backend = backend(st);
  useGoLiveState.setState({ busy: false });
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "newgame" });
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, joined: [], pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await settle(); // Let the hook's disposal barrier release the writer lease.
  connection.backend = null;
  vi.restoreAllMocks();
});
afterAll(async () => { if (env) await env.cleanup(); });

async function setup() {
  expect(await createLiveGame({ scriptId: "tb", total: 5, travellers: 0, extras: [] })).toEqual({ kind: "created" });
  return retryLive();
}

describe("PR #10 setup under exact reviewed development Rules", () => {
  test("Invite to phones fails closed for an anonymous identity without administrator admission", async () => {
    expect((await setup()).kind).toBe("failed");
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useSessionRuntime.getState().backend).toBeNull();
    expect(await adminRead("lobbies")).toBeNull();
  });

  test("five admitted phones join privately, expire/reconnect, recover under the same authority, and leave closes before discarding", async () => {
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await adminUpdate({ "developmentAccess/users": Object.fromEntries([st, ...players].map(uid => [uid, {
      enabled: true, role: uid === st ? "storyteller" : "player", expiresAt,
    }])) });
    const outcome = await setup();
    expect(outcome.kind).toBe("attached");
    const lobby = useStorytellerStore.getState().lobby!;
    if (!lobby.sessionId) throw new Error("Go Live did not establish a session identity.");
    const b = connection.backend as FirebaseRoomBackend;
    const path = (suffix: string) => `lobbies/${lobby.code}/${suffix}`;
    let hook = renderHook(() => useStorytellerSync(b));
    await ready();

    // An allowed account alone cannot enter this newly allocated session.
    await assertFails(db(players[0]!).ref(path("session")).once("value"));
    await adminUpdate({ [`developmentAccess/games/${lobby.code}`]: {
      sessionId: lobby.sessionId, expiresAt, players: Object.fromEntries(players.map(uid => [uid, true])),
    } });
    const clients = players.map(uid => ({ uid, database: db(uid) }));
    for (const [index, client] of clients.entries()) {
      const phone = new FirebaseRoomBackend(client.database as unknown as Database);
      await knockOnLobby(phone, lobby.code, client.uid, `Phone ${index + 1}`);
      await phone.set(path(`presence/${client.uid}`), { online: true, lastSeen: Date.now() });
    }
    await arrivals(5);
    expect(new Set(useSessionRuntime.getState().joined.map(player => player.uid)).size).toBe(5);
    expect(useStorytellerStore.getState().game?.phase).toBe("setup");
    expect(Object.keys(useStorytellerStore.getState().game?.players ?? {})).toHaveLength(5);
    // Repeated requests by the same identity cannot manufacture extra arrivals.
    await knockOnLobby(new FirebaseRoomBackend(clients[0]!.database as unknown as Database), lobby.code, players[0]!, "Again");
    await arrivals(5);
    for (const suffix of ["storyteller", "checkpoint", "roster", "player", "joinRequests"]) {
      await assertFails(clients[0]!.database.ref(path(suffix)).once("value"));
    }
    await assertFails(db("not-enrolled").ref(path("public")).once("value"));
    await assertFails(clients[0]!.database.ref(path(`presence/${players[1]}`)).set({ online: true, lastSeen: Date.now() }));
    await assertFails(clients[0]!.database.ref(path("session")).set({ version: 2, id: lobby.sessionId, state: "ended" }));
    const secondWriter = new SessionWriter(backend(st), lobby.code, lobby.sessionId);
    await expect(secondWriter.start()).rejects.toMatchObject({ kind: "conflict" });
    secondWriter.stop();

    const first = clients[0]!;
    const firstPhone = new FirebaseRoomBackend(first.database as unknown as Database);
    const cancelDisconnect = await firstPhone.onDisconnectSet(path(`presence/${first.uid}`), { online: false, lastSeen: Date.now() });
    first.database.goOffline();
    try { await arrivals(4); }
    finally { first.database.goOnline(); }
    await firstPhone.set(path(`presence/${first.uid}`), { online: true, lastSeen: Date.now() });
    await cancelDisconnect();
    await arrivals(5);

    // A silent phone does not need to deliver another snapshot to expire.
    await firstPhone.set(path(`presence/${first.uid}`), { online: true, lastSeen: Date.now() - 44_800 });
    await arrivals(4);
    await firstPhone.set(path(`presence/${first.uid}`), { online: true, lastSeen: Date.now() });
    await arrivals(5);

    const originalGame = useStorytellerStore.getState().game;
    const originalUndo = useStorytellerStore.getState().undoStack;
    hook.unmount();
    await settle();
    hook = renderHook(() => useStorytellerSync(b));
    await ready();
    await arrivals(5);
    expect(useStorytellerStore.getState().lobby?.sessionId).toBe(lobby.sessionId);
    expect(useStorytellerStore.getState().game).toEqual(originalGame);
    expect(useStorytellerStore.getState().undoStack).toEqual(originalUndo);
    expect(useSessionRuntime.getState().failure).toBeNull();

    let left: Awaited<ReturnType<typeof leaveLive>> | undefined;
    await act(async () => { left = await leaveLive(); });
    expect(left).toEqual({ kind: "left" });
    expect(await adminRead(path("session"))).toEqual({ version: 2, id: lobby.sessionId, state: "ended" });
    expect(await adminRead(path("checkpoint"))).toBeNull();
    expect(await adminRead(path("joinRequests"))).toBeNull();
    expect(useStorytellerStore.getState().game).toBeNull();
    expect(useStorytellerStore.getState().lobby).toBeNull();
    await assertFails(first.database.ref(path(`presence/${first.uid}`)).set({ online: true, lastSeen: Date.now() }));
    hook.unmount();
  });
});
