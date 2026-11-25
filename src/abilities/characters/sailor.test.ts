// @vitest-environment node
// BM-1b -- Sailor. https://wiki.bloodontheclocktower.com/Sailor  Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { interactionCoverageEligibility } from "@/abilities/automationEligibility";
import { executionAdvice, executionChoiceFor, executionSurvivalKnown } from "@/stores/executionAdvice";
import { sailorDrunkId } from "./sailor";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, requirementIds, yes } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const env = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] };
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, env);
// p0 sailor, p1 chef (Townsfolk), p2 imp, p3 monk, p4 saint (Outsider)
const ROLES = ["sailor", "chef", "imp", "monk", "saint"];
const drunkEffect = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "drunk" && e.sourceCharacter === "sailor");
const choose = (g: StorytellerLobbyRecord, target: string, chosenDrunk?: boolean, actor = "p0") =>
  plan(g, request(g, actor, "sailor", { target: pick(g, target), ...(chosenDrunk === undefined ? {} : { [sailorDrunkId(g.players[target]!.participantId!)]: yes(chosenDrunk) }) }));
const functions = (g: StorytellerLobbyRecord, id: string) => query(g).abilityFunctions(bind(g, id));

describe("Sailor: the nightly choice", () => {
  it("asks who is drunk when another player is chosen (nothing pre-selected)", () => {
    const g = proofGame(ROLES);
    const result = choose(g, "p1");
    expect(result).toMatchObject({ ok: false, code: "needsInput" });
    expect(requirementIds(result)).toEqual([sailorDrunkId(g.players.p1!.participantId!)]);
  });
  it("makes the chosen player drunk until dusk when the Storyteller says so", () => {
    const g = proofGame(ROLES);
    const next = planned(choose(g, "p1", true));
    expect(drunkEffect(next, "p1")).toMatchObject({ lifetime: { kind: "throughFollowingDay" }, expiry: { kind: "at", moment: { phase: "night", day: 3 } },
      sourceParticipant: { kind: "participant", participantId: g.players.p0!.participantId } });
    expect(drunkEffect(next, "p0")).toBeUndefined();
    expect(functions(next, "p1")).toEqual({ known: true, value: false });
    expect(functions(next, "p0")).toEqual({ known: true, value: true });
  });
  it("makes the Sailor the drunk one when the Storyteller says so, and a drunk Sailor can die", () => {
    const g = proofGame(ROLES);
    const next = planned(choose(g, "p4", false));
    expect(drunkEffect(next, "p0")).toBeDefined();
    expect(drunkEffect(next, "p4")).toBeUndefined();
    expect(functions(next, "p0")).toEqual({ known: true, value: false });
    expect(query(next).deathOutcome(bind(next, "p0"), "demon")).toEqual({ known: true, value: { kind: "dies" } });
  });
  it("asks nothing when the Sailor chooses themself: they are the drunk one", () => {
    const g = proofGame(ROLES);
    const next = planned(choose(g, "p0"));
    expect(drunkEffect(next, "p0")).toBeDefined();
    expect(functions(next, "p0")).toEqual({ known: true, value: false });
    expect(query(next).deathOutcome(bind(next, "p0"), "execution")).toEqual({ known: true, value: { kind: "dies" } });
  });
  it("refuses a dead player", () => {
    const g = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    expect(choose(g, "p1", true)).toMatchObject({ ok: false, code: "illegal" });
  });
  it("also wakes on the first night", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(choose(g, "p1", true)).toMatchObject({ ok: true, changed: true });
  });
  it.each(["poisoned", "drunk"])("a %s Sailor chooses and nothing happens, nothing asked", type => {
    const g = impair(proofGame(ROLES), "p0", type);
    expect(choose(g, "p1")).toEqual({ ok: true, changed: false });
  });
  it("a corrected pick replaces the earlier DRUNK", () => {
    const g = proofGame(ROLES);
    const first = planned(choose(g, "p1", true));
    const second = planned(choose(first, "p4", true));
    expect(drunkEffect(second, "p1")).toBeUndefined();
    expect(drunkEffect(second, "p4")).toBeDefined();
  });
});

describe("Sailor: the drunkenness ends when the source stops having the ability (Abilities page)", () => {
  it("the chosen player is sober again if the Sailor becomes poisoned later the same night", () => {
    const next = planned(choose(proofGame(ROLES), "p1", true));
    expect(functions(next, "p1")).toEqual({ known: true, value: false });
    const poisoned = impair(next, "p0", "poisoned");
    expect(functions(poisoned, "p1")).toEqual({ known: true, value: true });
  });
  it("and the poisoned Sailor can then die", () => {
    const poisoned = impair(planned(choose(proofGame(ROLES), "p1", true)), "p0", "poisoned");
    expect(query(poisoned).deathOutcome(bind(poisoned, "p0"), "demon")).toEqual({ known: true, value: { kind: "dies" } });
  });
  it("a Sailor who died (a drunk one) takes their drunkenness with them", () => {
    const next = planned(choose(proofGame(ROLES), "p1", true));
    expect(functions(patchPlayer(next, "p0", { alive: false }), "p1")).toEqual({ known: true, value: true });
  });
});

describe("Sailor: can't die while sober", () => {
  const g = () => proofGame(ROLES, "day", 2);
  it.each(["demon", "execution", "any"] as const)("a sober Sailor survives a %s death", cause => {
    expect(query(g()).deathOutcome(bind(g(), "p0"), cause)).toEqual({ known: true, value: { kind: "survives", spends: false } });
  });
  it("a drunk or poisoned Sailor does not", () => {
    for (const type of ["drunk", "poisoned"]) {
      const game = impair(g(), "p0", type);
      expect(query(game).deathOutcome(bind(game, "p0"), "demon")).toEqual({ known: true, value: { kind: "dies" } });
    }
  });
  it("is not wholly manual any more: a game with a Sailor is covered", () => {
    expect(interactionCoverageEligibility(query(g()))).toEqual({ kind: "automated" });
  });
});

describe("Sailor: an execution (BM-1 Q1)", () => {
  const day = (roles = ROLES) => proofGame(roles, "day", 2);
  it("a sober Sailor's execution is a certain survival: Execute records it by itself", () => {
    expect(executionSurvivalKnown(day(), "p0", env)).toBe(true);
    expect(executionAdvice(day(), "p0", env)).toMatchObject({ kind: "survives", spends: false });
  });
  it("a drunk Sailor's execution is not", () => {
    expect(executionSurvivalKnown(impair(day(), "p0", "drunk"), "p0", env)).toBe(false);
  });
  it("a sober Sailor with a living Pacifist: the survival is certain, so no Pacifist question and nothing says why", () => {
    const game = day(["sailor", "chef", "imp", "pacifist", "saint"]);
    expect(executionSurvivalKnown(game, "p0", env)).toBe(true);
    // the question would otherwise apply to a good player
    expect(executionChoiceFor(game, "p0", env)).toEqual(["Pacifist"]);
  });
  it("a Fool (survival spends the ability) still asks", () => {
    expect(executionSurvivalKnown(day(["fool", "chef", "imp", "monk", "saint"]), "p0", env)).toBe(false);
  });
});
