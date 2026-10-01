// Phase 10E: the authoritative Actual Alignment seam -- planAlignmentTransaction
// / applyAlignmentPlan / resolveAlignments and the two compatibility adapters.
// Traceability: each describe names the PHASE10E.md acceptance criteria it
// proves (10E-AC-nn).
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import {
  ALIGNMENT_PLAN_FIELDS,
  MAX_ALIGNMENT_INTENTS,
  alignmentChangeOpen,
  applyAlignmentPlan,
  changeAlignmentIntent,
  correctAlignmentIntent,
  planAlignmentTransaction,
  type AlignmentIdSource,
  type AlignmentIntent,
  type AlignmentTransaction,
} from "./alignmentResolution";
import { applyRolePlan, changeRoleIntent, correctRoleIntent, planRoleTransaction, setPerceptionIntent } from "./roleResolution";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { projectToSelf } from "./projections";
import { buildRegistry } from "@/data/roleRegistry";
import type { PlayerId, PrivatePacket, StorytellerLobbyRecord, STPlayerRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const alignmentHistory = (g: StorytellerLobbyRecord = game()) => g.history.filter((h) => h.category === "alignment");
const registry = buildRegistry(setupScript);

function counterIds(): AlignmentIdSource {
  let h = 0; let e = 0;
  return { historyId: () => `h-${++h}`, packetEpoch: () => `epoch-${++e}` };
}
const plan = (g: StorytellerLobbyRecord, intents: unknown, extra: Record<string, unknown> = {}) =>
  planAlignmentTransaction(g, { intents, ...extra } as unknown as AlignmentTransaction, { ids: counterIds() });
const resolve = (intents: unknown, extra: Record<string, unknown> = {}) =>
  state().resolveAlignments({ intents, ...extra } as unknown as AlignmentTransaction);

type Baseline = { game: StorytellerLobbyRecord; undo: number; seq: number };
const baseline = (): Baseline => ({ game: game(), undo: state().undoStack.length, seq: state().localSeq });
function expectInert(b: Baseline) {
  expect(state().game).toBe(b.game);
  expect(state().undoStack).toHaveLength(b.undo);
  expect(state().localSeq).toBe(b.seq);
}
function expectOneCommit(b: Baseline) {
  expect(state().game).not.toBe(b.game);
  expect(state().undoStack).toHaveLength(b.undo + 1);
  expect(state().localSeq).toBe(b.seq + 1);
}
const seed = (id: PlayerId, patch: Partial<STPlayerRecord>) =>
  store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), ...patch } } } });
const packet = (shownRole: string, shownAlignment?: "good" | "evil"): PrivatePacket =>
  ({ id: "pkt-1", payload: { shownRole, ...(shownAlignment ? { shownAlignment } : {}), extraText: "sent" }, forDay: 1, forPhase: "night" });
/** Every field except the ones a test expects to change. */
const without = (p: STPlayerRecord, ...fields: (keyof STPlayerRecord)[]) => {
  const copy: Record<string, unknown> = structuredClone(p);
  for (const field of fields) delete copy[field];
  return copy;
};

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  localStorage.clear();
});

function setupTable() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) state().showAssignedRole(id);
}
function revealedTable() { setupTable(); expect(state().revealRoles().ok).toBe(true); }
function liveGame() { revealedTable(); expect(state().beginNightOne().ok).toBe(true); store.setState({ undoStack: [] }); }
/** A live game with one Traveler (Thief), alignment unresolved. */
function liveGameWithTraveler() {
  liveGame();
  state().addPlayer("Zed");
  const zed = idOf("Zed");
  expect(player(zed).isTraveler).toBe(true);
  expect(state().assignRole(zed, "thief")).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] });
  return zed;
}

// ---------------------------------------------------------------------------
describe("10E-AC-01: ordinary gameplay change", () => {
  it("Good -> Evil changes only Actual Alignment: one History record, one Undo entry, one localSeq step", () => {
    liveGame();
    const chef = holder("chef");
    state().setManualEffect({ playerId: chef, participantId: player(chef).participantId! }, "poisoned", true);
    state().addReminder(chef, { label: "Chosen" });
    seed(chef, { publishedPacket: packet("chef", "good"), privateInfo: { extraText: "draft" } });
    store.setState({ undoStack: [] });
    const before = player(chef);
    const b = baseline();
    expect(state().resolveAlignments({ intents: [changeAlignmentIntent(before, "evil")] })).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    const after = player(chef);
    expect(after.actualAlignment).toBe("evil");
    // Actual Role, perception, Life, Effects, Reminders -- and an ordinary
    // participant's packet/draft -- are unchanged.
    expect(without(after, "actualAlignment")).toEqual(without(before, "actualAlignment"));
    const records = alignmentHistory();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      id: expect.any(String), category: "alignment",
      participant: { kind: "participant", participantId: before.participantId, playerId: chef, nameAtTime: before.name },
      moment: { phase: "night", day: 1 },
      change: { kind: "value", from: { actualAlignment: "good" }, to: { actualAlignment: "evil" } },
    });
    expect(HistoryRecordSchema.safeParse(records[0]).success).toBe(true);
    // Every other player is untouched (same references).
    for (const id of game().seatOrder.filter((id) => id !== chef)) expect(player(id)).toBe(b.game.players[id]);
  });
});

