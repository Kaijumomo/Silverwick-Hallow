// @vitest-environment jsdom
// Phase 10H, Slice 1: multiplayer terminal ordering, terminal recovery and the
// player-side reveal / acknowledgement / result flow, through the real
// lifecycle hook, the real SessionWriter and the real player handshake
// (MemoryRoomBackend; the enforced-rules counterparts live in
// phase10hRules.spec.ts).
// Traceability: 10H-AC-030, AC-031, AC-036..038, AC-048..052, AC-056..058.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore, migratePlayerState } from "@/stores/playerStore";
import { revealViewed } from "@/stores/revealTokens";
import { withRevealTokens } from "@/stores/revealTokens";
import type { RoomBackend } from "./backend";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { closeMultiplayerSession, useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { endGameWithIntent } from "./terminal";
import { acknowledgeReveal, startPlayerHandshake } from "./playerSync";
import { decodePlayerResult } from "./snapshots";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";

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

beforeEach(() => {
  code = `TERM${["BCDF", "GHJK", "MNPQ", "RSTV", "WXYZ", "BDFH", "JKMN", "PQRS", "TVWX", "YZBC", "CDFG", "HJKM", "NPQR", "STVW", "XYZB"][counter++ % 15]}`;
  root = `lobbies/${code}`;
  localStorage.clear();
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "game", terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null, revealAcks: {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); firebase.backend = null; vi.restoreAllMocks(); });

function liveGame(): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "day", day: 3, setupRolesDealt: true, setupRolesRevealed: true });
  for (const p of Object.values(g.players)) {
    p.actualAlignment = registry.alignmentOf(p.actualRole);
    p.shownRole = p.actualRole === "drunk" ? "chef" : p.actualRole;
  }
  return withRevealTokens(null, g, registry);
}

/** A live multiplayer Day with two phone-bound participants (Alice, Bob) and a
 * waiting join request (Carol), through the app's own lifecycle hook. */
async function goLive(b: MemoryRoomBackend) {
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
  return { session, hook, p0: p0!, p1: p1! };
}

// ---------------------------------------------------------------------------
describe("10H-AC-048 / AC-052: one terminal seam through the real live close", () => {
  it("Declare Good: results for coherent participants in the close commit; THEN detach, ended snapshot with result, Undo cleared", async () => {
    const b = new MemoryRoomBackend();
    const { session } = await goLive(b);
    await act(async () => { await b.set(`${root}/revealAcks/uid-alice`, game().players[game().seatOrder[0]!]!.revealToken!); });
    st().recordDeath(game().seatOrder[2]!);
    expect(st().undoStack.length).toBeGreaterThan(0);
    let outcome: Awaited<ReturnType<typeof endGameWithIntent>> | undefined;
    await act(async () => { outcome = await endGameWithIntent({ kind: "declare", winner: "good" }); });
    expect(outcome).toEqual({ ok: true });
    const expected = { version: 1, sessionId: session.id, winner: "good", declaredAt: { phase: "day", day: 3 } };
    expect(await b.get(`${root}/session`)).toEqual({ version: 2, id: session.id, state: "ended" });
    expect(await b.get(`${root}/results`)).toEqual({ "uid-alice": expected, "uid-bob": expected });
    expect(await b.get(`${root}/revealAcks`)).toBeUndefined();
    expect(st().lobby).toBeNull();
    expect(game().phase).toBe("ended");
    expect(game().result).toEqual({ winner: "good", declaredAt: { phase: "day", day: 3 } });
    expect(st().undoStack).toEqual([]);
    expect(st().terminalClose).toBeNull();
  });

  it("End Without Result: the same seam ends the session and publishes NO result", async () => {
    const b = new MemoryRoomBackend();
    await goLive(b);
    await act(async () => { expect(await endGameWithIntent({ kind: "noResult" })).toEqual({ ok: true }); });
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
    expect(await b.get(`${root}/results`)).toBeUndefined();
    expect(game().phase).toBe("ended");
    expect(game()).not.toHaveProperty("result");
  });
});

