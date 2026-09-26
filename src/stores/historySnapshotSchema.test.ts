import { beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { StorytellerGamePersistedSchema } from "./schemas";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import { setupScript } from "@/test/setupFixtures";
import type { HistoryRecord, PlayerId, StorytellerLobbyRecord } from "./types";
import { asV19 } from "@/test/v20Migration";

// Phase 9R.2 Luna remediation: History snapshot schema closure. An
// Effect/Reminder snapshot stored inside an added/removed History record
// must obey the same participant-source identity contract as the live
// EffectRecord/ReminderRecord -- in an already-v17 persisted/checkpoint
// game (which is never migrated again), a retired `sourcePlayer` nested in
// that snapshot must be REJECTED, and a present `sourceParticipant` must be
// a valid ParticipantRef. Every mutation below is made to an independent
// deep copy of an otherwise-valid v17 game, so a rejection can only be
// attributed to the one nested field being tested.

const game = () => store.getState().game!;
const state = () => store.getState();

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
  takeMigrationResetFlag();
});

const idOf = (name: string): PlayerId => Object.values(game().players).find((p) => p.name === name && !p.isEmpty)!.id;

/** A real v17 Night 1 game whose History contains Effect/Reminder snapshots
 * produced by every command that creates them -- setStatus (on/off),
 * addEffect (sourced), removeEffect, addReminder (sourced), removeReminder --
 * returned as a JSON-persisted deep copy (exactly what localStorage or a
 * checkpoint holds). */
function realV17Game(): StorytellerLobbyRecord {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi"]) state().addPlayerToSeat(name);
  state().setRolePool(["washerwoman", "fortuneteller", "investigator", "chef", "empath", "poisoner", "imp"]);
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  const alice = idOf("Alice");
  const carol = idOf("Carol");
  state().setStatus(carol, "poisoned", true);
  state().setStatus(carol, "poisoned", false);
  const effectId = state().addEffect(carol, { type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: alice, lifetime: { kind: "untilDawn" } })!;
  state().addEffect(carol, { type: "protected", lifetime: { kind: "manual" } });
  state().removeEffect(carol, effectId);
  const reminderId = state().addReminder(carol, { label: "Townsfolk", sourceCharacter: "washerwoman", sourcePlayer: alice, lifetime: { kind: "manual" } })!;
  state().addReminder(carol, { label: "Chosen", lifetime: { kind: "manual" } });
  state().removeReminder(carol, reminderId);
  return JSON.parse(JSON.stringify(game()));
}

