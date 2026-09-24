// Phase 9R.5 -- remote checkpoint recovery must never adopt a game whose
// players and seatOrder disagree. readCheckpoint() (storytellerSync.ts)
// already routes every checkpoint through the shared migration and then
// StorytellerGamePersistedSchema, so the strengthened geometry contract
// (schemas.ts checkSeatGeometry) makes such a checkpoint "invalid" -- these
// tests seed RAW checkpoint JSON into a MemoryRoomBackend and drive the real
// startStorytellerSession / resolveReconnectConflict paths (never an
// internal unit call), proving the malformed game is never restored and
// never republished by the initial projection/checkpoint flush.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { lifecycleMessage, requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { writeProjections } from "./sync";
import { SnapshotValidationError } from "./snapshots";
import { reportRuntimeError, resolveReconnectConflict, startStorytellerSession, useSessionRuntime } from "./storytellerSync";

const code = "SEAT2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
const store = () => useStorytellerStore.getState();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: {},
  });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

const writerFor = (b: MemoryRoomBackend, sessionId: string) =>
  new SessionWriter(b, code, sessionId, (error) => reportRuntimeError("write", error ? lifecycleMessage(error) : null));

async function openLobby(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  return { session, lobby: { code, uid: "host", sessionId: session.id, status: "live" as const } };
}

/** A coherent seven-player v17 game built through real commands (offline,
 * no Firebase membership), stamped with this lobby's code, then cleared
 * from the store so it exists only as checkpoint content. */
function sevenPlayerCheckpointGame(): StorytellerLobbyRecord {
  store().newGame("tb", { plannedPlayerCount: 7 });
  for (let i = 0; i < 7; i++) store().addPlayerToSeat("Player " + i);
  const g = { ...clone(store().game!), code, storytellerUid: "host" };
  expect(StorytellerGamePersistedSchema.safeParse(clone(g)).success).toBe(true);
  useStorytellerStore.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
  return g;
}

const seedCheckpoint = (b: MemoryRoomBackend, game: unknown, roster: Record<string, string> = {}) =>
  b.set(`${root}/checkpoint`, JSON.stringify({ game, roster }));

const isProjectionWrite = (path: string) =>
  path === `${root}/storyteller` || path === `${root}/public` || path === `${root}/checkpoint` || path.startsWith(`${root}/player/`);

/** Observes the one adoption entry point directly. */
function observeRestore(): { calls: number } {
  const original = store().restoreRemoteCheckpoint;
  const observed = { calls: 0 };
  useStorytellerStore.setState({ restoreRemoteCheckpoint: (game, guard) => { observed.calls++; original(game, guard); } });
  disposals.push(() => { useStorytellerStore.setState({ restoreRemoteCheckpoint: original }); });
  return observed;
}

type Corruption = [label: string, corrupt: (g: StorytellerLobbyRecord) => void];
const omitted: Corruption = ["an omitted legitimate player", (g) => { g.seatOrder = g.seatOrder.filter((_, i) => i !== 3); }];
const corruptions: Corruption[] = [
  omitted,
  ["an unknown seat id", (g) => { g.seatOrder.push("ghost-player"); }],
  ["an inherited seat id appended (toString)", (g) => { g.seatOrder.push("toString"); }],
  ["an inherited seat id replacing a real one (constructor)", (g) => { g.seatOrder[6] = "constructor"; }],
  ["a duplicate seat id appended", (g) => { g.seatOrder.push(g.seatOrder[1]!); }],
  ["a duplicate seat id displacing a real one", (g) => { g.seatOrder[6] = g.seatOrder[1]!; }],
  ["a players key / player.id mismatch", (g) => { g.players[g.seatOrder[2]!]!.id = "someone-else"; }],
  ["a stored seat / seatOrder index mismatch", (g) => { g.players[g.seatOrder[2]!]!.seat = 4; }],
];

