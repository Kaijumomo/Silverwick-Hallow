// Phase 9R.2 Astra remediation R2: v17 identity evidence must be recognized
// wherever the v17 schema put it -- including current Effect/Reminder
// sourceParticipant -- so malformed CURRENT-version state is always judged
// (and rejected) as v17, never classified as v16 and silently "repaired" by
// v16 -> v17 migration. Genuine v16 and truly markerless all-empty games
// keep migrating exactly as before.
//
// The all-empty-with-identity-evidence fixtures are built through real store
// commands: in Setup, an Effect/Reminder sourced by a seated player may sit
// on an empty seat, and that player may then be unseated -- leaving every
// seat empty, no ParticipantId, no History, no delivery, yet a v17
// sourceParticipant. The remote-path tests drive the real production
// chokepoint (startStorytellerSession -> readCheckpoint ->
// detectLegacyGameVersion -> migration/current parse -> recovery).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { detectLegacyGameVersion, hasV17IdentityEvidence, migrateGameEntry } from "@/stores/gameMigration";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";

const code = "VDET2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
const store = () => useStorytellerStore.getState();
type Game = StorytellerLobbyRecord & Record<string, unknown>;

function resetStore() {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: {},
  });
}
beforeEach(() => {
  resetStore();
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

const persisted = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Every seat empty, no ParticipantId, no History, no delivery -- but one
 * Effect (or Reminder) whose v17 sourceParticipant names a player who has
 * since been unseated. Built through real Setup commands. */
function allEmptyWithSource(kind: "effect" | "reminder"): Game {
  store().newGame("tb", { plannedPlayerCount: 3 });
  store().addPlayerToSeat("Alice");
  const [alice, carrier] = store().game!.seatOrder as [string, string];
  if (kind === "effect") {
    expect(store().addEffect(carrier, { type: "marked", sourcePlayer: alice, lifetime: { kind: "manual" } })).not.toBeNull();
  } else {
    expect(store().addReminder(carrier, { label: "Chosen", sourcePlayer: alice, lifetime: { kind: "manual" } })).not.toBeNull();
  }
  expect(store().unseatPlayer(alice)).toBe(true);
  const game = persisted({ ...store().game!, code, storytellerUid: "host" }) as Game;
  // Genuinely none of the pre-remediation markers:
  expect(Object.values(game.players).every((p) => p.isEmpty && !("participantId" in p))).toBe(true);
  expect(game.history).toEqual([]);
  expect(game.informationDeliveries).toEqual([]);
  expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
  return game;
}

/** A truly markerless all-empty game (no v17 evidence anywhere). */
function markerless(): Game {
  store().newGame("tb", { plannedPlayerCount: 3 });
  return persisted({ ...store().game!, code, storytellerUid: "host" }) as Game;
}

/** A retired, v16-shaped History record: exactly what a repairing v16 -> v17
 * migration would silently convert into a valid-looking legacy ref. */
const retiredHistoryRecord = (playerId: string) => ({
  id: "h-retired", category: "life", playerId,
  change: { kind: "value", from: { alive: true }, to: { alive: false } },
});

describe("R2-A / R2-B: all-empty games that still carry v17 Effect/Reminder source identity", () => {
  it.each(["effect", "reminder"] as const)("an all-empty game with a valid v17 %s sourceParticipant is detected as v17", (kind) => {
    const game = allEmptyWithSource(kind);
    expect(hasV17IdentityEvidence(game)).toBe(true);
    expect(detectLegacyGameVersion(game)).toBe(17);
  });
});

describe("R2-C: malformed current-version History alongside that evidence", () => {
  it.each(["effect", "reminder"] as const)("%s evidence + a retired v16 History record: v17, never migrated, rejected -- locally and directly", (kind) => {
    const game = allEmptyWithSource(kind);
    game.history = [retiredHistoryRecord(game.seatOrder[0]!)] as never;
    expect(detectLegacyGameVersion(game)).toBe(17);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
    // Even a caller that believes it holds v16 data cannot get it repaired:
    // the v16 -> v17 step refuses to touch an entry carrying v17 evidence.
    const entry = structuredClone(game);
    migrateGameEntry(entry, 16, { kind: "canonical-only" });
    expect(entry).toEqual(game);
    expect(StorytellerGamePersistedSchema.safeParse(entry).success).toBe(false);
    // Local persisted state, whether tagged current or (contradictorily) v16.
    migrateStoreState({ game: structuredClone(game), undoStack: [] }, 18);
    expect(takeMigrationResetFlag()).toBe(true);
    migrateStoreState({ game: structuredClone(game), undoStack: [] }, 16);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});

describe("R2-D: malformed v17 markers are still v17 evidence (presence, not validity)", () => {
  const MALFORMED: [string, (g: Game) => void][] = [
    ["Effect sourceParticipant (a bare string)", (g) => {
      g.players[g.seatOrder[1]!]!.effects = [{ id: "x", type: "marked", lifetime: { kind: "manual" }, sourceParticipant: "garbage" }] as never;
    }],
    ["Reminder sourceParticipant (a legacy ref smuggling a participantId)", (g) => {
      g.players[g.seatOrder[1]!]!.reminders = [{ id: "r", label: "Chosen", lifetime: { kind: "manual" },
        sourceParticipant: { kind: "legacy", playerId: "a", participantId: "invented" } }] as never;
    }],
    ["a seat participantId (a number, on an empty seat)", (g) => {
      (g.players[g.seatOrder[1]!] as Record<string, unknown>).participantId = 42;
    }],
    ["History participant (missing participantId)", (g) => {
      g.history.push({ id: "h-bad", category: "life", participant: { kind: "participant", playerId: "a", nameAtTime: "Alice" },
        change: { kind: "value", from: {}, to: {} } } as never);
    }],
    ["History provenance sourceParticipant (null)", (g) => {
      g.history.push({ id: "h-prov", category: "life", provenance: { sourceParticipant: null },
        change: { kind: "value", from: {}, to: {} } } as never);
    }],
    ["History Effect snapshot sourceParticipant (a number)", (g) => {
      g.history.push({ id: "h-item", category: "effect",
        change: { kind: "added", item: { id: "x", type: "t", lifetime: { kind: "manual" }, sourceParticipant: 7 } } } as never);
    }],
    ["delivery recipient (a bare PlayerId string)", (g) => {
      g.informationDeliveries = [{ id: "d", recipient: "a", actualRole: "chef", informationActionId: "chef-first-night", values: [] }] as never;
    }],
    ["delivery provenance sourceParticipant (an empty object)", (g) => {
      g.informationDeliveries = [{ id: "d", recipientPlayerId: "a", actualRole: "chef", informationActionId: "chef-first-night",
        values: [], provenance: { sourceParticipant: {} } }] as never;
    }],
    ["Player-valued Information participants (not an array)", (g) => {
      g.informationDeliveries = [{ id: "d", recipientPlayerId: "a", actualRole: "washerwoman", informationActionId: "washerwoman-first-night",
        values: [{ requirementId: "players", kind: "player", participants: "nope" }] }] as never;
    }],
  ];

  it.each(MALFORMED)("%s: detected as v17, never migrated, and rejected", (_label, inject) => {
    const game = markerless();
    game.history = [retiredHistoryRecord(game.seatOrder[0]!)] as never; // something a repairing migration would "fix"
    expect(detectLegacyGameVersion(game)).toBe(16); // control: no v17 evidence yet
    inject(game);
    expect(detectLegacyGameVersion(game)).toBe(17);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
    const entry = structuredClone(game);
    migrateGameEntry(entry, 16, { kind: "canonical-only" });
    expect(entry).toEqual(game);
  });

  it("generic payloads are never scanned for key names: a 'sourceParticipant' inside a life-category snapshot or a value change is not v17 evidence", () => {
    const game = markerless();
    game.history = [
      retiredHistoryRecord(game.seatOrder[0]!),
      { id: "h-free", category: "life", playerId: game.seatOrder[0]!,
        change: { kind: "added", item: { sourceParticipant: { kind: "legacy", playerId: "a" } } } },
      { id: "h-value", category: "identity", playerId: game.seatOrder[0]!,
        change: { kind: "value", from: { sourceParticipant: "x" }, to: { participantId: "y" } } },
    ] as never;
    expect(hasV17IdentityEvidence(game)).toBe(false);
    expect(detectLegacyGameVersion(game)).toBe(16);
  });
});

describe("R2-E / R2-F: genuine v16 and truly markerless games still migrate exactly as before", () => {
  it("R2-E: a genuine v16 all-empty game with a raw sourcePlayer (no v17 evidence) is v16, migrates to a legacy ref, and validates", () => {
    const game = markerless();
    game.players[game.seatOrder[1]!]!.effects = [{ id: "x", type: "marked", lifetime: { kind: "manual" }, sourcePlayer: "a" }] as never;
    game.history = [retiredHistoryRecord(game.seatOrder[0]!)] as never;
    expect(detectLegacyGameVersion(game)).toBe(16);
    migrateGameEntry(game, 16, { kind: "canonical-only" });
    expect(game.players[game.seatOrder[1]!]!.effects[0]!.sourceParticipant).toEqual({ kind: "legacy", playerId: "a" });
    expect(game.history[0]!.participant).toEqual({ kind: "legacy", playerId: game.seatOrder[0]! });
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
  });

  it("R2-F: a truly markerless all-empty game is detected as v16, migrates as a byte-identical no-op, and validates", () => {
    const game = markerless();
    const before = JSON.stringify(game);
    expect(detectLegacyGameVersion(game)).toBe(16);
    migrateGameEntry(game, 16, { kind: "canonical-only" });
    expect(JSON.stringify(game)).toBe(before);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
  });
});

describe("R2-G: the real remote checkpoint path (readCheckpoint -> detect -> migrate/parse -> recovery)", () => {
  async function recoverFrom(game: unknown) {
    const b = new MemoryRoomBackend();
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    await b.set(`${root}/checkpoint`, JSON.stringify({ game, roster: {} }));
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    resetStore();
    store().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const writeLogBefore = b.writeLog.length;
    return { b, lobby, writer, writeLogBefore, start: () => startStorytellerSession(b, lobby, writer) };
  }
  const isProjectionWrite = (path: string) =>
    path === `${root}/storyteller` || path === `${root}/public` || path === `${root}/checkpoint` || path.startsWith(`${root}/player/`);

  it.each(["effect", "reminder"] as const)("malformed current-version state (%s evidence + retired History) is rejected and never adopted or republished", async (kind) => {
    const game = allEmptyWithSource(kind);
    game.history = [retiredHistoryRecord(game.seatOrder[0]!)] as never;
    const { b, writeLogBefore, start } = await recoverFrom(game);
    await expect(start()).rejects.toThrow(SnapshotValidationError);
    expect(store().game).toBeNull();
    expect(b.writeLog.slice(writeLogBefore).filter((w) => isProjectionWrite(w.path))).toEqual([]);
    expect(JSON.parse(await b.get(`${root}/checkpoint`) as string).game.history[0].playerId).toBe(game.seatOrder[0]);
  });

  it("valid all-empty state carrying v17 Effect evidence recovers as v17: its source ref is kept exactly, never re-migrated, nothing fabricated", async () => {
    const game = allEmptyWithSource("effect");
    const { start } = await recoverFrom(game);
    const recovered = await start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    const carrier = game.seatOrder[1]!;
    expect(store().game!.players[carrier]!.effects).toEqual(game.players[carrier]!.effects);
    expect(Object.values(store().game!.players).every((p) => p.isEmpty && !("participantId" in p))).toBe(true);
  });

  it("genuine v16 all-empty state with a raw sourcePlayer still recovers through the real path, as an unresolved legacy ref", async () => {
    const game = markerless();
    const carrier = game.seatOrder[1]!;
    game.players[carrier]!.effects = [{ id: "x", type: "marked", lifetime: { kind: "manual" }, sourcePlayer: "a" }] as never;
    const { start } = await recoverFrom(game);
    const recovered = await start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(store().game!.players[carrier]!.effects).toEqual([
      { id: "x", type: "marked", lifetime: { kind: "manual" }, sourceParticipant: { kind: "legacy", playerId: "a" } },
    ]);
  });
});
