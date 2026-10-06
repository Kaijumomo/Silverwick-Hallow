// @vitest-environment jsdom
// R3-CLOSURE-001 (Sol R3.2): the irreversible public/status = "ended" boundary
// is WRITER-LIFETIME knowledge. Once ANY close() attempt has tried to write
// that signal, every later close failure -- including a retry that fails in
// its terminal preflight -- stays fail-closed and terminal-only: the writer
// stays closing, the session's closing gate stays shut, no ordinary projection
// is scheduled, no renewal-driven live path resumes and no deferred join
// re-sync runs. A FIRST-EVER pre-signal failure still reopens (PR-10H-001).
//
// Multi-attempt sequences through the real lifecycle hook, the real
// SessionWriter, endGameWithIntent and MemoryRoomBackend. The enforced-rules
// counterparts live in phase10hRules.spec.ts.
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
const writerOf = () => useSessionRuntime.getState().backend as SessionWriter;
const denied = () => Object.assign(new Error("PERMISSION_DENIED: refused"), { code: "PERMISSION_DENIED" });
const settle = (ms = 400) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  code = `LTCH${["BCDF", "GHJK", "MNPQ", "RSTV", "WXYZ", "BDFH", "JKMN", "PQRS", "TVWX", "YZBC", "CDFG", "HJKM", "NPQR", "STVW", "XYZB", "BCDG", "GHJM", "MNPR", "RSTW", "WXYB"][counter++ % 20]}`;
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

type Op = { kind: "get" | "update"; paths: string[] };
const PREFLIGHT_READS = ["storytellerUid", "roster", "rosterParticipants"] as const;
type PreflightRead = typeof PREFLIGHT_READS[number];

/** A live Day with two phone-bound participants, every get/update logged in
 * order, and switchable failures:
 *  - preflight: the terminal builder's read of that node fails (only while a
 *    terminal close is in flight -- ordinary flushes also read the roster);
 *  - joinsDuringPreflight: remote join-request writes made inside that failing
 *    read (i.e. while the close is in flight);
 *  - finalCommit: the final terminal commit is rejected;
 *  - loseSignalResponse / loseFinalResponse: the write lands, its response is
 *    lost (once). */
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
  });
  st().setLobby({ code, uid: "host", sessionId: session.id, status: "live" });
  renderHook(() => useStorytellerSync(b));
  await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
  const ops: Op[] = [];
  const fail = {
    preflight: null as PreflightRead | null,
    joinsDuringPreflight: [] as Record<string, Json>[],
    finalCommit: false, loseSignalResponse: false, loseFinalResponse: false,
  };
  const get = b.get.bind(b);
  const update = b.update.bind(b);
  b.get = async (path) => {
    ops.push({ kind: "get", paths: [path] });
    if (fail.preflight && st().terminalClose?.status === "closing" && path === `${root}/${fail.preflight}`) {
      for (const join of fail.joinsDuringPreflight.splice(0)) { await update(join); await new Promise((resolve) => setTimeout(resolve, 0)); }
      throw denied();
    }
    return get(path);
  };
  b.update = async (updates) => {
    ops.push({ kind: "update", paths: Object.keys(updates) });
    const keys = Object.keys(updates);
    const isSignal = keys.length === 2 && keys.includes(`${root}/public/status`);
    const isFinal = keys.includes(`${root}/session`);
    if (isFinal && fail.finalCommit) throw denied();
    await update(updates);
    if (isSignal && fail.loseSignalResponse) { fail.loseSignalResponse = false; throw new Error("unexpected response failure"); }
    if (isFinal && fail.loseFinalResponse) { fail.loseFinalResponse = false; throw new Error("unexpected response failure"); }
  };
  return { b, get, ops, fail, session, p0: p0!, p1: p1! };
}

const updatesSince = (ops: Op[], start: number) => ops.slice(start).filter(op => op.kind === "update");

/** The fail-closed, terminal-only state after a retry whose preflight failed
 * past an earlier signal attempt. A gameplay mutation and a remote join both
 * occur meanwhile; neither may reopen anything. */
async function expectTerminalOnly(ctx: Awaited<ReturnType<typeof goLive>>, start: number) {
  const { get, ops } = ctx;
  expect(writerOf().isClosing()).toBe(true);
  expect(writerOf().isStopped()).toBe(false);
  // Gameplay is released locally (the failed intent is retryable), but no
  // ordinary projection is scheduled or attempted.
  const victim = game().seatOrder[3]!;
  expect(st().recordDeath(victim)).toMatchObject({ ok: true });
  await settle();
  expect(updatesSince(ops, start)).toEqual([]);
  expect(await get(`${root}/storyteller/players/${victim}/alive`)).toBe(true);
  // The ordinary writer path itself refuses.
  await expect(writerOf().update({ [`${root}/public/phase`]: "night" })).rejects.toThrow(/closing/);
  // Server: still the half-way terminal state, never a projection over it.
  expect((await get(`${root}/session`) as { state: string }).state).toBe("active");
  expect(await get(`${root}/public/status`)).toBe("ended");
  expect(await get(`${root}/results`)).toBeUndefined();
  // No deferred join re-sync: a join that appeared during the retry stays out
  // of the local queue, and nothing was seated.
  expect(game().pendingPlayers["uid-dave"]).toBeUndefined();
  expect(game().pendingPlayers["uid-erin"]).toBeUndefined();
  expect(await get(`${root}/roster`)).toEqual({ "uid-alice": game().seatOrder[0], "uid-bob": game().seatOrder[1] });
}

