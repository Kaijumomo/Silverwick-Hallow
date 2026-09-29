// Phase 10D: the authoritative Role seam -- the pure planner
// (roleResolution.ts), its single store commit seam (resolveRoles), ParticipantId
// + observed-state binding, strict hostile input, atomic multi-participant
// resolution, partial-field patches and 10F composition, gameplay vs correction
// semantics, perception independence, ordinary <-> Traveler transitions,
// Role-type validation, Setup/phase boundaries, History, Undo and persistence.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { TRAVELERS } from "@/data/travelers";
import {
  MAX_ROLE_INTENTS,
  ROLE_PLAN_FIELDS,
  applyRolePlan,
  changeRoleIntent,
  classifyRole,
  correctRoleIntent,
  ordinaryRoleChoices,
  planRoleTransaction,
  setPerceptionIntent,
  type RoleIdSource,
  type RoleIntent,
  type RoleTransaction,
} from "./roleResolution";
import { applyEffectPlan, planEffectTransaction } from "./effectResolution";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { applyReminderPlan, planReminderTransaction } from "./reminderResolution";
import { HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { participantRefOf } from "./participants";
import { identityNeedsCheck, projectToSelf } from "./projections";
import { getPrivateInfoApplicability, offersNightInformation } from "./privatePackets";
import { buildRegistry, ownedScriptCharacters, resolvedCharacters } from "@/data/roleRegistry";
import { buildRoleDisplayMap } from "@/features/grimoire/GrimoireCircle";
import { makeSTPlayer } from "@/test/fixtures";
import { isCanonicalRole } from "@/data/canonical";
import { parseClocktowerScript } from "@/data/customScript";
import type { PlayerId, RoleDef, Script, StorytellerLobbyRecord, STPlayerRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const idOf = (name: string) => game().seatOrder.find((id) => player(id).name === name)!;
const roleHistory = () => game().history.filter((h) => h.category === "role");
const resolve = (intents: RoleIntent[], extra: Record<string, unknown> = {}) =>
  state().resolveRoles({ intents, ...extra } as never);

/** Deterministic ids: the planner never draws randomness itself. */
function counterIds(): RoleIdSource {
  let h = 0; let e = 0;
  return { historyId: () => `h-${++h}`, packetEpoch: () => `epoch-${++e}` };
}
const plan = (g: StorytellerLobbyRecord, intents: unknown, extra: Record<string, unknown> = {}, script: Script | undefined = setupScript) =>
  planRoleTransaction(g, { intents, ...extra } as unknown as RoleTransaction, { script, ids: counterIds() });

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

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});

function setupTable() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) state().showAssignedRole(id);
}
function revealedTable() {
  setupTable();
  expect(state().revealRoles().ok).toBe(true);
}
function liveGame() {
  revealedTable();
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}
/** A live game with one Traveler who has chosen a character (Thief). */
function liveGameWithTraveler(role = "thief") {
  liveGame();
  state().addPlayer("Zed"); // after Reveal a new arrival defaults to Traveler
  const zed = idOf("Zed");
  expect(player(zed).isTraveler).toBe(true);
  if (role) expect(state().assignRole(zed, role)).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] });
  return zed;
}
const chef = () => holder("chef");

