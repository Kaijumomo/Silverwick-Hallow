// Phase 9R.1 (Finding B1): remote checkpoint recovery must support the same
// intentionally-supported legacy game evolution (v13->v16) local persisted
// state already migrates through -- see gameMigration.ts and
// storytellerSync.ts's readCheckpoint. These tests seed a RAW, hand-built
// legacy-shaped checkpoint blob directly into a MemoryRoomBackend (exactly
// what an OLDER app version would have written -- production writeProjections
// can only ever write the CURRENT in-memory shape, so it cannot be used to
// produce a legacy fixture) and drive recovery entirely through the real
// production startStorytellerSession/readCheckpoint chokepoint, never a
// direct unit call into an unexported internal.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";

const code = "LGCY2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: {},
  });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function seedLegacyCheckpoint(b: MemoryRoomBackend, game: Record<string, unknown>, roster: Record<string, string> = {}) {
  await b.set(`${root}/checkpoint`, JSON.stringify({ game, roster }));
}

/** Sets up a real lobby/session with NO local game and NO local sync
 * metadata for this scope -- the "brand new device, never seen this lobby
 * before" case decideReconnect's own case 3 exists for (`!scopedSync` ->
 * RESTORE), and exactly the situation an app upgrade recovering an old
 * remote checkpoint puts a Storyteller in. */
async function freshLobby(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  return { session, lobby };
}

const v13Player = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "a", name: "Alice", seat: 0, joinedAt: 1, actualRole: "chef",
  shownRole: null, shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
  alive: true, ghostVote: true, abilityUsed: false,
  statuses: { poisoned: true }, reminders: ["Red Herring"], stNotes: "", isTraveler: false,
  ...over,
});

const baseLegacyGame = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  code, storytellerUid: "host", scriptId: "tb", phase: "setup", day: 0, notes: "",
  players: { a: v13Player() }, seatOrder: ["a"], nightProgress: {},
  fabled: [], bluffs: [], lorics: [], rolePool: [],
  plannedPlayerCount: 1, plannedTravelerCount: 0, pendingPlayers: {},
  ...overrides,
});

