// Package 2A: the Go Live sequence now lives in @/firebase/goLive and is run by
// the New Game flow's "Invite to phones". These tests pin that it keeps every
// guard the Grimoire's Go Live had (in-flight lock, game-lifecycle
// revalidation, authoritative close of a lobby created for a game that is
// gone, no orphans), plus the store seams the flow needs (newGame seat names
// and Fabled/Loric, discardSetupGame) and the runtime's distinct, currently
// joined player list. In-memory backend only: no Firebase is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorytellerStore, gameLifecycleToken } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { RoomBackend } from "./backend";
import { MemoryRoomBackend } from "./memoryBackend";
import { cancelJoinRequest, knockOnLobby } from "./lobby";
import { presencePath, rosterEntryPath } from "./paths";
import { sessionPath } from "./lifecycle";
import { closeMultiplayerSession, useSessionRuntime, useStorytellerSync } from "./storytellerSync";
import { goLive, useGoLiveState } from "./goLive";

const env = vi.hoisted(() => ({
  backend: null as RoomBackend | null,
  configured: true,
  gate: null as Promise<void> | null,
  connects: 0,
}));
vi.mock("./session", () => ({
  connectFirebase: async () => {
    env.connects++;
    if (env.gate) await env.gate;
    if (!env.backend) throw new Error("Firebase is not configured.");
    return { backend: env.backend, uid: "host" };
  },
}));
vi.mock("./config", async (original) => ({
  ...(await original<typeof import("./config")>()),
  isFirebaseConfigured: () => env.configured,
}));

const reset = () => {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, view: "newgame", terminalClose: null });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, joined: [], pending: 0, retry: 0, status: "idle", failure: null, closeFailed: false, leaveOffer: null, unattachedCleanupFailures: [] });
};
beforeEach(() => {
  env.backend = null; env.configured = true; env.gate = null; env.connects = 0;
  reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const newSetup = (opts: Parameters<ReturnType<typeof useStorytellerStore.getState>["newGame"]>[1] = {}) =>
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 6, keepView: true, ...opts });

