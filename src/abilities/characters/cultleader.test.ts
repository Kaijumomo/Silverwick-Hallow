// Phase 10F Slice 7 -- Cult Leader nightly portion (matrix Section 11).
import { describe, expect, it } from "vitest";
import { ALIGNMENT_CHOICE, ALIGNMENT_JUDGMENT } from "./cultleader";
import { homebrewEnv, impair, patchPlayer, plan, planned, proofGame, request, requirementIds } from "@/test/proofFixtures";
import { pathAbility } from "@/features/abilities/abilityUi";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { proofRegistry } from "@/test/proofFixtures";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Ring: p6 - p0 (cult leader) - p1
const base = (left: string, right: string) => proofGame(["cultleader", right, "chef", "monk", "saint", "empath", left]);
const run = (g: StorytellerLobbyRecord, extra = {}) => plan(g, request(g, "p0", "cultleader", {}, extra));
const evil: AbilityInputValue = { kind: "alignment", alignment: "evil" };
const good: AbilityInputValue = { kind: "alignment", alignment: "good" };

describe("Cult Leader -- nightly alignment", () => {
  it("good/good: stays good -> nothing is recorded (no invented wake)", () => {
    expect(run(base("chef", "monk"))).toEqual({ ok: true, changed: false });
  });

  it("evil/evil: becomes evil -- Actual Alignment FIRST, then the player-facing alignment", () => {
    const g = base("poisoner", "imp");
    const result = run(g);
    const next = planned(result);
    expect(next.players.p0).toMatchObject({ actualAlignment: "evil", shownAlignment: "evil", actualRole: "cultleader", shownRole: "cultleader" });
    if (result.ok && result.changed) {
      expect(result.plan.outcome.mechanicalOrder).toBe("declared");
      expect(result.plan.outcome.operations.map((o) => o.domain)).toEqual(["alignment", "role"]);
      expect(result.plan.needsConfirmation).toBe(true);
    }
  });

  it("split good/evil: the Storyteller chooses either result", () => {
    const g = base("poisoner", "chef");
    expect(requirementIds(run(g))).toEqual([ALIGNMENT_CHOICE]);
    expect(planned(run(g, { inputs: { [ALIGNMENT_CHOICE]: evil } })).players.p0!.actualAlignment).toBe("evil");
    expect(run(g, { inputs: { [ALIGNMENT_CHOICE]: good } })).toEqual({ ok: true, changed: false });
  });

  it("dead players are skipped: the nearest LIVING neighbours count", () => {
    const g = patchPlayer(base("chef", "monk"), "p1", { alive: false }); // p1 dead -> p2 (chef)
    expect(run(g)).toEqual({ ok: true, changed: false });
    const evilBeyond = patchPlayer(patchPlayer(base("poisoner", "monk"), "p1", { alive: false }), "p2", { actualRole: "imp", actualAlignment: "evil" });
    expect(planned(run(evilBeyond)).players.p0!.actualAlignment).toBe("evil");
  });

  it("ambiguous registration keeps the whole action Manual even with a legacy judgment", () => {
    const g = base("spy", "imp");
    expect(run(g)).toMatchObject({ ok: false, code: "unsupported" });
    expect(run(g, { judgments: { [ALIGNMENT_JUDGMENT]: evil } })).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.players.p0!.actualAlignment).toBe("good");
  });

  it("an evil Cult Leader between two good neighbours becomes good again", () => {
    const g = patchPlayer(base("chef", "monk"), "p0", { actualAlignment: "evil", shownAlignment: "evil" });
    expect(planned(run(g)).players.p0).toMatchObject({ actualAlignment: "good", shownAlignment: "good" });
  });

  it("an impaired Cult Leader changes nothing", () => {
    expect(run(impair(base("poisoner", "imp"), "p0"))).toEqual({ ok: true, changed: false });
  });

  it("a homebrew Cult Leader reusing the official id inherits no semantics", () => {
    const g = base("poisoner", "imp");
    expect(plan(g, request(g, "p0", "cultleader"), homebrewEnv("cultleader"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Cult Leader -- Day cult vote stays Manual", () => {
  it("the Day entry offers no guided cult action (verified-manual boundary)", () => {
    const g = proofGame(["cultleader", "chef"], "day", 2);
    expect(pathAbility("cultleader", proofRegistry, CANONICAL_ABILITY_SEMANTICS, "dayEntry", g)).toMatchObject({ kind: "manual" });
    expect(plan(g, request(g, "p0", "cultleader", {}, { invocationPath: "dayEntry" }))).toMatchObject({ ok: false, code: "notApplicable" });
  });
});
