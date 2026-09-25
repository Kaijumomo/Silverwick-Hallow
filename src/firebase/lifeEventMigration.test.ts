// Phase 10A: store v18 -> v19 (the Life Event Window) across every
// migration path -- local Current State, every Undo snapshot, and remote
// checkpoint recovery through the real startStorytellerSession/readCheckpoint
// chokepoint -- plus the current-version evidence rule: a present v19 window
// (even a malformed one) is never mistaken for v18 and "repaired".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { detectLegacyGameVersion, hasV19LifeEvidence, migrateGameEntry } from "@/stores/gameMigration";
import { migratedLifeEventCoverage } from "@/stores/lifeEvents";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";

const code = "LIFE2345";
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

const alice = { kind: "participant", participantId: "pt-alice", playerId: "a", nameAtTime: "Alice" };

const player = (id: string, seat: number, over: Raw = {}): Raw => ({
  id, name: id.toUpperCase(), seat, joinedAt: 1, actualRole: "chef",
  shownRole: "chef", shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
  alive: true, ghostVote: true, abilityUsed: false, statuses: {}, reminders: [], stNotes: "",
  isTraveler: false, actualAlignment: "good", effects: [], participantId: `pt-${id}`, ...over,
});

/** Exactly what a v18 app stored/checkpointed: participant-aware, "role"
 * History, a dead player and their v18 "life" History -- and no window. */
function v18Game(phase: string, day: number): Raw {
  return {
    code, storytellerUid: "host", scriptId: "tb", phase, day, notes: "ST notes",
    players: { a: player("a", 0, { name: "Alice", alive: false }), b: player("b", 1, { name: "Bob" }) },
    seatOrder: ["a", "b"], nightProgress: {}, fabled: [], bluffs: [], lorics: [], rolePool: [],
    plannedPlayerCount: 2, plannedTravelerCount: 0, pendingPlayers: {}, setupRolesDealt: true, setupRolesRevealed: true,
    history: phase === "setup" ? [] : [
      { id: "h1", category: "life", participant: alice, moment: { phase: "night", day: 1 },
        change: { kind: "value", from: { alive: true }, to: { alive: false } }, provenance: { reason: "demon" } },
      { id: "h2", category: "role", participant: alice, moment: { phase: "night", day: 1 },
        change: { kind: "value", from: { actualRole: "empath" }, to: { actualRole: "chef" } } },
    ],
    informationDeliveries: [],
  };
}

const deathEvent = (over: Raw = {}): Raw => ({
  id: "le-1", kind: "death", subject: alice, moment: { phase: "night", day: 2 }, ...over,
});

/** A valid v19 game: the v18 shape plus a window with one event. */
function v19Game(): Raw {
  return { ...v18Game("night", 2), lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [deathEvent()] } };
}

const withoutWindow = (entry: Raw): Raw => { const { lifeEventWindow: _w, ...rest } = entry; return rest; };

