// Phase 10G, Slice 1: game-scoped Rule Facts (PHASE10G Sections 4-7, 22).
// Traceability: 10G-AC-01..07, 10G-AC-44, 10G-AC-45; proof areas 1, 2, 14-15.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store, migrateStoreState, takeMigrationResetFlag } from "./storytellerStore";
import {
  GAME_RULE_FACT_REGISTRY,
  PIT_HAG_ARBITRARY_DEATHS,
  TOYMAKER_DEMON_SKIP_OCCURRED,
  applyGameRuleFactPlan,
  gameRuleFactActive,
  planGameRuleFactExpiry,
  planGameRuleFactTransaction,
  toymakerSkipStatus,
} from "./gameRuleFacts";
import { createRulesQuery } from "./rulesQuery";
import { detectLegacyGameVersion, hasV25Evidence, migrateGameEntry } from "./gameMigration";
import { GameRuleFactHistoryRecordSchema, HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { asV24, withV25ToCurrent } from "@/test/v20Migration";
import { buildRegistry } from "@/data/roleRegistry";
import type { GameRuleFactRecord, StorytellerLobbyRecord } from "./types";

type Raw = Record<string, unknown>;
const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];
const ids = { historyId: (() => { let n = 0; return () => `h${++n}`; })() };

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript } }));

function liveGame(phase: "night" | "day" = "night", day = 2, over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase, day, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  return g;
}
function live(phase: "night" | "day" = "night", day = 2, over: Partial<StorytellerLobbyRecord> = {}) {
  store.setState({ game: liveGame(phase, day, over), undoStack: [], localSeq: 5 });
}
const baseline = () => ({ game: game(), undo: state().undoStack, seq: state().localSeq, history: game().history });
function expectInert(b: ReturnType<typeof baseline>) {
  expect(game()).toBe(b.game);
  expect(state().undoStack).toBe(b.undo);
  expect(state().localSeq).toBe(b.seq);
  expect(game().history).toBe(b.history);
}
const fact = (type: string, over: Partial<GameRuleFactRecord> = {}): GameRuleFactRecord =>
  ({ type, recordedAt: { phase: "night", day: 2 }, ...over });

describe("10G-AC-01 / AC-02: the registry and v25 authoritative state", () => {
  it("registers exactly the two approved singleton facts", () => {
    expect([...GAME_RULE_FACT_REGISTRY.keys()]).toEqual([PIT_HAG_ARBITRARY_DEATHS, TOYMAKER_DEMON_SKIP_OCCURRED]);
  });

  it("a new game starts with an empty, validated collection", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 5 });
    expect(game().gameRuleFacts).toEqual([]);
    expect(game().gameSchemaVersion).toBe(26);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });

  it("an unknown/custom stored type is structurally valid bookkeeping but never mechanically active", () => {
    const g = liveGame("night", 2, { gameRuleFacts: [fact("homebrewCurse")] });
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(true);
    expect(gameRuleFactActive(g, "homebrewCurse")).toBe(false);
    const query = createRulesQuery(g, { registry, script: setupScript, modifiers: [] });
    expect(query.gameRuleFact("homebrewCurse")).toMatchObject({ known: false });
  });

  it.each([
    ["two records of one type", (g: Raw) => { g.gameRuleFacts = [fact(TOYMAKER_DEMON_SKIP_OCCURRED), fact(TOYMAKER_DEMON_SKIP_OCCURRED)]; }],
    ["a fact in Setup", (g: Raw) => { g.phase = "setup"; g.day = 0; g.gameRuleFacts = [fact(TOYMAKER_DEMON_SKIP_OCCURRED)]; }],
    ["a fact recorded after now", (g: Raw) => { g.gameRuleFacts = [fact(TOYMAKER_DEMON_SKIP_OCCURRED, { recordedAt: { phase: "day", day: 2 } })]; }],
    ["an overdue expiry", (g: Raw) => { g.phase = "day"; g.gameRuleFacts = [fact(PIT_HAG_ARBITRARY_DEATHS, { expiresAt: { phase: "day", day: 2 } })]; }],
    ["an expiry not after recording", (g: Raw) => { g.gameRuleFacts = [fact(PIT_HAG_ARBITRARY_DEATHS, { expiresAt: { phase: "night", day: 2 } })]; }],
    ["an unknown key (a note)", (g: Raw) => { g.gameRuleFacts = [{ ...fact(TOYMAKER_DEMON_SKIP_OCCURRED), note: "free text" }]; }],
    ["a participant on a fact", (g: Raw) => { g.gameRuleFacts = [{ ...fact(TOYMAKER_DEMON_SKIP_OCCURRED), participant: { kind: "legacy", playerId: "p0" } }]; }],
    ["a malformed type", (g: Raw) => { g.gameRuleFacts = [fact("has space")]; }],
    ["a non-array collection", (g: Raw) => { g.gameRuleFacts = {}; }],
  ])("current-version malformed data is rejected, never repaired: %s", (_label, corrupt) => {
    const g = liveGame() as unknown as Raw;
    corrupt(g);
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(false);
  });

  it("an ended snapshot freezes its final facts (not temporally judged)", () => {
    const g = liveGame("night", 2, { phase: "ended", gameRuleFacts: [fact(PIT_HAG_ARBITRARY_DEATHS, { expiresAt: { phase: "day", day: 1 } as never })] });
    // expiresAt must still follow recordedAt structurally
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(false);
    const frozen = liveGame("night", 2, { phase: "ended", gameRuleFacts: [fact(PIT_HAG_ARBITRARY_DEATHS, { expiresAt: { phase: "day", day: 2 } })] });
    expect(StorytellerGamePersistedSchema.safeParse(frozen).success).toBe(true);
    expect(gameRuleFactActive(frozen, PIT_HAG_ARBITRARY_DEATHS)).toBe(true);
  });
});