// ---------------------------------------------------------------------------
// C. Remote checkpoint recovery
// ---------------------------------------------------------------------------
describe("Phase 9R.5 C: a malformed raw v17 checkpoint is invalid and never restored or republished", () => {
  it.each(corruptions)("fresh device, checkpoint with %s: SnapshotValidationError, restoreRemoteCheckpoint() never called, no projection/checkpoint write", async (_label, corrupt) => {
    const b = new MemoryRoomBackend();
    const malformed = sevenPlayerCheckpointGame();
    corrupt(malformed);
    const undoBaseline = [sevenPlayerCheckpointGame()];
    await seedCheckpoint(b, malformed);
    const checkpointBefore = await b.get(`${root}/checkpoint`);
    const { lobby, session } = await openLobby(b);
    store().setLobby(lobby);
    const restore = observeRestore();
    // A non-trivial local baseline (set after setLobby, which clears Undo).
    useStorytellerStore.setState({ game: null, undoStack: undoBaseline, localSeq: 7 });
    const undoCopy = clone(undoBaseline);
    const writer = writerFor(b, session.id);
    disposals.push(() => writer.dispose());
    const writeLogBefore = b.writeLog.length;

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);

    expect(restore.calls).toBe(0);
    expect(store().game).toBeNull();
    expect(store().undoStack).toEqual(undoCopy);
    expect(store().localSeq).toBe(7);
    expect(store().sync?.ackedGuard ?? null).toBeNull();
    expect(b.writeLog.slice(writeLogBefore).filter((e) => isProjectionWrite(e.path))).toEqual([]);
    expect(await b.get(`${root}/checkpoint`)).toEqual(checkpointBefore);
    expect((await b.get(`${root}/storyteller`)) ?? null).toBeNull(); // never projected
  });

  it("the malformed game is rejected specifically for its geometry: the identical checkpoint minus the corruption is restored", async () => {
    const b = new MemoryRoomBackend();
    const coherent = sevenPlayerCheckpointGame();
    await seedCheckpoint(b, coherent);
    const { lobby, session } = await openLobby(b);
    store().setLobby(lobby);
    const restore = observeRestore();
    const writer = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(restore.calls).toBe(1);
    expect(store().game!.seatOrder).toEqual(coherent.seatOrder);
    expect(store().game!.players).toEqual(coherent.players);
    // ...and what the normal initial flush republishes is that coherent game.
    await waitFor(async () => {
      const raw = await b.get(`${root}/checkpoint`);
      const republished = (JSON.parse(raw as string) as { game: StorytellerLobbyRecord }).game;
      expect(republished.seatOrder).toEqual(coherent.seatOrder);
      expect(StorytellerGamePersistedSchema.safeParse(republished).success).toBe(true);
    });
  });

  it("clean in-scope local game + malformed checkpoint: still the hard invalid_checkpoint failure -- local game kept, nothing restored or published", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, session } = await openLobby(b);
    store().newGame("tb", { plannedPlayerCount: 3 });
    store().setLobby(lobby);
    const first = writerFor(b, session.id);
    const live = await startStorytellerSession(b, lobby, first);
    await waitFor(() => expect(store().sync?.ackedGameSeq).toBe(store().localSeq));
    live.stop(); await first.dispose();
    // Clean local (fully acknowledged); the remote checkpoint is then tampered.
    const localBefore = store().game;
    const tampered = JSON.parse((await b.get(`${root}/checkpoint`)) as string) as { game: StorytellerLobbyRecord; roster: Record<string, string> };
    tampered.game.seatOrder = tampered.game.seatOrder.slice(1); // omit a legitimate seat
    await seedCheckpoint(b, tampered.game, tampered.roster);
    const restore = observeRestore();
    const writer = writerFor(b, session.id);
    disposals.push(() => writer.dispose());
    const writeLogBefore = b.writeLog.length;

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);

    expect(restore.calls).toBe(0);
    expect(store().game).toBe(localBefore);
    expect(b.writeLog.slice(writeLogBefore).filter((e) => isProjectionWrite(e.path))).toEqual([]);
  });

  it("DIRTY local game + malformed checkpoint: the distinct invalid_checkpoint_dirty_local outcome -- local work preserved, malformed game neither restored nor published", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, session } = await openLobby(b);
    store().newGame("tb", { plannedPlayerCount: 3 });
    store().setLobby(lobby);
    const first = writerFor(b, session.id);
    const live = await startStorytellerSession(b, lobby, first);
    await waitFor(() => expect(store().sync?.ackedGameSeq).toBe(store().localSeq));
    live.stop(); await first.dispose();
    store().addPlayer("Unacknowledged Local Edit");
    expect(store().localSeq).toBeGreaterThan(store().sync!.ackedGameSeq);
    const localBefore = store().game;
    const tampered = JSON.parse((await b.get(`${root}/checkpoint`)) as string) as { game: StorytellerLobbyRecord; roster: Record<string, string> };
    tampered.game.seatOrder.push("toString");
    await seedCheckpoint(b, tampered.game, tampered.roster);
    const checkpointBefore = await b.get(`${root}/checkpoint`);
    const restore = observeRestore();
    const writer = writerFor(b, session.id);
    const writeLogBefore = b.writeLog.length;

    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("incoherent");
    expect(useSessionRuntime.getState().reconnect).toEqual({ status: "incoherent", reason: "invalid_checkpoint_dirty_local" });
    expect(restore.calls).toBe(0);
    expect(store().game).toBe(localBefore);
    expect(b.writeLog.slice(writeLogBefore).filter((e) => isProjectionWrite(e.path))).toEqual([]);
    expect(await b.get(`${root}/checkpoint`)).toEqual(checkpointBefore);
  });

  it("explicit CONFLICT resolution 'useRemote' against a checkpoint that turned malformed under the same guard is 'stale' -- never applied, never published", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, session } = await openLobby(b);
    store().newGame("tb", { plannedPlayerCount: 3 });
    store().setLobby(lobby);
    const first = writerFor(b, session.id);
    const live = await startStorytellerSession(b, lobby, first);
    await waitFor(() => expect(store().sync?.ackedGameSeq).toBe(store().localSeq));
    live.stop(); await first.dispose();
    store().addPlayer("Dirty Local Edit");
    // A genuinely separate device commits a valid, different game.
    const foreign = writerFor(b, session.id);
    await foreign.start();
    const foreignGame = { ...clone(await b.get(`${root}/storyteller`) as unknown as StorytellerLobbyRecord), day: 5 };
    await writeProjections({ backend: foreign, code, stState: foreignGame, registry: buildRegistry(troubleBrewing), online: {}, membership: {} });
    await foreign.dispose();
    const writer = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });
    expect(recovered.outcome).toBe("conflict");
    // The checkpoint content then becomes malformed without the guard moving.
    const guardBefore = await b.get(`${root}/writeGuard`);
    const tampered = JSON.parse((await b.get(`${root}/checkpoint`)) as string) as { game: StorytellerLobbyRecord; roster: Record<string, string> };
    tampered.game.seatOrder = tampered.game.seatOrder.slice(1);
    await seedCheckpoint(b, tampered.game, tampered.roster);
    expect(await b.get(`${root}/writeGuard`)).toEqual(guardBefore);
    const localBefore = store().game;
    const restore = observeRestore();
    const writeLogBefore = b.writeLog.length;

    expect(await resolveReconnectConflict("useRemote")).toBe("stale");

    expect(restore.calls).toBe(0);
    expect(store().game).toBe(localBefore);
    expect(b.writeLog.slice(writeLogBefore).filter((e) => isProjectionWrite(e.path))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C (positive): valid legacy and current checkpoints with multi-seat
// geometry still recover.
// ---------------------------------------------------------------------------
describe("Phase 9R.5 C: valid v13-v17 checkpoints with coherent multi-seat geometry still recover", () => {
  const player = (id: string, seat: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, name: id.toUpperCase(), seat, joinedAt: 1, actualRole: "chef",
    shownRole: null, shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
    alive: true, ghostVote: true, abilityUsed: false, statuses: {}, reminders: [], stNotes: "", isTraveler: false,
    ...over,
  });
  const empty = (id: string, seat: number, over: Record<string, unknown> = {}) =>
    player(id, seat, { name: "", actualRole: "", isEmpty: true, ...over });
  /** Seat order deliberately differs from key/creation order: c, a, e, b. */
  const legacyGame = (version: 13 | 14 | 15 | 16 | 17): Record<string, unknown> => {
    const structured = version >= 14 ? { effects: [] } : { statuses: { poisoned: true }, reminders: ["Red Herring"] };
    const identity = (id: string) => (version >= 17 ? { participantId: `pt-${id}` } : {});
    return {
      code, storytellerUid: "host", scriptId: "tb", phase: "setup", day: 0, notes: "",
      players: {
        a: player("a", 1, { ...structured, ...identity("a") }),
        b: player("b", 3, { ...structured, ...identity("b") }),
        c: player("c", 0, { ...structured, ...identity("c") }),
        e: empty("e", 2, version >= 14 ? { effects: [] } : {}),
      },
      seatOrder: ["c", "a", "e", "b"], nightProgress: {},
      fabled: [], bluffs: [], lorics: [], rolePool: [],
      plannedPlayerCount: 4, plannedTravelerCount: 0, pendingPlayers: {},
      ...(version >= 15 ? { history: [] } : {}),
      ...(version >= 16 ? { informationDeliveries: [] } : {}),
    };
  };

  it.each([13, 14, 15, 16, 17] as const)("v%s checkpoint recovers with its seat geometry exactly as stored", async (version) => {
    const b = new MemoryRoomBackend();
    await seedCheckpoint(b, legacyGame(version));
    const { lobby, session } = await openLobby(b);
    store().setLobby(lobby);
    const writer = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    const g = store().game!;
    expect(g.seatOrder).toEqual(["c", "a", "e", "b"]);
    expect(Object.keys(g.players).sort()).toEqual(["a", "b", "c", "e"]);
    g.seatOrder.forEach((id, index) => { expect(g.players[id]!.id).toBe(id); expect(g.players[id]!.seat).toBe(index); });
    expect(g.players.e!.isEmpty).toBe(true);
    if (version === 17) expect(g.players.a!.participantId).toBe("pt-a");
  });

  it("a legacy (v13) checkpoint omitting a player is still invalid after migration -- migration never repairs geometry", async () => {
    const b = new MemoryRoomBackend();
    const g = legacyGame(13);
    g.seatOrder = ["c", "a", "e"];
    await seedCheckpoint(b, g);
    const { lobby, session } = await openLobby(b);
    store().setLobby(lobby);
    const restore = observeRestore();
    const writer = writerFor(b, session.id);
    disposals.push(() => writer.dispose());
    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(restore.calls).toBe(0);
    expect(store().game).toBeNull();
  });
});
