import type { AbilityEvaluation, AbilityEvaluationContext, AbilityInputRequirement, AbilityInputs, AbilityInputValue } from "../semantics";
import type { AbilityOperation, AbilityOutcome, ParticipantBinding } from "@/stores/abilityResolution";

/**
 * Phase 10F Slice 7: small PURE helpers shared by the proof-character
 * semantics modules (docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md). They encode
 * no character ruling of their own: each module decides which helper its
 * frozen matrix section calls for. Never read Reminders, History or ability
 * prose here (architecture-guarded).
 */

export const outcome = (operations: AbilityOperation[], declared = false): AbilityEvaluation =>
  ({ kind: "outcome", outcome: { operations, ...(declared ? { mechanicalOrder: "declared" as const } : {}) } satisfies AbilityOutcome });

export const nothing = (): AbilityEvaluation => outcome([]);

export const ask = (message: string, ...requirements: AbilityInputRequirement[]): AbilityEvaluation =>
  ({ kind: "needsInput", requirements, message });

/** The bound participants answered for `id` (declared inputs are validated
 * by the coordinator before the evaluator runs). */
export function participantsOf(values: AbilityInputs, id: string): ParticipantBinding[] | undefined {
  const value = Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined;
  return value?.kind === "participant" ? value.participants : undefined;
}

export const firstParticipant = (values: AbilityInputs, id: string): ParticipantBinding => participantsOf(values, id)![0]!;

/** A typed answer the evaluator asked for (a follow-up input or judgment). */
export function answerOf<K extends AbilityInputValue["kind"]>(
  values: AbilityInputs,
  id: string,
  kind: K,
): Extract<AbilityInputValue, { kind: K }> | undefined {
  const value = Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined;
  return value && typeof value === "object" && value.kind === kind ? value as Extract<AbilityInputValue, { kind: K }> : undefined;
}

/**
 * SOL-10F-A1: the identity of an evaluator follow-up that belongs to specific
 * participants (a consent, a live/die choice, an answer about a chosen pair).
 * Changing the subject changes the id, so an answer collected for one subject
 * can never be consumed for another -- even from a crafted request. The ids
 * are JSON-encoded, so ParticipantIds containing ":" cannot collide.
 */
export const subjectId = (base: string, ...subjects: ParticipantBinding[]): string =>
  `${base}:${JSON.stringify(subjects.map((subject) => subject.participantId))}`;

export const nameOf = (context: AbilityEvaluationContext, binding: ParticipantBinding): string => {
  const player = context.query.participant(binding);
  return player?.name || (player ? `Seat ${player.seat + 1}` : "That player");
};

/**
 * A follow-up participant answer (one the EVALUATOR asked for, so the
 * coordinator's declared-input validation never saw it): exactly one bound
 * CURRENT participant, or a structured stale / invalid result. Seat reuse never
 * redirects a stale binding to the replacement occupant.
 */
export function followUpParticipant(context: AbilityEvaluationContext, values: AbilityInputs, id: string):
  { binding: ParticipantBinding } | { refusal: AbilityEvaluation } | undefined {
  const value = Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || value.kind !== "participant" || !Array.isArray(value.participants) || value.participants.length !== 1) {
    return { refusal: { kind: "illegal", message: "Choose exactly one player." } };
  }
  const binding = value.participants[0]!;
  if (!binding || typeof binding.playerId !== "string" || typeof binding.participantId !== "string" || !binding.participantId) {
    return { refusal: { kind: "illegal", message: "Choose exactly one player." } };
  }
  if (!context.query.participant(binding)) return { refusal: { kind: "stale", message: "A chosen player is no longer in that seat -- review and resolve again." } };
  return { binding };
}

/**
 * The general BOTC rule the matrix relies on (Abilities: dead players have
 * no ability). An ability that only works for a living character -- every
 * proof character except an explicit death-trigger -- cannot be performed by a
 * dead actor, real or simulated. The Night Order already omits these rows; this
 * keeps the coordinator authoritative for a crafted request.
 */
export function requireLivingActor(context: AbilityEvaluationContext): AbilityEvaluation | null {
  return context.actor.player.alive ? null : { kind: "notApplicable", message: "Dead players have no ability -- this cannot be resolved for a dead player." };
}

export type DeathCause = "demon" | "any";

/** The judgment id asked when protection against one death is unknown. */
export const protectionJudgmentId = (cause: DeathCause, binding: ParticipantBinding) => `protection:${cause}:${binding.participantId}`;

export type DeathDecision =
  | { kind: "dies" }
  | { kind: "survives" }
  | { kind: "ask"; requirement: AbilityInputRequirement; message: string };

/**
 * Matrix Section 3 -- the shared death/protection rule. Query protection for
 * the ACTUAL cause; known protected -> no death; known unprotected -> death;
 * unknown (custom / generic Protected / unresolved source) -> an explicit
 * Storyteller judgment, never inferred. `query` may be a hypothetical query
 * over the evolving Life state of this resolution.
 */
export function deathAttempt(
  context: AbilityEvaluationContext,
  target: ParticipantBinding,
  cause: DeathCause,
  query = context.query,
): DeathDecision {
  const answer = query.protectedFrom(target, cause);
  if (answer.known) return answer.value ? { kind: "survives" } : { kind: "dies" };
  const id = protectionJudgmentId(cause, target);
  const judged = answerOf(context.judgments, id, "boolean");
  if (judged) return judged.value ? { kind: "survives" } : { kind: "dies" };
  return {
    kind: "ask",
    message: answer.reason,
    requirement: { id, kind: "boolean", source: "judgment",
      label: `${nameOf(context, target)} is protected from this ${cause === "demon" ? "Demon " : ""}death (Yes: they do not die)` },
  };
}

export const lifeOperation = (intents: { kind: "death" | "resurrection" | "useAbility"; target: ParticipantBinding }[]): AbilityOperation =>
  ({ domain: "life", intents });
