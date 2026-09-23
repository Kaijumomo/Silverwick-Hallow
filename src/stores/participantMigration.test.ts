import { beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag } from "./storytellerStore";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import type { StorytellerLobbyRecord } from "./types";

// Phase 9R.2 Section 21: v16 -> v17 migration. v16 historical records only
// ever carried a bare, reusable PlayerId. Migration may give the person
// CURRENTLY in a seat a deterministic identity for their current
// participation instance, but it must NEVER infer that an old PlayerId-only
// record was about that person merely because the PlayerId matches
// (Section 6/22) -- unknowable historical identity stays explicitly
// unresolved.

beforeEach(() => { takeMigrationResetFlag(); });

const v16Player = (id: string, name: string, seat: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, name, seat, joinedAt: 1, actualRole: "chef", shownRole: "chef", shownAlignment: null,
  behaviorMode: "normal", publicDisplayRole: null, alive: true, ghostVote: true, abilityUsed: false,
  statuses: {}, reminders: [], stNotes: "", isTraveler: false, actualAlignment: "good", effects: [],
  isEmpty: false, ...over,
});

/**
 * A realistic v16 game in which seat "a" is NOW occupied by Bob, while its
 * History/Information/Provenance/Effect/Reminder records were written while
 * Alice sat there -- exactly the case v16 cannot distinguish. Seat "e" is
 * empty now but was referenced historically.
 */
