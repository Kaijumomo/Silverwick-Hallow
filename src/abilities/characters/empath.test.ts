// Phase 10F Slice 7 -- Empath support semantic + Drunk shown as the Empath
// (matrix Sections 8 and 18.2). Production semantics.
import { describe, expect, it } from "vitest";
import { CANONICAL_ABILITY_SEMANTICS, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { COMMUNICATED, EMPATH, EMPATH_JUDGMENT } from "./empath";
import { homebrewEnv, impair, num, patchPlayer, plan, planned, proofEnv, proofGame, request, requirementIds } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Ring: p6 (poisoner, evil) - p0 (empath) - p1 (imp, evil) - p2 (chef) ...
const ROLES = ["empath", "imp", "chef", "monk", "saint", "drunk", "poisoner"];
const drunkAsEmpath = (g: StorytellerLobbyRecord) =>
  patchPlayer(g, "p5", { shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
const delivered = (g: StorytellerLobbyRecord) => g.informationDeliveries.at(-1)!;

describe("Empath -- functioning actual Empath", () => {
  it("computes 2 / 1 / 0 from the closest LIVING neighbours and records it exactly", () => {
    const g = proofGame(ROLES);
    const two = planned(plan(g, request(g, "p0", "empath")));
    expect(delivered(two)).toMatchObject({ actualRole: "empath", informationActionId: "empath-other-night",
      values: [{ requirementId: "evilNeighbors", kind: "number", value: 2 }] });
    expect(delivered(two).performedRole).toBeUndefined();
    expect(two.players).toBe(g.players);

    const oneEvil = patchPlayer(g, "p6", { actualRole: "chef", actualAlignment: "good" });
    expect(delivered(planned(plan(oneEvil, request(oneEvil, "p0", "empath")))).values[0]).toMatchObject({ value: 1 });
    const noneEvil = patchPlayer(oneEvil, "p1", { actualRole: "monk", actualAlignment: "good" });
    expect(delivered(planned(plan(noneEvil, request(noneEvil, "p0", "empath")))).values[0]).toMatchObject({ value: 0 });
  });

  it("skips dead neighbours (the next living player counts)", () => {
    // p1 (imp) dead -> right neighbour is p2 (chef); left p6 (poisoner) evil.
    const g = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    expect(delivered(planned(plan(g, request(g, "p0", "empath")))).values[0]).toMatchObject({ value: 1 });
  });

  it("Night 1 uses the first-night Information Action", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(delivered(planned(plan(g, request(g, "p0", "empath")))).informationActionId).toBe("empath-first-night");
  });

  it("an ambiguous neighbour registration asks the Storyteller for the final 0/1/2", () => {
    const g = patchPlayer(proofGame(ROLES), "p6", { actualRole: "spy" }); // may misregister
    const asked = plan(g, request(g, "p0", "empath"));
    expect(requirementIds(asked)).toEqual([EMPATH_JUDGMENT]);
    const judged = plan(g, request(g, "p0", "empath", {}, { judgments: { [EMPATH_JUDGMENT]: num(1) } }));
    expect(delivered(planned(judged)).values[0]).toMatchObject({ value: 1 });
    expect(judged).toMatchObject({ plan: { needsConfirmation: true } });
    expect(plan(g, request(g, "p0", "empath", {}, { judgments: { [EMPATH_JUDGMENT]: num(3) } }))).toMatchObject({ ok: false, code: "illegal" });
  });

  it("an impaired Empath: the Storyteller chooses the number shown (no calculation)", () => {
    const g = impair(proofGame(ROLES), "p0");
    expect(requirementIds(plan(g, request(g, "p0", "empath")))).toEqual([COMMUNICATED]);
    expect(delivered(planned(plan(g, request(g, "p0", "empath", { [COMMUNICATED]: num(0) })))).values[0]).toMatchObject({ value: 0 });
  });

  it("a dead Empath has no ability", () => {
    const g = patchPlayer(proofGame(ROLES), "p0", { alive: false });
    expect(plan(g, request(g, "p0", "empath"))).toMatchObject({ ok: false, code: "notApplicable" });
  });
});

describe("Drunk shown as the Empath -- simulated Information proof", () => {
  it("Actual Role stays Drunk; the Storyteller's arbitrary 0/1/2 is recorded with performedRole empath and NO Current State", () => {
    const g = drunkAsEmpath(proofGame(ROLES));
    expect(plan(g, request(g, "p5", "empath"))).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: COMMUNICATED, source: "storyteller" }] });
    for (const value of [0, 1, 2]) {
      const next = planned(plan(g, request(g, "p5", "empath", { [COMMUNICATED]: num(value) })));
      expect(delivered(next)).toMatchObject({ actualRole: "drunk", performedRole: "empath", informationActionId: "empath-other-night",
        values: [{ requirementId: "evilNeighbors", kind: "number", value }] });
      expect(next.players).toBe(g.players);
      expect(next.history).toBe(g.history);
      expect(next.players.p5!.actualRole).toBe("drunk");
    }
    expect(plan(g, request(g, "p5", "empath", { [COMMUNICATED]: num(7) }))).toMatchObject({ ok: false, code: "illegal" });
  });

  it("a simulated wake cannot smuggle a mechanical operation (coordinator-enforced)", () => {
    const g = drunkAsEmpath(proofGame(ROLES));
    const smuggling: AbilitySemanticsRegistry = new Map([...CANONICAL_ABILITY_SEMANTICS, ["empath", { ...EMPATH, evaluator: (context) => ({ kind: "outcome", outcome: { operations: [
      { domain: "effect", intents: [{ kind: "apply", target: context.actor.binding, effect: { type: "poisoned", lifetime: { kind: "manual" } } }] },
    ] } }) }]]);
    expect(plan(g, request(g, "p5", "empath"), proofEnv({ semantics: smuggling }))).toMatchObject({ ok: false, code: "illegal" });
  });
});

describe("Empath -- ownership", () => {
  it("a homebrew Empath reusing the official id inherits no semantics", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "empath"), homebrewEnv("empath"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