describe("Phase 10A migration: coverage table (v18 -> v19)", () => {
  it.each([
    ["setup", 0, { phase: "night", day: 1 }],
    ["night", 3, { phase: "day", day: 3 }],
    ["day", 3, { phase: "night", day: 4 }],
    ["ended", 3, { phase: "night", day: 4 }],
  ] as const)("a v18 %s game (day %d) gains an empty window covered from %j -- nothing else changes", (phase, day, coverageFrom) => {
    const original = v18Game(phase, day);
    const result = migrateStoreState({ game: structuredClone(original), undoStack: [] }, 18) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game.lifeEventWindow).toEqual({ coverageFrom, events: [] });
    expect(withoutWindow(result.game)).toEqual(original);
  });

  it("never backfills Life Events from v18 History (a recorded death stays History-only)", () => {
    const result = migrateStoreState({ game: v18Game("day", 1), undoStack: [] }, 18) as { game: { lifeEventWindow: { events: unknown[] }; history: unknown[] } };
    expect(result.game.history).toHaveLength(2);
    expect(result.game.lifeEventWindow.events).toEqual([]);
  });

  it("migrates every Undo snapshot from its OWN phase, never the current one", () => {
    const state = { game: v18Game("night", 3), undoStack: [v18Game("setup", 0), v18Game("night", 2), v18Game("day", 2)] };
    const result = migrateStoreState(state, 18) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect((result.game.lifeEventWindow as Raw).coverageFrom).toEqual({ phase: "day", day: 3 });
    expect(result.undoStack.map((e) => (e.lifeEventWindow as Raw).coverageFrom)).toEqual([
      { phase: "night", day: 1 }, { phase: "day", day: 2 }, { phase: "night", day: 3 },
    ]);
  });

  it("is deterministic and idempotent: independent runs agree, a second run changes nothing", () => {
    const a = migrateStoreState({ game: v18Game("day", 2), undoStack: [v18Game("night", 2)] }, 18);
    const b = migrateStoreState({ game: v18Game("day", 2), undoStack: [v18Game("night", 2)] }, 18);
    expect(a).toEqual(b);
    const snapshot = structuredClone(a);
    expect(migrateStoreState(a, 19)).toEqual(snapshot);
    const entry = v18Game("day", 2);
    migrateGameEntry(entry, 18, { kind: "canonical-only" });
    const once = structuredClone(entry);
    migrateGameEntry(entry, 18, { kind: "canonical-only" });
    expect(entry).toEqual(once);
  });

  it("a genuine v18 localStorage blob rehydrates with the window added", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 18, state: { game: v18Game("day", 2), undoStack: [v18Game("night", 2)] } }));
    await useStorytellerStore.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    const game = useStorytellerStore.getState().game!;
    expect(game.lifeEventWindow).toEqual({ coverageFrom: { phase: "night", day: 3 }, events: [] });
    expect(useStorytellerStore.getState().undoStack[0]!.lifeEventWindow.coverageFrom).toEqual({ phase: "day", day: 2 });
    expect(game.players.a!.alive).toBe(false);
  });

  it("coverage values are exactly migratedLifeEventCoverage's; unusable phase/day leaves the window absent for the schema to reject", () => {
    expect(migratedLifeEventCoverage("night", 0)).toBeNull();
    expect(migratedLifeEventCoverage("bogus", 1)).toBeNull();
    const entry = { ...v18Game("night", 2), phase: "bogus" };
    migrateGameEntry(entry, 18, { kind: "canonical-only" });
    expect("lifeEventWindow" in entry).toBe(false);
  });
});

describe("Phase 10A migration: already-current (v19) data", () => {
  it("passes through unchanged -- event ids and coverage are never regenerated", () => {
    const current = { game: v19Game(), undoStack: [v19Game()] };
    const snapshot = structuredClone(current);
    expect(migrateStoreState(current, 19)).toBe(current);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(current).toEqual(snapshot);
    // Even a caller claiming v18 cannot make migration touch it.
    const entry = v19Game();
    migrateGameEntry(entry, 18, { kind: "canonical-only" });
    expect(entry).toEqual(v19Game());
  });

  it("detection: any v19 Life Event evidence reports 19; genuine v18 reports an older version", () => {
    expect(detectLegacyGameVersion(v19Game())).toBe(19);
    expect(detectLegacyGameVersion(v18Game("night", 2))).toBe(17);
    const historyOnly = v18Game("night", 2);
    (historyOnly.history as Raw[]).push({ id: "h3", category: "life", participant: alice, lifeEvent: { added: deathEvent() } });
    expect(hasV19LifeEvidence(historyOnly)).toBe(true);
    expect(detectLegacyGameVersion(historyOnly)).toBe(19);
  });
});

