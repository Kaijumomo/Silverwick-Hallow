import { describe, expect, it } from "vitest";
import { impair, patchPlayer, proofEnv, proofGame } from "@/test/proofFixtures";
import { participantRefOf } from "./participants";
import { captureMayorQualification, captureSaintQualification, reconcileVictoryEvidence, validVictoryEvidence, victoryCoverageEligibility, type VictoryEvidenceResult } from "./victoryEvidence";
import { SAINT_EXECUTION_GOOD_TEAM_LOST, SAINT_EXECUTION_EVIL_TEAM_LOST, SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED, SAINT_EXECUTION_EVIL_TEAM_NOT_QUALIFIED, MAYOR_DAY_END_GOOD_TEAM_WON, MAYOR_DAY_END_EVIL_TEAM_WON, VICTORY_EVIDENCE_TYPES, isSaintNonqualifyingEvidenceType } from "./gameRuleFactRegistry";
import { applyGameRuleFactPlan, planGameRuleFactExpiry, planGameRuleFactTransaction } from "./gameRuleFacts";
import { StorytellerGamePersistedSchema } from "./schemas";
import type { CurrentParticipantRef, StorytellerLobbyRecord } from "./types";
const env = proofEnv();
const saint = () => proofGame(["saint", "chef", "imp"], "day", 2);
const mayor = () => proofGame(["mayor", "chef", "imp"], "day", 2);
const ref = (game: StorytellerLobbyRecord) => participantRefOf(game, "p0") as CurrentParticipantRef;
const executed = (game: StorytellerLobbyRecord, outcome: "died" | "survived" = "died"): StorytellerLobbyRecord => ({ ...patchPlayer(game, "p0", { alive: outcome !== "died" }), lifeEventWindow: { ...game.lifeEventWindow, events: [...game.lifeEventWindow.events, { id: "exact-execution", kind: "execution", subject: ref(game), actualRoleAtEvent: game.players.p0!.actualRole, moment: { phase: "day", day: game.day }, outcome, resolutionId: "shared-action" }] } });
const nextNight = (game: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...game, phase: "night", day: game.day + 1 });
const value = (result: VictoryEvidenceResult) => { expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.message); return result.game; };
const saintCapture = (game = saint()) => value(captureSaintQualification(game, executed(game), "exact-execution", env));
const mayorCapture = (game = mayor()) => value(captureMayorQualification(game, nextNight(game), env));

