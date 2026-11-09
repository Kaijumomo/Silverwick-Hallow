// @vitest-environment jsdom
// Package 4 final targeted integration verification (Gate 2).
//
// Real production code end to end against the local RTDB emulator and the
// enforced rules.json: createLobby, startStorytellerSession (the live manager
// with its store subscription), SessionWriter, joinLobby/startPlayerHandshake,
// seatPlayerAndCommit, endGameWithIntent (the one terminal path), and the real
// PublicDisplayScreen + usePublicLobby. No MemoryRoomBackend. The only seam is
// connectFirebase(), which hands each caller the emulator-backed backend of
// the device that is calling (Storyteller or Display).
//
// Test-only file; adds no behaviour. Runs with the other emulator specs: npm run test:rules (listed in vitest.rules.config.ts).
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { goOffline, goOnline, type Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { SessionWriter } from "./writer";
import { createLobby, knockOnLobby } from "./lobby";
import { presencePath } from "./paths";
import { joinLobby, startPlayerHandshake } from "./playerSync";
import { seatPlayerAndCommit } from "./membershipCommands";
import { useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { requireActiveSession } from "./lifecycle";
import { endGameWithIntent } from "./terminal";
import { authorizePublicDisplay, ensurePublicDisplayAccess } from "./publicDisplayAuth";
import { __setEnvOverrideForTests, clearFirebaseConfig, saveFirebaseConfig } from "./config";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { PublicDisplayScreen } from "@/features/publicDisplay/PublicDisplayScreen";

// connectFirebase() answers for whichever device is "calling" right now.
const devices = new Map<string, FirebaseRoomBackend>();
let caller = "";
vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>();
  return { ...actual, connectFirebase: async () => ({ backend: devices.get(caller)!, uid: caller }) };
});

let env: RulesTestEnvironment;
beforeAll(async () => {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error("A local RTDB emulator is required.");
  const [host, port] = address.split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-silverwick-rules",
    database: { host, port: Number(port), rules: readFileSync(resolve(__dirname, "rules.json"), "utf8") },
  });
});
afterAll(async () => { if (env) await env.cleanup(); });

const disposals: (() => void | Promise<void>)[] = [];
beforeEach(async () => {
  await env.clearDatabase();
  devices.clear();
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, terminalClose: null });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, joined: [], pending: 0, retry: 0 });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  __setEnvOverrideForTests({});
  saveFirebaseConfig({ apiKey: "AIzaSyTEST", databaseURL: "https://demo-silverwick-rules-default-rtdb.firebaseio.com", projectId: "demo-silverwick-rules" });
  window.history.replaceState(null, "", "/");
});
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
  vi.unstubAllGlobals();
  clearFirebaseConfig();
  __setEnvOverrideForTests(null);
  await env.authenticatedContext("quiesce").database().ref("lobbies/QUIESCE0/session").once("value");
});

function deviceFor(uid: string): FirebaseRoomBackend {
  let backend = devices.get(uid);
  if (!backend) { backend = new FirebaseRoomBackend(env.authenticatedContext(uid).database() as unknown as Database); devices.set(uid, backend); }
  return backend;
}
const denied = /permission[_ ]denied/i;
const store = () => useStorytellerStore.getState();
const waitPlayer = (check: (s: ReturnType<typeof usePlayerStore.getState>) => boolean, label: string) =>
  vi.waitFor(() => {
    const state = usePlayerStore.getState();
    if (!check(state)) throw new Error(`expected ${label}; got ${JSON.stringify({ status: state.status, playerId: state.playerId, error: state.error, remote: state.remoteData })}`);
  }, { timeout: 8000, interval: 100 });

const ROLES = [["Alice", "chef"], ["Bob", "imp"], ["Carol", "empath"], ["Dan", "poisoner"], ["Eve", "washerwoman"]] as const;

