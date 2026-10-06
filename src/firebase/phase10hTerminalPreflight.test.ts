// @vitest-environment jsdom
// PR-10H-001 (Sol R3): a declared-result terminal close completes ALL of its
// fallible terminal-publication reads (storytellerUid, roster,
// rosterParticipants) and their validation BEFORE the irreversible
// public/status = "ended" signal. A preflight failure writes nothing terminal,
// keeps the session and the local game live, and returns the writer -- and the
// session-local closing gate -- to live, retryable operation.
//
// Deterministic failure sequencing through the real lifecycle hook, the real
// SessionWriter and MemoryRoomBackend. The enforced-rules counterparts live in
// phase10hRules.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { withRevealTokens } from "@/stores/revealTokens";
import type { Json, RoomBackend } from "./backend";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { endGameWithIntent } from "./terminal";
import { terminalPublication } from "./terminalResults";
import { LEASE_MS, SessionWriter } from "./writer";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "@/stores/types";

const firebase = vi.hoisted(() => ({ backend: null as RoomBackend | null }));
vi.mock("./session", () => ({
  connectFirebase: async () => {
    if (!firebase.backend) throw new Error("Firebase is not configured.");
    return { backend: firebase.backend, uid: "host" };
  },
}));

const registry = buildRegistry(setupScript);
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];
let counter = 0;
let code = "";
let root = "";
const st = () => useStorytellerStore.getState();
const game = () => st().game!;
const runtimeWriter = () => useSessionRuntime.getState().backend as SessionWriter;

beforeEach(() => {
  code = `PREF${["BCDF", "GHJK", "MNPQ", "RSTV", "WXYZ", "BDFH", "JKMN", "PQRS", "TVWX", "YZBC", "CDFG", "HJKM", "NPQR", "STVW", "XYZB", "BCDG", "GHJM", "MNPR", "RSTW", "WXYB"][counter++ % 20]}`;
  root = `lobbies/${code}`;
  localStorage.clear();
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "game", terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null, revealAcks: {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); firebase.backend = null; vi.useRealTimers(); vi.restoreAllMocks(); });

function liveGame(): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "day", day: 3, setupRolesDealt: true, setupRolesRevealed: true });
  for (const p of Object.values(g.players)) {
    p.actualAlignment = registry.alignmentOf(p.actualRole);
    p.shownRole = p.actualRole === "drunk" ? "chef" : p.actualRole;
  }
  return withRevealTokens(null, g, registry);
}

/** One recorded backend operation, in issue order. */
type Op = { kind: "get" | "update"; paths: string[] };

/** A live multiplayer Day with two phone-bound participants (Alice, Bob), a
 * waiting join request (Carol) and Alice's reveal acknowledgement, through the
 * app's own lifecycle hook. Every get/update is logged in order. */
async function goLive() {
  const b = new MemoryRoomBackend();
  firebase.backend = b;
  useStorytellerStore.setState({ game: liveGame() });
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const [p0, p1] = game().seatOrder;
  await b.update({
    [`${root}/roster/uid-alice`]: p0!, [`${root}/roster/uid-bob`]: p1!,
    [`${root}/rosterParticipants/uid-alice`]: { playerId: p0!, participantId: game().players[p0!]!.participantId!, name: "Alice" },
    [`${root}/rosterParticipants/uid-bob`]: { playerId: p1!, participantId: game().players[p1!]!.participantId!, name: "Bob" },
    [`${root}/joinRequests/uid-carol`]: "Carol",
  });
  st().setLobby({ code, uid: "host", sessionId: session.id, status: "live" });
  const hook = renderHook(() => useStorytellerSync(b));
  await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
  await act(async () => { await b.set(`${root}/revealAcks/uid-alice`, game().players[p0!]!.revealToken!); });
  const ops: Op[] = [];
  const get = b.get.bind(b);
  const update = b.update.bind(b);
  b.get = async (path) => { ops.push({ kind: "get", paths: [path] }); return get(path); };
  b.update = async (updates) => { ops.push({ kind: "update", paths: Object.keys(updates) }); return update(updates); };
  return { b, get, update, ops, session, hook, p0: p0!, p1: p1! };
}

type Failure = { name: string; path: (code: string) => string; respond: () => Promise<unknown> };
const denied = () => Promise.reject(Object.assign(new Error("PERMISSION_DENIED: read refused"), { code: "PERMISSION_DENIED" }));
const FAILURES: Failure[] = [
  { name: "storytellerUid read fails", path: (c) => `lobbies/${c}/storytellerUid`, respond: denied },
  { name: "storytellerUid decodes invalid", path: (c) => `lobbies/${c}/storytellerUid`, respond: async () => 42 },
  { name: "roster read fails", path: (c) => `lobbies/${c}/roster`, respond: denied },
  { name: "roster decodes invalid", path: (c) => `lobbies/${c}/roster`, respond: async () => ({ "uid-alice": 7 }) },
  { name: "rosterParticipants read fails", path: (c) => `lobbies/${c}/rosterParticipants`, respond: denied },
  { name: "rosterParticipants decodes invalid", path: (c) => `lobbies/${c}/rosterParticipants`, respond: async () => ({ "uid-alice": { playerId: 3 } }) },
];

