// Phase 10C: store v20 -> v21 (non-authoritative Reminder notation) across
// every path -- local Current State, every Undo snapshot, remote checkpoint
// recovery through the real startStorytellerSession/readCheckpoint
// chokepoint -- plus explicit version-evidence routing (20 / 21 / malformed /
// marker-less), the legacy empty-seat drop, finite-lifetime uncertainty,
// createdAt coherence and backward-compatible legacy Reminder History.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { detectLegacyGameVersion, hasV21Evidence, migrateGameEntry } from "@/stores/gameMigration";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";

const code = "RMDR2345";
const root = `lobbies/${code}`;
const STORAGE_KEY = "new-blood-st";
const disposals: (() => void | Promise<void>)[] = [];
type Raw = Record<string, unknown>;

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: {},
  });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  localStorage.clear();
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

const alice = { kind: "participant", participantId: "pt-a", playerId: "a", nameAtTime: "Alice" };
const departed = { kind: "participant", participantId: "pt-gone", playerId: "a", nameAtTime: "Gone" };
const legacyRef = { kind: "legacy", playerId: "z" };
const LONG_LABEL = "A very long legacy label ".repeat(20).trim();

const player = (id: string, seat: number, over: Raw = {}): Raw => ({
  id, name: id.toUpperCase(), seat, joinedAt: 1, actualRole: "chef",
  shownRole: "chef", shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
  alive: true, ghostVote: true, abilityUsed: false, statuses: {}, reminders: [], stNotes: "",
  isTraveler: false, actualAlignment: "good", effects: [], participantId: `pt-${id}`, ...over,
});
const emptySeat = (id: string, seat: number, over: Raw = {}): Raw => {
  const p = player(id, seat, { name: "", actualRole: "", shownRole: null, isEmpty: true, ...over });
  delete p.participantId;
  delete p.actualAlignment;
  return p;
};

const manualV20 = { id: "r-manual", label: "Knows", lifetime: { kind: "manual" }, createdAt: { phase: "night", day: 1 } };
const finiteV20 = { id: "r-finite", label: "Chosen", sourceCharacter: "fortuneteller", sourceParticipant: departed,
  lifetime: { kind: "untilDawn" }, createdAt: { phase: "night", day: 2 }, note: "SENTINEL-NOTE" };
const legacyV20 = { id: "legacy-b-0", label: LONG_LABEL, lifetime: { kind: "manual" }, sourceParticipant: legacyRef };

/** Legacy Reminder History exactly as a v20 writer recorded it: generic
 * added/removed, a lifetime in the snapshot, provenance mirroring origin. */
const legacyHistory = (): Raw[] => [
  { id: "h1", category: "reminder", participant: alice, moment: { phase: "night", day: 1 },
    change: { kind: "added", item: { id: "old", label: "Old", lifetime: { kind: "nights", count: 2 }, sourceParticipant: departed, note: "why" } },
    provenance: { sourceParticipant: departed, note: "why" } },
  { id: "h2", category: "reminder", participant: alice, moment: { phase: "day", day: 1 },
    change: { kind: "removed", item: { id: "old", label: "Old", lifetime: { kind: "nights", count: 2 }, sourceParticipant: departed, note: "why" } },
    provenance: { sourceParticipant: departed, note: "why" } },
];

/** What a v20 app stored/checkpointed: marker 20, Reminders with a lifetime. */
function v20Game(phase = "day", day = 2): Raw {
  return {
    gameSchemaVersion: 20,
    code, storytellerUid: "host", scriptId: "tb", phase, day, notes: "",
    players: {
      a: player("a", 0, { name: "Alice" }),
      b: player("b", 1, { name: "Bob", reminders: [structuredClone(manualV20), structuredClone(finiteV20), structuredClone(legacyV20)] }),
      e: emptySeat("e", 2, { reminders: [{ id: "orphan", label: "Orphaned", lifetime: { kind: "manual" } }] }),
    },
    seatOrder: ["a", "b", "e"], nightProgress: {}, fabled: [], bluffs: [], lorics: [], rolePool: [],
    plannedPlayerCount: 3, plannedTravelerCount: 0, pendingPlayers: {}, setupRolesDealt: true, setupRolesRevealed: true,
    history: legacyHistory(),
    informationDeliveries: [],
    lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] },
  };
}

