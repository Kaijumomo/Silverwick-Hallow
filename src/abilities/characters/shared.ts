import { survivesFirstDeath } from "./passiveRules";
import type { AbilityEvaluation, AbilityEvaluationContext, AbilityInputRequirement, AbilityInputs, AbilityInputValue } from "../semantics";
import type { AbilityOperation, AbilityOutcome, ParticipantBinding } from "@/stores/abilityResolution";
import type { ReminderIntent } from "@/stores/reminderResolution";
import { PIT_HAG_ARBITRARY_DEATHS } from "@/stores/gameRuleFacts";

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
  if (context.actor.player.alive) return null;
  // A Minion the Vigormortis killed keeps its ability (derived from the official HAS ABILITY Effect, never assumed).
  const kept = context.query.retainsAbility(context.actor.binding);
  if (kept.known && kept.value) return null;
  return { kind: "notApplicable", message: "Dead players have no ability -- this cannot be resolved for a dead player." };
}

export type DeathCause = "demon" | "any";

/**
 * SOL-10F-B2: the explicit identity of ONE death attempt within a resolution
 * that may attempt the same target's death more than once (or under different
 * evolving states). `id` is a deterministic token the CALLER derives from the
 * attempt's stage, position and the resolved state preceding it -- never
 * prose; `label` tells the Storyteller which attempt is asked about.
 */
export type DeathAttemptScope = { id: string; label?: string };

/** The judgment id asked when protection against one death is unknown. It
 * binds the target, the cause and (SOL-10F-C2) the RulesQuery protection-
 * dependency stamp of the exact state the attempt is evaluated against, so a
 * judgment answered under one state can never settle the same question after
 * a relevant change (a source dying / resurrecting, changing Role, leaving, an
 * Effect added / removed / suppressed / resumed). A scoped attempt
 * (SOL-10F-B2) binds the attempt too, so a judgment answered for one attempt
 * can never settle another. JSON-encoded, so no ParticipantId, scope token or
 * stamp can make two ids collide, and `@` keeps scoped ids apart from unscoped
 * ones. */
export const protectionJudgmentId = (cause: DeathCause, binding: ParticipantBinding, dependency: string, scope?: DeathAttemptScope) =>
  scope === undefined
    ? `protection:${cause}:${JSON.stringify([binding.participantId, dependency])}`
    : `protection:${cause}@${JSON.stringify([scope.id, binding.participantId, dependency])}`;

/**
 * SOL-10F-C2: whether `target`'s protection against `cause` reads differently
 * under two queries (e.g. Current State vs. a hypothetical in which another
 * death happened first): KNOWN answers compare by value; UNKNOWN only matches
 * UNKNOWN. It reads no Storyteller judgment -- a judgment answers one death
 * attempt under one state, never a comparison between two states.
 */
export function protectionDiffers(a: AbilityEvaluationContext["query"], b: AbilityEvaluationContext["query"], target: ParticipantBinding, cause: DeathCause): boolean {
  const left = a.protectedFrom(target, cause), right = b.protectedFrom(target, cause);
  return left.known !== right.known || (left.known && right.known && left.value !== right.value);
}

/**
 * Phase 10G (PHASE10G Section 10): the judgment id asked for ONE death attempt
 * while "deaths tonight are arbitrary" (the `pitHagArbitraryDeaths` Rule Fact)
 * applies. Kept apart from protectionJudgmentId -- an arbitrary-death ruling
 * never settles an ordinary protection question, or vice versa -- and bound to
 * the same target / cause / attempt scope / protection-dependency stamp.
 */
export const arbitraryDeathJudgmentId = (cause: DeathCause, binding: ParticipantBinding, dependency: string, scope?: DeathAttemptScope) =>
  scope === undefined
    ? `arbitraryDeath:${cause}:${JSON.stringify([binding.participantId, dependency])}`
    : `arbitraryDeath:${cause}@${JSON.stringify([scope.id, binding.participantId, dependency])}`;

export type DeathDecision =
  | { kind: "dies" }
  /** `spend`: the survival uses up this player's own ability (the Fool). Absent for every prevented death. */
  | { kind: "survives"; spend?: ParticipantBinding }
  | { kind: "ask"; requirement: AbilityInputRequirement; message: string };