/** A live Storyteller: real lobby, the app's own useStorytellerSync hook (writer + manager + store subscription), five seats with roles. */
async function liveTown(code: string, st: string) {
  const stBackend = deviceFor(st);
  await createLobby(stBackend, st, { codeGenerator: () => code });
  const session = await requireActiveSession(stBackend, code);
  const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
  store().newGame("tb");
  for (const [name] of ROLES) store().addPlayer(name);
  const ids = store().game!.seatOrder as string[];
  ROLES.forEach(([, role], i) => { store().assignRole(ids[i]!, role); store().setShownRole(ids[i]!, role); });
  store().setLobby(lobby);
  useStorytellerStore.setState({ game: { ...store().game!, setupRolesRevealed: true } });
  let mounted = renderHook(() => useStorytellerSync(stBackend));
  disposals.push(async () => { mounted.unmount(); await new Promise((r) => setTimeout(r, 300)); });
  const live = () => vi.waitFor(() => { if (useSessionRuntime.getState().status !== "live" || !useSessionRuntime.getState().backend) throw new Error(`not live: ${useSessionRuntime.getState().status} ${useSessionRuntime.getState().error ?? ""}`); }, { timeout: 12000, interval: 100 });
  await live();
  const currentWriter = () => useSessionRuntime.getState().backend as unknown as SessionWriter;
  /** Simulates a reload of the Storyteller device: the hook unmounts (writer released) and mounts again. */
  const reload = async () => { mounted.unmount(); await new Promise((r) => setTimeout(r, 500)); mounted = renderHook(() => useStorytellerSync(stBackend)); await live(); };
  return { stBackend, session, get writer() { return currentWriter(); }, ids, lobby, reload };
}

/** A phone asks to join. The one phone under test goes through the app's joinLobby (it owns the player store);
 * extra phones use the same knock + presence write the handshake performs, without touching that store. */
async function knock(code: string, uid: string, name: string, extra = false) {
  if (!extra) { await joinLobby(deviceFor(uid), code, uid, name); return; }
  await knockOnLobby(deviceFor(uid), code, uid, name);
  await deviceFor(uid).set(presencePath(code, uid), { online: true, lastSeen: Date.now() });
}
async function seat(code: string, writer: SessionWriter, uid: string, id: string) {
  await seatPlayerAndCommit(writer, code, uid, id, null, () => true);
}
const server = async (uid: string, path: string) => deviceFor(uid).get(path);

describe("Package 4 final integration: joining, invitations and seating", () => {
  test("a knock is only a request: the Storyteller sees the arrivals by name, nobody is seated, and joiners can touch nothing else", async () => {
    const code = "P4A1AAAA", st = "p4a1-st", alice = "p4a1-alice", bob = "p4a1-bob";
    const { stBackend } = await liveTown(code, st);
    await knock(code, alice, "Alice");
    disposals.push(startPlayerHandshake(deviceFor(alice), code, alice));
    await knock(code, bob, "Bob", true);
    await vi.waitFor(() => expect(useSessionRuntime.getState().pending).toBe(2), { timeout: 8000 });
    expect(useSessionRuntime.getState().joined.map((j) => j.uid).sort()).toEqual([alice, bob]);
    // Public carries arrival NAMES only (never a uid); nothing is seated automatically.
    await vi.waitFor(async () => expect(((await stBackend.get(`lobbies/${code}/public`)) as { arrivals?: string[] }).arrivals?.slice().sort()).toEqual(["Alice", "Bob"]), { timeout: 8000 });
    expect(JSON.stringify(await stBackend.get(`lobbies/${code}/public`))).not.toContain(alice);
    expect(await stBackend.get(`lobbies/${code}/roster`)).toBeUndefined();
    for (const uid of [alice, bob]) {
      await expect(server(uid, `lobbies/${code}/storyteller`)).rejects.toThrow(denied);
      await expect(server(uid, `lobbies/${code}/roster`)).rejects.toThrow(denied);
    }
    // A joiner cannot read or forge another uid's request, nor seat itself.
    await expect(server(alice, `lobbies/${code}/joinRequests/${bob}`)).rejects.toThrow(denied);
    await expect(deviceFor(alice).set(`lobbies/${code}/roster/${alice}`, "anything")).rejects.toThrow(denied);
    await expect(deviceFor(alice).set(`lobbies/${code}/joinRequests/${bob}`, "Mallory")).rejects.toThrow(denied);
  });

  test("the Storyteller seats a player: the live handshake goes waiting -> seated with only that player's own identity", async () => {
    const code = "P4A2AAAA", st = "p4a2-st", alice = "p4a2-alice", bob = "p4a2-bob";
    const { writer, ids } = await liveTown(code, st);
    await knock(code, bob, "Bob", true);
    await knock(code, alice, "Alice");
    disposals.push(startPlayerHandshake(deviceFor(alice), code, alice));
    await waitPlayer((s) => s.status === "waiting" && s.error === null, "alice waiting after her request");
    await seat(code, writer, alice, ids[0]!);
    await seat(code, writer, bob, ids[1]!);
    await waitPlayer((s) => s.status === "seated" && s.playerId === ids[0] && s.self?.shownRole === "chef" && s.error === null, "alice seated as Chef");
    // Own node readable; the other player's node, Storyteller data and the checkpoint are not.
    await expect(server(alice, `lobbies/${code}/player/${ids[0]}`)).resolves.toMatchObject({ shownRole: "chef" });
    await expect(server(alice, `lobbies/${code}/player/${ids[1]}`)).rejects.toThrow(denied);
    await expect(server(bob, `lobbies/${code}/player/${ids[0]}`)).rejects.toThrow(denied);
    for (const path of ["storyteller", "checkpoint", "roster", "displayAccess"]) {
      await expect(server(alice, `lobbies/${code}/${path}`)).rejects.toThrow(denied);
    }
    // Seats are bound to the right uids server-side.
    await expect(stBackend0(st).get(`lobbies/${code}/roster`)).resolves.toMatchObject({ [alice]: ids[0], [bob]: ids[1] });
  });
});
const stBackend0 = (uid: string) => deviceFor(uid);