/** The exact expected v21 result of v20Game (History untouched). */
function expectedV21(entry: Raw): Raw {
  const copy = structuredClone(entry);
  const players = copy.players as Record<string, Raw>;
  players.b!.reminders = [
    { id: "r-manual", label: "Knows", createdAt: { phase: "night", day: 1 } },
    { id: "r-finite", label: "Chosen", sourceCharacter: "fortuneteller", sourceParticipant: departed, createdAt: { phase: "night", day: 2 },
      note: "SENTINEL-NOTE", cleanupCue: { kind: "unresolved" } },
    { id: "legacy-b-0", label: LONG_LABEL, sourceParticipant: legacyRef },
  ];
  players.e!.reminders = [];
  copy.gameSchemaVersion = 21;
  return copy;
}
const remindersOf = (g: Raw, id: string) => (g.players as Record<string, { reminders: Raw[] }>)[id]!.reminders;

describe("Phase 10C migration: v20 -> v21", () => {
  it("manual -> no cue; finite -> unresolved cue (never guessed); origin, note, id and a long label are preserved exactly; empty-seat Reminders dropped; History untouched", () => {
    const original = v20Game();
    const result = migrateStoreState({ game: structuredClone(original), undoStack: [] }, 20) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(expectedV21(original));
    expect(result.game.history).toEqual(original.history);
    expect(StorytellerGamePersistedSchema.safeParse(result.game).success).toBe(true);
    // The departed origin is never re-resolved against the current roster.
    expect(remindersOf(result.game, "b")[1]!.sourceParticipant).toEqual(departed);
    expect(JSON.stringify(result.game.players)).not.toContain("Orphaned");
  });

  it("the unresolved cue is never inferred from the phase, createdAt, label or History: identical in any phase", () => {
    for (const [phase, day] of [["night", 2], ["day", 5], ["ended", 3]] as const) {
      const entry = v20Game(phase, day);
      migrateGameEntry(entry, 20, { kind: "canonical-only" });
      expect(remindersOf(entry, "b")[1]!.cleanupCue).toEqual({ kind: "unresolved" });
    }
  });

  it("each Undo snapshot migrates independently from its own content; deterministic and idempotent", () => {
    const older = v20Game("night", 2);
    remindersOf(older, "b").splice(0, 3, structuredClone(finiteV20));
    const state = { game: v20Game(), undoStack: [older, v20Game()] };
    const a = migrateStoreState(structuredClone(state), 20) as { game: Raw; undoStack: Raw[] };
    const b = migrateStoreState(structuredClone(state), 20);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(a).toEqual(b);
    expect(a.undoStack[1]).toEqual(a.game);
    const { lifetime: _lifetime, ...finiteV21 } = finiteV20;
    expect(remindersOf(a.undoStack[0]!, "b")).toEqual([{ ...finiteV21, cleanupCue: { kind: "unresolved" } }]);
    const snapshot = structuredClone(a);
    expect(migrateStoreState(a, 21)).toBe(a);
    expect(a).toEqual(snapshot);
    const entry = v20Game();
    migrateGameEntry(entry, 20, { kind: "canonical-only" });
    const once = structuredClone(entry);
    migrateGameEntry(entry, 20, { kind: "canonical-only" });
    migrateGameEntry(entry, 13, { kind: "canonical-only" });
    expect(entry).toEqual(once);
  });

  it("a temporally incoherent legacy createdAt is OMITTED (never replaced); a coherent one stays", () => {
    const night1 = v20Game("night", 1); // finite createdAt Night 2 is in this entry's future
    migrateGameEntry(night1, 20, { kind: "canonical-only" });
    const [manual, finite] = remindersOf(night1, "b");
    expect(manual!.createdAt).toEqual({ phase: "night", day: 1 });
    expect("createdAt" in finite!).toBe(false);
    expect(finite!.cleanupCue).toEqual({ kind: "unresolved" });
    expect(StorytellerGamePersistedSchema.safeParse(night1).success).toBe(true);
    // A legacy Setup entry keeps only {setup, 0}.
    const setup = v20Game("setup", 1);
    remindersOf(setup, "b").splice(0, 3, { ...manualV20, createdAt: { phase: "setup", day: 1 } }, { ...manualV20, id: "ok", createdAt: { phase: "setup", day: 0 } });
    migrateGameEntry(setup, 20, { kind: "canonical-only" });
    expect("createdAt" in remindersOf(setup, "b")[0]!).toBe(false);
    expect(remindersOf(setup, "b")[1]!.createdAt).toEqual({ phase: "setup", day: 0 });
    expect(StorytellerGamePersistedSchema.safeParse(setup).success).toBe(true);
  });

  it("a genuine v20 localStorage blob rehydrates as v21 with a legacy finite Reminder surfaced as Needs check", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 20, state: { game: v20Game(), undoStack: [v20Game("night", 2)] } }));
    await useStorytellerStore.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    const game = useStorytellerStore.getState().game!;
    expect(game.gameSchemaVersion).toBe(21);
    expect(game.players.b!.reminders[1]!.cleanupCue).toEqual({ kind: "unresolved" });
    expect(game.players.e!.reminders).toEqual([]);
    expect(useStorytellerStore.getState().undoStack[0]!.gameSchemaVersion).toBe(21);
  });

  it("a marker-less genuine legacy (v19) entry runs the whole chain through v21", () => {
    const v19 = v20Game();
    delete v19.gameSchemaVersion;
    const result = migrateStoreState({ game: v19, undoStack: [] }, 19) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game.gameSchemaVersion).toBe(21);
    expect(remindersOf(result.game, "b")[1]!.cleanupCue).toEqual({ kind: "unresolved" });
    expect(remindersOf(result.game, "e")).toEqual([]);
  });
});