describe("10E-AC-02: correction", () => {
  it("a correction reaches the same Current State as a gameplay change; History adds correction: true", () => {
    liveGame();
    const chef = player(holder("chef"));
    const g = game();
    const gameplay = plan(g, [changeAlignmentIntent(chef, "evil")]);
    const correction = plan(g, [correctAlignmentIntent(chef, "evil")]);
    if (!gameplay.ok || !gameplay.changed || !correction.ok || !correction.changed) throw new Error("expected plans");
    const a = applyAlignmentPlan(g, gameplay.plan);
    const c = applyAlignmentPlan(g, correction.plan);
    expect(c.players).toEqual(a.players);
    expect(correction.plan.history[0]).toEqual({ ...gameplay.plan.history[0], correction: true });
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(chef, "evil")] })).toEqual({ ok: true, changed: true });
    expect(alignmentHistory()[0]).toMatchObject({ correction: true, change: { from: { actualAlignment: "good" }, to: { actualAlignment: "evil" } } });
    expect(HistoryRecordSchema.safeParse(alignmentHistory()[0]).success).toBe(true);
  });

  it("a Traveler correction has the same Current State side effects as a gameplay change (packet, epoch, draft)", () => {
    const zed = liveGameWithTraveler();
    seed(zed, { actualAlignment: "evil", privateInfo: { travelerDemon: holder("imp"), extraText: "keep" }, publishedPacket: packet("thief", "evil"), packetEpoch: "old" });
    const g = game();
    const gameplay = plan(g, [changeAlignmentIntent(player(zed), "good")]);
    const correction = plan(g, [correctAlignmentIntent(player(zed), "good")]);
    if (!gameplay.ok || !gameplay.changed || !correction.ok || !correction.changed) throw new Error("expected plans");
    expect(correction.plan.players).toEqual(gameplay.plan.players);
  });
});

describe("10E-AC-03: unresolved origin", () => {
  it("an unresolved Traveler is assigned Good/Evil in Live Play; History uses the canonical empty from snapshot", () => {
    const zed = liveGameWithTraveler();
    expect(player(zed).actualAlignment).toBeUndefined();
    const b = baseline();
    expect(state().resolveAlignments({ intents: [changeAlignmentIntent(player(zed), "evil")] })).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(zed).actualAlignment).toBe("evil");
    const [record] = alignmentHistory();
    expect(record!.change).toEqual({ kind: "value", from: {}, to: { actualAlignment: "evil" } });
    const change = record!.change!;
    expect(Object.keys(change.kind === "value" ? change.from : { missing: true })).toEqual([]);
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
  });

  it("an unresolved ordinary participant (legacy state) may be assigned too, with the same empty origin", () => {
    liveGame();
    const chef = holder("chef");
    const { actualAlignment: _drop, ...unresolved } = player(chef);
    store.setState({ game: { ...game(), players: { ...game().players, [chef]: unresolved } } });
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(player(chef), "good")] })).toEqual({ ok: true, changed: true });
    expect(alignmentHistory()[0]!.change).toEqual({ kind: "value", from: {}, to: { actualAlignment: "good" } });
  });
});