describe("Package 4 final integration: synchronization and reconnection", () => {
  test("a Storyteller change reaches a live phone; a phone that drops offline converges after it reconnects, still seated", async () => {
    const code = "P4B1AAAA", st = "p4b1-st", alice = "p4b1-alice";
    const { stBackend, writer, ids } = await liveTown(code, st);
    await knock(code, alice, "Alice");
    const aliceDb = env.authenticatedContext(alice).database() as unknown as Database;
    const aliceBackend = new FirebaseRoomBackend(aliceDb);
    devices.set(alice, aliceBackend);
    disposals.push(() => { goOnline(aliceDb); });
    disposals.push(startPlayerHandshake(aliceBackend, code, alice));
    await seat(code, writer, alice, ids[0]!);
    await waitPlayer((s) => s.status === "seated" && s.self?.shownRole === "chef", "seated as Chef");

    // Live change while connected (the manager's store subscription publishes it).
    store().setShownRole(ids[0]!, "empath");
    await waitPlayer((s) => s.self?.shownRole === "empath" && s.error === null, "live update to Empath");

    // Offline: the Storyteller changes it again; the phone must not see it yet, then must converge.
    goOffline(aliceDb);
    store().setShownRole(ids[0]!, "washerwoman");
    await vi.waitFor(async () => expect(await stBackend.get(`lobbies/${code}/player/${ids[0]}`)).toMatchObject({ shownRole: "washerwoman" }), { timeout: 8000 });
    expect(usePlayerStore.getState().self?.shownRole).toBe("empath");
    goOnline(aliceDb);
    await waitPlayer((s) => s.status === "seated" && s.playerId === ids[0] && s.self?.shownRole === "washerwoman" && s.error === null, "converged after reconnect");
  });

  test("a Storyteller device that reloads takes the lease back and resumes publishing from the saved checkpoint", async () => {
    const code = "P4B2AAAA", st = "p4b2-st", alice = "p4b2-alice";
    const { stBackend, writer, ids, reload } = await liveTown(code, st);
    await knock(code, alice, "Alice");
    await seat(code, writer, alice, ids[0]!);
    await vi.waitFor(async () => expect(await stBackend.get(`lobbies/${code}/checkpoint`)).toBeTruthy(), { timeout: 8000 });
    await reload();
    expect(useSessionRuntime.getState().error).toBeNull();
    expect(useSessionRuntime.getState().status).toBe("live");
    store().setShownRole(ids[0]!, "empath");
    await vi.waitFor(async () => expect(await stBackend.get(`lobbies/${code}/player/${ids[0]}`)).toMatchObject({ shownRole: "empath" }), { timeout: 8000 });
    await expect(stBackend.get(`lobbies/${code}/roster`)).resolves.toMatchObject({ [alice]: ids[0] });
  });
});