/** Injects one failure into the terminal builder's read of `path`. The
 * runtime writer's own projection flushes also read the roster, so only reads
 * made while armed AND while a terminal close is in flight fail. */
function inject(b: MemoryRoomBackend, failure: Failure) {
  const get = b.get.bind(b);
  const state = { armed: false, hits: 0 };
  b.get = async (path) => {
    if (state.armed && st().terminalClose?.status === "closing" && path === failure.path(code)) { state.hits++; return failure.respond(); }
    return get(path);
  };
  return state;
}

async function expectNothingTerminal(read: (path: string) => Promise<unknown>, sessionId: string) {
  const b = { get: read };
  expect(await b.get(`${root}/session`)).toEqual({ version: 2, id: sessionId, state: "active" });
  expect(await b.get(`${root}/public/status`)).not.toBe("ended");
  expect(await b.get(`${root}/results`)).toBeUndefined();
  // No roster / player / checkpoint / revealAcks teardown.
  expect(await b.get(`${root}/roster`)).toEqual({ "uid-alice": game().seatOrder[0], "uid-bob": game().seatOrder[1] });
  expect(await b.get(`${root}/rosterParticipants`)).toBeTruthy();
  expect(await b.get(`${root}/joinRequests/uid-carol`)).toBe("Carol");
  expect(await b.get(`${root}/player`)).toBeTruthy();
  expect(await b.get(`${root}/storyteller`)).toBeTruthy();
  expect(await b.get(`${root}/checkpoint`)).toBeTruthy();
  expect(await b.get(`${root}/revealAcks/uid-alice`)).toBeTruthy();
}