describe("10E-AC-04 / AC-05: participant binding and expected-state stale checks", () => {
  it("an intent bound to Alice, submitted after her PlayerId is reused by Bob, is stale; Bob, History, Undo and localSeq are unchanged", () => {
    liveGame();
    const seat = holder("chef");
    const alice = player(seat);
    const intent = changeAlignmentIntent(alice, "evil");
    state().unseatPlayer(seat);
    state().addToPendingQueue("uid-bob", "Bob2");
    expect(state().assignPendingToSeat("uid-bob", seat)).toBe(true);
    const bob = player(seat);
    expect(bob.participantId).not.toBe(alice.participantId);
    const b = baseline();
    const result = state().resolveAlignments({ intents: [intent] });
    expect(result).toMatchObject({ ok: false, code: "stale", intentIndex: 0 });
    expectInert(b);
    expect(player(seat)).toBe(bob);
  });

  it("a mismatched expectedActualAlignment or expectedIsTraveler is stale and the WHOLE transaction changes nothing", () => {
    liveGame();
    const chef = player(holder("chef"));
    const imp = player(holder("imp"));
    const b = baseline();
    for (const bad of [
      { ...changeAlignmentIntent(chef, "evil"), expectedActualAlignment: "evil" },
      { ...changeAlignmentIntent(chef, "evil"), expectedActualAlignment: null },
      { ...changeAlignmentIntent(chef, "evil"), expectedIsTraveler: true },
    ]) {
      // The valid imp intent comes FIRST: nothing partially applies.
      expect(resolve([changeAlignmentIntent(imp, "good"), bad])).toMatchObject({ ok: false, code: "stale", intentIndex: 1 });
      expectInert(b);
    }
  });

  it("an intent observed before another change (rendered stale) is refused, never overwrites", () => {
    liveGame();
    const rendered = player(holder("chef"));
    expect(state().setActualAlignment(rendered.id, "evil")).toMatchObject({ ok: true, changed: true });
    const b = baseline();
    expect(state().resolveAlignments({ intents: [changeAlignmentIntent(rendered, "good")] })).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
  });

  it("an empty or nonexistent seat cannot be an Alignment target", () => {
    liveGame();
    const chef = player(holder("chef"));
    state().unseatPlayer(chef.id);
    const b = baseline();
    expect(state().resolveAlignments({ intents: [changeAlignmentIntent(chef, "evil")] })).toMatchObject({ ok: false, code: "stale" });
    expect(resolve([{ ...changeAlignmentIntent(chef, "evil"), target: { playerId: "nobody", participantId: "x" } }])).toMatchObject({ ok: false, code: "notSeated" });
    expect(resolve([{ ...changeAlignmentIntent(chef, "evil"), target: { playerId: "toString", participantId: "x" } }])).toMatchObject({ ok: false, code: "notSeated" });
    expectInert(b);
  });
});

describe("10E-AC-06 / AC-07 / AC-08: atomic multi-participant resolution, conflicts, mixing", () => {
  it("two participants change in one transaction: one Undo entry, one localSeq step, History in intent order", () => {
    liveGame();
    const chef = player(holder("chef"));
    const imp = player(holder("imp"));
    const b = baseline();
    expect(resolve([changeAlignmentIntent(chef, "evil"), changeAlignmentIntent(imp, "good")], { resolutionId: "swap-1" }))
      .toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(chef.id).actualAlignment).toBe("evil");
    expect(player(imp.id).actualAlignment).toBe("good");
    expect(alignmentHistory().map((h) => [h.participant.playerId, h.resolutionId])).toEqual([[chef.id, "swap-1"], [imp.id, "swap-1"]]);
    // Actual Roles are untouched: a Good Demon and an Evil Chef are legitimate.
    expect(player(chef.id).actualRole).toBe("chef");
    expect(player(imp.id).actualRole).toBe("imp");
  });

  it("if either intent refuses, neither applies", () => {
    liveGame();
    const chef = player(holder("chef"));
    const imp = player(holder("imp"));
    const b = baseline();
    expect(resolve([changeAlignmentIntent(chef, "evil"), { ...changeAlignmentIntent(imp, "good"), target: { playerId: imp.id, participantId: "someone-else" } }]))
      .toMatchObject({ ok: false, code: "stale", intentIndex: 1 });
    expectInert(b);
  });

  it("a second intent for one ParticipantId is a conflict -- even when the first would be a no-op", () => {
    liveGame();
    const chef = player(holder("chef"));
    const b = baseline();
    expect(resolve([changeAlignmentIntent(chef, "good"), changeAlignmentIntent(chef, "evil")])).toMatchObject({ ok: false, code: "conflict", intentIndex: 1 });
    expect(resolve([correctAlignmentIntent(chef, "evil"), correctAlignmentIntent(chef, "evil")])).toMatchObject({ ok: false, code: "conflict" });
    expectInert(b);
  });

  it("gameplay and correction intents in one transaction are mixedCorrection", () => {
    liveGame();
    const b = baseline();
    expect(resolve([changeAlignmentIntent(player(holder("chef")), "evil"), correctAlignmentIntent(player(holder("imp")), "good")]))
      .toMatchObject({ ok: false, code: "mixedCorrection" });
    expectInert(b);
  });

  it("the transaction is bounded: empty or oversized is tooMany", () => {
    liveGame();
    const chef = player(holder("chef"));
    const b = baseline();
    expect(resolve([])).toMatchObject({ ok: false, code: "tooMany" });
    expect(resolve(Array.from({ length: MAX_ALIGNMENT_INTENTS + 1 }, () => changeAlignmentIntent(chef, "evil")))).toMatchObject({ ok: false, code: "tooMany" });
    expectInert(b);
  });
});