describe("Package 4 final integration: session authority and stale-writer protection", () => {
  test("once another device legitimately takes the lease, the old Storyteller's changes never land on the server", async () => {
    const code = "P4C1AAAA", st = "p4c1-st";
    const { stBackend, writer, session, ids } = await liveTown(code, st);
    await vi.waitFor(async () => expect(await stBackend.get(`lobbies/${code}/player/${ids[0]}`)).toMatchObject({ shownRole: "chef" }), { timeout: 8000 });
    // The first device freezes (lease lapses -- seeded as an admin precondition only); a second device acquires it through the real rules.
    const second = new SessionWriter(deviceFor(st), code, session.id);
    disposals.push(() => second.dispose().catch(() => {}));
    let acquired = false;
    for (let attempt = 0; attempt < 8 && !acquired; attempt++) {
      await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref(`lobbies/${code}/writer/expiresAt`).set(0); });
      acquired = await second.start().then(() => true, () => false);
    }
    expect(acquired).toBe(true);
    const lease = (await stBackend.get(`lobbies/${code}/writer`)) as { token: string };
    expect(lease.token).toBe(second.token);
    // The old device (still believing it is the writer) changes the game and tries a direct write: neither lands.
    await expect(writer.set(`lobbies/${code}/public/day`, 77)).rejects.toBeTruthy();
    store().setShownRole(ids[0]!, "empath");
    await new Promise((r) => setTimeout(r, 2500));
    expect(await stBackend.get(`lobbies/${code}/public/day`)).not.toBe(77);
    expect(await stBackend.get(`lobbies/${code}/player/${ids[0]}`)).toMatchObject({ shownRole: "chef" });
    expect(((await stBackend.get(`lobbies/${code}/writer`)) as { token: string }).token).toBe(second.token);
    // The new device is the sole authority and can write.
    await expect(second.set(`lobbies/${code}/public/day`, 5)).resolves.toBeUndefined();
    expect(await stBackend.get(`lobbies/${code}/public/day`)).toBe(5);
  });

  test("a seated player, a joiner and a display can never become the writer or write authority data", async () => {
    const code = "P4C2AAAA", st = "p4c2-st", alice = "p4c2-alice", other = "p4c2-other";
    const { writer, session, ids } = await liveTown(code, st);
    await knock(code, alice, "Alice");
    await seat(code, writer, alice, ids[0]!);
    const rogue = new SessionWriter(deviceFor(alice), code, session.id);
    await expect(rogue.start()).rejects.toThrow(denied);
    await rogue.dispose().catch(() => {});
    for (const uid of [alice, other]) {
      await expect(deviceFor(uid).set(`lobbies/${code}/session/state`, "ended")).rejects.toThrow(denied);
      await expect(deviceFor(uid).set(`lobbies/${code}/writer`, { token: "x", expiresAt: Date.now() + 99999 })).rejects.toThrow(denied);
      await expect(deviceFor(uid).set(`lobbies/${code}/public/winner`, "evil")).rejects.toThrow(denied);
    }
  });
});

const KEYS_NEVER_PUBLIC = ["actualRole", "shownRole", "shownAlignment", "behaviorMode", "alignment", "reminders", "notes", "storyteller", "checkpoint"];
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { into.add(k); keysOf(v, into); }
  return into;
}

describe("Package 4 final integration: privacy across Storyteller, Player and Public Display", () => {
  test("the enrolled display reads only /public, which carries no role, alignment or Storyteller keys; everyone else is refused", async () => {
    const code = "P4D1AAAA", st = "p4d1-st", alice = "p4d1-alice", screen = "p4d1-display", stranger = "p4d1-stranger";
    const { writer, session, ids, stBackend } = await liveTown(code, st);
    await knock(code, alice, "Alice");
    await seat(code, writer, alice, ids[0]!);
    const token = await ensurePublicDisplayAccess(writer, code, session.id);
    await authorizePublicDisplay(deviceFor(screen), code, screen, token);
    await vi.waitFor(async () => expect(await stBackend.get(`lobbies/${code}/public`)).toMatchObject({ code }), { timeout: 8000 });

    const seen = await server(screen, `lobbies/${code}/public`);
    expect(seen).toMatchObject({ code });
    const keys = keysOf(seen);
    for (const forbidden of KEYS_NEVER_PUBLIC) expect(keys.has(forbidden), `public must not carry "${forbidden}"`).toBe(false);
    for (const path of ["storyteller", "checkpoint", "roster", "displayAccess", `player/${ids[0]}`, "joinRequests"]) {
      await expect(server(screen, `lobbies/${code}/${path}`)).rejects.toThrow(denied);
    }
    await expect(server(stranger, `lobbies/${code}/public`)).rejects.toThrow(denied);
    // A seated phone can read public (it is a member) but never the Storyteller's data.
    await expect(server(alice, `lobbies/${code}/storyteller`)).rejects.toThrow(denied);
    // Roles in the Storyteller's real game never leak through the public node's values either.
    const text = JSON.stringify(seen);
    for (const role of ["imp", "poisoner"]) expect(text).not.toContain(`"${role}"`);
  });

  test("at Night the public node withholds every life field", async () => {
    const code = "P4D2AAAA", st = "p4d2-st";
    const { stBackend } = await liveTown(code, st);
    useStorytellerStore.setState({ game: { ...store().game!, phase: "night", day: 1 } });
    await vi.waitFor(async () => expect(await stBackend.get(`lobbies/${code}/public`)).toMatchObject({ phase: "night" }), { timeout: 8000 });
    const keys = keysOf(await stBackend.get(`lobbies/${code}/public`));
    for (const life of ["alive", "ghostVote", "exiled"]) expect(keys.has(life), `Night public must not carry "${life}"`).toBe(false);
  });
});

