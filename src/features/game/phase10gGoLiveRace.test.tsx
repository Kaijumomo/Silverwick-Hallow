// Phase 10G Astra remediation, ASTRA-10G-001: Go Live may never attach a
// lobby to a game that was finished (or discarded / replaced) while the
// asynchronous Go Live workflow was in flight, and an ended game can never
// acquire or retain an active multiplayer scope -- at the Go Live
// continuation, the store's setLobby / setPhase boundary, the Storyteller
// writer startup, and rehydration (PHASE10G Sections 17.3, 17.5, 18; AC-35).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { Json, RoomBackend } from "@/firebase/backend";

const connect = vi.fn<() => Promise<{ backend: RoomBackend; uid: string }>>();
vi.mock("@/firebase/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/session")>();
  return { ...actual, connectFirebase: () => connect() };
});
vi.mock("@/firebase/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/config")>();
  return { ...actual, isFirebaseConfigured: () => true };
});

import { GameScreen } from "./GameScreen";
import { useStorytellerStore as store, takeMigrationResetFlag } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { closeMultiplayerSession, startStorytellerSession, useSessionRuntime, useStorytellerSync } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { LifecycleError, requireActiveSession } from "@/firebase/lifecycle";
import { SessionWriter } from "@/firebase/writer";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { finishGame } from "@/test/finishGame";

const state = () => store.getState();
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "imp", "empath", "chef", "poisoner", "saint", "washerwoman"];
const KEY = "new-blood-st";
const UID = "st-uid";