describe("10H-AC-049 / AC-051: remote failure leaves the game live and retryable; mutations lock only while in flight", () => {
  it("a failed terminal commit: local game live and unchanged, lock released, same intent retries successfully", async () => {
    const b = new MemoryRoomBackend();
    const { session } = await goLive(b);
    const update = b.update.bind(b);
    let deny = true;
    b.update = async (updates) => {
      if (deny && Object.keys(updates).includes(`${root}/session`)) throw Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" });
      return update(updates);
    };
    const before = game();
    let outcome: Awaited<ReturnType<typeof endGameWithIntent>> | undefined;
    await act(async () => { outcome = await endGameWithIntent({ kind: "declare", winner: "evil" }); });
    expect(outcome).toMatchObject({ ok: false });
    expect(game()).toBe(before);
    expect(game().phase).toBe("day");
    expect(st().lobby).not.toBeNull();
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("active");
    expect(await b.get(`${root}/results`)).toBeUndefined();
    expect(st().terminalClose).toMatchObject({ status: "failed", intent: { kind: "declare", winner: "evil" } });
    // Mutation is restored after the failure.
    expect(st().recordDeath(game().seatOrder[3]!)).toMatchObject({ ok: true });
    // Retry exactly as the app does: End again re-enters the same live
    // session's authoritative close (no session restart), with the same intent.
    deny = false;
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toEqual({ ok: true }); });
    expect((await b.get(`${root}/results/uid-alice`) as { winner: string }).winner).toBe("evil");
    expect((await b.get(`${root}/session`) as { id: string }).id).toBe(session.id);
    expect(game().result?.winner).toBe("evil");
  });

  it("while the close is in flight every gameplay mutation is dropped; the ended snapshot is the game the intent was captured on", async () => {
    const b = new MemoryRoomBackend();
    await goLive(b);
    const update = b.update.bind(b);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    b.update = async (updates) => {
      if (Object.keys(updates).includes(`${root}/session`)) await gate;
      return update(updates);
    };
    const captured = game();
    let pending!: Promise<unknown>;
    act(() => { pending = endGameWithIntent({ kind: "declare", winner: "good" }); });
    await waitFor(() => expect(st().terminalClose?.status).toBe("closing"));
    const victim = game().seatOrder[4]!;
    st().recordDeath(victim);
    st().setNotes(victim, "late edit");
    expect(game()).toBe(captured);
    release();
    await act(async () => { await pending; });
    expect(game().phase).toBe("ended");
    expect(game().players[victim]!.alive).toBe(true);
    expect(game().players[victim]!.stNotes).toBe(captured.players[victim]!.stNotes);
  });
});