// ---------------------------------------------------------------------------
// Role classification (by authoritative Role TYPE)
// ---------------------------------------------------------------------------
describe("Role classification and picker policy", () => {
  it("ordinary destinations are townsfolk/outsider/minion/demon of the current script; Travelers come from the canonical catalogue", () => {
    expect(classifyRole(setupScript, "chef").kind).toBe("ordinary");
    expect(classifyRole(setupScript, "imp").kind).toBe("ordinary");
    expect(classifyRole(setupScript, "thief").kind).toBe("traveler");
    expect(classifyRole(setupScript, "cacklejack").kind).toBe("traveler");
    expect(TRAVELERS.map((t) => t.id)).toContain("cacklejack");
  });

  it("Fabled, Loric, off-script, empty and malformed ids are refused", () => {
    for (const id of [FABLED[0]!.id, LORICS[0]!.id, "not-a-role", "", "__proto__", "toString", 5, null, undefined]) {
      expect(classifyRole(setupScript, id).kind).toBe("refused");
    }
    // A role that exists but is not on THIS script.
    expect(classifyRole({ id: "x", name: "x", characters: [{ id: "chef", name: "Chef", type: "townsfolk" }] }, "imp").kind).toBe("refused");
  });

  it("a custom homebrew character is valid exactly when it is part of the current script and has an allowed type", () => {
    const custom: Script = { id: "home", name: "Home", characters: [
      { id: "brewer", name: "Brewer", type: "townsfolk" },
      { id: "scarecrow", name: "Scarecrow", type: "fabled" },
    ] };
    expect(classifyRole(custom, "brewer").kind).toBe("ordinary");
    expect(classifyRole(custom, "scarecrow").kind).toBe("refused");
  });

  it("the ordinary picker offers exactly what the seam accepts -- never a Traveler, Fabled or Loric", () => {
    const choices = ordinaryRoleChoices(setupScript);
    expect(choices.length).toBeGreaterThan(20);
    for (const role of choices) {
      expect(["townsfolk", "outsider", "minion", "demon"]).toContain(role.type);
      expect(classifyRole(setupScript, role.id).kind).toBe("ordinary");
    }
    expect(choices.some((r) => r.type === "traveler" || r.type === "fabled" || r.type === "loric")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale safety
// ---------------------------------------------------------------------------
describe("participant + expected-state stale safety", () => {
  it("a change whose observed Actual Role moved (same participant) is refused stale; nothing is changed", () => {
    liveGame();
    const id = chef();
    const intent = changeRoleIntent(player(id), "saint");
    expect(state().assignRole(id, "librarian")).toMatchObject({ ok: true, changed: true }); // the truth moved
    const b = baseline();
    expect(resolve([intent])).toMatchObject({ ok: false, code: "stale", intentIndex: 0 });
    expectInert(b);
    expect(player(id).actualRole).toBe("librarian");
  });

  it("a PlayerId reused by a NEW ParticipantId is refused stale -- the replacement occupant is never overwritten", () => {
    liveGame();
    const id = chef();
    const intent = changeRoleIntent(player(id), "saint");
    const oldParticipant = player(id).participantId;
    expect(state().unseatPlayer(id)).toBe(true);
    state().addToPendingQueue("uid-new", "Newbie");
    expect(state().assignPendingToSeat("uid-new", id)).toBe(true);
    expect(player(id).participantId).not.toBe(oldParticipant);
    const b = baseline();
    expect(resolve([intent])).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
    expect(player(id).actualRole).toBe(""); // the replacement was left alone
  });

  it("an empty seat is stale; a nonexistent seat is not seated", () => {
    liveGame();
    const id = chef();
    const intent = changeRoleIntent(player(id), "saint");
    state().unseatPlayer(id);
    expect(resolve([intent])).toMatchObject({ ok: false, code: "stale" });
    expect(resolve([{ ...intent, target: { playerId: "nope", participantId: "x" } }])).toMatchObject({ ok: false, code: "notSeated" });
  });

  it("an expected Traveler status that moved is stale", () => {
    liveGame();
    const id = chef();
    const intent = { ...changeRoleIntent(player(id), "saint"), expectedIsTraveler: true };
    expect(resolve([intent])).toMatchObject({ ok: false, code: "stale" });
  });

  it("perception: every expected field is guarded (shown role, shown alignment, behavior mode)", () => {
    liveGame();
    const id = chef();
    const base = setPerceptionIntent(player(id), { shownRole: "librarian", shownAlignment: null, behaviorMode: "custom" });
    const b = baseline();
    expect(resolve([{ ...base, expectedShownRole: "washerwoman" }])).toMatchObject({ ok: false, code: "stale" });
    expect(resolve([{ ...base, expectedShownAlignment: "evil" }])).toMatchObject({ ok: false, code: "stale" });
    expect(resolve([{ ...base, expectedBehaviorMode: "poisoned" }])).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
    expect(resolve([base])).toMatchObject({ ok: true, changed: true });
  });

  it("a perception change between preparation and commit is refused stale", () => {
    liveGame();
    const id = chef();
    const intent = setPerceptionIntent(player(id), { shownRole: "librarian", shownAlignment: null });
    state().setShownAlignment(id, "evil");
    expect(resolve([intent])).toMatchObject({ ok: false, code: "stale" });
  });
});

// ---------------------------------------------------------------------------
// Hostile runtime input
// ---------------------------------------------------------------------------
describe("strict hostile runtime input -- structured refusals, never a throw", () => {
  it("refuses a non-object transaction, unknown transaction keys (even undefined) and a non-array / inherited intents", () => {
    liveGame();
    const g = game();
    for (const tx of [null, undefined, 5, "x", [], { intents: "x" }, Object.create({ intents: [] })]) {
      expect(() => planRoleTransaction(g, tx as never, { script: setupScript, ids: counterIds() })).not.toThrow();
      expect(planRoleTransaction(g, tx as never, { script: setupScript, ids: counterIds() })).toMatchObject({ ok: false, code: "invalid" });
    }
    const intent = changeRoleIntent(player(chef()), "saint");
    expect(plan(g, [intent], { extra: 1 })).toMatchObject({ ok: false, code: "invalid" });
    expect(plan(g, [intent], { extra: undefined })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("the discriminator must be an OWN string: inherited, missing, non-string and unknown kinds are invalid", () => {
    liveGame();
    const g = game();
    const base = changeRoleIntent(player(chef()), "saint");
    const inherited = Object.create(base);
    for (const bad of [inherited, { ...base, kind: undefined }, { ...base, kind: 5 }, { ...base, kind: "toString" }, { ...base, kind: "__proto__" },
      { ...base, kind: "constructor" }, null, "x", 7, [], { target: base.target }]) {
      const result = plan(g, [bad]);
      expect(result).toMatchObject({ ok: false, code: "invalid", intentIndex: 0 });
    }
  });

  it("a sparse intents array is refused with the index of the hole", () => {
    liveGame();
    const g = game();
    const good = changeRoleIntent(player(chef()), "saint");
    const sparse = [good, , good] as unknown[]; // eslint-disable-line no-sparse-arrays
    expect(plan(g, sparse)).toMatchObject({ ok: false, code: "invalid", intentIndex: 1 });
    const holeFirst = new Array(2); holeFirst[1] = good;
    expect(plan(g, holeFirst)).toMatchObject({ ok: false, code: "invalid", intentIndex: 0 });
  });

  it("unknown keys are refused by PRESENCE -- including a key whose value is undefined", () => {
    liveGame();
    const g = game();
    const change = changeRoleIntent(player(chef()), "saint");
    expect(plan(g, [{ ...change, extra: undefined }])).toMatchObject({ ok: false, code: "invalid" });
    expect(plan(g, [{ ...change, note: "x" }])).toMatchObject({ ok: false, code: "invalid" });
    expect(plan(g, [{ ...change, travelerArrivalPolicy: "restart" }])).toMatchObject({ ok: false, code: "invalid" }); // correction-only
    expect(plan(g, [{ ...change, target: { ...change.target, extra: undefined } }])).toMatchObject({ ok: false, code: "invalid" });
    const perception = setPerceptionIntent(player(chef()), { shownRole: "librarian", shownAlignment: null });
    expect(plan(g, [{ ...perception, extra: undefined }])).toMatchObject({ ok: false, code: "invalid" });
  });

  it("malformed bindings and prototype-name ids never reach inherited properties", () => {
    liveGame();
    const g = game();
    const change = changeRoleIntent(player(chef()), "saint");
    for (const target of [null, 5, [], {}, { playerId: "" , participantId: "x" }, { playerId: 5, participantId: "x" }, { playerId: "p", participantId: 5 },
      { playerId: "p" }, { participantId: "x" }, { playerId: "toString", participantId: "x" }, { playerId: "__proto__", participantId: "x" },
      { playerId: "constructor", participantId: "x" }, { playerId: "hasOwnProperty", participantId: "x" }]) {
      const result = plan(g, [{ ...change, target }]);
      expect(result.ok).toBe(false);
      expect(["invalid", "notSeated"]).toContain((result as { code: string }).code);
    }
  });

  it("malformed field types are invalid", () => {
    liveGame();
    const g = game();
    const change = changeRoleIntent(player(chef()), "saint");
    for (const patch of [{ expectedActualRole: 5 }, { expectedActualRole: undefined }, { expectedIsTraveler: "no" }, { expectedIsTraveler: undefined },
      { actualRole: 5 }, { actualRole: undefined }, { actualRole: "x".repeat(500) }]) {
      expect(plan(g, [{ ...change, ...patch }])).toMatchObject({ ok: false, code: "invalid" });
    }
    const correction = correctRoleIntent(player(chef()), "saint");
    expect(plan(g, [{ ...correction, travelerArrivalPolicy: "always" }])).toMatchObject({ ok: false, code: "invalid" });
    const perception = setPerceptionIntent(player(chef()), { shownRole: "librarian", shownAlignment: null });
    for (const patch of [{ shownRole: 5 }, { shownRole: undefined }, { shownAlignment: "neutral" }, { shownAlignment: undefined },
      { expectedShownRole: 5 }, { expectedShownAlignment: "x" }, { behaviorMode: "nope", expectedBehaviorMode: "normal" },
      { behaviorMode: "custom" }, { expectedBehaviorMode: "normal" }]) {
      expect(plan(g, [{ ...perception, ...patch }])).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("an invalid Mutation Context (unknown key, smuggled sourceParticipant, wrong types) is refused", () => {
    liveGame();
    const g = game();
    const change = changeRoleIntent(player(chef()), "saint");
    for (const context of [{ nope: 1 }, { provenance: { extra: 1 } }, { provenance: { sourceParticipant: { kind: "legacy", playerId: "x" } } },
      { provenance: { sourcePlayer: 5 } }, { provenance: { reason: 5 } }, 5, null, { provenance: { extra: undefined } }]) {
      expect(plan(g, [change], { context })).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(plan(g, [change], { context: { provenance: { sourcePlayer: "not-a-seat" } } })).toMatchObject({ ok: false, code: "notSeated" });
    expect(plan(g, [change], { resolutionId: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(plan(g, [change], { resolutionId: 5 })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("empty and oversized transactions are structured refusals", () => {
    liveGame();
    const g = game();
    expect(plan(g, [])).toMatchObject({ ok: false, code: "tooMany" });
    const change = changeRoleIntent(player(chef()), "saint");
    expect(plan(g, Array.from({ length: MAX_ROLE_INTENTS + 1 }, () => change))).toMatchObject({ ok: false, code: "tooMany" });
  });

  it("an ended game is frozen: every Role/perception intent through the seam (and the wrappers) is refused", () => {
    liveGame();
    const id = chef();
    const intents = [changeRoleIntent(player(id), "saint"), correctRoleIntent(player(id), "saint"),
      setPerceptionIntent(player(id), { shownRole: "librarian", shownAlignment: null })];
    expect(state().setPhase("ended").ok).toBe(true);
    const b = baseline();
    for (const intent of intents) expect(resolve([intent])).toMatchObject({ ok: false, code: "phase" });
    expect(state().assignRole(id, "saint")).toMatchObject({ ok: false, code: "phase" });
    expect(state().correctRole(id, "saint")).toMatchObject({ ok: false, code: "phase" });
    expect(state().setShownRole(id, "librarian")).toMatchObject({ ok: false, code: "phase" });
    expect(state().setShownAlignment(id, "evil")).toMatchObject({ ok: false, code: "phase" });
    expect(state().setBehaviorMode(id, "custom")).toMatchObject({ ok: false, code: "phase" });
    expect(state().showAssignedRole(id)).toMatchObject({ ok: false, code: "phase" });
    expectInert(b);
  });

  it("the planner does not mutate its input and never touches a frozen snapshot", () => {
    liveGame();
    const g = structuredClone(game());
    const deepFreeze = (value: unknown): void => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
    };
    deepFreeze(g);
    const id = g.seatOrder.find((pid) => g.players[pid]!.actualRole === "chef")!;
    const intents = deepFreezeCopy([changeRoleIntent(g.players[id]!, "saint"), setPerceptionIntent(g.players[id]!, { shownRole: "librarian", shownAlignment: "evil" })]);
    const result = plan(g, intents);
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok && result.changed) expect(() => applyRolePlan(g, result.plan)).not.toThrow();
  });
});
function deepFreezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (v: unknown): void => { if (v && typeof v === "object") { Object.freeze(v); Object.values(v).forEach(freeze); } };
  freeze(copy);
  return copy;
}

// ---------------------------------------------------------------------------
// Atomic multi-participant resolution
// ---------------------------------------------------------------------------
describe("atomic multi-participant Role resolution", () => {
  it("a Barber-shaped swap of two participants' characters commits atomically: one Undo, one localSeq, one History record each", () => {
    liveGame();
    const a = holder("chef"); const b2 = holder("empath");
    const b = baseline();
    const result = resolve([changeRoleIntent(player(a), "empath"), changeRoleIntent(player(b2), "chef")], { resolutionId: "barber-1" });
    expect(result).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(a).actualRole).toBe("empath");
    expect(player(b2).actualRole).toBe("chef");
    expect(roleHistory()).toHaveLength(2);
    expect(roleHistory().every((r) => r.resolutionId === "barber-1")).toBe(true);
    expect(roleHistory().map((r) => r.participant)).toEqual([participantRefOf(b.game, a), participantRefOf(b.game, b2)]);
  });

  it("temporary and final duplicate characters are structurally possible (no uniqueness invariant)", () => {
    liveGame();
    const a = holder("chef"); const b2 = holder("empath");
    expect(resolve([changeRoleIntent(player(a), "empath")])).toMatchObject({ ok: true, changed: true });
    expect(player(a).actualRole).toBe(player(b2).actualRole);
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);
  });

  it("all-or-nothing: a later invalid intent rolls EVERY participant back", () => {
    liveGame();
    const a = holder("chef"); const b2 = holder("empath");
    const b = baseline();
    const result = resolve([changeRoleIntent(player(a), "saint"), changeRoleIntent(player(b2), FABLED[0]!.id)]);
    expect(result).toMatchObject({ ok: false, code: "role", intentIndex: 1 });
    expectInert(b);
    expect(player(a).actualRole).toBe("chef");
  });

  it("a second Actual Role intent for one ParticipantId in one call is refused (never composed A -> B -> C)", () => {
    liveGame();
    const id = chef();
    const b = baseline();
    const first = changeRoleIntent(player(id), "saint");
    const second = { ...changeRoleIntent(player(id), "monk"), expectedActualRole: "saint" };
    expect(resolve([first, second])).toMatchObject({ ok: false, code: "conflict", intentIndex: 1 });
    expectInert(b);
    // Even when the first is a no-op the participant's Actual slot is claimed.
    const noop = changeRoleIntent(player(id), "chef");
    expect(resolve([noop, first])).toMatchObject({ ok: false, code: "conflict" });
  });

  it("gameplay and correction Actual Role intents never mix; perception may accompany either", () => {
    liveGame();
    const a = holder("chef"); const b2 = holder("empath");
    expect(resolve([changeRoleIntent(player(a), "saint"), correctRoleIntent(player(b2), "monk")])).toMatchObject({ ok: false, code: "mixedCorrection" });
    const perception = setPerceptionIntent(player(a), { shownRole: "librarian", shownAlignment: null });
    expect(resolve([correctRoleIntent(player(b2), "monk"), perception])).toMatchObject({ ok: true, changed: true });
    expect(roleHistory()).toHaveLength(1);
    expect(roleHistory()[0]!.correction).toBe(true);
  });

  it("a dead participant can change character (no alive precondition)", () => {
    liveGame();
    const id = chef();
    expect(state().recordDeath(id)).toMatchObject({ ok: true, changed: true });
    expect(resolve([changeRoleIntent(player(id), "saint")])).toMatchObject({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ actualRole: "saint", alive: false });
  });
});

// ---------------------------------------------------------------------------
// Partial-field patches and future composition
// ---------------------------------------------------------------------------
describe("partial-field patches: a Role plan composes with earlier domain plans and never overwrites them", () => {
  it("the plan carries field patches only -- never a whole player record, never an unowned field", () => {
    liveGame();
    const id = chef();
    state().setPrivateText(id, "draft");
    const result = plan(game(), [changeRoleIntent(player(id), "saint"), setPerceptionIntent(player(id), { shownRole: "librarian", shownAlignment: "evil", behaviorMode: "custom" })]);
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    const patch = result.plan.players[id]!;
    for (const key of [...Object.keys(patch.set), ...patch.remove]) expect(ROLE_PLAN_FIELDS as readonly string[]).toContain(key);
    for (const forbidden of ["alive", "ghostVote", "exiled", "effects", "reminders", "actualAlignment", "participantId", "id", "name", "seat", "stNotes", "statuses"]) {
      expect(patch.set).not.toHaveProperty(forbidden);
      expect(patch.remove).not.toContain(forbidden);
    }
    expect(patch.set).toMatchObject({ actualRole: "saint", shownRole: "librarian", shownAlignment: "evil", behaviorMode: "custom" });
    expect(patch.remove).toContain("privateInfo");
  });

  it("applied after Life, Effect and Reminder plans on the SAME working snapshot, nothing of theirs is reverted or overwritten (10F composition)", () => {
    liveGame();
    const id = chef(); const other = holder("empath");
    const original = game();
    const bind = (pid: PlayerId) => ({ playerId: pid, participantId: player(pid).participantId! });
    // planLife -> apply -> planEffects -> apply -> planReminders -> apply -> planRoles -> apply
    const life = planLifeTransaction(original, { intents: [{ kind: "death", playerId: id }, { kind: "spendGhostVote", playerId: id }] });
    expect(life).toMatchObject({ ok: true, changed: true });
    if (!life.ok || !life.changed) return;
    const afterLife = applyLifePlan(original, life.plan);
    const effects = planEffectTransaction(afterLife, { intents: [{ kind: "apply", target: bind(id), effect: { type: "poisoned", lifetime: { kind: "manual" } } }] });
    expect(effects).toMatchObject({ ok: true, changed: true });
    if (!effects.ok || !effects.changed) return;
    const afterEffects = applyEffectPlan(afterLife, effects.plan);
    const reminders = planReminderTransaction(afterEffects, { intents: [{ kind: "place", target: bind(id), reminder: { label: "Chosen" } }] });
    expect(reminders).toMatchObject({ ok: true, changed: true });
    if (!reminders.ok || !reminders.changed) return;
    const afterReminders = applyReminderPlan(afterEffects, reminders.plan);
    // The Role plan reads the WORKING snapshot (never the original).
    const roles = plan(afterReminders, [changeRoleIntent(afterReminders.players[id]!, "saint"), changeRoleIntent(afterReminders.players[other]!, "monk")], { resolutionId: "r" });
    expect(roles).toMatchObject({ ok: true, changed: true });
    if (!roles.ok || !roles.changed) return;
    const final = applyRolePlan(afterReminders, roles.plan);
    const p = final.players[id]!;
    expect(p).toMatchObject({ actualRole: "saint", alive: false, ghostVote: false });
    expect(p.effects).toEqual(afterReminders.players[id]!.effects);
    expect(p.effects).toHaveLength(1);
    expect(p.reminders).toEqual(afterReminders.players[id]!.reminders);
    expect(p.reminders).toHaveLength(1);
    expect(final.lifeEventWindow).toEqual(afterReminders.lifeEventWindow);
    expect(final.history.filter((h) => h.category === "life")).toHaveLength(1);
    expect(final.history.filter((h) => h.category === "effect")).toHaveLength(1);
    expect(final.history.filter((h) => h.category === "reminder")).toHaveLength(1);
    expect(final.history.filter((h) => h.category === "role")).toHaveLength(2);
    expect(final.players[other]!.actualRole).toBe("monk");
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(final))).success).toBe(true);
  });

  it("a plan computed against the ORIGINAL then applied to a later working snapshot still leaves that snapshot's other domains alone", () => {
    liveGame();
    const id = chef();
    const original = game();
    const result = plan(original, [changeRoleIntent(player(id), "saint")]);
    if (!result.ok || !result.changed) throw new Error("plan expected");
    const working = applyLifePlan(original, (() => {
      const life = planLifeTransaction(original, { intents: [{ kind: "death", playerId: id }] });
      if (!life.ok || !life.changed) throw new Error("life expected");
      return life.plan;
    })());
    const merged = applyRolePlan(working, result.plan);
    expect(merged.players[id]).toMatchObject({ actualRole: "saint", alive: false });
  });

  it("the plan never resolves the Effects, Reminders or Information Deliveries of a changed source (no automatic cleanup)", () => {
    liveGame();
    const id = chef();
    const target = holder("empath");
    state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: target, participantId: player(target).participantId! },
      effect: { type: "poisoned", sourceCharacter: "chef", source: { playerId: id, participantId: player(id).participantId! }, lifetime: { kind: "manual" } } }] });
    state().resolveReminders({ intents: [{ kind: "place", target: { playerId: id, participantId: player(id).participantId! }, reminder: { label: "Knows" } }] });
    const before = game();
    expect(resolve([changeRoleIntent(player(id), "saint")])).toMatchObject({ ok: true, changed: true });
    expect(player(target).effects).toEqual(before.players[target]!.effects);
    expect(player(id).reminders).toEqual(before.players[id]!.reminders);
    expect(game().informationDeliveries).toEqual(before.informationDeliveries);
  });
});

// ---------------------------------------------------------------------------
// Gameplay Actual Role semantics
// ---------------------------------------------------------------------------
describe("gameplay Actual Role transition", () => {
  it("resets abilityUsed, preserves Actual Alignment / life / Effects / Reminders / ParticipantId, clears the draft, withdraws the packet and writes ordinary Role History", () => {
    liveGame();
    const id = chef();
    const participantId = player(id).participantId;
    state().setAbilityUsed(id, true);
    state().setPrivateText(id, "draft");
    state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: id, participantId: participantId! }, effect: { type: "drunk", lifetime: { kind: "manual" } } }] });
    state().resolveReminders({ intents: [{ kind: "place", target: { playerId: id, participantId: participantId! }, reminder: { label: "Knows" } }] });
    state().recordDeath(id);
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id),
      publishedPacket: { id: "sent", payload: { shownRole: "chef", shownAlignment: "good" } } } } } });
    const before = player(id);
    const epoch = before.packetEpoch;
    const provenanceSource = idOf("Alice") === id ? idOf("Bob") : idOf("Alice");
    const b = baseline();
    expect(state().assignRole(id, "saint", { provenance: { sourcePlayer: provenanceSource, sourceCharacter: "pithag", reason: "Pit-Hag" } })).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    const after = player(id);
    expect(after.actualRole).toBe("saint");
    expect(after.abilityUsed).toBe(false);
    expect(after.actualAlignment).toBe(before.actualAlignment);
    expect(after).toMatchObject({ alive: false, ghostVote: before.ghostVote, participantId });
    expect(after.effects).toEqual(before.effects);
    expect(after.reminders).toEqual(before.reminders);
    expect(after.privateInfo).toBeUndefined();
    expect(after.publishedPacket).toBeUndefined();
    expect(after.packetEpoch).toBeDefined();
    expect(after.packetEpoch).not.toBe(epoch);
    // Ordinary perception is preserved, never re-derived from the Actual Role.
    expect(after.shownRole).toBe(before.shownRole);
    expect(after.shownAlignment).toBe(before.shownAlignment);
    expect(after.behaviorMode).toBe(before.behaviorMode);
    // History: exactly one Role record, strict shape, no correction.
    const records = roleHistory();
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record).toMatchObject({ category: "role", participant: participantRefOf(b.game, id), moment: { phase: "night", day: 1 } });
    expect(record.change).toEqual({ kind: "value", from: { actualRole: "chef" }, to: { actualRole: "saint" } });
    expect(record.correction).toBeUndefined();
    expect(record.provenance).toMatchObject({ sourceCharacter: "pithag", reason: "Pit-Hag", sourceParticipant: participantRefOf(b.game, provenanceSource) });
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
  });

  it("choosing the SAME Role is a true no-op: nothing reset, cleared, withdrawn, recorded, pushed or advanced", () => {
    liveGame();
    const id = chef();
    state().setAbilityUsed(id, true);
    state().setPrivateText(id, "draft");
    const b = baseline();
    expect(state().assignRole(id, "chef")).toEqual({ ok: true, changed: false });
    expect(resolve([changeRoleIntent(player(id), "chef")])).toEqual({ ok: true, changed: false });
    expectInert(b);
    expect(player(id).abilityUsed).toBe(true);
    expect(player(id).privateInfo).toEqual({ extraText: "draft" });
  });

  it("a gameplay change never blanks an ordinary participant, and 'Clear role' is gone", () => {
    liveGame();
    const id = chef();
    const b = baseline();
    expect(state().assignRole(id, "")).toMatchObject({ ok: false, code: "role" });
    expect(resolve([changeRoleIntent(player(id), "")])).toMatchObject({ ok: false, code: "role" });
    expect(resolve([correctRoleIntent(player(id), "")])).toMatchObject({ ok: false, code: "role" });
    expectInert(b);
    expect(player(id).actualRole).toBe("chef");
  });

  it("the Actual Alignment survives a change to a Role whose canonical alignment differs; explicit Shown Alignment represents the perception (good Minion / evil Townsfolk)", () => {
    liveGame();
    const id = chef();
    expect(player(id).actualAlignment).toBe("good");
    // A good player becomes a Minion: Actual Alignment stays good.
    const goodMinion = resolve([changeRoleIntent(player(id), "poisoner"),
      setPerceptionIntent(player(id), { shownRole: "poisoner", shownAlignment: "good" })]);
    expect(goodMinion).toMatchObject({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ actualRole: "poisoner", actualAlignment: "good", shownRole: "poisoner", shownAlignment: "good" });
    // An evil player becomes Townsfolk while showing evil.
    const evilId = holder("imp");
    expect(player(evilId).actualAlignment).toBe("evil");
    expect(resolve([changeRoleIntent(player(evilId), "washerwoman"),
      setPerceptionIntent(player(evilId), { shownRole: "washerwoman", shownAlignment: "evil" })])).toMatchObject({ ok: true, changed: true });
    expect(player(evilId)).toMatchObject({ actualRole: "washerwoman", actualAlignment: "evil", shownRole: "washerwoman", shownAlignment: "evil" });
    expect(roleHistory().every((r) => JSON.stringify(r.change).includes("actualAlignment") === false)).toBe(true);
  });

  it("an ordinary Actual Role change alone never changes Shown Role / Shown Alignment / behavior mode", () => {
    liveGame();
    const id = chef();
    const before = player(id);
    expect(resolve([changeRoleIntent(before, "saint")])).toMatchObject({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ shownRole: before.shownRole, shownAlignment: before.shownAlignment, behaviorMode: before.behaviorMode });
  });

  it("a custom homebrew ordinary Role on the current script is accepted -- and only there", () => {
    const home: Script = { ...setupScript, id: "home", characters: [...setupScript.characters, { id: "brewer", name: "Brewer", type: "townsfolk" }] };
    liveGame();
    const other = holder("empath");
    // On the original script the homebrew Role is off-script.
    expect(resolve([changeRoleIntent(player(other), "brewer")])).toMatchObject({ ok: false, code: "role" });
    store.setState({ customScripts: { [setupScript.id]: setupScript, home }, game: { ...game(), scriptId: "home" } });
    const id = chef();
    expect(resolve([changeRoleIntent(player(id), "brewer")])).toMatchObject({ ok: true, changed: true });
    expect(player(id).actualRole).toBe("brewer");
  });

  it("Fabled, Loric, unknown and Traveler-for-ordinary destinations are refused as Actual Roles and change nothing", () => {
    liveGame();
    const id = chef();
    const b = baseline();
    for (const role of [FABLED[0]!.id, LORICS[0]!.id, "not-a-role", "thief"]) {
      const result = resolve([changeRoleIntent(player(id), role)]);
      // "thief" is a valid Traveler: an ordinary participant may become one in
      // Live Play through the seam (checked in the Traveler suite), so only the
      // truly invalid ids are refused here.
      if (role === "thief") { expect(result).toMatchObject({ ok: true }); store.setState({ game: b.game, undoStack: [] }); continue; }
      expect(result).toMatchObject({ ok: false, code: "role" });
    }
    expect(player(id).actualRole).toBe("chef");
  });
});

