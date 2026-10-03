// Phase 10F Slice 7 -- Fortune Teller + the authoritative Red Herring
// (matrix Section 7). Production semantics.
import { beforeEach, describe, expect, it } from "vitest";
import { COMMUNICATED, RED_HERRING, RED_HERRING_CHOICE, registersAsDemonJudgment } from "./fortuneteller";
import { subjectId } from "./shared";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofRegistry, request, requirementIds, reseat, yes } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { FORTUNE_TELLER } from "./fortuneteller";
import { proofEnv } from "@/test/proofFixtures";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

// p0 FT, p1 imp, p2 chef, p3 monk, p4 recluse, p5 poisoner, p6 empath
const ROLES = ["fortuneteller", "imp", "chef", "monk", "recluse", "poisoner", "empath"];
const herringOn = (g: StorytellerLobbyRecord, id: string, effectId = "rh-1"): StorytellerLobbyRecord =>
  patchPlayer(g, id, { effects: [...g.players[id]!.effects, { id: effectId, type: RED_HERRING, lifetime: { kind: "manual" }, state: "active",
    expiry: { kind: "none" }, appliedAt: { phase: "night", day: 1 } } as EffectRecord] });
const answer = (g: StorytellerLobbyRecord) => g.informationDeliveries.at(-1)!.values.find((v) => v.requirementId === "isDemon");
/** SOL-10F-A1: the communicated answer is bound to the chosen pair. */
const comm = (g: StorytellerLobbyRecord, a: string, b: string) => subjectId(COMMUNICATED, bind(g, a), bind(g, b));
const pairBound = (g: StorytellerLobbyRecord, a: string, b: string, extra: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(extra).map(([key, value]) => [key === COMMUNICATED ? comm(g, a, b) : key, value]));
const ask = (g: StorytellerLobbyRecord, a: string, b: string, extra: Record<string, unknown> = {}) =>
  plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, a, b), ...pairBound(g, a, b, extra) } as never));