describe("goLive (shared Go Live sequence)", () => {
  it("attaches a lobby to the open game and leaves the view alone", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    expect(newSetup()).toBe(true);
    const outcome = await goLive();
    expect(outcome.kind).toBe("attached");
    const { game, lobby, view } = useStorytellerStore.getState();
    expect(view).toBe("newgame");
    expect(lobby?.code).toBe((outcome as { code: string }).code);
    expect(game?.code).toBe(lobby?.code);
    expect(game?.storytellerUid).toBe("host");
    expect(await b.get(sessionPath(lobby!.code))).toMatchObject({ state: "active", id: lobby!.sessionId });
    expect(useGoLiveState.getState().busy).toBe(false);
  });

  it("the attached lobby goes live through the unchanged writer startup, with nobody seated", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    newSetup();
    await goLive();
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const game = useStorytellerStore.getState().game!;
    expect(Object.values(game.players).every((p) => p.isEmpty)).toBe(true);
  });

  it("reports needsConfig without creating anything when Firebase is not configured", async () => {
    env.configured = false;
    newSetup();
    expect(await goLive()).toEqual({ kind: "needsConfig" });
    expect(env.connects).toBe(0);
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useGoLiveState.getState().busy).toBe(false);
  });

  it("a second Go Live while one is in flight is refused and creates no second lobby", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    let release!: () => void;
    env.gate = new Promise<void>((resolve) => { release = resolve; });
    newSetup();
    const first = goLive();
    await waitFor(() => expect(useGoLiveState.getState().busy).toBe(true));
    expect(await goLive()).toEqual({ kind: "busy" });
    release();
    expect((await first).kind).toBe("attached");
    expect(env.connects).toBe(1);
  });

  it("a game replaced or discarded while connecting never gets a lobby", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    let release!: () => void;
    env.gate = new Promise<void>((resolve) => { release = resolve; });
    newSetup();
    const token = gameLifecycleToken();
    const pending = goLive();
    await waitFor(() => expect(env.connects).toBe(1));
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(true);
    release();
    expect(await pending).toEqual({ kind: "superseded" });
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(await b.get("lobbies")).toBeUndefined();
  });

  it("a lobby created for a game that is gone before adoption is closed authoritatively, never attached", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    newSetup();
    const token = gameLifecycleToken();
    // The session record is the last step of createLobby: hold it, discard the
    // game meanwhile, then let creation finish.
    const set = b.set.bind(b);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const atSession = new Promise<void>((resolve) => { reached = resolve; });
    b.set = async (path, value) => {
      if (path.endsWith("/session")) { reached(); await held; }
      return set(path, value);
    };
    const pending = goLive();
    await atSession;
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(true);
    release();
    expect(await pending).toEqual({ kind: "superseded" });
    expect(useStorytellerStore.getState().lobby).toBeNull();
    const codeKey = Object.keys((await b.get("lobbies")) as Record<string, unknown>)[0]!;
    expect(await b.get(sessionPath(codeKey))).toMatchObject({ state: "ended" });
    expect(useSessionRuntime.getState().unattachedCleanupFailures).toEqual([]);
  });

  it("a failed connection returns a friendly error and leaves the local game untouched for a retry", async () => {
    newSetup();
    const before = useStorytellerStore.getState().game;
    const outcome = await goLive();
    expect(outcome.kind).toBe("failed");
    expect(useStorytellerStore.getState().game).toBe(before);
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(useGoLiveState.getState().busy).toBe(false);
    env.backend = new MemoryRoomBackend();
    expect((await goLive()).kind).toBe("attached");
  });

  it("returning from the live lobby: authoritative close first, then the game is discarded; a failed close discards nothing", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    newSetup();
    const token = gameLifecycleToken();
    await goLive();
    const hook = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const code = useStorytellerStore.getState().lobby!.code;
    // The lobby is still attached: the discard is refused outright.
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(false);
    // A close the server denies leaves lobby and game as they were.
    const update = b.update.bind(b);
    b.update = async (updates) => { if (Object.keys(updates).some((p) => p.endsWith("/session"))) throw new Error("denied"); return update(updates); };
    await expect(closeMultiplayerSession()).rejects.toThrow();
    expect(useStorytellerStore.getState().lobby?.code).toBe(code);
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(false);
    expect(useStorytellerStore.getState().game).not.toBeNull();
    b.update = update;
    await act(async () => { await closeMultiplayerSession(); });
    expect(useStorytellerStore.getState().lobby).toBeNull();
    expect(await b.get(sessionPath(code))).toMatchObject({ state: "ended" });
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(true);
    expect(useStorytellerStore.getState().game).toBeNull();
    expect(useStorytellerStore.getState().view).toBe("newgame");
    hook.unmount();
  });

  it("retry after a refresh: a persisted game and lobby reconnect through the existing writer startup", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    newSetup();
    await goLive();
    const first = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    first.unmount();
    // A reload keeps game, lobby and sync metadata; the runtime starts cold.
    useSessionRuntime.setState({ backend: null, status: "idle", presence: "unknown", online: {}, joined: [] });
    const second = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    expect(useStorytellerStore.getState().lobby).not.toBeNull();
    second.unmount();
  });
});

