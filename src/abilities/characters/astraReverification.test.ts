// Phase 10F -- SOL-10F-B1..B6 (PHASE10F Section 35): permanent regressions for
// Astra's re-verification counterexamples and their cross-seam cases. Each
// `describe` names its finding; Astra's reproduction is the first case where
// one exists. (B1's UI half lives in src/features/abilities/
// astraReverificationUi.test.tsx; B6's installed-SDK proof in
// src/firebase/nightProgressKeys.sdk.test.ts.)
import { beforeEach, describe, expect, it } from "vitest";
import {
  encodeNightProgressComponent,
  nightTriggerStepKey,
  participantRoleStepEntries,
  participantScopedStepKey,
  participantStepKey,
  travelerArrivalStepKey,
} from "@/stores/nightProgress";
import { applyRolePlan, changeRoleIntent, correctRoleIntent, defaultRoleIds, planRoleTransaction } from "@/stores/roleResolution";
import { prospectiveJinxes } from "@/abilities/modifiers";
import { buildRegistry } from "@/data/roleRegistry";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { bind, homebrewScript, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofRegistry, proofScript, request, requirementIds } from "@/test/proofFixtures";
import type { AbilityDescriptor, AbilityInputValue } from "@/abilities/semantics";
import { choiceId } from "./alhadikhia";
import { protectionJudgmentId } from "./shared";
import type { StorytellerLobbyRecord } from "@/stores/types";

const done = { status: "done" as const, notes: "" };

/** A test-local decoder: proves the component encoding is reversible
 * (therefore injective) on every case below. */