/** Index of the first History record of `category`/`kind`. */
function indexOf(g: StorytellerLobbyRecord, category: HistoryRecord["category"], kind: "added" | "removed"): number {
  const i = g.history.findIndex((h) => h.category === category && h.change!.kind === kind);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

function withItemField(base: StorytellerLobbyRecord, index: number, field: string, value: unknown): StorytellerLobbyRecord {
  const copy = structuredClone(base);
  (copy.history[index]!.change as { item: Record<string, unknown> }).item[field] = value;
  return copy;
}

const participant = { kind: "participant", participantId: "pt-alice", playerId: "a", nameAtTime: "Alice" };
const legacy = { kind: "legacy", playerId: "a" };

describe("Section 5: every production-generated Effect/Reminder History snapshot satisfies the strengthened schema", () => {
  it("setStatus / addEffect / removeEffect / addReminder / removeReminder snapshots all pass persisted validation", () => {
    const g = realV17Game();
    const shapes = g.history.map((h) => `${h.category}:${h.change!.kind}`);
    expect(shapes).toEqual([
      "effect:added", "effect:removed", // setStatus on / off
      "effect:added", "effect:added", "effect:removed", // addEffect (sourced), addEffect, removeEffect
      "reminder:added", "reminder:added", "reminder:removed", // addReminder (sourced), addReminder, removeReminder
    ]);
    // The sourced snapshots genuinely carry a participant ref, so the
    // contract is exercised on real data, not only on absent fields.
    const sourced = g.history.filter((h) => "item" in h.change! && (h.change!.item as { sourceParticipant?: unknown }).sourceParticipant);
    expect(sourced).toHaveLength(4);
    const parsed = StorytellerGamePersistedSchema.safeParse(g);
    expect(parsed.success).toBe(true);
    // Validation only judges -- it never rewrites a snapshot.
    expect(parsed.data!.history).toEqual(g.history);
    // And through the real persisted-state path (current version, no migration).
    migrateStoreState({ game: structuredClone(g), undoStack: [structuredClone(g)] }, 18);
    expect(takeMigrationResetFlag()).toBe(false);
  });
});

describe("Section 6: the exact v17 regression -- a retired sourcePlayer inside a History snapshot is rejected directly, without migration", () => {
  it.each([
    ["effect", "added"], ["effect", "removed"], ["reminder", "added"], ["reminder", "removed"],
  ] as const)("%s %s snapshot carrying sourcePlayer fails StorytellerGamePersistedSchema", (category, kind) => {
    const base = realV17Game();
    expect(StorytellerGamePersistedSchema.safeParse(base).success).toBe(true); // control: otherwise valid
    // This is already-current data (Phase 10B: its explicit gameSchemaVersion
    // is v20 evidence): remote recovery would never migrate it.
    expect(detectLegacyGameVersion(base as unknown as Record<string, unknown>)).toBe(20);
    const index = indexOf(base, category, kind);
    const bad = withItemField(base, index, "sourcePlayer", "a");

    const result = StorytellerGamePersistedSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path)).toEqual([["history", index, "change", "item", "sourcePlayer"]]);
    // The same malformed state is rejected by the real persisted-state
    // gate (reset), never silently stripped into a "valid" state.
    migrateStoreState({ game: bad, undoStack: [] }, 17);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});

describe("Section 7: valid sourceParticipant controls pass", () => {
  it.each([
    ["effect", "added"], ["effect", "removed"], ["reminder", "added"], ["reminder", "removed"],
  ] as const)("%s %s snapshot with a participant ref or a legacy ref passes", (category, kind) => {
    const base = realV17Game();
    // Phase 10B (SOL-10B-R7): a Storyteller quick Effect (`manual:` id) can
    // never carry a source, so the sourced control uses the first record of
    // this kind about any other Effect.
    const index = base.history.findIndex((h) => h.category === category && h.change!.kind === kind &&
      !String((h.change as { item?: { id?: unknown } }).item?.id).startsWith("manual:"));
    expect(index).toBeGreaterThanOrEqual(0);
    for (const ref of [participant, legacy]) {
      const good = withItemField(base, index, "sourceParticipant", ref);
      const result = StorytellerGamePersistedSchema.safeParse(good);
      expect(result.success).toBe(true);
      expect((result.data!.history[index]!.change as { item: unknown }).item).toMatchObject({ sourceParticipant: ref });
    }
  });
});

describe("Section 8: malformed sourceParticipant shapes are rejected by the canonical ParticipantRef schema", () => {
  const malformed: [string, unknown][] = [
    ["a legacy ref smuggling an invented participantId", { kind: "legacy", playerId: "a", participantId: "invented" }],
    ["a participant ref missing participantId", { kind: "participant", playerId: "a", nameAtTime: "Alice" }],
    ["a participant ref missing nameAtTime", { kind: "participant", participantId: "pt-alice", playerId: "a" }],
    ["an unknown kind", { kind: "seat", playerId: "a" }],
    ["a legacy ref with an empty playerId", { kind: "legacy", playerId: "" }],
    ["a bare PlayerId string", "a"],
  ];
  it.each(malformed)("effect and reminder snapshots with %s fail", (_label, ref) => {
    const base = realV17Game();
    for (const [category, kind] of [["effect", "added"], ["effect", "removed"], ["reminder", "added"], ["reminder", "removed"]] as const) {
      const index = indexOf(base, category, kind);
      const result = StorytellerGamePersistedSchema.safeParse(withItemField(base, index, "sourceParticipant", ref));
      expect(result.success, `${category}:${kind}`).toBe(false);
      for (const issue of result.error!.issues) {
        expect(issue.path.slice(0, 5)).toEqual(["history", index, "change", "item", "sourceParticipant"]);
      }
    }
  });

  it("other History categories keep their generic, unrestricted snapshots (no overreach)", () => {
    const base = realV17Game();
    const copy = structuredClone(base);
    copy.history.push({
      id: "life-1", category: "life", participant: copy.history[0]!.participant,
      change: { kind: "added", item: { sourcePlayer: "a", anything: { goes: true } } },
    });
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(true);
  });
});

describe("Section 9: v16 -> v17 migration still converts legacy History snapshot sources, and the result passes the strengthened schema", () => {
  it("a v16 Effect/Reminder History snapshot with sourcePlayer migrates to a legacy sourceParticipant and then validates", () => {
    const v17 = realV17Game();
    // Rebuild an independent v16-shaped copy of the same game.
    // Phase 10B: v16 also predates the v20 Effect lifecycle (asV19).
    const v16 = asV19(structuredClone(v17)) as unknown as Record<string, unknown> & { history: Record<string, unknown>[]; players: Record<string, Record<string, unknown>> };
    delete v16.informationDeliveries;
    v16.informationDeliveries = [];
    delete v16.lifeEventWindow; // Phase 10A: v16 predates the Life Event Window
    for (const p of Object.values(v16.players)) delete p.participantId;
    for (const p of Object.values(v16.players)) {
      for (const e of p.effects as Record<string, unknown>[]) delete e.sourceParticipant;
      for (const r of p.reminders as Record<string, unknown>[]) delete r.sourceParticipant;
    }
    v16.history = v16.history.map((h) => {
      const { participant, ...rest } = h as { participant: { playerId: string } } & Record<string, unknown>;
      const item = (rest.change as { item?: Record<string, unknown> }).item;
      if (item && "sourceParticipant" in item) { delete item.sourceParticipant; item.sourcePlayer = "a"; }
      const provenance = rest.provenance as Record<string, unknown> | undefined;
      if (provenance?.sourceParticipant) { delete provenance.sourceParticipant; provenance.sourcePlayer = "a"; }
      return { ...rest, playerId: participant.playerId };
    });
    const sourcedV16 = v16.history.filter((h) => (h.change as { item?: { sourcePlayer?: string } }).item?.sourcePlayer === "a");
    expect(sourcedV16).toHaveLength(4);
    // The raw v16 shape is NOT valid v17 -- migration is what makes it so.
    expect(StorytellerGamePersistedSchema.safeParse(v16).success).toBe(false);
    expect(detectLegacyGameVersion(v16)).toBe(16);

    const migrated = structuredClone(v16);
    migrateGameEntry(migrated, 16, { kind: "canonical-only" });
    const items = (migrated.history as HistoryRecord[])
      .map((h) => ("item" in h.change! ? h.change!.item : {}) as Record<string, unknown>)
      .filter((item) => "sourceParticipant" in item || "sourcePlayer" in item);
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.sourceParticipant).toEqual({ kind: "legacy", playerId: "a" });
      expect("sourcePlayer" in item).toBe(false);
    }
    expect(StorytellerGamePersistedSchema.safeParse(migrated).success).toBe(true);

    // And end to end through the real local persisted-state migration.
    migrateStoreState({ game: structuredClone(v16), undoStack: [] }, 16);
    expect(takeMigrationResetFlag()).toBe(false);
  });
});

