// Phase 10F Slice 7 -- Harlot (matrix Section 15). Production semantics.
// The `harlot-other-night` Information Action is Silverwick-authored with
// explicit project-owner authorization (no pinned canonical action existed).
import { describe, expect, it } from "vitest";
import { CANONICAL_ABILITY_SEMANTICS, resolveAbilitySemantics, type AbilityInputValue, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { CHARACTER_JUDGMENT, CONSENT, DEATH_CONSEQUENCE, HARLOT, SHOWN } from "./harlot";
import { protectionJudgmentId } from "./shared";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofEnv, proofGame, request, requirementIds, reseat, yes } from "@/test/proofFixtures";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

// p0 harlot (Traveller), p1 chef, p2 spy, p3 imp, p4 monk, p5 saint, p6 empath
function base(day = 2): StorytellerLobbyRecord {
  const g = proofGame(["harlot", "chef", "spy", "imp", "monk", "saint", "empath"], "night", day);
  return patchPlayer(g, "p0", { isTraveler: true, actualAlignment: "good", shownRole: "harlot", publicDisplayRole: "harlot",
    travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 } });
}
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const run = (g: StorytellerLobbyRecord, target: string, inputs: Record<string, AbilityInputValue> = {}, extra = {}) =>
  plan(g, request(g, "p0", "harlot", { target: pick(g, target), ...inputs }, extra));
const effect = (type: string, over: Partial<EffectRecord> = {}): EffectRecord =>
  ({ id: `fx-${type}`, type, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 }, ...over } as EffectRecord);

describe("Harlot -- consent", () => {
  it("asks the chosen player's consent (their own Player choice) after the choice", () => {
    expect(run(base(), "p1")).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: CONSENT, source: "player", kind: "boolean" }] });
  });

  it("declines: no information and no death", () => {
    const g = base();
    expect(run(g, "p1", { [CONSENT]: yes(false) })).toEqual({ ok: true, changed: false });
    const step = planned(run(g, "p1", { [CONSENT]: yes(false) }, { withStep: true, completeStep: true }));
    expect(step.informationDeliveries).toEqual([]);
    expect(step.players).toBe(g.players);
  });

  it("agrees + no death consequence: information only, recorded exactly", () => {
    const g = base();
    expect(requirementIds(run(g, "p1", { [CONSENT]: yes() }))).toEqual([DEATH_CONSEQUENCE]);
    const next = planned(run(g, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes(false) }));
    expect(next.informationDeliveries).toEqual([expect.objectContaining({ actualRole: "harlot", informationActionId: "harlot-other-night",
      values: [{ requirementId: "role", kind: "role", roleId: "chef" }] })]);
    expect(next.players).toBe(g.players);
  });

  it("agrees + death consequence: both die in ONE resolution, information recorded too", () => {
    const g = base();
    const result = run(g, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() });
    const next = planned(result);
    expect(next.players.p0!.alive).toBe(false);
    expect(next.players.p1!.alive).toBe(false);
    expect(next.informationDeliveries).toHaveLength(1);
    if (result.ok && result.changed) {
      expect(result.plan.outcome.operations.map((o) => o.domain)).toEqual(["life", "information"]);
      expect(result.plan.needsConfirmation).toBe(true);
    }
  });

  it("protection ('any'): one or both protected; unknown -> judgment", () => {
    const one = patchPlayer(base(), "p1", { effects: [effect("cannotDie")] });
    const oneNext = planned(run(one, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() }));
    expect([oneNext.players.p0!.alive, oneNext.players.p1!.alive]).toEqual([false, true]);
    const both = patchPlayer(one, "p0", { effects: [effect("cannotDie")] });
    expect(planned(run(both, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() })).players).toBe(both.players);
    // Safe from the Demon does not protect from a Harlot death.
    const monked = patchPlayer(base(), "p1", { effects: [effect("safeFromDemon")] });
    expect(planned(run(monked, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() })).players.p1!.alive).toBe(false);
    const generic = patchPlayer(base(), "p1", { effects: [effect("protected")] });
    const id = protectionJudgmentId("any", bind(generic, "p1"));
    expect(requirementIds(run(generic, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() }))).toEqual([id]);
    expect(planned(run(generic, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() }, { judgments: { [id]: yes(true) } })).players.p1!.alive).toBe(true);
  });

  it("when one death would change whether the other is prevented, no order is invented -> Manual", () => {
    // p1 is protected by an Effect that lasts only while the Harlot functions.
    const semantics: AbilitySemanticsRegistry = new Map([...CANONICAL_ABILITY_SEMANTICS,
      ["harlot", { ...HARLOT, sourcedEffects: [{ type: "cannotDie", persistence: "whileSourceFunctions" }] }]]);
    const g = base();
    const linked = patchPlayer(g, "p1", { effects: [effect("cannotDie", { sourceParticipant: { kind: "participant", participantId: g.players.p0!.participantId!, playerId: "p0", nameAtTime: "Player 0" }, sourceCharacter: "harlot" })] });
    expect(plan(linked, request(linked, "p0", "harlot", { target: pick(linked, "p1"), [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() }), proofEnv({ semantics })))
      .toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/order matters/) });
  });

  it("registration ambiguity: the Storyteller decides the character shown", () => {
    const g = base();
    expect(requirementIds(run(g, "p2", { [CONSENT]: yes() }))).toEqual([CHARACTER_JUDGMENT]);
    const next = planned(run(g, "p2", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes(false) }, { judgments: { [CHARACTER_JUDGMENT]: character("chef") } }));
    expect(next.informationDeliveries[0]!.values).toEqual([{ requirementId: "role", kind: "role", roleId: "chef" }]);
  });
});

