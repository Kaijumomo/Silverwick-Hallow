// Phase 10F Slice 7 -- Harlot (matrix Section 15). Production semantics.
// The `harlot-other-night` Information Action is Silverwick-authored
// structured metadata (src/data/informationActions.ts) with explicit
// project-owner authorization -- the pinned publisher data has none.
import { describe, expect, it } from "vitest";
import { CANONICAL_ABILITY_SEMANTICS, resolveAbilitySemantics, type AbilityInputValue, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { CHARACTER_JUDGMENT, CONSENT, DEATH_CONSEQUENCE, HARLOT, SHOWN } from "./harlot";
import { protectionJudgmentId } from "./shared";
import { bind, homebrewEnv, homebrewScript, proofRegistry, impair, patchPlayer, pick, plan, planned, proofEnv, proofGame, request, requirementIds, reseat, yes } from "@/test/proofFixtures";
import type { EffectRecord, RoleDef, StorytellerLobbyRecord } from "@/stores/types";
import { buildRegistry, silverwickInformationActions } from "@/data/roleRegistry";
import { planInformationDelivery } from "@/stores/informationDelivery";
import pinned from "@/data/canonical/roles.json";

// p0 harlot (Traveller), p1 chef, p2 spy, p3 imp, p4 monk, p5 saint, p6 empath
function base(day = 2): StorytellerLobbyRecord {
  const g = proofGame(["harlot", "chef", "spy", "imp", "monk", "saint", "empath"], "night", day);
  return patchPlayer(g, "p0", { isTraveler: true, actualAlignment: "good", shownRole: "harlot", publicDisplayRole: "harlot",
    travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 } });
}
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const run = (g: StorytellerLobbyRecord, target: string, inputs: Record<string, AbilityInputValue> = {}, extra = {}) =>
  plan(g, request(g, "p0", "harlot", { target: pick(g, target), ...inputs }, extra));
/** The recorded Harlot delivery values: the chosen participant's durable ref + the character. */
const told = (g: StorytellerLobbyRecord, chosen: string, roleId: string) => [
  { requirementId: "chosenPlayer", kind: "player", participants: [expect.objectContaining({ kind: "participant", participantId: g.players[chosen]!.participantId, playerId: chosen })] },
  { requirementId: "role", kind: "role", roleId },
];
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
      values: told(g, "p1", "chef") })]);
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
    expect(next.informationDeliveries[0]!.values).toEqual(told(g, "p2", "chef"));
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
    expect(next.informationDeliveries[0]!.values).toEqual(told(g, "p1", "imp"));
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

describe("Harlot Information Action -- owner-authorized Silverwick metadata", () => {
  const harlot = proofRegistry.get("harlot")!;
  const values = () => [
    { requirementId: "chosenPlayer", kind: "player", playerIds: ["p1"] },
    { requirementId: "role", kind: "role", roleId: "chef" },
  ];
  const deliver = (g: StorytellerLobbyRecord) => planInformationDelivery(g, { recipientPlayerId: "p0", informationActionId: "harlot-other-night", values: values() }, { registry: proofRegistry });

  it("the canonical Harlot resolves exactly the authorized action: other Nights, chosenPlayer (1 player) + role (1 role)", () => {
    expect(proofRegistry.informationActionsOf("harlot")).toEqual([{
      id: "harlot-other-night", timing: { kind: "otherNight" }, instruction: expect.any(String),
      requirements: [
        { id: "chosenPlayer", kind: "player", cardinality: { kind: "exactly", count: 1 }, label: expect.any(String) },
        { id: "role", kind: "role", cardinality: { kind: "exactly", count: 1 }, label: expect.any(String) },
      ],
    }]);
  });

  it("the pinned publisher data is untouched: it still carries no Harlot Information Action", () => {
    const entry = (pinned as Record<string, unknown>[]).find((r) => r.id === "harlot")!;
    expect(Object.keys(entry).sort()).toEqual(["ability", "edition", "flavor", "id", "name", "otherNightReminder", "reminders", "setup", "team"]);
  });

  it("a custom / homebrew definition reusing the id inherits nothing", () => {
    // The ownership gate itself: any non-canonical definition gets no Silverwick action.
    expect(silverwickInformationActions(harlot)).toHaveLength(1);
    expect(silverwickInformationActions({ ...harlot, provenance: { status: "homebrew" } } as RoleDef)).toEqual([]);
    expect(silverwickInformationActions({ ...harlot, ability: "Each night, something homebrew." })).toEqual([]);
    expect(silverwickInformationActions({ id: "harlot", name: "Harlot", type: "traveler" } as RoleDef)).toEqual([]);
    // And a script's homebrew 'harlot' can never take the id (10D canonical Traveller precedence).
    const registry = buildRegistry(homebrewScript("harlot", { ability: "Homebrew text." }));
    expect(registry.get("harlot")).toBe(harlot);
  });

  it("is valid only on later Nights (not Night 1, not the Day)", () => {
    expect(deliver(base(1))).toMatchObject({ ok: false, message: expect.stringMatching(/later Night/) });
    expect(deliver({ ...base(2), phase: "day" })).toMatchObject({ ok: false });
    expect(deliver(base(2))).toMatchObject({ ok: true });
    expect(deliver(base(3))).toMatchObject({ ok: true });
  });

  it("declined consent creates no Information Delivery (even when the step completes)", () => {
    const g = base();
    const next = planned(run(g, "p1", { [CONSENT]: yes(false) }, { withStep: true, completeStep: true }));
    expect(next.informationDeliveries).toEqual([]);
  });

  it("accepted consent records BOTH the chosen participant and the shown character", () => {
    const g = base();
    const next = planned(run(g, "p1", { [CONSENT]: yes(), [DEATH_CONSEQUENCE]: yes(false) }));
    expect(next.informationDeliveries).toEqual([expect.objectContaining({
      recipient: expect.objectContaining({ participantId: g.players.p0!.participantId }),
      actualRole: "harlot", informationActionId: "harlot-other-night", values: told(g, "p1", "chef"),
    })]);
  });
});