function v16Game(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: "MIGR1234", storytellerUid: "host", scriptId: "tb", phase: "night", day: 2, notes: "",
    bluffs: [], fabled: [], lorics: [], rolePool: [], nightProgress: {}, pendingPlayers: {},
    plannedPlayerCount: 4, plannedTravelerCount: 1, setupRolesDealt: true, setupRolesRevealed: true,
    seatOrder: ["a", "c", "e", "t"],
    players: {
      a: v16Player("a", "Bob", 0),
      c: v16Player("c", "Carol", 1, {
        effects: [{ id: "x", type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: "a", lifetime: { kind: "untilDawn" } }],
        reminders: [{ id: "r", label: "Townsfolk", sourceCharacter: "washerwoman", sourcePlayer: "a", lifetime: { kind: "manual" } }],
      }),
      e: v16Player("e", "", 2, { isEmpty: true, actualRole: "", shownRole: null, actualAlignment: undefined }),
      t: v16Player("t", "Tess", 3, { isTraveler: true, actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief", actualAlignment: "evil" }),
    },
    history: [
      { id: "h1", category: "life", playerId: "a", moment: { phase: "night", day: 1 },
        change: { kind: "value", from: { alive: true }, to: { alive: false } },
        provenance: { sourcePlayer: "c", reason: "killed" } },
      { id: "h2", category: "effect", playerId: "c", moment: { phase: "night", day: 1 },
        change: { kind: "added", item: { id: "x", type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: "a", lifetime: { kind: "untilDawn" } } },
        provenance: { sourceCharacter: "poisoner", sourcePlayer: "a" } },
      { id: "h3", category: "reminder", playerId: "e", moment: { phase: "day", day: 1 },
        change: { kind: "removed", item: { id: "old", label: "Chosen", sourcePlayer: "e", lifetime: { kind: "manual" } } } },
    ],
    informationDeliveries: [
      { id: "d1", recipientPlayerId: "a", actualRole: "washerwoman", informationActionId: "washerwoman-first-night",
        moment: { phase: "night", day: 1 },
        values: [
          { requirementId: "players", kind: "player", playerIds: ["c", "e"] },
          { requirementId: "role", kind: "role", roleId: "chef" },
        ],
        provenance: { sourcePlayer: "c" } },
    ],
    ...over,
  };
}
// JSON round trip strips the explicit `actualAlignment: undefined` above --
// exactly what a real persisted v16 blob looks like.
const persisted = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

type Migrated = { game: StorytellerLobbyRecord; undoStack: StorytellerLobbyRecord[] };
const migrateLocal = (state: unknown, from = 16) => migrateStoreState(state, from) as Migrated;
const legacy = (playerId: string) => ({ kind: "legacy", playerId });

describe("Phase 9R.2 migration A/B: current occupants vs empty seats", () => {
  it("A: every currently occupied v16 player (ordinary and Traveler) deterministically becomes a v17 participant", () => {
    const { game } = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    expect(takeMigrationResetFlag()).toBe(false);
    expect(game.players.a!.participantId).toBe("legacy-current:a");
    expect(game.players.c!.participantId).toBe("legacy-current:c");
    expect(game.players.t!.participantId).toBe("legacy-current:t");
  });

  it("B: an empty seat receives no participant identity", () => {
    const { game } = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    expect(game.players.e!.isEmpty).toBe(true);
    expect("participantId" in game.players.e!).toBe(false);
  });
});

describe("Phase 9R.2 migration C/D/E: historical references become unresolved legacy refs -- never the current occupant (Section 22)", () => {
  const migrated = () => migrateLocal(persisted({ game: v16Game(), undoStack: [] })).game;

  it("C: History playerId becomes { kind: \"legacy\", playerId } -- not Bob's current identity, even though Bob sits in seat \"a\" now", () => {
    const game = migrated();
    expect(game.history.map((h) => h.participant)).toEqual([legacy("a"), legacy("c"), legacy("e")]);
    for (const h of game.history) expect(h).not.toHaveProperty("playerId");
    // Everything else about each record is untouched.
    expect(game.history[0]).toEqual({
      id: "h1", category: "life", participant: legacy("a"), moment: { phase: "night", day: 1 },
      change: { kind: "value", from: { alive: true }, to: { alive: false } },
      provenance: { sourceParticipant: legacy("c"), reason: "killed" },
    });
  });

  it("D: Provenance sourcePlayer, Effect/Reminder sourcePlayer, and the sourcePlayer inside a History Effect/Reminder snapshot all follow the same conservative rule", () => {
    const game = migrated();
    expect(game.history[1]!.provenance).toEqual({ sourceCharacter: "poisoner", sourceParticipant: legacy("a") });
    expect(game.history[1]!.change).toEqual({ kind: "added", item: {
      id: "x", type: "poisoned", sourceCharacter: "poisoner", sourceParticipant: legacy("a"), lifetime: { kind: "untilDawn" },
    } });
    expect(game.history[2]!.change).toEqual({ kind: "removed", item: {
      id: "old", label: "Chosen", sourceParticipant: legacy("e"), lifetime: { kind: "manual" },
    } });
    expect(game.players.c!.effects).toEqual([
      { id: "x", type: "poisoned", sourceCharacter: "poisoner", sourceParticipant: legacy("a"), lifetime: { kind: "untilDawn" } },
    ]);
    expect(game.players.c!.reminders).toEqual([
      { id: "r", label: "Townsfolk", sourceCharacter: "washerwoman", sourceParticipant: legacy("a"), lifetime: { kind: "manual" } },
    ]);
  });

  it("E: an Information Delivery's recipient and Player-valued Information get no fabricated current-person identity", () => {
    const game = migrated();
    expect(game.informationDeliveries).toEqual([{
      id: "d1", recipient: legacy("a"), actualRole: "washerwoman", informationActionId: "washerwoman-first-night",
      moment: { phase: "night", day: 1 },
      values: [
        { requirementId: "players", kind: "player", participants: [legacy("c"), legacy("e")] },
        { requirementId: "role", kind: "role", roleId: "chef" },
      ],
      provenance: { sourceParticipant: legacy("c") },
    }]);
  });

  it("no-fabrication: nothing historical carries a participantId, a nameAtTime, or any current occupant's identity", () => {
    const game = migrated();
    const historical = JSON.stringify({
      history: game.history, informationDeliveries: game.informationDeliveries,
      effects: game.players.c!.effects, reminders: game.players.c!.reminders,
    });
    expect(historical).not.toContain("legacy-current");
    expect(historical).not.toContain("participantId");
    expect(historical).not.toContain("nameAtTime");
    expect(historical).not.toContain("Bob");
    expect(historical).not.toMatch(/"kind":"participant"/); // no ref ever claims a resolved participant
    expect(historical).not.toContain("sourcePlayer");
    expect(historical).not.toContain("recipientPlayerId");
    expect(historical).not.toContain("playerIds");
  });
});

describe("Phase 9R.2 migration F: deterministic and idempotent", () => {
  it("two independent migrations of the same v16 state are identical -- no randomness anywhere", () => {
    const one = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    const two = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    expect(one).toEqual(two);
  });

  it("re-running migration on already-migrated data changes nothing (store-level and per-entry)", () => {
    const once = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    const snapshot = structuredClone(once);
    expect(migrateLocal(once, 16)).toEqual(snapshot); // re-run from the v16 threshold again
    expect(migrateLocal(once, 17)).toEqual(snapshot); // current-version rehydrate path (persist `merge`)
    const entry = structuredClone(snapshot.game);
    migrateGameEntry(entry, 16, { kind: "canonical-only" });
    expect(entry).toEqual(snapshot.game);
    expect(takeMigrationResetFlag()).toBe(false);
  });
});

describe("Phase 9R.2 migration G: Undo snapshots migrate consistently with Current State", () => {
  it("the same occupant gets the same deterministic identity in Current State and every Undo snapshot, and Undo history refs stay legacy", () => {
    const current = v16Game();
    const earlier = v16Game({
      history: (current.history as unknown[]).slice(0, 1),
      informationDeliveries: [],
      players: { ...(current.players as Record<string, unknown>), a: v16Player("a", "Bob", 0, { alive: true }) },
    });
    const { game, undoStack } = migrateLocal(persisted({ game: current, undoStack: [earlier] }));
    expect(undoStack).toHaveLength(1);
    for (const id of ["a", "c", "t"]) expect(undoStack[0]!.players[id]!.participantId).toBe(game.players[id]!.participantId);
    expect("participantId" in undoStack[0]!.players.e!).toBe(false);
    expect(undoStack[0]!.history).toEqual([game.history[0]]);
    expect(undoStack[0]!.history[0]!.participant).toEqual(legacy("a"));
  });
});

describe("Phase 9R.2 migration: the v17 invariants are enforced, never repaired", () => {
  it("a v17-tagged state still carrying a retired PlayerId-only field is rejected -- not silently stripped", () => {
    const v17 = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    const withLeftover = structuredClone(v17) as unknown as { game: { history: Record<string, unknown>[] } };
    withLeftover.game.history[0]!.playerId = "a";
    migrateStoreState(withLeftover, 17);
    expect(takeMigrationResetFlag()).toBe(true);

    const leftoverSource = structuredClone(v17) as unknown as { game: { players: Record<string, { effects: Record<string, unknown>[] }> } };
    leftoverSource.game.players.c!.effects[0]!.sourcePlayer = "a";
    migrateStoreState(leftoverSource, 17);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("an occupied v17 seat without a participant identity, or an empty seat with one, is rejected", () => {
    const v17 = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    const missing = structuredClone(v17);
    delete missing.game.players.c!.participantId;
    migrateStoreState(missing, 17);
    expect(takeMigrationResetFlag()).toBe(true);

    const emptyWithId = structuredClone(v17);
    emptyWithId.game.players.e!.participantId = "pt-ghost";
    migrateStoreState(emptyWithId, 17);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a legacy ref can never smuggle a participantId or name", () => {
    const v17 = migrateLocal(persisted({ game: v16Game(), undoStack: [] }));
    const forged = structuredClone(v17) as unknown as { game: { history: { participant: Record<string, unknown> }[] } };
    forged.game.history[0]!.participant.participantId = "legacy-current:a";
    migrateStoreState(forged, 17);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a malformed legacy reference is left for the schema gate to reject, never converted or guessed", () => {
    const game = v16Game();
    (game.history as Record<string, unknown>[])[0]!.playerId = 42;
    migrateStoreState(persisted({ game, undoStack: [] }), 16);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});

describe("Phase 9R.2 migration: remote-checkpoint version detection", () => {
  it("a v17 game is recognized by its own markers and is never migrated again; a v16 game is recognized as v16", () => {
    expect(detectLegacyGameVersion(persisted(v16Game()))).toBe(16);
    const v17 = migrateLocal(persisted({ game: v16Game(), undoStack: [] })).game as unknown as Record<string, unknown>;
    expect(detectLegacyGameVersion(persisted(v17))).toBe(17);
    // Any single marker suffices.
    expect(detectLegacyGameVersion({ ...persisted(v16Game()), history: [{ participant: legacy("a") }] })).toBe(17);
    expect(detectLegacyGameVersion({ ...persisted(v16Game()), informationDeliveries: [{ recipient: legacy("a") }] })).toBe(17);
  });
});