describe("10G-AC-03: the pure planner", () => {
  it("apply at Night records the fact with its exact expiry and one participant-less History record", () => {
    const g = liveGame("night", 3);
    const result = planGameRuleFactTransaction(g, { intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }], resolutionId: "res-1" }, ids);
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) throw new Error("expected a plan");
    expect(result.plan.facts).toEqual([{ type: PIT_HAG_ARBITRARY_DEATHS, recordedAt: { phase: "night", day: 3 }, expiresAt: { phase: "day", day: 3 }, resolutionId: "res-1" }]);
    expect(result.plan.history).toHaveLength(1);
    const record = result.plan.history[0]!;
    expect(record).toMatchObject({ category: "gameRuleFact", ruleFactType: PIT_HAG_ARBITRARY_DEATHS, ruleFactOperation: "apply",
      moment: { phase: "night", day: 3 }, resolutionId: "res-1", change: { kind: "added" } });
    expect("participant" in record).toBe(false);
    const applied = applyGameRuleFactPlan(g, result.plan);
    expect(StorytellerGamePersistedSchema.safeParse(applied).success).toBe(true);
    expect(g.gameRuleFacts).toEqual([]); // pure: input untouched
  });

  it("a singleton already current is a TRUE no-op; removing an absent fact is a true no-op", () => {
    const g = liveGame("night", 2, { gameRuleFacts: [fact(TOYMAKER_DEMON_SKIP_OCCURRED)] });
    expect(planGameRuleFactTransaction(g, { intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] })).toEqual({ ok: true, changed: false });
    expect(planGameRuleFactTransaction(g, { intents: [{ kind: "remove", type: PIT_HAG_ARBITRARY_DEATHS }] })).toEqual({ ok: true, changed: false });
  });

  it("remove / correction records a removed snapshot, marked as a correction when requested", () => {
    const g = liveGame("day", 2, { gameRuleFacts: [fact(TOYMAKER_DEMON_SKIP_OCCURRED)] });
    const result = planGameRuleFactTransaction(g, { intents: [{ kind: "remove", type: TOYMAKER_DEMON_SKIP_OCCURRED }], correction: true }, ids);
    if (!result.ok || !result.changed) throw new Error("expected a plan");
    expect(result.plan.facts).toEqual([]);
    expect(result.plan.history[0]).toMatchObject({ ruleFactOperation: "remove", correction: true, change: { kind: "removed", item: fact(TOYMAKER_DEMON_SKIP_OCCURRED) } });
  });

  it("an unregistered stored type can be removed (never created)", () => {
    const g = liveGame("night", 2, { gameRuleFacts: [fact("homebrewCurse")] });
    expect(planGameRuleFactTransaction(g, { intents: [{ kind: "apply", type: "otherCurse" }] })).toMatchObject({ ok: false, code: "unregistered" });
    const removed = planGameRuleFactTransaction(g, { intents: [{ kind: "remove", type: "homebrewCurse" }] });
    expect(removed).toMatchObject({ ok: true, changed: true });
  });

  it("ordered intents plan against the evolving working collection", () => {
    const g = liveGame("night", 2);
    const result = planGameRuleFactTransaction(g, { intents: [
      { kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }, { kind: "remove", type: TOYMAKER_DEMON_SKIP_OCCURRED }, { kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED },
    ] }, ids);
    if (!result.ok || !result.changed) throw new Error("expected a plan");
    expect(result.plan.history.map((h) => h.ruleFactOperation)).toEqual(["apply", "remove", "apply"]);
    expect(result.plan.facts.map((f) => f.type)).toEqual([TOYMAKER_DEMON_SKIP_OCCURRED]);
  });

  it.each([
    ["Setup", { phase: "setup", day: 0 }, "notLive"],
    ["an ended game", { phase: "ended", day: 2 }, "ended"],
  ] as const)("refuses in %s", (_label, over, code) => {
    const g = liveGame("night", 2, over as Partial<StorytellerLobbyRecord>);
    expect(planGameRuleFactTransaction(g, { intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] })).toMatchObject({ ok: false, code });
  });

  it("arbitrary deaths can only be applied at Night; the Toymaker skip at Night or Day", () => {
    expect(planGameRuleFactTransaction(liveGame("day", 2), { intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] })).toMatchObject({ ok: false, code: "phase" });
    expect(planGameRuleFactTransaction(liveGame("day", 2), { intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] })).toMatchObject({ ok: true, changed: true });
  });

  it.each([
    ["no intents", { intents: [] }],
    ["a non-array", { intents: "apply" }],
    ["an unknown kind", { intents: [{ kind: "update", type: TOYMAKER_DEMON_SKIP_OCCURRED }] }],
    ["an extra key", { intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED, note: "x" }] }],
    ["a malformed type", { intents: [{ kind: "apply", type: "" }] }],
    ["a bad resolution id", { intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }], resolutionId: "" }],
    ["a smuggled durable source", { intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }], context: { provenance: { sourceParticipant: { kind: "legacy", playerId: "p0" } } } }],
    ["a null request", null],
  ])("a malformed request (%s) is refused as invalid, never thrown", (_label, request) => {
    expect(planGameRuleFactTransaction(liveGame(), request as never)).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("10G-AC-04: resolveGameRuleFacts -- one commit, refusal-safe, precommit persistence proof", () => {
  it("a changed plan commits exactly once (one replacement, one Undo entry, one localSeq step)", () => {
    live("night", 2);
    const b = baseline();
    const result = state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }],
      context: { provenance: { sourcePlayer: "p4", reason: "Demon chose not to attack" } } });
    expect(result).toEqual({ ok: true, changed: true });
    expect(state().undoStack).toHaveLength(1);
    expect(state().undoStack[0]).toEqual(b.game);
    expect(state().localSeq).toBe(b.seq + 1);
    expect(game().gameRuleFacts).toHaveLength(1);
    expect(game().gameRuleFacts[0]!.provenance?.sourceParticipant).toMatchObject({ kind: "participant", playerId: "p4" });
    expect(game().history.at(-1)).toMatchObject({ category: "gameRuleFact", ruleFactOperation: "apply" });
    state().undo();
    expect(game().gameRuleFacts).toEqual([]);
  });

  it("a true no-op and every refusal change no Current State, History, Undo or localSeq", () => {
    live("night", 2, { gameRuleFacts: [fact(TOYMAKER_DEMON_SKIP_OCCURRED)] });
    const b = baseline();
    expect(state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] })).toEqual({ ok: true, changed: false });
    expectInert(b);
    expect(state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: "homebrew" }] })).toMatchObject({ ok: false, code: "unregistered" });
    expectInert(b);
    store.setState({ game: { ...game(), phase: "ended" } });
    const ended = baseline();
    expect(state().resolveGameRuleFacts({ intents: [{ kind: "remove", type: TOYMAKER_DEMON_SKIP_OCCURRED }] })).toMatchObject({ ok: false, code: "ended" });
    expectInert(ended);
  });

  it("a result the writer cannot store (an oversized string leaf) is refused before commit", () => {
    live("night", 2);
    const b = baseline();
    const huge = "x".repeat(10_485_761);
    const result = state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }], context: { provenance: { note: huge } } });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect((result as { message: string }).message).toMatch(/cannot be safely stored online/);
    expectInert(b);
  });

  it("a result whose recovery checkpoint would exceed the envelope is refused before commit", () => {
    live("night", 2);
    const b = baseline();
    // Each leaf fits, but the fact and its History each carry the note: the
    // single derived checkpoint string exceeds Firebase's 10 MiB leaf limit.
    const big = "x".repeat(6_000_000);
    const result = state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }], context: { provenance: { note: big } } });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect((result as { message: string }).message).toMatch(/recovery checkpoint/);
    expectInert(b);
  });
});

