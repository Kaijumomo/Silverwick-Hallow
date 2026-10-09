// Phase 10F Slice 7 -- Poisoner (matrix Section 4). Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, reseat } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const ROLES = ["poisoner", "empath", "chef", "monk", "imp", "fortuneteller", "saint"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const poisonOf = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "poisoned")!;

describe("Poisoner -- functioning", () => {
  it("Night 1: one sourced poisoned Effect through the following Day (expires entering Night 2)", () => {
    const g = proofGame(ROLES, "night", 1);
    const next = planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") })));
    const effect = poisonOf(next, "p1");
    expect(effect).toMatchObject({
      type: "poisoned", state: "active", sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" },
      sourceParticipant: { kind: "participant", participantId: g.players.p0!.participantId, playerId: "p0" },
      expiry: { kind: "at", moment: { phase: "night", day: 2 } },
    });
    expect(next.players.p0!.effects).toEqual([]);
  });

  it("a later Night: expiry follows that Night (entry to Night N+1)", () => {
    const g = proofGame(ROLES, "night", 3);
    expect(poisonOf(planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }))), "p1").expiry)
      .toEqual({ kind: "at", moment: { phase: "night", day: 4 } });
  });

  it("self-poisoning remains legal but wholly Manual because its sourced cycle is unmodeled; a dead target is modeled", () => {
    const g = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    expect(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p0") }))).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.players.p0!.effects).toEqual([]);
    expect(poisonOf(planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p2") }))), "p2")).toBeDefined();
  });

  it("mutual sourced-poison uncertainty refuses the whole action without history or Night changes", () => {
    let g = proofGame(["poisoner", "poisoner", "chef", "imp"]);
    const effect = (sourceId: string) => ({ id: "mutual-" + sourceId, type: "poisoned", state: "active" as const,
      sourceCharacter: "poisoner", sourceParticipant: { kind: "participant" as const, playerId: sourceId, participantId: g.players[sourceId]!.participantId!, nameAtTime: "Source" },
      lifetime: { kind: "throughFollowingDay" as const }, expiry: { kind: "at" as const, moment: { phase: "night" as const, day: 3 } }, appliedAt: { phase: "night" as const, day: 2 } });
    g = patchPlayer(g, "p0", { effects: [effect("p1")] });
    g = patchPlayer(g, "p1", { effects: [effect("p0")] });
    const before = JSON.stringify(g);
    expect(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p2") }, { withStep: true, completeStep: true }))).toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(g)).toBe(before);
    expect(g.history).toEqual([]);
    expect(g.nightProgress).toEqual({});
    expect(g.players.p0!.abilityUsed).toBe(false);
  });

  it("is a simple one-participant resolution (no confirmation) and records the step in the same snapshot", () => {
    const g = proofGame(ROLES);
    const result = plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }, { withStep: true, completeStep: true }));
    expect(result).toMatchObject({ ok: true, changed: true, plan: { needsConfirmation: false } });
    const next = planned(result);
    expect(Object.values(next.nightProgress)).toEqual([expect.objectContaining({ status: "done" })]);
  });
});

describe("Poisoner -- impairment and source applicability", () => {
  it("a poisoned or drunk Poisoner wakes and chooses but produces no Effect", () => {
    for (const type of ["poisoned", "drunk"]) {
      const g = impair(proofGame(ROLES), "p0", type);
      expect(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
      const stepOnly = planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }, { withStep: true, completeStep: true })));
      expect(stepOnly.players).toBe(g.players);
    }
  });

  it("a dead Poisoner has no ability (refused, nothing recorded)", () => {
    const g = patchPlayer(proofGame(ROLES), "p0", { alive: false });
    expect(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("the poison applies only while the Poisoner functions: death, impairment or a character change end it (derived, never rewritten)", () => {
    const g = proofGame(ROLES);
    const poisoned = planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") })));
    const effect = poisonOf(poisoned, "p1");
    expect(query(poisoned).effectApplies(bind(poisoned, "p1"), effect)).toEqual({ known: true, value: true });
    expect(query(poisoned).abilityFunctions(bind(poisoned, "p1"))).toEqual({ known: true, value: false });

    const dead = patchPlayer(poisoned, "p0", { alive: false });
    expect(query(dead).effectApplies(bind(dead, "p1"), effect)).toEqual({ known: true, value: false });
    expect(query(dead).abilityFunctions(bind(dead, "p1"))).toEqual({ known: true, value: true });

    const impaired = impair(poisoned, "p0", "drunk");
    expect(query(impaired).effectApplies(bind(impaired, "p1"), effect)).toEqual({ known: true, value: false });

    // The official example: a Poisoner who becomes the Imp no longer poisons.
    const becameImp = patchPlayer(poisoned, "p0", { actualRole: "imp" });
    expect(query(becameImp).effectApplies(bind(becameImp, "p1"), effect)).toEqual({ known: true, value: false });

    // The stored Effect itself is untouched in every case.
    for (const state of [dead, impaired, becameImp]) expect(poisonOf(state, "p1")).toBe(effect);
  });

  it("the poisoned target's own ability stops functioning (consumed by other evaluators)", () => {
    const g = proofGame(ROLES);
    const poisoned = planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p3") })));
    expect(query(poisoned).abilityFunctions(bind(poisoned, "p3"))).toEqual({ known: true, value: false });
  });
});

describe("Poisoner -- identity and ownership", () => {
  it("seat reuse: a stale target binding is refused, never redirected", () => {
    const g = proofGame(ROLES);
    const req = request(g, "p0", "poisoner", { target: pick(g, "p1") });
    expect(plan(reseat(g, "p1"), req)).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Poisoner reusing the official id inherits no semantics", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }), homebrewEnv("poisoner"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
