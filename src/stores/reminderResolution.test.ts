// Phase 10C: the non-authoritative Reminder seam -- the pure planner
// (reminderResolution.ts), its single store commit seam (resolveReminders),
// the compatibility adapters, ParticipantId binding / seat reuse, History and
// provenance, corrections, cleanup cues (never expiry), Undo/localSeq and the
// future cross-domain composition seam.
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import {
  MAX_REMINDER_INTENTS,
  applyReminderPlan,
  nextPhaseCleanupMoment,
  planReminderTransaction,
  reminderCleanupStatus,
  type ReminderIdSource,
  type ReminderIntent,
  type ReminderParticipantBinding,
} from "./reminderResolution";
import { applyEffectPlan, planEffectTransaction } from "./effectResolution";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { participantRefOf } from "./participants";
import type { HistoryRecord, PlayerId, ReminderRecord, StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const bind = (id: PlayerId): ReminderParticipantBinding => ({ playerId: id, participantId: player(id).participantId! });
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const reminderHistory = () => game().history.filter((h) => h.category === "reminder");
const resolve = (intents: ReminderIntent[], extra: Record<string, unknown> = {}) =>
  state().resolveReminders({ intents, ...extra } as never);

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

/** Deterministic ids for planner purity / determinism proofs. */
function counterIds(): ReminderIdSource {
  let r = 0; let h = 0;
  return { reminderId: () => `rm-${++r}`, historyId: () => `h-${++h}` };
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
const place = (name: string, reminder: Record<string, unknown>) =>
  resolve([{ kind: "place", target: bind(idOf(name)), reminder } as ReminderIntent]);

// ---------------------------------------------------------------------------
// Place / Remove / Amend
// ---------------------------------------------------------------------------

describe("Phase 10C Place: participant -> reminder -> done", () => {
  it("places one fresh instance with planner-generated createdAt; one commit, one Undo, one localSeq, one History record", () => {
    liveGame();
    const b = baseline();
    const result = place("Carol", { label: "Chosen" });
    expect(result).toMatchObject({ ok: true, changed: true });
    expectOneCommit(b, 1);
    const [reminder] = player(idOf("Carol")).reminders;
    expect(reminder).toEqual({ id: (result as { reminderIds: string[] }).reminderIds[0], label: "Chosen", createdAt: { phase: "night", day: 1 } });
    expect(reminder!.id).toMatch(/^rm-/);
    expect(reminderHistory().at(-1)).toEqual({
      id: expect.any(String), category: "reminder", participant: participantRefOf(game(), idOf("Carol")),
      moment: { phase: "night", day: 1 }, change: { kind: "added", item: reminder }, reminderOperation: "place",
    });
    expect(HistoryRecordSchema.safeParse(reminderHistory().at(-1)).success).toBe(true);
  });

  it("identical labels coexist as distinct instances -- never de-duplicated by label, source or appearance", () => {
    liveGame();
    place("Carol", { label: "Chosen" });
    place("Carol", { label: "Chosen" });
    const reminders = player(idOf("Carol")).reminders;
    expect(reminders.map((r) => r.label)).toEqual(["Chosen", "Chosen"]);
    expect(new Set(reminders.map((r) => r.id)).size).toBe(2);
  });

  it("same explicit id + identical content is a true no-op; different content is a conflict, never an upsert", () => {
    liveGame();
    expect(place("Carol", { id: "r1", label: "Chosen", note: "n" })).toMatchObject({ ok: true, changed: true });
    const stored = player(idOf("Carol")).reminders[0];
    const same = baseline();
    expect(place("Carol", { note: "n", label: "Chosen", id: "r1" })).toEqual({ ok: true, changed: false, reminderIds: [] });
    expectInert(same);
    const conflict = baseline();
    expect(place("Carol", { id: "r1", label: "Master" })).toMatchObject({ ok: false, code: "conflict", intentIndex: 0 });
    expectInert(conflict);
    expect(player(idOf("Carol")).reminders).toEqual([stored]);
  });

  it("Setup placement records {setup, 0} and no History; the fast path asks for nothing else", () => {
    setupGame();
    const b = baseline();
    place("Carol", { label: "Knows" });
    expectOneCommit(b, 0);
    expect(player(idOf("Carol")).reminders[0]).toMatchObject({ label: "Knows", createdAt: { phase: "setup", day: 0 } });
  });

  it("an ended game is frozen: Place, Amend and Remove all refuse and change nothing", () => {
    liveGame();
    place("Carol", { id: "r1", label: "Chosen" });
    store.setState({ game: { ...game(), phase: "ended" } });
    const b = baseline();
    for (const intent of [
      { kind: "place", target: bind(idOf("Carol")), reminder: { label: "Late" } },
      { kind: "amend", target: bind(idOf("Carol")), reminderId: "r1", changes: { note: "x" } },
      { kind: "remove", target: bind(idOf("Carol")), reminderId: "r1" },
    ] as ReminderIntent[]) {
      expect(resolve([intent])).toMatchObject({ ok: false, code: "phase" });
      expectInert(b);
    }
    expect(state().addReminder(idOf("Carol"), { label: "Late" })).toBeNull();
    expectInert(b);
  });
});

describe("Phase 10C Remove and Amend", () => {
  it("Remove deletes exactly one identity; an absent Remove is a true no-op", () => {
    liveGame();
    place("Carol", { id: "a", label: "Chosen" });
    place("Carol", { id: "b", label: "Chosen" });
    const b = baseline();
    expect(resolve([{ kind: "remove", target: bind(idOf("Carol")), reminderId: "a" }])).toMatchObject({ ok: true, changed: true });
    expectOneCommit(b, 1);
    expect(player(idOf("Carol")).reminders.map((r) => r.id)).toEqual(["b"]);
    expect(reminderHistory().at(-1)).toMatchObject({ reminderOperation: "remove", change: { kind: "removed", item: { id: "a" } } });
    const absent = baseline();
    expect(resolve([{ kind: "remove", target: bind(idOf("Carol")), reminderId: "a" }])).toEqual({ ok: true, changed: false, reminderIds: [] });
    expectInert(absent);
  });

  it("ordinary Amend changes only the note and the cleanup hint (value History with full snapshots)", () => {
    liveGame();
    place("Carol", { id: "r1", label: "Chosen" });
    const before = player(idOf("Carol")).reminders[0]!;
    const b = baseline();
    expect(resolve([{ kind: "amend", target: bind(idOf("Carol")), reminderId: "r1", changes: { note: "why", cleanup: { kind: "nextPhase" } } }]))
      .toMatchObject({ ok: true, changed: true });
    expectOneCommit(b, 1);
    const after = player(idOf("Carol")).reminders[0]!;
    expect(after).toEqual({ ...before, note: "why", cleanupCue: { kind: "at", moment: { phase: "day", day: 1 } } });
    expect(reminderHistory().at(-1)).toMatchObject({ reminderOperation: "amend", change: { kind: "value", from: before, to: after } });
    // Clearing both.
    resolve([{ kind: "amend", target: bind(idOf("Carol")), reminderId: "r1", changes: { note: null, cleanup: null } }]);
    expect(player(idOf("Carol")).reminders[0]).toEqual(before);
  });

  it.each([
    ["label", { label: "Master" }],
    ["id", { id: "r2" }],
    ["createdAt", { createdAt: { phase: "night", day: 1 } }],
    ["sourceCharacter", { sourceCharacter: "imp" }],
    ["source", { source: { playerId: "x", participantId: "y" } }],
    ["sourceParticipant", { sourceParticipant: { kind: "legacy", playerId: "x" } }],
  ])("ordinary Amend of %s refuses as immutable and changes nothing", (_field, changes) => {
    liveGame();
    place("Carol", { id: "r1", label: "Chosen" });
    const b = baseline();
    expect(resolve([{ kind: "amend", target: bind(idOf("Carol")), reminderId: "r1", changes } as never])).toMatchObject({ ok: false, code: "immutable" });
    expectInert(b);
  });

  it("amending an absent Reminder refuses notFound", () => {
    liveGame();
    expect(resolve([{ kind: "amend", target: bind(idOf("Carol")), reminderId: "nope", changes: { note: "x" } }])).toMatchObject({ ok: false, code: "notFound" });
  });
});

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

describe("Phase 10C corrections", () => {
  it("correctPlace records now (never backdated) with correction History", () => {
    liveGame();
    state().advancePhase();
    expect(resolve([{ kind: "correctPlace", target: bind(idOf("Carol")), reminder: { label: "Chosen" } }])).toMatchObject({ ok: true, changed: true });
    expect(player(idOf("Carol")).reminders[0]!.createdAt).toEqual({ phase: "day", day: 1 });
    expect(reminderHistory().at(-1)).toMatchObject({ reminderOperation: "place", correction: true });
    const backdated = resolve([{ kind: "correctPlace", target: bind(idOf("Carol")), reminder: { label: "X", createdAt: { phase: "night", day: 1 } } } as never]);
    expect(backdated).toMatchObject({ ok: false, code: "invalid" });
  });

  it("correctAmend repairs label, origin (a bound current participant), character, note and cleanup; never id or createdAt", () => {
    liveGame();
    place("Carol", { id: "r1", label: "Chosn" });
    expect(resolve([{ kind: "correctAmend", target: bind(idOf("Carol")), reminderId: "r1",
      amendment: { label: "Chosen", source: bind(idOf("Alice")), sourceCharacter: "fortuneteller", note: "fixed", cleanup: { kind: "nextPhase" } } }]))
      .toMatchObject({ ok: true, changed: true });
    expect(player(idOf("Carol")).reminders[0]).toEqual({
      id: "r1", label: "Chosen", sourceCharacter: "fortuneteller", sourceParticipant: participantRefOf(game(), idOf("Alice")),
      createdAt: { phase: "night", day: 1 }, cleanupCue: { kind: "at", moment: { phase: "day", day: 1 } }, note: "fixed",
    });
    expect(reminderHistory().at(-1)).toMatchObject({ reminderOperation: "amend", correction: true, change: { kind: "value" } });
    for (const amendment of [{ id: "r9" }, { createdAt: { phase: "night", day: 1 } }]) {
      expect(resolve([{ kind: "correctAmend", target: bind(idOf("Carol")), reminderId: "r1", amendment } as never])).toMatchObject({ ok: false, code: "immutable" });
    }
  });

  it("correctRemove deletes a Reminder recorded in error with correction History", () => {
    liveGame();
    place("Carol", { id: "r1", label: "Wrong" });
    resolve([{ kind: "correctRemove", target: bind(idOf("Carol")), reminderId: "r1" }]);
    expect(player(idOf("Carol")).reminders).toEqual([]);
    expect(reminderHistory().at(-1)).toMatchObject({ reminderOperation: "remove", correction: true, change: { kind: "removed" } });
  });

  it("gameplay and correction intents never mix", () => {
    liveGame();
    place("Carol", { id: "r1", label: "Chosen" });
    const b = baseline();
    expect(resolve([
      { kind: "place", target: bind(idOf("Carol")), reminder: { label: "A" } },
      { kind: "correctRemove", target: bind(idOf("Carol")), reminderId: "r1" },
    ])).toMatchObject({ ok: false, code: "mixedCorrection" });
    expectInert(b);
  });

  it("resolving a legacy unresolved cue is a correction; an ordinary amend of it refuses, a note amend still works", () => {
    liveGame();
    const carol = idOf("Carol");
    store.setState({ game: { ...game(), players: { ...game().players, [carol]: { ...player(carol),
      reminders: [{ id: "legacy", label: "Old", cleanupCue: { kind: "unresolved" } }] } } } });
    expect(reminderCleanupStatus(player(carol).reminders[0]!, game())).toBe("check");
    expect(resolve([{ kind: "amend", target: bind(carol), reminderId: "legacy", changes: { cleanup: null } }])).toMatchObject({ ok: false, code: "immutable" });
    expect(resolve([{ kind: "amend", target: bind(carol), reminderId: "legacy", changes: { note: "hm" } }])).toMatchObject({ ok: true, changed: true });
    expect(player(carol).reminders[0]).toMatchObject({ cleanupCue: { kind: "unresolved" }, note: "hm" });
    expect(resolve([{ kind: "correctAmend", target: bind(carol), reminderId: "legacy", amendment: { cleanup: null } }])).toMatchObject({ ok: true, changed: true });
    expect(player(carol).reminders[0]).toEqual({ id: "legacy", label: "Old", note: "hm" });
    expect(reminderHistory().at(-1)).toMatchObject({ correction: true, reminderOperation: "amend" });
  });
});

// ---------------------------------------------------------------------------
// Identity / seat reuse
// ---------------------------------------------------------------------------

describe("Phase 10C ParticipantId binding and seat reuse", () => {
  it("a stale binding (the seat now holds someone else) refuses and never touches the replacement", () => {
    liveGame();
    const seat = idOf("Carol");
    const stale = bind(seat);
    place("Carol", { label: "Chosen" });
    expect(state().unseatPlayer(seat)).toBe(true);
    state().addPlayerToSeat("Zed");
    expect(player(seat).name).toBe("Zed");
    expect(player(seat).reminders).toEqual([]);
    const b = baseline();
    expect(resolve([{ kind: "place", target: stale, reminder: { label: "Chosen" } }])).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
    expect(player(seat).reminders).toEqual([]);
  });

  it("an empty seat target refuses stale; bare PlayerId targets (no participantId) are invalid", () => {
    liveGame();
    const seat = idOf("Carol");
    const stale = bind(seat);
    state().unseatPlayer(seat);
    expect(resolve([{ kind: "place", target: stale, reminder: { label: "X" } }])).toMatchObject({ ok: false, code: "stale" });
    expect(resolve([{ kind: "place", target: { playerId: idOf("Alice") }, reminder: { label: "X" } } as never])).toMatchObject({ ok: false, code: "invalid" });
    expect(state().addReminder(seat, { label: "X" })).toBeNull();
  });

  it("a source ParticipantRef is durable: it never retargets when the source leaves and their PlayerId is reused", () => {
    liveGame();
    const alice = idOf("Alice");
    const aliceRef = participantRefOf(game(), alice);
    place("Carol", { id: "r1", label: "Chosen", source: bind(alice), sourceCharacter: "fortuneteller" });
    state().unseatPlayer(alice);
    state().addPlayerToSeat("Mallory");
    expect(player(alice).name).toBe("Mallory");
    expect(player(idOf("Carol")).reminders[0]!.sourceParticipant).toEqual(aliceRef);
    expect(JSON.stringify(player(idOf("Carol")).reminders)).not.toContain(player(alice).participantId!);
  });

  it("every occupancy path starts a new participation instance with reminders: [] (and effects: [])", () => {
    setupGame();
    // A crafted empty seat carrying notation (never valid persisted state).
    const crafted = (seat: PlayerId) => store.setState({ game: { ...game(), players: { ...game().players,
      [seat]: { ...player(seat), reminders: [{ id: "ghost", label: "Ghost" }] as ReminderRecord[] } } } });
    const alice = idOf("Alice");
    state().unseatPlayer(alice);
    crafted(alice);
    state().addPlayerToSeat("Newcomer");
    expect(player(alice).reminders).toEqual([]);
    expect(player(alice).effects).toEqual([]);
    // assignPendingToSeat
    const bob = idOf("Bob");
    state().unseatPlayer(bob);
    crafted(bob);
    state().addToPendingQueue("uid-1", "Pending");
    expect(state().assignPendingToSeat("uid-1", bob)).toBe(true);
    expect(player(bob).reminders).toEqual([]);
    // restoreSeatedMember
    const carol = idOf("Carol");
    state().unseatPlayer(carol);
    crafted(carol);
    expect(state().restoreSeatedMember("uid-2", carol, "Restored", "pt-restored")).toBe(true);
    expect(player(carol).reminders).toEqual([]);
    // addPlayer (a brand-new seat)
    state().addPlayer("Extra");
    expect(player(idOf("Extra")).reminders).toEqual([]);
    expect(JSON.stringify(game().players)).not.toContain("Ghost");
  });

  it("unseating discards that participant's notation with no History for the membership change itself", () => {
    liveGame();
    place("Carol", { label: "Chosen" });
    const history = game().history.length;
    state().unseatPlayer(idOf("Carol"));
    expect(Object.values(game().players).every((p) => !p.isEmpty || p.reminders.length === 0)).toBe(true);
    expect(game().history).toHaveLength(history);
  });
});

// ---------------------------------------------------------------------------
// Provenance, strict input, atomicity
// ---------------------------------------------------------------------------

describe("Phase 10C provenance: origin is never mutation provenance", () => {
  it("no Mutation Context -> no provenance, even for a sourced Reminder", () => {
    liveGame();
    place("Carol", { id: "r1", label: "Chosen", source: bind(idOf("Alice")), sourceCharacter: "fortuneteller", note: "origin note" });
    resolve([{ kind: "remove", target: bind(idOf("Carol")), reminderId: "r1" }]);
    for (const record of reminderHistory()) expect(record).not.toHaveProperty("provenance");
  });

  it("a validated Mutation Context becomes exactly that durable provenance", () => {
    liveGame();
    const context = { provenance: { sourcePlayer: idOf("Bob"), sourceCharacter: "imp", reason: "ability" } };
    resolve([{ kind: "place", target: bind(idOf("Carol")), reminder: { label: "X", source: bind(idOf("Alice")) } }], { context, resolutionId: "res-1" });
    expect(reminderHistory().at(-1)).toMatchObject({
      provenance: { sourceParticipant: participantRefOf(game(), idOf("Bob")), sourceCharacter: "imp", reason: "ability" },
      resolutionId: "res-1",
    });
  });

  it.each([
    ["an unknown provenance key", { provenance: { sourcePlayer: "x", extra: 1 } }],
    ["a smuggled durable sourceParticipant", { provenance: { sourceParticipant: { kind: "legacy", playerId: "a" } } }],
    ["a non-string reason", { provenance: { reason: 5 } }],
    ["an unknown context key", { provenance: {}, other: true }],
  ])("malformed Mutation Context (%s) refuses the whole transaction", (_label, context) => {
    liveGame();
    const b = baseline();
    expect(resolve([{ kind: "place", target: bind(idOf("Carol")), reminder: { label: "X" } }], { context })).toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
  });

  it.each([
    ["sourceParticipant", { sourceParticipant: { kind: "participant", participantId: "pt-forged", playerId: "x", nameAtTime: "F" } }],
    ["createdAt", { createdAt: { phase: "night", day: 1 } }],
    ["cleanupCue", { cleanupCue: { kind: "at", moment: { phase: "day", day: 9 } } }],
    ["lifetime", { lifetime: { kind: "manual" } }],
    ["an exact cue request", { cleanup: { kind: "at", moment: { phase: "day", day: 1 } } }],
    ["an unknown key", { semanticType: "poisoned" }],
    ["a source binding with an extra key", { source: { playerId: "a", participantId: "b", nameAtTime: "x" } }],
  ])("a smuggled %s in Place input is refused, never stripped", (_label, extra) => {
    liveGame();
    const b = baseline();
    expect(place("Carol", { label: "X", ...extra })).toMatchObject({ ok: false, code: "invalid" });
    expectInert(b);
    expect(JSON.stringify(game())).not.toContain("pt-forged");
  });

  it("multi-intent transactions are all-or-nothing: a late refusal rolls back earlier intents", () => {
    liveGame();
    const b = baseline();
    const result = resolve([
      { kind: "place", target: bind(idOf("Carol")), reminder: { label: "A" } },
      { kind: "place", target: bind(idOf("Dave")), reminder: { label: "B" } },
      { kind: "amend", target: bind(idOf("Eve")), reminderId: "missing", changes: { note: "x" } },
    ]);
    expect(result).toMatchObject({ ok: false, code: "notFound", intentIndex: 2 });
    expectInert(b);
    expect(player(idOf("Carol")).reminders).toEqual([]);
  });

  it("an accepted multi-participant transaction is one commit with History in intent order", () => {
    liveGame();
    const b = baseline();
    const result = resolve([
      { kind: "place", target: bind(idOf("Carol")), reminder: { id: "c", label: "A" } },
      { kind: "place", target: bind(idOf("Dave")), reminder: { id: "d", label: "B" } },
    ], { resolutionId: "multi" });
    expect(result).toEqual({ ok: true, changed: true, reminderIds: ["c", "d"] });
    expectOneCommit(b, 2);
    expect(reminderHistory().slice(-2).map((h) => [h.participant, h.resolutionId])).toEqual([
      [participantRefOf(game(), idOf("Carol")), "multi"], [participantRefOf(game(), idOf("Dave")), "multi"],
    ]);
  });

  it("net-zero identities leave no History and no commit (place X -> remove X)", () => {
    liveGame();
    const b = baseline();
    expect(resolve([
      { kind: "place", target: bind(idOf("Carol")), reminder: { id: "x", label: "Temp" } },
      { kind: "remove", target: bind(idOf("Carol")), reminderId: "x" },
    ])).toEqual({ ok: true, changed: false, reminderIds: [] });
    expectInert(b);
    place("Carol", { id: "y", label: "Keep" });
    const c = baseline();
    resolve([
      { kind: "amend", target: bind(idOf("Carol")), reminderId: "y", changes: { note: "a" } },
      { kind: "amend", target: bind(idOf("Carol")), reminderId: "y", changes: { note: null } },
      { kind: "place", target: bind(idOf("Dave")), reminder: { id: "z", label: "Real" } },
    ]);
    expectOneCommit(c, 1);
    expect(reminderHistory().at(-1)).toMatchObject({ reminderOperation: "place", change: { item: { id: "z" } } });
  });

  it("caps oversized and empty transactions", () => {
    liveGame();
    expect(resolve([])).toMatchObject({ ok: false, code: "tooMany" });
    const intents = Array.from({ length: MAX_REMINDER_INTENTS + 1 }, () => ({ kind: "place", target: bind(idOf("Carol")), reminder: { label: "x" } }));
    expect(resolve(intents as ReminderIntent[])).toMatchObject({ ok: false, code: "tooMany" });
  });

  it("caller-owned input is never retained: mutating it afterwards changes nothing stored", () => {
    liveGame();
    const source = bind(idOf("Alice"));
    const reminder = { id: "r1", label: "Chosen", source, note: "n" };
    resolve([{ kind: "place", target: bind(idOf("Carol")), reminder }]);
    const stored = structuredClone(player(idOf("Carol")).reminders);
    const history = structuredClone(reminderHistory());
    reminder.label = "INJECTED"; reminder.note = "INJECTED"; source.participantId = "pt-INJECTED";
    expect(player(idOf("Carol")).reminders).toEqual(stored);
    expect(reminderHistory()).toEqual(history);
  });
});

// ---------------------------------------------------------------------------
// Purity, determinism, composition
// ---------------------------------------------------------------------------

describe("Phase 10C pure planner / apply", () => {
  it("planning is pure and deterministic with injectable ids; apply returns a new snapshot and mutates nothing", () => {
    liveGame();
    const g = game();
    const frozen = structuredClone(g);
    const tx = { intents: [{ kind: "place" as const, target: bind(idOf("Carol")), reminder: { label: "Chosen", cleanup: { kind: "nextPhase" as const } } }] };
    const a = planReminderTransaction(g, tx, counterIds());
    const b = planReminderTransaction(g, tx, counterIds());
    expect(a).toEqual(b);
    expect(g).toEqual(frozen);
    if (!a.ok || !a.changed) throw new Error("expected a plan");
    expect(a.plan.placedReminderIds).toEqual(["rm-1"]);
    expect(a.plan.history[0]!.id).toBe("h-1");
    const next = applyReminderPlan(g, a.plan);
    expect(g).toEqual(frozen);
    expect(next).not.toBe(g);
    expect(next.players[idOf("Carol")]!.reminders).toEqual([{ id: "rm-1", label: "Chosen", createdAt: { phase: "night", day: 1 }, cleanupCue: { kind: "at", moment: { phase: "day", day: 1 } } }]);
    expect(StorytellerGamePersistedSchema.safeParse(next).success).toBe(true);
  });

  it("10F composition seam: Life -> Effects -> Reminders plan against each resulting snapshot and compose into one valid game", () => {
    liveGame();
    const carol = bind(idOf("Carol"));
    const alice = bind(idOf("Alice"));
    let working = game();
    const life = planLifeTransaction(working, { intents: [{ kind: "death", playerId: alice.playerId }], resolutionId: "res-10f" });
    if (!life.ok || !("plan" in life)) throw new Error("expected a Life plan");
    working = applyLifePlan(working, life.plan);
    const effects = planEffectTransaction(working, { intents: [{ kind: "apply", target: carol, effect: { type: "poisoned", lifetime: { kind: "untilDawn" } } }], resolutionId: "res-10f" });
    if (!effects.ok || !effects.changed) throw new Error("expected an Effect plan");
    working = applyEffectPlan(working, effects.plan);
    const reminders = planReminderTransaction(working, { intents: [{ kind: "place", target: carol, reminder: { label: "Chosen", source: alice } }], resolutionId: "res-10f" });
    if (!reminders.ok || !reminders.changed) throw new Error("expected a Reminder plan");
    working = applyReminderPlan(working, reminders.plan);
    expect(StorytellerGamePersistedSchema.safeParse(working).success).toBe(true);
    expect(working.players[alice.playerId]!.alive).toBe(false);
    expect(working.players[carol.playerId]!.effects.some((e) => e.type === "poisoned")).toBe(true);
    expect(working.players[carol.playerId]!.reminders[0]!.sourceParticipant).toEqual(participantRefOf(game(), alice.playerId));
    const correlated = working.history.filter((h) => h.resolutionId === "res-10f").map((h) => h.category);
    expect(correlated).toEqual(expect.arrayContaining(["effect", "reminder"]));
    // The store's own game is untouched until a future coordinator commits.
    expect(game().players[carol.playerId]!.reminders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cleanup cues: presentation only, never expiry
// ---------------------------------------------------------------------------

describe("Phase 10C cleanup cues never expire anything", () => {
  it("next-phase resolution: Setup -> Night 1, Night N -> Day N, Day N -> Night N+1", () => {
    expect(nextPhaseCleanupMoment({ phase: "setup", day: 0 })).toEqual({ phase: "night", day: 1 });
    expect(nextPhaseCleanupMoment({ phase: "night", day: 2 })).toEqual({ phase: "day", day: 2 });
    expect(nextPhaseCleanupMoment({ phase: "day", day: 2 })).toEqual({ phase: "night", day: 3 });
    expect(nextPhaseCleanupMoment({ phase: "ended", day: 2 })).toBeNull();
  });

  it("Reminder arrays are byte-for-byte unchanged across Night -> Day -> Night; only the DERIVED status changes; no rollover History", () => {
    liveGame();
    place("Carol", { id: "cue", label: "Clean me", cleanup: { kind: "nextPhase" } });
    place("Carol", { id: "plain", label: "Stay" });
    const snapshot = JSON.stringify(player(idOf("Carol")).reminders);
    const status = () => reminderCleanupStatus(player(idOf("Carol")).reminders[0]!, game());
    expect(status()).toBe("scheduled");
    const reminderRecords = reminderHistory().length;
    expect(state().advancePhase().ok).toBe(true); // Night 1 -> Day 1
    expect(JSON.stringify(player(idOf("Carol")).reminders)).toBe(snapshot);
    expect(status()).toBe("due");
    expect(state().advancePhase().ok).toBe(true); // Day 1 -> Night 2
    expect(JSON.stringify(player(idOf("Carol")).reminders)).toBe(snapshot);
    expect(status()).toBe("due");
    expect(reminderHistory()).toHaveLength(reminderRecords);
    // Undo of a phase advance only changes the derived status.
    state().undo();
    state().undo();
    expect(game()).toMatchObject({ phase: "night", day: 1 });
    expect(JSON.stringify(player(idOf("Carol")).reminders)).toBe(snapshot);
    expect(status()).toBe("scheduled");
  });

  it("a Setup cue resolves to Night 1 and becomes due when Night 1 begins -- the Reminder survives into Live Play", () => {
    setupGame();
    place("Carol", { label: "First night", cleanup: { kind: "nextPhase" } });
    expect(player(idOf("Carol")).reminders[0]!.cleanupCue).toEqual({ kind: "at", moment: { phase: "night", day: 1 } });
    expect(state().beginNightOne().ok).toBe(true);
    expect(player(idOf("Carol")).reminders[0]!.label).toBe("First night");
    expect(reminderCleanupStatus(player(idOf("Carol")).reminders[0]!, game())).toBe("due");
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("Phase 10C Undo", () => {
  it("one accepted transaction = one Undo entry restoring the whole prior Reminder snapshot", () => {
    liveGame();
    place("Carol", { id: "a", label: "A" });
    const before = structuredClone(game());
    resolve([
      { kind: "remove", target: bind(idOf("Carol")), reminderId: "a" },
      { kind: "place", target: bind(idOf("Carol")), reminder: { id: "b", label: "B" } },
    ]);
    state().undo();
    expect(game()).toEqual(before);
  });

  it("membership transitions clear Undo, so a stale snapshot can never move notation to a replacement", () => {
    liveGame();
    const seat = idOf("Carol");
    place("Carol", { label: "Chosen" });
    state().unseatPlayer(seat);
    expect(state().undoStack).toEqual([]);
    state().addPlayerToSeat("Zed");
    state().undo(); // undoes only the seating
    expect(player(seat).isEmpty).toBe(true);
    expect(player(seat).reminders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

describe("Phase 10C compatibility adapters are thin wrappers over the seam", () => {
  it("addReminder binds the current occupant and source; removeReminder removes exactly one", () => {
    liveGame();
    const id = state().addReminder(idOf("Carol"), { label: "Chosen", sourcePlayer: idOf("Alice"), cleanup: { kind: "nextPhase" } })!;
    expect(player(idOf("Carol")).reminders[0]).toMatchObject({ id, sourceParticipant: participantRefOf(game(), idOf("Alice")), cleanupCue: { kind: "at" } });
    expect(state().addReminder(idOf("Carol"), { label: "X", sourcePlayer: "nobody" })).toBeNull();
    expect(state().removeReminder(idOf("Carol"), id)).toMatchObject({ ok: true, changed: true });
    expect(player(idOf("Carol")).reminders).toEqual([]);
  });

  it("the store module never writes player.reminders outside the seat/occupancy boundary", () => {
    const source = readFileSync(resolvePath(__dirname, "storytellerStore.ts"), "utf8");
    // Only blankPlayer and occupySeat ("reminders: []" -- a blank seat and a
    // new participation instance); the seam writes through applyReminderPlan.
    expect(source.match(/reminders:\s*\[\]/g)).toEqual(["reminders: []", "reminders: []"]);
    expect(source.match(/reminders:\s/g)).toHaveLength(2);
    expect(source).not.toMatch(/\.reminders\s*=|reminders:\s*\[\.\.\./);
  });
});

// ---------------------------------------------------------------------------
// History schema: new v21 records
// ---------------------------------------------------------------------------

describe("Phase 10C v21 Reminder History contract", () => {
  const participant = { kind: "participant", participantId: "pt-a", playerId: "a", nameAtTime: "A" } as const;
  const item: ReminderRecord = { id: "r", label: "Chosen", createdAt: { phase: "night", day: 1 } };
  const record = (over: Partial<HistoryRecord> & Record<string, unknown>) =>
    HistoryRecordSchema.safeParse({ id: "h", category: "reminder", participant, change: { kind: "added", item }, reminderOperation: "place", ...over }).success;

  it("accepts each operation with its change shape, correction and resolutionId", () => {
    expect(record({})).toBe(true);
    expect(record({ reminderOperation: "remove", change: { kind: "removed", item } })).toBe(true);
    expect(record({ reminderOperation: "amend", change: { kind: "value", from: item, to: { ...item, note: "n" } }, correction: true, resolutionId: "x" })).toBe(true);
  });

  it("rejects mismatched shapes, operations on other categories, and non-v21 snapshots", () => {
    expect(record({ reminderOperation: "remove" })).toBe(false);
    expect(record({ change: { kind: "added", item: { ...item, lifetime: { kind: "manual" } } } })).toBe(false);
    expect(record({ change: { kind: "added", item: { ...item, stray: 1 } } })).toBe(false);
    expect(record({ category: "effect" })).toBe(false);
    expect(record({ reminderOperation: undefined, correction: true })).toBe(false);
    expect(record({ reminderOperation: undefined, resolutionId: "x" })).toBe(false);
    expect(HistoryRecordSchema.safeParse({ id: "h", category: "role", participant, change: { kind: "value", from: {}, to: {} }, resolutionId: "x" }).success).toBe(false);
  });

  it("legacy Reminder History (no operation, old lifetime snapshots, mirrored origin provenance) stays valid untouched", () => {
    const legacyItem = { id: "r", label: "Chosen", lifetime: { kind: "untilDawn" }, sourceParticipant: { kind: "legacy", playerId: "a" }, note: "n" };
    for (const change of [{ kind: "added", item: legacyItem }, { kind: "removed", item: legacyItem }]) {
      expect(HistoryRecordSchema.safeParse({ id: "h", category: "reminder", participant, change,
        provenance: { sourceParticipant: { kind: "legacy", playerId: "a" }, note: "n" } }).success).toBe(true);
    }
    // The Phase 9R.2 source contract still applies to legacy snapshots.
    expect(HistoryRecordSchema.safeParse({ id: "h", category: "reminder", participant,
      change: { kind: "added", item: { ...legacyItem, sourcePlayer: "a" } } }).success).toBe(false);
  });
});
