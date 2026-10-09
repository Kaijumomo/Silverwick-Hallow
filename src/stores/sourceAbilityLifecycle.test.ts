import { describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofScript, request } from "@/test/proofFixtures";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { applyRolePlan, changeRoleIntent, defaultRoleIds, planRoleTransaction } from "./roleResolution";
import { currentVoter, currentVotingState, freshVotingDay, planVoting, reconcileVotingDependencies, voteWeight } from "./voting";
import { buildRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "./types";
import { StorytellerGamePersistedSchema } from "./schemas";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { composeAbilityOutcome } from "./abilityResolution";
import { proofEnv } from "@/test/proofFixtures";
import { participantRefOf } from "./participants";

const environment = { script: proofScript, registry: buildRegistry(proofScript) };
function deathAndReturn(game: StorytellerLobbyRecord): StorytellerLobbyRecord {
  const result = planLifeTransaction(game, { intents: [{ kind: "death", playerId: "p0" }, { kind: "resurrection", playerId: "p0" }] }, undefined, environment);
  expect(result.ok).toBe(true);
  if (!result.ok || !result.changed) throw new Error("Expected Life change");
  return applyLifePlan(game, result.plan);
}
function change(game: StorytellerLobbyRecord, role: string) {
  const result = planRoleTransaction(game, { intents: [changeRoleIntent(game.players.p0!, role)] }, { script: proofScript, ids: defaultRoleIds });
  expect(result.ok).toBe(true);
  if (!result.ok || !result.changed) throw new Error("Expected Role change");
  return applyRolePlan(game, result.plan);
}
function selection(game: StorytellerLobbyRecord) {
  return planVoting(game, { kind: "bureaucrat", code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision,
    modifierId: "selected", source: bind(game, "p0"), target: bind(game, "p1") }, environment);
}
function selectedGame() {
  const game = proofGame(["bureaucrat", "chef", "empath"], "day", 2, { voting: freshVotingDay(2) });
  const result = selection(game);
  if (!result.ok) throw new Error(result.message);
  const modifier = result.game.voting!.modifiers[0]!;
  return patchPlayer(result.game, "p1", { reminders: [
    { id: "voting-selected", label: "3 Votes", sourceParticipant: modifier.source, sourceCharacter: "bureaucrat" },
    { id: "unrelated", label: "3 Votes" },
  ] });
}
describe("Character Intelligence source-loss regressions", () => {
  for (const role of ["poisoner", "monk"]) {
    const produced = () => { const game = proofGame([role, "chef", "empath"]); return planned(plan(game, request(game, "p0", role, { target: pick(game, "p1") }))); };
    it(`${role}: death then resurrection in one transaction never revives the old effect`, () => {
      const before = produced();
      expect(deathAndReturn(before).players.p1!.effects).toEqual([]);
      expect(before.players.p1!.effects).toHaveLength(1);
    });
    it(`${role}: role away and back never revives the old effect`, () => {
      expect(change(change(produced(), "empath"), role).players.p1!.effects).toEqual([]);
    });
    it(`${role}: healthy invocation resumes after temporary impairment before expiry`, () => {
      const game = produced();
      const effect = game.players.p1!.effects[0]!;
      const interrupted = impair(game, "p0");
      expect(proofQuery(interrupted).effectApplies(bind(game, "p1"), effect)).toEqual({ known: true, value: false });
      const recovered = patchPlayer(interrupted, "p0", { effects: [] });
      expect(recovered.players.p1!.effects[0]).toBe(effect);
      expect(proofQuery(recovered).effectApplies(bind(game, "p1"), effect)).toEqual({ known: true, value: true });
    });
    it(`${role}: impaired invocation has no effect to resume later`, () => {
      const game = impair(proofGame([role, "chef", "empath"]), "p0");
      const next = planned(plan(game, request(game, "p0", role, { target: pick(game, "p1") }, { withStep: true, completeStep: true })));
      expect(patchPlayer(next, "p0", { effects: [] }).players.p1!.effects).toEqual([]);
      expect(Object.values(next.nightProgress)[0]?.status).toBe("done");
    });
    it(`${role}: target death preserves the source's effect and unrelated manual effects survive source death`, () => {
      const game = impair(produced(), "p1", "drunk");
      const targetDeath = planLifeTransaction(game, { intents: [{ kind: "death", playerId: "p1" }] }, undefined, environment);
      if (!targetDeath.ok || !targetDeath.changed) throw new Error("Expected death");
      const next = applyLifePlan(game, targetDeath.plan);
      expect(next.players.p1!.effects).toEqual(game.players.p1!.effects);
      expect(deathAndReturn(next).players.p1!.effects.map(e => e.type)).toEqual(["drunk"]);
    });
    it(`${role}: custom ID collision does not inherit official termination`, () => {
      const game = produced();
      const result = planLifeTransaction(game, { intents: [{ kind: "death", playerId: "p0" }] }, undefined, homebrewEnv(role));
      if (!result.ok || !result.changed) throw new Error("Expected death");
      expect(applyLifePlan(game, result.plan).players.p1!.effects).toEqual(game.players.p1!.effects);
    });
    it(`${role}: canonical store death, cleanup and history are one undoable, serializable change`, () => {
      usePrivacyStore.setState({ enabled: false });
      const game = produced(); openInStore(game);
      const before = store.getState();
      expect(before.recordDeath("p0")).toMatchObject({ ok: true, changed: true });
      const next = store.getState();
      expect(next.localSeq).toBe(before.localSeq + 1);
      expect(next.undoStack).toHaveLength(1);
      expect(next.game!.players.p1!.effects).toEqual([]);
      expect(next.game!.history.some(h => h.category === "effect" && h.effectOperation === "remove")).toBe(true);
      const reloaded = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(next.game)));
      expect(reloaded.players.p1!.effects).toEqual([]);
      const publicBefore = projectLobbyToPublic(game, {});
      const publicAfter = projectLobbyToPublic(next.game!, {});
      expect(JSON.stringify(publicAfter)).not.toContain("Source ability ended");
      expect(JSON.stringify(projectLobbyToSelfMap(next.game!, environment.registry))).not.toContain("Source ability ended");
      expect(publicBefore).toBeDefined();
      next.undo();
      expect(store.getState().game!.players.p1!.effects).toEqual(game.players.p1!.effects);
      expect(store.getState().game!.players.p0!.alive).toBe(true);
    });
    it(`${role}: ordered ability composition terminates before resurrection`, () => {
      const game = produced();
      const result = composeAbilityOutcome(game, { operations: [{ domain: "life", intents: [
        { kind: "death", target: bind(game, "p0") }, { kind: "resurrection", target: bind(game, "p0") },
      ] }] }, proofEnv(), { resolutionId: "lifecycle-order" });
      expect(planned(result).players.p1!.effects).toEqual([]);
    });
  }
  it("Bureaucrat impaired at invocation cannot activate after recovery", () => {
    const game = impair(proofGame(["bureaucrat", "chef", "empath"], "night", 2, { voting: freshVotingDay(2) }), "p0");
    const result = selection(game);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const recovered = patchPlayer(result.game, "p0", { effects: [] });
    expect(recovered.voting!.modifiers).toEqual([]);
    expect(voteWeight(recovered, bind(recovered, "p1"), environment)).toEqual({ known: true, value: 1 });
  });
  it("Bureaucrat source loss removes only its exact linked reminder", () => {
    const game = selectedGame();
    const next = reconcileVotingDependencies(game, patchPlayer(game, "p0", { alive: false }));
    expect(next.voting!.modifiers).toEqual([]);
    expect(next.players.p1!.reminders.map(r => r.id)).toEqual(["unrelated"]);
  });
  it("Bureaucrat expiry removes modifier and exact linked reminder", () => {
    const game = selectedGame();
    const next = reconcileVotingDependencies(game, { ...game, phase: "night", day: 3 });
    expect(next.voting!.modifiers).toEqual([]);
    expect(next.players.p1!.reminders.map(r => r.id)).toEqual(["unrelated"]);
  });
  it("Bureaucrat death and resurrection in one transaction cannot restore its modifier", () => {
    const game = deathAndReturn(selectedGame());
    expect(game.players.p0!.alive).toBe(true);
    expect(game.voting!.modifiers).toEqual([]);
    expect(game.players.p1!.reminders.map(r => r.id)).toEqual(["unrelated"]);
  });
  it("Bureaucrat role loss removes exact linked reminder", () => {
    const game = change(selectedGame(), "thief");
    expect(game.voting!.modifiers).toEqual([]);
    expect(game.players.p1!.reminders.map(r => r.id)).toEqual(["unrelated"]);
  });
  it("Bureaucrat source seat replacement retires the old binding without touching replacement notation", () => {
    const game = selectedGame();
    const next = reconcileVotingDependencies(game, patchPlayer(game, "p0", { participantId: "replacement" }));
    expect(next.voting!.modifiers).toEqual([]);
    expect(next.players.p1!.reminders.map(r => r.id)).toEqual(["unrelated"]);
  });
  it("Bureaucrat healthy invocation temporarily stops then resumes after impairment", () => {
    const game = selectedGame();
    const stopped = impair(game, "p0");
    expect(voteWeight(stopped, bind(stopped, "p1"), environment)).toEqual({ known: true, value: 1 });
    const resumed = patchPlayer(stopped, "p0", { effects: [] });
    expect(voteWeight(resumed, bind(resumed, "p1"), environment)).toEqual({ known: true, value: 3 });
    expect(resumed.players.p1!.reminders).toEqual(game.players.p1!.reminders);
  });
  it("Bureaucrat removal and an intermediate Life change invalidate vote correction evidence together", () => {
    let game = selectedGame();
    const started = planVoting(game, { kind: "begin", code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision,
      roundId: "round", mode: "nomination", nominator: bind(game, "p0"), nominee: bind(game, "p1") }, environment);
    if (!started.ok) throw new Error(started.message); game = started.game;
    for (let i = 0; i < 2; i++) {
      const result = planVoting(game, { kind: "respond", code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision,
        roundId: "round", voter: currentVoter(game)!, choice: "no" }, environment);
      if (!result.ok) throw new Error(result.message); game = result.game;
    }
    const next = deathAndReturn(game);
    expect(next.voting!.modifiers).toEqual([]);
    expect(next.voting!.rounds[0]!.responses.find(r => r.voter.playerId === "p0")).toMatchObject({ lifeSafe: false, refundSafe: false });
    expect(next.voting!.rounds[0]!.responses.find(r => r.voter.playerId === "p2")).toMatchObject({ lifeSafe: true });
  });
  it("Bureaucrat modifiers introduced after selection prevent automatic vote weighting", () => {
    const game = { ...selectedGame(), lorics: ["bootlegger"] };
    expect(voteWeight(game, bind(game, "p1"), environment)).toMatchObject({ known: false });
  });
  it("Bureaucrat uncertain impairment or modifiers refuse the entire action", () => {
    const game = proofGame(["bureaucrat", "chef", "empath"], "night", 2, { voting: freshVotingDay(2) });
    const uncertainEffect = impair(game, "p0");
    uncertainEffect.players.p0!.effects[0] = { ...uncertainEffect.players.p0!.effects[0]!, sourceCharacter: "unverified",
      sourceParticipant: participantRefOf(game, "p1")! };
    for (const uncertain of [uncertainEffect, { ...game, lorics: ["bootlegger"] }]) {
      const before = JSON.stringify(uncertain);
      expect(selection(uncertain)).toMatchObject({ ok: false });
      expect(JSON.stringify(uncertain)).toBe(before);
    }
  });
});
