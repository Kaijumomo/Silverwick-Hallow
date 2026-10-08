import {
  captureFingerprint, composeAbilityOutcome, newResolutionId, planAbilityResolution,
  type AbilityEnvironment, type AbilityPlan, type AbilityPlanResult, type AbilityResolutionRequest,
  type GuidedAbilityRequest, type ParticipantBinding,
} from "./abilityResolution";
import { cloneOwned, sameSnapshot } from "./history";
import { boundParticipant } from "./rulesQuery";
import { planNightStepStatus } from "./nightProgress";
import type { StorytellerLobbyRecord } from "./types";

/** Local workflow receipts, not persisted game facts or reconstructed History.
 * A reload deliberately loses eligibility rather than guessing an old action.
 * Only the two verified single-target, effect-only night actions are admitted.
 */
type Receipt = {
  request: GuidedAbilityRequest;
  after: ReturnType<typeof dependencyState>;
  effect: { target: ParticipantBinding; effectId: string };
};
const receipts = new Map<string, Receipt>();
const keyOf = (day: number, stepKey: string) => `${day}:${stepKey}`;
export type NightActionTargetCorrection = { day: number; stepKey: string; target: ParticipantBinding };

export function clearNightActionCorrections(): void { receipts.clear(); }

export function invalidateNightActionCorrections(game: StorytellerLobbyRecord): void {
  for (const [key, receipt] of receipts) {
    if (!sameSnapshot(dependencyState(game), receipt.after)) receipts.delete(key);
  }
}

/** Ignore only non-mechanical notation and display text. All progress statuses,
 * information deliveries, membership, seating and rules state must still match:
 * even an apparently unrelated later action may have depended on this target.
 */
function dependencyState(game: StorytellerLobbyRecord) {
  const { history: _history, notes: _notes, pendingPlayers: _pending, ...rest } = game;
  return {
    ...rest,
    players: Object.fromEntries(Object.entries(game.players).map(([id, player]) => {
      const { stNotes: _notes, reminders: _reminders, name: _name, ...state } = player;
      return [id, state];
    })),
    nightProgress: Object.fromEntries(Object.entries(game.nightProgress).map(([key, value]) => [key, value.status])),
  };
}

export function rememberNightAction(
  before: StorytellerLobbyRecord, request: AbilityResolutionRequest, plan: AbilityPlan,
): void {
  if (request.mode !== "guided" || request.invocationPath !== "nightOrder" || !request.completeStep ||
    !request.fingerprint.step || before.phase !== "night" ||
    !["poisoner", "monk"].includes(request.roleId) || plan.needsConfirmation) return;
  const operations = plan.outcome.operations;
  if (operations.length !== 1 || operations[0]!.domain !== "effect") return;
  const intents = operations[0].intents;
  if (intents.length !== 1 || (intents[0]!.kind !== "apply" && intents[0]!.kind !== "correctApply")) return;
  const intent = intents[0]!;
  const oldEffects = before.players[intent.target.playerId]?.effects ?? [];
  const added = plan.game.players[intent.target.playerId]?.effects.filter((effect) => !oldEffects.some((old) => old.id === effect.id));
  if (added?.length !== 1) return;
  const step = request.fingerprint.step;
  receipts.set(keyOf(step.day, step.stepKey), cloneOwned({ request, after: dependencyState(plan.game),
    effect: { target: intent.target, effectId: added[0]!.id } }));
  // A night has a bounded roster; discard old nights rather than retaining games.
  for (const [key, receipt] of receipts) if (receipt.after.day !== before.day || receipt.after.code !== before.code ||
    receipt.after.storytellerUid !== before.storytellerUid) receipts.delete(key);
}

export function getNightActionCorrection(game: StorytellerLobbyRecord, day: number, stepKey: string) {
  const receipt = receipts.get(keyOf(day, stepKey));
  if (!receipt) return null;
  const canCorrect = sameSnapshot(dependencyState(game), receipt.after);
  return { target: cloneOwned(receipt.effect.target), canCorrect,
    ...(canCorrect ? {} : { message: "The game changed after this action. Undo later actions first, or use the existing manual correction controls and review their consequences." }) };
}