describe("Phase 9R.1 Finding B1: remote checkpoint migration", () => {
  it("v13 remote checkpoint recovers into current v16 semantics: alignment derived, statuses -> Effects, reminder strings -> structured records, empty History/InformationDeliveries created", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame(); // no effects, no history, no informationDeliveries -- genuinely v13-shaped
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);

    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    const game = useStorytellerStore.getState().game!;
    // Ordinary Actual Alignment legitimately derivable from a resolvable
    // Role (chef -> townsfolk -> good) -- never invented for a Traveler,
    // never invented when unresolvable.
    expect(game.players.a!.actualAlignment).toBe("good");
    // Legacy `statuses.poisoned` boolean became its own deterministic
    // manual Effect, and the boolean itself was cleared.
    expect(game.players.a!.effects).toEqual([{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" } }]);
    expect(game.players.a!.statuses.poisoned).toBeUndefined();
    // Legacy plain-string reminder became a structured manual/legacy record,
    // preserving its text.
    expect(game.players.a!.reminders).toEqual([{ id: "legacy-a-0", label: "Red Herring", lifetime: { kind: "manual" } }]);
    // No History or Information Delivery is ever fabricated for a game that
    // never tracked either -- both simply start empty.
    expect(game.history).toEqual([]);
    expect(game.informationDeliveries).toEqual([]);
    // Already-present v13 fields survive untouched.
    expect(game.plannedTravelerCount).toBe(0);
    // restoreRemoteCheckpoint always clears Undo on any accepted remote
    // restore -- unchanged by this fix.
    expect(useStorytellerStore.getState().undoStack).toEqual([]);

    // Writer/reconnect fencing is unaffected by checkpoint migration: a
    // second writer is still correctly denied while this lease holds.
    const second = new SessionWriter(b, code, session.id);
    await expect(second.start()).rejects.toThrow(/Another Storyteller/);
  });

  it("v13 remote checkpoint: an unresolvable Role leaves alignment unresolved rather than invented, and a Traveler's unresolved alignment is never invented", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({
      players: {
        a: v13Player({ actualRole: "not-a-real-role", statuses: {}, reminders: [] }),
        t: v13Player({ id: "t", name: "Traveler", seat: 1, actualRole: "thief", isTraveler: true, statuses: {}, reminders: [] }),
      },
      seatOrder: ["a", "t"],
      plannedPlayerCount: 2,
    });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    const game = useStorytellerStore.getState().game!;
    expect(game.players.a!.actualAlignment).toBeUndefined(); // unresolvable role -- never invented
    expect(game.players.t!.actualAlignment).toBeUndefined(); // Traveler -- never invented from character
  });

  it("v14 remote checkpoint (structured live-state already present) recovers into current v16 semantics, adding only empty History and Information Delivery", async () => {
    const b = new MemoryRoomBackend();
    const v14Game = baseLegacyGame({
      players: {
        a: v13Player({
          statuses: {}, reminders: [],
          actualAlignment: "evil", // already explicitly set -- must survive verbatim, never re-derived
          effects: [{ id: "manual:drunk", type: "drunk", lifetime: { kind: "manual" } }],
        }),
      },
    });
    await seedLegacyCheckpoint(b, v14Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    const game = useStorytellerStore.getState().game!;
    expect(game.players.a!.actualAlignment).toBe("evil"); // real v14 content, never overwritten
    expect(game.players.a!.effects).toEqual([{ id: "manual:drunk", type: "drunk", lifetime: { kind: "manual" } }]);
    expect(game.history).toEqual([]);
    expect(game.informationDeliveries).toEqual([]);
    expect(useStorytellerStore.getState().undoStack).toEqual([]);
  });

  it("v15 remote checkpoint (History already present) recovers into current v16 semantics, preserving existing History and adding only empty Information Delivery", async () => {
    const b = new MemoryRoomBackend();
    const existingHistoryRecord = {
      id: "h1", category: "life", playerId: "a",
      change: { kind: "value", from: { alive: true }, to: { alive: false } },
    };
    const v15Game = baseLegacyGame({
      phase: "night", day: 1,
      players: {
        a: v13Player({ statuses: {}, reminders: [], actualAlignment: "good", effects: [], alive: false }),
      },
      history: [existingHistoryRecord],
    });
    await seedLegacyCheckpoint(b, v15Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    const game = useStorytellerStore.getState().game!;
    expect(game.history).toEqual([existingHistoryRecord]); // real History content survives completely unchanged
    expect(game.informationDeliveries).toEqual([]); // added, never fabricated
    expect(useStorytellerStore.getState().undoStack).toEqual([]);
  });

  it("v16 remote checkpoint (already current) recovers with no semantic mutation", async () => {
    const b = new MemoryRoomBackend();
    const existingDelivery = {
      id: "d1", recipientPlayerId: "a", actualRole: "chef", informationActionId: "chef-first-night",
      values: [{ requirementId: "pairs", kind: "number", value: 1 }],
    };
    const v16Game = baseLegacyGame({
      phase: "night", day: 1,
      players: { a: v13Player({ statuses: {}, reminders: [], actualAlignment: "good", effects: [] }) },
      history: [],
      informationDeliveries: [existingDelivery],
    });
    await seedLegacyCheckpoint(b, v16Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    const game = useStorytellerStore.getState().game!;
    expect(game.informationDeliveries).toEqual([existingDelivery]);
    expect(game.players.a!.actualAlignment).toBe("good");
    expect(useStorytellerStore.getState().undoStack).toEqual([]);
  });

  // A malformed/unsupported checkpoint with NO evidenced local claim at
  // stake (no local game, no sync) hits decideReconnect's own
  // "invalid_checkpoint" (not "_dirty_local") branch — startStorytellerSession
  // preserves the pre-9C.2A hard-failure behavior for exactly that reason by
  // throwing SnapshotValidationError rather than returning a resolved
  // outcome (see storytellerSync.ts). Migration never weakens that gate:
  // these prove it still fires for shapes migration itself now refuses.
  it("a malformed/unsupported remote checkpoint (older than the supported v13 floor) still fails safely and never crashes or silently invents recovery", async () => {
    const b = new MemoryRoomBackend();
    // Pre-v13: no plannedTravelerCount, no effects, no history, no
    // informationDeliveries -- outside the supported remote-recovery floor.
    const tooOldGame = {
      code, storytellerUid: "host", scriptId: "tb", phase: "setup", day: 0, notes: "",
      players: { a: v13Player() }, seatOrder: ["a"], nightProgress: {},
      fabled: [], bluffs: [], lorics: [], rolePool: [],
      plannedPlayerCount: 1, pendingPlayers: {}, // plannedTravelerCount deliberately omitted
    };
    await seedLegacyCheckpoint(b, tooOldGame);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    // Local state (already null/empty here) is left exactly as it was --
    // never a silent, guessed recovery.
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a structurally corrupt remote checkpoint (invalid JSON) still fails safely", async () => {
    const b = new MemoryRoomBackend();
    await b.set(`${root}/checkpoint`, "{not valid json");
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a remote checkpoint whose migrated game fails final schema validation still fails safely (never a partial/corrupt adoption)", async () => {
    const b = new MemoryRoomBackend();
    // v13-shaped (so it is structurally detected and migration is attempted)
    // but with a field that cannot validate even after migration.
    const brokenGame = baseLegacyGame({ day: "not-a-number" });
    await seedLegacyCheckpoint(b, brokenGame);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a remote checkpoint whose (migrated) lobby code does not match the expected lobby is still rejected", async () => {
    const b = new MemoryRoomBackend();
    const wrongCodeGame = baseLegacyGame({ code: "WRONG999" });
    await seedLegacyCheckpoint(b, wrongCodeGame);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });
});
