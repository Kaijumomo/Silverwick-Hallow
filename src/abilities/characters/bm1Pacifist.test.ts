// @vitest-environment node
import { describe, expect, it } from "vitest";
import { impair, patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { executionAdvice, executionChoiceFor, executionDeathKnown, executionSurvivalKnown } from "@/stores/executionAdvice";

// BM-1a: the Pacifist question appears only when the Pacifist could matter. https://wiki.bloodontheclocktower.com/Pacifist
// "When a good player is executed, the Storyteller chooses whether they die or live." A drunk Pacifist saves nobody (page example 3).
const env = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
// p0 imp (evil), p1 chef (good), p2 pacifist, p3 monk
const day = () => proofGame(["imp", "chef", "pacifist", "monk"], "day", 2);

describe("BM-1a: the Pacifist question", () => {
  it("is asked for a good executed player while a sober Pacifist lives", () => {
    expect(executionChoiceFor(day(), "p1", env)).toEqual(["Pacifist"]);
    expect(executionDeathKnown(day(), "p1", env)).toBe(true); // the rules do not decide it; the prompt does
  });
  it("covers the Pacifist's own execution (a good player)", () => {
    expect(executionChoiceFor(day(), "p2", env)).toEqual(["Pacifist"]);
  });
  it("is not asked for an evil executed player", () => {
    expect(executionChoiceFor(day(), "p0", env)).toEqual([]);
  });
  it.each(["poisoned", "drunk"])("is not asked while the Pacifist is %s", type => {
    expect(executionChoiceFor(impair(day(), "p2", type), "p1", env)).toEqual([]);
  });
  it("is asked while the Pacifist's sobriety is unknown", () => {
    expect(executionChoiceFor(impair(day(), "p2", "soberHealthy"), "p1", env)).toEqual(["Pacifist"]);
  });
  it("is not asked once the Pacifist is dead", () => {
    expect(executionChoiceFor(patchPlayer(day(), "p2", { alive: false }), "p1", env)).toEqual([]);
  });
  it("is asked when a Recluse might register as evil (the Storyteller decides)", () => {
    const game = proofGame(["imp", "recluse", "pacifist", "monk"], "day", 2);
    expect(executionChoiceFor(game, "p1", env)).toEqual(["Pacifist"]);
  });
  it("without a rules environment every living Pacifist still counts, as before", () => {
    expect(executionChoiceFor(impair(day(), "p2", "poisoned"), "p1")).toEqual(["Pacifist"]);
  });
  it("a Pacifist changes nothing about advice: no protection is known, so nothing is certain to survive", () => {
    expect(executionAdvice(day(), "p1", env)).toBeNull();
    expect(executionSurvivalKnown(day(), "p1", env)).toBe(false);
  });
});
