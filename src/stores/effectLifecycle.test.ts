// Phase 10B: the authoritative Effect lifecycle -- the pure planner
// (effectResolution.ts), its single store commit seam (resolveEffects), the
// compatibility adapters, deterministic phase expiry, Undo/localSeq, identity
// binding, History and the query API.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import {
  MAX_EFFECT_INTENTS,
  planEffectExpiry,
  planEffectTransaction,
  resolveEffectExpiry,
  type EffectIntent,
  type EffectParticipantBinding,
} from "./effectResolution";
import {
  effectiveEffects,
  effectInstances,
  effectsNeedingCheck,
  hasEffect,
  hasManualEffect,
  hasStoredEffect,
  manualEffectOf,
  manualEffectState,
} from "./effects";
import { effectAccessibleSummary, effectDefinitionOf, effectGroups, effectIndicatorOf, effectIndicators } from "./effectRegistry";
import { HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { participantRefOf } from "./participants";
import type { EffectRecord, HistoryRecord, PlayerId, StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const bind = (id: PlayerId): EffectParticipantBinding => ({ playerId: id, participantId: player(id).participantId! });
const effectHistory = () => game().history.filter((h) => h.category === "effect");

type Baseline = { game: StorytellerLobbyRecord; undo: number; seq: number; history: number };
const baseline = (): Baseline => ({ game: game(), undo: state().undoStack.length, seq: state().localSeq, history: game().history.length });
function expectInert(b: Baseline) {
  expect(state().game).toBe(b.game);
  expect(state().undoStack).toHaveLength(b.undo);
  expect(state().localSeq).toBe(b.seq);
}
function expectOneCommit(b: Baseline, historyAdded: number) {
  expect(state().game).not.toBe(b.game);
  expect(state().undoStack).toHaveLength(b.undo + 1);
  expect(state().localSeq).toBe(b.seq + 1);
  expect(game().history).toHaveLength(b.history + historyAdded);
}

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});

