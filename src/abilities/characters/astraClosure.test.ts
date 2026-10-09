// Phase 10F -- SOL-10F-C1 / C2 (PHASE10F Section 39): permanent regressions
// for Astra's closure re-verification counterexamples and their cross-seam
// cases. Each `describe` names its finding; Astra's reproduction is the first
// case. (C3's store / installed-SDK proof lives in
// src/firebase/abilityCommitCompatibility.sdk.test.ts.)
import { beforeEach, describe, expect, it } from "vitest";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilityEvaluationContext, type AbilityInputValue, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { abilityInputValueError, planAbilityResolution, type AbilityEnvironment } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import {
  bind, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofQuery, protectionId, request, requirementIds, reseat,
} from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { attemptScope, choiceId } from "./alhadikhia";
import { protectionJudgmentId } from "./shared";
import { evaluateFixture } from "@/test/evaluatorFixture";

type Fx = StorytellerLobbyRecord["players"][string]["effects"][number];
const fx = (id: string, type: string, extra: Partial<Fx> = {}): Fx =>
  ({ id, type, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 }, ...extra } as Fx);
const sourced = (g: StorytellerLobbyRecord, id: string, type: string, sourceId: string, sourceCharacter: string): Fx => fx(id, type, {
  sourceCharacter, lifetime: { kind: "untilDawn" },
  sourceParticipant: { kind: "participant", participantId: g.players[sourceId]!.participantId!, playerId: sourceId, nameAtTime: g.players[sourceId]!.name },
} as Partial<Fx>);
const Y = { kind: "boolean", value: true } as const, N = { kind: "boolean", value: false } as const;
const onlyAsked = (result: ReturnType<typeof plan>): string => {
  const asked = requirementIds(result);
  expect(asked).toHaveLength(1);
  return asked[0]!;
};
const lifeIntents = (result: ReturnType<typeof plan>) => result.ok && result.changed
  ? result.plan.outcome.operations.flatMap((o) => (o.domain === "life" ? o.intents.map((i) => `${i.kind}:${i.target.playerId}`) : [])) : [];
/** [scope token | undefined, ParticipantId, dependency stamp] of a protection judgment id. */
const idParts = (id: string): [string | undefined, string, string] => {
  const scoped = id.match(/^protection:(?:demon|any)@(.*)$/);
  if (scoped) return JSON.parse(scoped[1]!) as [string, string, string];
  const [participantId, stamp] = JSON.parse(id.replace(/^protection:(?:demon|any):/, "")) as [string, string];
  return [undefined, participantId, stamp];
};

// ---------------------------------------------------------------------------
// SOL-10F-C1 -- deep inert answer snapshots
// ---------------------------------------------------------------------------