describe("10G-AC-05: participant-less game History; participant categories unchanged (proof areas 1-2)", () => {
  const ruleFactRecord = (over: Raw = {}): Raw => ({
    id: "g1", category: "gameRuleFact", moment: { phase: "night", day: 2 }, ruleFactType: TOYMAKER_DEMON_SKIP_OCCURRED,
    ruleFactOperation: "apply", change: { kind: "added", item: fact(TOYMAKER_DEMON_SKIP_OCCURRED) }, ...over,
  });
  const participant = { kind: "participant", participantId: "pt-a", playerId: "a", nameAtTime: "Alice" };

  it("a well-formed game-scoped record validates without a participant", () => {
    expect(HistoryRecordSchema.safeParse(ruleFactRecord()).success).toBe(true);
  });

  it.each([
    ["a fake participant", { participant }],
    ["a legacy participant", { participant: { kind: "legacy", playerId: "a" } }],
    ["apply recorded as removed", { change: { kind: "removed", item: fact(TOYMAKER_DEMON_SKIP_OCCURRED) } }],
    ["expire recorded as added", { ruleFactOperation: "expire" }],
    ["expiry marked as a correction", { ruleFactOperation: "expire", change: { kind: "removed", item: fact(TOYMAKER_DEMON_SKIP_OCCURRED) }, correction: true }],
    ["a snapshot of another type", { change: { kind: "added", item: fact(PIT_HAG_ARBITRARY_DEATHS) } }],
    ["an unknown operation", { ruleFactOperation: "update" }],
    ["no moment", { moment: undefined }],
    ["Effect metadata", { effectOperation: "apply" }],
    ["a Life Event mirror", { lifeEvent: { operations: [] } }],
  ])("a game-scoped record with %s is rejected", (_label, over) => {
    const raw = ruleFactRecord(over as Raw);
    if ((over as Raw).moment === undefined && "moment" in (over as Raw)) delete raw.moment;
    expect(HistoryRecordSchema.safeParse(raw).success).toBe(false);
    expect(GameRuleFactHistoryRecordSchema.safeParse(raw).success).toBe(false);
  });

  it("the fake-participant refusal says why", () => {
    const parsed = GameRuleFactHistoryRecordSchema.safeParse(ruleFactRecord({ participant }));
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/has no participant/);
  });

  it.each(["role", "alignment", "life", "effect", "reminder"])("an existing %s record still REQUIRES its ParticipantRef", (category) => {
    const valid = { id: "h1", category, participant, change: { kind: "value", from: {}, to: {} } };
    if (category !== "effect" && category !== "reminder") expect(HistoryRecordSchema.safeParse(valid).success).toBe(true);
    const { participant: _drop, ...withoutParticipant } = valid;
    expect(HistoryRecordSchema.safeParse(withoutParticipant).success).toBe(false);
  });

  it("a participant record can never carry Rule Fact metadata (hybrid rejected, never stripped)", () => {
    const hybrid = { id: "h1", category: "life", participant, change: { kind: "value", from: { alive: true }, to: { alive: false } }, ruleFactType: TOYMAKER_DEMON_SKIP_OCCURRED };
    expect(HistoryRecordSchema.safeParse(hybrid).success).toBe(false);
    expect(HistoryRecordSchema.safeParse({ ...hybrid, ruleFactType: undefined, ruleFactOperation: "apply" }).success).toBe(false);
  });

  it("a game holding both kinds of History validates as one array", () => {
    live("night", 2);
    state().recordDeath("p5");
    state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] });
    expect(game().history.map((h) => h.category)).toEqual(["life", "gameRuleFact"]);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });
});

