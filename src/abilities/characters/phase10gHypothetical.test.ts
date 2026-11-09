// Phase 10G Astra remediation (test-strength gap): hypothetical Rules Query
// overlays (`assumingAlive`) must preserve Game Rule Facts. Production already
// does; these tests pin it, so dropping the facts from a hypothetical snapshot
// turns them red (PHASE10G Sections 7 and 10; 10G-AC-07, AC-11).
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { PIT_HAG_ARBITRARY_DEATHS } from "@/stores/gameRuleFacts";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, pick, plan, proofGame, proofQuery, proofRegistry, proofScript, request, requirementIds, yes } from "@/test/proofFixtures";
import { deathAttempt } from "./shared";
import { choiceId } from "./alhadikhia";
import type { GameRuleFactRecord, StorytellerLobbyRecord } from "@/stores/types";
import { evaluateFixture } from "@/test/evaluatorFixture";

const arbitrary = (g: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...g, gameRuleFacts: [
  { type: PIT_HAG_ARBITRARY_DEATHS, recordedAt: { phase: "night", day: g.day }, expiresAt: { phase: "day", day: g.day } } as GameRuleFactRecord] });
// p0 imp, p1 chef, p2 monk, p3 poisoner, p4 empath, p5 saint, p6 washerwoman
const IMP_ROLES = ["imp", "chef", "monk", "poisoner", "empath", "saint", "washerwoman"];
const AL_ROLES = ["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
type Context = Parameters<typeof deathAttempt>[0];

describe("hypothetical Rules Query overlays preserve Game Rule Facts", () => {
  it("the arbitrary-deaths fact stays active under alive AND dead overlays, nested too", () => {
    const g = arbitrary(proofGame(IMP_ROLES));
    const base = proofQuery(g);
    expect(base.gameRuleFact(PIT_HAG_ARBITRARY_DEATHS)).toEqual({ known: true, value: true });
    const dead = base.assumingAlive(bind(g, "p1"), false);
    const alive = base.assumingAlive(bind(g, "p1"), true);
    const nested = dead.assumingAlive(bind(g, "p2"), false).assumingAlive(bind(g, "p1"), true);
    for (const query of [dead, alive, nested]) {
      expect(query.gameRuleFact(PIT_HAG_ARBITRARY_DEATHS)).toEqual({ known: true, value: true });
    }
    // The overlay really is hypothetical: Life changed, the fact did not.
    expect(dead.participant(bind(g, "p1"))?.alive).toBe(false);
    expect(base.participant(bind(g, "p1"))?.alive).toBe(true);
  });

  it("a death attempt evaluated against a hypothetical working query still reaches the shared arbitrary-death judgment", () => {
    const g = arbitrary(proofGame(IMP_ROLES));
    const context = { judgments: {}, query: proofQuery(g) } as unknown as Context;
    const working = proofQuery(g).assumingAlive(bind(g, "p2"), false);
    expect(deathAttempt(context, bind(g, "p1"), "demon", working)).toMatchObject({ kind: "ask", requirement: { id: expect.stringMatching(/^arbitraryDeath:demon:/) } });
  });

  it("Al-Hadikhia: after player 1 dies, player 2 is judged against the dead-overlay query -- and is still asked", () => {
    const al = arbitrary(proofGame(AL_ROLES));
    const die = { ...Object.fromEntries(["p1", "p2", "p3"].map((id, index) => [choiceId(index, bind(al, id)), yes(false)])) };
    const req = (judgments: Record<string, ReturnType<typeof yes>> = {}) =>
      request(al, "p0", "alhadikhia", { chosen: pick(al, "p1", "p2", "p3"), ...die }, { judgments });
    expect(plan(al, req())).toMatchObject({ ok: false, code: "unsupported" });
    const [first] = requirementIds(evaluateFixture(al, req()));
    expect(first).toMatch(/^arbitraryDeath:demon[:@]/);
    // Storyteller rules player 1 dies; the evaluator moves on with
    // query.assumingAlive(p1, false) -- player 2's attempt must still ask.
    const [second] = requirementIds(evaluateFixture(al, req({ [first!]: yes(false) })));
    expect(second).toMatch(/^arbitraryDeath:demon[:@]/);
    expect(second).not.toBe(first);
  });

  it("discriminates: a hypothetical snapshot WITHOUT the fact makes the same attempt deterministic", () => {
    // What the assertions above would observe if an overlay dropped the
    // game's Rule Facts: the death is forced, no judgment is asked.
    const g = arbitrary(proofGame(IMP_ROLES));
    const context = { judgments: {}, query: proofQuery(g) } as unknown as Context;
    const dropped = createRulesQuery({ ...g, gameRuleFacts: [], players: { ...g.players, p2: { ...g.players.p2!, alive: false } } },
      { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS });
    expect(dropped.gameRuleFact(PIT_HAG_ARBITRARY_DEATHS)).toEqual({ known: true, value: false });
    expect(deathAttempt(context, bind(g, "p1"), "demon", dropped)).toEqual({ kind: "dies" });
  });
});
