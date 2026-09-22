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
import type { StorytellerLobbyRecord } from "@/stores/types";
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

// ---------------------------------------------------------------------------
// Phase 9R.1 Astra remediation (Finding A2): remote custom/homebrew
// alignment must never be invented from the RECOVERING device's own
// unrelated current customScripts -- a remote checkpoint carries no
// durable script data of its own (see readCheckpoint's own doc comment),
// so a script id that happens to collide with a locally-redefined
// homebrew Role (same id, different type/alignment) must never let
// migration derive an Actual Alignment the checkpoint itself never
// proved. See MigrationScriptEvidence (gameMigration.ts).
// ---------------------------------------------------------------------------
describe("Phase 9R.1 Finding A2: remote custom/homebrew alignment must not be invented from unrelated local customScripts", () => {
  const conflictingHomebrew = (scriptId: string) => ({
    id: scriptId, name: "Conflicting Local Homebrew",
    characters: [{ id: "doctor-esque", name: "Doctor-esque", type: "demon" as const, ability: "Kills." }],
  });

  it("a v13 remote checkpoint for a custom script recovers with Actual Alignment left UNRESOLVED when the recovering device's local customScripts define the SAME script/Role id with a CONFLICTING type", async () => {
    const b = new MemoryRoomBackend();
    const homebrewScriptId = "hb-conflict-1";
    // The checkpoint's original game used this homebrew script id -- the
    // checkpoint itself carries no script/Role data, only the scriptId
    // string and each player's actualRole id.
    const v13Game = baseLegacyGame({
      scriptId: homebrewScriptId,
      players: { a: v13Player({ actualRole: "doctor-esque", statuses: {}, reminders: [] }) },
    });
    await seedLegacyCheckpoint(b, v13Game);

    // The RECOVERING device's current local customScripts happen to
    // define the SAME script id and SAME Role id as a Demon (evil) -- an
    // entirely different, conflicting definition from whatever actually
    // produced this checkpoint. This unrelated local evidence must never
    // be consulted for remote recovery.
    useStorytellerStore.setState({ customScripts: { [homebrewScriptId]: conflictingHomebrew(homebrewScriptId) } });

    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    // Never fabricated from the recovering device's own unrelated local
    // definition -- unresolved is the only safe outcome.
    expect(useStorytellerStore.getState().game!.players.a!.actualAlignment).toBeUndefined();
  });

  it("ordinary canonical built-in alignment is still correctly derived during remote recovery -- only built-in scripts remain objectively identifiable evidence", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame(); // scriptId "tb", actualRole "chef" -- a real built-in
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.players.a!.actualAlignment).toBe("good");
  });

  it("an already-explicit legacy Actual Alignment is preserved verbatim during remote recovery, even when local customScripts conflict", async () => {
    const b = new MemoryRoomBackend();
    const homebrewScriptId = "hb-conflict-2";
    const v13Game = baseLegacyGame({
      scriptId: homebrewScriptId,
      players: {
        a: v13Player({
          actualRole: "doctor-esque", statuses: {}, reminders: [],
          actualAlignment: "good", // already explicitly recorded by the original checkpoint
        }),
      },
    });
    await seedLegacyCheckpoint(b, v13Game);
    useStorytellerStore.setState({ customScripts: { [homebrewScriptId]: conflictingHomebrew(homebrewScriptId) } });

    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    // Preserved verbatim, never re-derived from anything.
    expect(useStorytellerStore.getState().game!.players.a!.actualAlignment).toBe("good");
  });

  it("Traveler rules remain unchanged during remote recovery: an unresolved Traveler alignment is never invented, even from a conflicting local homebrew definition", async () => {
    const b = new MemoryRoomBackend();
    const homebrewScriptId = "hb-conflict-3";
    const v13Game = baseLegacyGame({
      scriptId: homebrewScriptId,
      players: { a: v13Player({ actualRole: "doctor-esque", isTraveler: true, statuses: {}, reminders: [] }) },
    });
    await seedLegacyCheckpoint(b, v13Game);
    useStorytellerStore.setState({ customScripts: { [homebrewScriptId]: conflictingHomebrew(homebrewScriptId) } });

    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.players.a!.actualAlignment).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 9R.1 Astra remediation (Finding A3): migration transforms a VALID
// legacy representation -- it does not repair arbitrary malformed data. A
// genuinely absent field may be initialized as the schema intends; a field
// that is PRESENT but malformed must be left untouched so the checkpoint
// fails the final schema-validation gate, never silently concealed behind
// a validly-shaped default.
// ---------------------------------------------------------------------------
describe("Phase 9R.1 Finding A3: migration does not sanitize malformed legacy data into valid-looking state", () => {
  it("legacy statuses.poisoned: true migrates into an active manual Effect (positive control)", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({ players: { a: v13Player({ statuses: { poisoned: true }, reminders: [] }) } });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.players.a!.effects)
      .toEqual([{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" } }]);
  });

  it("legacy statuses.poisoned: false does NOT become an active Effect", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({ players: { a: v13Player({ statuses: { poisoned: false }, reminders: [] }) } });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.players.a!.effects).toEqual([]);
  });

  it('legacy statuses.poisoned: "false" -- a truthy STRING, not the boolean false -- is REJECTED, never migrated as an active Effect, and the whole malformed checkpoint fails safely rather than silently passing', async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({ players: { a: v13Player({ statuses: { poisoned: "false" }, reminders: [] }) } });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a malformed but PRESENT `effects` field is never silently replaced with an empty array -- the checkpoint fails safely", async () => {
    const b = new MemoryRoomBackend();
    // Still detected as v13 (effects is not a real array), so migration's
    // v13->v14 block runs and reaches this exact malformed field.
    const v13Game = baseLegacyGame({
      players: { a: v13Player({ effects: "corrupted-not-an-array", statuses: {}, reminders: [] }) },
    });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a malformed but PRESENT `history` field is never silently replaced with an empty array -- the checkpoint fails safely", async () => {
    const b = new MemoryRoomBackend();
    // A real `effects` array makes this detected as v14 (the v13 block is
    // skipped entirely), isolating the history-defaulting path.
    const v14Game = baseLegacyGame({
      players: { a: v13Player({ statuses: {}, reminders: [], effects: [] }) },
      history: "corrupted-not-an-array",
    });
    await seedLegacyCheckpoint(b, v14Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a malformed but PRESENT `informationDeliveries` field is never silently replaced with an empty array -- the checkpoint fails safely", async () => {
    const b = new MemoryRoomBackend();
    const v15Game = baseLegacyGame({
      players: { a: v13Player({ statuses: {}, reminders: [], effects: [] }) },
      history: [],
      informationDeliveries: "corrupted-not-an-array",
    });
    await seedLegacyCheckpoint(b, v15Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a malformed player shape (a string, not an object) fails safely through the ordinary invalid-checkpoint outcome -- never an uncaught migration exception", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({ players: { a: "not-a-player-object" } });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a null player value also fails safely, never crashing migration with an uncaught exception", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({ players: { a: null } });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 9R.1 Astra remediation (Finding A4, expanded by Finding F1): a
// checkpoint can be valid JSON and pass the current Zod game schema while
// still containing something the real Firebase RTDB SDK refuses to write.
// Adopting such a checkpoint as Current State would only surface the
// problem later, at the next real Firebase projection. See
// firebaseWriteCompatibility.test.ts for pure validateFirebaseWritableValue
// coverage (key legality including control characters/DEL, non-finite
// numbers, write depth, write path byte length, and real-destination
// context), the "Finding F1" describe block further below in this file for
// the expanded production-wiring proofs, and rules.spec.ts's "Finding A4"/
// "Finding F1" describe blocks for the real Firebase RTDB emulator proofs
// (SDK-level rejection + gated recovery refusing it before adoption, both
// against the real emulator).
// ---------------------------------------------------------------------------
describe("Phase 9R.1 Finding A4: Firebase compatibility gate before checkpoint adoption", () => {
  it('a structurally current-valid (schema-valid v16) checkpoint containing a Firebase-illegal nested key (statuses["bad.key"]) is rejected BEFORE restore -- Current State/Undo/localSeq unchanged, and no projection/flush is ever attempted', async () => {
    const b = new MemoryRoomBackend();
    const v16Game = baseLegacyGame({
      phase: "night", day: 1,
      players: { a: v13Player({ statuses: { "bad.key": true }, reminders: [], effects: [] }) },
      history: [], informationDeliveries: [],
    });
    await seedLegacyCheckpoint(b, v16Game);
    const checkpointBefore = await b.get(`${root}/checkpoint`);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
    expect(useStorytellerStore.getState().undoStack).toEqual([]);
    expect(useStorytellerStore.getState().localSeq).toBe(0);
    // No projection/flush was ever attempted against the invalid state --
    // the checkpoint the (rejected) recovery read is exactly what was
    // seeded, byte for byte.
    expect(await b.get(`${root}/checkpoint`)).toEqual(checkpointBefore);
  });

  it("a Firebase-illegal key at a deeper nested location (a History record's change.from) is also rejected before restore", async () => {
    const b = new MemoryRoomBackend();
    const v16Game = baseLegacyGame({
      phase: "night", day: 1,
      players: { a: v13Player({ statuses: {}, reminders: [], effects: [] }) },
      history: [{
        id: "h1", category: "life", playerId: "a",
        change: { kind: "value", from: { "bad#key": true }, to: { alive: false } },
      }],
      informationDeliveries: [],
    });
    await seedLegacyCheckpoint(b, v16Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it('a v13 checkpoint whose legacy effect was migrated into an id containing valid punctuation ("manual:poisoned") is NOT rejected by the compatibility gate -- only truly illegal characters reject', async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({
      players: { a: v13Player({ statuses: { poisoned: true }, reminders: ["Red Herring"] }) },
    });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    // "manual:poisoned" (a colon) is valid punctuation Firebase allows.
    expect(useStorytellerStore.getState().game!.players.a!.effects[0]!.id).toBe("manual:poisoned");
  });
});

// ---------------------------------------------------------------------------
// Phase 9R.1 Astra remediation (Finding M1): migration must never throw on
// malformed persisted/checkpoint data. Malformed data SHOULD fail recovery
// -- the defect Astra reproduced was that it escaped as an unexpected
// runtime TypeError (implicit coercion, prototype-property lookup, or a
// null dereference) instead of flowing through the established
// invalid-checkpoint outcome (SnapshotValidationError). Every case below
// must resolve to EITHER a clean rejection (a genuinely malformed field
// that independently fails final schema validation) OR a clean successful
// recovery with alignment correctly left unresolved (a merely-unresolvable
// script id, including a hostile prototype-property name) -- never an
// uncaught exception of any other kind.
// ---------------------------------------------------------------------------
describe("Phase 9R.1 Finding M1: migration never throws on malformed data -- remote checkpoint", () => {
  it("a scriptId with a hostile, non-coercible toString shape ({ toString: 0 }) fails safely via the ordinary invalid-checkpoint outcome, never an uncaught TypeError", async () => {
    const b = new MemoryRoomBackend();
    // scriptId itself is not a string, so this independently fails
    // StorytellerGamePersistedSchema's scriptId: z.string().min(1) --
    // the proof here is that migration reaches that gate at all, rather
    // than throwing "Cannot convert object to primitive value" first.
    const v13Game = baseLegacyGame({ scriptId: { toString: 0 } });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it.each(["__proto__", "constructor", "toString"])(
    'a scriptId of exactly "%s" never resolves an inherited Object.prototype member as a Script during migration -- alignment is left correctly unresolved, and the (pre-existing, unrelated-to-migration) "script cannot be resolved to build a projection" gate still fails safely via SnapshotValidationError, never an uncaught TypeError',
    async (hostileScriptId) => {
      const b = new MemoryRoomBackend();
      // A VALID (non-empty string) scriptId that simply names no real
      // script -- this is schema-valid, so migration/recovery itself
      // succeeds (Current State is set, with alignment correctly left
      // unresolved -- never derived from Object.prototype.__proto__ /
      // .constructor / .toString). The overall session-start call still
      // fails, but through the SAME established, unrelated
      // "no resolvable script exists to build the first projection" gate
      // any genuinely unknown scriptId already hits (see the flush step
      // in storytellerSync.ts) -- never a raw uncaught TypeError.
      const v13Game = baseLegacyGame({ scriptId: hostileScriptId });
      await seedLegacyCheckpoint(b, v13Game);
      const { lobby, session } = await freshLobby(b);
      const writer = new SessionWriter(b, code, session.id);
      disposals.push(() => writer.dispose());

      await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
      // restoreRemoteCheckpoint already ran (before the later flush step
      // that rejected) -- confirm the migrated Current State itself never
      // fabricated an alignment from the hostile scriptId.
      expect(useStorytellerStore.getState().game!.players.a!.actualAlignment).toBeUndefined();
    }
  );

  it("a malformed player.id ({ toString: 0 }) alongside legacy string Reminders fails safely rather than throwing during deterministic Reminder id interpolation", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({
      players: { a: v13Player({ id: { toString: 0 }, statuses: {}, reminders: ["Red Herring"] }) },
    });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a malformed effects array containing null never dereferences null.id -- fails safely rather than throwing", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({
      players: { a: v13Player({ effects: [null], statuses: { poisoned: true }, reminders: [] }) },
    });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a malformed effects array containing another invalid (non-object) entry also fails safely rather than throwing", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame({
      players: { a: v13Player({ effects: ["not-an-effect-object"], statuses: { poisoned: true }, reminders: [] }) },
    });
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a genuinely valid checkpoint still recovers correctly alongside these guards (never over-rejected)", async () => {
    const b = new MemoryRoomBackend();
    const v13Game = baseLegacyGame();
    await seedLegacyCheckpoint(b, v13Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.players.a!.actualAlignment).toBe("good");
  });
});

// ---------------------------------------------------------------------------
// Phase 9R.1 Astra remediation (Finding F1): the Firebase compatibility gate
// (Finding A4) only checked six punctuation characters. The REAL installed
// Firebase RTDB SDK also rejects control characters/DEL in keys, a write
// exceeding the real 32-level MAX_PATH_DEPTH, a write path exceeding the
// real 768-UTF-8-byte MAX_PATH_LENGTH_BYTES (counted from the ACTUAL
// destination the checkpoint will be projected to --
// lobbies/<code>/storyteller -- not from the checkpoint's own root), and
// non-finite numbers reachable through raw JSON text (e.g. `1e400`, which
// JSON.parse silently overflows to `Infinity`) anywhere in an unrestricted
// schema location (HistoryChangeSchema's from/to/item, each typed
// z.record(string, unknown)). See firebaseWriteCompatibility.ts/.test.ts for
// the validator itself and its exhaustive pure-unit boundary/destination-
// context coverage; these tests prove the PRODUCTION WIRING (readCheckpoint,
// calling validateFirebaseWritableValue with the real storyteller/roster
// destination paths) rejects each reproduction atomically, before ever
// adopting it as Current State -- and that a genuinely compliant value,
// including right at each boundary, is never over-rejected.
// ---------------------------------------------------------------------------
describe("Phase 9R.1 Finding F1: expanded Firebase compatibility gate (control characters, non-finite numbers, depth, path bytes)", () => {
  function v16GameWithHistory(historyEntry: Record<string, unknown>): Record<string, unknown> {
    return baseLegacyGame({
      players: { a: v13Player({ statuses: {}, reminders: [], effects: [] }) },
      history: [historyEntry],
      informationDeliveries: [],
    });
  }

  function nestedObject(depth: number): unknown {
    let value: unknown = true;
    for (let i = 0; i < depth; i++) value = { a: value };
    return value;
  }

  function isProjectionWritePath(path: string): boolean {
    return (
      path === `${root}/storyteller` ||
      path === `${root}/public` ||
      path === `${root}/checkpoint` ||
      path.startsWith(`${root}/player/`)
    );
  }

  /**
   * Seeds a genuinely non-trivial Undo/localSeq baseline (AFTER freshLobby,
   * since setLobby itself clears undoStack) before an expected-to-be-
   * rejected recovery attempt, then asserts full atomicity: Current State,
   * Undo, localSeq, and sync's own acknowledgment bookkeeping all survive
   * untouched, and -- Phase 9R.1 F1 hardening note -- directly OBSERVES via
   * the backend's own writeLog that no projection write
   * (storyteller/public/checkpoint/player) was ever attempted, rather than
   * merely inferring it from final-state equality. The Undo comparison is
   * against a REAL deep copy taken before the call (structuredClone), not
   * the same live array reference or a shallow top-level clone -- so an
   * in-place mutation of a nested field somewhere inside an Undo entry
   * would still be caught.
   *
   * `sync` itself is deliberately NOT compared for bit-for-bit equality:
   * startStorytellerSession's ensureSyncScope() call binds a fresh
   * (code, sessionId) scope unconditionally, on every startup attempt,
   * success or failure -- this is ordinary bookkeeping wholly unrelated to
   * checkpoint content. What genuinely proves "no projection was accepted"
   * is that this newly-bound scope's own acknowledgment fields stay at
   * their untouched defaults (never advanced by a real write/ack).
   */
  async function expectRejectedWithoutProjectionAttempt(
    b: MemoryRoomBackend,
    { lobby, session }: Awaited<ReturnType<typeof freshLobby>>
  ) {
    const undoBaseline = [baseLegacyGame({ notes: "pre-existing undo entry" }) as unknown as StorytellerLobbyRecord];
    const undoBaselineDeepCopy = structuredClone(undoBaseline);
    useStorytellerStore.setState({ game: null, undoStack: undoBaseline, localSeq: 7 });
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const writeLogBefore = b.writeLog.length;

    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);

    expect(useStorytellerStore.getState().game).toBeNull();
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBaselineDeepCopy);
    expect(useStorytellerStore.getState().localSeq).toBe(7);
    const sync = useStorytellerStore.getState().sync;
    expect(sync?.ackedGuard).toBeNull();
    expect(sync?.ackedGameSeq).toBe(0);
    expect(sync?.lastAttempt).toBeNull();
    // A lease-claim write to `${root}/writer` (an unrelated, legitimate
    // prerequisite writer.start() performs before ever attempting to read
    // the checkpoint) is expected and fine -- only a PROJECTION write
    // (storyteller/public/checkpoint/player/*) would mean this invalid
    // checkpoint was partially adopted.
    const projectionWrites = b.writeLog.slice(writeLogBefore).filter((entry) => isProjectionWritePath(entry.path));
    expect(projectionWrites).toEqual([]);
  }

  it("a newline (U+000A) in a status key -- Astra's exact reproduction -- is rejected before adoption, atomically", async () => {
    const b = new MemoryRoomBackend();
    const v16Game = baseLegacyGame({
      players: { a: v13Player({ statuses: { "bad\nkey": true }, reminders: [], effects: [] }) },
      history: [], informationDeliveries: [],
    });
    await seedLegacyCheckpoint(b, v16Game);
    await expectRejectedWithoutProjectionAttempt(b, await freshLobby(b));
  });

  it("DEL (U+007F) in a status key -- Astra's exact reproduction -- is rejected before adoption, atomically", async () => {
    const b = new MemoryRoomBackend();
    const v16Game = baseLegacyGame({
      players: { a: v13Player({ statuses: { "bad\u007Fkey": true }, reminders: [], effects: [] }) },
      history: [], informationDeliveries: [],
    });
    await seedLegacyCheckpoint(b, v16Game);
    await expectRejectedWithoutProjectionAttempt(b, await freshLobby(b));
  });

  // Fixed overhead from the real destination through history[0].change.item:
  // base "lobbies/LGCY2345/storyteller" = 29 bytes/depth 3, then
  // +history(1+7) +"0"(1+1) +change(1+6) +item(1+4) = +22 => 51 bytes at
  // the `item` object itself. Pushing one more key of length N adds
  // (1 separator + N) => 52 + N. 52 + 716 = 768 (exactly the limit);
  // 52 + 717 = 769 (one byte past it).
  it("a History record's change.item key of exactly the length that lands the real write path at 768 UTF-8 bytes -- measured from the REAL storyteller projection destination, not the checkpoint's own root -- is still accepted (never over-rejected right at the boundary)", async () => {
    const b = new MemoryRoomBackend();
    const acceptedKey = "x".repeat(716);
    const v16Game = v16GameWithHistory({
      id: "h1", category: "life", playerId: "a",
      change: { kind: "added", item: { [acceptedKey]: true } },
    });
    await seedLegacyCheckpoint(b, v16Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });
    expect(recovered.outcome).toBe("live");
  });

  it("a History record's change.item key one byte past that same real 768-UTF-8-byte write-path limit is rejected before adoption, atomically", async () => {
    const b = new MemoryRoomBackend();
    const rejectedKey = "x".repeat(717);
    const v16Game = v16GameWithHistory({
      id: "h1", category: "life", playerId: "a",
      change: { kind: "added", item: { [rejectedKey]: true } },
    });
    await seedLegacyCheckpoint(b, v16Game);
    await expectRejectedWithoutProjectionAttempt(b, await freshLobby(b));
  });

  // "item" itself is checked at depth 7 (history(4)+"0"(5)+change(6)+
  // item(7)); its own "nested" key pushes to depth 8, and each further
  // `{ a: ... }` wrap adds one more level. 8 + 24 = 32 (exactly the
  // limit); 8 + 25 = 33 (one level past it). HistoryChangeSchema's
  // from/to/item (z.record(string, unknown)) is a genuinely unrestricted
  // schema location -- Astra's reproduction class -- so nothing in the
  // schema itself bounds how deep a legitimate-looking value can nest.
  it("a History change.item nested to exactly the real 32-level write-depth limit is still accepted (never over-rejected right at the boundary)", async () => {
    const b = new MemoryRoomBackend();
    const v16Game = v16GameWithHistory({
      id: "h1", category: "effect", playerId: "a",
      change: { kind: "added", item: { nested: nestedObject(24) } },
    });
    await seedLegacyCheckpoint(b, v16Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });
    expect(recovered.outcome).toBe("live");
  });

  it("a History change.item nested one level past that same real 32-level write-depth limit is rejected before adoption, atomically", async () => {
    const b = new MemoryRoomBackend();
    const v16Game = v16GameWithHistory({
      id: "h1", category: "effect", playerId: "a",
      change: { kind: "added", item: { nested: nestedObject(25) } },
    });
    await seedLegacyCheckpoint(b, v16Game);
    await expectRejectedWithoutProjectionAttempt(b, await freshLobby(b));
  });

  it('Astra\'s exact reproduction: 1e400 seeded as LITERAL RAW JSON TEXT (never JSON.stringify(Infinity), which produces "null" and would prove nothing) overflows to Infinity on JSON.parse, and is rejected before adoption', async () => {
    const b = new MemoryRoomBackend();
    const v16Game = v16GameWithHistory({
      id: "h1", category: "life", playerId: "a",
      change: { kind: "value", from: { score: "SENTINEL_OVERFLOW_MARKER" }, to: { score: 1 } },
    });
    const rawText = JSON.stringify({ game: v16Game, roster: {} }).replace(
      '"SENTINEL_OVERFLOW_MARKER"',
      "1e400"
    );
    // Prove the overflow really happens exactly as claimed, before ever
    // feeding this text to the backend -- 1e400 is ordinary-looking,
    // syntactically valid JSON number text, not a parse error; IEEE 754
    // double parsing is what silently turns it into Infinity.
    const sanityParsed = JSON.parse(rawText) as { game: { history: [{ change: { from: { score: number } } }] } };
    expect(sanityParsed.game.history[0]!.change.from.score).toBe(Infinity);

    await b.set(`${root}/checkpoint`, rawText);
    await expectRejectedWithoutProjectionAttempt(b, await freshLobby(b));
  });

  it("Unicode/multibyte content: a History item key made of repeated multibyte emoji whose REAL UTF-8 byte length (not JS .length) exceeds the limit is rejected through the full recovery pipeline too, not just the pure validator", async () => {
    // 200 copies of a 4-byte-UTF-8 emoji: JS .length is 400 (comfortably
    // under 768), but the real UTF-8 encoding is 800 bytes -- combined with
    // the ~52-byte fixed overhead computed above, well over the real limit.
    const key = "\u{1F389}".repeat(200);
    expect(key.length).toBe(400);
    const b = new MemoryRoomBackend();
    const v16Game = v16GameWithHistory({
      id: "h1", category: "life", playerId: "a",
      change: { kind: "added", item: { [key]: true } },
    });
    await seedLegacyCheckpoint(b, v16Game);
    await expectRejectedWithoutProjectionAttempt(b, await freshLobby(b));
  });

  it("a genuinely valid checkpoint -- ordinary keys, finite numbers, shallow nesting, comfortably under the byte limit -- still recovers correctly (never over-rejected by the expanded gate)", async () => {
    const b = new MemoryRoomBackend();
    const v16Game = v16GameWithHistory({
      id: "h1", category: "life", playerId: "a",
      change: { kind: "value", from: { alive: true, score: -3.5 }, to: { alive: false, score: 0 } },
    });
    await seedLegacyCheckpoint(b, v16Game);
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { recovered.stop(); await writer.dispose(); });
    expect(recovered.outcome).toBe("live");
  });
});