describe("10G-AC-06: atomic expiry inside the phase rollover", () => {
  it("Night N -> Day N expires arbitrary deaths in the SAME replacement as Effect expiry; Undo restores both", () => {
    live("night", 3);
    state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] });
    state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: "p5", participantId: game().players.p5!.participantId! },
      effect: { type: "poisoned", lifetime: { kind: "untilDawn" } } }] });
    const before = game();
    const undoDepth = state().undoStack.length;
    const seq = state().localSeq;
    const seen: StorytellerLobbyRecord[] = [];
    const unsubscribe = store.subscribe((next, prev) => { if (next.game !== prev.game && next.game) seen.push(next.game); });
    expect(state().advancePhase()).toEqual({ ok: true });
    unsubscribe();
    expect(seen).toHaveLength(1); // one replacement, never a separate expiry commit
    expect(state().localSeq).toBe(seq + 1);
    expect(state().undoStack).toHaveLength(undoDepth + 1);
    expect(game()).toMatchObject({ phase: "day", day: 3, gameRuleFacts: [] });
    expect(game().players.p5!.effects).toEqual([]);
    const added = game().history.slice(before.history.length);
    expect(added.map((h) => [h.category, (h as { effectOperation?: string }).effectOperation ?? (h as { ruleFactOperation?: string }).ruleFactOperation]))
      .toEqual([["effect", "expire"], ["gameRuleFact", "expire"]]);
    expect(added[1]).toMatchObject({ moment: { phase: "day", day: 3 }, provenance: { reason: "expired" } });
    expect("participant" in added[1]!).toBe(false);
    state().undo();
    expect(game()).toEqual(before);
    expect(gameRuleFactActive(game(), PIT_HAG_ARBITRARY_DEATHS)).toBe(true);
  });

  it("a fact with no expiry survives every phase change; nothing expires early", () => {
    live("night", 2);
    state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: TOYMAKER_DEMON_SKIP_OCCURRED }] });
    for (let i = 0; i < 4; i++) state().advancePhase();
    expect(game().gameRuleFacts.map((f) => f.type)).toEqual([TOYMAKER_DEMON_SKIP_OCCURRED]);
    expect(planGameRuleFactExpiry(game(), { phase: "night", day: 9 })).toBeNull();
  });
});

