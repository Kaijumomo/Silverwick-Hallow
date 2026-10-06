// @vitest-environment jsdom
// PR-10H-004 (Sol R3 addendum): a failed Finish Game always retries through the
// SAME terminal seam -- endGameWithIntent(retained intent) -- and never falls
// back to a generic multiplayer close that would end the session without the
// declared result and its read-back.
//
// Driven through the real ConnectionStatus control, the real lifecycle hook,
// the real SessionWriter and the real player handshake (MemoryRoomBackend).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useStorytellerStore, type TerminalIntent } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { withRevealTokens } from "@/stores/revealTokens";
import type { RoomBackend } from "./backend";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { closeMultiplayerSession, FINISH_GAME_PENDING, useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { endGameWithIntent } from "./terminal";
import { startPlayerHandshake } from "./playerSync";
import { ConnectionStatus } from "./StorytellerSession";
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
const runtime = () => useSessionRuntime.getState();
const denied = () => Object.assign(new Error("PERMISSION_DENIED: refused"), { code: "PERMISSION_DENIED" });

beforeEach(() => {
  code = `RTRY${["BCDF", "GHJK", "MNPQ", "RSTV", "WXYZ", "BDFH", "JKMN", "PQRS", "TVWX", "YZBC", "CDFG", "HJKM", "NPQR", "STVW", "XYZB", "BCDG", "GHJM", "MNPR", "RSTW", "WXYB"][counter++ % 20]}`;
  root = `lobbies/${code}`;
  localStorage.clear();
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "game", terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null, revealAcks: {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); firebase.backend = null; vi.restoreAllMocks(); });

function liveGame(phase: "day" | "setup" = "day"): StorytellerLobbyRecord {
  const g = setupGame(ROLES, phase === "day" ? { phase: "day", day: 3, setupRolesDealt: true, setupRolesRevealed: true } : { phase: "setup", day: 0 });
  for (const p of Object.values(g.players)) {
    p.actualAlignment = registry.alignmentOf(p.actualRole);
    p.shownRole = p.actualRole === "drunk" ? "chef" : p.actualRole;
  }
  return withRevealTokens(null, g, registry);
}

type Op = { kind: "get" | "update"; paths: string[] };
/** Live multiplayer with two bound phones (Alice is also a real player
 * handshake), every get/update logged, and switchable failures. */
async function goLive(phase: "day" | "setup" = "day") {
  const b = new MemoryRoomBackend();
  firebase.backend = b;
  useStorytellerStore.setState({ game: liveGame(phase) });
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
  await waitFor(() => expect(runtime().status).toBe("live"));
  const ops: Op[] = [];
  const fail = { preflight: false, finalCommit: false, loseFinalResponse: false, readBack: false };
  const get = b.get.bind(b);
  const update = b.update.bind(b);
  b.get = async (path) => {
    ops.push({ kind: "get", paths: [path] });
    if (fail.preflight && st().terminalClose?.status === "closing" && path === `${root}/roster`) throw denied();
    if (fail.readBack && path === `${root}/results`) throw denied();
    return get(path);
  };
  b.update = async (updates) => {
    ops.push({ kind: "update", paths: Object.keys(updates) });
    const ending = Object.keys(updates).includes(`${root}/session`);
    if (ending && fail.finalCommit) throw denied();
    await update(updates);
    if (ending && fail.loseFinalResponse) { fail.loseFinalResponse = false; throw new Error("unexpected response failure"); }
  };
  return { b, get, ops, fail, session, p0: p0!, p1: p1! };
}

function seatAlice(b: MemoryRoomBackend) {
  usePlayerStore.getState().setSession({ code, uid: "uid-alice", requestedName: "Alice" });
  return startPlayerHandshake(b, code, "uid-alice");
}

/** Every update that ended the session also carried the expected results:
 * no generic (result-less) close ever ended it. */
function sessionEnds(ops: Op[]) {
  return ops.filter(op => op.kind === "update" && op.paths.includes(`${root}/session`));
}

describe("PR-10H-004: the ConnectionStatus retry goes through endGameWithIntent with the retained intent", () => {
  it.each(["good", "evil"] as const)("declared %s + preflight failure: Retry finishing game publishes the SAME result to the session, receipt, phones and local game", async (winner) => {
    const { b, get, ops, fail, session, p0 } = await goLive();
    await waitFor(() => expect(get(`${root}/player/${p0}`)).resolves.toBeTruthy());
    const stopAlice = seatAlice(b);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("seated"));
    fail.preflight = true;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner })).toMatchObject({ ok: false }); });
    expect(st().terminalClose).toMatchObject({ intent: { kind: "declare", winner }, status: "failed" });
    expect(runtime().closeFailed).toBe(true);
    expect((await get(`${root}/session`) as { state: string }).state).toBe("active");

    render(<ConnectionStatus />);
    expect(screen.queryByRole("button", { name: "Try ending again" })).toBeNull();
    const retry = screen.getByRole("button", { name: "Retry finishing game" });
    fail.preflight = false;
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(game().phase).toBe("ended"));

    const expected = { version: 1, sessionId: session.id, winner, declaredAt: { phase: "day", day: 3 } };
    expect(await get(`${root}/session`)).toEqual({ version: 2, id: session.id, state: "ended" });
    expect(await get(`${root}/results`)).toEqual({ host: expected, "uid-alice": expected, "uid-bob": expected });
    expect(game().result).toEqual({ winner, declaredAt: { phase: "day", day: 3 } });
    expect(st().lobby).toBeNull();
    expect(st().terminalClose).toBeNull();
    // The player's own validated result is the same declared winner.
    await waitFor(() => expect(usePlayerStore.getState().terminalResult).toEqual({ status: "ready", result: { winner, declaredAt: { phase: "day", day: 3 } } }));
    // No generic no-result close: exactly one session end, and it carried the results.
    expect(sessionEnds(ops)).toHaveLength(1);
    expect(sessionEnds(ops)[0]!.paths).toEqual(expect.arrayContaining([`${root}/results/host`, `${root}/results/uid-alice`, `${root}/results/uid-bob`]));
    stopAlice();
  });

  it("End Without Result: a failed close retries as End Without Result -- session and local game both complete with no result", async () => {
    const { get, ops, fail } = await goLive();
    fail.finalCommit = true;
    await act(async () => { expect(await endGameWithIntent({ kind: "noResult" })).toMatchObject({ ok: false }); });
    expect(st().terminalClose).toMatchObject({ intent: { kind: "noResult" }, status: "failed" });
    expect(game().phase).toBe("day");
    render(<ConnectionStatus />);
    fail.finalCommit = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry finishing game" })); });
    await waitFor(() => expect(game().phase).toBe("ended"));
    expect((await get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(await get(`${root}/results`)).toBeUndefined();
    expect(game()).not.toHaveProperty("result");
    expect(st().terminalClose).toBeNull();
    expect(sessionEnds(ops).length).toBe(2); // the refused attempt + the retry; neither carried a result
    expect(sessionEnds(ops).every(op => !op.paths.some(p => p.includes("/results/")))).toBe(true);
  });
});

