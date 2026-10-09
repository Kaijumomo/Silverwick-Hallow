import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { currentVotingState, freshVotingDay, planVoting } from "./voting";
import { applyRolePlan, changeRoleIntent, defaultRoleIds, planRoleTransaction } from "./roleResolution";

describe("Independent review: source lifecycle", () => {
  it("Bureaucrat choosing an unmodeled Goon is whole-action Manual", () => {
    const game = proofGame(["bureaucrat", "goon", "imp"], "night", 2, { voting: freshVotingDay(2) });
    const before = JSON.stringify(game);
    const result = planVoting(game, { kind: "bureaucrat", code: game.code, day: game.day,
      expectedRevision: currentVotingState(game).revision, modifierId: "review", source: bind(game, "p0"), target: bind(game, "p1") }, proofEnv());
    expect(result.ok).toBe(false);
    expect(JSON.stringify(game)).toBe(before);
  });

  it("source loss removes suppressed own effects but preserves a stale occupant's same-seat effect", () => {
    const game = proofGame(["poisoner", "chef", "empath"]);
    let produced = planned(plan(game, request(game, "p0", "poisoner", { target: pick(game, "p1") })));
    const current = produced.players.p1!.effects[0]!;
    const old = { ...current, id: "previous-occupant", sourceParticipant: { ...current.sourceParticipant!, kind: "participant" as const,
      playerId: "p0", participantId: "old-participant", nameAtTime: "Previous" } };
    produced = patchPlayer(produced, "p1", { effects: [{ ...current, state: "suppressed" }, old] });
    const result = planLifeTransaction(produced, { intents: [{ kind: "death", playerId: "p0" }] }, undefined, proofEnv());
    if (!result.ok || !result.changed) throw new Error("Expected death");
    const next = applyLifePlan(produced, result.plan);
    expect(next.players.p1!.effects.map(e => e.id)).toEqual(["previous-occupant"]);
  });

  it("losing a temporarily impaired Poisoner ends its old effect rather than allowing resumption", () => {
    const game = proofGame(["poisoner", "soldier", "imp"]);
    let produced = planned(plan(game, request(game, "p0", "poisoner", { target: pick(game, "p1") })));
    produced = impair(produced, "p0", "drunk");
    const result = planLifeTransaction(produced, { intents: [{ kind: "death", playerId: "p0" }, { kind: "resurrection", playerId: "p0" }] }, undefined, proofEnv());
    if (!result.ok || !result.changed) throw new Error("Expected death and return");
    const next = applyLifePlan(produced, result.plan);
    expect(next.players.p1!.effects).toEqual([]);
    expect(next.players.p0!.effects.map(effect => effect.type)).toEqual(["drunk"]);
    expect(proofQuery(next).protectedFrom(bind(next, "p1"), "demon")).toEqual({ known: true, value: true });
  });

  it("a baseline saved stale effect cannot revive when its original character is regained", () => {
    const game = proofGame(["poisoner", "chef", "empath"]);
    const produced = planned(plan(game, request(game, "p0", "poisoner", { target: pick(game, "p1") })));
    // This is representable in the protected baseline: its old role seam
    // retained source-dependent Effects after a character change.
    const restoredBaseline = patchPlayer(produced, "p0", { actualRole: "chef", shownRole: "chef" });
    expect(proofQuery(restoredBaseline).effectApplies(bind(restoredBaseline, "p1"), restoredBaseline.players.p1!.effects[0]!)).toEqual({ known: true, value: false });
    const result = planRoleTransaction(restoredBaseline, { intents: [changeRoleIntent(restoredBaseline.players.p0!, "poisoner")] }, { script: proofEnv().script, ids: defaultRoleIds });
    if (!result.ok || !result.changed) throw new Error("Expected character change");
    const next = applyRolePlan(restoredBaseline, result.plan);
    expect(next.players.p1!.effects).toEqual([]);
  });
});