describe("10G-AC-07: Rules Query reads registered facts from Current State only", () => {
  it("answers from gameRuleFacts, never from History", () => {
    const withHistoryOnly = liveGame("night", 2, { history: [{ id: "g1", category: "gameRuleFact", moment: { phase: "night", day: 2 },
      ruleFactType: PIT_HAG_ARBITRARY_DEATHS, ruleFactOperation: "apply", change: { kind: "added", item: fact(PIT_HAG_ARBITRARY_DEATHS, { expiresAt: { phase: "day", day: 2 } }) } }] });
    expect(StorytellerGamePersistedSchema.safeParse(withHistoryOnly).success).toBe(true);
    const query = createRulesQuery(withHistoryOnly, { registry, script: setupScript, modifiers: [] });
    expect(query.gameRuleFact(PIT_HAG_ARBITRARY_DEATHS)).toEqual({ known: true, value: false });
    const withFact = liveGame("night", 2, { gameRuleFacts: [fact(PIT_HAG_ARBITRARY_DEATHS, { expiresAt: { phase: "day", day: 2 } })] });
    expect(createRulesQuery(withFact, { registry, script: setupScript, modifiers: [] }).gameRuleFact(PIT_HAG_ARBITRARY_DEATHS)).toEqual({ known: true, value: true });
  });

  it("10G-AC-13: the Toymaker requirement is derived, never stored", () => {
    const plain = liveGame("night", 2);
    expect(toymakerSkipStatus(plain)).toBe("inactive");
    const toymaker = liveGame("night", 2, { fabled: ["toymaker"] });
    expect(toymakerSkipStatus(toymaker)).toBe("required");
    expect(toymakerSkipStatus({ ...toymaker, gameRuleFacts: [fact(TOYMAKER_DEMON_SKIP_OCCURRED)] })).toBe("satisfied");
    // The stored fact stays valid bookkeeping while Toymaker is inactive.
    expect(toymakerSkipStatus({ ...plain, gameRuleFacts: [fact(TOYMAKER_DEMON_SKIP_OCCURRED)] })).toBe("inactive");
  });
});