describe("PR-10H-004: lost-response recovery through the ConnectionStatus retry", () => {
  const CASES: { committed: TerminalIntent; retained: TerminalIntent; expected: { winner: "good" | "evil" } | null }[] = [
    { committed: { kind: "declare", winner: "good" }, retained: { kind: "declare", winner: "evil" }, expected: { winner: "good" } },
    { committed: { kind: "noResult" }, retained: { kind: "declare", winner: "evil" }, expected: null },
    { committed: { kind: "declare", winner: "evil" }, retained: { kind: "noResult" }, expected: { winner: "evil" } },
  ];
  it.each(CASES)("committed $committed.kind/$committed.winner, retained $retained.kind/$retained.winner: the read-back owns the outcome", async ({ committed, retained, expected }) => {
    const { get, ops, fail } = await goLive();
    // 1. The committed terminal close lands; its response is lost.
    fail.loseFinalResponse = true;
    await act(async () => { expect(await endGameWithIntent(committed)).toMatchObject({ ok: false }); });
    const published = await get(`${root}/results`);
    // 2. A later attempt with a DIFFERENT intent fails before its read-back
    //    completes, so the retained intent now differs from what was committed.
    fail.readBack = true;
    await act(async () => { expect(await endGameWithIntent(retained)).toMatchObject({ ok: false }); });
    expect(st().terminalClose).toMatchObject({ intent: retained, status: "failed" });
    expect(game().phase).toBe("day");
    // 3. The banner retries the retained intent through the terminal seam.
    render(<ConnectionStatus />);
    fail.readBack = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry finishing game" })); });
    await waitFor(() => expect(game().phase).toBe("ended"));
    if (expected) expect(game().result).toEqual({ ...expected, declaredAt: { phase: "day", day: 3 } });
    else expect(game()).not.toHaveProperty("result");
    expect(await get(`${root}/results`)).toEqual(published); // nothing rewritten or substituted
    expect(sessionEnds(ops)).toHaveLength(1);
    expect(st().lobby).toBeNull();
  });
});