describe("B8 finite temporal qualification", () => {
  it.each(["good", "evil"] as const)("captures Saint actual %s team with the exact event, never shared resolution", alignment => {
    const game = patchPlayer(saint(), "p0", { actualAlignment: alignment });
    const captured = saintCapture(game);
    expect(captured.gameRuleFacts).toHaveLength(1);
    expect(captured.gameRuleFacts[0]).toMatchObject({ type: alignment === "good" ? SAINT_EXECUTION_GOOD_TEAM_LOST : SAINT_EXECUTION_EVIL_TEAM_LOST, resolutionId: "exact-execution", recordedAt: { phase: "day", day: 2 }, expiresAt: { phase: "day", day: 3 }, provenance: { sourceCharacter: "saint", sourceParticipant: { participantId: game.players.p0!.participantId } } });
    expect(captured.history.at(-1)?.category).toBe("gameRuleFact");
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(captured))).success).toBe(true);
  });
  it.each(["poisoned", "drunk", "abilityLost"])("impaired Saint with %s records nonqualification before cleanup", effect => {
    const before = impair(saint(), "p0", effect);
    const after = patchPlayer(executed(before), "p0", { effects: [] });
    const captured = value(captureSaintQualification(before, after, "exact-execution", env));
    expect(captured.gameRuleFacts).toHaveLength(1);
    expect(captured.gameRuleFacts[0]).toMatchObject({ type: SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED, resolutionId: "exact-execution" });
    expect(isSaintNonqualifyingEvidenceType(captured.gameRuleFacts[0]!.type)).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(captured).success).toBe(true);
  });
  it("captures known impaired evil Saint team without fabricating a historical winner", () => {
    const before = impair(patchPlayer(saint(), "p0", { actualAlignment: "evil" }), "p0");
    const captured = saintCapture(before);
    expect(captured.gameRuleFacts[0]?.type).toBe(SAINT_EXECUTION_EVIL_TEAM_NOT_QUALIFIED);
    expect(captured.result).toBeUndefined();
    const restored = JSON.parse(JSON.stringify(nextNight(patchPlayer(captured, "p0", { effects: [] }))));
    expect(StorytellerGamePersistedSchema.safeParse(restored).success).toBe(true);
    expect(validVictoryEvidence(restored)).toHaveLength(1);
  });
  it("execution survival and ordinary death do not capture", () => {
    const game = saint();
    expect(value(captureSaintQualification(game, executed(game, "survived"), "exact-execution", env)).gameRuleFacts).toEqual([]);
    const after = executed(game); after.lifeEventWindow.events = [{ id: "exact-execution", kind: "death", subject: ref(game), actualRoleAtEvent: "saint", moment: { phase: "day", day: 2 } }];
    expect(value(captureSaintQualification(game, after, "exact-execution", env)).gameRuleFacts).toEqual([]);
  });
  it("does not reconstruct old execution evidence or substitute actual Drunk", () => {
    const prior = executed(saint());
    expect(value(captureSaintQualification(prior, prior, "exact-execution", env)).gameRuleFacts).toEqual([]);
    expect(saintCapture(patchPlayer(saint(), "p0", { actualRole: "drunk", shownRole: "saint" })).gameRuleFacts).toEqual([]);
  });
  it.each(["good", "evil"] as const)("captures Mayor actual %s team exactly at completed Day", alignment => {
    const captured = mayorCapture(patchPlayer(mayor(), "p0", { actualAlignment: alignment }));
    expect(captured.gameRuleFacts[0]).toMatchObject({ type: alignment === "good" ? MAYOR_DAY_END_GOOD_TEAM_WON : MAYOR_DAY_END_EVIL_TEAM_WON, recordedAt: { phase: "day", day: 2 }, expiresAt: { phase: "day", day: 3 } });
    expect(captured.gameRuleFacts[0]?.resolutionId).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(captured).success).toBe(true);
  });
  it.each(["poisoned", "drunk", "abilityLost"])("Mayor %s at dusk stays unknown after effect expiry", effect => {
    const game = impair(mayor(), "p0", effect);
    expect(value(captureMayorQualification(game, patchPlayer(nextNight(game), "p0", { effects: [] }), env)).gameRuleFacts).toEqual([]);
  });
  it("Mayor requires no execution, including an execution which survived", () => {
    const game = executed(mayor(), "survived");
    expect(mayorCapture(game).gameRuleFacts).toEqual([]);
  });
  it("Mayor requires covered Day, living source and exact next Night", () => {
    const game = mayor();
    expect(mayorCapture({ ...game, lifeEventWindow: { coverageFrom: { phase: "night", day: 3 }, events: [] } }).gameRuleFacts).toEqual([]);
    expect(mayorCapture(patchPlayer(game, "p0", { alive: false })).gameRuleFacts).toEqual([]);
    expect(value(captureMayorQualification(game, { ...game, phase: "night", day: 4 }, env)).gameRuleFacts).toEqual([]);
    expect(value(captureMayorQualification(game, game, env)).gameRuleFacts).toEqual([]);
  });
  it("counts Travellers but does not supersede an already-ended two-ordinary game", () => {
    expect(mayorCapture(proofGame(["mayor", "imp", "beggar"], "day", 2)).gameRuleFacts).toEqual([]);
    expect(mayorCapture(proofGame(["mayor", "chef", "imp", "beggar"], "day", 2)).gameRuleFacts).toEqual([]);
    const deadTraveller = patchPlayer(proofGame(["mayor", "chef", "imp", "beggar"], "day", 2), "p3", { alive: false });
    expect(mayorCapture(deadTraveller).gameRuleFacts).toHaveLength(1);
  });
  it("multiple Saints or Mayors and unverified game-ending roles remain manual", () => {
    expect(saintCapture(proofGame(["saint", "saint", "imp"], "day", 2)).gameRuleFacts).toEqual([]);
    expect(mayorCapture(proofGame(["mayor", "mayor", "imp"], "day", 2)).gameRuleFacts).toEqual([]);
    expect(victoryCoverageEligibility(proofGame(["saint", "vortox", "chef"], "day", 2), env).kind).toBe("manual");
    expect(saintCapture({ ...saint(), fabled: ["spiritofivory"] }).gameRuleFacts).toEqual([]);
  });
  it.each(VICTORY_EVIDENCE_TYPES)("generic apply cannot forge %s", type => {
    expect(planGameRuleFactTransaction(saint(), { intents: [{ kind: "apply", type }], context: { provenance: { sourcePlayer: "p0", sourceCharacter: "saint" } }, resolutionId: "exact-execution" }).ok).toBe(false);
  });
  it("retains Saint through following Night and expires at next Day with history", () => {
    const day = saintCapture(); const night = nextNight(day);
    expect(validVictoryEvidence(night)).toHaveLength(1);
    const plan = planGameRuleFactExpiry(night, { phase: "day", day: 3 }); expect(plan).not.toBeNull();
    const next = applyGameRuleFactPlan({ ...night, phase: "day" }, plan!);
    next.lifeEventWindow.events = [];
    expect(next.gameRuleFacts).toEqual([]); expect(next.history.at(-1)).toMatchObject({ ruleFactOperation: "expire" });
    expect(StorytellerGamePersistedSchema.safeParse(next).success).toBe(true);
  });
  it("missing/altered exact trigger invalidates, same shared resolution is insufficient", () => {
    const before = saintCapture(); const after = structuredClone(before);
    after.lifeEventWindow.events[0]!.id = "different-execution";
    expect(StorytellerGamePersistedSchema.safeParse(after).success).toBe(false);
    expect(value(reconcileVictoryEvidence(before, after)).gameRuleFacts).toEqual([]);
  });
  it("normal poison expiry preserves historical truth, explicit impairment correction invalidates it", () => {
    const before = mayorCapture(); const after = impair(before, "p0");
    expect(value(reconcileVictoryEvidence(before, after)).gameRuleFacts).toHaveLength(1);
    expect(value(reconcileVictoryEvidence(before, after, { correction: true })).gameRuleFacts).toEqual([]);
    expect(value(reconcileVictoryEvidence(after, before)).gameRuleFacts).toHaveLength(1);
  });
  it.each(["participant", "role", "alignment", "game"])("invalidates %s boundary without recapturing", kind => {
    const before = saintCapture(); let after = structuredClone(before);
    if (kind === "participant") after.players.p0!.participantId += "-new";
    if (kind === "role") after.players.p0!.actualRole = "chef";
    if (kind === "alignment") after.players.p0!.actualAlignment = "evil";
    if (kind === "game") after.code = "NEWGAME";
    after = value(reconcileVictoryEvidence(before, after));
    expect(after.gameRuleFacts).toEqual([]);
  });
  it("Undo snapshots and cosmetic edits preserve evidence; old saves remain unknown", () => {
    const captured = saintCapture();
    expect(value(reconcileVictoryEvidence(captured, captured))).toBe(captured);
    expect(value(reconcileVictoryEvidence(captured, patchPlayer(captured, "p0", { name: "Renamed" }), { correction: true })).gameRuleFacts).toHaveLength(1);
    expect(value(reconcileVictoryEvidence(captured, patchPlayer(captured, "p0", { shownRole: "chef", packetEpoch: "perception-changed" }), { correction: true })).gameRuleFacts).toHaveLength(1);
    expect(validVictoryEvidence(executed(saint()))).toEqual([]);
    expect(StorytellerGamePersistedSchema.safeParse(executed(saint())).success).toBe(true);
  });
  it("recovery rejects malformed provenance/lifetime/boundary without requiring expired History events", () => {
    const captured = mayorCapture();
    expect(StorytellerGamePersistedSchema.safeParse({ ...captured, phase: "day", day: 2 }).success).toBe(false);
    for (const corrupt of [ { provenance: undefined }, { expiresAt: { phase: "day", day: 4 } }, { resolutionId: "invented" } ]) {
      const altered = { ...captured, gameRuleFacts: [{ ...captured.gameRuleFacts[0], ...corrupt }] };
      expect(StorytellerGamePersistedSchema.safeParse(altered).success).toBe(false);
    }
  });
});