describe("10E-AC-09: true no-op", () => {
  it("setting the current Actual Alignment writes no History, Undo, localSeq, packet epoch or anything else", () => {
    const zed = liveGameWithTraveler();
    seed(zed, { actualAlignment: "evil", packetEpoch: "e0", publishedPacket: packet("thief", "evil"), privateInfo: { travelerDemon: holder("imp") } });
    const b = baseline();
    for (const intent of [changeAlignmentIntent(player(zed), "evil"), correctAlignmentIntent(player(zed), "evil"),
      changeAlignmentIntent(player(holder("chef")), "good")]) {
      expect(state().resolveAlignments({ intents: [intent] })).toEqual({ ok: true, changed: false });
      expectInert(b);
    }
    expect(plan(game(), [changeAlignmentIntent(player(zed), "evil")])).toEqual({ ok: true, changed: false });
  });
});

describe("10E-AC-10: Role independence", () => {
  it("every Role change / correction preserves Actual Alignment (ordinary and Traveler)", () => {
    const zed = liveGameWithTraveler();
    expect(state().setTravelerAlignment(zed, "evil")).toMatchObject({ ok: true, changed: true });
    const chef = holder("chef");
    expect(state().assignRole(chef, "imp")).toMatchObject({ ok: true, changed: true });
    expect(player(chef).actualAlignment).toBe("good"); // a Good Demon: never inferred
    expect(state().correctRole(chef, "poisoner")).toMatchObject({ ok: true, changed: true });
    expect(player(chef).actualAlignment).toBe("good");
    expect(state().resolveRoles({ intents: [changeRoleIntent(player(zed), "scapegoat")] })).toMatchObject({ ok: true, changed: true });
    expect(player(zed).actualAlignment).toBe("evil");
    expect(state().resolveRoles({ intents: [correctRoleIntent(player(zed), "beggar", "restart")] })).toMatchObject({ ok: true, changed: true });
    expect(player(zed).actualAlignment).toBe("evil");
  });

  it("an Alignment transaction never changes Actual Role or ordinary-vs-Traveler status", () => {
    const zed = liveGameWithTraveler();
    const chef = holder("chef");
    const before = { chef: player(chef), zed: player(zed) };
    expect(resolve([changeAlignmentIntent(before.chef, "evil"), changeAlignmentIntent(before.zed, "good")])).toMatchObject({ ok: true, changed: true });
    for (const [id, p] of [[chef, before.chef], [zed, before.zed]] as const) {
      expect(player(id)).toMatchObject({ actualRole: p.actualRole, isTraveler: p.isTraveler, shownRole: p.shownRole,
        shownAlignment: p.shownAlignment, behaviorMode: p.behaviorMode, publicDisplayRole: p.publicDisplayRole });
    }
    expect(ALIGNMENT_PLAN_FIELDS).not.toContain("actualRole");
    expect(ALIGNMENT_PLAN_FIELDS).not.toContain("isTraveler");
  });
});

describe("10E-AC-17 / AC-18 / AC-19: Traveler private-packet safety", () => {
  for (const override of ["good", "evil", "undisclosed"] as const) {
    it(`a raw Actual change withdraws the packet and mints an epoch even when the ${override} override keeps the visible alignment unchanged`, () => {
      const zed = liveGameWithTraveler();
      seed(zed, { actualAlignment: "evil" });
      expect(state().resolveRoles({ intents: [setPerceptionIntent(player(zed), { shownRole: "thief", shownAlignment: override })] }))
        .toMatchObject({ ok: true });
      seed(zed, { publishedPacket: packet("thief", override === "undisclosed" ? undefined : override), packetEpoch: "epoch-before" });
      const visibleBefore = projectToSelf(player(zed), registry);
      expect(state().setTravelerAlignment(zed, "good")).toMatchObject({ ok: true, changed: true });
      const after = player(zed);
      expect(after.publishedPacket).toBeUndefined();
      expect(after.packetEpoch).toEqual(expect.any(String));
      expect(after.packetEpoch).not.toBe("epoch-before");
      // The player-facing label itself did not change.
      expect(projectToSelf(after, registry)!.shownAlignment).toBe(visibleBefore!.shownAlignment);
      expect(after.shownAlignment).toBe(override);
    });
  }

  it("removes privateInfo.travelerDemon but preserves unrelated draft fields; a draft holding only the Demon is cleared", () => {
    const zed = liveGameWithTraveler();
    seed(zed, { actualAlignment: "evil", privateInfo: { travelerDemon: holder("imp"), extraText: "keep me", bluffs: ["chef"] } });
    state().setTravelerAlignment(zed, "good");
    expect(player(zed).privateInfo).toEqual({ extraText: "keep me", bluffs: ["chef"] });
    seed(zed, { privateInfo: { travelerDemon: holder("imp") } });
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(player(zed), "evil")] })).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).not.toHaveProperty("privateInfo");
  });

  it("never creates travelerArrival, never resets arrival completion, never touches Information Delivery or Night progress", () => {
    const zed = liveGameWithTraveler();
    const arrival = { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1, arrivalCheckComplete: true };
    seed(zed, { actualAlignment: "evil", travelerArrival: arrival });
    const deliveries = [{ id: "d1", recipient: { kind: "legacy" as const, playerId: zed }, actualRole: "thief", informationActionId: "x", values: [] }];
    const nightProgress = { [`1:travelerArrival:${zed}:thief`]: { status: "done" as const, notes: "" } };
    store.setState({ game: { ...game(), informationDeliveries: deliveries, nightProgress } });
    for (const build of [() => changeAlignmentIntent(player(zed), "good"), () => correctAlignmentIntent(player(zed), "evil")]) {
      expect(state().resolveAlignments({ intents: [build()] })).toMatchObject({ ok: true, changed: true });
      expect(player(zed).travelerArrival).toEqual(arrival);
      expect(game().informationDeliveries).toBe(deliveries);
      expect(game().nightProgress).toBe(nightProgress);
    }
    // A legacy Traveler with no travelerArrival never gains one.
    const { travelerArrival: _gone, ...legacy } = player(zed);
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: legacy } } });
    expect(state().setTravelerAlignment(zed, "good")).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).not.toHaveProperty("travelerArrival");
  });

  it("an ordinary participant's packet and draft are not alignment-dependent and stay put", () => {
    liveGame();
    const chef = holder("chef");
    seed(chef, { publishedPacket: packet("chef", "good"), packetEpoch: "e1", privateInfo: { extraText: "x" } });
    state().setActualAlignment(chef, "evil");
    expect(player(chef)).toMatchObject({ publishedPacket: packet("chef", "good"), packetEpoch: "e1", privateInfo: { extraText: "x" } });
  });
});