describe("discardSetupGame and newGame seams", () => {
  it("discard is refused for a stale token, a non-setup game, and when nothing is open", () => {
    expect(useStorytellerStore.getState().discardSetupGame(gameLifecycleToken())).toBe(false);
    newSetup();
    const token = gameLifecycleToken();
    expect(useStorytellerStore.getState().discardSetupGame(token - 1)).toBe(false);
    useStorytellerStore.setState((s) => ({ game: { ...s.game!, phase: "night" } }));
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(false);
    useStorytellerStore.setState((s) => ({ game: { ...s.game!, phase: "setup" } }));
    useStorytellerStore.setState({ terminalClose: { intent: { kind: "noResult" }, status: "closing" } as never });
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(false);
    useStorytellerStore.setState({ terminalClose: null });
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(true);
  });

  it("discard is refused once the Reveal has completed", () => {
    newSetup();
    const token = gameLifecycleToken();
    useStorytellerStore.setState((s) => ({ game: { ...s.game!, setupRolesRevealed: true } }));
    expect(useStorytellerStore.getState().discardSetupGame(token)).toBe(false);
  });

  it("newGame is refused (false, unchanged) while a terminal close owns the current game", () => {
    newSetup();
    const game = useStorytellerStore.getState().game;
    useStorytellerStore.setState({ terminalClose: { intent: { kind: "noResult" }, status: "closing" } as never });
    expect(useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 7 })).toBe(false);
    expect(useStorytellerStore.getState().game).toBe(game);
  });

  it("keepView stays where it is; the default still opens the Grimoire", () => {
    newSetup();
    expect(useStorytellerStore.getState().view).toBe("newgame");
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 6 });
    expect(useStorytellerStore.getState().view).toBe("game");
  });

  it("plannedFabled / plannedLorics are normalized like setFabled / setLorics", () => {
    newSetup({ plannedFabled: ["angel", "angel", "not-a-fabled", "djinn", "bootlegger"], plannedLorics: ["bootlegger", "angel", "bootlegger"] });
    const game = useStorytellerStore.getState().game!;
    expect(game.fabled).toEqual(["angel", "djinn"]);
    expect(game.lorics).toEqual(["bootlegger"]);
  });

  it("seat names occupy seats in order with fresh, distinct identities; blank and multi-line names keep the seat empty", () => {
    newSetup({ plannedPlayerCount: 6, plannedSeatNames: ["  Bram ", "", "Odile", "bad\nname", "Wren", "x".repeat(40)] });
    const game = useStorytellerStore.getState().game!;
    const seats = game.seatOrder.map((id) => game.players[id]!);
    expect(seats.map((p) => p.isEmpty)).toEqual([false, true, false, true, false, false]);
    expect(seats.map((p) => p.name)).toEqual(["Bram", "", "Odile", "", "Wren", "x".repeat(20)]);
    const ids = seats.filter((p) => !p.isEmpty).map((p) => p.participantId);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(game.plannedPlayerCount).toBe(6);
    expect(game.pendingPlayers).toEqual({});
    expect(game.phase).toBe("setup");
  });

  it("seating names at creation equals seating them one by one afterwards (same Traveler arrival rules)", () => {
    const names = Array.from({ length: 17 }, (_, i) => `P${i + 1}`);
    newSetup({ plannedPlayerCount: 17, plannedTravelerCount: 2, plannedSeatNames: names });
    const folded = useStorytellerStore.getState().game!;
    newSetup({ plannedPlayerCount: 17, plannedTravelerCount: 2 });
    const empty = useStorytellerStore.getState().game!;
    empty.seatOrder.forEach((id, i) => useStorytellerStore.getState().addPlayerToSeat(names[i]!, id));
    const stepwise = useStorytellerStore.getState().game!;
    const shape = (g: typeof folded) => g.seatOrder.map((id) => { const p = g.players[id]!; return [p.name, p.isEmpty, p.isTraveler]; });
    expect(shape(folded)).toEqual(shape(stepwise));
  });

  it("names beyond the planned seats are ignored", () => {
    newSetup({ plannedPlayerCount: 5, plannedSeatNames: ["A", "B", "C", "D", "E", "F", "G"] });
    const game = useStorytellerStore.getState().game!;
    expect(game.seatOrder).toHaveLength(5);
    expect(Object.values(game.players).map((p) => p.name)).toEqual(["A", "B", "C", "D", "E"]);
  });
});