/**
 * Matrix Section 3 -- the shared death/protection rule. Query protection for
 * the ACTUAL cause; known protected -> no death; known unprotected -> death;
 * unknown (custom / generic Protected / unresolved source) -> an explicit
 * Storyteller judgment, never inferred. `query` may be a hypothetical query
 * over the evolving Life state of this resolution. `attempt` (SOL-10F-B2)
 * scopes the judgment to one particular death attempt, and the judgment id
 * always carries `query`'s protection-dependency stamp (SOL-10F-C2); known
 * answers are always recomputed from `query` and never read a judgment.
 *
 * Phase 10G (PHASE10G Section 10): THE one shared arbitrary-death gate. While
 * the registered `pitHagArbitraryDeaths` Rule Fact applies in `query`'s Current
 * State, no death result is mechanically forced -- not even an ordinarily
 * deterministic one (known protected / unprotected): every attempt is an
 * explicit Storyteller judgment. No character module checks for the Pit-Hag
 * itself; Silverwick never chooses the deaths.
 */
export function deathAttempt(
  context: AbilityEvaluationContext,
  target: ParticipantBinding,
  cause: DeathCause,
  query = context.query,
  attempt?: DeathAttemptScope,
): DeathDecision {
  const arbitrary = query.gameRuleFact(PIT_HAG_ARBITRARY_DEATHS);
  if (arbitrary.known && arbitrary.value) {
    const id = arbitraryDeathJudgmentId(cause, target, query.protectionDependencyStamp(target, cause), attempt);
    const judged = answerOf(context.judgments, id, "boolean");
    if (judged) return judged.value ? { kind: "survives" } : { kind: "dies" };
    return {
      kind: "ask",
      message: "Deaths tonight are arbitrary (a Pit-Hag made a Demon): you decide whether this death happens -- Silverwick does not treat any result as forced.",
      requirement: { id, kind: "boolean", source: "judgment",
        label: `${nameOf(context, target)} does not die from this${attempt?.label ? ` (${attempt.label})` : ""} -- deaths are arbitrary tonight (Yes: they do not die)` },
    };
  }
  const answer = query.deathOutcome(target, cause);
  if (answer.known) return answer.value.kind === "survives" ? (answer.value.spends ? { kind: "survives", spend: target } : { kind: "survives" }) : { kind: "dies" };
  // SOL-10F-C2: the id binds the dependency stamp of the queried state.
  const id = protectionJudgmentId(cause, target, query.protectionDependencyStamp(target, cause), attempt);
  const judged = answerOf(context.judgments, id, "boolean");
  if (judged) {
    if (judged.value) return { kind: "survives" };
    // "Not protected by the unknown thing" still leaves a Fool's own first-death survival to apply.
    const own = survivesFirstDeath(query, target);
    return own.known && own.value ? { kind: "survives", spend: target } : { kind: "dies" };
  }
  return {
    kind: "ask",
    message: answer.reason,
    requirement: { id, kind: "boolean", source: "judgment",
      label: `${nameOf(context, target)} is protected from this ${cause === "demon" ? "Demon " : ""}death${attempt?.label ? ` (${attempt.label})` : ""} (Yes: they do not die)` },
  };
}

/** For killers whose later steps depend on the Fool's ability state (Al-Hadikhia's rounds, the Harlot's pair): the survival would spend it,
 * and that state is not carried through their hypothetical steps, so the whole action stays Manual. */
export const FOOL_SPEND_MANUAL = "A Fool survives this death and its ability is used up. This action does not track that yet -- resolve it manually.";

/** The outcome of a death attempt that did not happen: nothing changes, except that a Fool-style survival spends the ability. */
export const survivedOutcome = (death: Extract<DeathDecision, { kind: "survives" }>): AbilityEvaluation =>
  death.spend ? outcome([lifeOperation([{ kind: "useAbility", target: death.spend }])]) : nothing();

export const lifeOperation = (intents: { kind: "death" | "resurrection" | "useAbility"; target: ParticipantBinding }[]): AbilityOperation =>
  ({ domain: "life", intents });

/**
 * Draws the acting character's own official "Dead" / "Alive" reminder token on each player its ability
 * just killed or revived. Notation only (a reminder operation after the mechanics); never read back.
 */
export function withLifeTokens(context: AbilityEvaluationContext, roleId: string, operations: AbilityOperation[]): AbilityOperation[] {
  const intents: ReminderIntent[] = [];
  for (const operation of operations) {
    if (operation.domain !== "life") continue;
    for (const intent of operation.intents) {
      const label = intent.kind === "death" ? "Dead" : intent.kind === "resurrection" ? "Alive" : undefined;
      if (!label || !("target" in intent) || !intent.target) continue;
      intents.push({ kind: "place", target: intent.target, reminder: { label, sourceCharacter: roleId, source: context.actor.binding } });
    }
  }
  return intents.length ? [...operations, { domain: "reminder", intents }] : operations;
}

export const tokenOutcome = (context: AbilityEvaluationContext, roleId: string, operations: AbilityOperation[], declared = false): AbilityEvaluation =>
  outcome(withLifeTokens(context, roleId, operations), declared);