describe("10E-AC-20 / AC-21 / AC-22: lifecycle", () => {
  it("before Reveal: Deal derives starting alignment; gameplay changes and corrections are allowed with no History", () => {
    setupTable();
    expect(player(holder("imp")).actualAlignment).toBe("evil"); // Setup derivation unchanged
    expect(player(holder("chef")).actualAlignment).toBe("good");
    expect(state().setActualAlignment(holder("chef"), "evil")).toMatchObject({ ok: true, changed: true });
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(player(holder("imp")), "good")] })).toMatchObject({ ok: true, changed: true });
    expect(game().history).toEqual([]);
  });

  it("after Reveal, before Night 1: gameplay change refused (except an unresolved Traveler's start); corrections allowed; no History", () => {
    revealedTable();
    const chef = player(holder("chef"));
    const b = baseline();
    expect(state().resolveAlignments({ intents: [changeAlignmentIntent(chef, "evil")] })).toMatchObject({ ok: false, code: "phase" });
    expect(state().setActualAlignment(chef.id, "evil")).toMatchObject({ ok: false, code: "phase" });
    expectInert(b);
    expect(alignmentChangeOpen(game(), chef)).toBe(false);
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(chef, "evil")] })).toMatchObject({ ok: true, changed: true });
    // A late arrival after Reveal is a Traveler with no alignment yet.
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    expect(player(zed).isTraveler).toBe(true);
    expect(alignmentChangeOpen(game(), player(zed))).toBe(true);
    expect(state().setTravelerAlignment(zed, "good")).toMatchObject({ ok: true, changed: true });
    // ... but once resolved, a further gameplay change is refused again.
    expect(state().setTravelerAlignment(zed, "evil")).toMatchObject({ ok: false, code: "phase" });
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(player(zed), "evil")] })).toMatchObject({ ok: true, changed: true });
    expect(game().history).toEqual([]);
  });

  it("Ended: every intent and both adapters refuse without mutation (even malformed input never throws)", () => {
    const zed = liveGameWithTraveler();
    expect(state().setPhase("ended").ok).toBe(true);
    const chef = player(holder("chef"));
    const b = baseline();
    for (const result of [
      state().resolveAlignments({ intents: [changeAlignmentIntent(chef, "evil")] }),
      state().resolveAlignments({ intents: [correctAlignmentIntent(chef, "evil")] }),
      state().setActualAlignment(chef.id, "evil"),
      state().setTravelerAlignment(zed, "evil"),
      resolve("nonsense"),
    ]) expect(result).toMatchObject({ ok: false, code: "phase" });
    expectInert(b);
    expect(alignmentChangeOpen(game(), chef)).toBe(false);
  });
});