describe("10H-AC-050: lost-response recovery never duplicates or contradicts the published result", () => {
  it("the terminal commit landed but its response was lost: a retry (even with another intent) retains exactly what was published", async () => {
    const b = new MemoryRoomBackend();
    await goLive(b);
    const update = b.update.bind(b);
    let lose = true;
    b.update = async (updates) => {
      await update(updates);
      if (lose && Object.keys(updates).includes(`${root}/session`)) { lose = false; throw new Error("unexpected response failure"); }
    };
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    // The server ended the session with Good results; the device still holds the live game.
    expect((await b.get(`${root}/session`) as { state: string }).state).toBe("ended");
    const published = await b.get(`${root}/results`);
    expect(game().phase).toBe("day");
    // Retry with a different intent: the device adopts the published result; nothing new is written.
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "evil" })).toEqual({ ok: true }); });
    expect(await b.get(`${root}/results`)).toEqual(published);
    expect(game().phase).toBe("ended");
    expect(game().result?.winner).toBe("good");
  });

  it("a lost response followed by local play into a later day: the adopted (earlier) published result is still valid persisted state", async () => {
    const b = new MemoryRoomBackend();
    await goLive(b);
    const update = b.update.bind(b);
    let lose = true;
    b.update = async (updates) => {
      await update(updates);
      if (lose && Object.keys(updates).includes(`${root}/session`)) { lose = false; throw new Error("unexpected response failure"); }
    };
    await act(async () => { expect(await endGameWithIntent({ kind: "declare", winner: "good" })).toMatchObject({ ok: false }); });
    expect(st().advancePhase()).toMatchObject({ ok: true }); // Day 3 -> Night 4, locally
    expect(game().day).toBe(4);
    await act(async () => { expect(await endGameWithIntent({ kind: "noResult" })).toEqual({ ok: true }); });
    expect(game().result).toEqual({ winner: "good", declaredAt: { phase: "day", day: 3 } });
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });

  it("closeMultiplayerSession reads back only this session's results; none -> null", async () => {
    const b = new MemoryRoomBackend();
    const { session } = await goLive(b);
    await act(async () => { await endGameWithIntent({ kind: "noResult" }); });
    useStorytellerStore.setState({ lobby: { code, uid: "host", sessionId: session.id, status: "live" } });
    let outcome: Awaited<ReturnType<typeof closeMultiplayerSession>> | undefined;
    await act(async () => { outcome = await closeMultiplayerSession({ readBackPublished: true }); });
    expect(outcome).toEqual({ alreadyEnded: true, published: null });
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-036 / AC-038: Storyteller reveal acknowledgement view (advisory)", () => {
  it("re-keys acknowledgements by the live roster binding; Viewed only for the current token; stale/delayed/foreign values never count", async () => {
    const b = new MemoryRoomBackend();
    const { p0, p1 } = await goLive(b);
    const tokenA = game().players[p0]!.revealToken!;
    await act(async () => {
      await b.set(`${root}/revealAcks/uid-alice`, tokenA);
      await b.set(`${root}/revealAcks/uid-bob`, "S".repeat(22)); // stale / wrong
      await b.set(`${root}/revealAcks/uid-carol`, "C".repeat(22)); // not seated
      await b.set(`${root}/revealAcks/uid-mallory`, 42 as never); // malformed: dropped
    });
    await waitFor(() => expect(useSessionRuntime.getState().revealAcks[p0]).toBe(tokenA));
    const acks = useSessionRuntime.getState().revealAcks;
    expect(Object.keys(acks).sort()).toEqual([p0, p1].sort());
    expect(revealViewed(game().players[p0], acks[p0])).toBe(true);
    expect(revealViewed(game().players[p1], acks[p1])).toBe(false);
    // A visible-identity change makes the old acknowledgement stale.
    st().setShownRole(p0, "chef");
    expect(revealViewed(game().players[p0], useSessionRuntime.getState().revealAcks[p0])).toBe(false);
    // Seat reuse: the binding goes away -> the uid contributes nothing.
    await act(async () => { await b.set(`${root}/roster/uid-alice`, null); });
    await waitFor(() => expect(useSessionRuntime.getState().revealAcks[p0]).toBeUndefined());
    // Acknowledgements never enter the game or its persistence.
    expect(JSON.stringify(game())).not.toContain("revealAck");
    expect(localStorage.getItem("new-blood-st") ?? "").not.toContain("revealAcks");
  });

  it("an unreadable revealAcks path never blocks Go Live or raises a session error", async () => {
    const b = new MemoryRoomBackend();
    const subscribe = b.subscribe.bind(b);
    b.subscribe = (path, cb, err) => path.endsWith("/revealAcks")
      ? (setTimeout(() => err?.(Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" })), 0), () => {})
      : subscribe(path, cb, err);
    await goLive(b);
    expect(useSessionRuntime.getState().status).toBe("live");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useSessionRuntime.getState().error).toBeNull();
    expect(useSessionRuntime.getState().revealAcks).toEqual({});
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-030 / AC-031 / AC-056..058: player reveal, acknowledgement and terminal recovery", () => {
  async function seatedPlayer() {
    const b = new MemoryRoomBackend();
    const { session, p0 } = await goLive(b);
    usePlayerStore.getState().setSession({ code, uid: "uid-alice", requestedName: "Alice" });
    const stop = startPlayerHandshake(b, code, "uid-alice");
    await waitFor(() => expect(usePlayerStore.getState().self?.revealToken).toBe(game().players[p0]!.revealToken));
    return { b, session, p0, stop };
  }

  it("AC-030: the reveal flag is never persisted and every handshake re-seals", async () => {
    const { b, stop } = await seatedPlayer();
    usePlayerStore.getState().setRevealed(true);
    expect(localStorage.getItem("new-blood-player") ?? "").not.toContain("revealed");
    stop();
    const stop2 = startPlayerHandshake(b, code, "uid-alice");
    expect(usePlayerStore.getState().revealed).toBe(false);
    stop2();
    // A v3 blob that stored revealed:true never re-opens the card.
    expect(migratePlayerState({ revealed: true, townNotes: {} }, 3)).toEqual({ townNotes: {} });
  });

  it("AC-031: a visible-identity change re-seals the card; the player's own Life is in their envelope", async () => {
    const { p0, stop } = await seatedPlayer();
    usePlayerStore.getState().setRevealed(true);
    expect(usePlayerStore.getState().self?.life).toEqual({ alive: true, ghostVote: true });
    const before = usePlayerStore.getState().self!.revealToken;
    st().setShownRole(p0, "chef");
    await waitFor(() => expect(usePlayerStore.getState().self?.revealToken).not.toBe(before));
    expect(usePlayerStore.getState().revealed).toBe(false);
    expect(usePlayerStore.getState().self?.shownRole).toBe("chef");
    stop();
  });

  it("acknowledgeReveal stores the CURRENT token at the player's own revealAcks/{uid}", async () => {
    const { b, p0, stop } = await seatedPlayer();
    await act(async () => { await acknowledgeReveal(b); });
    const token = game().players[p0]!.revealToken!;
    expect(await b.get(`${root}/revealAcks/uid-alice`)).toBe(token);
    await waitFor(() => expect(usePlayerStore.getState().ownRevealAck).toBe(token));
    await waitFor(() => expect(revealViewed(game().players[p0], useSessionRuntime.getState().revealAcks[p0])).toBe(true));
    stop();
  });

  it("public/status=ended -> Ending... (context kept); session ended -> own validated result; survives reload; Back to Start clears context and Town notes", async () => {
    const { b, session, stop } = await seatedPlayer();
    usePlayerStore.getState().setTownNote(code, "p-x", { confidence: "suspect", roles: [], text: "hmm" });
    usePlayerStore.getState().setTownNote("OTHERGAME", "p-y", { confidence: null, roles: [], text: "keep" });
    expect(usePlayerStore.getState().sessionId).toBe(session.id);
    const update = b.update.bind(b);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    b.update = async (updates) => {
      if (Object.keys(updates).includes(`${root}/session`)) await gate;
      return update(updates);
    };
    let pending!: Promise<unknown>;
    act(() => { pending = endGameWithIntent({ kind: "declare", winner: "evil" }); });
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("ending"));
    expect(usePlayerStore.getState().code).toBe(code);
    release();
    await act(async () => { await pending; });
    await waitFor(() => expect(usePlayerStore.getState().terminalResult).toEqual({ status: "ready", result: { winner: "evil", declaredAt: { phase: "day", day: 3 } } }));
    expect(usePlayerStore.getState().status).toBe("ended");
    expect(usePlayerStore.getState().self).toBeNull();
    stop();
    // Reload: the persisted terminal context recovers the same result.
    const saved = JSON.parse(localStorage.getItem("new-blood-player")!).state;
    expect(saved).toMatchObject({ code, uid: "uid-alice", sessionId: session.id });
    usePlayerStore.setState({ status: "idle", terminalResult: null });
    const stop2 = startPlayerHandshake(b, code, "uid-alice");
    await waitFor(() => expect(usePlayerStore.getState().terminalResult).toMatchObject({ status: "ready" }));
    stop2();
    // Back to Start.
    usePlayerStore.getState().reset();
    const ps = usePlayerStore.getState();
    expect([ps.code, ps.uid, ps.sessionId, ps.terminalResult]).toEqual([null, null, null, null]);
    expect(Object.keys(ps.townNotes)).toEqual(["OTHERGAME:p-y"]);
  });

  it("End Without Result -> generic Game Ended (none); a failed result read is a retryable error, never a false none", async () => {
    const { b, stop } = await seatedPlayer();
    await act(async () => { await endGameWithIntent({ kind: "noResult" }); });
    await waitFor(() => expect(usePlayerStore.getState().terminalResult).toEqual({ status: "none" }));
    stop();
    const get = b.get.bind(b);
    b.get = async (path) => { if (path.endsWith("/results/uid-alice")) throw Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" }); return get(path); };
    const stop2 = startPlayerHandshake(b, code, "uid-alice");
    await waitFor(() => expect(usePlayerStore.getState().terminalResult).toMatchObject({ status: "error" }));
    stop2();
  });

  it("AC-056: a result naming another session is never shown", async () => {
    expect(decodePlayerResult({ version: 1, sessionId: "other", winner: "good", declaredAt: { phase: "day", day: 1 } }, "mine")).toMatchObject({ status: "invalid" });
    expect(decodePlayerResult({ version: 1, sessionId: "mine", winner: "good", declaredAt: { phase: "day", day: 1 }, role: "imp" }, "mine")).toMatchObject({ status: "invalid" });
    expect(decodePlayerResult(null, "mine")).toEqual({ status: "waiting" });
    expect(decodePlayerResult({ version: 1, sessionId: "mine", winner: "evil", declaredAt: { phase: "night", day: 2 } }, "mine")).toMatchObject({ status: "ready" });
  });
});