describe("10G-AC-44: v24 -> v25 migration (Current State, Undo, checkpoint recovery)", () => {
  const richCurrent = () => {
    live("night", 2);
    state().recordDeath("p5");
    state().recordInformationDelivery("p2", "empath-other-night", [{ requirementId: "evilNeighbors", kind: "number", value: 1 }]);
    return structuredClone(game());
  };

  it("marker 24 receives exactly an empty collection + stamp; History and structured deliveries are unchanged", () => {
    const v24 = asV24(richCurrent()) as unknown as Raw;
    expect(hasV25Evidence(v24)).toBe(false);
    expect(detectLegacyGameVersion(v24)).toBe(24);
    const copy = structuredClone(v24);
    migrateGameEntry(copy, 24, { kind: "canonical-only" });
    expect(copy).toEqual(withV25ToCurrent(v24));
    expect(copy.history).toEqual(v24.history);
    expect(copy.informationDeliveries).toEqual(v24.informationDeliveries);
    expect((copy.informationDeliveries as Raw[])[0]).not.toHaveProperty("kind");
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(true);
    // idempotent
    const again = structuredClone(copy);
    migrateGameEntry(again, 24, { kind: "canonical-only" });
    expect(again).toEqual(copy);
  });

  it("local Current State and EVERY Undo snapshot migrate independently; checkpoint-style recovery agrees", () => {
    const current = richCurrent();
    const v24 = asV24(current) as unknown as Raw;
    const result = migrateStoreState({ game: structuredClone(v24), undoStack: [structuredClone(v24), structuredClone(v24)] }, 24) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(withV25ToCurrent(v24));
    for (const entry of result.undoStack) expect(entry).toEqual(withV25ToCurrent(v24));
    const checkpoint = structuredClone(v24);
    migrateGameEntry(checkpoint, detectLegacyGameVersion(checkpoint)!, { kind: "canonical-only" });
    expect(checkpoint).toEqual(result.game);
  });

  it("migration never invents a Rule Fact -- not even for a Pit-Hag / Toymaker game with a skipped Demon row", () => {
    const g = liveGame("night", 3, { fabled: ["toymaker"], nightProgress: { "3:demonInfo": { status: "skipped", notes: "Demon did not attack" } } });
    const v24 = asV24(g) as unknown as Raw;
    migrateGameEntry(v24, 24, { kind: "canonical-only" });
    expect(v24.gameRuleFacts).toEqual([]);
  });

  it.each([
    ["a gameRuleFacts key", (g: Raw) => { g.gameRuleFacts = []; }],
    ["a gameRuleFact History record", (g: Raw) => { (g.history as Raw[]).push({ id: "x", category: "gameRuleFact" }); }],
    ["a Manual delivery discriminator", (g: Raw) => { (g.informationDeliveries as Raw[]).push({ kind: "manual" }); }],
  ])("an older marker carrying v25 evidence (%s) is never migrated or stamped -- rejected", (_label, add) => {
    const v24 = asV24(richCurrent()) as unknown as Raw;
    add(v24);
    expect(hasV25Evidence(v24)).toBe(true);
    const copy = structuredClone(v24);
    migrateGameEntry(copy, 24, { kind: "canonical-only" });
    expect(copy).toEqual(v24);
    migrateStoreState({ game: structuredClone(v24), undoStack: [] }, 24);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("10G-AC-45: migration never alters participant identity", () => {
    const current = richCurrent();
    const v24 = asV24(current) as unknown as Raw;
    migrateGameEntry(v24, 24, { kind: "canonical-only" });
    const ids = (g: Raw) => Object.values(g.players as Record<string, { participantId?: string }>).map((p) => p.participantId);
    expect(ids(v24)).toEqual(ids(current as unknown as Raw));
  });
});
