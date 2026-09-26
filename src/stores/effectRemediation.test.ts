// Phase 10B Opus architecture remediation (SOL-10B-R1 .. R9): explicit
// regression coverage for each accepted finding.
import { beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { planEffectExpiry, type EffectIntent, type EffectParticipantBinding } from "./effectResolution";
import { hasEffect } from "./effects";
import { EffectRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { participantRefOf } from "./participants";
import type { EffectRecord, PlayerId, StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const bind = (id: PlayerId): EffectParticipantBinding => ({ playerId: id, participantId: player(id).participantId! });
const effectHistory = () => game().history.filter((h) => h.category === "effect");
const resolve = (...intents: EffectIntent[]) => state().resolveEffects({ intents });
const correct = (...intents: EffectIntent[]) => state().resolveEffects({ intents });
const apply = (name: string, effect: Extract<EffectIntent, { kind: "apply" }>["effect"]): EffectIntent =>
  ({ kind: "apply", target: bind(idOf(name)), effect });
const effectOf = (name: string, id: string) => player(idOf(name)).effects.find((e) => e.id === id)!;
const persisted = (g: StorytellerLobbyRecord) => JSON.parse(JSON.stringify(g)) as Record<string, unknown>;
const withEffectsOn = (g: StorytellerLobbyRecord, playerId: PlayerId, effects: EffectRecord[]): StorytellerLobbyRecord =>
  ({ ...g, players: { ...g.players, [playerId]: { ...g.players[playerId]!, effects } } });

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
  takeMigrationResetFlag();
});

function setupGame() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) if (!player(id).isEmpty) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
}
function liveGame() {
  setupGame();
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}
const marked = (id = "fx-m"): EffectRecord =>
  ({ id, type: "marked", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } });

// ---------------------------------------------------------------------------
describe("SOL-10B-R1: empty seats cannot own Effects", () => {
  it("an empty Setup seat with an Effect fails the v20 persisted schema", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 3 });
    const empty = game().seatOrder[0]!;
    expect(StorytellerGamePersistedSchema.safeParse(persisted(game())).success).toBe(true);
    const bad = persisted(withEffectsOn(game(), empty, [marked()]));
    const result = StorytellerGamePersistedSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message === "an empty seat cannot own Effects")).toBe(true);
    // Through the real persisted-state gate: reset, never repaired.
    migrateStoreState({ game: bad, undoStack: [] }, 20);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("an empty Live seat with an Effect fails the v20 persisted schema (Current State and Undo snapshots alike)", () => {
    liveGame();
    const alice = idOf("Alice");
    state().unseatPlayer(alice);
    expect(player(alice).isEmpty).toBe(true);
    const bad = persisted(withEffectsOn(game(), alice, [marked()]));
    expect(StorytellerGamePersistedSchema.safeParse(bad).success).toBe(false);
    migrateStoreState({ game: persisted(game()), undoStack: [bad] }, 20);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a new participation instance defensively starts with no Effects, even from a crafted empty seat carrying some", () => {
    // Pre-Reveal Setup: the occupied seat object is carried through (no
    // Traveler rebuild), so this exercises occupySeat's own guarantee.
    state().newGame(setupScript.id, { plannedPlayerCount: 3 });
    const emptyId = game().seatOrder[0]!;
    store.setState({ game: withEffectsOn(game(), emptyId, [marked()]) }); // crafted, never-validated state
    state().addPlayerToSeat("Heidi");
    expect(player(emptyId).isTraveler).toBe(false);
    expect(player(emptyId).name).toBe("Heidi");
    expect(player(emptyId).participantId).toBeTruthy();
    expect(player(emptyId).effects).toEqual([]);
  });

  it("phase expiry never silently removes an Effect whose seat has no participant (such state is invalid, not repaired)", () => {
    liveGame();
    const alice = idOf("Alice");
    state().unseatPlayer(alice);
    const due: EffectRecord = { id: "due", type: "poisoned", lifetime: { kind: "untilDawn" }, state: "active",
      expiry: { kind: "at", moment: { phase: "day", day: 1 } } };
    const crafted = withEffectsOn(game(), alice, [due]);
    expect(StorytellerGamePersistedSchema.safeParse(persisted(crafted)).success).toBe(false);
    expect(planEffectExpiry(crafted, { phase: "day", day: 1 })).toBeNull();
    store.setState({ game: crafted });
    const count = effectHistory().length;
    expect(state().advancePhase().ok).toBe(true);
    expect(player(alice).effects).toEqual([due]);
    expect(effectHistory()).toHaveLength(count);
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10B-R2: expiry is the mechanical authority; lifetime is declared metadata", () => {
  it("Apply still derives a coherent initial expiry from the declared lifetime; incoherent explicit initial expiries are refused", () => {
    liveGame();
    expect(resolve(apply("Alice", { id: "t", type: "poisoned", lifetime: { kind: "untilDawn" } })).ok).toBe(true);
    expect(effectOf("Alice", "t").expiry).toEqual({ kind: "at", moment: { phase: "day", day: 1 } });
    expect(resolve(apply("Alice", { id: "m", type: "marked", lifetime: { kind: "manual" } })).ok).toBe(true);
    expect(effectOf("Alice", "m").expiry).toEqual({ kind: "none" });
    expect(resolve(apply("Bob", { type: "marked", lifetime: { kind: "manual" }, expiry: { kind: "at", moment: { phase: "night", day: 3 } } }))).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve(apply("Bob", { type: "poisoned", lifetime: { kind: "untilDawn" }, expiry: { kind: "none" } }))).toMatchObject({ ok: false, code: "expiryUnresolvable" });
    expect(player(idOf("Bob")).effects).toEqual([]);
  });

  it("a finite Effect may Update its end to a different future boundary, or to none, without changing the declared lifetime", () => {
    liveGame();
    resolve(apply("Carol", { id: "p", type: "poisoned", lifetime: { kind: "untilDawn" } }));
    expect(resolve({ kind: "update", target: bind(idOf("Carol")), effectId: "p", changes: { expiry: { kind: "at", moment: { phase: "night", day: 3 } } } }).ok).toBe(true);
    expect(effectOf("Carol", "p")).toMatchObject({ lifetime: { kind: "untilDawn" }, expiry: { kind: "at", moment: { phase: "night", day: 3 } } });
    expect(resolve({ kind: "update", target: bind(idOf("Carol")), effectId: "p", changes: { expiry: { kind: "none" } } }).ok).toBe(true);
    expect(effectOf("Carol", "p")).toMatchObject({ lifetime: { kind: "untilDawn" }, expiry: { kind: "none" } });
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "update", change: { kind: "value" } });
    expect(effectHistory().at(-1)!.correction).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(persisted(game())).success).toBe(true);
  });

  it("a manual declared lifetime (including the quick Effect) may Update to a future exact end; its declared lifetime stays manual", () => {
    liveGame();
    state().setManualEffect(bind(idOf("Dave")), "drunk", true);
    expect(resolve({ kind: "update", target: bind(idOf("Dave")), effectId: "manual:drunk", changes: { expiry: { kind: "at", moment: { phase: "day", day: 1 } } } }).ok).toBe(true);
    expect(effectOf("Dave", "manual:drunk")).toMatchObject({ lifetime: { kind: "manual" }, expiry: { kind: "at", moment: { phase: "day", day: 1 } } });
    expect(StorytellerGamePersistedSchema.safeParse(persisted(game())).success).toBe(true);
    expect(state().advancePhase().ok).toBe(true); // the scheduled end is authoritative
    expect(effectOf("Dave", "manual:drunk")).toBeUndefined();
  });

  it("unresolved is rejected with a manual declared lifetime; it stays valid for a finite legacy one", () => {
    const base = { id: "l", type: "poisoned", state: "active", expiry: { kind: "unresolved" } };
    expect(EffectRecordSchema.safeParse({ ...base, lifetime: { kind: "manual" } }).success).toBe(false);
    expect(EffectRecordSchema.safeParse({ ...base, lifetime: { kind: "untilDawn" } }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10B-R3: correction temporal coherence", () => {
  function atDay1WithEffect() {
    liveGame();
    resolve(apply("Carol", { id: "p", type: "poisoned", lifetime: { kind: "nights", count: 2 } })); // Night 1 -> ends entering Day 2
    expect(state().advancePhase().ok).toBe(true); // Day 1
    expect(effectOf("Carol", "p").expiry).toEqual({ kind: "at", moment: { phase: "day", day: 2 } });
  }
  const amend = (amendment: Extract<EffectIntent, { kind: "correctAmend" }>["amendment"]) =>
    correct({ kind: "correctAmend", target: bind(idOf("Carol")), effectId: "p", amendment });

  it("correcting the applied moment without an expiry re-derives it from the corrected facts", () => {
    liveGame();
    resolve(apply("Carol", { id: "p", type: "poisoned", lifetime: { kind: "days", count: 2 } })); // Night 1 -> Night 3
    expect(state().advancePhase().ok).toBe(true); // Day 1
    expect(amend({ appliedAt: { phase: "day", day: 1 } }).ok).toBe(true); // Day 1 + 2 days -> Night 3
    expect(effectOf("Carol", "p")).toMatchObject({ appliedAt: { phase: "day", day: 1 }, expiry: { kind: "at", moment: { phase: "night", day: 3 } } });
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "update", correction: true });
  });

  it("correcting the declared lifetime without an expiry re-derives it", () => {
    atDay1WithEffect();
    expect(amend({ lifetime: { kind: "days", count: 3 } }).ok).toBe(true); // Night 1 + 3 days -> Night 4
    expect(effectOf("Carol", "p").expiry).toEqual({ kind: "at", moment: { phase: "night", day: 4 } });
    expect(amend({ lifetime: { kind: "manual" } }).ok).toBe(true);
    expect(effectOf("Carol", "p").expiry).toEqual({ kind: "none" });
  });

  it("a re-derived end already at/before now refuses -- the old derived end is never silently kept", () => {
    atDay1WithEffect();
    const before = game();
    expect(amend({ lifetime: { kind: "untilDawn" } })).toMatchObject({ ok: false, code: "expiryUnresolvable", intentIndex: 0 }); // Night 1 -> Day 1 = now
    expect(amend({ appliedAt: { phase: "night", day: 1 }, lifetime: { kind: "nights", count: 1 } })).toMatchObject({ ok: false, code: "expiryUnresolvable" });
    expect(state().game).toBe(before);
  });

  it("an explicitly supplied valid expiry is authoritative over re-derivation (still temporally valid)", () => {
    atDay1WithEffect();
    expect(amend({ lifetime: { kind: "untilDawn" }, expiry: { kind: "at", moment: { phase: "night", day: 2 } } }).ok).toBe(true);
    expect(effectOf("Carol", "p")).toMatchObject({ lifetime: { kind: "untilDawn" }, expiry: { kind: "at", moment: { phase: "night", day: 2 } } });
    expect(amend({ expiry: { kind: "at", moment: { phase: "day", day: 1 } } })).toMatchObject({ ok: false, code: "expiryUnresolvable" });
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10B-R4: temporal validity at the schema boundary", () => {
  it("a live game with an overdue exact end, or a future applied moment, fails -- Current State, Undo and checkpoint gates alike", () => {
    liveGame();
    const alice = idOf("Alice");
    const overdue = persisted(withEffectsOn(game(), alice, [{ id: "o", type: "poisoned", lifetime: { kind: "untilDawn" }, state: "active",
      expiry: { kind: "at", moment: { phase: "night", day: 1 } } }]));
    const future = persisted(withEffectsOn(game(), alice, [{ ...marked(), appliedAt: { phase: "day", day: 1 } }]));
    for (const bad of [overdue, future]) {
      expect(StorytellerGamePersistedSchema.safeParse(bad).success).toBe(false);
      migrateStoreState({ game: persisted(game()), undoStack: [bad] }, 20);
      expect(takeMigrationResetFlag()).toBe(true);
    }
  });

  it("the commands only ever produce temporally valid state: every snapshot through a multi-phase game validates", () => {
    liveGame();
    resolve(apply("Alice", { type: "poisoned", lifetime: { kind: "untilDawn" } }), apply("Bob", { type: "mad", lifetime: { kind: "days", count: 2 } }));
    for (let i = 0; i < 5; i++) {
      expect(StorytellerGamePersistedSchema.safeParse(persisted(game())).success).toBe(true);
      expect(state().advancePhase().ok).toBe(true);
    }
    for (const snapshot of state().undoStack) expect(StorytellerGamePersistedSchema.safeParse(persisted(snapshot)).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10B-R5: suppression is an explicit decision, never derived applicability", () => {
  it("the source dying or being poisoned never changes the Effect's stored state; hasEffect keeps meaning 'stored active'", () => {
    liveGame();
    const alice = idOf("Alice");
    resolve(apply("Carol", { id: "p", type: "poisoned", source: bind(alice), sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" } }));
    const snapshot = effectOf("Carol", "p");
    state().setManualEffect(bind(alice), "poisoned", true);
    expect(state().recordDeath(alice).ok).toBe(true);
    expect(effectOf("Carol", "p")).toEqual(snapshot);
    expect(effectOf("Carol", "p").state).toBe("active");
    expect(hasEffect(player(idOf("Carol")), "poisoned")).toBe(true);
    expect(effectHistory().filter((h) => h.effectOperation === "suppress")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10B-R7: the manual: namespace is reserved for Storyteller quick Effects", () => {
  it("the schema rejects id/type mismatch, a source, a source character or a timed declared lifetime", () => {
    const quick = { id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } };
    expect(EffectRecordSchema.safeParse(quick).success).toBe(true);
    expect(EffectRecordSchema.safeParse({ ...quick, expiry: { kind: "at", moment: { phase: "day", day: 2 } } }).success).toBe(true);
    expect(EffectRecordSchema.safeParse({ ...quick, type: "drunk" }).success).toBe(false);
    expect(EffectRecordSchema.safeParse({ ...quick, sourceParticipant: { kind: "legacy", playerId: "a" } }).success).toBe(false);
    expect(EffectRecordSchema.safeParse({ ...quick, sourceCharacter: "poisoner" }).success).toBe(false);
    expect(EffectRecordSchema.safeParse({ ...quick, lifetime: { kind: "untilDawn" }, expiry: { kind: "unresolved" } }).success).toBe(false);
  });

  it("an ability-shaped Effect can never claim a manual: id; the quick control still works for any type", () => {
    liveGame();
    const before = game();
    expect(resolve(apply("Carol", { id: "manual:poisoned", type: "poisoned", source: bind(idOf("Alice")), lifetime: { kind: "manual" } }))).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve(apply("Carol", { id: "manual:poisoned", type: "poisoned", sourceCharacter: "poisoner", lifetime: { kind: "manual" } }))).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve(apply("Carol", { id: "manual:poisoned", type: "poisoned", lifetime: { kind: "untilDawn" } }))).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve(apply("Carol", { id: "manual:poisoned", type: "drunk", lifetime: { kind: "manual" } }))).toMatchObject({ ok: false, code: "invalid" });
    expect(state().addEffect(idOf("Carol"), { id: "manual:x", type: "y", lifetime: { kind: "manual" } })).toBeNull();
    expect(state().game).toBe(before);
    expect(state().setManualEffect(bind(idOf("Carol")), "hexed", true)).toMatchObject({ ok: true, effectIds: ["manual:hexed"] });
  });

  it("a correction cannot change a quick Effect's type away from its id, nor give it a source", () => {
    liveGame();
    state().setManualEffect(bind(idOf("Carol")), "poisoned", true);
    const before = game();
    const amend = (amendment: Extract<EffectIntent, { kind: "correctAmend" }>["amendment"]) =>
      correct({ kind: "correctAmend", target: bind(idOf("Carol")), effectId: "manual:poisoned", amendment });
    expect(amend({ type: "drunk" })).toMatchObject({ ok: false, code: "invalid" });
    expect(amend({ source: bind(idOf("Alice")) })).toMatchObject({ ok: false, code: "invalid" });
    expect(amend({ sourceCharacter: "poisoner" })).toMatchObject({ ok: false, code: "invalid" });
    expect(amend({ lifetime: { kind: "untilDawn" } })).toMatchObject({ ok: false, code: "invalid" });
    expect(state().game).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10B-R8: mutation provenance comes only from Mutation Context", () => {
  it("Apply with a source but no Mutation Context keeps the origin in the snapshot and stores no History provenance", () => {
    liveGame();
    const alice = idOf("Alice");
    resolve(apply("Carol", { id: "p", type: "poisoned", source: bind(alice), sourceCharacter: "poisoner", lifetime: { kind: "untilDawn" } }));
    const record = effectHistory().at(-1)!;
    expect(record.change).toMatchObject({ kind: "added", item: { sourceParticipant: participantRefOf(game(), alice), sourceCharacter: "poisoner" } });
    expect(record.provenance).toBeUndefined();
  });

  it("no lifecycle operation invents provenance without a Mutation Context; an explicit one is recorded for every operation", () => {
    liveGame();
    const carol = bind(idOf("Carol"));
    resolve(apply("Carol", { id: "p", type: "poisoned", source: bind(idOf("Alice")), lifetime: { kind: "throughFollowingDay" } }));
    resolve({ kind: "update", target: carol, effectId: "p", changes: { note: "n" } });
    resolve({ kind: "suppress", target: carol, effectId: "p" });
    resolve({ kind: "resume", target: carol, effectId: "p" });
    correct({ kind: "correctAmend", target: carol, effectId: "p", amendment: { note: "m" } });
    resolve({ kind: "remove", target: carol, effectId: "p" });
    expect(effectHistory().map((h) => h.provenance)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    const context = { provenance: { reason: "Courtier ability", sourcePlayer: idOf("Bob") } };
    state().resolveEffects({ context, intents: [{ kind: "apply", target: carol, effect: { id: "q", type: "drunk", lifetime: { kind: "untilDawn" } } }] });
    state().resolveEffects({ context, intents: [{ kind: "suppress", target: carol, effectId: "q" }] });
    state().resolveEffects({ context, intents: [{ kind: "correctRemove", target: carol, effectId: "q" }] });
    for (const record of effectHistory().slice(-3)) {
      expect(record.provenance).toEqual({ reason: "Courtier ability", sourceParticipant: participantRefOf(game(), idOf("Bob")) });
    }
  });

  it("expiry keeps its deterministic system provenance", () => {
    liveGame();
    resolve(apply("Carol", { id: "p", type: "poisoned", source: bind(idOf("Alice")), lifetime: { kind: "untilDawn" } }));
    state().advancePhase();
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "expire", provenance: { reason: "expired" } });
  });
});

// ---------------------------------------------------------------------------
describe("SOL-10B-R9: no net-zero Effect History within one transaction", () => {
  it("apply X -> remove X alongside a real change to Y records History for Y only", () => {
    liveGame();
    const carol = bind(idOf("Carol"));
    const r = resolve(
      apply("Carol", { id: "x", type: "poisoned", lifetime: { kind: "untilDawn" } }),
      apply("Bob", { id: "y", type: "drunk", lifetime: { kind: "manual" } }),
      { kind: "remove", target: carol, effectId: "x" },
    );
    expect(r).toMatchObject({ ok: true, changed: true, effectIds: ["y"] });
    expect(effectHistory().map((h) => [h.effectOperation, (h.change as unknown as { item: EffectRecord }).item.id])).toEqual([["apply", "y"]]);
    expect(player(idOf("Carol")).effects).toEqual([]);
  });

  it("suppress X -> resume X alongside a real change to Y records History for Y only", () => {
    liveGame();
    const carol = bind(idOf("Carol"));
    resolve(apply("Carol", { id: "x", type: "poisoned", lifetime: { kind: "untilDawn" } }));
    const count = effectHistory().length;
    const r = resolve(
      { kind: "suppress", target: carol, effectId: "x" },
      apply("Bob", { id: "y", type: "drunk", lifetime: { kind: "manual" } }),
      { kind: "resume", target: carol, effectId: "x" },
    );
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(effectHistory().slice(count).map((h) => h.effectOperation)).toEqual(["apply"]);
  });

  it("an identity that genuinely changed keeps every one of its ordered records", () => {
    liveGame();
    const carol = bind(idOf("Carol"));
    resolve(
      apply("Carol", { id: "x", type: "poisoned", lifetime: { kind: "untilDawn" } }),
      { kind: "suppress", target: carol, effectId: "x" },
      { kind: "update", target: carol, effectId: "x", changes: { note: "n" } },
    );
    expect(effectHistory().map((h) => h.effectOperation)).toEqual(["apply", "suppress", "update"]);
  });

  it("a transaction whose every identity nets to zero is a true no-op (no commit, no History)", () => {
    liveGame();
    const before = game();
    expect(resolve(apply("Carol", { id: "x", type: "poisoned", lifetime: { kind: "untilDawn" } }),
      { kind: "remove", target: bind(idOf("Carol")), effectId: "x" })).toEqual({ ok: true, changed: false, effectIds: [] });
    expect(state().game).toBe(before);
  });
});