/** Remove just the recorded effect, then ask the real evaluator about the new
 * target against that corrected Current State (important for self-poisoning).
 * The store commits the resulting composed snapshot once, after its preflight.
 */
export function planNightActionTargetCorrection(
  game: StorytellerLobbyRecord, correction: NightActionTargetCorrection, environment: AbilityEnvironment,
): AbilityPlanResult {
  if (!correction || !Number.isInteger(correction.day) || typeof correction.stepKey !== "string") {
    return { ok: false, code: "invalid", message: "Choose a completed Night action to correct." };
  }
  const receipt = receipts.get(keyOf(correction.day, correction.stepKey));
  if (!receipt) return { ok: false, code: "stale", message: "This action has no correction receipt in this session. Use Undo or the existing manual correction controls; reloading does not replay an old action." };
  const eligibility = getNightActionCorrection(game, correction.day, correction.stepKey)!;
  if (!eligibility.canCorrect) return { ok: false, code: "stale", message: eligibility.message! };
  if (!correction.target || typeof correction.target.playerId !== "string" || typeof correction.target.participantId !== "string" ||
    !boundParticipant(game, correction.target)) return { ok: false, code: "stale", message: "The chosen player is no longer in that seat." };
  if (sameSnapshot(correction.target, receipt.effect.target)) return { ok: true, changed: false };
  const resolutionId = newResolutionId();
  const removed = composeAbilityOutcome(game, { operations: [{ domain: "effect", intents: [
    { kind: "correctRemove", target: receipt.effect.target, effectId: receipt.effect.effectId },
  ] }] }, environment, { resolutionId });
  if (!removed.ok || !removed.changed) return removed;
  // Reopen only the working plan's step, so invocation eligibility can evaluate
  // it. The committed snapshot retains completion; no intermediate state leaks.
  const reopened = planNightStepStatus(removed.plan.game, correction.day, correction.stepKey, "pending") ?? removed.plan.game;
  const fingerprint = captureFingerprint(reopened, receipt.request.fingerprint.actor.playerId,
    { day: correction.day, stepKey: correction.stepKey });
  if (!fingerprint) return { ok: false, code: "stale", message: "The acting player is no longer seated." };
  const request: GuidedAbilityRequest = { ...receipt.request, fingerprint, resolutionId,
    inputs: { ...receipt.request.inputs, target: { kind: "participant", participants: [correction.target] } } };
  const evaluated = planAbilityResolution(reopened, request, environment);
  if (!evaluated.ok) return evaluated;
  if (!evaluated.changed) return removed;
  if (evaluated.plan.needsConfirmation || evaluated.plan.outcome.operations.some((operation) => operation.domain !== "effect" ||
    operation.intents.some((intent) => intent.kind !== "apply"))) {
    return { ok: false, code: "unsupported", message: "This correction needs a reviewed outcome. Use the existing manual correction controls." };
  }
  const outcome = { operations: evaluated.plan.outcome.operations.map((operation) => ({ domain: "effect" as const,
    intents: operation.domain === "effect" ? operation.intents.flatMap((intent) => intent.kind === "apply"
      ? [{ ...intent, kind: "correctApply" as const }] : []) : [],
  })) };
  const final = composeAbilityOutcome(removed.plan.game, outcome, environment, { resolutionId });
  return final;
}

export function rememberCorrectedNightAction(before: StorytellerLobbyRecord, correction: NightActionTargetCorrection, plan: AbilityPlan): void {
  const receipt = receipts.get(keyOf(correction.day, correction.stepKey));
  if (!receipt) return;
  rememberNightAction(before, { ...receipt.request,
    inputs: { ...receipt.request.inputs, target: { kind: "participant", participants: [correction.target] } },
  }, plan);
}