function setupGame() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
}
function liveGame() {
  setupGame();
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const resolve = (...intents: EffectIntent[]) => state().resolveEffects({ intents });
const apply = (name: string, effect: Extract<EffectIntent, { kind: "apply" }>["effect"]): EffectIntent =>
  ({ kind: "apply", target: bind(idOf(name)), effect });

// ---------------------------------------------------------------------------
// Core lifecycle
// ---------------------------------------------------------------------------
describe("Phase 10B core lifecycle: manual quick Effects", () => {
  it.each(["drunk", "poisoned", "protected"])("manual %s: one-tap apply and remove through the seam, with truthful History", (type) => {
    liveGame();
    const alice = idOf("Alice");
    const on = baseline();
    expect(state().setManualEffect(bind(alice), type, true)).toMatchObject({ ok: true, changed: true, effectIds: [`manual:${type}`] });
    expectOneCommit(on, 1);
    expect(manualEffectOf(player(alice), type)).toEqual({
      id: `manual:${type}`, type, lifetime: { kind: "manual" }, appliedAt: { phase: "night", day: 1 },
      state: "active", expiry: { kind: "none" },
    });
    expect(hasManualEffect(player(alice), type)).toBe(true);
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "apply", change: { kind: "added", item: { id: `manual:${type}` } }, moment: { phase: "night", day: 1 } });
    expect(effectHistory().at(-1)!.correction).toBeUndefined();

    const off = baseline();
    expect(state().setManualEffect(bind(alice), type, false)).toMatchObject({ ok: true, changed: true });
    expectOneCommit(off, 1);
    expect(manualEffectOf(player(alice), type)).toBeUndefined();
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "remove", change: { kind: "removed", item: { id: `manual:${type}` } } });
  });

  it("the setStatus compatibility adapter delegates through the same seam (one commit, same record)", () => {
    liveGame();
    const alice = idOf("Alice");
    const b = baseline();
    state().setStatus(alice, "poisoned", true);
    expectOneCommit(b, 1);
    expect(hasManualEffect(player(alice), "poisoned")).toBe(true);
    const again = baseline();
    state().setStatus(alice, "poisoned", true);
    expectInert(again);
  });

  it("an ability-shaped Poisoned coexists with the manual one; each is managed independently", () => {
    liveGame();
    const carol = idOf("Carol");
    expect(resolve(apply("Carol", { type: "poisoned", source: bind(idOf("Alice")), sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" } })).ok).toBe(true);
    // The manual quick control does NOT read the ability Effect as "on".
    expect(manualEffectState(player(carol), "poisoned")).toBe("absent");
    expect(hasEffect(player(carol), "poisoned")).toBe(true);
    // ...and adding / removing the manual one never touches the ability one.
    state().setManualEffect(bind(carol), "poisoned", true);
    expect(player(carol).effects.filter((e) => e.type === "poisoned")).toHaveLength(2);
    state().setManualEffect(bind(carol), "poisoned", false);
    const left = player(carol).effects;
    expect(left).toHaveLength(1);
    expect(left[0]!.sourceCharacter).toBe("poisoner");
    expect(hasEffect(player(carol), "poisoned")).toBe(true);
  });
});

describe("Phase 10B stacking: identity is participant + EffectId; nothing is de-duplicated", () => {
  it("same type from several sources, different types, and several protections all coexist; removing one leaves the rest", () => {
    liveGame();
    const carol = idOf("Carol");
    const result = resolve(
      apply("Carol", { id: "p1", type: "poisoned", source: bind(idOf("Alice")), lifetime: { kind: "untilDawn" } }),
      apply("Carol", { id: "p2", type: "poisoned", source: bind(idOf("Bob")), lifetime: { kind: "untilDawn" } }),
      apply("Carol", { id: "d1", type: "drunk", lifetime: { kind: "manual" } }),
      apply("Carol", { id: "s1", type: "safeFromDemon", lifetime: { kind: "untilDawn" } }),
      apply("Carol", { id: "s2", type: "cannotDie", lifetime: { kind: "untilDawn" } }),
      apply("Carol", { id: "s3", type: "protected", lifetime: { kind: "manual" } }),
    );
    expect(result).toMatchObject({ ok: true, changed: true, effectIds: ["p1", "p2", "d1", "s1", "s2", "s3"] });
    expect(player(carol).effects.map((e) => e.id)).toEqual(["p1", "p2", "d1", "s1", "s2", "s3"]);
    expect(resolve({ kind: "remove", target: bind(carol), effectId: "p1" }).ok).toBe(true);
    expect(player(carol).effects.map((e) => e.id)).toEqual(["p2", "d1", "s1", "s2", "s3"]);
    expect(hasEffect(player(carol), "poisoned")).toBe(true);
  });

  it("several semantic protections share the Protected indicator yet stay distinct; Protected implies no rule", () => {
    liveGame();
    resolve(
      apply("Carol", { id: "s1", type: "safeFromDemon", lifetime: { kind: "untilDawn" } }),
      apply("Carol", { id: "s2", type: "cannotDie", lifetime: { kind: "untilDawn" } }),
    );
    const carol = player(idOf("Carol"));
    expect(effectIndicators(carol)).toHaveLength(1);
    expect(effectIndicators(carol)[0]).toMatchObject({ indicator: { key: "protected", family: "protection" }, activeCount: 2 });
    expect(effectDefinitionOf("safeFromDemon").label).not.toBe(effectDefinitionOf("cannotDie").label);
    // No Life rule reads Effects: a protected player can still be recorded dead.
    expect(state().recordDeath(idOf("Carol")).ok).toBe(true);
  });
});

describe("Phase 10B Apply semantics", () => {
  it("an exact duplicate Apply is a true no-op; different content under the same id is refused, never upserted", () => {
    liveGame();
    expect(resolve(apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" }, note: "one" })).ok).toBe(true);
    const dup = baseline();
    expect(resolve(apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" }, note: "one" }))).toEqual({ ok: true, changed: false, effectIds: [] });
    expectInert(dup);
    const conflict = baseline();
    expect(resolve(apply("Alice", { id: "x", type: "marked", lifetime: { kind: "manual" }, note: "two" }))).toMatchObject({ ok: false, code: "conflict", intentIndex: 0 });
    expectInert(conflict);
    expect(state().addEffect(idOf("Alice"), { id: "x", type: "marked", lifetime: { kind: "manual" }, note: "two" })).toBeNull();
    expectInert(conflict);
  });

  it("smart defaults: a fresh id, the current applied moment and the resolved expiry are filled in -- never asked for", () => {
    liveGame();
    const r = resolve(apply("Alice", { type: "poisoned", lifetime: { kind: "untilDawn" } }));
    expect(r.ok && r.effectIds).toHaveLength(1);
    const effect = player(idOf("Alice")).effects[0]!;
    expect(effect.id).toMatch(/^fx-/);
    expect(effect.appliedAt).toEqual({ phase: "night", day: 1 });
    expect(effect.expiry).toEqual({ kind: "at", moment: { phase: "day", day: 1 } });
    expect(effect.state).toBe("active");
  });

  it("a caller can never hand in a prebuilt stored source snapshot or lifecycle field", () => {
    liveGame();
    const b = baseline();
    const smuggled = { type: "poisoned", lifetime: { kind: "manual" }, sourceParticipant: { kind: "participant", participantId: "pt-fake", playerId: "x", nameAtTime: "Mallory" } };
    expect(resolve(apply("Alice", smuggled as never))).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve(apply("Alice", { type: "poisoned", lifetime: { kind: "manual" }, state: "suppressed" } as never))).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve(apply("Alice", { type: "poisoned", lifetime: { kind: "untilDawn" }, expiry: { kind: "unresolved" } } as never))).toMatchObject({ ok: false });
    expectInert(b);
  });
});

describe("Phase 10B Update semantics", () => {
  function withEffect() {
    liveGame();
    resolve(apply("Carol", { id: "e", type: "mad", source: bind(idOf("Alice")), sourceCharacter: "cerenovus",
      lifetime: { kind: "throughFollowingDay" }, parameters: { character: { kind: "role", roleIds: ["chef"] } }, note: "mad as Chef" }));
    return idOf("Carol");
  }

  it("Update changes only mutable fields and records truthful full before/after snapshots (value, never 'added')", () => {
    const carol = withEffect();
    const before = player(carol).effects[0]!;
    const b = baseline();
    const r = resolve({ kind: "update", target: bind(carol), effectId: "e", changes: {
      note: "mad as Empath", parameters: { character: { kind: "role", roleIds: ["empath"] } },
      expiry: { kind: "at", moment: { phase: "night", day: 3 } },
    } });
    expect(r).toMatchObject({ ok: true, changed: true, effectIds: [] });
    expectOneCommit(b, 1);
    const after = player(carol).effects[0]!;
    expect(after).toMatchObject({ id: "e", type: "mad", sourceCharacter: "cerenovus", note: "mad as Empath",
      appliedAt: before.appliedAt, sourceParticipant: before.sourceParticipant,
      parameters: { character: { kind: "role", roleIds: ["empath"] } }, expiry: { kind: "at", moment: { phase: "night", day: 3 } } });
    const record = effectHistory().at(-1)!;
    expect(record).toMatchObject({ effectOperation: "update", change: { kind: "value", from: before, to: after } });
    expect(record.correction).toBeUndefined();
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
  });

  it.each([
    ["type", { type: "poisoned" }],
    ["id", { id: "other" }],
    ["source", { source: { playerId: "x", participantId: "y" } }],
    ["sourceCharacter", { sourceCharacter: "witch" }],
    ["appliedAt", { appliedAt: { phase: "night", day: 1 } }],
    ["lifetime", { lifetime: { kind: "manual" } }],
    ["state", { state: "suppressed" }],
  ])("an ordinary Update cannot rewrite %s (immutable origin/identity) -- refused, nothing changes", (_field, changes) => {
    const carol = withEffect();
    const b = baseline();
    expect(resolve({ kind: "update", target: bind(carol), effectId: "e", changes: changes as never })).toMatchObject({ ok: false, code: "immutable" });
    expectInert(b);
  });

  it("an Update whose result equals Current State is a true no-op", () => {
    const carol = withEffect();
    const b = baseline();
    expect(resolve({ kind: "update", target: bind(carol), effectId: "e", changes: { note: "mad as Chef" } })).toMatchObject({ ok: true, changed: false });
    expectInert(b);
  });

  it("parameters merge per key; null deletes a key; an Effect with no parameters stores none", () => {
    const carol = withEffect();
    resolve({ kind: "update", target: bind(carol), effectId: "e", changes: { parameters: { extra: { kind: "number", value: 2 } } } });
    expect(player(carol).effects[0]!.parameters).toEqual({ character: { kind: "role", roleIds: ["chef"] }, extra: { kind: "number", value: 2 } });
    resolve({ kind: "update", target: bind(carol), effectId: "e", changes: { parameters: { character: null, extra: null } } });
    expect("parameters" in player(carol).effects[0]!).toBe(false);
  });

  it("an expiry override must be a strictly future Night/Day (never now/past, never unresolved)", () => {
    const carol = withEffect();
    const b = baseline();
    expect(resolve({ kind: "update", target: bind(carol), effectId: "e", changes: { expiry: { kind: "at", moment: { phase: "night", day: 1 } } } }))
      .toMatchObject({ ok: false, code: "expiryUnresolvable" });
    expect(resolve({ kind: "update", target: bind(carol), effectId: "e", changes: { expiry: { kind: "unresolved" } as never } }))
      .toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
  });
});

describe("Phase 10B Remove / suppress / resume", () => {
  it("Remove deletes exactly one EffectId and records the removed snapshot; removing an absent Effect is a no-op", () => {
    liveGame();
    const carol = idOf("Carol");
    resolve(apply("Carol", { id: "a", type: "poisoned", lifetime: { kind: "manual" } }), apply("Carol", { id: "b", type: "poisoned", lifetime: { kind: "manual" } }));
    const snapshot = player(carol).effects[0]!;
    expect(resolve({ kind: "remove", target: bind(carol), effectId: "a" }).ok).toBe(true);
    expect(player(carol).effects.map((e) => e.id)).toEqual(["b"]);
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "remove", change: { kind: "removed", item: snapshot } });
    const b = baseline();
    expect(resolve({ kind: "remove", target: bind(carol), effectId: "a" })).toEqual({ ok: true, changed: false, effectIds: [] });
    expectInert(b);
  });

  it("suppress preserves the Effect (id, origin, application, expiry, parameters); it no longer applies; resume restores the same Effect", () => {
    liveGame();
    const carol = idOf("Carol");
    resolve(apply("Carol", { id: "p", type: "poisoned", source: bind(idOf("Alice")), sourceCharacter: "poisoner",
      lifetime: { kind: "throughFollowingDay" }, parameters: { chosen: { kind: "participant", participants: [bind(idOf("Carol"))] } } }));
    const original = player(carol).effects[0]!;
    const s = baseline();
    expect(resolve({ kind: "suppress", target: bind(carol), effectId: "p" }).ok).toBe(true);
    expectOneCommit(s, 1);
    const suppressed = player(carol).effects[0]!;
    expect(suppressed).toEqual({ ...original, state: "suppressed" });
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "suppress", change: { kind: "value", from: original, to: suppressed } });
    // Mechanical queries ignore it; inspection still finds it.
    expect(hasEffect(player(carol), "poisoned")).toBe(false);
    expect(effectiveEffects(player(carol))).toEqual([]);
    expect(hasStoredEffect(player(carol), "poisoned")).toBe(true);
    expect(effectInstances(player(carol))).toEqual([suppressed]);
    expect(effectIndicators(player(carol))).toEqual([]);
    // Suppress again: already current -> no-op.
    const again = baseline();
    expect(resolve({ kind: "suppress", target: bind(carol), effectId: "p" })).toMatchObject({ ok: true, changed: false });
    expectInert(again);
    expect(resolve({ kind: "resume", target: bind(carol), effectId: "p" }).ok).toBe(true);
    expect(player(carol).effects[0]).toEqual(original);
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "resume" });
    const resumed = baseline();
    expect(resolve({ kind: "resume", target: bind(carol), effectId: "p" })).toMatchObject({ ok: true, changed: false });
    expectInert(resumed);
  });

  it("Poisoned + a temporary Sober & healthy override coexist -- the override never deletes the Poisoned instance", () => {
    liveGame();
    const carol = idOf("Carol");
    resolve(apply("Carol", { id: "p", type: "poisoned", lifetime: { kind: "throughFollowingDay" } }),
      apply("Carol", { id: "s", type: "soberHealthy", lifetime: { kind: "untilDawn" } }));
    expect(player(carol).effects.map((e) => e.type)).toEqual(["poisoned", "soberHealthy"]);
    expect(hasEffect(player(carol), "poisoned")).toBe(true);
  });

  it("suppress/resume/update of a missing Effect refuses with notFound", () => {
    liveGame();
    const b = baseline();
    for (const kind of ["suppress", "resume"] as const) {
      expect(resolve({ kind, target: bind(idOf("Alice")), effectId: "nope" })).toMatchObject({ ok: false, code: "notFound" });
    }
    expect(resolve({ kind: "update", target: bind(idOf("Alice")), effectId: "nope", changes: { note: "x" } })).toMatchObject({ ok: false, code: "notFound" });
    expectInert(b);
  });
});