describe("PR-10H-001: a failed declared-result preflight writes nothing terminal and the writer resumes live", () => {
  it.each(FAILURES)("$name: session active, no ended signal, no results, no teardown; gameplay syncs; retry closes exactly once", async (failure) => {
    const { b, get, ops, session } = await goLive();
    const injected = inject(b, failure);
    const before = game();
    injected.armed = true;
    const start = ops.length;
    let outcome: Awaited<ReturnType<typeof endGameWithIntent>> | undefined;
    await act(async () => { outcome = await endGameWithIntent({ kind: "declare", winner: "good" }); });
    expect(injected.hits).toBe(1);
    expect(outcome).toMatchObject({ ok: false, message: expect.stringMatching(/still live/) });
    // Not one write was issued by the failed close: no public signal, no commit.
    expect(ops.slice(start).filter(op => op.kind === "update")).toEqual([]);
    await expectNothingTerminal(get, session.id);
    // The local game stays live and unchanged; the intent is kept for retry.
    expect(game()).toBe(before);
    expect(game().phase).toBe("day");
    expect(st().lobby).not.toBeNull();
    expect(st().terminalClose).toMatchObject({ status: "failed", intent: { kind: "declare", winner: "good" } });
    // The writer left closing mode and still holds the lobby.
    const writer = runtimeWriter();
    expect(writer.isClosing()).toBe(false);
    expect(writer.isStopped()).toBe(false);
    expect(useSessionRuntime.getState().status).toBe("live");
    // Ordinary synchronized gameplay resumes: a mutation reaches the server.
    const victim = game().seatOrder[3]!;
    expect(st().recordDeath(victim)).toMatchObject({ ok: true });
    await waitFor(async () => expect(await b.get(`${root}/storyteller/players/${victim}/alive`)).toBe(false));
    expect(await b.get(`${root}/public/status`)).not.toBe("ended");

    // Repair the injected failure and retry the same intent.
    injected.armed = false;
    const retryStart = ops.length;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toEqual({ ok: true }); });
    const expected = { version: 1, sessionId: session.id, winner: "good", declaredAt: { phase: "day", day: 3 } };
    expect(await b.get(`${root}/session`)).toEqual({ version: 2, id: session.id, state: "ended" });
    expect(await b.get(`${root}/public/status`)).toBe("ended");
    expect(await b.get(`${root}/results`)).toEqual({ host: expected, "uid-alice": expected, "uid-bob": expected });
    for (const torn of ["roster", "rosterParticipants", "joinRequests", "player", "storyteller", "checkpoint", "revealAcks", "leaveRequests", "membershipRevocations"]) {
      expect(await b.get(`${root}/${torn}`)).toBeUndefined();
    }
    // Exactly one terminal commit across both attempts, and one signal.
    const updates = ops.filter(op => op.kind === "update");
    expect(updates.filter(op => op.paths.includes(`${root}/session`))).toHaveLength(1);
    expect(updates.filter(op => op.paths.length === 2 && op.paths.includes(`${root}/public/status`))).toHaveLength(1);
    expect(ops.slice(retryStart).filter(op => op.kind === "update" && op.paths.some(p => p.startsWith(`${root}/results/`)))).toHaveLength(1);
    expect(game().phase).toBe("ended");
    expect(game().result).toEqual({ winner: "good", declaredAt: { phase: "day", day: 3 } });
    expect(game().players[victim]!.alive).toBe(false);
    expect(st().lobby).toBeNull();
    expect(st().terminalClose).toBeNull();
  });

  it("ordering: every builder read completes before the public signal, which is immediately followed by the one final commit", async () => {
    const { ops } = await goLive();
    const start = ops.length;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toEqual({ ok: true }); });
    const log = ops.slice(start);
    const at = (predicate: (op: Op) => boolean) => log.findIndex(predicate);
    const lastRead = Math.max(...["storytellerUid", "roster", "rosterParticipants"].map(suffix => at(op => op.kind === "get" && op.paths[0] === `${root}/${suffix}`)));
    const signal = at(op => op.kind === "update" && op.paths.length === 2 && op.paths.includes(`${root}/public/status`));
    const final = at(op => op.kind === "update" && op.paths.includes(`${root}/session`));
    expect(lastRead).toBeGreaterThanOrEqual(0);
    expect(signal).toBeGreaterThan(lastRead);
    expect(final).toBeGreaterThan(signal);
    // Between signal and final commit only the commit's own receipt check runs.
    expect(log.slice(signal + 1, final)).toEqual([{ kind: "get", paths: [`${root}/writeGuard`] }]);
    expect(log.slice(0, signal).filter(op => op.kind === "update")).toEqual([]);
  });

  it("End Without Result is unchanged: no builder reads, the signal still precedes the drain, the session ends with no result", async () => {
    const { b, ops } = await goLive();
    const start = ops.length;
    await act(async () => { expect(await endGameWithIntent({ kind: "noResult" })).toEqual({ ok: true }); });
    const log = ops.slice(start);
    expect(log.some(op => op.kind === "get" && [`${root}/storytellerUid`, `${root}/rosterParticipants`].includes(op.paths[0]!))).toBe(false);
    const firstUpdate = log.find(op => op.kind === "update");
    expect(firstUpdate?.paths.sort()).toEqual([`${root}/public/status`, `${root}/writeGuard`].sort());
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(await b.get(`${root}/results`)).toBeUndefined();
    expect(game().phase).toBe("ended");
    expect(game()).not.toHaveProperty("result");
  });

  it("End Without Result still works after a failed declared-result preflight", async () => {
    const { b } = await goLive();
    const injected = inject(b, FAILURES[2]!);
    injected.armed = true;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toMatchObject({ ok: false }); });
    await act(async () => { expect(await endGameWithIntent({ kind: "noResult" })).toEqual({ ok: true }); });
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(await b.get(`${root}/public/status`)).toBe("ended");
    expect(await b.get(`${root}/results`)).toBeUndefined();
    expect(game()).not.toHaveProperty("result");
  });

  it("a join request refused while the close was in flight is re-applied once the preflight fails", async () => {
    const { b, get, update } = await goLive();
    b.get = async (path) => {
      if (path === `${root}/roster` && st().terminalClose?.status === "closing") {
        await update({ [`${root}/joinRequests/uid-dave`]: "Dave" });
        await new Promise(resolve => setTimeout(resolve, 0));
        return denied();
      }
      return get(path);
    };
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    await waitFor(() => expect(game().pendingPlayers?.["uid-dave"]).toBeTruthy());
    expect(useSessionRuntime.getState().errors.requests).toBeUndefined();
  });

  it("lost-response recovery (ASTRA-10H-004) still retains the originally committed result after a preflight failure", async () => {
    const { b, update } = await goLive();
    const injected = inject(b, FAILURES[4]!);
    injected.armed = true;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toMatchObject({ ok: false }); });
    injected.armed = false;
    // The next attempt's final commit lands but its response is lost.
    let lose = true;
    b.update = async (updates) => {
      await update(updates);
      if (lose && Object.keys(updates).includes(`${root}/session`)) { lose = false; throw new Error("unexpected response failure"); }
    };
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toMatchObject({ ok: false }); });
    const published = await b.get(`${root}/results`);
    expect((published as Record<string, { winner: string }>).host.winner).toBe("evil");
    // A different retry selection keeps exactly what was committed.
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toEqual({ ok: true }); });
    expect(await b.get(`${root}/results`)).toEqual(published);
    expect(game().result?.winner).toBe("evil");
  });

  it("past the signal the close stays fail-closed: a failed final commit keeps the writer closing (retry only), then the retry closes once", async () => {
    const { b, update, ops } = await goLive();
    let deny = true;
    b.update = async (updates) => {
      ops.push({ kind: "update", paths: Object.keys(updates) });
      if (deny && Object.keys(updates).includes(`${root}/session`)) throw Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" });
      return update(updates);
    };
    const writer = runtimeWriter();
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    expect(await b.get(`${root}/public/status`)).toBe("ended");
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("active");
    expect(writer.isClosing()).toBe(true);
    await expect(writer.update({ [`${root}/public/phase`]: "night" } as Record<string, Json>)).rejects.toThrow(/closing/);
    deny = false;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toEqual({ ok: true }); });
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(Object.keys((await b.get(`${root}/results`)) as object).sort()).toEqual(["host", "uid-alice", "uid-bob"]);
  });
});

