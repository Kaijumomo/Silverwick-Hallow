import { scarletWomanSuccession } from "@/abilities/characters/scarletWoman";
import { applyLifePlan, planLifeTransaction, type LifeRefusal, type LifeTransaction } from "./lifeResolution";
import { applyRolePlan, defaultRoleIds, planRoleTransaction, toldRoleChangeIntents } from "./roleResolution";
import { createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import { historyId } from "./history";
import { captureSaintQualification, captureResolvedDemonDeath } from "./victoryEvidence";
import type { LifeEventId, StorytellerLobbyRecord } from "./types";

export type RecordedLifePlanResult = {
  ok: true; changed: boolean; game: StorytellerLobbyRecord; eventIds: LifeEventId[]; manualReason?: string;
} | LifeRefusal;

/** A Storyteller-recorded actual outcome, with a verified synchronous Scarlet
 * Woman consequence. This is not an automatic kill evaluator. Unsupported
 * consequences stay entirely Storyteller-owned, with an explicit notice.
 * Raw Life transactions/corrections continue to use their primitive planner. */
export function planRecordedLifeOutcome(
  game: StorytellerLobbyRecord,
  transaction: LifeTransaction,
  environment?: RulesQueryEnvironment,
): RecordedLifePlanResult {
  const intent = Array.isArray(transaction?.intents) && transaction.intents.length === 1 ? transaction.intents[0] : undefined;
  const deathIntent = intent && (intent.kind === "death" || intent.kind === "execution" && intent.outcome === "died") ? intent : undefined;
  const dying = deathIntent ? game.players[deathIntent.playerId] : undefined;
  const ruling = dying?.participantId && dying.alive
    ? environment ? scarletWomanSuccession(createRulesQuery(game, environment), { playerId: dying.id, participantId: dying.participantId })
      : { kind: "manual" as const, reason: "The character rules are unavailable." }
    : { kind: "none" as const };
  // The Life control records an observed death, not its ability/cause. At
  // Night that cannot prove self-pass timing or whether the new Imp may act.
  // Automatic Imp actions carry that evidence through the ability coordinator.
  const decision = ruling.kind === "successor" && game.phase === "night"
    ? { kind: "manual" as const, reason: "The cause of this Night death is not recorded. Resolve succession and the remaining Night actions manually." }
    : ruling;
  const resolutionId = transaction.resolutionId ?? (decision.kind === "successor" ? historyId() : undefined);
  const result = planLifeTransaction(game, { ...transaction, ...(resolutionId ? { resolutionId } : {}) }, undefined, environment);
  if (!result.ok) return result;
  if (!result.changed) return { ok: true, changed: false, game, eventIds: [] };
  let next = applyLifePlan(game, result.plan);
  if (environment && intent?.kind === "execution" && result.plan.addedEventIds.length === 1) {
    const evidence = captureSaintQualification(game, next, result.plan.addedEventIds[0]!, environment);
    if (!evidence.ok) return { ok: false, code: "refused", message: evidence.message };
    next = evidence.game;
  }
  // Only the single confirmed live outcome is eligible here. In particular,
  // an amendment, late record or status repair can never replay succession.
  if (decision.kind === "manual") return { ok: true, changed: true, game: next, eventIds: result.plan.addedEventIds,
    manualReason: `Outcome recorded. Resolve any character consequences using the official instructions and existing game controls. ${decision.reason}` };
  if (decision.kind === "successor") {
    const successor = next.players[decision.target.playerId];
    if (!successor || successor.participantId !== decision.target.participantId)
      return { ok: false, code: "stale", message: "The successor changed. Review the current players." };
    const role = planRoleTransaction(next, { intents: toldRoleChangeIntents(successor, "imp"), resolutionId, context: transaction.context },
      { script: environment?.script ? { id: game.scriptId, name: "", characters: environment.script.characters } : null, ids: defaultRoleIds });
    if (!role.ok) return { ok: false, code: "refused", message: role.message };
    if (role.changed) next = applyRolePlan(next, role.plan);
  }
  if (environment && deathIntent && result.plan.addedEventIds.length === 1) {
    const evidence = captureResolvedDemonDeath(game, next, result.plan.addedEventIds[0]!, environment,
      game.phase === "night" ? "recordedNight" : "recordedDay");
    if (!evidence.ok) return { ok: false, code: "refused", message: evidence.message };
    next = evidence.game;
  }
  return { ok: true, changed: true, game: next, eventIds: result.plan.addedEventIds };
}