describe("10E-AC-23 / AC-24 / AC-25: History, provenance and correlation", () => {
  it("records carrying correction / resolutionId have exactly the strict snapshot shapes, and the schema enforces them", () => {
    liveGame();
    resolve([correctAlignmentIntent(player(holder("chef")), "evil")], { resolutionId: "r1" });
    const record = alignmentHistory()[0]!;
    expect(record).toMatchObject({ correction: true, resolutionId: "r1" });
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
    const base = { id: "h", category: "alignment", participant: { kind: "legacy", playerId: "a" } };
    for (const meta of [{ correction: true }, { resolutionId: "r" }]) {
      for (const change of [
        { kind: "value", from: {}, to: { actualAlignment: "good" } },
        { kind: "value", from: { actualAlignment: "evil" }, to: { actualAlignment: "good" } },
      ]) expect(HistoryRecordSchema.safeParse({ ...base, ...meta, change }).success).toBe(true);
      for (const change of [
        { kind: "value", from: { actualAlignment: "good", shownAlignment: "evil" }, to: { actualAlignment: "evil" } },
        { kind: "value", from: { actualAlignment: "good" }, to: {} },
        { kind: "value", from: { actualAlignment: "good" }, to: { actualAlignment: "undisclosed" } },
        { kind: "value", from: { actualAlignment: "unresolved" }, to: { actualAlignment: "good" } },
        { kind: "value", from: { actualAlignment: "good" }, to: { actualAlignment: "evil", actualRole: "imp" } },
        { kind: "added", item: { actualAlignment: "good" } },
      ]) expect(HistoryRecordSchema.safeParse({ ...base, ...meta, change }).success).toBe(false);
    }
  });

  it("valid Mutation Context provenance is stored as a durable ParticipantRef; an unseated source or a malformed context refuses", () => {
    liveGame();
    const imp = player(holder("imp"));
    const chef = player(holder("chef"));
    expect(resolve([changeAlignmentIntent(chef, "evil")], { context: { provenance: { sourcePlayer: imp.id, sourceCharacter: "imp", reason: "ability" } } }))
      .toMatchObject({ ok: true, changed: true });
    expect(alignmentHistory()[0]!.provenance).toEqual({
      sourceParticipant: { kind: "participant", participantId: imp.participantId, playerId: imp.id, nameAtTime: imp.name },
      sourceCharacter: "imp", reason: "ability" });
    const b = baseline();
    const next = player(chef.id);
    expect(resolve([changeAlignmentIntent(next, "good")], { context: { provenance: { sourcePlayer: "nobody" } } })).toMatchObject({ ok: false, code: "notSeated" });
    expect(resolve([changeAlignmentIntent(next, "good")], { context: { provenance: { sourceParticipant: { kind: "legacy", playerId: "a" } } } })).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve([changeAlignmentIntent(next, "good")], { context: { provenance: {}, extra: 1 } })).toMatchObject({ ok: false, code: "invalid" });
    expect(resolve([changeAlignmentIntent(next, "good")], { context: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
  });

  it("a valid resolutionId is copied to every record; empty, oversized or non-string ids are refused", () => {
    liveGame();
    const chef = player(holder("chef"));
    const imp = player(holder("imp"));
    const b = baseline();
    for (const resolutionId of ["", "x".repeat(201), 5, null]) {
      expect(resolve([changeAlignmentIntent(chef, "evil")], { resolutionId })).toMatchObject({ ok: false, code: "invalid" });
    }
    expectInert(b);
    expect(resolve([changeAlignmentIntent(chef, "evil"), changeAlignmentIntent(imp, "good")], { resolutionId: "x".repeat(200) })).toMatchObject({ ok: true });
    expect(alignmentHistory().every((h) => h.resolutionId === "x".repeat(200))).toBe(true);
  });

  it("a perception-only change writes no Alignment History", () => {
    liveGame();
    const chef = holder("chef");
    expect(state().setShownAlignment(chef, "evil")).toMatchObject({ ok: true, changed: true });
    expect(state().setShownAlignment(chef, "undisclosed")).toMatchObject({ ok: true, changed: true });
    expect(alignmentHistory()).toEqual([]);
    expect(player(chef).actualAlignment).toBe("good");
  });
});

describe("10E-AC-34: Undo", () => {
  it("restores Current State, packet/draft, History and perception exactly to the pre-transaction snapshot", () => {
    const zed = liveGameWithTraveler();
    seed(zed, { actualAlignment: "evil", shownAlignment: "undisclosed", privateInfo: { travelerDemon: holder("imp"), extraText: "d" },
      publishedPacket: packet("thief"), packetEpoch: "e-before" });
    store.setState({ undoStack: [] });
    const before = structuredClone(game());
    expect(resolve([changeAlignmentIntent(player(zed), "good"), changeAlignmentIntent(player(holder("chef")), "evil")])).toMatchObject({ ok: true, changed: true });
    expect(game()).not.toEqual(before);
    state().undo();
    expect(game()).toEqual(before);
    expect(state().undoStack).toHaveLength(0);
  });
});

describe("10E-AC-37: malformed runtime input never throws or partially mutates", () => {
  it("every malformed shape is a structured refusal", () => {
    liveGame();
    const chef = player(holder("chef"));
    const good = changeAlignmentIntent(chef, "evil");
    const inheritedKind = Object.assign(Object.create({ kind: "changeActualAlignment" }), { ...good, kind: undefined });
    delete (inheritedKind as Record<string, unknown>).kind;
    const sparse: unknown[] = [];
    sparse[1] = good;
    class Klass { intents = [good]; }
    const inheritedBinding = Object.create({ playerId: chef.id, participantId: chef.participantId });
    const cases: [unknown, string][] = [
      [null, "invalid"], [[], "invalid"], ["x", "invalid"], [new Klass(), "invalid"],
      [{}, "invalid"], [{ intents: "x" }, "invalid"], [{ intents: [good], extra: 1 }, "invalid"], [{ intents: [good], extra: undefined }, "invalid"],
      [{ intents: sparse }, "invalid"], [{ intents: [inheritedKind] }, "invalid"], [{ intents: [{ ...good, kind: 5 }] }, "invalid"],
      [{ intents: [{ ...good, kind: "setPerception" }] }, "invalid"], [{ intents: [{ ...good, kind: "toString" }] }, "invalid"],
      [{ intents: [{ ...good, stray: undefined }] }, "invalid"], [{ intents: [null] }, "invalid"], [{ intents: [[good]] }, "invalid"],
      [{ intents: [{ ...good, target: { ...good.target, extra: 1 } }] }, "invalid"],
      [{ intents: [{ ...good, target: inheritedBinding }] }, "invalid"],
      [{ intents: [{ ...good, target: { playerId: chef.id } }] }, "invalid"],
      [{ intents: [{ ...good, target: { playerId: chef.id, participantId: "" } }] }, "invalid"],
      [{ intents: [{ ...good, target: "p" }] }, "invalid"],
      [{ intents: [{ kind: good.kind, target: good.target, expectedIsTraveler: false, actualAlignment: "evil" }] }, "invalid"], // expected alignment absent
      [{ intents: [{ ...good, expectedActualAlignment: "unresolved" }] }, "invalid"],
      [{ intents: [{ ...good, expectedActualAlignment: undefined }] }, "invalid"],
      [{ intents: [{ ...good, expectedIsTraveler: "false" }] }, "invalid"],
      [{ intents: [{ ...good, actualAlignment: null }] }, "invalid"], // no live clearing to unresolved
      [{ intents: [{ ...good, actualAlignment: "undisclosed" }] }, "invalid"], // perception is never Actual
      [{ intents: [{ ...good, actualAlignment: "Evil" }] }, "invalid"],
      [{ intents: [{ ...good, actualRole: "imp" }] }, "invalid"], // never bound to / changing the Role
      [{ intents: [good], resolutionId: {} }, "invalid"],
    ];
    const b = baseline();
    for (const [transaction, code] of cases) {
      let result: unknown;
      expect(() => { result = state().resolveAlignments(transaction as AlignmentTransaction); }).not.toThrow();
      expect(result, JSON.stringify(transaction)).toMatchObject({ ok: false, code });
      expectInert(b);
    }
    expect(resolve(sparse)).toMatchObject({ ok: false, code: "invalid", intentIndex: 0 });
  });

  it("refusal copy never discloses a hidden alignment value", () => {
    liveGame();
    const chef = player(holder("chef"));
    const messages = [
      resolve([{ ...changeAlignmentIntent(chef, "evil"), expectedActualAlignment: "evil" }]),
      resolve([changeAlignmentIntent(chef, "good"), changeAlignmentIntent(chef, "evil")]),
      resolve([changeAlignmentIntent(chef, "evil"), correctAlignmentIntent(chef, "good")]),
      resolve([{ ...changeAlignmentIntent(chef, "evil"), target: { playerId: chef.id, participantId: "x" } }]),
    ].map((r) => (r as { message: string }).message);
    for (const message of messages) expect(message).not.toMatch(/\b(good|evil)\b/i);
  });
});

describe("10E-AC-38: compatibility adapters route through the seam", () => {
  it("setActualAlignment binds the current occupant and observed state, commits through resolveAlignments, and returns its result", () => {
    liveGame();
    const chef = holder("chef");
    const b = baseline();
    expect(state().setActualAlignment(chef, "evil", { provenance: { reason: "adapter" } })).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(alignmentHistory()[0]).toMatchObject({ provenance: { reason: "adapter" }, change: { from: { actualAlignment: "good" }, to: { actualAlignment: "evil" } } });
    expect(state().setActualAlignment(chef, "evil")).toEqual({ ok: true, changed: false });
    expect(state().setActualAlignment("nobody", "evil")).toMatchObject({ ok: false, code: "notSeated" });
    expect(state().setActualAlignment(chef, "neutral" as never)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("setTravelerAlignment is Traveler-only and follows the same planner (packet withdrawn, completion preserved)", () => {
    const zed = liveGameWithTraveler();
    const b = baseline();
    expect(state().setTravelerAlignment(holder("chef"), "evil")).toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
    seed(zed, { travelerArrival: { demonInfoComplete: true, firstNightComplete: false }, publishedPacket: packet("thief") });
    expect(state().setTravelerAlignment(zed, "evil")).toEqual({ ok: true, changed: true });
    expect(player(zed).travelerArrival).toEqual({ demonInfoComplete: true, firstNightComplete: false });
    expect(player(zed).publishedPacket).toBeUndefined();
    expect(alignmentHistory()).toHaveLength(1);
  });
});

describe("10E-AC-33: a new participation starts unresolved", () => {
  it("every occupancy path drops a stale Actual Alignment carried by the reusable empty seat", () => {
    liveGame();
    const stale = (id: PlayerId) => seed(id, { actualAlignment: "evil" });
    // Normal seating / planned-seat fill.
    const seatA = holder("chef");
    state().unseatPlayer(seatA); stale(seatA);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true); // legacy empty-seat state stays loadable
    state().addPlayerToSeat("Newcomer");
    expect(player(seatA)).toMatchObject({ name: "Newcomer", isEmpty: false });
    expect(player(seatA)).not.toHaveProperty("actualAlignment");
    // Pending-player seating.
    const seatB = holder("imp");
    state().unseatPlayer(seatB); stale(seatB);
    state().addToPendingQueue("uid-p", "Pending");
    expect(state().assignPendingToSeat("uid-p", seatB)).toBe(true);
    expect(player(seatB)).not.toHaveProperty("actualAlignment");
    // Recovery seating.
    const seatC = holder("empath");
    state().unseatPlayer(seatC); stale(seatC);
    expect(state().restoreSeatedMember("uid-r", seatC, "Restored", "pid-restored")).toBe(true);
    expect(player(seatC)).toMatchObject({ participantId: "pid-restored" });
    expect(player(seatC)).not.toHaveProperty("actualAlignment");
  });

  it("a planned Traveler seat fill (arrival rebuild) starts unresolved too, and whole-snapshot recovery of an occupied participant is untouched", () => {
    setupTable();
    state().addTravelerSeat();
    const seat = game().seatOrder.at(-1)!;
    seed(seat, { actualAlignment: "good" });
    state().addPlayerToSeat("Visitor");
    expect(player(seat)).toMatchObject({ isTraveler: true, name: "Visitor" });
    expect(player(seat)).not.toHaveProperty("actualAlignment");
    const snapshot = structuredClone(game());
    store.getState().restoreRemoteCheckpoint(snapshot, null);
    expect(player(holder("imp")).actualAlignment).toBe("evil"); // an occupied participant is restored as-is
  });
});

describe("10E-AC-42: future-engine composition seam", () => {
  it("plans against an evolving working snapshot another domain already produced, never mutating its input", () => {
    liveGame();
    const g = game();
    const chef = player(holder("chef"));
    const frozen = structuredClone(g);
    // Life first, then Role, then Alignment, each on the previous working snapshot.
    const life = planLifeTransaction(g, { intents: [{ kind: "death", playerId: chef.id }] });
    if (!life.ok || !life.changed) throw new Error("life plan");
    const afterLife = applyLifePlan(g, life.plan);
    const role = planRoleTransaction(afterLife, { intents: [changeRoleIntent(afterLife.players[chef.id]!, "imp")] }, { script: setupScript, ids: counterIds() });
    if (!role.ok || !role.changed) throw new Error("role plan");
    const afterRole = applyRolePlan(afterLife, role.plan);
    const alignment = planAlignmentTransaction(afterRole, { intents: [changeAlignmentIntent(afterRole.players[chef.id]!, "evil")] }, { ids: counterIds() });
    if (!alignment.ok || !alignment.changed) throw new Error("alignment plan");
    const composed = applyAlignmentPlan(afterRole, alignment.plan);
    expect(composed.players[chef.id]).toMatchObject({ alive: false, actualRole: "imp", actualAlignment: "evil" });
    expect(composed.history.map((h) => h.category)).toEqual(["life", "role", "alignment"]);
    expect(g).toEqual(frozen); // nothing was mutated along the way
    // The plan is a partial-field patch, never a whole record.
    expect(Object.keys(alignment.plan.players[chef.id]!.set)).toEqual(["actualAlignment"]);
    // Ids are injected: two plans with fresh counters agree exactly.
    const again = planAlignmentTransaction(afterRole, { intents: [changeAlignmentIntent(afterRole.players[chef.id]!, "evil")] }, { ids: counterIds() });
    expect(again).toEqual(alignment);
  });

  it("intent kinds are exactly the two semantic operations", () => {
    const kinds: AlignmentIntent["kind"][] = ["changeActualAlignment", "correctActualAlignment"];
    expect(kinds).toHaveLength(2);
  });
});