describe("Phase 10C: malformed legacy data is never normalized", () => {
  const malformed: [string, (g: Raw) => void][] = [
    ["a Reminder missing its lifetime", (g) => { delete remindersOf(g, "b")[0]!.lifetime; }],
    ["an unknown lifetime kind", (g) => { remindersOf(g, "b")[0]!.lifetime = { kind: "forever" }; }],
    ["a zero-count lifetime", (g) => { remindersOf(g, "b")[0]!.lifetime = { kind: "nights", count: 0 }; }],
    ["a non-object Reminder", (g) => { remindersOf(g, "b").push("stray" as never); }],
    ["a duplicate Reminder id", (g) => { remindersOf(g, "b").push(structuredClone(manualV20)); }],
    ["an unknown Reminder key", (g) => { remindersOf(g, "b")[0]!.semanticType = "poisoned"; }],
    ["a retired sourcePlayer", (g) => { remindersOf(g, "b")[0]!.sourcePlayer = "a"; }],
    ["a malformed createdAt", (g) => { remindersOf(g, "b")[0]!.createdAt = { phase: "dusk", day: 1 }; }],
  ];

  it.each(malformed)("%s under marker 20: not stamped v21, rejected locally (reset) and never repaired", (_label, corrupt) => {
    const game = v20Game();
    corrupt(game);
    const copy = structuredClone(game);
    migrateGameEntry(copy, 20, { kind: "canonical-only" });
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
    const result = migrateStoreState({ game: structuredClone(game), undoStack: [] }, 20) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it("a lifetime-less Reminder can never slip through as a valid persistent v21 Reminder", () => {
    const game = v20Game();
    delete remindersOf(game, "b")[0]!.lifetime;
    migrateGameEntry(game, 20, { kind: "canonical-only" });
    expect(game.gameSchemaVersion).toBe(20);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
  });
});

describe("Phase 10C: explicit version evidence routing", () => {
  const current = () => expectedV21(v20Game());

  it("marker 21: no migration at all -- detected as current, same object content", () => {
    const game = current();
    expect(detectLegacyGameVersion(game)).toBe(21);
    const copy = structuredClone(game);
    migrateGameEntry(copy, 13, { kind: "canonical-only" });
    expect(copy).toEqual(game);
  });

  it.each([
    ["22", 22], ["a string 20", "20"], ["null", null], ["an object", { v: 20 }],
  ])("a malformed/unsupported marker (%s) is never reinterpreted as legacy: untouched and rejected", (_label, marker) => {
    const game = v20Game();
    game.gameSchemaVersion = marker;
    expect(detectLegacyGameVersion(game)).toBe(21);
    const copy = structuredClone(game);
    migrateGameEntry(copy, 13, { kind: "canonical-only" });
    expect(copy).toEqual(game);
    for (const version of [21, 20, 19]) {
      migrateStoreState({ game: structuredClone(game), undoStack: [] }, version);
      expect(takeMigrationResetFlag()).toBe(true);
    }
  });

  const v21Evidence: [string, (g: Raw) => void][] = [
    ["a cleanupCue", (g) => { remindersOf(g, "b")[0]!.cleanupCue = { kind: "unresolved" }; }],
    ["a reminderOperation in History", (g) => { (g.history as Raw[]).push({ id: "h9", category: "reminder", participant: alice, reminderOperation: "place",
      change: { kind: "added", item: { id: "n", label: "New" } } }); }],
    ["a reminder correction in History", (g) => { (g.history as Raw[]).push({ id: "h9", category: "reminder", participant: alice, correction: true,
      change: { kind: "added", item: { id: "n", label: "New", lifetime: { kind: "manual" } } } }); }],
  ];

  it.each(v21Evidence)("v21-only evidence (%s) under marker 20 is malformed current-version data: no v20 -> v21 repair, rejected", (_label, inject) => {
    const game = v20Game();
    inject(game);
    expect(hasV21Evidence(game)).toBe(true);
    expect(detectLegacyGameVersion(game)).toBe(20);
    const copy = structuredClone(game);
    migrateGameEntry(copy, 20, { kind: "canonical-only" });
    expect(copy).toEqual(game);
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
    migrateStoreState({ game: structuredClone(game), undoStack: [] }, 20);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it.each(v21Evidence)("marker-less v21 evidence (%s) is never treated as legacy: rejected, not stamped", (_label, inject) => {
    const game = v20Game();
    delete game.gameSchemaVersion;
    inject(game);
    expect(detectLegacyGameVersion(game)).toBe(21);
    const copy = structuredClone(game);
    migrateGameEntry(copy, 19, { kind: "canonical-only" });
    expect("gameSchemaVersion" in copy).toBe(false);
    migrateStoreState({ game: structuredClone(game), undoStack: [] }, 19);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a store labelled v21 whose entry still carries marker 20 is malformed and resets (no migration below the envelope)", () => {
    migrateStoreState({ game: v20Game(), undoStack: [] }, 21);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a malformed entry only inside an Undo snapshot rejects the whole store", () => {
    const bad = v20Game();
    delete remindersOf(bad, "b")[0]!.lifetime;
    migrateStoreState({ game: v20Game(), undoStack: [bad] }, 20);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});

describe("Phase 10C v21 invariants (current-version data is rejected, never repaired)", () => {
  const current = () => expectedV21(v20Game());

  it("an empty seat owning a v21 Reminder is rejected (Current State and any Undo snapshot)", () => {
    const game = current();
    remindersOf(game, "e").push({ id: "x", label: "Ghost" });
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
    migrateStoreState({ game: current(), undoStack: [game] }, 21);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a duplicate Reminder id, a future createdAt, a stray key or a cue at a non-live moment are rejected", () => {
    const cases: ((g: Raw) => void)[] = [
      (g) => { remindersOf(g, "b").push(structuredClone(remindersOf(g, "b")[0]!)); },
      (g) => { remindersOf(g, "b")[0]!.createdAt = { phase: "night", day: 3 }; },
      (g) => { remindersOf(g, "b")[0]!.stray = true; },
      (g) => { remindersOf(g, "b")[0]!.cleanupCue = { kind: "at", moment: { phase: "setup", day: 0 } }; },
      (g) => { remindersOf(g, "b")[0]!.cleanupCue = { kind: "expired" }; },
    ];
    for (const corrupt of cases) {
      const game = current();
      corrupt(game);
      expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
    }
  });

  it("a cue at or before now is valid (that is what Needs cleanup means); an ended snapshot is frozen", () => {
    const game = current();
    remindersOf(game, "b")[0]!.cleanupCue = { kind: "at", moment: { phase: "night", day: 1 } };
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
    const ended = { ...current(), phase: "ended", day: 2 };
    remindersOf(ended, "b")[0]!.createdAt = { phase: "day", day: 9 };
    expect(StorytellerGamePersistedSchema.safeParse(ended).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Remote checkpoint recovery through the real production chokepoint.
// ---------------------------------------------------------------------------
async function recoverFrom(game: Raw) {
  const b = new MemoryRoomBackend();
  await b.set(`${root}/checkpoint`, JSON.stringify({ game, roster: {} }));
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  const writer = new SessionWriter(b, code, session.id);
  disposals.push(() => writer.dispose());
  return { backend: b, start: () => startStorytellerSession(b, lobby, writer) };
}

describe("Phase 10C: remote checkpoint recovery", () => {
  it("a marker-20 checkpoint migrates first, then validates, then is adopted as v21 -- two independent recoveries agree", async () => {
    const first = await recoverFrom(v20Game());
    const recovered = await first.start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    const once = structuredClone(useStorytellerStore.getState().game!);
    expect(once).toEqual(expectedV21(v20Game()));
    for (const dispose of disposals.splice(0).reverse()) await dispose();
    useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const second = await recoverFrom(v20Game());
    const again = await second.start();
    disposals.push(() => again.stop());
    expect(useStorytellerStore.getState().game).toEqual(once);
  });

  it("a marker-20 checkpoint carrying v21 evidence is rejected and never adopted", async () => {
    const game = v20Game();
    remindersOf(game, "b")[0]!.cleanupCue = { kind: "unresolved" };
    const { start } = await recoverFrom(game);
    await expect(start()).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("a v21 checkpoint with an empty seat owning a Reminder is rejected, never repaired", async () => {
    const game = expectedV21(v20Game());
    remindersOf(game, "e").push({ id: "x", label: "Ghost" });
    const { start } = await recoverFrom(game);
    await expect(start()).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });
});