async function expectGoodEnded(ctx: Awaited<ReturnType<typeof goLive>>) {
  const expected = { version: 1, sessionId: ctx.session.id, winner: "good", declaredAt: { phase: "day", day: 3 } };
  expect(await ctx.get(`${root}/session`)).toEqual({ version: 2, id: ctx.session.id, state: "ended" });
  expect(await ctx.get(`${root}/public/status`)).toBe("ended");
  expect(await ctx.get(`${root}/results`)).toEqual({ host: expected, "uid-alice": expected, "uid-bob": expected });
  expect(game().phase).toBe("ended");
  expect(game().result).toEqual({ winner: "good", declaredAt: { phase: "day", day: 3 } });
  expect(st().terminalClose).toBeNull();
  expect(st().lobby).toBeNull();
}

describe("R3-CLOSURE-001 Sequence A: signal landed -> final commit fails -> retry preflight fails -> recovery", () => {
  it.each(PREFLIGHT_READS)("retry fails on the %s read: still closing, no reopening, no re-sync; the repaired retry ends Good exactly once", async (read) => {
    const ctx = await goLive();
    const { fail, ops } = ctx;
    // 1. Preflight succeeds, the ended signal is accepted, the final commit is rejected.
    fail.finalCommit = true;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    expect(await ctx.get(`${root}/public/status`)).toBe("ended");
    expect((await ctx.get(`${root}/session`) as { state: string }).state).toBe("active");
    expect(writerOf().isClosing()).toBe(true);
    fail.finalCommit = false;
    // 2. Retry the retained Good intent; its preflight fails while remote joins arrive.
    fail.preflight = read;
    fail.joinsDuringPreflight = [{ [`${root}/joinRequests/uid-dave`]: "Dave" }, { [`${root}/joinRequests/uid-erin`]: "Erin" }];
    const start = ops.length;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    expect(fail.joinsDuringPreflight).toEqual([]); // the joins really happened during the retry
    expect(st().terminalClose).toMatchObject({ intent: { kind: "declare", winner: "good" }, status: "failed" });
    await expectTerminalOnly(ctx, start);
    // C. Repeated remote join changes after the failure: still no coalesced re-sync.
    await act(async () => {
      await ctx.b.update({ [`${root}/joinRequests/uid-dave`]: null });
      await ctx.b.update({ [`${root}/joinRequests/uid-frank`]: "Frank" });
    });
    await settle();
    expect(game().pendingPlayers["uid-frank"]).toBeUndefined();
    expect(updatesSince(ops, start).filter(op => !op.paths.includes(`${root}/joinRequests/uid-dave`) && !op.paths.includes(`${root}/joinRequests/uid-frank`))).toEqual([]);
    // 3. Repair and retry: ends Good, once.
    fail.preflight = null;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toEqual({ ok: true }); });
    await expectGoodEnded(ctx);
    expect(ops.filter(op => op.kind === "update" && op.paths.some(p => p.startsWith(`${root}/results/`)))).toHaveLength(2); // the rejected one + the one that landed
    // D. No deferred request resurrection after the terminal end.
    await settle();
    expect(game().pendingPlayers["uid-erin"]).toBeUndefined();
    expect(game().pendingPlayers["uid-frank"]).toBeUndefined();
  });
});

describe("R3-CLOSURE-001 Sequence B: signal response lost -> retry preflight fails -> recovery owns the outcome", () => {
  it("stays fail-closed after the lost signal response; a later landed-but-lost final commit is then retained against a different retry (ASTRA-10H-004)", async () => {
    const ctx = await goLive();
    const { fail, ops } = ctx;
    // 1. The ended signal reaches the server; its response is lost.
    fail.loseSignalResponse = true;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    expect(await ctx.get(`${root}/public/status`)).toBe("ended");
    expect(writerOf().isClosing()).toBe(true);
    // 2. Retry; its preflight fails while a join arrives.
    fail.preflight = "rosterParticipants";
    fail.joinsDuringPreflight = [{ [`${root}/joinRequests/uid-dave`]: "Dave" }];
    const start = ops.length;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    await expectTerminalOnly(ctx, start);
    // No projection ever tried to replace public (which would drop the ended mark).
    expect(updatesSince(ops, 0).filter(op => op.paths.includes(`${root}/public`))).toEqual([]);
    // 3. The final commit lands but its response is lost.
    fail.preflight = null;
    fail.loseFinalResponse = true;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    const published = await ctx.get(`${root}/results`);
    // 4. A DIFFERENT retry intent: the read-back keeps the committed Good.
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toEqual({ ok: true }); });
    expect(await ctx.get(`${root}/results`)).toEqual(published);
    await expectGoodEnded(ctx);
  });
});