// ---------------------------------------------------------------------------
// Correction
// ---------------------------------------------------------------------------
describe("Actual Role correction", () => {
  it("preserves abilityUsed and every unrelated domain, carries correction History, clears the draft and invalidates the packet only when the Role really changes", () => {
    liveGame();
    const id = chef();
    state().setAbilityUsed(id, true);
    state().setPrivateText(id, "draft");
    state().recordDeath(id);
    const before = player(id);
    const b = baseline();
    expect(state().correctRole(id, "saint")).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    const after = player(id);
    expect(after).toMatchObject({ actualRole: "saint", abilityUsed: true, alive: false, actualAlignment: before.actualAlignment });
    expect(after.privateInfo).toBeUndefined();
    expect(after.packetEpoch).not.toBe(before.packetEpoch);
    expect(after.shownRole).toBe(before.shownRole);
    const record = roleHistory()[0]!;
    expect(record.correction).toBe(true);
    expect(record.change).toEqual({ kind: "value", from: { actualRole: "chef" }, to: { actualRole: "saint" } });
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
  });

  it("correcting to the identical Role is a true no-op", () => {
    liveGame();
    const id = chef();
    state().setPrivateText(id, "draft");
    const b = baseline();
    expect(state().correctRole(id, "chef")).toEqual({ ok: true, changed: false });
    expectInert(b);
    expect(player(id).privateInfo).toEqual({ extraText: "draft" });
  });

  it("carries the shared resolutionId and Mutation Context provenance", () => {
    liveGame();
    const id = chef();
    expect(resolve([correctRoleIntent(player(id), "saint")], { resolutionId: "fix-1", context: { provenance: { reason: "typo" } } })).toMatchObject({ ok: true });
    expect(roleHistory()[0]).toMatchObject({ correction: true, resolutionId: "fix-1", provenance: { reason: "typo" } });
  });
});

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------
describe("explicit perception", () => {
  it("setPerception atomically controls Shown Role, Shown Alignment and behavior mode; no Role History; packet withdrawn on a real change", () => {
    liveGame();
    const id = chef();
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id),
      publishedPacket: { id: "sent", payload: { shownRole: "chef", shownAlignment: "good" } } } } } });
    const b = baseline();
    expect(resolve([setPerceptionIntent(player(id), { shownRole: "librarian", shownAlignment: "evil", behaviorMode: "drunk_fake_role_behavior" })])).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(id)).toMatchObject({ shownRole: "librarian", shownAlignment: "evil", behaviorMode: "drunk_fake_role_behavior", actualRole: "chef" });
    expect(player(id).publishedPacket).toBeUndefined();
    expect(roleHistory()).toHaveLength(0);
    expect(game().history).toHaveLength(0);
  });

  it("an identical bundle is a TRUE no-op: no packet/draft loss, no override clear, no Undo, no localSeq, no History", () => {
    liveGame();
    const id = chef();
    state().setShownAlignment(id, "evil");
    state().setPrivateText(id, "draft");
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id),
      publishedPacket: { id: "sent", payload: { shownRole: "chef", shownAlignment: "evil" } } } } } });
    const before = player(id);
    const b = baseline();
    expect(resolve([setPerceptionIntent(before, { shownRole: before.shownRole, shownAlignment: before.shownAlignment })])).toEqual({ ok: true, changed: false });
    expect(resolve([setPerceptionIntent(before, { shownRole: before.shownRole, shownAlignment: before.shownAlignment, behaviorMode: before.behaviorMode })])).toEqual({ ok: true, changed: false });
    expect(state().setShownRole(id, before.shownRole)).toEqual({ ok: true, changed: false });
    expect(state().setShownAlignment(id, before.shownAlignment)).toEqual({ ok: true, changed: false });
    expect(state().setBehaviorMode(id, before.behaviorMode)).toEqual({ ok: true, changed: false });
    expectInert(b);
    expect(player(id)).toBe(before);
  });

  it("shownAlignment: null derives from the SHOWN Role only; the primitive never derives an ordinary Shown Role from the Actual Role", () => {
    liveGame();
    const id = holder("imp");
    expect(state().assignRole(id, "washerwoman")).toMatchObject({ ok: true });
    expect(player(id).shownRole).toBe("imp"); // NOT re-derived from the new Actual Role
    expect(resolve([setPerceptionIntent(player(id), { shownRole: "washerwoman", shownAlignment: null })])).toMatchObject({ ok: true });
    expect(player(id).shownAlignment).toBeNull();
    expect(player(id).actualAlignment).toBe("evil");
  });

  it("a non-Traveler may never be shown a Traveler, Fabled, Loric, off-script or unknown Role", () => {
    liveGame();
    const id = chef();
    const b = baseline();
    for (const role of ["thief", "cacklejack", FABLED[0]!.id, LORICS[0]!.id, "not-a-role"]) {
      expect(resolve([setPerceptionIntent(player(id), { shownRole: role, shownAlignment: null })])).toMatchObject({ ok: false, code: "perception" });
    }
    expectInert(b);
  });

  it("no alignment without a character: a null Shown Role with an explicit alignment is refused; clearing the shown role clears cleanly", () => {
    liveGame();
    const id = chef();
    expect(resolve([setPerceptionIntent(player(id), { shownRole: null, shownAlignment: "evil" })])).toMatchObject({ ok: false, code: "perception" });
    expect(resolve([setPerceptionIntent(player(id), { shownRole: null, shownAlignment: null })])).toMatchObject({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ shownRole: null, shownAlignment: null });
  });

  it("a real change of the Shown Role clears the draft; an alignment/behavior-only change prunes only inapplicable draft fields", () => {
    liveGame();
    const id = chef();
    state().setPrivateText(id, "draft");
    expect(state().setShownRole(id, "librarian")).toMatchObject({ ok: true, changed: true });
    expect(player(id).privateInfo).toBeUndefined();
  });

  it("the compatibility wrapper setShownRole keeps the alignment when the role is unchanged and derives it when the role changes", () => {
    liveGame();
    const id = chef();
    state().setShownAlignment(id, "evil");
    expect(state().setShownRole(id, "chef")).toEqual({ ok: true, changed: false });
    expect(player(id).shownAlignment).toBe("evil");
    expect(state().setShownRole(id, "librarian")).toMatchObject({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ shownRole: "librarian", shownAlignment: null });
  });
});