const decode = (encoded: string): string => encoded.replace(/%([0-9A-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));

describe("SOL-10F-B5 -- every participant Night-progress component is encoded collision-free", () => {
  it("Astra's reproduction: ('alpha', 'beta:gunslinger') and ('alpha:beta', 'gunslinger') no longer share a key", () => {
    expect(participantStepKey("alpha", "beta:gunslinger")).not.toBe(participantStepKey("alpha:beta", "gunslinger"));
    expect(travelerArrivalStepKey("alpha", "beta:gunslinger")).not.toBe(travelerArrivalStepKey("alpha:beta", "gunslinger"));
    expect(participantScopedStepKey("admin", "alpha", "beta:gunslinger")).not.toBe(participantScopedStepKey("admin", "alpha:beta", "gunslinger"));
    expect(nightTriggerStepKey("alpha", "beta:gunslinger", "e")).not.toBe(nightTriggerStepKey("alpha:beta", "gunslinger", "e"));
    expect(nightTriggerStepKey("a", "b", "c:d")).not.toBe(nightTriggerStepKey("a", "b:ic", "d"));
  });

  const samples = ["alpha", "alpha:beta", "beta:gunslinger", "gunslinger", "%", "%25", "%0025", "%003A", ":", "::", "a%3Ab", "a:b",
    "ünï", "😀", "\uD83D", "\uDE00", "death.v1", "death%002Ev1", "pt-0b6c1f4e-1", "legacy-current:p1", "", "-", "_"];

  it("the component encoding is reversible, never contains ':' and keeps ordinary ids readable", () => {
    for (const value of samples) {
      const encoded = encodeNightProgressComponent(value);
      expect(decode(encoded), JSON.stringify(value)).toBe(value);
      expect(encoded).not.toContain(":");
    }
    expect(new Set(samples.map(encodeNightProgressComponent)).size).toBe(samples.length);
    expect(encodeNightProgressComponent("pt-0b6c1f4e-1")).toBe("pt-0b6c1f4e-1");
    expect(participantStepKey("pt-1", "imp")).toBe("p:pt-1:imp"); // static prefix + readable ids
    expect(encodeNightProgressComponent("%")).toBe("%0025");
    expect(encodeNightProgressComponent(":")).toBe("%003A");
  });

  it("distinct (participant, role) pairs never share a key -- %, colon, Unicode and encoded-looking strings included", () => {
    const keys = new Map<string, string>();
    for (const participant of samples.filter(Boolean)) {
      for (const role of samples.filter(Boolean)) {
        const pair = JSON.stringify([participant, role]);
        for (const key of [participantStepKey(participant, role), travelerArrivalStepKey(participant, role), nightTriggerStepKey(participant, role, null)]) {
          expect(keys.get(key) ?? pair, key).toBe(pair);
          keys.set(key, pair);
        }
      }
    }
  });

  // p1 = participant "alpha" holding the homebrew character "beta:gunslinger";
  // p2 = participant "alpha:beta" holding the Gunslinger -- Astra's pair.
  const hostileScript = { ...homebrewScript("chef"), characters: [...proofScript.characters,
    { ...proofScript.characters.find((c) => c.id === "chef")!, id: "beta:gunslinger", name: "Beta Gunslinger", provenance: { status: "homebrew" as const } }] };
  function pair(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
    let g = proofGame(["imp", "chef", "gunslinger", "monk", "empath", "saint", "washerwoman"], "night", 2, over);
    g = patchPlayer(g, "p1", { participantId: "alpha", actualRole: "beta:gunslinger", shownRole: "beta:gunslinger" });
    g = patchPlayer(g, "p2", { participantId: "alpha:beta", isTraveler: true, actualAlignment: "good",
      travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 2 } });
    return { ...g, nightProgress: {
      [`${g.day}:${participantStepKey("alpha", "beta:gunslinger")}`]: done,
      [`${g.day}:${participantStepKey("alpha:beta", "gunslinger")}`]: done,
      [`${g.day}:${travelerArrivalStepKey("alpha:beta", "gunslinger")}`]: done,
    } };
  }
  const bKeys = (g: StorytellerLobbyRecord) => [participantStepKey("alpha:beta", "gunslinger"), travelerArrivalStepKey("alpha:beta", "gunslinger")].map((k) => `${g.day}:${k}`);

  it("Role-seam cleanup of 'alpha' (beta:gunslinger -> the Beggar, a Traveler transition) clears ONLY alpha's own step, never 'alpha:beta''s", () => {
    const g = pair();
    const result = planRoleTransaction(g, { intents: [{ kind: "changeActualRole", target: bind(g, "p1"), expectedActualRole: "beta:gunslinger", expectedIsTraveler: false, actualRole: "beggar" }] },
      { script: hostileScript, ids: defaultRoleIds });
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = result.ok && result.changed ? applyRolePlan(g, result.plan).nightProgress : {};
    expect(Object.keys(after).sort()).toEqual(bKeys(g).sort());
  });

  it("a Traveler-arrival restart of 'alpha:beta' clears its own keys only (alpha's step remains)", () => {
    const g = pair();
    const result = planRoleTransaction(g, { intents: [correctRoleIntent(g.players.p2!, "gunslinger", "restart")] }, { script: hostileScript, ids: defaultRoleIds });
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = result.ok && result.changed ? applyRolePlan(g, result.plan).nightProgress : {};
    expect(Object.keys(after)).toEqual([`${g.day}:${participantStepKey("alpha", "beta:gunslinger")}`]);
  });

  it("the exact-entry builder for 'alpha' with Role 'beta:gunslinger' does not contain 'alpha:beta''s Gunslinger keys", () => {
    const entries = participantRoleStepEntries(2, "alpha", ["beta:gunslinger"]);
    for (const key of bKeys(pair())) expect(entries.has(key)).toBe(false);
  });

  describe("Setup Traveler designation (store)", () => {
    beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
    it("designating 'alpha' a Traveler resets alpha's steps only", () => {
      const g = pair({ phase: "setup", day: 0, setupRolesRevealed: false });
      openInStore(g);
      expect(store.getState().setIsTraveler("p1", true)).toEqual({ ok: true });
      expect(Object.keys(store.getState().game!.nightProgress).sort()).toEqual(bKeys(g).sort());
    });
  });
});