describe("Package 4 final integration: Public Display winner after the game ends", () => {
  /** Live town with a real Display screen rendered against the emulator. */
  async function townWithDisplay(code: string, st: string, phase: "day" | "night") {
    const town = await liveTown(code, st);
    useStorytellerStore.setState({ game: { ...store().game!, phase, day: 3 } });
    const screenUid = `${code}-display`;
    const token = await ensurePublicDisplayAccess(town.writer, code, town.session.id);
    deviceFor(screenUid);
    await authorizePublicDisplay(devices.get(screenUid)!, code, screenUid, token);
    await vi.waitFor(async () => expect(await town.stBackend.get(`lobbies/${code}/public`)).toMatchObject({ phase }), { timeout: 8000 });
    caller = screenUid;
    render(createElement(PublicDisplayScreen, { code }));
    await waitFor(() => expect(document.querySelector(".public-display, [class*='town']")).toBeTruthy(), { timeout: 8000 });
    caller = st;
    return { ...town, screenUid };
  }

  test("Declare Good at Day: the live display shows the result, the server holds winner=good, phones get only the player-safe result", async () => {
    const code = "P4E1AAAA", st = "p4e1-st", alice = "p4e1-alice";
    const { stBackend, writer, ids } = await townWithDisplay(code, st, "day");
    await knock(code, alice, "Alice");
    await seat(code, writer, alice, ids[0]!);
    caller = st;
    const result = await endGameWithIntent({ kind: "declare", winner: "good" });
    expect(result).toMatchObject({ ok: true });
    expect(store().game!.phase).toBe("ended");
    expect(store().game!.result).toMatchObject({ winner: "good" });
    expect(await stBackend.get(`lobbies/${code}/public/winner`)).toBe("good");
    expect(await stBackend.get(`lobbies/${code}/session`)).toMatchObject({ state: "ended" });
    await expect(screen.findByText("Good Wins", {}, { timeout: 8000 })).resolves.toBeTruthy();
    // Phone result: exactly the player-safe record; another uid cannot read it.
    const mine = await server(alice, `lobbies/${code}/results/${alice}`);
    expect(Object.keys(mine as object).sort()).toEqual(["declaredAt", "sessionId", "version", "winner"]);
    await expect(server("p4e1-other", `lobbies/${code}/results/${alice}`)).rejects.toThrow(denied);
  });

  test("Declare Evil at Night: the display shows Evil Wins and the ended public node still shows no life data", async () => {
    const code = "P4E2AAAA", st = "p4e2-st";
    const { stBackend } = await townWithDisplay(code, st, "night");
    caller = st;
    expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toMatchObject({ ok: true });
    expect(await stBackend.get(`lobbies/${code}/public/winner`)).toBe("evil");
    await expect(screen.findByText("Evil Wins", {}, { timeout: 8000 })).resolves.toBeTruthy();
    const keys = keysOf(await stBackend.get(`lobbies/${code}/public`));
    for (const life of ["alive", "ghostVote", "exiled"]) expect(keys.has(life), `ended-at-Night public must not carry "${life}"`).toBe(false);
  });

  test("End Without Result: the display shows the neutral ended scene and no winner is ever written", async () => {
    const code = "P4E3AAAA", st = "p4e3-st";
    const { stBackend } = await townWithDisplay(code, st, "day");
    caller = st;
    expect(await endGameWithIntent({ kind: "noResult" })).toMatchObject({ ok: true });
    expect(await stBackend.get(`lobbies/${code}/public/winner`)).toBeUndefined();
    await expect(screen.findByText("Game Ended", {}, { timeout: 8000 })).resolves.toBeTruthy();
    expect(screen.queryByText("Good Wins")).toBeNull();
    expect(screen.queryByText("Evil Wins")).toBeNull();
  });

  test("a device that tries to enroll after the game has ended cannot read the final record", async () => {
    const code = "P4E4AAAA", st = "p4e4-st";
    const { stBackend, writer, session } = await liveTown(code, st);
    useStorytellerStore.setState({ game: { ...store().game!, phase: "day", day: 2 } });
    const token = await ensurePublicDisplayAccess(writer, code, session.id);
    caller = st;
    expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: true });
    expect(await stBackend.get(`lobbies/${code}/public/winner`)).toBe("good");
    // The late device cannot enroll any more (the session is over) and so cannot read; a device enrolled earlier could.
    const late = deviceFor("p4e4-late");
    await authorizePublicDisplay(late, code, "p4e4-late", token).catch(() => {});
    await expect(late.get(`lobbies/${code}/public`)).rejects.toThrow(denied);
  });
});