describe("R3-CLOSURE-001 Sequence C: a FIRST-EVER pre-signal failure still reopens (PR-10H-001 preserved)", () => {
  it("writer reopens, gameplay syncs, the join is re-synced exactly once and never seated; the later retry ends Good", async () => {
    const ctx = await goLive();
    const { fail, ops } = ctx;
    const daveAdds = { count: 0 };
    const off = useStorytellerStore.subscribe((s, prev) => {
      if (s.game?.pendingPlayers["uid-dave"] && !prev.game?.pendingPlayers["uid-dave"]) daveAdds.count++;
    });
    fail.preflight = "roster";
    fail.joinsDuringPreflight = [{ [`${root}/joinRequests/uid-dave`]: "Dave" }];
    const start = ops.length;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    // No signal was ever attempted by this writer.
    expect(updatesSince(ops, start).filter(op => op.paths.includes(`${root}/public/status`))).toEqual([]);
    expect(writerOf().isClosing()).toBe(false);
    expect(await ctx.get(`${root}/public/status`)).not.toBe("ended");
    // Ordinary synchronized gameplay resumes.
    const victim = game().seatOrder[3]!;
    expect(st().recordDeath(victim)).toMatchObject({ ok: true });
    await waitFor(async () => expect(await ctx.get(`${root}/storyteller/players/${victim}/alive`)).toBe(false));
    // A. The join seen during the failed close is re-synced exactly once, not seated.
    await waitFor(() => expect(game().pendingPlayers["uid-dave"]).toBeTruthy());
    await settle();
    expect(daveAdds.count).toBe(1);
    expect(game().seatOrder.some(id => game().players[id]!.name === "Dave")).toBe(false);
    expect(await ctx.get(`${root}/roster/uid-dave`)).toBeUndefined();
    off();
    // The later terminal retry succeeds.
    fail.preflight = null;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toEqual({ ok: true }); });
    await expectGoodEnded(ctx);
  });
});

// ---------------------------------------------------------------------------
// The SessionWriter alone: the latch survives close() invocations and gates
// the renewal cadence and the ordinary write path.
describe("R3-CLOSURE-001: SessionWriter lifetime latch", () => {
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

  it("after a signal attempt, a later close() that fails in its preflight keeps closing, refuses writes and does NOT restart renewal; a retry re-sends the signal and completes", async () => {
    const { b, writer, session } = await startedWriter();
    const update = b.update.bind(b);
    let denyFinal = true;
    const signals: number[] = [];
    b.update = async (updates) => {
      const keys = Object.keys(updates);
      if (keys.length === 2 && keys.includes(`${root}/public/status`)) signals.push((updates[`${root}/writeGuard`] as { revision: number }).revision);
      if (denyFinal && keys.includes(`${root}/session`)) throw denied();
      return update(updates);
    };
    await expect(writer.close([], terminalPublication(code, session.id, good, finalGame))).rejects.toThrow(/PERMISSION_DENIED/);
    expect(writer.isClosing()).toBe(true);
    expect(signals).toHaveLength(1);
    denyFinal = false;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await expect(writer.close([], async () => { throw new Error("read failed"); })).rejects.toThrow("read failed");
    expect(writer.isClosing()).toBe(true);
    await expect(writer.update({ [`${root}/public/phase`]: "night" })).rejects.toThrow(/closing/);
    const lease = (await b.get(`${root}/writer`)) as { expiresAt: number };
    await vi.advanceTimersByTimeAsync(LEASE_MS / 3 + 5);
    expect(((await b.get(`${root}/writer`)) as { expiresAt: number }).expiresAt).toBe(lease.expiresAt); // no renewal cadence
    vi.useRealTimers();
    expect(await b.get(`${root}/public/status`)).toBe("ended");
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("active");
    // The latch never suppresses a retry's own signal: it is re-sent, with a higher revision.
    await writer.close([], terminalPublication(code, session.id, good, finalGame));
    expect(signals).toHaveLength(2);
    expect(signals[1]!).toBeGreaterThan(signals[0]!);
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(Object.keys((await b.get(`${root}/results`)) as object).sort()).toEqual(["host", "uid-alice"]);
    await writer.dispose();
  });

  it("End Without Result: its early signal also sets the latch -- a later failure never reopens (unchanged fail-closed behavior)", async () => {
    const { b, writer } = await startedWriter();
    const update = b.update.bind(b);
    b.update = async (updates) => { if (Object.keys(updates).includes(`${root}/session`)) throw denied(); return update(updates); };
    await expect(writer.close([])).rejects.toThrow(/PERMISSION_DENIED/);
    expect(writer.isClosing()).toBe(true);
    await expect(writer.close([], async () => { throw new Error("read failed"); })).rejects.toThrow("read failed");
    expect(writer.isClosing()).toBe(true);
    await writer.dispose();
  });
});