describe("Phase 10A migration: malformed v19 evidence never falls back into v18 repair", () => {
  const malformed: [string, (g: Raw) => void][] = [
    ["a window that is not an object", (g) => { g.lifeEventWindow = "window"; }],
    ["a window with a non-array events list", (g) => { (g.lifeEventWindow as Raw).events = "x"; }],
    ["a window without coverageFrom", (g) => { delete (g.lifeEventWindow as Raw).coverageFrom; }],
    ["coverage from Setup", (g) => { (g.lifeEventWindow as Raw).coverageFrom = { phase: "setup", day: 0 }; }],
    ["a death carrying an outcome", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent({ outcome: "died" })]; }],
    ["an execution without an outcome", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent({ kind: "execution", moment: { phase: "day", day: 2 } })]; }],
    ["an exile outcome of alreadyDead", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent({ kind: "exile", outcome: "alreadyDead", moment: { phase: "day", day: 2 } })]; }],
    ["an execution at Night", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent({ kind: "execution", outcome: "died" })]; }],
    ["a legacy ParticipantRef subject", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent({ subject: { kind: "legacy", playerId: "a" } })]; }],
    ["a duplicate event id", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent(), deathEvent()]; }],
    ["an unknown key on an event", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent({ stray: 1 })]; }],
    ["an empty resolutionId", (g) => { (g.lifeEventWindow as Raw).events = [deathEvent({ resolutionId: "" })]; }],
    ["a History mirror with no window", (g) => {
      delete g.lifeEventWindow;
      (g.history as Raw[]).push({ id: "h3", category: "life", participant: alice, lifeEvent: { added: deathEvent() } });
    }],
    ["a life History record with neither change nor Life Event", (g) => {
      (g.history as Raw[]).push({ id: "h3", category: "life", participant: alice, correction: true });
    }],
  ];

  it.each(malformed)("%s: rejected locally (reset) whether labelled v19 or v18 -- never replaced by a fresh window", (_label, corrupt) => {
    for (const version of [19, 18]) {
      const game = v19Game();
      corrupt(game);
      expect(hasV19LifeEvidence(game)).toBe(true);
      const copy = structuredClone(game);
      migrateGameEntry(copy, 18, { kind: "canonical-only" });
      expect(copy).toEqual(game); // migration never touches current-version evidence
      const result = migrateStoreState({ game: structuredClone(game), undoStack: [] }, version) as { game: unknown };
      expect(takeMigrationResetFlag()).toBe(true);
      expect(result.game).toBeNull();
    }
  });

  it("a store labelled v19 whose game lacks the window is incomplete current data and resets", () => {
    const result = migrateStoreState({ game: v18Game("night", 2), undoStack: [] }, 19) as { game: unknown };
    expect(takeMigrationResetFlag()).toBe(true);
    expect(result.game).toBeNull();
  });

  it("a malformed window only inside an Undo snapshot rejects the whole store", () => {
    const bad = v19Game();
    (bad.lifeEventWindow as Raw).events = [deathEvent({ outcome: "died" })];
    migrateStoreState({ game: v19Game(), undoStack: [bad] }, 19);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});

describe("Phase 10A: recoverable anomalies are never schema failures", () => {
  it("stale events, departed subjects and state/event disagreement all validate", () => {
    const game = v19Game();
    (game.lifeEventWindow as Raw).events = [
      deathEvent({ id: "le-old", moment: { phase: "night", day: 1 } }), // older than the retained pair
      deathEvent({ id: "le-gone", subject: { kind: "participant", participantId: "pt-departed", playerId: "zz", nameAtTime: "Zed" } }),
      deathEvent({ id: "le-disagree", subject: { kind: "participant", participantId: "pt-b", playerId: "b", nameAtTime: "Bob" } }), // Bob is alive
    ];
    (game.players as Record<string, Raw>).b!.exiled = true; // alive + exiled anomaly on a non-Traveler
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
  });

  it("an RTDB-shaped window whose empty events list was dropped still validates (events default to [])", () => {
    const game = v19Game();
    delete (game.lifeEventWindow as Raw).events;
    const parsed = StorytellerGamePersistedSchema.safeParse(game);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.lifeEventWindow.events).toEqual([]);
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
  return startStorytellerSession(b, lobby, writer).then((recovered) => {
    disposals.push(() => recovered.stop());
    return recovered;
  });
}

describe("Phase 10A: remote checkpoint recovery", () => {
  it("a genuine v18 (versionless) checkpoint recovers with honest coverage and no backfilled events", async () => {
    const recovered = await recoverFrom(v18Game("day", 3));
    expect(recovered.outcome).toBe("live");
    const game = useStorytellerStore.getState().game!;
    expect(game.lifeEventWindow).toEqual({ coverageFrom: { phase: "night", day: 4 }, events: [] });
    expect(game.history).toEqual(v18Game("day", 3).history);
  });

  it("a v19 checkpoint recovers exactly, never re-migrated", async () => {
    const recovered = await recoverFrom(v19Game());
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.lifeEventWindow).toEqual(v19Game().lifeEventWindow);
  });

  it("a malformed v19 checkpoint is rejected -- never adopted, never 'repaired' into a fresh window", async () => {
    const bad = v19Game();
    (bad.lifeEventWindow as Raw).events = [deathEvent({ outcome: "died" })];
    await expect(recoverFrom(bad)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });
});