describe("SOL-10F-B5/B6 cross-seam -- Imp star-pass skip and duplicate-step protection use the encoded keys", () => {
  // p0 imp (self-kill), p1 scarlet woman... star-pass successors are participant-addressed.
  it("an Imp star-pass marks the successor's own Imp step skipped under the encoded key; a hostile id still round-trips", () => {
    let g = proofGame(["imp", "poisoner", "chef", "monk", "empath", "saint", "washerwoman"]);
    g = patchPlayer(g, "p1", { participantId: "minion.a:b/c" });
    const first = plan(g, request(g, "p0", "imp", { target: pick(g, "p0") }));
    // The coordinator asks for (or chooses) the successor; once it names p1, the step key it skips is p1's encoded Imp key.
    const successorId = !first.ok && first.code === "needsInput" ? first.requirements?.[0]?.id : undefined;
    const next = successorId
      ? planned(plan(g, request(g, "p0", "imp", { target: pick(g, "p0"), [successorId]: pick(g, "p1") })))
      : planned(first);
    const key = `2:${participantStepKey("minion.a:b/c", "imp")}`;
    expect(key).toBe("2:p:minion%002Ea%003Ab%002Fc:imp");
    expect(next.nightProgress[key]?.status).toBe("skipped");
    // The successor's ordinary Night-Order Imp step is refused as already skipped tonight.
    const successor = { ...next, players: next.players };
    expect(plan(successor, request(successor, "p1", "imp", { target: pick(successor, "p2") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a completed ordinary step (encoded key) refuses a duplicate ordinary resolution", () => {
    let g = proofGame(["poisoner", "chef", "imp", "monk", "empath", "saint", "washerwoman"]);
    g = patchPlayer(g, "p0", { participantId: "pois#$[]" });
    const first = planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }, { withStep: true, completeStep: true })));
    expect(first.nightProgress[`2:${participantStepKey("pois#$[]", "poisoner")}`]?.status).toBe("done");
    expect(Object.keys(first.nightProgress)).toEqual(["2:p:pois%0023%0024%005B%005D:poisoner"]);
    expect(plan(first, request(first, "p0", "poisoner", { target: pick(first, "p2") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });
});

describe("SOL-10F-B3 -- answer maps are canonical own-property snapshots", () => {
  type Fx = StorytellerLobbyRecord["players"][string]["effects"][number];
  const soberHealthy = { id: "sh", type: "soberHealthy", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as Fx;
  /** p0 = an Imp whose functioning is UNKNOWN (Sober & healthy) -> the coordinator asks actor:functioning. */
  const uncertainImp = () => patchPlayer(proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]), "p0", { effects: [soberHealthy] });
  const attack = (g: StorytellerLobbyRecord, judgments: unknown, inputs: unknown = { target: pick(g, "p1") }) =>
    plan(g, request(g, "p0", "imp", inputs as Record<string, never>, { judgments: judgments as Record<string, never> }));

  it("Astra's reproduction: an INHERITED malformed actor:functioning is absent -> the functioning answer is asked; nobody dies", () => {
    const g = uncertainImp();
    const judgments = Object.create({ "actor:functioning": { kind: "boolean", value: "no" } });
    expect(attack(g, judgments)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "actor:functioning" }] });
  });

  it("an inherited VALID Boolean is ignored too", () => {
    const g = uncertainImp();
    expect(requirementIds(attack(g, Object.create({ "actor:functioning": { kind: "boolean", value: true } })))).toEqual(["actor:functioning"]);
  });

  it("a non-enumerable own answer is absent", () => {
    const g = uncertainImp();
    const judgments = {};
    Object.defineProperty(judgments, "actor:functioning", { value: { kind: "boolean", value: true }, enumerable: false });
    expect(requirementIds(attack(g, judgments))).toEqual(["actor:functioning"]);
  });

  it("an own malformed value is invalid; an own valid false stays false; a null-prototype own map works", () => {
    const g = uncertainImp();
    expect(attack(g, { "actor:functioning": { kind: "boolean", value: "no" } })).toMatchObject({ ok: false, code: "invalid" });
    expect(attack(g, { "actor:functioning": { kind: "boolean", value: false } })).toEqual({ ok: true, changed: false }); // impaired Imp: nothing
    const nullProto = Object.assign(Object.create(null), { "actor:functioning": { kind: "boolean", value: true } });
    expect(planned(attack(g, nullProto)).players.p1!.alive).toBe(false);
  });

  it("an inherited declared input is absent (the input is asked)", () => {
    const g = proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]);
    expect(attack(g, {}, Object.create({ target: pick(g, "p1") }))).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "target" }] });
  });

  it("an answer whose kind / value are inherited is invalid (never consumed through the prototype)", () => {
    const g = uncertainImp();
    expect(attack(g, { "actor:functioning": Object.create({ kind: "boolean", value: true }) })).toMatchObject({ ok: false, code: "invalid" });
    expect(attack(g, { "actor:functioning": Object.assign(Object.create({ value: true }), { kind: "boolean" }) })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("each answer is read exactly once: a getter cannot pass validation and then change", () => {
    const g = uncertainImp();
    let reads = 0;
    const judgments = {};
    Object.defineProperty(judgments, "actor:functioning", { enumerable: true, get: () => (++reads === 1 ? { kind: "boolean", value: false } : { kind: "boolean", value: true }) });
    expect(attack(g, judgments)).toEqual({ ok: true, changed: false }); // the validated false is the consumed false
    expect(reads).toBe(1);
  });

  it("the evaluator consumes the SAME snapshot: a follow-up input / judgment getter is read once", () => {
    const g = patchPlayer(proofGame(["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]), "p1",
      { effects: [{ id: "gp", type: "protected", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as Fx] });
    const reads = { choice: 0, judgment: 0 };
    const inputs: Record<string, unknown> = { chosen: pick(g, "p1", "p2", "p3") };
    Object.defineProperty(inputs, choiceId(0, bind(g, "p1")), { enumerable: true,
      get: () => (++reads.choice === 1 ? { kind: "boolean", value: false } : { kind: "boolean", value: true }) });
    inputs[choiceId(1, bind(g, "p2"))] = { kind: "boolean", value: true };
    inputs[choiceId(2, bind(g, "p3"))] = { kind: "boolean", value: true };
    const first = plan(g, request(g, "p0", "alhadikhia", inputs as Record<string, never>));
    const [protection] = requirementIds(first); // p1's die was consumed (not the second read's 'live')
    expect(protection).toMatch(/^protection:demon@/);
    expect(reads.choice).toBe(1);
    const judgments = {};
    Object.defineProperty(judgments, protection!, { enumerable: true,
      get: () => (++reads.judgment === 1 ? { kind: "boolean", value: false } : { kind: "boolean", value: true }) });
    reads.choice = 0;
    const done = plan(g, request(g, "p0", "alhadikhia", inputs as Record<string, never>, { judgments: judgments as Record<string, never> }));
    expect(done.ok && done.changed ? done.plan.outcome.operations.flatMap((o) => (o.domain === "life" ? o.intents.map((i) => `${i.kind}:${i.target.playerId}`) : [])) : []).toEqual(["death:p1"]);
    expect(reads).toEqual({ choice: 1, judgment: 1 });
  });

  it("B3 x modifier gate: an inherited modifier confirmation is ignored", () => {
    const g = { ...proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]), fabled: ["toymaker"] };
    expect(requirementIds(attack(g, Object.create({ "modifier:fabled:toymaker": { kind: "boolean", value: true } })))).toEqual(["modifier:fabled:toymaker"]);
    expect(planned(attack(g, { "modifier:fabled:toymaker": { kind: "boolean", value: true } })).players.p1!.alive).toBe(false);
  });

  it("B3 x Night trigger: an inherited trigger judgment is ignored", () => {
    const g0 = proofGame(["ravenkeeper", "imp", "chef", "monk", "empath", "saint", "washerwoman"]);
    const died = planned(plan(g0, request(g0, "p1", "imp", { target: pick(g0, "p0") })));
    const legacy = { ...died, lifeEventWindow: { ...died.lifeEventWindow, events: died.lifeEventWindow.events.map(({ actualRoleAtEvent: _gone, ...e }) => e) } } as StorytellerLobbyRecord;
    const trigger = (judgments: unknown) => plan(legacy, request(legacy, "p0", "ravenkeeper", { target: pick(legacy, "p2") }, { invocationPath: "nightTrigger", judgments: judgments as Record<string, never> }));
    const [id] = requirementIds(trigger({}));
    expect(id).toMatch(/^trigger:actorDiedTonight:i/);
    expect(requirementIds(trigger(Object.create({ [id!]: { kind: "boolean", value: true } })))).toEqual([id]);
    expect(trigger({ [id!]: { kind: "boolean", value: true } })).toMatchObject({ ok: true, changed: true });
  });
});

describe("SOL-10F-B4 -- prospective jinxes follow the ordered Role transitions", () => {
  // p0 pithag, p1 chef, p2 imp, p3 monk, p4 empath, p5 saint, p6 washerwoman (or damsel)
  const PIT = ["pithag", "chef", "imp", "monk", "empath", "saint", "washerwoman"];
  const WITH_DAMSEL = ["pithag", "chef", "imp", "monk", "empath", "saint", "damsel"];
  type Change = [player: string, roleId: string];
  const ids = (g: StorytellerLobbyRecord, changes: Change[], registry = proofRegistry) =>
    prospectiveJinxes(g, registry, changes.map(([playerId, roleId]) => ({ playerId, roleId }))).map((jinx) => jinx.id);
  /** A RULES-NEUTRAL guided descriptor (keyed to the canonical Pit-Hag id only to
   * pass the ownership boundary) whose outcome is the given ordered Actual Role
   * changes -- as one operation, or one operation per change. */
  const changing = (changes: Change[], split = false): AbilityDescriptor => ({
    roleId: "pithag", timing: ["otherNight"], invocation: "wake", usage: { kind: "unlimited" }, inputs: [], hooks: ["role"],
    presentation: { complexity: "complex", action: "test" },
    evaluator: ({ query }) => {
      const intents = changes.map(([id, roleId]) => changeRoleIntent(query.participant(bind(query.game, id))!, roleId));
      return { kind: "outcome", outcome: { operations: split ? intents.map((intent) => ({ domain: "role" as const, intents: [intent] })) : [{ domain: "role", intents }] } };
    },
  });
  const run = (g: StorytellerLobbyRecord, changes: Change[], split = false, judgments: Record<string, AbilityInputValue> = {}) =>
    plan(g, request(g, "p0", "pithag", {}, { judgments }), proofEnv({ semantics: new Map([["pithag", changing(changes, split)]]) }));

  it("Astra's reproduction 1: Chef -> Damsel, then Pit-Hag -> Slayer: the transient Pit-Hag/Damsel creation is caught", () => {
    const g = proofGame(PIT);
    expect(ids(g, [["p1", "damsel"], ["p0", "slayer"]])).toEqual(["jinx:pithag+damsel"]);
    for (const split of [false, true]) {
      expect(run(g, [["p1", "damsel"], ["p0", "slayer"]], split)).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/pithag \/ damsel jinx/) });
    }
  });

  it("Astra's reproduction 2: an existing Damsel -> Slayer, then another player -> Damsel: the RE-creation is caught", () => {
    const g = proofGame(WITH_DAMSEL);
    expect(ids(g, [["p6", "slayer"], ["p1", "damsel"]])).toEqual(["jinx:pithag+damsel"]);
    // B4 x current modifier gate: the CURRENT pithag/damsel jinx is asked first;
    // confirming it never bypasses the prospective re-creation.
    expect(requirementIds(run(g, [["p6", "slayer"], ["p1", "damsel"]]))).toEqual(["modifier:jinx:pithag+damsel"]);
    expect(run(g, [["p6", "slayer"], ["p1", "damsel"]], true, { "modifier:jinx:pithag+damsel": { kind: "boolean", value: true } }))
      .toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/pithag \/ damsel jinx/) });
  });

  it("order matters: Pit-Hag -> Slayer FIRST, then Chef -> Damsel never activates the pair (no false positive)", () => {
    const g = proofGame(PIT);
    expect(ids(g, [["p0", "slayer"], ["p1", "damsel"]])).toEqual([]);
    expect(run(g, [["p0", "slayer"], ["p1", "damsel"]])).toMatchObject({ ok: true, changed: true });
  });

  it("the ordinary single Pit-Hag -> Damsel stays gated (the real evaluator)", () => {
    const g = proofGame(PIT);
    expect(ids(g, [["p1", "damsel"]])).toEqual(["jinx:pithag+damsel"]);
    expect(plan(g, request(g, "p0", "pithag", { target: pick(g, "p1"), character: { kind: "character", roleIds: ["damsel"] } }))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("unrelated Role changes create nothing and stay guided", () => {
    const g = proofGame(PIT);
    expect(ids(g, [["p1", "slayer"], ["p4", "soldier"]])).toEqual([]);
    expect(run(g, [["p1", "slayer"], ["p4", "soldier"]], true)).toMatchObject({ ok: true, changed: true });
  });

  it("homebrew lookalikes / a non-canonical owner of an official id create no canonical jinx", () => {
    const g = proofGame(PIT);
    expect(ids(g, [["p1", "damsel"], ["p0", "slayer"]], buildRegistry(homebrewScript("damsel")))).toEqual([]);
    expect(ids(g, [["p1", "damsel"], ["p0", "slayer"]], buildRegistry(homebrewScript("pithag")))).toEqual([]);
    expect(ids(proofGame(WITH_DAMSEL), [["p6", "slayer"], ["p1", "damsel"]], buildRegistry(homebrewScript("damsel")))).toEqual([]);
  });

  it("a pair created, removed and created again is reported once; two different creations are both reported", () => {
    const g = proofGame(PIT);
    expect(ids(g, [["p1", "damsel"], ["p1", "slayer"], ["p4", "damsel"]])).toEqual(["jinx:pithag+damsel"]);
    const both = ids(proofGame(["pithag", "chef", "alhadikhia", "monk", "empath", "saint", "washerwoman"]), [["p1", "damsel"], ["p0", "scarletwoman"]]);
    expect(both).toEqual(expect.arrayContaining(["jinx:pithag+damsel", "jinx:scarletwoman+alhadikhia"]));
  });

  it("checkOrdering's same-participant limitation is preserved (two Actual Role changes of one player are refused)", () => {
    const g = proofGame(PIT);
    expect(run(g, [["p1", "slayer"], ["p1", "soldier"]], true)).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/more than once/) });
  });
});

