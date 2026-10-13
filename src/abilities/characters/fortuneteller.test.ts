// Phase 10F Slice 7 -- Fortune Teller + the authoritative Red Herring
// (matrix Section 7). Production semantics.
import { beforeEach, describe, expect, it } from "vitest";
import { withRedHerring } from "@/test/redHerringFixture";
import { COMMUNICATED, RED_HERRING, RED_HERRING_CHOICE, registersAsDemonJudgment } from "./fortuneteller";
import { subjectId } from "./shared";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofRegistry, request, requirementIds, reseat, yes } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { FORTUNE_TELLER } from "./fortuneteller";
import { proofEnv } from "@/test/proofFixtures";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 FT, p1 imp, p2 chef, p3 monk, p4 recluse, p5 poisoner, p6 empath
const ROLES = ["fortuneteller", "imp", "chef", "monk", "recluse", "poisoner", "empath"];
const herringOn = (g: StorytellerLobbyRecord, id: string, effectId = "rh-1") => withRedHerring(g, id, "p0", effectId);
const answer = (g: StorytellerLobbyRecord) => g.informationDeliveries.at(-1)!.values!.find((v) => v.requirementId === "isDemon");
/** SOL-10F-A1: the communicated answer is bound to the chosen pair. */
const comm = (g: StorytellerLobbyRecord, a: string, b: string) => subjectId(COMMUNICATED, bind(g, a), bind(g, b));
const pairBound = (g: StorytellerLobbyRecord, a: string, b: string, extra: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(extra).map(([key, value]) => [key === COMMUNICATED ? comm(g, a, b) : key, value]));
const ask = (g: StorytellerLobbyRecord, a: string, b: string, extra: Record<string, unknown> = {}) =>
  plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, a, b), ...pairBound(g, a, b, extra) } as never));

describe("Red Herring -- authoritative state", () => {
  it("Night 1 never invents a missing setup fact, even with legacy selection input", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(ask(g, "p2", "p3")).toMatchObject({ ok: false, code: "unsupported" });
    expect(ask(g, "p2", "p3", { [RED_HERRING_CHOICE]: pick(g, "p3") })).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.players.p3!.effects).toEqual([]);
  });

  it("the prepared Red Herring may be the Fortune Teller themself", () => {
    const g = herringOn(proofGame(ROLES, "night", 1), "p0");
    const next = planned(ask(g, "p0", "p2"));
    expect(answer(next)).toMatchObject({ value: true });
    expect(next.players).toBe(g.players);
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
    expect(ask(g, "p2", "p3")).toMatchObject({ ok: false, code: "unsupported" });
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

  it("uncertain Recluse registration requires communicated information; a decisive Demon remains known", () => {
    const before = JSON.stringify(g);
    expect(ask(g, "p4", "p2")).toMatchObject({ ok: false, code: "needsInput" });
    const judged = (value: boolean) =>
      plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, "p4", "p2") }, { judgments: { [registersAsDemonJudgment(bind(g, "p4"))]: yes(value) } }));
    expect(judged(true)).toMatchObject({ ok: false, code: "needsInput" });
    expect(judged(false)).toMatchObject({ ok: false, code: "needsInput" });
    for (const value of [false, true]) expect(answer(planned(ask(g, "p4", "p2", { [COMMUNICATED]: yes(value) })))).toMatchObject({ value });
    expect(JSON.stringify(g)).toBe(before);
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

  it("legacy Red Herring choice after seat reuse cannot create a fact during Night", () => {
    const n1 = proofGame(ROLES, "night", 1);
    const req = request(n1, "p0", "fortuneteller", { targets: pick(n1, "p1", "p2"), [RED_HERRING_CHOICE]: pick(n1, "p3") });
    expect(plan(reseat(n1, "p3"), req)).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a homebrew Fortune Teller reusing the official id inherits no semantics", () => {
    expect(plan(g, request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2") }), homebrewEnv("fortuneteller"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Fortune Teller -- privacy and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

  it("the Red Herring never reaches public or self projections", () => {
    const g = herringOn(proofGame(ROLES, "night", 1), "p3");
    const wire = JSON.stringify([projectLobbyToPublic(g, {}), projectLobbyToSelfMap(g, proofRegistry)]);
    expect(wire).not.toContain(RED_HERRING);
    expect(wire).not.toContain("Red Herring");
  });

  it("one information commit; Undo restores the setup fact and removes the delivery record", () => {
    const g = herringOn(proofGame(ROLES, "night", 1), "p3");
    openInStore(g);
    const result = store.getState().resolveAbility(request(g, "p0", "fortuneteller", { targets: pick(g, "p2", "p3"), [RED_HERRING_CHOICE]: pick(g, "p3") }));
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().localSeq).toBe(6);
    expect(store.getState().game!.players.p3!.effects).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().game!.players.p3!.effects).toEqual(g.players.p3!.effects);
    expect(store.getState().game!.informationDeliveries).toEqual([]);
  });
});