describe("Red Herring -- authoritative state", () => {
  it("Night 1 with no Red Herring: the Storyteller chooses a good player and the Effect is created in the SAME resolution, before delivery", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(requirementIds(ask(g, "p2", "p3"))).toEqual([RED_HERRING_CHOICE]);
    expect(ask(g, "p2", "p3", { [RED_HERRING_CHOICE]: pick(g, "p5") })).toMatchObject({ ok: false, code: "illegal" }); // evil
    const result = ask(g, "p2", "p3", { [RED_HERRING_CHOICE]: pick(g, "p3") });
    const next = planned(result);
    expect(next.players.p3!.effects).toEqual([expect.objectContaining({ type: RED_HERRING, state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" } })]);
    expect(next.players.p3!.effects[0]!.sourceParticipant).toBeUndefined();
    expect(answer(next)).toMatchObject({ kind: "boolean", value: true }); // p3 is the Red Herring
    if (result.ok && result.changed) expect(result.plan.outcome.operations.map((o) => o.domain)).toEqual(["effect", "information"]);
    expect(next.informationDeliveries.at(-1)).toMatchObject({ informationActionId: "fortuneteller-first-night",
      values: [{ requirementId: "players", kind: "player", participants: [
        expect.objectContaining({ kind: "participant", participantId: g.players.p2!.participantId }),
        expect.objectContaining({ kind: "participant", participantId: g.players.p3!.participantId }),
      ] }, { requirementId: "isDemon", kind: "boolean", value: true }] });
  });

  it("the Red Herring may be the Fortune Teller themself", () => {
    const g = proofGame(ROLES, "night", 1);
    const next = planned(ask(g, "p0", "p2", { [RED_HERRING_CHOICE]: pick(g, "p0") }));
    expect(next.players.p0!.effects[0]).toMatchObject({ type: RED_HERRING });
    expect(answer(next)).toMatchObject({ value: true });
  });

  it("persists: later Nights read the SAME participant and never re-select or recreate it", () => {
    const g = herringOn(proofGame(ROLES, "night", 3), "p3");
    const next = planned(ask(g, "p3", "p2"));
    expect(answer(next)).toMatchObject({ value: true });
    expect(next.players).toBe(g.players); // no Effect operation
    expect(answer(planned(ask(g, "p2", "p6")))).toMatchObject({ value: false });
  });

  it("zero Red Herrings on a later Night (incl. a Fortune Teller created mid-game) -> unsupported, never invented", () => {
    const g = proofGame(ROLES, "night", 3);
    expect(ask(g, "p2", "p3")).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/does not invent/) });
    // The original Fortune Teller became the Chef; the Chef became a new Fortune Teller.
    const midGame = patchPlayer(patchPlayer(g, "p0", { actualRole: "chef", shownRole: "chef" }), "p2", { actualRole: "fortuneteller", shownRole: "fortuneteller" });
    const req = plan(midGame, request(midGame, "p2", "fortuneteller", { targets: pick(midGame, "p3", "p6") }));
    expect(req).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/does not invent/) });
    // Two Fortune Tellers: whose Red Herring is whose is not modeled.
    const two = herringOn(patchPlayer(g, "p2", { actualRole: "fortuneteller", shownRole: "fortuneteller" }), "p3");
    expect(ask(two, "p3", "p6")).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/More than one Fortune Teller/) });
  });

  it("several recorded Red Herrings (malformed authoritative state) -> unsupported (correction / Manual)", () => {
    const g = herringOn(herringOn(proofGame(ROLES, "night", 3), "p3", "rh-1"), "p6", "rh-2");
    expect(ask(g, "p2", "p3")).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/More than one Red Herring/) });
  });

  it("a suppressed Red Herring Effect is not authoritative (lifecycle decision)", () => {
    const g = herringOn(proofGame(ROLES, "night", 3), "p3");
    const suppressed = patchPlayer(g, "p3", { effects: [{ ...g.players.p3!.effects[0]!, state: "suppressed" }] });
    expect(ask(suppressed, "p2", "p3")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a Reminder labelled 'Red Herring' is never read as the Red Herring", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 1), "p3", { reminders: [{ id: "rm", label: "Red Herring", sourceCharacter: "fortuneteller" }] });
    expect(requirementIds(ask(g, "p2", "p3"))).toEqual([RED_HERRING_CHOICE]);
    const later = { ...g, day: 3 };
    expect(ask(later, "p2", "p3")).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Fortune Teller -- the answer", () => {
  const g = herringOn(proofGame(ROLES, "night", 2), "p3");

  it("actual Demon / Red Herring / both -> Yes; neither -> No", () => {
    expect(answer(planned(ask(g, "p1", "p2")))).toMatchObject({ value: true });
    expect(answer(planned(ask(g, "p3", "p2")))).toMatchObject({ value: true });
    expect(answer(planned(ask(g, "p1", "p3")))).toMatchObject({ value: true });
    expect(answer(planned(ask(g, "p2", "p6")))).toMatchObject({ value: false });
  });

  it("a dead Demon still counts", () => {
    const dead = patchPlayer(g, "p1", { alive: false });
    expect(answer(planned(ask(dead, "p1", "p2")))).toMatchObject({ value: true });
  });

  it("Recluse registration is the Storyteller's judgment -- asked only when it could change the answer", () => {
    expect(requirementIds(ask(g, "p4", "p2"))).toEqual([registersAsDemonJudgment(bind(g, "p4"))]);
    const judged = (value: boolean) =>
      plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, "p4", "p2") }, { judgments: { [registersAsDemonJudgment(bind(g, "p4"))]: yes(value) } }));
    expect(answer(planned(judged(true)))).toMatchObject({ value: true });
    expect(answer(planned(judged(false)))).toMatchObject({ value: false });
    expect(judged(true)).toMatchObject({ plan: { needsConfirmation: true } });
    // Already Yes from the actual Demon: no question.
    expect(answer(planned(ask(g, "p4", "p1")))).toMatchObject({ value: true });
  });

  it("a poisoned Fortune Teller: two choices recorded with either Boolean the Storyteller gives", () => {
    const poisoned = impair(g, "p0");
    expect(requirementIds(ask(poisoned, "p1", "p2"))).toEqual([comm(poisoned, "p1", "p2")]);
    for (const value of [true, false]) {
      const next = planned(ask(poisoned, "p1", "p2", { [COMMUNICATED]: yes(value) }));
      expect(answer(next)).toMatchObject({ value });
      expect(next.players).toBe(poisoned.players);
    }
  });

  it("stale target after seat reuse is refused", () => {
    expect(plan(reseat(g, "p2"), request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2") }))).toMatchObject({ ok: false, code: "stale" });
  });

  it("stale Red Herring choice after seat reuse is refused", () => {
    const n1 = proofGame(ROLES, "night", 1);
    const req = request(n1, "p0", "fortuneteller", { targets: pick(n1, "p1", "p2"), [RED_HERRING_CHOICE]: pick(n1, "p3") });
    expect(plan(reseat(n1, "p3"), req)).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Fortune Teller reusing the official id inherits no semantics", () => {
    expect(plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2") }), homebrewEnv("fortuneteller"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Fortune Teller -- privacy and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

  it("the Red Herring never reaches public or self projections", () => {
    const g = planned(ask(proofGame(ROLES, "night", 1), "p2", "p3", { [RED_HERRING_CHOICE]: pick(proofGame(ROLES, "night", 1), "p3") }));
    const wire = JSON.stringify([projectLobbyToPublic(g, {}), projectLobbyToSelfMap(g, proofRegistry)]);
    expect(wire).not.toContain(RED_HERRING);
    expect(wire).not.toContain("Red Herring");
  });

  it("one commit; Undo restores the game without the Red Herring and without the delivery record", () => {
    const g = proofGame(ROLES, "night", 1);
    openInStore(g);
    const result = store.getState().resolveAbility(request(g, "p0", "fortuneteller", { targets: pick(g, "p2", "p3"), [RED_HERRING_CHOICE]: pick(g, "p3") }));
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().localSeq).toBe(6);
    expect(store.getState().game!.players.p3!.effects).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().game!.players.p3!.effects).toEqual([]);
    expect(store.getState().game!.informationDeliveries).toEqual([]);
  });
});

describe("SOL-10F-S7-F2 -- the Red Herring is independent of the Fortune Teller functioning", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  const n1 = () => proofGame(ROLES, "night", 1);
  const herrings = (g: StorytellerLobbyRecord) => Object.values(g.players).flatMap((p) => p.effects.filter((e) => e.type === RED_HERRING).map(() => p.id));
  const domainsOf = (result: ReturnType<typeof plan>) => result.ok && result.changed ? result.plan.outcome.operations.map((o) => o.domain) : [];

  it("1. sober Night-1 Fortune Teller, fact missing -> creates the fact + delivers the computed answer", () => {
    const g = n1();
    const result = ask(g, "p2", "p6", { [RED_HERRING_CHOICE]: pick(g, "p3") });
    expect(domainsOf(result)).toEqual(["effect", "information"]);
    const next = planned(result);
    expect(herrings(next)).toEqual(["p3"]);
    expect(answer(next)).toMatchObject({ value: false }); // chef + empath, neither the Red Herring nor a Demon
  });

  it("2. POISONED Night-1 actual Fortune Teller, fact missing -> asks the Red Herring FIRST, creates it, then delivers an arbitrary answer", () => {
    for (const type of ["poisoned", "drunk"]) {
      const g = impair(n1(), "p0", type);
      expect(requirementIds(ask(g, "p1", "p2"))).toEqual([RED_HERRING_CHOICE]);
      expect(requirementIds(ask(g, "p1", "p2", { [RED_HERRING_CHOICE]: pick(g, "p3") }))).toEqual([comm(g, "p1", "p2")]);
      for (const value of [true, false]) {
        const result = ask(g, "p1", "p2", { [RED_HERRING_CHOICE]: pick(g, "p3"), [COMMUNICATED]: yes(value) });
        expect(domainsOf(result)).toEqual(["effect", "information"]);
        const next = planned(result);
        // 3. exactly one Red Herring afterwards, on the chosen participant, with no source.
        expect(herrings(next)).toEqual(["p3"]);
        expect(next.players.p3!.effects[0]).toMatchObject({ type: RED_HERRING, lifetime: { kind: "manual" } });
        expect(next.players.p3!.effects[0]!.sourceParticipant).toBeUndefined();
        expect(next.players.p3!.effects[0]!.sourceCharacter).toBeUndefined();
        expect(answer(next)).toMatchObject({ value }); // arbitrary, not computed (p1 is the actual Demon)
      }
      expect(ask(g, "p1", "p2", { [RED_HERRING_CHOICE]: pick(g, "p5"), [COMMUNICATED]: yes(true) })).toMatchObject({ ok: false, code: "illegal" }); // evil
    }
  });

  it("4. a later Night after an impaired Night 1 reuses the SAME participant (no reselection, no new fact)", () => {
    const night1 = planned(ask(impair(n1(), "p0"), "p1", "p2", { [RED_HERRING_CHOICE]: pick(n1(), "p3"), [COMMUNICATED]: yes(false) }));
    const night2 = { ...night1, day: 2, players: { ...night1.players, p0: { ...night1.players.p0!, effects: [] } } }; // sober now
    const result = ask(night2, "p3", "p2");
    expect(requirementIds(result)).toEqual([]);
    const next = planned(result);
    expect(answer(next)).toMatchObject({ value: true });
    expect(herrings(next)).toEqual(["p3"]);
    expect(next.players.p3!.effects[0]!.id).toBe(night1.players.p3!.effects[0]!.id);
    expect(domainsOf(result)).toEqual(["information"]);
  });

  it("5. a Drunk simulated as the Fortune Teller creates NO Red Herring, even on Night 1", () => {
    const g = patchPlayer(proofGame(["drunk", "imp", "chef", "monk", "recluse", "poisoner", "empath"], "night", 1), "p0",
      { shownRole: "fortuneteller", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
    expect(requirementIds(plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2") })))).toEqual([comm(g, "p1", "p2")]);
    const next = planned(plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2"), [comm(g, "p1", "p2")]: yes(true),
      [RED_HERRING_CHOICE]: pick(g, "p3") })));
    expect(herrings(next)).toEqual([]);
    expect(next.informationDeliveries).toEqual([expect.objectContaining({ actualRole: "drunk", performedRole: "fortuneteller" })]);
    // A crafted simulated outcome carrying the fact is refused by the coordinator.
    const smuggling: AbilitySemanticsRegistry = new Map([...CANONICAL_ABILITY_SEMANTICS, ["fortuneteller", { ...FORTUNE_TELLER, evaluator: (context) => ({ kind: "outcome", outcome: { operations: [
      { domain: "effect", intents: [{ kind: "apply", target: context.actor.binding, effect: { type: RED_HERRING, lifetime: { kind: "manual" } } }] },
    ] } }) }]]);
    expect(plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2") }), proofEnv({ semantics: smuggling }))).toMatchObject({ ok: false, code: "illegal" });
  });

  it("6. multiple Red Herring facts still fail safe -- functioning or impaired", () => {
    const two = herringOn(herringOn(n1(), "p3", "rh-1"), "p6", "rh-2");
    expect(ask(two, "p2", "p3")).toMatchObject({ ok: false, code: "unsupported" });
    expect(ask(impair(two, "p0"), "p2", "p3", { [COMMUNICATED]: yes(true) })).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("7. a Reminder labelled 'Red Herring' stays ignored for an impaired Fortune Teller too", () => {
    const g = impair(patchPlayer(n1(), "p3", { reminders: [{ id: "rm", label: "Red Herring", sourceCharacter: "fortuneteller" }] }), "p0");
    expect(requirementIds(ask(g, "p2", "p3", { [COMMUNICATED]: yes(true) }))).toEqual([RED_HERRING_CHOICE]);
  });

  describe("the generic non-functioning guard stays intact", () => {
    const g = impair(proofGame(["poisoner", "chef", "monk", "imp", "empath", "saint", "fortuneteller"], "night", 2), "p0");
    const withEvaluator = (base: AbilityDescriptor, operations: (b: { playerId: string; participantId: string }) => unknown[], over: Partial<AbilityDescriptor> = {}): AbilitySemanticsRegistry =>
      new Map([...CANONICAL_ABILITY_SEMANTICS, [base.roleId, { ...base, ...over, evaluator: (context) => ({ kind: "outcome", outcome: { operations: operations(context.actor.binding) as never } }) }]]);
    const poisoner = CANONICAL_ABILITY_SEMANTICS.get("poisoner")!;
    const target = () => ({ playerId: "p1", participantId: g.players.p1!.participantId! });
    const run = (semantics: AbilitySemanticsRegistry) => plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }), proofEnv({ semantics }));

    it("8. an impaired Poisoner / Monk still produces no ordinary Effect, Life, Role or Alignment state", () => {
      expect(run(new Map(CANONICAL_ABILITY_SEMANTICS))).toEqual({ ok: true, changed: false });
      const monkGame = impair(proofGame(["monk", "chef", "imp"], "night", 2), "p0");
      expect(plan(monkGame, request(monkGame, "p0", "monk", { target: pick(monkGame, "p1") }))).toEqual({ ok: true, changed: false });
      for (const op of [
        { domain: "effect", intents: [{ kind: "apply", target: target(), effect: { type: "poisoned", lifetime: { kind: "manual" } } }] },
        { domain: "life", intents: [{ kind: "death", target: target() }] },
        { domain: "role", intents: [{ kind: "changeActualRole", target: target(), expectedActualRole: "chef", expectedIsTraveler: false, actualRole: "monk" }] },
        { domain: "alignment", intents: [{ kind: "changeActualAlignment", target: target(), expectedActualAlignment: "good", expectedIsTraveler: false, actualAlignment: "evil" }] },
      ]) expect(run(withEvaluator(poisoner, () => [op])), op.domain).toMatchObject({ ok: false, code: "illegal" });
    });

    it("9. the exception admits ONLY descriptor-declared storytellerFact types, applied with no source", () => {
      const fact = (effect: Record<string, unknown>) => () => [{ domain: "effect", intents: [{ kind: "apply", target: target(), effect: { lifetime: { kind: "manual" }, ...effect } }] }];
      // Undeclared fact type -> refused.
      expect(run(withEvaluator(poisoner, fact({ type: RED_HERRING })))).toMatchObject({ ok: false, code: "illegal" });
      // Declared, but not a storytellerFact (an ordinary Effect) -> refused.
      expect(run(withEvaluator(poisoner, fact({ type: "poisoned" }), { independentFacts: ["poisoned"] }))).toMatchObject({ ok: false, code: "illegal" });
      // Declared custom type with no approved semantics -> refused.
      expect(run(withEvaluator(poisoner, fact({ type: "customFact" }), { independentFacts: ["customFact"] }))).toMatchObject({ ok: false, code: "illegal" });
      // Declared storytellerFact but WITH a source / source character -> refused.
      expect(run(withEvaluator(poisoner, fact({ type: RED_HERRING, sourceCharacter: "poisoner" }), { independentFacts: [RED_HERRING] }))).toMatchObject({ ok: false, code: "illegal" });
      expect(run(withEvaluator(poisoner, (b) => [{ domain: "effect", intents: [{ kind: "apply", target: target(), effect: { type: RED_HERRING, lifetime: { kind: "manual" }, source: b } }] }], { independentFacts: [RED_HERRING] })))
        .toMatchObject({ ok: false, code: "illegal" });
      // A declared fact bundled with an ordinary Effect in the same operation -> refused.
      expect(run(withEvaluator(poisoner, () => [{ domain: "effect", intents: [
        { kind: "apply", target: target(), effect: { type: RED_HERRING, lifetime: { kind: "manual" } } },
        { kind: "apply", target: target(), effect: { type: "poisoned", lifetime: { kind: "manual" } } },
      ] }], { independentFacts: [RED_HERRING] }))).toMatchObject({ ok: false, code: "illegal" });
      // Declared storytellerFact, no source -> admitted.
      expect(run(withEvaluator(poisoner, fact({ type: RED_HERRING }), { independentFacts: [RED_HERRING] }))).toMatchObject({ ok: true, changed: true });
    });
  });

  it("10. Undo removes the newly-created fact AND the delivery together (one commit)", () => {
    const g = impair(n1(), "p0");
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2"), [RED_HERRING_CHOICE]: pick(g, "p3"), [comm(g, "p1", "p2")]: yes(false) })))
      .toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(herrings(store.getState().game!)).toEqual(["p3"]);
    expect(store.getState().game!.informationDeliveries).toHaveLength(1);
    store.getState().undo();
    expect(herrings(store.getState().game!)).toEqual([]);
    expect(store.getState().game!.informationDeliveries).toEqual([]);
  });
});