describe("SOL-10F-B2 -- protection judgments belong to one death attempt + its state", () => {
  type Fx = StorytellerLobbyRecord["players"][string]["effects"][number];
  const AL = ["alhadikhia", "chef", "monk", "poisoner", "empath", "saint", "washerwoman"];
  const lifeIntents = (result: ReturnType<typeof plan>) => result.ok && result.changed
    ? result.plan.outcome.operations.flatMap((o) => (o.domain === "life" ? o.intents.map((i) => `${i.kind}:${i.target.playerId}`) : [])) : [];
  const onlyAsked = (result: ReturnType<typeof plan>) => {
    const asked = requirementIds(result);
    expect(asked).toHaveLength(1);
    return asked[0]!;
  };
  const sourced = (g: StorytellerLobbyRecord, id: string, type: string, sourceId: string, sourceCharacter: string): Fx => ({
    id, type, sourceCharacter, lifetime: { kind: "untilDawn" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 },
    sourceParticipant: { kind: "participant", participantId: g.players[sourceId]!.participantId!, playerId: sourceId, nameAtTime: g.players[sourceId]!.name } } as Fx);
  /** Astra's state: p1 Chef safe from the Demon by p2 Monk; the Monk is
   * Sober & healthy (functioning uncertain) and poisoned by p3, a DEAD Poisoner. */
  function astra(): StorytellerLobbyRecord {
    let g = patchPlayer(proofGame(AL), "p3", { alive: false });
    g = patchPlayer(g, "p1", { effects: [sourced(g, "safe", "safeFromDemon", "p2", "monk")] });
    return patchPlayer(g, "p2", { effects: [
      { id: "sh", type: "soberHealthy", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as Fx,
      sourced(g, "poison", "poisoned", "p3", "poisoner")] });
  }
  const order = ["p1", "p3", "p2"]; // Chef, Poisoner, Monk
  const run = (g: StorytellerLobbyRecord, picks: boolean[], judgments: Record<string, AbilityInputValue> = {}) =>
    plan(g, request(g, "p0", "alhadikhia", { chosen: pick(g, ...order),
      ...Object.fromEntries(picks.map((value, index) => [choiceId(index, bind(g, order[index]!)), { kind: "boolean", value }])) }, { judgments }));
  const Y = { kind: "boolean", value: true } as const, N = { kind: "boolean", value: false } as const;

  it("Astra's reproduction: the Chef's INITIAL protection judgment never settles the Chef's FINAL all-alive death attempt", () => {
    const g = astra();
    const initial = onlyAsked(run(g, [false]));                  // Chef chooses die -> protection unknown
    expect(requirementIds(run(g, [false], { [initial]: Y }))).toEqual([choiceId(1, bind(g, "p3"))]);
    // Poisoner chooses live (resurrected), Monk chooses live -> all alive -> the final sequence.
    const final = onlyAsked(run(g, [false, true, true], { [initial]: Y }));
    expect(final).not.toBe(initial);
    expect(final.startsWith("protection:demon@")).toBe(true);
    expect(JSON.parse(final.slice("protection:demon@".length))[1]).toBe(bind(g, "p1").participantId);
    // Answered: the Chef dies, then the Poisoner and the Monk (known unprotected) -- 1 -> 2 -> 3.
    expect(lifeIntents(run(g, [false, true, true], { [initial]: Y, [final]: N }))).toEqual(["resurrection:p3", "death:p1", "death:p3", "death:p2"]);
    expect(lifeIntents(run(g, [false, true, true], { [initial]: Y, [final]: Y }))).toEqual(["resurrection:p3", "death:p3", "death:p2"]);
  });

  it("Astra's state commits ONCE (one Undo entry) and Undo restores it", () => {
    const g = astra();
    openInStore(g);
    const initial = onlyAsked(run(g, [false]));
    const final = onlyAsked(run(g, [false, true, true], { [initial]: Y }));
    const req = request(g, "p0", "alhadikhia", { chosen: pick(g, ...order), [choiceId(0, bind(g, "p1"))]: N, [choiceId(1, bind(g, "p3"))]: Y, [choiceId(2, bind(g, "p2"))]: Y },
      { judgments: { [initial]: Y, [final]: N } });
    expect(store.getState().resolveAbility(req)).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(["p1", "p2", "p3"].map((id) => store.getState().game!.players[id]!.alive)).toEqual([false, false, false]);
    store.getState().undo();
    expect(store.getState().game).toEqual(g);
  });

  it("even when nothing changed between them, the initial and final attempts on one player are separate judgments", () => {
    let g = proofGame(AL);
    g = patchPlayer(g, "p1", { effects: [{ id: "gp", type: "protected", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as Fx] });
    const initial = onlyAsked(run(g, [false]));
    const final = onlyAsked(run(g, [false, true, true], { [initial]: Y }));
    expect(final).not.toBe(initial);
    // A crafted request answering only the initial attempt never settles the final one.
    expect(requirementIds(run(g, [false, true, true], { [initial]: Y }))).toEqual([final]);
  });

  it("identical prefix and state: the initial and final attempt on player 3 still differ (only the stage separates them)", () => {
    // Positions 1 and 2 (p1, p3) cannot die (known); position 3 (p2) has a generic Protected (unknown).
    // 1 and 2 live; 3 dies -> judged protected -> all alive -> the final deaths: 1 and 2 known to survive ->
    // position 3's FINAL attempt sees exactly the same choices, resolved intents and alive vector as its
    // initial attempt; it is still a NEW death attempt.
    const fx = (id: string, type: string) => ({ id, type, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as Fx);
    let g = proofGame(AL);
    g = patchPlayer(g, "p1", { effects: [fx("cd1", "cannotDie")] });
    g = patchPlayer(g, "p3", { effects: [fx("cd3", "cannotDie")] });
    g = patchPlayer(g, "p2", { effects: [fx("gp", "protected")] });
    const initial = onlyAsked(run(g, [true, true, false]));
    const final = onlyAsked(run(g, [true, true, false], { [initial]: Y }));
    expect(final).not.toBe(initial);
    expect(JSON.parse(JSON.parse(final.slice("protection:demon@".length))[0]).slice(1)).toEqual(JSON.parse(JSON.parse(initial.slice("protection:demon@".length))[0]).slice(1));
    expect(lifeIntents(run(g, [true, true, false], { [initial]: Y, [final]: N }))).toEqual(["death:p2"]);
  });

  it("changing an earlier choice / consequence changes every later attempt id; an old judgment cannot satisfy the new attempt", () => {
    // Generic Protected on p2 (the Monk, position 3): unknown -> judgment.
    let g = proofGame(AL);
    g = patchPlayer(g, "p2", { effects: [{ id: "gp", type: "protected", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as Fx] });
    const afterChefLives = onlyAsked(run(g, [true, true, false]));
    const afterChefDies = onlyAsked(run(g, [false, true, false]));
    const afterPoisonerDies = onlyAsked(run(g, [true, false, false]));
    expect(new Set([afterChefLives, afterChefDies, afterPoisonerDies]).size).toBe(3);
    expect(requirementIds(run(g, [false, true, false], { [afterChefLives]: Y }))).toEqual([afterChefDies]);
    // A different ordered selection is a different attempt too.
    const reordered = plan(g, request(g, "p0", "alhadikhia", { chosen: pick(g, "p3", "p1", "p2"),
      [choiceId(0, bind(g, "p3"))]: Y, [choiceId(1, bind(g, "p1"))]: Y, [choiceId(2, bind(g, "p2"))]: N }, { judgments: { [afterChefLives]: Y } }));
    expect(requirementIds(reordered)).toHaveLength(1);
    expect(requirementIds(reordered)[0]).not.toBe(afterChefLives);
  });

  it("known protection is recomputed automatically at every attempt (never a judgment)", () => {
    // A functioning Monk's Safe from the Demon on the Chef: known protected, initially AND finally.
    let g = proofGame(AL);
    g = patchPlayer(g, "p1", { effects: [sourced(g, "safe", "safeFromDemon", "p2", "monk")] });
    expect(lifeIntents(run(g, [false, true, true]))).toEqual(["death:p3", "death:p2"]);
    // The Monk chooses die first in another order: the Chef's later attempt is known UNprotected.
    const monkFirst = plan(g, request(g, "p0", "alhadikhia", { chosen: pick(g, "p2", "p1", "p3"),
      [choiceId(0, bind(g, "p2"))]: N, [choiceId(1, bind(g, "p1"))]: N, [choiceId(2, bind(g, "p3"))]: Y }));
    expect(lifeIntents(monkFirst)).toEqual(["death:p2", "death:p1"]);
  });

  // SOL-10F-C2 (PHASE10F Section 39) supersedes B2's "single-attempt characters
  // keep their stable target + cause identity": EVERY protection judgment id
  // now binds the RulesQuery dependency stamp too (see astraClosure.test.ts).
  it("single-attempt ids stay unscoped but bind the dependency stamp; scoped and unscoped ids never collide", () => {
    const a = { playerId: "p1", participantId: "a" };
    expect(protectionJudgmentId("demon", a, "S")).toBe('protection:demon:["a","S"]');
    expect(protectionJudgmentId("demon", a, "S")).not.toBe(protectionJudgmentId("demon", a, "T"));
    expect(protectionJudgmentId("demon", a, "S", { id: "x" })).not.toBe(protectionJudgmentId("demon", a, "S"));
    // No ParticipantId / scope token / stamp can make a scoped id collide with an unscoped one, or two ids collide.
    expect(protectionJudgmentId("demon", { playerId: "p1", participantId: '@["x","a"' }, "S")).not.toBe(protectionJudgmentId("demon", a, "S", { id: "x" }));
    expect(protectionJudgmentId("demon", { playerId: "p1", participantId: 'a","S' }, "T")).not.toBe(protectionJudgmentId("demon", a, 'S","T'));
  });
});

describe("SOL-10F-B5/B6 cross-seam -- trigger consumption and Undo under encoded keys", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  // p0 ravenkeeper (hostile ParticipantId), p1 imp; the death is recorded as LifeEvent "death.v1".
  function died(): StorytellerLobbyRecord {
    const g = patchPlayer(proofGame(["ravenkeeper", "imp", "chef", "monk", "empath", "saint", "washerwoman"]), "p0", { participantId: "rk.1:a/b" });
    return planned(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") }),
      proofEnv({ ids: { ...proofEnv().ids, life: { eventId: () => "death.v1", historyId: () => "hl-death.v1" } } })));
  }
  const trigger = (g: StorytellerLobbyRecord, target: string, extra: Record<string, unknown> = {}) =>
    request(g, "p0", "ravenkeeper", { target: pick(g, target) }, { invocationPath: "nightTrigger", ...extra });

  it("the exact event is consumed under its encoded key (even with completeStep:false); the replay is refused; Undo restores it", () => {
    const g = died();
    const key = `2:${nightTriggerStepKey("rk.1:a/b", "ravenkeeper", "death.v1")}`;
    expect(key).toBe("2:trigger:rk%002E1%003Aa%002Fb:ravenkeeper:ideath%002Ev1");
    openInStore(g);
    expect(store.getState().resolveAbility(trigger(g, "p2", { completeStep: false }))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().game!.nightProgress[key]).toEqual(done);
    expect(store.getState().undoStack).toHaveLength(1);
    const after = store.getState().game!;
    expect(plan(after, trigger(g, "p3", { trigger: { eventId: "death.v1" } }))).toMatchObject({ ok: false });
    expect(plan(after, trigger(after, "p3"))).toMatchObject({ ok: false, code: "notApplicable", message: expect.stringMatching(/already resolved/) });
    store.getState().undo();
    expect(store.getState().game!.nightProgress[key]).toBeUndefined();
    expect(plan(store.getState().game!, trigger(store.getState().game!, "p3"))).toMatchObject({ ok: true, changed: true });
  });

  it("a raw pre-fix composite key for the same event is NOT treated as consumed (no guessed ownership)", () => {
    const g = died();
    const raw = { ...g, nightProgress: { "2:trigger:rk.1%3Aa%2Fb:ravenkeeper:ideath.v1": done } };
    expect(plan(raw, trigger(raw, "p2"))).toMatchObject({ ok: true, changed: true });
  });
});