describe("SOL-10F-S7-F2 -- the Red Herring is independent of the Fortune Teller functioning", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  const n1 = () => proofGame(ROLES, "night", 1);
  const herrings = (g: StorytellerLobbyRecord) => Object.values(g.players).flatMap((p) => p.effects.filter((e) => e.type === RED_HERRING).map(() => p.id));
  const domainsOf = (result: ReturnType<typeof plan>) => result.ok && result.changed ? result.plan.outcome.operations.map((o) => o.domain) : [];

  it("1. healthy Night-1 Fortune Teller uses the prepared fact without creating another", () => {
    const g = herringOn(n1(), "p3");
    const result = ask(g, "p2", "p6");
    expect(domainsOf(result)).toEqual(["information"]);
    expect(herrings(planned(result))).toEqual(["p3"]);
  });

  it("2. impaired Fortune Teller cannot invent a fact; a prepared fact survives either communicated answer", () => {
    for (const type of ["poisoned", "drunk"]) {
      const missing = impair(n1(), "p0", type);
      expect(ask(missing, "p1", "p2", { [COMMUNICATED]: yes(false) })).toMatchObject({ ok: false, code: "unsupported" });
      const g = herringOn(missing, "p3");
      expect(requirementIds(ask(g, "p1", "p2"))).toEqual([comm(g, "p1", "p2")]);
      for (const value of [true, false]) {
        const result = ask(g, "p1", "p2", { [COMMUNICATED]: yes(value) });
        expect(domainsOf(result)).toEqual(["information"]);
        const next = planned(result);
        expect(next.players).toBe(g.players);
        expect(answer(next)).toMatchObject({ value });
      }
    }
  });

  it("4. later Night reuses the same setup participant after impairment ends", () => {
    const initial = herringOn(impair(n1(), "p0"), "p3");
    const night1 = planned(ask(initial, "p1", "p2", { [COMMUNICATED]: yes(false) }));
    const night2 = { ...night1, day: 2, players: { ...night1.players, p0: { ...night1.players.p0!, effects: [] } } };
    const result = ask(night2, "p3", "p2");
    const next = planned(result);
    expect(answer(next)).toMatchObject({ value: true });
    expect(next.players.p3!.effects).toEqual(initial.players.p3!.effects);
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
    expect(ask(g, "p2", "p3", { [COMMUNICATED]: yes(true) })).toMatchObject({ ok: false, code: "unsupported" });
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

  it("10. Undo removes impaired delivery while preserving the earlier setup fact", () => {
    const g = herringOn(impair(n1(), "p0"), "p3");
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p2"), [RED_HERRING_CHOICE]: pick(g, "p3"), [comm(g, "p1", "p2")]: yes(false) })))
      .toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(herrings(store.getState().game!)).toEqual(["p3"]);
    expect(store.getState().game!.informationDeliveries).toHaveLength(1);
    store.getState().undo();
    expect(herrings(store.getState().game!)).toEqual(["p3"]);
    expect(store.getState().game!.informationDeliveries).toEqual([]);
  });
});