/** A memory backend that can hold one matching read or write open. */
class GatedBackend extends MemoryRoomBackend {
  private gates: { match: (kind: "get" | "set", path: string) => boolean; open: Promise<void> }[] = [];
  hold(match: (kind: "get" | "set", path: string) => boolean): () => void {
    let release!: () => void;
    this.gates.push({ match, open: new Promise<void>((resolve) => { release = resolve; }) });
    return release;
  }
  private async pass(kind: "get" | "set", path: string) {
    const index = this.gates.findIndex((gate) => gate.match(kind, path));
    if (index < 0) return;
    const [gate] = this.gates.splice(index, 1);
    await gate!.open;
  }
  override async get(path: string): Promise<unknown> { await this.pass("get", path); return super.get(path); }
  override async set(path: string, value: Json): Promise<void> { await this.pass("set", path); return super.set(path, value); }
}

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  return g;
}
const lobbies = (b: MemoryRoomBackend) => (b as unknown as { root: Record<string, Record<string, Record<string, unknown>>> }).root.lobbies ?? {};
const onlyLobby = (b: MemoryRoomBackend) => {
  const codes = Object.keys(lobbies(b));
  expect(codes).toHaveLength(1);
  return lobbies(b)[codes[0]!]!;
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  localStorage.clear();
  takeMigrationResetFlag();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  connect.mockReset();
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" }, status: "idle", failure: null, closeFailed: false, leaveOffer: null });
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const clickGoLive = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Invite/ }));
  fireEvent.click(screen.getByRole("button", { name: "Go live" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Invite players" })).getByRole("button", { name: "Close" }));
};
const clickFinish = async () => { await finishGame(); };
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe("ASTRA-10G-001: the Go Live continuation revalidates its game", () => {
  it("normal Go Live still attaches the new lobby to the current eligible game", async () => {
    const b = new GatedBackend();
    connect.mockResolvedValue({ backend: b, uid: UID });
    render(<GameScreen />);
    clickGoLive();
    await waitFor(() => expect(state().lobby).not.toBeNull());
    expect(state().lobby).toMatchObject({ uid: UID, status: "live" });
    expect(state().game!.code).toBe(state().lobby!.code);
    expect(onlyLobby(b).session).toMatchObject({ state: "active" });
  });

  it("delayed connectFirebase -> Finish game -> continuation: no lobby is created or attached", async () => {
    const b = new GatedBackend();
    const connection = deferred<{ backend: RoomBackend; uid: string }>();
    connect.mockReturnValue(connection.promise);
    render(<GameScreen />);
    clickGoLive();
    await clickFinish();
    expect(state().game!.phase).toBe("ended");
    await act(async () => { connection.resolve({ backend: b, uid: UID }); });
    await settle();
    expect(state().lobby).toBeNull();
    expect(state().game!.phase).toBe("ended");
    expect(lobbies(b)).toEqual({});
  });

  it("delayed lobby creation -> Finish game -> continuation: the created lobby is closed authoritatively, never attached", async () => {
    const b = new GatedBackend();
    const release = b.hold((kind, path) => kind === "set" && path.endsWith("/session"));
    connect.mockResolvedValue({ backend: b, uid: UID });
    render(<GameScreen />);
    clickGoLive();
    await settle();
    await clickFinish();
    expect(state().game!.phase).toBe("ended");
    await act(async () => { release(); });
    await waitFor(() => expect(onlyLobby(b).session).toMatchObject({ state: "ended" }));
    const lobby = onlyLobby(b);
    expect(lobby.public).toMatchObject({ status: "ended" });
    // The fenced closer held, then released, the writer lease.
    expect(lobby.writer).toMatchObject({ expiresAt: 0 });
    expect(state().lobby).toBeNull();
    expect(state().game!.phase).toBe("ended");
    expect(state().game!.code).toBe("");
  });

  it("delayed session acquisition -> Finish game -> continuation: closed authoritatively, never attached", async () => {
    const b = new GatedBackend();
    const release = b.hold((kind, path) => kind === "get" && path.endsWith("/session"));
    connect.mockResolvedValue({ backend: b, uid: UID });
    render(<GameScreen />);
    clickGoLive();
    await settle();
    await clickFinish();
    await act(async () => { release(); });
    await waitFor(() => expect(onlyLobby(b).session).toMatchObject({ state: "ended" }));
    expect(state().lobby).toBeNull();
    expect(state().game!.phase).toBe("ended");
  });

  it("a game REPLACED meanwhile (discarded, then a new setup) never receives the old Go Live's lobby", async () => {
    const b = new GatedBackend();
    const release = b.hold((kind, path) => kind === "get" && path.endsWith("/session"));
    connect.mockResolvedValue({ backend: b, uid: UID });
    render(<GameScreen />);
    clickGoLive();
    await settle();
    act(() => { state().endGame(); state().newGame(setupScript.id, { plannedPlayerCount: 7 }); });
    expect(state().game!.phase).toBe("setup");
    await act(async () => { release(); });
    await waitFor(() => expect(onlyLobby(b).session).toMatchObject({ state: "ended" }));
    expect(state().lobby).toBeNull();
    expect(state().game!.code).toBe("");
  });
});

describe("ASTRA-10G-001: store boundaries refuse an ended game's multiplayer scope", () => {
  it("setLobby refuses to attach a lobby to an ended game (nothing changes); detaching still works", () => {
    state().finishGame({ kind: "noResult" });
    const before = { game: state().game, undo: state().undoStack, seq: state().localSeq };
    expect(state().setLobby({ code: "LATE1234", uid: UID, sessionId: "s1", status: "live" })).toBe(false);
    expect(state().lobby).toBeNull();
    expect(state().game).toBe(before.game);
    expect(state().undoStack).toBe(before.undo);
    expect(state().localSeq).toBe(before.seq);
    expect(state().setLobby(null)).toBe(true);
  });

  it("setPhase('ended') is refused while a lobby is attached (Finish game closes the session first)", () => {
    store.setState({ lobby: { code: "LIVE1234", uid: UID, sessionId: "s1", status: "live" } });
    const before = state().game;
    expect(state().setPhase("ended")).toMatchObject({ ok: false });
    expect(state().game).toBe(before);
    store.setState({ lobby: null });
    expect(state().setPhase("ended")).toEqual({ ok: true });
  });
});

describe("ASTRA-10G-001: an ended game can never start a Storyteller writer", () => {
  async function liveLobby(b: MemoryRoomBackend) {
    await createLobby(b, UID, { codeGenerator: () => "ENDD1234" });
    const session = await requireActiveSession(b, "ENDD1234");
    return { code: "ENDD1234", uid: UID, sessionId: session.id, status: "live" as const };
  }

  it("a persisted ended game plus an erroneously persisted lobby rehydrates without going live; startup refuses before any lease or write", async () => {
    const b = new MemoryRoomBackend();
    const lobby = await liveLobby(b);
    const ended = liveGame({ phase: "ended", code: lobby.code, storytellerUid: UID });
    store.setState({ game: null, lobby: null });
    localStorage.setItem(KEY, JSON.stringify({ state: { game: ended, undoStack: [], customScripts: { [setupScript.id]: setupScript }, view: "game", lobby, localSeq: 1, sync: null }, version: 26 }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(state().game!.phase).toBe("ended");
    const writesBefore = b.writeLog.length;
    const writer = new SessionWriter(b, lobby.code, lobby.sessionId);
    await expect(startStorytellerSession(b, state().lobby!, writer)).rejects.toThrow(LifecycleError);
    expect(b.writeLog.slice(writesBefore)).toEqual([]); // no lease, no guard, no checkpoint
    await writer.dispose();
    expect(useSessionRuntime.getState().backend).toBeNull();
  });

  it("the session hook reports the refused start (not silently live), and End multiplayer closes the lobby authoritatively", async () => {
    const b = new MemoryRoomBackend();
    const lobby = await liveLobby(b);
    store.setState({ game: liveGame({ phase: "ended", code: lobby.code, storytellerUid: UID }), lobby });
    connect.mockResolvedValue({ backend: b, uid: UID });
    const hook = renderHook(() => useStorytellerSync(b));
    await waitFor(() => expect(useSessionRuntime.getState().status).toBe("failed"));
    expect(useSessionRuntime.getState().backend).toBeNull();
    expect(useSessionRuntime.getState().failure?.message).toMatch(/finished/);
    expect((await b.get(`lobbies/${lobby.code}/checkpoint`)) ?? null).toBeNull();
    await act(async () => { await closeMultiplayerSession(); });
    expect(await b.get(`lobbies/${lobby.code}/session`)).toMatchObject({ state: "ended" });
    expect(state().lobby).toBeNull();
    expect(state().game!.phase).toBe("ended");
    hook.unmount();
  });

  it("a checkpoint holding an ended game is never adopted into a lobby", async () => {
    const b = new MemoryRoomBackend();
    const lobby = await liveLobby(b);
    await b.set(`lobbies/${lobby.code}/checkpoint`, JSON.stringify({ game: liveGame({ phase: "ended", code: lobby.code, storytellerUid: UID }), roster: {} }));
    store.setState({ game: null, lobby });
    const writer = new SessionWriter(b, lobby.code, lobby.sessionId);
    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(LifecycleError);
    await writer.dispose();
    expect(state().game).toBeNull();
    expect(useSessionRuntime.getState().backend).toBeNull();
  });
});