describe("runtime.joined: distinct, currently joined players", () => {
  async function liveLobby() {
    const b = new MemoryRoomBackend();
    env.backend = b;
    newSetup({ plannedPlayerCount: 8 });
    await goLive();
    renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const code = useStorytellerStore.getState().lobby!.code;
    const here = async (uid: string, extra: { online?: boolean; lastSeen?: number } = {}) =>
      b.set(presencePath(code, uid), { online: extra.online ?? true, lastSeen: extra.lastSeen ?? Date.now() });
    const knock = async (uid: string, name: string) => { await knockOnLobby(b, code, uid, name); await here(uid); };
    const joined = () => useSessionRuntime.getState().joined.map((j) => j.uid);
    return { b, code, here, knock, joined };
  }

  it("starts empty and counts each distinct online player once, in arrival order", async () => {
    const { knock, joined } = await liveLobby();
    await waitFor(() => expect(useSessionRuntime.getState().presence).toBe("ready"));
    expect(joined()).toEqual([]);
    for (const [uid, name] of [["u1", "Bram"], ["u2", "Odile"], ["u3", "Fenwick"], ["u4", "Marisol"], ["u5", "Tobias"]] as const) await knock(uid, name);
    await waitFor(() => expect(joined()).toEqual(["u1", "u2", "u3", "u4", "u5"]));
    expect(useSessionRuntime.getState().joined.every((j) => j.playerId === null)).toBe(true);
  });

  it("a repeated knock or a changed name is the same player, not a new arrival", async () => {
    const { b, code, knock, joined } = await liveLobby();
    await knock("u1", "Bram");
    await knock("u1", "Bram");
    await knockOnLobby(b, code, "u1", "Someone Else");
    await waitFor(() => expect(joined()).toEqual(["u1"]));
    expect(useSessionRuntime.getState().joined).toHaveLength(1);
  });

  it("a player who goes offline, has a stale heartbeat, or cancels no longer counts", async () => {
    const { b, code, here, knock, joined } = await liveLobby();
    for (const uid of ["u1", "u2", "u3", "u4"]) await knock(uid, uid.toUpperCase());
    await waitFor(() => expect(joined()).toHaveLength(4));
    await here("u1", { online: false });
    await waitFor(() => expect(joined()).toEqual(["u2", "u3", "u4"]));
    await here("u2", { lastSeen: Date.now() - 120_000 });
    await waitFor(() => expect(joined()).toEqual(["u3", "u4"]));
    await act(async () => { await cancelJoinRequest(b, code, "u3"); });
    await waitFor(() => expect(joined()).toEqual(["u4"]));
    await here("u1");
    await waitFor(() => expect(joined()).toContain("u1"));
  });

  it("a seated player who also still holds a request counts once, bound to their seat; seating is never automatic", async () => {
    const { b, code, knock, joined } = await liveLobby();
    await knock("u1", "Bram");
    await waitFor(() => expect(joined()).toEqual(["u1"]));
    const game = useStorytellerStore.getState().game!;
    expect(Object.keys(game.pendingPlayers)).toEqual(["u1"]);
    expect(Object.values(game.players).every((p) => p.isEmpty)).toBe(true);
    const seat = game.seatOrder[0]!;
    await b.set(rosterEntryPath(code, "u1"), seat);
    await waitFor(() => expect(useSessionRuntime.getState().joined).toEqual([{ uid: "u1", playerId: seat, expiresAt: expect.any(Number) }]));
  });

  it("expires a silent heartbeat at exactly 45 seconds without a subscription callback, then accepts a fresh heartbeat", async () => {
    const { b, code, here, knock, joined } = await liveLobby();
    vi.useFakeTimers();
    await knock("u1", "Bram");
    const seat = useStorytellerStore.getState().game!.seatOrder[0]!;
    await b.set(rosterEntryPath(code, "u1"), seat);
    // Keep this test below the writer's renewal interval: the heartbeat is
    // already 44 seconds old when received; no presence callback follows.
    await here("u1", { lastSeen: Date.now() - 44_000 });
    const game = useStorytellerStore.getState().game;
    const undo = useStorytellerStore.getState().undoStack;
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(joined()).toEqual(["u1"]);
    expect(useSessionRuntime.getState().pending).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(joined()).toEqual([]);
    expect(useSessionRuntime.getState().pending).toBe(0);
    expect(useSessionRuntime.getState().online[seat]).toBeUndefined();
    expect(await b.get(rosterEntryPath(code, "u1"))).toBe(seat);
    expect(useStorytellerStore.getState().game).toBe(game);
    expect(useStorytellerStore.getState().undoStack).toBe(undo);
    await here("u1");
    expect(joined()).toEqual(["u1"]);
    expect(useSessionRuntime.getState().online[seat]).toBe(true);
    expect(useSessionRuntime.getState().pending).toBe(1);
  });

  it("a refreshed heartbeat replaces its old expiration deadline, and unmount cancels expiry updates", async () => {
    const { here, knock, joined } = await liveLobby();
    vi.useFakeTimers();
    await knock("u1", "Bram");
    await here("u1", { lastSeen: Date.now() - 44_000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await here("u1");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(joined()).toEqual(["u1"]);
    cleanup();
    expect(joined()).toEqual([]);
    const changed = vi.fn();
    const unsubscribe = useSessionRuntime.subscribe(changed);
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    unsubscribe();
    expect(changed).not.toHaveBeenCalled();
  });

  it("a malformed presence row is dropped: it never counts and never poisons other players", async () => {
    const { b, code, knock, joined } = await liveLobby();
    await knock("u1", "Bram");
    await knockOnLobby(b, code, "u2", "Odile");
    await b.set(presencePath(code, "u2"), { online: "yes" });
    await knock("u3", "Fenwick");
    await waitFor(() => expect(joined()).toEqual(["u1", "u3"]));
  });

  it("stopping the session clears the list", async () => {
    const b = new MemoryRoomBackend();
    env.backend = b;
    newSetup({ plannedPlayerCount: 8 });
    await goLive();
    const hook = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("live"));
    const code = useStorytellerStore.getState().lobby!.code;
    await knockOnLobby(b, code, "u1", "Bram");
    await b.set(presencePath(code, "u1"), { online: true, lastSeen: Date.now() });
    await waitFor(() => expect(useSessionRuntime.getState().joined).toHaveLength(1));
    hook.unmount();
    await waitFor(() => expect(useSessionRuntime.getState().joined).toEqual([]));
  });
});