describe("SOL-10F-C1 -- every answer is an inert DEEP snapshot; validation and consumption share it", () => {
  /** p0 = an Imp whose functioning is UNKNOWN (Sober & healthy) -> the coordinator asks actor:functioning. */
  const uncertainImp = () => patchPlayer(proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]), "p0", { effects: [fx("sh", "soberHealthy")] });
  const attack = (g: StorytellerLobbyRecord, judgments: unknown, inputs: unknown = { target: pick(g, "p1") }, env?: AbilityEnvironment) =>
    plan(g, request(g, "p0", "imp", inputs as Record<string, never>, { judgments: judgments as Record<string, never> }), env);
  const chefKilled = (result: ReturnType<typeof plan>) => result.ok && result.changed && result.plan.game.players.p1!.alive === false;
  /** `{ kind: "boolean" }` whose `value` is an accessor returning `first`, then `later`. */
  const flipping = (first: unknown, later: unknown, reads = { n: 0 }) => {
    const answer: Record<string, unknown> = { kind: "boolean" };
    Object.defineProperty(answer, "value", { enumerable: true, get: () => (++reads.n === 1 ? first : later) });
    return answer;
  };

  it("Astra's reproduction: a nested Boolean getter (false, then true) never kills -- the accessor shape is refused unread", () => {
    const g = uncertainImp();
    const reads = { n: 0 };
    const result = attack(g, { "actor:functioning": flipping(false, true, reads) });
    expect(result).toMatchObject({ ok: false, code: "invalid", message: expect.stringContaining("actor:functioning") });
    expect(chefKilled(result)).toBe(false);
    expect(reads.n).toBe(0); // the source getter is never executed, so it cannot answer twice
  });

  it("false, then \"no\": refused invalid, nobody dies", () => {
    const g = uncertainImp();
    const reads = { n: 0 };
    expect(attack(g, { "actor:functioning": flipping(false, "no", reads) })).toMatchObject({ ok: false, code: "invalid" });
    expect(reads.n).toBe(0);
  });

  it("a getter that throws on its second read: structured invalid, never executed, never thrown out", () => {
    const g = uncertainImp();
    const reads = { n: 0 };
    const answer: Record<string, unknown> = { kind: "boolean" };
    Object.defineProperty(answer, "value", { enumerable: true, get: () => { if (++reads.n > 1) throw new Error("second read"); return false; } });
    expect(() => attack(g, { "actor:functioning": answer })).not.toThrow();
    expect(attack(g, { "actor:functioning": answer })).toMatchObject({ ok: false, code: "invalid" });
    expect(reads.n).toBe(0);
  });

  it("a nested Proxy whose `get` trap flips false -> true: the canonical false is consumed and the trap never runs", () => {
    const g = uncertainImp();
    let gets = 0;
    const answer = new Proxy({ kind: "boolean", value: false }, { get: (target, key) => (key === "value" ? ++gets > 1 : Reflect.get(target, key)) });
    expect(attack(g, { "actor:functioning": answer })).toMatchObject({ ok: false, code: "unsupported" }); // uncertainty stays wholly Manual
    expect(gets).toBe(0);
  });

  it("a nested Proxy whose traps throw (or report an accessor) is a structured invalid", () => {
    const g = uncertainImp();
    for (const handler of [
      { ownKeys: () => { throw new Error("ownKeys"); } },
      { getOwnPropertyDescriptor: () => { throw new Error("descriptor"); } },
      { getOwnPropertyDescriptor: (target: object, key: string | symbol) => (key === "value"
        ? { configurable: true, enumerable: true, get: () => true } : Reflect.getOwnPropertyDescriptor(target, key)) },
    ] as ProxyHandler<object>[]) {
      expect(attack(g, { "actor:functioning": new Proxy({ kind: "boolean", value: false }, handler) })).toMatchObject({ ok: false, code: "invalid" });
    }
    const { proxy, revoke } = Proxy.revocable({ kind: "boolean", value: false }, {});
    revoke();
    expect(attack(g, { "actor:functioning": proxy })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("a ParticipantBinding whose participantId is getter-backed is invalid (never consumed as a target)", () => {
    const g = proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]);
    let reads = 0;
    const binding: Record<string, unknown> = { playerId: "p1" };
    Object.defineProperty(binding, "participantId", { enumerable: true, get: () => (++reads === 1 ? g.players.p1!.participantId : g.players.p2!.participantId) });
    const result = attack(g, {}, { target: { kind: "participant", participants: [binding] } });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(reads).toBe(0);
  });

  it("a roleIds array with a getter-backed element is invalid; so are holes, extra array fields and non-enumerable elements", () => {
    const g = proofGame(["empath", "imp", "chef", "monk", "saint", "drunk", "poisoner"]);
    let reads = 0;
    const roleIds = ["chef"];
    Object.defineProperty(roleIds, 0, { enumerable: true, configurable: true, get: () => (++reads === 1 ? "chef" : "") });
    const holey = ["chef", , "monk"]; // eslint-disable-line no-sparse-arrays
    const extra = Object.assign(["chef"], { note: "x" });
    const hidden = ["chef"];
    Object.defineProperty(hidden, 0, { enumerable: false });
    for (const ids of [roleIds, holey, extra, hidden]) {
      const value = { kind: "character", roleIds: ids };
      expect(abilityInputValueError(value)).not.toBeNull();
      expect(plan(g, request(g, "p0", "empath", { anything: value as never }))).toMatchObject({ ok: false, code: "invalid" });
      expect(plan(g, request(g, "p0", "empath", {}, { judgments: { anything: value as never } }))).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(reads).toBe(0);
  });

  it("a getter-backed participants array / kind field is invalid", () => {
    const g = proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]);
    const viaArray: Record<string, unknown> = { kind: "participant" };
    Object.defineProperty(viaArray, "participants", { enumerable: true, get: () => [bind(g, "p1")] });
    const viaKind: Record<string, unknown> = { participants: [bind(g, "p1")] };
    Object.defineProperty(viaKind, "kind", { enumerable: true, get: () => "participant" });
    for (const target of [viaArray, viaKind]) expect(attack(g, {}, { target })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("source mutation AFTER canonicalization (mid-planning) cannot change the consumed answers", () => {
    const g = uncertainImp();
    // The functioning judgment is a plain own false; a hook that runs after the
    // answers are snapshotted (the environment's modifier list is read when the
    // Rules Query is built) flips it to true and retargets the Imp's choice.
    const judged = { kind: "boolean" as const, value: false };
    const chosen = { kind: "participant" as const, participants: [{ ...bind(g, "p1") }] };
    let hooked = false;
    const env = proofEnv();
    Object.defineProperty(env, "modifiers", { enumerable: true, get: () => {
      hooked = true;
      (judged as { value: boolean }).value = true;
      chosen.participants[0] = bind(g, "p2");
      return undefined;
    } });
    expect(attack(g, { "actor:functioning": judged }, { target: chosen }, env)).toMatchObject({ ok: false, code: "unsupported" });
    expect(hooked).toBe(true);

    // Functioning known: the mutated target is never the consumed one either.
    const healthy = proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]);
    const target = { kind: "participant" as const, participants: [{ ...bind(healthy, "p1") }] };
    const env2 = proofEnv();
    Object.defineProperty(env2, "modifiers", { enumerable: true, get: () => { target.participants[0]!.participantId = healthy.players.p2!.participantId!; target.participants[0]!.playerId = "p2"; return undefined; } });
    const next = planned(attack(healthy, {}, { target }, env2));
    expect([next.players.p1!.alive, next.players.p2!.alive]).toEqual([false, true]);
  });

  it("a later top-level getter mutating an EARLIER answer's nested object cannot change the earlier snapshot", () => {
    const g = proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]);
    const target = { kind: "participant" as const, participants: [{ ...bind(g, "p1") }] };
    const inputs: Record<string, unknown> = { target };
    const judgments: Record<string, unknown> = {};
    // inputs are snapshotted before judgments are read.
    Object.defineProperty(judgments, "unrelated", { enumerable: true, get: () => { target.participants[0] = bind(g, "p2"); return { kind: "text", value: "x" }; } });
    const next = planned(attack(g, judgments, inputs));
    expect([next.players.p1!.alive, next.players.p2!.alive]).toEqual([false, true]);
  });

  it("own valid ordinary objects, null-prototype maps and null-prototype nested values still work; inherited answers stay absent", () => {
    const g = proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]);
    expect(planned(attack(g, { "actor:functioning": { kind: "boolean", value: true } })).players.p1!.alive).toBe(false);
    const nullProtoMap = Object.assign(Object.create(null), { "actor:functioning": Object.assign(Object.create(null), { kind: "boolean", value: true }) });
    const nullProtoInputs = Object.assign(Object.create(null), { target: Object.assign(Object.create(null), {
      kind: "participant", participants: [Object.assign(Object.create(null), bind(g, "p1"))] }) });
    expect(planned(attack(g, nullProtoMap, nullProtoInputs)).players.p1!.alive).toBe(false);
    expect(attack(uncertainImp(), Object.create({ "actor:functioning": { kind: "boolean", value: true } }))).toMatchObject({ ok: false, code: "unsupported" });
    // Extra (non-payload) fields on a binding are not part of the canonical copy.
    expect(planned(attack(g, { "actor:functioning": Y }, { target: { kind: "participant", participants: [{ ...bind(g, "p1"), note: "x" }] } })).players.p1!.alive).toBe(false);
  });

  describe("proof: the evaluator receives only inert canonical data, and no source object is ever touched after canonicalization", () => {
    let captured: AbilityEvaluationContext | null = null;
    // RULES-NEUTRAL capture descriptor keyed to a canonical RoleId (like
    // src/test/abilityFixtures.ts): encodes no BOTC ruling.
    const CAPTURE: AbilityDescriptor = {
      roleId: "monk", timing: ["otherNight"], invocation: "wake", usage: { kind: "unlimited" },
      inputs: [{ id: "target", kind: "participant", source: "player", label: "the player" }],
      hooks: ["targeting"], presentation: { complexity: "simple", action: "Choose a player" },
      evaluator: (context) => { captured = context; return { kind: "outcome", outcome: { operations: [] } }; },
    };
    const semantics: AbilitySemanticsRegistry = new Map([...CANONICAL_ABILITY_SEMANTICS, ["monk", CAPTURE]]);
    const g = () => proofGame(["monk", "chef", "imp", "empath", "saint", "poisoner", "washerwoman"]);
    const answers = (game: StorytellerLobbyRecord): Record<string, AbilityInputValue> => ({
      target: { kind: "participant", participants: [bind(game, "p1")] },
      roles: { kind: "character", roleIds: ["chef", "imp"] },
      side: { kind: "alignment", alignment: "evil" },
      count: { kind: "number", value: 0 },
      flag: { kind: "boolean", value: false },
      words: { kind: "text", value: "" },
    });
    beforeEach(() => { captured = null; });

    it("every canonical map, value, array and binding is fresh, frozen and equal to the validated data", () => {
      const game = g();
      const inputs = answers(game);
      const judgments = { judged: { kind: "boolean", value: true } as AbilityInputValue };
      expect(planAbilityResolution(game, request(game, "p0", "monk", inputs, { judgments }), proofEnv({ semantics }))).toEqual({ ok: true, changed: false });
      const context = captured!;
      for (const [map, source] of [[context.inputs, inputs], [context.judgments, judgments]] as const) {
        expect(Object.getPrototypeOf(map)).toBeNull();
        expect(Object.isFrozen(map)).toBe(true);
        expect({ ...map }).toEqual(source);
        for (const [id, value] of Object.entries(map)) {
          expect(value).not.toBe((source as Record<string, unknown>)[id]);
          expect(Object.isFrozen(value)).toBe(true);
        }
      }
      const target = context.inputs.target as Extract<AbilityInputValue, { kind: "participant" }>;
      expect(target.participants).not.toBe((inputs.target as typeof target).participants);
      expect(target.participants[0]).not.toBe((inputs.target as typeof target).participants[0]);
      expect(Object.isFrozen(target.participants) && Object.isFrozen(target.participants[0])).toBe(true);
      const roles = context.inputs.roles as Extract<AbilityInputValue, { kind: "character" }>;
      expect(roles.roleIds).not.toBe((inputs.roles as typeof roles).roleIds);
      expect(Object.isFrozen(roles.roleIds)).toBe(true);
      // A later caller mutation never reaches what was consumed.
      (inputs.target as typeof target).participants[0]!.participantId = "changed";
      (inputs.flag as { value: boolean }).value = true;
      expect(target.participants[0]!.participantId).toBe(bind(game, "p1").participantId);
      expect((context.inputs.flag as { value: boolean }).value).toBe(false);
    });

    it("traced Proxies at EVERY level (map, answer, array, binding): zero trap calls once consumption starts", () => {
      const game = g();
      const log: string[] = [];
      let phase = "canonicalize";
      const wrapped = new WeakMap<object, object>();
      const trace = <T,>(value: T): T => {
        if (!value || typeof value !== "object") return value;
        if (wrapped.has(value)) return wrapped.get(value) as T;
        const proxy = new Proxy(value as object, {
          get: (target, key, receiver) => { log.push(`${phase}:get:${String(key)}`); return trace(Reflect.get(target, key, receiver)); },
          has: (target, key) => { log.push(`${phase}:has:${String(key)}`); return Reflect.has(target, key); },
          ownKeys: (target) => { log.push(`${phase}:ownKeys`); return Reflect.ownKeys(target); },
          getPrototypeOf: (target) => { log.push(`${phase}:proto`); return Reflect.getPrototypeOf(target); },
          getOwnPropertyDescriptor: (target, key) => {
            log.push(`${phase}:descriptor:${String(key)}`);
            const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
            return descriptor && "value" in descriptor && descriptor.configurable ? { ...descriptor, value: trace(descriptor.value) } : descriptor;
          },
        });
        wrapped.set(value, proxy);
        return proxy as T;
      };
      const env = proofEnv({ semantics });
      Object.defineProperty(env, "modifiers", { enumerable: true, get: () => { phase = "consume"; return undefined; } });
      const result = planAbilityResolution(game, request(game, "p0", "monk", trace(answers(game)), { judgments: trace({ judged: Y }) }), env);
      expect(result).toEqual({ ok: true, changed: false });
      expect(captured).not.toBeNull();
      expect(log.some((entry) => entry.startsWith("canonicalize:descriptor:participantId"))).toBe(true); // the nested binding was copied
      expect(log.filter((entry) => !entry.startsWith("canonicalize:"))).toEqual([]);
      expect(log.filter((entry) => /:get:(value|participants|participantId|playerId|roleIds|alignment|kind)$/.test(entry))).toEqual([]); // nested values via descriptors only
    });
  });
});