describe("PR-10H-004: generic closes and the defense-in-depth boundary", () => {
  it("a non-terminal close failure (no Finish Game intent) keeps the generic Try ending again -> closeMultiplayerSession", async () => {
    const { get, fail } = await goLive();
    fail.finalCommit = true;
    await act(async () => { await expect(closeMultiplayerSession()).rejects.toBeTruthy(); });
    expect(st().terminalClose).toBeNull();
    expect(runtime().closeFailed).toBe(true);
    render(<ConnectionStatus />);
    expect(screen.queryByRole("button", { name: "Retry finishing game" })).toBeNull();
    fail.finalCommit = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try ending again" })); });
    await waitFor(() => expect(st().lobby).toBeNull());
    // Generic semantics: the lobby ends with no result; the local game is NOT finished.
    expect((await get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(await get(`${root}/results`)).toBeUndefined();
    expect(game().phase).toBe("day");
  });

  it.each(["failed", "closing"] as const)("a bare closeMultiplayerSession() is refused while a Finish Game intent is %s: no teardown, no detach, no divergence", async (status) => {
    const { get, ops, fail } = await goLive();
    let release!: () => void;
    let pending: Promise<unknown> | undefined;
    if (status === "failed") {
      fail.preflight = true;
      await act(async () => { await endGameWithIntent({ kind: "declare", winner: "good" }); });
      fail.preflight = false;
    } else {
      // Hold the terminal close in flight at its preflight read.
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const baseGet = get;
      (firebase.backend as MemoryRoomBackend).get = async (path) => {
        if (path === `${root}/rosterParticipants` && st().terminalClose?.status === "closing") await gate;
        return baseGet(path);
      };
      act(() => { pending = endGameWithIntent({ kind: "declare", winner: "good" }); });
      await waitFor(() => expect(st().terminalClose?.status).toBe("closing"));
    }
    const before = { lobby: st().lobby, game: game(), terminalClose: st().terminalClose, closeFailed: runtime().closeFailed, errors: runtime().errors };
    const start = ops.length;
    await expect(closeMultiplayerSession()).rejects.toThrow(FINISH_GAME_PENDING);
    expect(ops.slice(start).filter(op => op.kind === "update")).toEqual([]);
    expect((await get(`${root}/session`) as { state: string }).state).toBe("active");
    expect(await get(`${root}/results`)).toBeUndefined();
    expect(st().lobby).toBe(before.lobby);
    expect(game()).toBe(before.game);
    expect(st().terminalClose).toBe(before.terminalClose);
    expect(runtime().closeFailed).toBe(before.closeFailed);
    expect(runtime().errors).toBe(before.errors);
    if (status === "closing") {
      release();
      await act(async () => { await pending; });
      expect(game().result?.winner).toBe("good");
      expect((await get(`${root}/results/uid-alice`) as { winner: string }).winner).toBe("good");
    }
  });

  it("Setup discard keeps its generic close (no Finish Game intent exists in Setup)", async () => {
    const { get } = await goLive("setup");
    expect(st().terminalClose).toBeNull();
    await act(async () => { await closeMultiplayerSession(); st().endGame(); });
    expect((await get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(await get(`${root}/results`)).toBeUndefined();
    expect(st().game).toBeNull();
  });

  it("a failed Finish Game intent ends with its game: New Game / End Game drop it, so it is never retried against another game", async () => {
    useStorytellerStore.setState({ game: liveGame(), lobby: null });
    st().beginTerminalClose({ kind: "declare", winner: "evil" });
    st().failTerminalClose("could not end");
    st().newGame(setupScript.id, { plannedPlayerCount: 5 });
    expect(st().terminalClose).toBeNull();
    useStorytellerStore.setState({ game: liveGame() });
    st().beginTerminalClose({ kind: "noResult" });
    st().failTerminalClose("could not end");
    st().endGame();
    expect(st().terminalClose).toBeNull();
    // An IN-FLIGHT close is never dropped by a lifecycle call.
    useStorytellerStore.setState({ game: liveGame() });
    st().beginTerminalClose({ kind: "declare", winner: "good" });
    st().endGame();
    expect(st().terminalClose).toMatchObject({ status: "closing" });
  });
});