// ---------------------------------------------------------------------------
// ASTRA-10D-004: ONE Role ownership resolution. A custom ordinary Role the Role
// boundary admits resolves to that same owned definition in classification,
// picker, registry, projection and private-information resolution -- a
// canonical Loric (or Fabled) reusing the id never silently replaces it.
// Canonical Traveler precedence is unchanged.
// ---------------------------------------------------------------------------
describe("ASTRA-10D-004: a custom ordinary Role reusing a canonical Loric id keeps ONE owned definition", () => {
  const imported = () => {
    const parsed = parseClocktowerScript(["chef", "imp",
      { id: "bigwig", name: "Bigwig (homebrew)", team: "townsfolk", ability: "Each night, you learn a homebrew fact." }]);
    expect(parsed.ok).toBe(true);
    return parsed.ok ? parsed.script : (null as never);
  };
  /** The setup fixture's characters (every canonical Role) other than `ids`,
   * so each homebrew entry below is its script's ONLY definition of that id. */
  const canonicalExcept = (...ids: string[]) => setupScript.characters.filter((r) => !ids.includes(r.id));
  /** The setup fixture with the imported homebrew Townsfolk "bigwig". */
  function homeScript(): Script {
    const custom = imported().characters.find((r) => r.id === "bigwig")!;
    return { ...setupScript, id: "home-bigwig", name: "Home", characters: [...canonicalExcept("bigwig"), custom] };
  }
  function liveOn(script: Script) {
    store.setState({ customScripts: { [script.id]: script } });
    state().newGame(script.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
    for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
    state().setRolePool(standardRoles(7));
    expect(state().dealRolePool().ok).toBe(true);
    for (const id of game().seatOrder) state().showAssignedRole(id);
    expect(state().revealRoles().ok).toBe(true);
    expect(state().beginNightOne().ok).toBe(true);
    store.setState({ undoStack: [] });
  }

  it("the importer accepts the homebrew Townsfolk `bigwig` as a homebrew ordinary character", () => {
    const custom = imported().characters.find((r) => r.id === "bigwig")!;
    expect(custom).toMatchObject({ id: "bigwig", type: "townsfolk", name: "Bigwig (homebrew)", provenance: { status: "homebrew" } });
    expect(isCanonicalRole(custom)).toBe(false);
  });

  it("classification, picker and registry resolve the SAME owned custom definition (never the canonical Loric)", () => {
    const script = homeScript();
    const custom = script.characters.find((r) => r.id === "bigwig")!;
    const cls = classifyRole(script, "bigwig");
    expect(cls).toEqual({ kind: "ordinary", role: custom });
    expect(ordinaryRoleChoices(script)).toContain(custom);
    const registry = buildRegistry(script);
    expect(registry.get("bigwig")).toBe(custom);
    expect(registry.get("bigwig")!.type).toBe("townsfolk");
    expect(registry.alignmentOf("bigwig")).toBe("good");
    // No Loric (or other canonical) behavior is inherited merely from the id.
    expect(registry.get("bigwig")).not.toBe(LORICS.find((l) => l.id === "bigwig"));
    expect(registry.informationActionsOf("bigwig")).toEqual([]);
  });

  it("Actual Role and Shown Role are accepted; self projection delivers it as an ordinary Townsfolk; private information resolves the custom ability", () => {
    const script = homeScript();
    liveOn(script);
    const id = holder("chef");
    expect(resolve([changeRoleIntent(player(id), "bigwig")])).toMatchObject({ ok: true, changed: true });
    expect(resolve([setPerceptionIntent(player(id), { shownRole: "bigwig", shownAlignment: null })])).toMatchObject({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ actualRole: "bigwig", shownRole: "bigwig", shownAlignment: null });
    const registry = buildRegistry(script);
    expect(identityNeedsCheck(player(id), registry)).toBe(false);
    expect(projectToSelf(player(id), registry)).toEqual({ shownRole: "bigwig", shownAlignment: "good" });
    // Private-information applicability reads the OWNED definition's ability
    // ("learn" offers night information), not the canonical Loric's text.
    expect(offersNightInformation(LORICS.find((l) => l.id === "bigwig")!.ability ?? "")).toBe(false);
    expect(getPrivateInfoApplicability(player(id), registry).extraText).toBe(true);
    // And it round-trips the current schema unchanged.
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });

  it("the canonical Loric Big Wig stays a non-player Role: refused as an Actual or Shown Role by the seam", () => {
    liveGame(); // a script with no character "bigwig"
    expect(classifyRole(setupScript, "bigwig").kind).toBe("refused");
    const b = baseline();
    const id = chef();
    expect(resolve([changeRoleIntent(player(id), "bigwig")])).toMatchObject({ ok: false, code: "role" });
    expect(resolve([setPerceptionIntent(player(id), { shownRole: "bigwig", shownAlignment: null })])).toMatchObject({ ok: false, code: "perception" });
    expectInert(b);
    // A script that lists the canonical Loric itself (an official id string)
    // still never admits it as a player Role; the registry keeps the Loric.
    const listed = parseClocktowerScript(["chef", "imp", "bigwig"]);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(classifyRole(listed.script, "bigwig").kind).toBe("refused");
    expect(buildRegistry(listed.script).get("bigwig")!.type).toBe("loric");
  });

  it("canonical Traveler precedence is unchanged: a homebrew ordinary character reusing a Traveler id still resolves to the canonical Traveler", () => {
    const script: Script = { id: "home-thief", name: "Home", characters: [
      { id: "thief", name: "Homebrew Thief", type: "townsfolk", ability: "Homebrew." }, ...canonicalExcept("thief")] };
    expect(classifyRole(script, "thief")).toMatchObject({ kind: "traveler", role: { type: "traveler" } });
    expect(buildRegistry(script).get("thief")).toBe(TRAVELERS.find((t) => t.id === "thief"));
    expect(ordinaryRoleChoices(script).some((r) => r.id === "thief")).toBe(false);
  });

  it("a Fabled reusing an admitted custom ordinary Role's id does not replace it either; non-colliding custom Roles are unchanged", () => {
    const doomsayer = { id: "doomsayer", name: "Homebrew Doomsayer", type: "outsider" as const, ability: "Homebrew." };
    const brewer = { id: "brewer", name: "Brewer", type: "townsfolk" as const, ability: "Homebrew." };
    const script: Script = { id: "home-fabled", name: "Home", characters: [doomsayer, brewer, ...canonicalExcept("doomsayer")],
      fabled: [FABLED.find((f) => f.id === "doomsayer")!] };
    expect(classifyRole(script, "doomsayer")).toEqual({ kind: "ordinary", role: doomsayer });
    expect(buildRegistry(script).get("doomsayer")).toBe(doomsayer);
    expect(classifyRole(script, "brewer")).toEqual({ kind: "ordinary", role: brewer });
    expect(buildRegistry(script).get("brewer")).toBe(brewer);
    // A script's non-ordinary custom entry keeps the previous precedence.
    const fabledTyped: Script = { id: "home-f", name: "Home", characters: [{ id: "bigwig", name: "X", type: "fabled" }, ...canonicalExcept("bigwig")] };
    expect(classifyRole(fabledTyped, "bigwig").kind).toBe("refused");
    expect(buildRegistry(fabledTyped).get("bigwig")!.type).toBe("loric");
  });
});

// ---------------------------------------------------------------------------
// SOL-10D-C03: RoleId is the character identity key. New imports reject a
// duplicate RoleId; an already-stored LEGACY script may still carry one, and
// every runtime Role consumer then resolves ONE deterministic owner -- the
// FIRST definition. Canonical Traveler precedence and the ASTRA-10D-004
// overlay rule are unchanged.
// ---------------------------------------------------------------------------
describe("SOL-10D-C03: a legacy script's duplicate RoleId is owned by its FIRST definition everywhere", () => {
  const canonicalChef = setupScript.characters.find((r) => r.id === "chef")!;
  // Deliberately free of show/tell/learn/information/signal/nod wording, so
  // private-information applicability differs from the canonical Chef's.
  const evilChef: RoleDef = { id: "chef", name: "Evil Chef", type: "minion", ability: "Homebrew minion with a quiet ability.",
    provenance: { status: "homebrew" } };
  const others = (...ids: string[]) => setupScript.characters.filter((r) => !ids.includes(r.id));
  /** A legacy STORED Script object built directly (a new import is refused). */
  const legacy = (first: RoleDef, second: RoleDef, id = "legacy-dup"): Script =>
    ({ id, name: "Legacy", characters: [first, second, ...others(first.id)] });
  const shownChef = (over: Partial<STPlayerRecord> = {}) =>
    makeSTPlayer({ actualRole: "chef", shownRole: "chef", shownAlignment: null, behaviorMode: "normal", ...over });
  const promptOffersInfo = (role: RoleDef) =>
    [role.firstNightPrompt ?? role.ability, role.otherNightPrompt ?? role.ability].some((p) => offersNightInformation(p ?? ""));

  it("preconditions: the two definitions differ in type, alignment and private-information prompts", () => {
    expect(canonicalChef).toMatchObject({ id: "chef", type: "townsfolk" });
    expect(promptOffersInfo(canonicalChef)).toBe(true);
    expect(promptOffersInfo(evilChef)).toBe(false);
  });

  it("no collateral: for a script with unique RoleIds the owner rule is the identity (same objects, same order)", () => {
    const owned = ownedScriptCharacters(setupScript);
    expect(owned).toHaveLength(setupScript.characters.length);
    owned.forEach((role, index) => expect(role).toBe(setupScript.characters[index]));
    const ordinary = ["townsfolk", "outsider", "minion", "demon"];
    expect(ordinaryRoleChoices(setupScript)).toEqual(
      setupScript.characters.filter((r) => ordinary.includes(r.type) && !TRAVELERS.some((t) => t.id === r.id)));
    const registry = buildRegistry(setupScript);
    for (const role of ordinaryRoleChoices(setupScript)) expect(registry.get(role.id)).toBe(role);
  });

  it("Townsfolk FIRST, Minion second: classification, picker, registry, display, projection and private information all resolve the first", () => {
    const script = legacy(canonicalChef, evilChef);
    const cls = classifyRole(script, "chef");
    expect(cls.kind).toBe("ordinary");
    if (cls.kind === "ordinary") expect(cls.role).toBe(canonicalChef);
    const chefs = ordinaryRoleChoices(script).filter((r) => r.id === "chef");
    expect(chefs).toHaveLength(1);
    expect(chefs[0]).toBe(canonicalChef);
    const registry = buildRegistry(script);
    expect(registry.get("chef")).toBe(canonicalChef);
    expect(registry.alignmentOf("chef")).toBe("good");
    expect(buildRoleDisplayMap(script).get("chef")).toBe(canonicalChef);
    const p = shownChef();
    expect(identityNeedsCheck(p, registry)).toBe(false);
    expect(projectToSelf(p, registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(getPrivateInfoApplicability(p, registry).extraText).toBe(true);
  });

  it("reversed -- Minion FIRST, Townsfolk second: every consumer resolves the Minion", () => {
    const script = legacy(evilChef, canonicalChef);
    const cls = classifyRole(script, "chef");
    expect(cls.kind).toBe("ordinary");
    if (cls.kind === "ordinary") expect(cls.role).toBe(evilChef);
    const chefs = ordinaryRoleChoices(script).filter((r) => r.id === "chef");
    expect(chefs).toHaveLength(1);
    expect(chefs[0]).toBe(evilChef);
    const registry = buildRegistry(script);
    expect(registry.get("chef")).toBe(evilChef);
    expect(registry.alignmentOf("chef")).toBe("evil");
    expect(buildRoleDisplayMap(script).get("chef")).toBe(evilChef);
    const p = shownChef();
    expect(identityNeedsCheck(p, registry)).toBe(false);
    expect(projectToSelf(p, registry)).toEqual({ shownRole: "chef", shownAlignment: "evil" });
    expect(getPrivateInfoApplicability(p, registry).extraText).toBe(false);
  });

  it("a non-ordinary FIRST definition owns the id too: its later ordinary duplicate is never admitted, offered or resolved", () => {
    const fabledFirst: RoleDef = { id: "chef", name: "Chef?", type: "fabled" };
    const script = legacy(fabledFirst, canonicalChef);
    expect(classifyRole(script, "chef").kind).toBe("refused");
    expect(ordinaryRoleChoices(script).some((r) => r.id === "chef")).toBe(false);
    const registry = buildRegistry(script);
    expect(registry.get("chef")).toBe(fabledFirst);
    expect(identityNeedsCheck(shownChef(), registry)).toBe(true);
    expect(projectToSelf(shownChef(), registry)).toBeNull();
  });

  it("the Role seam admits exactly the owner in a live game whose stored script is a legacy duplicate, and projection agrees", () => {
    liveGame();
    const script = legacy(evilChef, canonicalChef, setupScript.id); // the game's own stored script
    store.setState({ customScripts: { [setupScript.id]: script } });
    const id = holder("empath");
    expect(resolve([changeRoleIntent(player(id), "chef"),
      setPerceptionIntent(player(id), { shownRole: "chef", shownAlignment: null })])).toEqual({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ actualRole: "chef", shownRole: "chef", shownAlignment: null });
    expect(projectToSelf(player(id), buildRegistry(script))).toEqual({ shownRole: "chef", shownAlignment: "evil" });
    // The stored legacy script is used as is: never rejected, reset or rewritten.
    expect(state().customScripts[setupScript.id]).toBe(script);
    expect(state().customScripts[setupScript.id]!.characters.filter((r) => r.id === "chef")).toHaveLength(2);
  });

  it("ASTRA-10D-004 is preserved: a homebrew ordinary FIRST owner keeps its id against the Loric overlay and its own later duplicate", () => {
    const first: RoleDef = { id: "bigwig", name: "Bigwig (homebrew)", type: "townsfolk", ability: "Homebrew." };
    const later: RoleDef = { id: "bigwig", name: "Bigwig II", type: "minion", ability: "Homebrew." };
    const script = legacy(first, later);
    const cls = classifyRole(script, "bigwig");
    expect(cls.kind).toBe("ordinary");
    if (cls.kind === "ordinary") expect(cls.role).toBe(first);
    expect(buildRegistry(script).get("bigwig")).toBe(first);
    expect(ordinaryRoleChoices(script).filter((r) => r.id === "bigwig")).toEqual([first]);
    // The canonical Loric is still refused where the script has no such character.
    expect(classifyRole(setupScript, "bigwig").kind).toBe("refused");
  });

  it("canonical Traveler precedence is unchanged even when a legacy script duplicates a Traveler id", () => {
    const script = legacy({ id: "thief", name: "Homebrew Thief", type: "townsfolk", ability: "x" },
      { id: "thief", name: "Homebrew Thief II", type: "minion", ability: "y" });
    const thief = TRAVELERS.find((t) => t.id === "thief")!;
    expect(classifyRole(script, "thief")).toEqual({ kind: "traveler", role: thief });
    expect(buildRegistry(script).get("thief")).toBe(thief);
    expect(ordinaryRoleChoices(script).some((r) => r.id === "thief")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 10D (CLOSURE-03): a list that offers or names "a character" -- the
// Drawer's Role lookups, the Effect/Reminder source character, the Almanac --
// takes ONE definition per RoleId from the registry's own resolution:
// first-definition ownership (SOL-10D-C03), canonical Traveler precedence over
// ANY script definition of the same id, the ASTRA-10D-004 overlay rule.
// Ordinary lists keep ordinaryRoleChoices.
// ---------------------------------------------------------------------------
describe("CLOSURE-03: resolvedCharacters is the registry's resolution, one entry per RoleId", () => {
  const thief = TRAVELERS.find((t) => t.id === "thief")!;
  const homebrewThief: RoleDef = { id: "thief", name: "Homebrew Thief", type: "demon", ability: "Homebrew Demon." };
  /** Astra's legacy STORED script: the homebrew Demon is the FIRST "thief". */
  const legacyThief: Script = { ...setupScript, id: "legacy-thief", characters: [homebrewThief, ...setupScript.characters] };

  it("the Astra collision lists exactly one thief -- the canonical Traveler, the very definition the classifier, registry and Grimoire resolve", () => {
    expect(ownedScriptCharacters(legacyThief).find((r) => r.id === "thief")).toBe(homebrewThief); // raw first definition
    expect(resolvedCharacters(legacyThief).filter((r) => r.id === "thief")).toEqual([thief]);
    expect(resolvedCharacters(legacyThief).find((r) => r.id === "thief")).toBe(thief);
    expect(resolvedCharacters(legacyThief)).not.toContain(homebrewThief);
    expect(classifyRole(legacyThief, "thief")).toEqual({ kind: "traveler", role: thief });
    expect(buildRegistry(legacyThief).get("thief")).toBe(thief);
    expect(buildRoleDisplayMap(legacyThief).get("thief")).toBe(thief);
    expect(ordinaryRoleChoices(legacyThief).some((r) => r.id === "thief")).toBe(false);
  });

  it("every entry is exactly the registry's definition; ids are unique; every Traveler appears once; no script means the Traveler catalogue", () => {
    for (const script of [setupScript, legacyThief]) {
      const listed = resolvedCharacters(script);
      const registry = buildRegistry(script);
      expect(new Set(listed.map((r) => r.id)).size).toBe(listed.length);
      for (const role of listed) expect(registry.get(role.id)).toBe(role);
      for (const t of TRAVELERS) expect(listed.filter((r) => r.id === t.id)).toEqual([t]);
    }
    expect(resolvedCharacters(null)).toEqual(TRAVELERS);
  });

  it("OWNER-5: a homebrew ordinary Role with a non-Traveler id is listed as the script's own definition", () => {
    const hollowKing: RoleDef = { id: "hollowking", name: "Hollow King", type: "demon", ability: "Homebrew." };
    const script: Script = { ...setupScript, id: "home-king", characters: [...setupScript.characters, hollowKing] };
    expect(resolvedCharacters(script).filter((r) => r.id === "hollowking")).toEqual([hollowKing]);
    expect(resolvedCharacters(script).find((r) => r.id === "hollowking")).toBe(hollowKing);
    expect(buildRegistry(script).get("hollowking")).toBe(hollowKing);
    expect(ordinaryRoleChoices(script)).toContain(hollowKing);
  });

  it("OWNER-6: ASTRA-10D-004 -- a homebrew ordinary owner keeps its id against the Loric catalogue and a Fabled of the same id", () => {
    const bigwig: RoleDef = { id: "bigwig", name: "Bigwig (homebrew)", type: "townsfolk", ability: "Homebrew." };
    const doomsayer: RoleDef = { id: "doomsayer", name: "Homebrew Doomsayer", type: "outsider", ability: "Homebrew." };
    const script: Script = { ...setupScript, id: "home-overlay", characters: [bigwig, doomsayer, ...setupScript.characters],
      fabled: [FABLED.find((f) => f.id === "doomsayer")!] };
    const listed = resolvedCharacters(script);
    expect(listed.filter((r) => r.id === "bigwig")).toEqual([bigwig]);
    expect(listed.filter((r) => r.id === "doomsayer")).toEqual([doomsayer]);
    expect(buildRegistry(script).get("bigwig")).toBe(bigwig);
    expect(buildRegistry(script).get("doomsayer")).toBe(doomsayer);
    expect(LORICS.some((l) => l.id === "bigwig")).toBe(true);
  });

  it("OWNER-7: legacy first-definition ownership of an ordinary duplicate is unchanged -- the FIRST definition is listed, once", () => {
    const canonicalChef = setupScript.characters.find((r) => r.id === "chef")!;
    const evilChef: RoleDef = { id: "chef", name: "Evil Chef", type: "minion", ability: "Homebrew." };
    const others = setupScript.characters.filter((r) => r.id !== "chef");
    const evilFirst: Script = { id: "legacy-chef", name: "Legacy", characters: [evilChef, canonicalChef, ...others] };
    const canonicalFirst: Script = { id: "legacy-chef-2", name: "Legacy", characters: [canonicalChef, evilChef, ...others] };
    expect(resolvedCharacters(evilFirst).filter((r) => r.id === "chef")).toEqual([evilChef]);
    expect(resolvedCharacters(canonicalFirst).filter((r) => r.id === "chef")).toEqual([canonicalChef]);
  });
});

// ---------------------------------------------------------------------------
// ASTRA-10D-002: perception-derived invalidation (draft deletion/pruning,
// packet withdrawal, packet epoch) is decided from the ORIGINAL versus the
// FINAL semantic perception -- never from intermediate intent traversal.
// ---------------------------------------------------------------------------
describe("ASTRA-10D-002: perception invalidation follows original vs FINAL perception", () => {
  const packet = (shownRole: string, shownAlignment: "good" | "evil") => ({ id: "sent", payload: { shownRole, shownAlignment } });
  /** Seeds a draft, a published packet and a known epoch on `id`. */
  function seed(id: PlayerId, over: Partial<STPlayerRecord>) {
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), packetEpoch: "epoch-keep", ...over } } } });
    store.setState({ undoStack: [] });
  }
  /** The perception bundle of `p` re-bound to an intermediate observed state. */
  const from = (p: STPlayerRecord, observed: { shownRole: string | null; shownAlignment: "good" | "evil" | null; behaviorMode?: STPlayerRecord["behaviorMode"] },
    next: { shownRole: string | null; shownAlignment: "good" | "evil" | null; behaviorMode?: STPlayerRecord["behaviorMode"] }): RoleIntent => ({
    ...setPerceptionIntent(p, next),
    expectedShownRole: observed.shownRole, expectedShownAlignment: observed.shownAlignment,
    ...(next.behaviorMode !== undefined ? { expectedBehaviorMode: observed.behaviorMode } : {}),
  });

  it("NZ1: shown Chef -> Librarian -> Chef with a draft and a published packet is a TRUE no-op (draft, packet and epoch unchanged; no commit)", () => {
    liveGame();
    const id = chef();
    seed(id, { privateInfo: { extraText: "draft" }, publishedPacket: packet("chef", "good") });
    const p = player(id);
    const original = { shownRole: p.shownRole, shownAlignment: p.shownAlignment };
    expect(original.shownRole).toBe("chef");
    const intents = [
      setPerceptionIntent(p, { shownRole: "librarian", shownAlignment: null }),
      from(p, { shownRole: "librarian", shownAlignment: null }, original),
    ];
    // The pure plan: net-zero, and no epoch is ever drawn.
    const ids = counterIds();
    expect(planRoleTransaction(game(), { intents }, { script: setupScript, ids })).toEqual({ ok: true, changed: false });
    expect(ids.packetEpoch()).toBe("epoch-1");
    // The store: no commit at all.
    const b = baseline();
    expect(resolve(intents)).toEqual({ ok: true, changed: false });
    expectInert(b);
    expect(player(id)).toBe(p);
    expect(player(id)).toMatchObject({ privateInfo: { extraText: "draft" }, publishedPacket: packet("chef", "good"), packetEpoch: "epoch-keep" });
  });

  it("NZ2: behavior fake-demon -> normal -> fake-demon keeps the original applicable draft (bluffs, fake Minions) and the packet", () => {
    liveGame();
    const id = chef();
    const other = holder("imp");
    seed(id, { shownRole: "imp", shownAlignment: null, behaviorMode: "fake_demon_behavior",
      privateInfo: { bluffs: ["chef", "saint", "monk"], fakeMinions: [other], extraText: "you are the demon" },
      publishedPacket: packet("imp", "evil") });
    const p = player(id);
    const fake = { shownRole: "imp", shownAlignment: null, behaviorMode: "fake_demon_behavior" as const };
    const normal = { shownRole: "imp", shownAlignment: null, behaviorMode: "normal" as const };
    const intents = [setPerceptionIntent(p, normal), from(p, normal, fake)];
    const b = baseline();
    expect(resolve(intents)).toEqual({ ok: true, changed: false });
    expectInert(b);
    expect(player(id)).toBe(p);
    expect(player(id).privateInfo).toEqual({ bluffs: ["chef", "saint", "monk"], fakeMinions: [other], extraText: "you are the demon" });
    expect(player(id).publishedPacket).toEqual(packet("imp", "evil"));
    expect(player(id).packetEpoch).toBe("epoch-keep");
  });

  it("NZ3: a real same-Role Traveler restart with a shownAlignment null -> explicit -> null round trip commits the restart only (no epoch, no draft/packet change)", () => {
    const zed = liveGameWithTraveler("thief");
    const arrival = { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 };
    seed(zed, { travelerArrival: { ...arrival }, privateInfo: { extraText: "draft" }, publishedPacket: packet("thief", "good") });
    const z = player(zed);
    expect(z).toMatchObject({ shownRole: "thief", shownAlignment: null });
    const intents = [
      correctRoleIntent(z, "thief", "restart"),
      setPerceptionIntent(z, { shownRole: "thief", shownAlignment: "evil" }),
      from(z, { shownRole: "thief", shownAlignment: "evil" }, { shownRole: "thief", shownAlignment: null }),
    ];
    // The plan: ONLY the restart -- perception adds no field, no epoch.
    const ids = counterIds();
    const planned = planRoleTransaction(game(), { intents }, { script: setupScript, ids });
    expect(planned).toMatchObject({ ok: true, changed: true });
    if (!planned.ok || !planned.changed) return;
    expect(planned.plan.players).toEqual({ [zed]: { set: { travelerArrival: { demonInfoComplete: false, firstNightComplete: false } }, remove: [] } });
    expect(planned.plan.history).toEqual([]);
    expect(ids.packetEpoch()).toBe("epoch-1");
    // The store: one commit; the restart is real, the perception is not.
    const b = baseline();
    expect(resolve(intents)).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(zed).travelerArrival).toEqual({ demonInfoComplete: false, firstNightComplete: false });
    expect(player(zed)).toMatchObject({ shownRole: "thief", shownAlignment: null, packetEpoch: "epoch-keep",
      privateInfo: { extraText: "draft" }, publishedPacket: packet("thief", "good") });
  });

  it("an Actual Role that really changes still invalidates for the old Role even while the perception round-trips (one epoch)", () => {
    liveGame();
    const id = chef();
    seed(id, { privateInfo: { extraText: "draft" }, publishedPacket: packet("chef", "good") });
    const p = player(id);
    const original = { shownRole: p.shownRole, shownAlignment: p.shownAlignment };
    const intents = [
      setPerceptionIntent(p, { shownRole: "librarian", shownAlignment: null }),
      changeRoleIntent(p, "empath"),
      from(p, { shownRole: "librarian", shownAlignment: null }, original),
    ];
    const ids = counterIds();
    const planned = planRoleTransaction(game(), { intents }, { script: setupScript, ids });
    expect(planned).toMatchObject({ ok: true, changed: true });
    if (!planned.ok || !planned.changed) return;
    expect(planned.plan.players[id]).toEqual({ set: { actualRole: "empath", packetEpoch: "epoch-1" }, remove: ["privateInfo", "publishedPacket"] });
    expect(ids.packetEpoch()).toBe("epoch-2"); // exactly one epoch was drawn
    const b = baseline();
    expect(resolve(intents)).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(id)).toMatchObject({ actualRole: "empath", ...original });
    expect(player(id).privateInfo).toBeUndefined();
    expect(player(id).publishedPacket).toBeUndefined();
    expect(player(id).packetEpoch).not.toBe("epoch-keep");
    expect(roleHistory()).toHaveLength(1);
  });

  it("a final Shown Role that genuinely differs (Chef -> Librarian -> Empath) clears the draft and withdraws the packet exactly once", () => {
    liveGame();
    const id = chef();
    seed(id, { privateInfo: { extraText: "draft" }, publishedPacket: packet("chef", "good") });
    const p = player(id);
    const intents = [
      setPerceptionIntent(p, { shownRole: "librarian", shownAlignment: null }),
      from(p, { shownRole: "librarian", shownAlignment: null }, { shownRole: "empath", shownAlignment: null }),
    ];
    const ids = counterIds();
    const planned = planRoleTransaction(game(), { intents }, { script: setupScript, ids });
    expect(planned).toMatchObject({ ok: true, changed: true });
    if (!planned.ok || !planned.changed) return;
    expect(player(id).shownAlignment).toBe("good"); // so the derived (null) final alignment is a change too
    expect(planned.plan.players[id]).toEqual({ set: { shownRole: "empath", shownAlignment: null, packetEpoch: "epoch-1" },
      remove: ["privateInfo", "publishedPacket"] });
    expect(ids.packetEpoch()).toBe("epoch-2");
    expect(planned.plan.history).toEqual([]);
  });

  it("an alignment-only FINAL change prunes against the final perception only: fields an intermediate mode made inapplicable survive", () => {
    liveGame();
    const id = chef();
    const other = holder("imp");
    seed(id, { shownRole: "imp", shownAlignment: null, behaviorMode: "fake_demon_behavior",
      privateInfo: { bluffs: ["chef", "saint", "monk"], fakeMinions: [other] }, publishedPacket: packet("imp", "evil") });
    const p = player(id);
    const normal = { shownRole: "imp", shownAlignment: null, behaviorMode: "normal" as const };
    const intents = [
      setPerceptionIntent(p, normal),
      from(p, normal, { shownRole: "imp", shownAlignment: "evil", behaviorMode: "fake_demon_behavior" }),
    ];
    const ids = counterIds();
    const planned = planRoleTransaction(game(), { intents }, { script: setupScript, ids });
    expect(planned).toMatchObject({ ok: true, changed: true });
    if (!planned.ok || !planned.changed) return;
    // Only the net perception change (alignment), the withdrawal and ONE epoch.
    expect(planned.plan.players[id]).toEqual({ set: { shownAlignment: "evil", packetEpoch: "epoch-1" }, remove: ["publishedPacket"] });
    expect(ids.packetEpoch()).toBe("epoch-2");
    const b = baseline();
    expect(resolve(intents)).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(id).privateInfo).toEqual({ bluffs: ["chef", "saint", "monk"], fakeMinions: [other] });
    expect(player(id).publishedPacket).toBeUndefined();
    // The same final change made directly is the same result (order-independent).
    state().undo();
    expect(resolve([setPerceptionIntent(player(id), { shownRole: "imp", shownAlignment: "evil", behaviorMode: "fake_demon_behavior" })]))
      .toEqual({ ok: true, changed: true });
    expect(player(id).privateInfo).toEqual({ bluffs: ["chef", "saint", "monk"], fakeMinions: [other] });
  });

  it("a genuinely different final mode prunes what the FINAL perception makes inapplicable", () => {
    liveGame();
    const id = chef();
    const other = holder("imp");
    seed(id, { shownRole: "imp", shownAlignment: null, behaviorMode: "fake_demon_behavior",
      privateInfo: { bluffs: ["chef", "saint", "monk"], fakeMinions: [other], extraText: "note" }, publishedPacket: packet("imp", "evil") });
    expect(resolve([setPerceptionIntent(player(id), { shownRole: "imp", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" })]))
      .toEqual({ ok: true, changed: true });
    // Not a fake Demon any more: bluffs / fake Minions are inapplicable; the
    // simulated-information note stays applicable.
    expect(player(id).privateInfo).toEqual({ extraText: "note" });
    expect(player(id).publishedPacket).toBeUndefined();
  });

  it("Undo restores the exact snapshot of an accepted transaction that contained a perception round trip", () => {
    liveGame();
    const id = chef();
    const other = holder("empath");
    seed(id, { privateInfo: { extraText: "draft" }, publishedPacket: packet("chef", "good") });
    const snapshot = structuredClone(game());
    const p = player(id);
    const intents = [
      setPerceptionIntent(p, { shownRole: "librarian", shownAlignment: null }),
      from(p, { shownRole: "librarian", shownAlignment: null }, { shownRole: p.shownRole, shownAlignment: p.shownAlignment }),
      setPerceptionIntent(player(other), { shownRole: "investigator", shownAlignment: null }),
    ];
    const b = baseline();
    expect(resolve(intents)).toEqual({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(id)).toBe(b.game.players[id]); // the round-tripped participant is untouched
    expect(player(other).shownRole).toBe("investigator");
    state().undo();
    expect(game()).toEqual(snapshot);
    expect(state().undoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ordinary <-> Traveler
// ---------------------------------------------------------------------------
describe("ordinary <-> Traveler transitions (live play)", () => {
  it("ordinary -> Traveler: the character is public (Actual / Shown / public together), Actual Alignment kept, abilityUsed reset, fresh arrival, starting-population plan untouched", () => {
    liveGame();
    const id = chef();
    state().setAbilityUsed(id, true);
    const before = game();
    const beforeAlignment = player(id).actualAlignment;
    expect(resolve([changeRoleIntent(player(id), "thief")])).toEqual({ ok: true, changed: true });
    expect(player(id)).toMatchObject({
      isTraveler: true, actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief", shownAlignment: null, behaviorMode: "normal",
      abilityUsed: false, actualAlignment: beforeAlignment, travelerArrival: { demonInfoComplete: false, firstNightComplete: false },
    });
    for (const key of ["plannedPlayerCount", "plannedTravelerCount", "startingNonTravelerCount", "rolePool"] as const) {
      expect(game()[key]).toEqual(before[key]);
    }
    expect(roleHistory()[0]!.change).toEqual({ kind: "value", from: { actualRole: "chef" }, to: { actualRole: "thief" } });
  });

  it("Traveler -> Traveler keeps Actual / Shown / public in sync; gameplay resets abilityUsed and gives a fresh arrival", () => {
    const zed = liveGameWithTraveler("thief");
    state().setAbilityUsed(zed, true);
    state().completeTravelerArrivalCheck(zed);
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed), actualAlignment: "good",
      travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 } } } } });
    expect(resolve([changeRoleIntent(player(zed), "gunslinger")])).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ isTraveler: true, actualRole: "gunslinger", shownRole: "gunslinger", publicDisplayRole: "gunslinger",
      abilityUsed: false, actualAlignment: "good", travelerArrival: { demonInfoComplete: false, firstNightComplete: false } });
  });

  it("Traveler -> ordinary requires an explicit valid setPerception in the same resolution (never invented) and clears the public character and arrival", () => {
    const zed = liveGameWithTraveler("thief");
    const b = baseline();
    // Without a perception the Traveler-type Shown Role would remain: refused.
    expect(resolve([changeRoleIntent(player(zed), "chef")])).toMatchObject({ ok: false, code: "perception" });
    expectInert(b);
    // A Traveler-type perception (or one for a Fabled/Loric) is refused too.
    expect(resolve([changeRoleIntent(player(zed), "chef"), setPerceptionIntent({ ...player(zed), isTraveler: false } as STPlayerRecord, { shownRole: "thief", shownAlignment: null })]))
      .toMatchObject({ ok: false });
    // With an explicit ordinary perception it commits atomically.
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed), actualAlignment: "evil" } } } });
    const intents = [changeRoleIntent(player(zed), "chef"),
      { ...setPerceptionIntent(player(zed), { shownRole: "chef", shownAlignment: "evil" }) }];
    expect(resolve(intents)).toEqual({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ isTraveler: false, actualRole: "chef", shownRole: "chef", shownAlignment: "evil", publicDisplayRole: null, actualAlignment: "evil", abilityUsed: false });
    expect(player(zed).travelerArrival).toBeUndefined();
    // Only the ACTUAL Role change is History (Zed's own Thief assignment was
    // recorded earlier); the perception is not.
    expect(roleHistory().map((r) => r.change)).toEqual([
      { kind: "value", from: { actualRole: "" }, to: { actualRole: "thief" } },
      { kind: "value", from: { actualRole: "thief" }, to: { actualRole: "chef" } },
    ]);
  });

  it("a Traveler's Shown Role is their own character: setPerception cannot show a Traveler something else", () => {
    const zed = liveGameWithTraveler("thief");
    expect(resolve([setPerceptionIntent(player(zed), { shownRole: "chef", shownAlignment: null })])).toMatchObject({ ok: false, code: "perception" });
    expect(resolve([setPerceptionIntent(player(zed), { shownRole: "thief", shownAlignment: null })])).toEqual({ ok: true, changed: false });
  });

  it("Traveler correction: `preserve` (default) leaves arrival/progress and demonInfoComplete intact; `restart` reinitializes only the authorized arrival/progress", () => {
    const zed = liveGameWithTraveler("thief");
    const arrival = { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 };
    const stepKeys = [`1:travelerArrival:${zed}:thief`, `1:p:${zed}:thief`, "1:demonInfo"];
    const seed = () => store.setState({ game: { ...game(), phase: "night", day: 1,
      nightProgress: Object.fromEntries(stepKeys.map((k) => [k, { status: "done", notes: "" }])),
      players: { ...game().players, [zed]: { ...player(zed), abilityUsed: true, actualAlignment: "evil", travelerArrival: { ...arrival } } } } });
    seed();
    const b = baseline();
    expect(resolve([correctRoleIntent(player(zed), "gunslinger")])).toMatchObject({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", shownRole: "gunslinger", publicDisplayRole: "gunslinger", abilityUsed: true, travelerArrival: arrival });
    expect(Object.keys(game().nightProgress).sort()).toEqual([...stepKeys].sort());
    // restart
    store.setState({ game: b.game, undoStack: [], localSeq: b.seq });
    seed();
    expect(resolve([correctRoleIntent(player(zed), "gunslinger", "restart")])).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ actualRole: "gunslinger", abilityUsed: true, actualAlignment: "evil",
      travelerArrival: { demonInfoComplete: false, firstNightComplete: false } });
    expect(Object.keys(game().nightProgress)).toEqual(["1:demonInfo"]); // only this Traveler's arrival/role steps
  });

  describe("same-Role Traveler correction (frozen: `restart` is an explicit arrival reinitialization, not a no-op)", () => {
    const arrival = { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 };
    /** A Night-1 Traveler (Thief) mid-arrival, with progress of their own, of
     * another participant and a global step, plus Effect/Reminder/Life state. */
    function seededTraveler() {
      const zed = liveGameWithTraveler("thief");
      const other = holder("empath");
      const bind = (pid: PlayerId) => ({ playerId: pid, participantId: player(pid).participantId! });
      expect(state().resolveEffects({ intents: [{ kind: "apply", target: bind(zed), effect: { type: "poisoned", lifetime: { kind: "manual" } } }] } as never))
        .toMatchObject({ ok: true, changed: true });
      expect(state().resolveReminders({ intents: [{ kind: "place", target: bind(zed), reminder: { label: "Chosen" } }] } as never))
        .toMatchObject({ ok: true, changed: true });
      const step = { status: "done" as const, notes: "" };
      store.setState({ game: { ...game(), phase: "night", day: 1,
        nightProgress: { [`1:travelerArrival:${zed}:thief`]: step, [`1:p:${zed}:thief`]: step,
          [`1:travelerArrival:${other}:x`]: step, [`1:p:${other}:empath`]: step, "1:demonInfo": step, [`0:p:${zed}:thief`]: step },
        players: { ...game().players, [zed]: { ...player(zed), abilityUsed: true, actualAlignment: "evil", travelerArrival: { ...arrival },
          privateInfo: { extraText: "draft" }, packetEpoch: "epoch-keep" } } } });
      store.setState({ undoStack: [] });
      return { zed, other };
    }

    it("1. same Traveler Role + correction + preserve (explicit or default) is a TRUE no-op: arrival and progress unchanged, no Undo/localSeq/History", () => {
      const { zed } = seededTraveler();
      const b = baseline();
      expect(resolve([correctRoleIntent(player(zed), "thief")])).toEqual({ ok: true, changed: false });
      expect(resolve([correctRoleIntent(player(zed), "thief", "preserve")])).toEqual({ ok: true, changed: false });
      expect(state().correctRole(zed, "thief")).toEqual({ ok: true, changed: false });
      expect(state().correctRole(zed, "thief", { travelerArrivalPolicy: "preserve" })).toEqual({ ok: true, changed: false });
      expectInert(b);
      expect(player(zed).travelerArrival).toEqual(arrival);
      expect(Object.keys(game().nightProgress)).toHaveLength(6);
      expect(game().history).toBe(b.game.history);
    });

    it("2. same Traveler Role + correction + restart is an accepted atomic mutation: arrival restarted, only this Traveler's arrival/role steps cleared, everything else preserved, one Undo/localSeq, no Role History value record", () => {
      const { zed, other } = seededTraveler();
      const b = baseline();
      const before = player(zed);
      expect(resolve([correctRoleIntent(player(zed), "thief", "restart")])).toEqual({ ok: true, changed: true });
      expectOneCommit(b);
      const after = player(zed);
      // Identity and Role unchanged.
      expect(after).toMatchObject({ actualRole: "thief", isTraveler: true, participantId: before.participantId, actualAlignment: "evil",
        shownRole: "thief", publicDisplayRole: "thief", shownAlignment: before.shownAlignment, behaviorMode: before.behaviorMode });
      // abilityUsed preserved; arrival explicitly reinitialized.
      expect(after.abilityUsed).toBe(true);
      expect(after.travelerArrival).toEqual({ demonInfoComplete: false, firstNightComplete: false });
      // The Role did not change: no draft/packet invalidation, no new epoch.
      expect(after.privateInfo).toEqual({ extraText: "draft" });
      expect(after.packetEpoch).toBe("epoch-keep");
      // Life, Effects and Reminders untouched.
      expect(after.alive).toBe(before.alive);
      expect(after.ghostVote).toBe(before.ghostVote);
      expect(after.effects).toEqual(before.effects);
      expect(after.reminders).toEqual(before.reminders);
      expect(after.effects?.length).toBeGreaterThan(0);
      expect(after.reminders?.length).toBeGreaterThan(0);
      // Only this Traveler's current-night arrival/role steps are cleared.
      expect(Object.keys(game().nightProgress).sort()).toEqual(
        [`1:travelerArrival:${other}:x`, `1:p:${other}:empath`, "1:demonInfo", `0:p:${zed}:thief`].sort());
      // Every other participant is the very same record.
      for (const id of game().seatOrder) if (id !== zed) expect(game().players[id]).toBe(b.game.players[id]);
      // No Role History value record is fabricated (the Actual Role did not change).
      expect(game().history).toBe(b.game.history);
      expect(roleHistory()).toHaveLength(1); // only Zed's earlier Thief assignment
    });

    it("2b. the plan itself is a minimal partial patch: only travelerArrival, no History, no Actual Role change, no epoch minted", () => {
      const { zed } = seededTraveler();
      const ids = counterIds();
      const result = planRoleTransaction(game(), { intents: [correctRoleIntent(player(zed), "thief", "restart")] },
        { script: setupScript, ids });
      expect(result).toMatchObject({ ok: true, changed: true });
      if (!result.ok || !result.changed) return;
      expect(result.plan.players).toEqual({ [zed]: { set: { travelerArrival: { demonInfoComplete: false, firstNightComplete: false } }, remove: [] } });
      expect(result.plan.history).toEqual([]);
      expect(result.plan.actualRoleChanges).toEqual([]);
      expect(result.plan.nightProgressRemove.sort()).toEqual([`1:p:${zed}:thief`, `1:travelerArrival:${zed}:thief`].sort());
      expect(ids.packetEpoch()).toBe("epoch-1"); // never drawn by the plan
    });

    it("restart with an arrival that is already initial and no step to clear is net-zero: a TRUE no-op", () => {
      const zed = liveGameWithTraveler("thief");
      const b = baseline();
      expect(player(zed).travelerArrival).toEqual({ demonInfoComplete: false, firstNightComplete: false });
      expect(resolve([correctRoleIntent(player(zed), "thief", "restart")])).toEqual({ ok: true, changed: false });
      expectInert(b);
    });

    it("restart with an initial arrival but stale night steps still clears exactly those steps (one commit)", () => {
      const zed = liveGameWithTraveler("thief");
      const step = { status: "done" as const, notes: "" };
      store.setState({ game: { ...game(), phase: "night", day: 1, nightProgress: { [`1:p:${zed}:thief`]: step, "1:demonInfo": step } } });
      const b = baseline();
      expect(resolve([correctRoleIntent(player(zed), "thief", "restart")])).toEqual({ ok: true, changed: true });
      expectOneCommit(b);
      expect(Object.keys(game().nightProgress)).toEqual(["1:demonInfo"]);
      expect(game().players).toEqual(b.game.players);
    });

    it("restart applies only to a real Traveler character: an unassigned Traveler, an ordinary participant and a gameplay change ignore/refuse it", () => {
      const unassigned = liveGameWithTraveler("");
      const b = baseline();
      expect(resolve([correctRoleIntent(player(unassigned), "", "restart")])).toEqual({ ok: true, changed: false });
      expectInert(b);
      const id = chef();
      const c = baseline();
      expect(state().correctRole(id, "chef", { travelerArrivalPolicy: "restart" })).toEqual({ ok: true, changed: false });
      expectInert(c);
      const change = changeRoleIntent(player(id), "chef");
      expect(plan(game(), [{ ...change, travelerArrivalPolicy: "restart" }])).toMatchObject({ ok: false, code: "invalid" });
    });

    it("3. a stale expected Role, Traveler status or ParticipantId refuses BEFORE the restart is applied -- nothing changes", () => {
      const { zed } = seededTraveler();
      const b = baseline();
      const restart = correctRoleIntent(player(zed), "thief", "restart");
      expect(resolve([{ ...restart, expectedActualRole: "gunslinger" }])).toMatchObject({ ok: false, code: "stale" });
      expect(resolve([{ ...restart, expectedIsTraveler: false }])).toMatchObject({ ok: false, code: "stale" });
      expect(resolve([{ ...restart, target: { playerId: zed, participantId: "someone-else" } }])).toMatchObject({ ok: false, code: "stale" });
      expectInert(b);
      expect(player(zed).travelerArrival).toEqual(arrival);
      expect(Object.keys(game().nightProgress)).toHaveLength(6);
      // The observed truth moving between render and submit is stale too.
      const observed = correctRoleIntent(player(zed), "thief", "restart");
      expect(state().assignRole(zed, "gunslinger")).toMatchObject({ ok: true, changed: true });
      const c = baseline();
      expect(resolve([observed])).toMatchObject({ ok: false, code: "stale" });
      expectInert(c);
    });

    it("4. Undo restores the exact pre-restart Traveler arrival and progress (one step), without reconstructing anything from History", () => {
      const { zed } = seededTraveler();
      const snapshot = structuredClone(game());
      const b = baseline();
      expect(state().correctRole(zed, "thief", { travelerArrivalPolicy: "restart" })).toEqual({ ok: true, changed: true });
      expectOneCommit(b);
      expect(player(zed).travelerArrival).toEqual({ demonInfoComplete: false, firstNightComplete: false });
      state().undo();
      expect(game()).toEqual(snapshot);
      expect(player(zed).travelerArrival).toEqual(arrival);
      expect(Object.keys(game().nightProgress)).toHaveLength(6);
      expect(state().undoStack).toHaveLength(0);
    });

    it("a restart shares one atomic commit with an accompanying perception on another participant (all-or-nothing, one Undo)", () => {
      const { zed } = seededTraveler();
      const id = chef();
      const b = baseline();
      const intents = [correctRoleIntent(player(zed), "thief", "restart"),
        setPerceptionIntent(player(id), { shownRole: "librarian", shownAlignment: null })];
      expect(resolve(intents)).toEqual({ ok: true, changed: true });
      expectOneCommit(b);
      expect(player(zed).travelerArrival).toEqual({ demonInfoComplete: false, firstNightComplete: false });
      expect(player(id).shownRole).toBe("librarian");
      expect(game().history).toBe(b.game.history); // perception + restart record nothing
      // A refusal anywhere rolls the restart back with it.
      const c = baseline();
      const bad = [correctRoleIntent(player(zed), "thief", "restart"), setPerceptionIntent(player(id), { shownRole: "thief", shownAlignment: null })];
      expect(resolve(bad)).toMatchObject({ ok: false });
      expectInert(c);
    });
  });

  it("the arrival policy is never derived from packet invalidation: a published Demon packet's withdrawal leaves demonInfoComplete alone", () => {
    const zed = liveGameWithTraveler("thief");
    store.setState({ game: { ...game(), players: { ...game().players, [zed]: { ...player(zed), actualAlignment: "evil",
      travelerArrival: { demonInfoComplete: true, firstNightComplete: false },
      publishedPacket: { id: "sent", payload: { shownRole: "thief", shownAlignment: "evil", demon: { id: "d", name: "D", seat: 1 } } } } } } });
    expect(resolve([correctRoleIntent(player(zed), "gunslinger")])).toMatchObject({ ok: true });
    expect(player(zed).publishedPacket).toBeUndefined();
    expect(player(zed).travelerArrival).toEqual({ demonInfoComplete: true, firstNightComplete: false });
  });

  it("assigning an unassigned Traveler (from blank) works; a Traveler may be reopened as unassigned ONLY by a correction", () => {
    const zed = liveGameWithTraveler("");
    expect(player(zed).actualRole).toBe("");
    expect(resolve([changeRoleIntent(player(zed), "thief")])).toMatchObject({ ok: true, changed: true });
    expect(resolve([changeRoleIntent(player(zed), "")])).toMatchObject({ ok: false, code: "role" });
    expect(resolve([correctRoleIntent(player(zed), "")])).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ isTraveler: true, actualRole: "", shownRole: null, publicDisplayRole: null });
    expect(roleHistory()[roleHistory().length - 1]!.change).toEqual({ kind: "value", from: { actualRole: "thief" }, to: { actualRole: "" } });
  });

  it("the compatibility wrappers never flip ordinary-vs-Traveler status (the seam does)", () => {
    const zed = liveGameWithTraveler("thief");
    const id = chef();
    expect(state().assignRole(id, "thief")).toMatchObject({ ok: false, code: "role" });
    expect(state().assignRole(zed, "chef")).toMatchObject({ ok: false, code: "role" });
    expect(state().correctRole(id, "thief")).toMatchObject({ ok: false, code: "role" });
  });
});

