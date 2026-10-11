import { describe, expect, it } from "vitest";
import { impair, patchPlayer, proofEnv, proofGame } from "@/test/proofFixtures";
import { participantRefOf } from "./participants";
import { captureResolvedDemonDeath, captureSaintQualification, reconcileVictoryEvidence, validVictoryEvidence, type ResolvedDemonDeathMode, type VictoryEvidenceResult } from "./victoryEvidence";
import { RESOLVED_DEMON_DEATH_NO_SUCCESSOR, SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED, SAINT_EXECUTION_GOOD_TEAM_LOST, MAYOR_DAY_END_GOOD_TEAM_WON } from "./gameRuleFactRegistry";
import { applyGameRuleFactPlan, planGameRuleFactExpiry, planGameRuleFactTransaction } from "./gameRuleFacts";
import { StorytellerGamePersistedSchema } from "./schemas";
import { pruneLifeEventWindow } from "./lifeEvents";
import type { CurrentParticipantRef, StorytellerLobbyRecord } from "./types";
const env = proofEnv();
const value = (result: VictoryEvidenceResult) => { expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.message); return result.game; };
const base = (phase: "day" | "night" = "day") => proofGame(["imp", "slayer", "chef"], phase, 2);
function death(game: StorytellerLobbyRecord, target = "p0", execution = false): StorytellerLobbyRecord {
  const common = { id: `death-${target}`, subject: participantRefOf(game, target) as CurrentParticipantRef, actualRoleAtEvent: game.players[target]!.actualRole, resolutionId: "shared-action" };
  return { ...patchPlayer(game, target, { alive: false }), lifeEventWindow: { ...game.lifeEventWindow, events: [...game.lifeEventWindow.events,
    execution ? { ...common, kind: "execution", outcome: "died", moment: { phase: "day", day: game.day } } : { ...common, kind: "death", moment: { phase: game.phase as "day" | "night", day: game.day } },
  ] } };
}
const capture = (game = base(), mode: ResolvedDemonDeathMode = "recordedDay", target = "p0", execution = false) => value(captureResolvedDemonDeath(game, death(game, target, execution), `death-${target}`, env, mode));

