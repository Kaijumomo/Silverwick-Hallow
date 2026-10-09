import { describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { applyLifePlan, planLifeTransaction } from "@/stores/lifeResolution";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { buildCoverageManifest, coverageSummary } from "@/abilities/coverage";

// Independently authored acceptance probes for the frozen rules slice.
// Official Soldier: wiki.bloodontheclocktower.com/Soldier
// Official Vortox: wiki.bloodontheclocktower.com/Vortox
describe("Independent Character Intelligence rules review", () => {
  it("healthy Soldier survives a completed Night attack without any protection token", () => {
    const game = proofGame(["imp", "soldier", "chef"]);
    const before = JSON.stringify(game);
    const result = plan(game, request(game, "p0", "imp", { target: pick(game, "p1") }, { withStep: true, completeStep: true }));
    const next = planned(result);
    expect(next.players.p1!.alive).toBe(true);
    expect(next.players.p1!.effects).toEqual([]);
    expect(next.lifeEventWindow.events).toEqual(game.lifeEventWindow.events);
    expect(Object.values(next.nightProgress)).toEqual([expect.objectContaining({ status: "done" })]);
    expect(JSON.stringify(game)).toBe(before);
  });
  it("poisoned Soldier dies to the Imp and serializes a real Life event", () => {
    const game = impair(proofGame(["imp", "soldier", "chef"]), "p1");
    const next = planned(plan(game, request(game, "p0", "imp", { target: pick(game, "p1") })));
    const saved = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(next)));
    expect(saved.players.p1!.alive).toBe(false);
    expect(saved.lifeEventWindow.events).toContainEqual(expect.objectContaining({ kind: "death", subject: expect.objectContaining({ playerId: "p1" }) }));
  });
  it("Poisoner source death restores Soldier protection before the later attack", () => {
    const game = proofGame(["imp", "soldier", "poisoner", "chef"]);
    const poisoned = planned(plan(game, request(game, "p2", "poisoner", { target: pick(game, "p1") })));
    expect(proofQuery(poisoned).protectedFrom(bind(poisoned, "p1"), "demon")).toEqual({ known: true, value: false });
    const loss = planLifeTransaction(poisoned, { intents: [{ kind: "death", playerId: "p2" }] }, undefined, proofEnv());
    if (!loss.ok || !loss.changed) throw new Error("Expected source death");
    const protectedAgain = applyLifePlan(poisoned, loss.plan);
    expect(plan(protectedAgain, request(protectedAgain, "p0", "imp", { target: pick(protectedAgain, "p1") }))).toEqual({ ok: true, changed: false });
  });
  it("a homebrew Soldier ID cannot authorize an Imp outcome", () => {
    const game = proofGame(["imp", "soldier", "chef"]);
    const before = JSON.stringify(game);
    expect(plan(game, request(game, "p0", "imp", { target: pick(game, "p1") }), homebrewEnv("soldier"))).toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(game)).toBe(before);
  });
  it("Vortox cannot be bypassed with prior modifier judgments or a supplied impaired answer", () => {
    for (const game of [proofGame(["empath", "vortox", "chef"]), impair(proofGame(["empath", "vortox", "chef"]), "p0")]) {
      const before = JSON.stringify(game);
      const result = plan(game, request(game, "p0", "empath", { communicated: { kind: "number", value: 0 } }, {
        judgments: { "modifier:character:vortox": { kind: "boolean", value: true }, "empath:evilNeighbours": { kind: "number", value: 0 } },
        withStep: true, completeStep: true,
      }));
      expect(result).toMatchObject({ ok: false, code: "unsupported" });
      expect(JSON.stringify(game)).toBe(before);
    }
  });
  it("two Vortox sources are checked independently and impairment is temporary", () => {
    const game = proofGame(["empath", "vortox", "vortox", "chef"]);
    const oneLost = impair(game, "p1");
    expect(plan(oneLost, request(oneLost, "p0", "empath"))).toMatchObject({ ok: false, code: "unsupported" });
    const bothLost = patchPlayer(oneLost, "p2", { alive: false });
    expect(plan(bothLost, request(bothLost, "p0", "empath")).ok).toBe(true);
    const recovered = patchPlayer(bothLost, "p1", { effects: [] });
    expect(plan(recovered, request(recovered, "p0", "empath"))).toMatchObject({ ok: false, code: "unsupported" });
  });
  it("ordinary Poisoner targeting remains available with Vortox in play", () => {
    const game = proofGame(["poisoner", "vortox", "chef"]);
    expect(planned(plan(game, request(game, "p0", "poisoner", { target: pick(game, "p2") }))).players.p2!.effects).toHaveLength(1);
  });
  it("inventory reports all 181 characters independently of jinxes without expanding evaluators", () => {
    const entries = buildCoverageManifest();
    expect(coverageSummary(entries)).toMatchObject({ characterTotal: 181, jinxTotal: 131, total: 312 });
    expect(entries.filter(entry => entry.kind !== "jinx" && entry.capabilities?.some(c => c.owner === "abilities" && c.boundary.startsWith("Registered")))).toHaveLength(11);
    expect(entries.find(entry => entry.id === "bureaucrat")?.capabilities?.map(c => c.owner)).toContain("voting");
  });
});