describe("Harlot -- targets, timing, impairment, identity", () => {
  it("the target must be another LIVING participant", () => {
    const g = patchPlayer(base(), "p1", { alive: false });
    expect(run(g, "p1")).toMatchObject({ ok: false, code: "illegal" });
    expect(run(g, "p0")).toMatchObject({ ok: false, code: "illegal" });
  });

  it("Each night*: not the game's first Night; a late-arriving Harlot acts on a later Night by the GAME's Night number", () => {
    const n1 = base(1);
    expect(run(n1, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    const late = patchPlayer(base(3), "p0", { travelerArrival: { demonInfoComplete: false, firstNightComplete: false } });
    expect(requirementIds(run(late, "p1"))).toEqual([CONSENT]);
  });

  it("an impaired Harlot: the Storyteller chooses the character shown; no death is offered", () => {
    const g = impair(base(), "p0");
    expect(requirementIds(run(g, "p1", { [CONSENT]: yes() }))).toEqual([SHOWN]);
    const next = planned(run(g, "p1", { [CONSENT]: yes(), [SHOWN]: character("imp") }));
    expect(next.informationDeliveries[0]!.values).toEqual([{ requirementId: "role", kind: "role", roleId: "imp" }]);
    expect(next.players).toBe(g.players);
  });

  it("a stale target (and with it the consent) after seat reuse is refused", () => {
    const g = base();
    const req = request(g, "p0", "harlot", { target: pick(g, "p1"), [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes() });
    expect(plan(reseat(g, "p1"), req)).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew 'harlot' cannot hijack the official id: canonical Traveller precedence (10D) keeps the canonical definition", () => {
    const env = homebrewEnv("harlot");
    const resolved = env.registry.get("harlot")!;
    expect(resolved.provenance?.status).not.toBe("homebrew");
    expect(resolveAbilitySemantics("harlot", env.registry)).toMatchObject({ kind: "supported" });
    // And a homebrew definition that IS the registry's resolution never gets semantics.
    const forged = { get: (id: string) => (id === "harlot" ? { ...resolved, provenance: { status: "homebrew" } } : env.registry.get(id)) } as unknown as typeof env.registry;
    expect(resolveAbilitySemantics("harlot", forged)).toMatchObject({ kind: "homebrew" });
  });
});