// ---------------------------------------------------------------------------
// SOL-10F-C2 -- unknown protection judgments carry the dependency stamp
// ---------------------------------------------------------------------------

describe("SOL-10F-C2 -- low-level evaluator protection-dependency stamps (uncertain gameplay remains Manual)", () => {
  const plan = evaluateFixture;
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  const ROLES = ["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]; // p1 Chef, p2 Monk
  /** Astra's state: the Chef holds a generic Protected AND the Monk's Safe from
   * the Demon; the Monk is DEAD (so their protection is known inactive) and
   * Sober & healthy (so once alive, their functioning is unknown). */
  function astra(): StorytellerLobbyRecord {
    let g = patchPlayer(proofGame(ROLES), "p2", { alive: false, effects: [fx("sh", "soberHealthy")] });
    g = patchPlayer(g, "p1", { effects: [fx("gp", "protected"), sourced(g, "safe", "safeFromDemon", "p2", "monk")] });
    return g;
  }
  /** The Imp's kill of the Chef, built from the workflow opened on `opened` and planned against `now`. */
  const kill = (opened: StorytellerLobbyRecord, now = opened, judgments: Record<string, AbilityInputValue> = {}) =>
    plan(now, request(opened, "p0", "imp", { target: pick(opened, "p1") }, { judgments }));

  it("Astra's reproduction (unscoped Imp attempt): after the Monk is resurrected through the Life seam, the Chef's requirement id changes and the old judgment settles nothing", () => {
    const g = astra();
    openInStore(g);
    const before = onlyAsked(kill(g));
    expect(before).toBe(protectionId(g, "demon", "p1"));
    expect(planned(kill(g, g, { [before]: N })).players.p1!.alive).toBe(false); // the answer the Storyteller gave with the Monk dead
    // While the workflow stays open, the Monk is resurrected through the REAL Life seam.
    expect(store.getState().resurrect("p2")).toMatchObject({ ok: true, changed: true });
    const now = store.getState().game!;
    const after = kill(g, now, { [before]: N });
    expect(after).toMatchObject({ ok: false, code: "needsInput" });
    const fresh = onlyAsked(after);
    expect(fresh).not.toBe(before);
    expect(fresh).toBe(protectionId(now, "demon", "p1"));
    expect(idParts(fresh)[1]).toBe(idParts(before)[1]);
    // The store refuses the stale judgment too: nothing committed.
    const [game, undo, seq] = [store.getState().game, store.getState().undoStack.length, store.getState().localSeq];
    expect(store.getState().resolveAbility(request(g, "p0", "imp", { target: pick(g, "p1") }, { judgments: { [before]: N } }))).toMatchObject({ ok: false, code: "unsupported" });
    expect([store.getState().game, store.getState().undoStack.length, store.getState().localSeq]).toEqual([game, undo, seq]);
    // Even a fresh judgment cannot authorize automation. The Storyteller's
    // explicit manual outcome still uses the existing atomic domain seam.
    expect(store.getState().resolveAbility(request(g, "p0", "imp", { target: pick(g, "p1") }, { judgments: { [fresh]: N } }))).toMatchObject({ ok: false, code: "unsupported" });
    const adjudicated = kill(g, now, { [fresh]: N });
    if (!adjudicated.ok || !adjudicated.changed) throw new Error("Expected evaluator outcome");
    expect(store.getState().resolveAbility({ mode: "manual", reason: "Storyteller adjudication", outcome: adjudicated.plan.outcome })).toMatchObject({ ok: true, changed: true });
    expect(store.getState().game!.players.p1!.alive).toBe(false);
    expect(store.getState().undoStack).toHaveLength(undo + 1);
  });

  describe("Astra's reproduction (scoped Al-Hadikhia attempt) -- an unselected Monk changes outside the attempt prefix", () => {
    const AL = ["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
    const order = ["p1", "p3", "p4"]; // Chef, Empath, Saint -- the Monk (p2) is NOT chosen
    function alState(): StorytellerLobbyRecord {
      let g = patchPlayer(proofGame(AL), "p2", { alive: false, effects: [fx("sh", "soberHealthy")] });
      g = patchPlayer(g, "p1", { effects: [fx("gp", "protected"), sourced(g, "safe", "safeFromDemon", "p2", "monk")] });
      return g;
    }
    const alRequest = (opened: StorytellerLobbyRecord, picks: boolean[], judgments: Record<string, AbilityInputValue> = {}) =>
      request(opened, "p0", "alhadikhia", { chosen: pick(opened, ...order),
        ...Object.fromEntries(picks.map((value, index) => [choiceId(index, bind(opened, order[index]!)), { kind: "boolean", value }])) }, { judgments });

    it("the B2 scope token is identical, but the dependency stamp differs -- a NEW judgment is required; strict 1 -> 2 -> 3; one commit", () => {
      const g = alState();
      openInStore(g);
      const initial = onlyAsked(plan(g, alRequest(g, [false])));
      expect(initial).toBe(protectionId(g, "demon", "p1", attemptScope("initial", 0, order.map((id) => bind(g, id)), [false], [], [true, true, true])));
      // Answered "not protected": the Chef dies; the others live -> not all alive -> done.
      expect(lifeIntents(plan(g, alRequest(g, [false, true, true], { [initial]: N })))).toEqual(["death:p1"]);
      expect(store.getState().resurrect("p2")).toMatchObject({ ok: true, changed: true });
      const now = store.getState().game!;
      const after = plan(now, alRequest(g, [false, true, true], { [initial]: N }));
      const fresh = onlyAsked(after); // still the Chef's position-1 consequence: nothing later is asked first
      expect(fresh).not.toBe(initial);
      const [scopeBefore, whoBefore, stampBefore] = idParts(initial);
      const [scopeAfter, whoAfter, stampAfter] = idParts(fresh);
      expect([scopeAfter, whoAfter]).toEqual([scopeBefore, whoBefore]); // the attempt prefix alone could not tell
      expect(stampAfter).not.toBe(stampBefore);
      const undo = store.getState().undoStack.length;
      expect(store.getState().resolveAbility(alRequest(g, [false, true, true], { [initial]: N }))).toMatchObject({ ok: false, code: "unsupported" });
      expect(store.getState().undoStack).toHaveLength(undo);
      // Judged protected: the Chef counts as alive -> all three alive -> the FINAL attempts (a separate judgment).
      const final = onlyAsked(plan(now, alRequest(g, [false, true, true], { [initial]: N, [fresh]: Y })));
      expect(JSON.parse(idParts(final)[0]!)[0]).toBe("final");
      expect(store.getState().resolveAbility(alRequest(g, [false, true, true], { [fresh]: N }))).toMatchObject({ ok: false, code: "unsupported" });
      const adjudicated = plan(now, alRequest(g, [false, true, true], { [fresh]: N }));
      if (!adjudicated.ok || !adjudicated.changed) throw new Error("Expected evaluator outcome");
      expect(store.getState().resolveAbility({ mode: "manual", reason: "Storyteller adjudication", outcome: adjudicated.plan.outcome })).toMatchObject({ ok: true, changed: true });
      expect(store.getState().undoStack).toHaveLength(undo + 1);
      expect(store.getState().game!.players.p1!.alive).toBe(false);
    });

    it("the evolving hypothetical Life state is reflected: a later attempt's stamp is the assumingAlive overlay's stamp", () => {
      // p1 Chef unprotected (dies, known); p3 Empath holds a generic Protected -> asked at position 2,
      // against the hypothetical state in which the Chef already died.
      let g = proofGame(AL);
      g = patchPlayer(g, "p3", { effects: [fx("gp3", "protected")] });
      const chosen = order.map((id) => bind(g, id));
      const asked = onlyAsked(plan(g, alRequest(g, [false, false])));
      const scope = attemptScope("initial", 1, chosen, [false, false], [{ kind: "death", target: bind(g, "p1") }], [false, true, true]);
      expect(asked).toBe(protectionId(g, "demon", "p3", scope, proofQuery(g).assumingAlive(bind(g, "p1"), false)));
      expect(asked).not.toBe(protectionId(g, "demon", "p3", scope)); // not the Current State stamp
      expect(lifeIntents(plan(g, alRequest(g, [false, false, true], { [asked]: N })))).toEqual(["death:p1", "death:p3"]);
    });

    it("B2 is preserved: initial and final attempts on one player stay separate judgments", () => {
      let g = proofGame(AL);
      g = patchPlayer(g, "p1", { effects: [fx("gp", "protected")] });
      const initial = onlyAsked(plan(g, alRequest(g, [false])));
      const final = onlyAsked(plan(g, alRequest(g, [false, true, true], { [initial]: Y })));
      expect(final).not.toBe(initial);
      expect(idParts(final)[0]).not.toBe(idParts(initial)[0]);
      expect(requirementIds(plan(g, alRequest(g, [false, true, true], { [initial]: Y })))).toEqual([final]);
    });
  });

  describe("the stamp tracks every authoritative change that can affect protection (real store seams)", () => {
    /** Base: the Chef holds a generic Protected + the Monk's Safe from the Demon;
     * the Monk is alive and Sober & healthy -> Chef protection UNKNOWN. */
    function base(): StorytellerLobbyRecord {
      let g = patchPlayer(proofGame(ROLES), "p2", { effects: [fx("sh", "soberHealthy")] });
      g = patchPlayer(g, "p1", { effects: [fx("gp", "protected"), sourced(g, "safe", "safeFromDemon", "p2", "monk")] });
      return g;
    }
    const stamp = (g: StorytellerLobbyRecord) => proofQuery(g).protectionDependencyStamp(bind(g, "p1"), "demon");
    const asked = (g: StorytellerLobbyRecord, now: StorytellerLobbyRecord) => onlyAsked(kill(g, now));
    /** `mutate` (through a real store command) must change the stamp; the old
     * judgment then settles nothing: protection is either still unknown (a NEW
     * id is asked) or has become KNOWN (recomputed directly, judgment ignored). */
    const changed = (label: string, mutate: () => unknown, becomes: "unknown" | "knownProtected" = "unknown") => {
      const g = base();
      openInStore(g);
      const before = asked(g, g);
      mutate();
      const now = store.getState().game!;
      expect(stamp(now), label).not.toBe(stamp(g));
      const after = kill(g, now, { [before]: N });
      if (becomes === "knownProtected") {
        expect(proofQuery(now).protectedFrom(bind(now, "p1"), "demon"), label).toEqual({ known: true, value: true });
        expect(after, label).toEqual({ ok: true, changed: false }); // the old "not protected" answer is ignored
      } else {
        expect(after, label).toMatchObject({ ok: false, code: "needsInput" });
        expect(onlyAsked(after), label).not.toBe(before);
      }
      return now;
    };
    const effectIntent = (kind: "suppress" | "resume" | "remove", id: string, effectId: string) => {
      const g = store.getState().game!;
      return store.getState().resolveEffects({ intents: [{ kind, target: bind(g, id), effectId }] });
    };

    it("source death and resurrection", () => {
      changed("death", () => expect(store.getState().recordDeath("p2")).toMatchObject({ ok: true, changed: true }));
      const dead = patchPlayer(base(), "p2", { alive: false });
      openInStore(dead);
      const before = asked(dead, dead);
      expect(store.getState().resurrect("p2")).toMatchObject({ ok: true, changed: true });
      expect(onlyAsked(kill(dead, store.getState().game!, { [before]: N }))).not.toBe(before);
    });

    it("source Role change", () => {
      changed("role", () => expect(store.getState().assignRole("p2", "empath")).toMatchObject({ ok: true, changed: true }));
    });

    it("impairment Effect applied to / removed from the source", () => {
      const poisoned = changed("apply", () => expect(store.getState().resolveEffects({ intents: [{ kind: "apply", target: bind(store.getState().game!, "p2"),
        effect: { type: "poisoned", lifetime: { kind: "manual" } } }] })).toMatchObject({ ok: true, changed: true }));
      const fxId = poisoned.players.p2!.effects.find((effect) => effect.type === "poisoned")!.id;
      const withPoison = stamp(poisoned);
      expect(effectIntent("remove", "p2", fxId)).toMatchObject({ ok: true, changed: true });
      expect(stamp(store.getState().game!)).not.toBe(withPoison);
      expect(stamp(store.getState().game!)).toBe(stamp(base())); // a function of state, never of history
    });

    it("protection Effect suppressed / resumed; impairment suppressed", () => {
      const suppressed = changed("suppress", () => expect(effectIntent("suppress", "p1", "safe")).toMatchObject({ ok: true, changed: true }));
      expect(effectIntent("resume", "p1", "safe")).toMatchObject({ ok: true, changed: true });
      expect(stamp(store.getState().game!)).not.toBe(stamp(suppressed));
      changed("suppress source effect", () => expect(effectIntent("suppress", "p2", "sh")).toMatchObject({ ok: true, changed: true }), "knownProtected");
    });

    it("protection Effect added / removed on the target", () => {
      changed("add", () => expect(store.getState().resolveEffects({ intents: [{ kind: "apply", target: bind(store.getState().game!, "p1"),
        effect: { type: "cannotDie", lifetime: { kind: "manual" } } }] })).toMatchObject({ ok: true, changed: true }), "knownProtected");
      changed("remove", () => expect(effectIntent("remove", "p1", "safe")).toMatchObject({ ok: true, changed: true }));
    });

    it("participant replacement / departure of the source", () => {
      const g = base();
      for (const now of [reseat(g, "p2"), patchPlayer(g, "p2", { isEmpty: true })]) {
        expect(stamp(now)).not.toBe(stamp(g));
        expect(onlyAsked(kill(g, now, { [asked(g, g)]: N }))).not.toBe(asked(g, g));
      }
    });

    it("unrelated non-mechanical changes (names, Storyteller notes, Reminders) leave the stamp -- and the judgment -- intact", () => {
      const g = base();
      openInStore(g);
      const before = asked(g, g);
      store.getState().renamePlayer("p2", "Brother Bob");
      expect(store.getState().resolveReminders({ intents: [{ kind: "place", target: bind(g, "p2"), reminder: { label: "Is the Monk" } }] })).toMatchObject({ ok: true, changed: true });
      const now = { ...store.getState().game!, notes: "Monk might be drunk" };
      expect(now.players.p2!.name).toBe("Brother Bob");
      expect(now.players.p2!.reminders.length).toBeGreaterThan(0);
      expect(stamp(now)).toBe(stamp(g));
      expect(planned(kill(g, now, { [before]: N })).players.p1!.alive).toBe(false);
    });

    it("assumingAlive overlays change the stamp exactly where they change alive state", () => {
      const g = base();
      const query = proofQuery(g);
      const s0 = query.protectionDependencyStamp(bind(g, "p1"), "demon");
      expect(query.assumingAlive(bind(g, "p2"), false).protectionDependencyStamp(bind(g, "p1"), "demon")).not.toBe(s0);
      expect(query.assumingAlive(bind(g, "p2"), true).protectionDependencyStamp(bind(g, "p1"), "demon")).toBe(s0);
      expect(query.assumingAlive({ playerId: "p2", participantId: "stale" }, false).protectionDependencyStamp(bind(g, "p1"), "demon")).toBe(s0);
      // Deterministic: a fresh query over an equal state (any record key order) gives the same stamp.
      const reordered = { ...g, players: Object.fromEntries(Object.entries(g.players).reverse()) };
      expect(proofQuery(reordered).protectionDependencyStamp(bind(g, "p1"), "demon")).toBe(s0);
    });

    it("the source character's persistence declaration (environment) is part of the stamp", () => {
      const g = base();
      const custom: AbilitySemanticsRegistry = new Map([...CANONICAL_ABILITY_SEMANTICS,
        ["monk", { ...CANONICAL_ABILITY_SEMANTICS.get("monk")!, sourcedEffects: [{ type: "safeFromDemon", persistence: "independent" as const }] }]]);
      const env = { registry: proofEnv().registry, script: proofEnv().script, semantics: custom };
      expect(createStamp(g, env)).not.toBe(stamp(g));
    });
  });

  it("known protection is recomputed directly and ignores any Storyteller judgment", () => {
    // Functioning Monk alive: Safe from the Demon is KNOWN to apply -> survives, whatever is answered.
    let g = proofGame(ROLES);
    g = patchPlayer(g, "p1", { effects: [sourced(g, "safe", "safeFromDemon", "p2", "monk")] });
    const crafted = Object.fromEntries([protectionId(g, "demon", "p1"), protectionJudgmentId("demon", bind(g, "p1"), "anything")].map((id) => [id, N]));
    expect(kill(g, g, crafted)).toEqual({ ok: true, changed: false });
    // Monk dead, no other protection: KNOWN unprotected -> dies, whatever is answered.
    const dead = patchPlayer(g, "p2", { alive: false });
    expect(planned(kill(dead, dead, Object.fromEntries([protectionId(dead, "demon", "p1")].map((id) => [id, Y])))).players.p1!.alive).toBe(false);
  });

  it("Harlot's hypothetical actor death has a distinct protection stamp", () => {
    // This checks query identity only; harlot.test.ts covers authoritative refusal.
    const g = patchPlayer(proofGame(["harlot", "chef", "imp", "monk", "empath", "saint", "poisoner"]), "p1", { effects: [fx("gp", "protected")] });
    const hypothetical = protectionId(g, "any", "p1", undefined, proofQuery(g).assumingAlive(bind(g, "p0"), false));
    expect(hypothetical).not.toBe(protectionId(g, "any", "p1"));
  });
});

function createStamp(g: StorytellerLobbyRecord, env: Pick<AbilityEnvironment, "registry" | "script" | "semantics">): string {
  return createRulesQuery(g, { registry: env.registry, script: env.script, ...(env.semantics ? { semantics: env.semantics } : {}) })
    .protectionDependencyStamp(bind(g, "p1"), "demon");
}

// ---------------------------------------------------------------------------
// C1 x C2 cross-seam
// ---------------------------------------------------------------------------

describe("SOL-10F-C1 x C2 -- both defenses hold independently", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  const ROLES = ["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
  function astra(): StorytellerLobbyRecord {
    let g = patchPlayer(proofGame(ROLES), "p2", { alive: false, effects: [fx("sh", "soberHealthy")] });
    g = patchPlayer(g, "p1", { effects: [fx("gp", "protected"), sourced(g, "safe", "safeFromDemon", "p2", "monk")] });
    return g;
  }
  const kill = (opened: StorytellerLobbyRecord, now: StorytellerLobbyRecord, judgments: unknown, env?: AbilityEnvironment) =>
    plan(now, request(opened, "p0", "imp", { target: pick(opened, "p1") }, { judgments: judgments as Record<string, never> }), env);

  it("an old protection judgment whose nested Boolean is getter-backed: refused by C1 before AND after the source change; plain data is refused by C2 after it", () => {
    const g = astra();
    openInStore(g);
    const old = protectionId(g, "demon", "p1");
    let reads = 0;
    const getterBacked = () => {
      const answer: Record<string, unknown> = { kind: "boolean" };
      Object.defineProperty(answer, "value", { enumerable: true, get: () => (++reads === 1 ? true : false) });
      return answer;
    };
    // C1 alone (state unchanged, the id matches): the accessor shape is invalid.
    expect(kill(g, g, { [old]: getterBacked() })).toMatchObject({ ok: false, code: "invalid" });
    expect(store.getState().resurrect("p2")).toMatchObject({ ok: true, changed: true });
    const now = store.getState().game!;
    // Both: still invalid (C1 refuses before C2 is even consulted).
    expect(kill(g, now, { [old]: getterBacked() })).toMatchObject({ ok: false, code: "invalid" });
    // C2 alone (plain data): the old id no longer matches -> a new judgment is asked.
    expect(kill(g, now, { [old]: N })).toMatchObject({ ok: false, code: "unsupported" });
    const fresh = protectionId(now, "demon", "p1");
    expect(fresh).not.toBe(old);
    expect(reads).toBe(0);
  });

  it("a caller mutating the NEW judgment's nested value mid-planning cannot alter the canonical answer", () => {
    const g = astra();
    openInStore(g);
    const old = protectionId(g, "demon", "p1");
    expect(store.getState().resurrect("p2")).toMatchObject({ ok: true, changed: true });
    const now = store.getState().game!;
    expect(kill(g, now, { [old]: N })).toMatchObject({ ok: false, code: "unsupported" });
    const fresh = protectionId(now, "demon", "p1");
    const answer = { kind: "boolean" as const, value: true }; // judged protected
    const env = proofEnv();
    Object.defineProperty(env, "modifiers", { enumerable: true, get: () => { (answer as { value: boolean }).value = false; return undefined; } });
    expect(kill(g, now, { [fresh]: answer }, env)).toMatchObject({ ok: false, code: "unsupported" }); // no judgment authorizes uncertain automation
    expect(answer.value).toBe(false); // the caller's object did change -- the consumed snapshot did not
  });
});