describe("Section 12: an all-empty, markerless v17 game is harmlessly detected as v16", () => {
  it("detected as 16, migration leaves it byte-for-byte identical, and it still passes the v17 schema", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 5, plannedTravelerCount: 1 });
    const v17: StorytellerLobbyRecord = JSON.parse(JSON.stringify(game()));
    // Phase 10A: a v17 game predates the Life Event Window (and Phase 10B:
    // the explicit version marker).
    delete (v17 as Partial<StorytellerLobbyRecord>).lifeEventWindow;
    delete (v17 as Partial<StorytellerLobbyRecord>).gameSchemaVersion;
    // Genuinely markerless: every seat empty, no History, no deliveries.
    expect(Object.values(v17.players).every((p) => p.isEmpty && !("participantId" in p))).toBe(true);
    expect(v17.history).toEqual([]);
    expect(v17.informationDeliveries).toEqual([]);

    expect(detectLegacyGameVersion(v17 as unknown as Record<string, unknown>)).toBe(16);
    const before = JSON.stringify(v17);
    const beforeDeep = structuredClone(v17);
    const entry = structuredClone(v17);
    migrateGameEntry(entry, 16, { kind: "canonical-only" });
    // Every identity/category step is a no-op; only the v19 window (and the
    // v20 marker -- there are no Effects) is added.
    const { lifeEventWindow, gameSchemaVersion, ...rest } = entry;
    expect(gameSchemaVersion).toBe(20);
    expect(lifeEventWindow).toEqual({ coverageFrom: { phase: "night", day: 1 }, events: [] });
    expect(JSON.stringify(rest)).toBe(before);
    expect(rest).toEqual(beforeDeep);
    expect(StorytellerGamePersistedSchema.safeParse(entry).success).toBe(true);
  });
});