describe("B8 resolved Demon death evidence", () => {
  it.each(["recordedDay", "recordedNight", "automaticImp", "automaticSlayer"] as const)("%s captures exact completed death without a successor", mode => {
    const before = base(mode === "recordedNight" || mode === "automaticImp" ? "night" : "day");
    const result = capture(before, mode);
    expect(result.gameRuleFacts).toEqual([expect.objectContaining({ type: RESOLVED_DEMON_DEATH_NO_SUCCESSOR, resolutionId: "death-p0", recordedAt: { phase: before.phase, day: 2 }, expiresAt: { phase: before.phase, day: 3 }, provenance: { sourceCharacter: "imp", sourceParticipant: participantRefOf(before, "p0") } })]);
    expect(result.result).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(result))).success).toBe(true);
  });
  it("execution death qualifies but shared action resolution is never the event link", () => {
    const result = capture(base(), "recordedDay", "p0", true);
    expect(result.gameRuleFacts[0]?.resolutionId).toBe("death-p0");
    const corrupt = structuredClone(result); corrupt.gameRuleFacts[0]!.resolutionId = "shared-action";
    expect(StorytellerGamePersistedSchema.safeParse(corrupt).success).toBe(false);
  });
  it.each(["recordedNight", "automaticImp"] as const)("%s cannot turn possible Minions or ambiguous Recluse into completion", mode => {
    for (const role of ["poisoner", "scarletwoman", "spy", "recluse"]) {
      const before = proofGame(["imp", role, "chef"], "night", 2);
      expect(capture(before, mode).gameRuleFacts).toEqual([]);
    }
    const impairedRecluse = impair(proofGame(["imp", "recluse", "chef"], "night", 2), "p1");
    expect(capture(impairedRecluse, mode).gameRuleFacts).toHaveLength(1);
  });
  it("Scarlet Woman at five must resolve before capture; poison is evaluated before death", () => {
    const before = proofGame(["imp", "scarletwoman", "slayer", "chef", "empath"], "day", 2);
    expect(capture(before).gameRuleFacts).toEqual([]);
    const impaired = impair(before, "p1");
    const qualified = capture(impaired);
    expect(qualified.gameRuleFacts).toHaveLength(1);
    const expired = patchPlayer({ ...qualified, phase: "night", day: 3 }, "p1", { effects: [] });
    expect(value(reconcileVictoryEvidence(qualified, expired)).gameRuleFacts).toEqual(qualified.gameRuleFacts);
    expect(StorytellerGamePersistedSchema.safeParse(expired).success).toBe(true);
  });
  it("Scarlet Woman at four does not succeed and Travellers do not reach the threshold", () => {
    expect(capture(proofGame(["imp", "scarletwoman", "slayer", "chef"], "day", 2)).gameRuleFacts).toHaveLength(1);
    expect(capture(patchPlayer(proofGame(["imp", "scarletwoman", "slayer", "chef", "beggar"], "day", 2), "p4", { isTraveler: true })).gameRuleFacts).toHaveLength(1);
  });
  it("a successor or multiple living Demons never produce no-successor evidence", () => {
    const before = proofGame(["imp", "poisoner", "chef"], "night", 2);
    const after = patchPlayer(death(before), "p1", { actualRole: "imp" });
    expect(value(captureResolvedDemonDeath(before, after, "death-p0", env, "automaticImp")).gameRuleFacts).toEqual([]);
    expect(capture(proofGame(["imp", "imp", "chef"], "day", 2)).gameRuleFacts).toEqual([]);
  });
  it("multi-event chains, old deaths, phase mismatch and source replacements cannot backfill", () => {
    const before = base(); const after = death(before);
    expect(value(captureResolvedDemonDeath(after, after, "death-p0", env, "recordedDay")).gameRuleFacts).toEqual([]);
    expect(value(captureResolvedDemonDeath(before, death(after, "p1"), "death-p0", env, "recordedDay")).gameRuleFacts).toEqual([]);
    expect(value(captureResolvedDemonDeath(before, { ...after, phase: "night", day: 3 }, "death-p0", env, "recordedDay")).gameRuleFacts).toEqual([]);
    expect(value(captureResolvedDemonDeath(before, patchPlayer(after, "p0", { participantId: "replacement" }), "death-p0", env, "recordedDay")).gameRuleFacts).toEqual([]);
    expect(capture(base("night"), "recordedDay").gameRuleFacts).toEqual([]);
  });
  it("refuses generic application including arbitrary claimed provenance", () => {
    expect(planGameRuleFactTransaction(base(), { intents: [{ kind: "apply", type: RESOLVED_DEMON_DEATH_NO_SUCCESSOR }], resolutionId: "death-p0", context: { provenance: { sourcePlayer: "p0", sourceCharacter: "imp" } } }).ok).toBe(false);
  });
  it.each(["day", "night"] as const)("retention follows exact %s trigger window then expires atomically", phase => {
    const captured = capture(base(phase), phase === "day" ? "recordedDay" : "recordedNight");
    const following = { ...captured, phase: phase === "day" ? "night" as const : "day" as const, day: phase === "day" ? 3 : 2 };
    expect(validVictoryEvidence(following)).toHaveLength(1);
    const destination = { phase, day: 3 };
    const expiry = planGameRuleFactExpiry(following, destination)!;
    const expired = applyGameRuleFactPlan({ ...following, ...destination, lifeEventWindow: pruneLifeEventWindow(following.lifeEventWindow, phase, 3) }, expiry);
    expect(expired.gameRuleFacts).toEqual([]);
    expect(expired.lifeEventWindow.events).toEqual([]);
    expect(StorytellerGamePersistedSchema.safeParse(expired).success).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(captured).success).toBe(true); // Undo snapshot remains valid.
  });
  it("retraction, resurrection, corrections, role/participant/game boundaries invalidate proof", () => {
    const captured = capture();
    const variants = [
      { ...captured, lifeEventWindow: { ...captured.lifeEventWindow, events: [] } },
      patchPlayer(captured, "p0", { alive: true }),
      patchPlayer(captured, "p0", { actualRole: "chef" }),
      patchPlayer(captured, "p0", { participantId: "new-person" }),
      { ...captured, code: "OTHERGAME" },
    ];
    for (const after of variants) expect(value(reconcileVictoryEvidence(captured, after)).gameRuleFacts).toEqual([]);
    expect(value(reconcileVictoryEvidence(captured, impair(captured, "p1"), { correction: true })).gameRuleFacts).toEqual([]);
    expect(value(reconcileVictoryEvidence(captured, captured))).toBe(captured);
  });
  it("retains negative Saint proof beside later resolved Demon death", () => {
    const before = impair(proofGame(["saint", "imp", "slayer", "chef"], "day", 2), "p0");
    const saint = value(captureSaintQualification(before, death(before, "p0", true), "death-p0", env));
    expect(saint.gameRuleFacts[0]?.type).toBe(SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED);
    const demon = capture(saint, "automaticSlayer", "p1");
    expect(demon.gameRuleFacts.map(fact => fact.type)).toEqual([SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED, RESOLVED_DEMON_DEATH_NO_SUCCESSOR]);
    expect(validVictoryEvidence(demon)).toHaveLength(2);
    expect(StorytellerGamePersistedSchema.safeParse(demon).success).toBe(true);
    const conflicting = structuredClone(demon); conflicting.gameRuleFacts[0]!.type = SAINT_EXECUTION_GOOD_TEAM_LOST;
    expect(StorytellerGamePersistedSchema.safeParse(conflicting).success).toBe(false);
    expect(validVictoryEvidence(conflicting)).toEqual([]);
  });
  it("does not overwrite an earlier ordinary, Saint or Mayor ending", () => {
    expect(capture(proofGame(["imp", "slayer"], "day", 2)).gameRuleFacts).toEqual([]);
    const prior = proofGame(["saint", "imp", "slayer", "chef", "empath"], "day", 2);
    const saint = value(captureSaintQualification(prior, death(prior, "p0", true), "death-p0", env));
    expect(capture(saint, "automaticSlayer", "p1").gameRuleFacts).toEqual(saint.gameRuleFacts);
    const night = base("night");
    night.gameRuleFacts = [{ type: MAYOR_DAY_END_GOOD_TEAM_WON, recordedAt: { phase: "day", day: 1 }, expiresAt: { phase: "day", day: 2 }, provenance: { sourceCharacter: "mayor", sourceParticipant: participantRefOf(night, "p1")! } }];
    expect(capture(night, "recordedNight").gameRuleFacts).toEqual(night.gameRuleFacts);
  });
});