describe("Phase 10B corrections", () => {
  it("a correction can repair origin and lifecycle; History is a value change marked correction, old History untouched", () => {
    liveGame();
    const carol = idOf("Carol");
    resolve(apply("Carol", { id: "p", type: "poisoned", source: bind(idOf("Bob")), sourceCharacter: "witch", lifetime: { kind: "untilDawn" } }));
    const historyBefore = structuredClone(game().history);
    const before = player(carol).effects[0]!;
    const b = baseline();
    const r = state().resolveEffects({ intents: [{ kind: "correctAmend", target: bind(carol), effectId: "p", amendment: {
      source: bind(idOf("Alice")), sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" },
    } }] });
    expect(r.ok).toBe(true);
    expectOneCommit(b, 1);
    const after = player(carol).effects[0]!;
    expect(after.sourceParticipant).toEqual(participantRefOf(game(), idOf("Alice")));
    expect(after.sourceCharacter).toBe("poisoner");
    expect(after.expiry).toEqual({ kind: "at", moment: { phase: "night", day: 2 } }); // re-resolved from its applied moment
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "update", correction: true, change: { kind: "value", from: before, to: after } });
    expect(game().history.slice(0, historyBefore.length)).toEqual(historyBefore);
  });

  it("correction add (at an earlier applied moment) and correction remove are marked correction; ids cannot be corrected", () => {
    liveGame();
    state().advancePhase(); // Day 1
    const carol = idOf("Carol");
    expect(state().resolveEffects({ intents: [{ kind: "correctApply", target: bind(carol), effect: {
      id: "forgot", type: "poisoned", lifetime: { kind: "throughFollowingDay" }, appliedAt: { phase: "night", day: 1 },
    } }] }).ok).toBe(true);
    const added = player(carol).effects[0]!;
    expect(added).toMatchObject({ appliedAt: { phase: "night", day: 1 }, expiry: { kind: "at", moment: { phase: "night", day: 2 } } });
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "apply", correction: true, moment: { phase: "day", day: 1 } });
    // Anchored at Night 1, "until dawn" would already have expired: refused.
    expect(state().resolveEffects({ intents: [{ kind: "correctApply", target: bind(carol), effect: {
      type: "poisoned", lifetime: { kind: "untilDawn" }, appliedAt: { phase: "night", day: 1 },
    } }] })).toMatchObject({ ok: false, code: "expiryUnresolvable" });
    expect(state().resolveEffects({ intents: [{ kind: "correctAmend", target: bind(carol), effectId: "forgot", amendment: { id: "new" } as never }] }))
      .toMatchObject({ ok: false, code: "invalid" });
    expect(state().resolveEffects({ intents: [{ kind: "correctRemove", target: bind(carol), effectId: "forgot" }] }).ok).toBe(true);
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "remove", correction: true, change: { kind: "removed", item: added } });
  });

  it("gameplay and correction intents are never mixed in one transaction", () => {
    liveGame();
    const b = baseline();
    expect(resolve(apply("Alice", { type: "drunk", lifetime: { kind: "manual" } }),
      { kind: "correctRemove", target: bind(idOf("Alice")), effectId: "x" })).toMatchObject({ ok: false, code: "mixedCorrection" });
    expectInert(b);
  });

  it("gameplay records are never marked correction, and correction is valid History for the effect category", () => {
    liveGame();
    state().setManualEffect(bind(idOf("Alice")), "drunk", true);
    expect(effectHistory().every((h) => h.correction === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transactions, Undo and localSeq
// ---------------------------------------------------------------------------
describe("Phase 10B transactions", () => {
  it("several ordered operations on several participants: all-or-nothing, one Undo entry, one localSeq step", () => {
    liveGame();
    const b = baseline();
    const r = state().resolveEffects({ resolutionId: "res-1", context: { provenance: { reason: "Poisoner ability" } }, intents: [
      apply("Alice", { id: "a", type: "poisoned", lifetime: { kind: "untilDawn" } }),
      apply("Bob", { id: "b", type: "drunk", lifetime: { kind: "manual" } }),
      { kind: "suppress", target: bind(idOf("Alice")), effectId: "a" },
    ] });
    expect(r).toMatchObject({ ok: true, changed: true, effectIds: ["a", "b"] });
    expectOneCommit(b, 3);
    const records = effectHistory().slice(-3);
    expect(records.map((h) => h.effectOperation)).toEqual(["apply", "apply", "suppress"]);
    expect(records.every((h) => h.resolutionId === "res-1" && h.provenance?.reason === "Poisoner ability")).toBe(true);
    // One Undo restores every Effect and History record at once.
    state().undo();
    expect(state().game).toEqual(b.game);
  });

  it("a later refusal rolls back every earlier intent (atomic), reporting which intent failed", () => {
    liveGame();
    const b = baseline();
    expect(resolve(
      apply("Alice", { type: "poisoned", lifetime: { kind: "untilDawn" } }),
      { kind: "suppress", target: bind(idOf("Bob")), effectId: "missing" },
    )).toMatchObject({ ok: false, code: "notFound", intentIndex: 1 });
    expectInert(b);
  });

  it("table-wide Effects at the participant cap fit; an oversized or empty transaction is refused", () => {
    liveGame();
    const everyone = game().seatOrder.map((id) => ({ kind: "apply" as const, target: bind(id), effect: { type: "marked", lifetime: { kind: "manual" as const } } }));
    expect(state().resolveEffects({ intents: everyone }).ok).toBe(true);
    const b = baseline();
    const tooMany = Array.from({ length: MAX_EFFECT_INTENTS + 1 }, () => everyone[0]!);
    expect(state().resolveEffects({ intents: tooMany })).toMatchObject({ ok: false, code: "tooMany" });
    expect(state().resolveEffects({ intents: [] })).toMatchObject({ ok: false, code: "tooMany" });
    expect(state().resolveEffects({ intents: [everyone[0]!], resolutionId: "" })).toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
  });

  it("the planner is pure: planning never mutates the game it reads", () => {
    liveGame();
    const g = game();
    const frozen = structuredClone(g);
    const r = planEffectTransaction(g, { intents: [apply("Alice", { type: "poisoned", lifetime: { kind: "untilDawn" } })] });
    expect(r.ok && r.changed).toBe(true);
    expect(g).toEqual(frozen);
    expect(state().game).toBe(g);
  });

  it("an ended game's Effects are frozen", () => {
    liveGame();
    state().setManualEffect(bind(idOf("Alice")), "drunk", true);
    expect(state().setPhase("ended").ok).toBe(true);
    const b = baseline();
    expect(resolve({ kind: "remove", target: bind(idOf("Alice")), effectId: "manual:drunk" })).toMatchObject({ ok: false, code: "phase" });
    expectInert(b);
    expect(hasManualEffect(player(idOf("Alice")), "drunk")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Identity binding
// ---------------------------------------------------------------------------
describe("Phase 10B identity binding", () => {
  it("a stale target ParticipantId (seat now holds someone else) refuses -- the new occupant is never changed", () => {
    liveGame();
    const alice = idOf("Alice");
    const staleAlice = bind(alice);
    state().unseatPlayer(alice);
    state().addPlayerToSeat("Mallory");
    expect(player(alice).participantId).not.toBe(staleAlice.participantId);
    const b = baseline();
    expect(state().resolveEffects({ intents: [{ kind: "apply", target: staleAlice, effect: { type: "poisoned", lifetime: { kind: "manual" } } }] }))
      .toMatchObject({ ok: false, code: "stale" });
    expect(state().setManualEffect(staleAlice, "poisoned", true)).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
    expect(player(alice).effects).toEqual([]);
  });

  it("an empty seat is stale for a bound caller; a missing participant binding is invalid; an unknown seat is notSeated", () => {
    liveGame();
    const alice = idOf("Alice");
    const staleAlice = bind(alice);
    state().unseatPlayer(alice);
    expect(state().resolveEffects({ intents: [{ kind: "apply", target: staleAlice, effect: { type: "x", lifetime: { kind: "manual" } } }] })).toMatchObject({ code: "stale" });
    expect(state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: idOf("Bob") } as never, effect: { type: "x", lifetime: { kind: "manual" } } }] })).toMatchObject({ code: "invalid" });
    expect(state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: "toString", participantId: "p" }, effect: { type: "x", lifetime: { kind: "manual" } } }] })).toMatchObject({ code: "notSeated" });
    expect(state().addEffect(alice, { type: "x", lifetime: { kind: "manual" } })).toBeNull();
  });

  it("a stale source ParticipantId refuses the whole transaction", () => {
    liveGame();
    const bob = idOf("Bob");
    const staleBob = bind(bob);
    state().unseatPlayer(bob);
    state().addPlayerToSeat("Trent");
    store.setState({ undoStack: [] });
    const b = baseline();
    expect(resolve(apply("Carol", { type: "poisoned", source: staleBob, lifetime: { kind: "manual" } }))).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
  });

  it("the source ParticipantRef survives the source's departure; source character never rewrites; a replacement never inherits", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    const aliceRef = participantRefOf(game(), alice);
    resolve(apply("Carol", { id: "p", type: "poisoned", source: bind(alice), sourceCharacter: "poisoner", lifetime: { kind: "manual" } }),
      apply("Alice", { id: "own", type: "drunk", lifetime: { kind: "manual" } }));
    state().assignRole(alice, "chef");
    state().unseatPlayer(alice);
    state().addPlayerToSeat("Mallory");
    const effect = player(carol).effects[0]!;
    expect(effect.sourceParticipant).toEqual(aliceRef);
    expect(effect.sourceCharacter).toBe("poisoner");
    // The replacement occupant of Alice's seat has none of Alice's Effects.
    expect(player(alice).effects).toEqual([]);
    expect(player(alice).name).toBe("Mallory");
  });

  it("participant-valued parameters are stored as durable refs and stay pointing at the original participant", () => {
    liveGame();
    const bob = idOf("Bob");
    const bobRef = participantRefOf(game(), bob);
    resolve(apply("Carol", { id: "m", type: "marked", lifetime: { kind: "manual" },
      parameters: { chosen: { kind: "participant", participants: [bind(bob)] }, flag: { kind: "boolean", value: true }, n: { kind: "number", value: 3 },
        side: { kind: "alignment", alignment: "evil" }, why: { kind: "text", value: "because" } } }));
    state().unseatPlayer(bob);
    state().addPlayerToSeat("Trent");
    const stored = player(idOf("Carol")).effects[0]!.parameters!;
    expect(stored.chosen).toEqual({ kind: "participant", participants: [bobRef] });
    expect((stored.chosen as { participants: { participantId: string }[] }).participants[0]!.participantId).not.toBe(player(bob).participantId);
  });

  it("malformed parameters refuse atomically: bad key, empty participant list, non-finite number, stale participant", () => {
    liveGame();
    const b = baseline();
    const bad = [
      { "bad key": { kind: "number", value: 1 } },
      { chosen: { kind: "participant", participants: [] } },
      { n: { kind: "number", value: Number.NaN } },
      { chosen: { kind: "participant", participants: [{ playerId: idOf("Bob"), participantId: "pt-not-bob" }] } },
      { weird: { kind: "mystery" } },
    ];
    for (const parameters of bad) {
      expect(resolve(apply("Carol", { type: "marked", lifetime: { kind: "manual" }, parameters: parameters as never })).ok).toBe(false);
    }
    expectInert(b);
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------
describe("Phase 10B expiry resolution (pure, no wall clock)", () => {
  it.each([
    ["untilDawn", { phase: "night", day: 2 }, { phase: "day", day: 2 }],
    ["untilDawn", { phase: "day", day: 2 }, { phase: "day", day: 3 }],
    ["untilNextNight", { phase: "night", day: 2 }, { phase: "night", day: 3 }],
    ["untilNextNight", { phase: "day", day: 2 }, { phase: "night", day: 3 }],
    ["throughFollowingDay", { phase: "night", day: 2 }, { phase: "night", day: 3 }],
    ["throughFollowingDay", { phase: "day", day: 2 }, { phase: "night", day: 4 }],
  ] as const)("%s applied at %j expires entering %j", (kind, anchor, expected) => {
    expect(resolveEffectExpiry({ kind }, anchor)).toEqual({ kind: "at", moment: expected });
  });

  it("counted lifetimes, manual, Setup and malformed input", () => {
    expect(resolveEffectExpiry({ kind: "nights", count: 1 }, { phase: "night", day: 1 })).toEqual({ kind: "at", moment: { phase: "day", day: 1 } });
    expect(resolveEffectExpiry({ kind: "nights", count: 2 }, { phase: "day", day: 1 })).toEqual({ kind: "at", moment: { phase: "day", day: 3 } });
    expect(resolveEffectExpiry({ kind: "days", count: 2 }, { phase: "night", day: 1 })).toEqual({ kind: "at", moment: { phase: "night", day: 3 } });
    expect(resolveEffectExpiry({ kind: "manual" }, { phase: "setup", day: 0 })).toEqual({ kind: "none" });
    expect(resolveEffectExpiry({ kind: "untilDawn" }, { phase: "setup", day: 0 })).toBeNull();
    expect(resolveEffectExpiry({ kind: "nights", count: 0 }, { phase: "night", day: 1 })).toBeNull();
  });
});

describe("Phase 10B deterministic phase expiry", () => {
  it("Night -> Day: an untilDawn Effect expires atomically with the phase change; History uses the DESTINATION moment", () => {
    liveGame();
    const carol = idOf("Carol");
    resolve(apply("Carol", { id: "d", type: "safeFromDemon", source: bind(idOf("Alice")), sourceCharacter: "monk", lifetime: { kind: "untilDawn" } }),
      apply("Carol", { id: "k", type: "drunk", lifetime: { kind: "manual" } }));
    const effect = player(carol).effects[0]!;
    const b = baseline();
    expect(state().advancePhase().ok).toBe(true);
    expectOneCommit(b, 1);
    expect(game().phase).toBe("day");
    expect(player(carol).effects.map((e) => e.id)).toEqual(["k"]);
    const record = effectHistory().at(-1)!;
    expect(record).toMatchObject({ effectOperation: "expire", moment: { phase: "day", day: 1 }, change: { kind: "removed", item: effect },
      provenance: { reason: "expired" }, participant: participantRefOf(game(), carol) });
    expect(record.correction).toBeUndefined();
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
  });

  it("Day -> Night: several expiries in one rollover, across participants; suppressed Effects expire too; one Undo restores everything", () => {
    liveGame();
    state().advancePhase(); // Day 1
    store.setState({ undoStack: [] });
    resolve(apply("Alice", { id: "a", type: "poisoned", lifetime: { kind: "untilNextNight" } }),
      apply("Bob", { id: "b", type: "mad", lifetime: { kind: "days", count: 1 } }),
      apply("Bob", { id: "c", type: "cannotDie", lifetime: { kind: "untilNextNight" } }),
      apply("Carol", { id: "later", type: "poisoned", lifetime: { kind: "throughFollowingDay" } }),
      { kind: "suppress", target: bind(idOf("Bob")), effectId: "c" });
    const beforeAdvance = game();
    const lifeWindowBefore = game().lifeEventWindow;
    const b = baseline();
    expect(state().advancePhase().ok).toBe(true);
    expectOneCommit(b, 3);
    expect(game()).toMatchObject({ phase: "night", day: 2 });
    expect(player(idOf("Alice")).effects).toEqual([]);
    expect(player(idOf("Bob")).effects).toEqual([]);
    expect(player(idOf("Carol")).effects.map((e) => e.id)).toEqual(["later"]);
    expect(effectHistory().slice(-3).map((h) => [h.effectOperation, (h.change as unknown as { item: EffectRecord }).item.id, h.moment]))
      .toEqual([["expire", "a", { phase: "night", day: 2 }], ["expire", "b", { phase: "night", day: 2 }], ["expire", "c", { phase: "night", day: 2 }]]);
    state().undo();
    expect(state().game).toEqual(beforeAdvance);
    expect(game().lifeEventWindow).toEqual(lifeWindowBefore);
    expect(game()).toMatchObject({ phase: "day", day: 1 });
  });

  it("an advance with nothing expiring writes no Effect History; manual and unresolved Effects never expire", () => {
    liveGame();
    resolve(apply("Alice", { id: "m", type: "drunk", lifetime: { kind: "manual" } }));
    const g = game();
    const legacy = { id: "legacy", type: "poisoned", lifetime: { kind: "untilDawn" }, state: "active", expiry: { kind: "unresolved" } } as EffectRecord;
    store.setState({ game: { ...g, players: { ...g.players, [idOf("Bob")]: { ...player(idOf("Bob")), effects: [legacy] } } } });
    const count = effectHistory().length;
    for (let i = 0; i < 4; i++) expect(state().advancePhase().ok).toBe(true);
    expect(effectHistory()).toHaveLength(count);
    expect(player(idOf("Alice")).effects.map((e) => e.id)).toEqual(["m"]);
    expect(player(idOf("Bob")).effects).toEqual([legacy]);
    expect(effectsNeedingCheck(player(idOf("Bob")))).toEqual([legacy]);
  });

  it("entering the ended state invents no final expiry; Effects stay frozen", () => {
    liveGame();
    resolve(apply("Alice", { id: "a", type: "poisoned", lifetime: { kind: "untilDawn" } }));
    const count = effectHistory().length;
    expect(state().setPhase("ended").ok).toBe(true);
    expect(player(idOf("Alice")).effects.map((e) => e.id)).toEqual(["a"]);
    expect(effectHistory()).toHaveLength(count);
  });

  it("setPhase Night -> Day (delegating to advancePhase) expires exactly the same way", () => {
    liveGame();
    resolve(apply("Alice", { id: "a", type: "poisoned", lifetime: { kind: "untilDawn" } }));
    expect(state().setPhase("day").ok).toBe(true);
    expect(player(idOf("Alice")).effects).toEqual([]);
    expect(effectHistory().at(-1)).toMatchObject({ effectOperation: "expire", moment: { phase: "day", day: 1 } });
  });

  it("no render/query/reconnect/time expiry: queries and planning never remove anything -- and an overdue Effect is invalid persisted state (SOL-10B-R4), never concealed by rollover", () => {
    liveGame();
    const g = game();
    // An Effect whose boundary is already behind the current moment (only
    // reachable by data outside the commands) is still left alone by every
    // read path: expiry happens ONLY inside a phase transition.
    const overdue = { id: "o", type: "poisoned", lifetime: { kind: "untilDawn" }, state: "active", expiry: { kind: "at", moment: { phase: "night", day: 1 } } } as EffectRecord;
    store.setState({ game: { ...g, players: { ...g.players, [idOf("Alice")]: { ...player(idOf("Alice")), effects: [overdue] } } } });
    const snapshot = game();
    hasEffect(player(idOf("Alice")), "poisoned");
    effectIndicators(player(idOf("Alice")));
    effectAccessibleSummary(player(idOf("Alice")));
    planEffectTransaction(snapshot, { intents: [apply("Bob", { type: "x", lifetime: { kind: "manual" } })] });
    expect(state().game).toBe(snapshot);
    expect(player(idOf("Alice")).effects).toEqual([overdue]);
    // Such state can never be authoritative: the persisted schema rejects it.
    expect(StorytellerGamePersistedSchema.safeParse(snapshot).success).toBe(false);
    // planEffectExpiry is only ever consulted with a destination.
    expect(planEffectExpiry(snapshot, { phase: "day", day: 1 })).not.toBeNull();
  });
});

describe("Phase 10B Setup", () => {
  it("manual Effects may be created in Setup (no History); timed ones are refused; beginning Night 1 fabricates no History", () => {
    setupGame();
    const alice = idOf("Alice");
    expect(state().setManualEffect(bind(alice), "drunk", true).ok).toBe(true);
    expect(manualEffectOf(player(alice), "drunk")).toMatchObject({ appliedAt: { phase: "setup", day: 0 }, expiry: { kind: "none" } });
    expect(game().history).toEqual([]);
    const b = baseline();
    expect(resolve(apply("Alice", { type: "poisoned", lifetime: { kind: "untilDawn" } }))).toMatchObject({ ok: false, code: "expiryUnresolvable" });
    expect(resolve(apply("Alice", { type: "poisoned", lifetime: { kind: "untilDawn" }, expiry: { kind: "at", moment: { phase: "night", day: 1 } } }))).toMatchObject({ ok: false, code: "expiryUnresolvable" });
    expectInert(b);
    expect(state().beginNightOne().ok).toBe(true);
    expect(game().history).toEqual([]);
    expect(hasManualEffect(player(alice), "drunk")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Queries / registry
// ---------------------------------------------------------------------------
describe("Phase 10B query API and presentation registry", () => {
  it("aggregates effective Effects by visual indicator with multiplicity; unknown types remain valid custom indicators", () => {
    liveGame();
    resolve(apply("Carol", { id: "p1", type: "poisoned", lifetime: { kind: "manual" } }),
      apply("Carol", { id: "p2", type: "poisoned", lifetime: { kind: "manual" } }),
      apply("Carol", { id: "p3", type: "poisoned", lifetime: { kind: "manual" } }),
      apply("Carol", { id: "h", type: "hexed-by-witch", lifetime: { kind: "manual" } }),
      apply("Carol", { id: "d", type: "drunk", lifetime: { kind: "manual" } }),
      { kind: "suppress", target: bind(idOf("Carol")), effectId: "p3" });
    const carol = player(idOf("Carol"));
    expect(effectIndicators(carol).map((s) => [s.indicator.key, s.activeCount])).toEqual([["drunk", 1], ["poisoned", 2], ["custom:hexed-by-witch", 1]]);
    expect(effectIndicatorOf("hexed-by-witch")).toMatchObject({ family: "custom", label: "Hexed by witch" });
    expect(effectAccessibleSummary(carol)).toBe("Drunk; Poisoned, 2 active effects; Hexed by witch");
    expect(effectGroups(carol).find((g) => g.indicator.key === "poisoned")).toMatchObject({ activeCount: 2, suppressedCount: 1 });
  });
});

describe("Phase 10B History schema", () => {
  const participant = { kind: "participant", participantId: "pt", playerId: "p", nameAtTime: "P" };
  const effect = { id: "e", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } };
  const record = (over: Partial<HistoryRecord> & Record<string, unknown>) => ({ id: "h", category: "effect", participant, ...over });

  it("accepts truthful lifecycle records and rejects mismatched or malformed ones", () => {
    expect(HistoryRecordSchema.safeParse(record({ effectOperation: "apply", change: { kind: "added", item: effect } })).success).toBe(true);
    expect(HistoryRecordSchema.safeParse(record({ effectOperation: "update", correction: true, change: { kind: "value", from: effect, to: { ...effect, note: "x" } } })).success).toBe(true);
    // Update recorded as "added" is misleading History.
    expect(HistoryRecordSchema.safeParse(record({ effectOperation: "update", change: { kind: "added", item: effect } })).success).toBe(false);
    // Expiry is never a correction.
    expect(HistoryRecordSchema.safeParse(record({ effectOperation: "expire", correction: true, change: { kind: "removed", item: effect } })).success).toBe(false);
    // A v20 snapshot must be a complete, valid v20 Effect (lifecycle and source).
    expect(HistoryRecordSchema.safeParse(record({ effectOperation: "update", change: { kind: "value", from: effect, to: { ...effect, state: "paused" } } })).success).toBe(false);
    expect(HistoryRecordSchema.safeParse(record({ effectOperation: "update", change: { kind: "value", from: effect, to: { ...effect, sourcePlayer: "p" } } })).success).toBe(false);
    expect(HistoryRecordSchema.safeParse(record({ change: { kind: "value", from: { sourcePlayer: "p" }, to: {} } })).success).toBe(false);
    // Lifecycle metadata belongs to the effect category only.
    expect(HistoryRecordSchema.safeParse({ ...record({ effectOperation: "apply", change: { kind: "added", item: {} } }), category: "reminder" }).success).toBe(false);
    expect(HistoryRecordSchema.safeParse({ id: "h", category: "role", participant, correction: true, change: { kind: "value", from: {}, to: {} } }).success).toBe(false);
    // A v19 effect record (no operation) keeps validating.
    expect(HistoryRecordSchema.safeParse(record({ change: { kind: "added", item: { id: "old", type: "poisoned", lifetime: { kind: "untilDawn" } } } })).success).toBe(true);
  });
});