// ---------------------------------------------------------------------------
// The SessionWriter alone: the order of the signal relative to the queue drain,
// and the renewal cadence restored after a preflight failure.
describe("PR-10H-001: SessionWriter.close ordering and recovery", () => {
  async function startedWriter() {
    const b = new MemoryRoomBackend();
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    await b.update({
      [`${root}/roster/uid-alice`]: "p-a",
      [`${root}/rosterParticipants/uid-alice`]: { playerId: "p-a", participantId: "pt-a", name: "Alice" },
    });
    const writer = new SessionWriter(b, code, session.id);
    await writer.start();
    return { b, writer, session };
  }
  const finalGame = { players: { "p-a": { id: "p-a", isEmpty: false, participantId: "pt-a" } } } as unknown as StorytellerLobbyRecord;
  const good = { winner: "good" as const, declaredAt: { phase: "day" as const, day: 2 } };

  it("a declared result waits for the queue drain and the builder before the signal; End Without Result signals before the drain (unchanged)", async () => {
    for (const declared of [true, false]) {
      const { b, writer, session } = await startedWriter();
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let started!: () => void;
      const running = new Promise<void>(resolve => { started = resolve; });
      const inFlight = writer.runExclusive(async () => { started(); await held; });
      await running; // genuinely in flight (a queued, unstarted op is refused by closing)
      let built = false;
      const builder = terminalPublication(code, session.id, good, finalGame)!;
      const closing = writer.close([], declared ? async (raw) => { built = true; return builder(raw); } : undefined);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(await b.get(`${root}/public/status`)).toBe(declared ? undefined : "ended");
      expect(built).toBe(false);
      release();
      await inFlight;
      await closing;
      expect(built).toBe(declared);
      expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
      const record = { version: 1, sessionId: session.id, ...good };
      expect(await b.get(`${root}/results`)).toEqual(declared ? { host: record, "uid-alice": record } : undefined);
      await writer.dispose();
      code = `${code.slice(0, -1)}${declared ? "Z" : "Y"}`; root = `lobbies/${code}`;
    }
  });

  it("after a preflight failure the writer accepts writes again and its lease renewal cadence resumes", async () => {
    const { b, writer, session } = await startedWriter();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const leaseBefore = (await b.get(`${root}/writer`)) as { token: string; expiresAt: number };
    const builder = async () => { throw new Error("read failed"); };
    await expect(writer.close([], builder)).rejects.toThrow("read failed");
    expect(writer.isClosing()).toBe(false);
    expect(await b.get(`${root}/public/status`)).toBeUndefined();
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("active");
    // Writes are accepted again, fenced with the writer's next revision.
    await writer.update({ [`${root}/public/phase`]: "night" } as Record<string, Json>);
    expect(await b.get(`${root}/public/phase`)).toBe("night");
    expect((await b.get(`${root}/writeGuard`) as { token: string }).token).toBe(writer.token);
    // close() renewed once in its preflight; the interval now renews again.
    const leaseAfterClose = (await b.get(`${root}/writer`)) as { expiresAt: number };
    expect(leaseAfterClose.expiresAt).toBeGreaterThanOrEqual(leaseBefore.expiresAt);
    await vi.advanceTimersByTimeAsync(LEASE_MS / 3 + 5);
    const renewed = (await b.get(`${root}/writer`)) as { token: string; expiresAt: number };
    expect(renewed.token).toBe(writer.token);
    expect(renewed.expiresAt).toBeGreaterThan(leaseAfterClose.expiresAt);
    vi.useRealTimers();
    // And a corrected retry closes.
    await writer.close([], terminalPublication(code, session.id, good, finalGame));
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(writer.isStopped()).toBe(true);
    await writer.dispose();
  });
});