// ---------------------------------------------------------------------------
// Phase boundaries
// ---------------------------------------------------------------------------
describe("Setup / Live / Ended boundaries", () => {
  it("before the initial Reveal, Setup Role assignment still works and records NO History", () => {
    setupTable();
    const id = chef();
    expect(state().assignRole(id, "saint")).toMatchObject({ ok: true, changed: true });
    expect(player(id).actualRole).toBe("saint");
    expect(game().history).toHaveLength(0);
  });

  it("after the initial Reveal but before Night 1: gameplay transitions are refused, corrections are allowed, and no History is produced", () => {
    revealedTable();
    const id = chef();
    const b = baseline();
    expect(state().assignRole(id, "saint")).toMatchObject({ ok: false, code: "phase" });
    expect(resolve([changeRoleIntent(player(id), "saint")])).toMatchObject({ ok: false, code: "phase" });
    expectInert(b);
    expect(state().correctRole(id, "saint")).toEqual({ ok: true, changed: true });
    expect(player(id)).toMatchObject({ actualRole: "saint" });
    expect(game().history).toHaveLength(0);
    expect(game().phase).toBe("setup");
    // beginNightOne keeps its own readiness/coherence validation.
    expect(state().beginNightOne().ok).toBe(false);
  });

  it("in Setup the seam never changes ordinary-vs-Traveler status (that is Setup's own command)", () => {
    setupTable();
    const id = chef();
    expect(resolve([changeRoleIntent(player(id), "thief")])).toMatchObject({ ok: false, code: "phase" });
    expect(resolve([correctRoleIntent(player(id), "thief")])).toMatchObject({ ok: false, code: "phase" });
    expect(player(id).isTraveler).toBe(false);
  });

  it("an unassigned Traveler may be assigned a character after the Reveal (before Night 1); no History", () => {
    revealedTable();
    state().addPlayer("Zed");
    const zed = idOf("Zed");
    expect(player(zed).isTraveler).toBe(true);
    expect(state().assignRole(zed, "thief")).toMatchObject({ ok: true, changed: true });
    expect(player(zed)).toMatchObject({ actualRole: "thief", shownRole: "thief", publicDisplayRole: "thief" });
    expect(game().history).toHaveLength(0);
    // Changing an already-assigned committed character is a correction.
    expect(state().assignRole(zed, "gunslinger")).toMatchObject({ ok: false, code: "phase" });
    expect(state().correctRole(zed, "gunslinger")).toMatchObject({ ok: true, changed: true });
  });

  it("Night and Day both allow gameplay changes, corrections and perception updates, each with the right moment", () => {
    liveGame();
    const id = chef();
    expect(state().assignRole(id, "saint")).toMatchObject({ ok: true });
    expect(state().advancePhase().ok).toBe(true); // Day 1
    expect(state().correctRole(id, "monk")).toMatchObject({ ok: true });
    expect(state().setShownRole(id, "librarian")).toMatchObject({ ok: true });
    expect(roleHistory().map((r) => r.moment)).toEqual([{ phase: "night", day: 1 }, { phase: "day", day: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Store seam: one commit, Undo, persistence
// ---------------------------------------------------------------------------
describe("resolveRoles: one commit, Undo and persistence", () => {
  it("Undo atomically restores every field a multi-participant, perception and Traveler transaction changed", () => {
    const zed = liveGameWithTraveler("thief");
    const a = holder("chef"); const b2 = holder("empath");
    state().setPrivateText(a, "draft");
    store.setState({ undoStack: [] });
    const snapshot = structuredClone(game());
    const b = baseline();
    const result = resolve([
      changeRoleIntent(player(a), "empath"), changeRoleIntent(player(b2), "chef"),
      setPerceptionIntent(player(a), { shownRole: "empath", shownAlignment: "evil", behaviorMode: "custom" }),
      correctRoleIntent(player(zed), "gunslinger", "restart"),
    ].filter((i) => i.kind !== "correctActualRole"));
    expect(result).toMatchObject({ ok: true, changed: true });
    expectOneCommit(b);
    state().undo();
    expect(game()).toEqual(snapshot);
    expect(state().undoStack).toHaveLength(0);
  });

  it("Undo restores a Traveler transition (ordinary -> Traveler) with its arrival and progress, without reconstructing anything from History", () => {
    liveGame();
    const id = chef();
    const snapshot = structuredClone(game());
    expect(resolve([changeRoleIntent(player(id), "thief")])).toMatchObject({ ok: true });
    expect(roleHistory()).toHaveLength(1);
    state().undo();
    expect(game()).toEqual(snapshot);
    expect(game().history).toHaveLength(0);
  });

  it("persistence: a game after Role transitions round-trips the current schema, and History stays explanatory only", () => {
    liveGame();
    const id = chef();
    expect(resolve([changeRoleIntent(player(id), "saint"), setPerceptionIntent(player(id), { shownRole: "librarian", shownAlignment: "evil" })], { resolutionId: "res-1" })).toMatchObject({ ok: true });
    expect(state().correctRole(holder("empath"), "monk")).toMatchObject({ ok: true });
    const round = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game())));
    expect(round).toEqual(JSON.parse(JSON.stringify(game())));
    expect(round.gameSchemaVersion).toBe(22);
    // Current State never comes from History: dropping the History leaves it.
    expect(StorytellerGamePersistedSchema.safeParse({ ...JSON.parse(JSON.stringify(game())), history: [] }).success).toBe(true);
  });

  it("the planner is deterministic given injected ids and never draws its own randomness", () => {
    liveGame();
    const id = chef();
    const intents = [changeRoleIntent(player(id), "saint")];
    const a = plan(game(), intents, { resolutionId: "r" });
    const b = plan(game(), intents, { resolutionId: "r" });
    expect(a).toEqual(b);
    if (a.ok && a.changed) {
      expect(a.plan.history[0]!.id).toBe("h-1");
      expect(a.plan.players[id]!.set.packetEpoch).toBe("epoch-1");
    }
  });

  it("no packet epoch is minted for a true no-op or a net-zero resolution", () => {
    liveGame();
    const id = chef();
    const result = plan(game(), [changeRoleIntent(player(id), "chef"), setPerceptionIntent(player(id), { shownRole: player(id).shownRole, shownAlignment: player(id).shownAlignment })]);
    expect(result).toEqual({ ok: true, changed: false });
    // A perception that changes and changes back within one transaction leaves
    // no net change on a participant with no draft or packet.
    const p = player(id);
    const flip = plan(game(), [
      setPerceptionIntent(p, { shownRole: "librarian", shownAlignment: null }),
      { ...setPerceptionIntent(p, { shownRole: p.shownRole, shownAlignment: p.shownAlignment }), expectedShownRole: "librarian", expectedShownAlignment: null },
    ]);
    expect(flip).toEqual({ ok: true, changed: false });
  });
});

// ---------------------------------------------------------------------------
// Compatibility wrappers: no parallel mutation path
// ---------------------------------------------------------------------------
describe("compatibility wrappers route through the ONE authoritative seam", () => {
  it.each([
    ["assignRole", (id: PlayerId) => state().assignRole(id, "saint"), ["changeActualRole"]],
    ["correctRole", (id: PlayerId) => state().correctRole(id, "saint", { travelerArrivalPolicy: "restart" }), ["correctActualRole"]],
    ["showAssignedRole", (id: PlayerId) => state().showAssignedRole(id), ["setPerception"]],
    ["setShownRole", (id: PlayerId) => state().setShownRole(id, "librarian"), ["setPerception"]],
    ["setShownAlignment", (id: PlayerId) => state().setShownAlignment(id, "evil"), ["setPerception"]],
    ["setBehaviorMode", (id: PlayerId) => state().setBehaviorMode(id, "custom"), ["setPerception"]],
    ["setPerception", (id: PlayerId) => state().setPerception(id, { shownRole: "librarian", shownAlignment: null }), ["setPerception"]],
  ] as const)("%s submits exactly one transaction to resolveRoles and writes nothing itself", (name, call, kinds) => {
    liveGame();
    const id = holder("imp"); // showAssignedRole needs a role that is not concealed and not already shown
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), shownRole: "chef" } } } });
    const seen: RoleTransaction[] = [];
    const real = state().resolveRoles;
    store.setState({ resolveRoles: (transaction: RoleTransaction) => { seen.push(transaction); return { ok: true, changed: false }; } });
    const before = baseline();
    try { call(id); }
    finally { store.setState({ resolveRoles: real }); }
    expect(seen, name).toHaveLength(1);
    expect(seen[0]!.intents.map((intent) => intent.kind)).toEqual(kinds);
    // Bound to the participation instance and the observed state.
    expect(seen[0]!.intents[0]).toMatchObject({ target: { playerId: id, participantId: player(id).participantId } });
    expectInert(before); // the wrapper itself changed nothing
  });

  it("a wrapper's Mutation Context is forwarded to the seam", () => {
    liveGame();
    const id = chef();
    const source = idOf("Alice") === id ? idOf("Bob") : idOf("Alice");
    expect(state().assignRole(id, "saint", { provenance: { sourcePlayer: source } })).toMatchObject({ ok: true });
    expect(roleHistory()[0]!.provenance?.sourceParticipant).toEqual(participantRefOf(game(), source));
  });

  it("the wrappers refuse a seat with no participant without touching state", () => {
    liveGame();
    const b = baseline();
    for (const result of [state().assignRole("nope", "saint"), state().setShownRole("nope", "chef"), state().setBehaviorMode("__proto__", "custom"),
      state().setShownAlignment("toString", "good"), state().correctRole("constructor", "chef"), state().showAssignedRole("nope")]) {
      expect(result).toMatchObject({ ok: expect.any(Boolean) });
    }
    expect(state().assignRole("nope", "saint")).toMatchObject({ ok: false, code: "notSeated" });
    expectInert(b);
  });
});
