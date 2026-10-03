import type { RoleRegistry } from "@/data/roleRegistry";
import {
  CANONICAL_ABILITY_SEMANTICS,
  resolveAbilitySemantics,
  type AbilityDescriptor,
  type AbilityInputRequirement,
  type AbilityInputs,
  type AbilityInputValue,
  type AbilityJudgments,
  type AbilitySemanticsRegistry,
  type InformationConstraint,
  type InformationConstraintValue,
} from "@/abilities/semantics";
import { invocationEligibility, isInvocationPath, nightTriggerJudgmentId, nightTriggerStatus, type InvocationPath } from "@/abilities/invocation";
import { activeModifiers, type ModifierDefinition } from "@/abilities/modifiers";
import { applyAlignmentPlan, defaultAlignmentIds, planAlignmentTransaction, type AlignmentIdSource, type AlignmentIntent } from "./alignmentResolution";
import { applyEffectPlan, planEffectTransaction, type EffectIdSource, type EffectIntent } from "./effectResolution";
import { applyInformationDeliveryPlan, planInformationDelivery } from "./informationDelivery";
import { applyLifePlan, planLifeTransaction, type LifeConfirmationToken, type LifeIdSource, type LifeIntent, type LifeStatusTarget } from "./lifeResolution";
import { participantStepKey, planNightStepStatus } from "./nightProgress";
import { applyReminderPlan, planReminderTransaction, type ReminderIdSource, type ReminderIntent } from "./reminderResolution";
import { applyRolePlan, defaultRoleIds, planRoleTransaction, type RoleIdSource, type RoleIntent } from "./roleResolution";
import { boundParticipant, createRulesQuery } from "./rulesQuery";
import { MAX_RESOLUTION_ID_LENGTH, StorytellerGamePersistedSchema } from "./schemas";
import { wakeIdentity } from "./wakeIdentity";
import type { MutationContext } from "./history";
import type {
  ExecutionOutcome,
  ExileOutcome,
  InformationActionId,
  InformationValue,
  NightStepStatus,
  ParticipantId,
  PlayerId,
  RoleId,
  Script,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10F: the ONE pure ability coordinator (PHASE10F Section 3.3).
 *
 *   planAbilityResolution(game, request, environment)
 *
 *  1. validates the workflow fingerprint and every participant binding;
 *  2. (guided) resolves verified semantics through the canonical ownership
 *     boundary, applies timing / usage / input / modifier gates and runs the
 *     pure evaluator; (manual) takes the Storyteller's already-resolved,
 *     explicitly labelled outcome;
 *  3. plans each ORDERED operation with the frozen 10A-10E planner (or the pure
 *     Information Delivery / Night-step plan) against ONE evolving working
 *     snapshot, applying each accepted plan to that snapshot only;
 *  4. validates the complete composed game against the authoritative persisted
 *     schema;
 *  5. returns a final plan, a true no-op, or a structured, non-throwing refusal.
 *
 * It never calls a store command (no resolveLife / resolveEffects /
 * resolveReminders / resolveRoles / resolveAlignments -- architecture-guarded)
 * and never reads Reminders or History as mechanical truth. The store's
 * resolveAbility commits an accepted plan exactly once.
 *
 * There is NO generic mechanical order (Section 4): an outcome touching more
 * than one mechanical domain must declare that its operation list IS the
 * ability's order; otherwise it is refused as an incomplete definition.
 * Bookkeeping (Reminder notation, Information Delivery, Night-step completion)
 * may only follow the resolved mechanics.
 */

/** A current participant, bound to the participation instance the
 * Storyteller saw. Every workflow choice stores one -- never a bare PlayerId. */
export type ParticipantBinding = { playerId: PlayerId; participantId: ParticipantId };

/** A Life outcome addressed to a BOUND participant. Translated to the frozen
 * PlayerId-addressed Life intent only after the binding is proven against the
 * working snapshot (Sol decision H-06). Window corrections (retract / amend /
 * late record) are correction workflows of their own, never ability outcomes. */
export type AbilityLifeIntent =
  | { kind: "death" | "resurrection" | "useAbility" | "spendGhostVote" | "restoreGhostVote"; target: ParticipantBinding }
  | { kind: "execution"; target: ParticipantBinding; outcome: ExecutionOutcome; confirmations?: readonly LifeConfirmationToken[] }
  | { kind: "exile"; target: ParticipantBinding; outcome: ExileOutcome }
  | { kind: "correctStatus"; target: ParticipantBinding; status: LifeStatusTarget }
  | { kind: "correctAbilityUsed"; target: ParticipantBinding; used: boolean };

/** Information Values with Player-valued answers as bindings. */
export type AbilityInformationValue =
  | Exclude<InformationValue, { kind: "player" }>
  | { requirementId: string; kind: "player"; participants: ParticipantBinding[] };

export type AbilityOperation =
  | { domain: "life"; intents: readonly AbilityLifeIntent[] }
  | { domain: "effect"; intents: readonly EffectIntent[] }
  | { domain: "reminder"; intents: readonly ReminderIntent[] }
  | { domain: "role"; intents: readonly RoleIntent[] }
  | { domain: "alignment"; intents: readonly AlignmentIntent[] }
  | { domain: "information"; recipient: ParticipantBinding; informationActionId: InformationActionId; values: readonly AbilityInformationValue[]; performedRole?: RoleId }
  | { domain: "nightStep"; day: number; stepKey: string; status: NightStepStatus };

export type AbilityDomain = AbilityOperation["domain"];
export const MECHANICAL_DOMAINS: readonly AbilityDomain[] = ["life", "effect", "role", "alignment"];
export const isMechanical = (domain: AbilityDomain): boolean => MECHANICAL_DOMAINS.includes(domain);

/** An already-resolved, ORDERED outcome built only from frozen primitives. */
export type AbilityOutcome = {
  operations: readonly AbilityOperation[];
  /** Required when the outcome touches more than one mechanical domain: the
   * ability (or the Storyteller, for a manual outcome) declares that the list
   * order IS the mechanical order. Never inferred. */
  mechanicalOrder?: "declared";
};

/** Render-time workflow state, revalidated before commit (Section 5.1). */
export type AbilityWorkflowFingerprint = {
  actor: ParticipantBinding;
  actualRole: RoleId;
  shownRole: RoleId | null;
  isTraveler: boolean;
  phase: StorytellerLobbyRecord["phase"];
  day: number;
  abilityUsed: boolean;
  /** The Night step the workflow was opened from, with its status then. */
  step?: { day: number; stepKey: string; status: NightStepStatus | "absent" };
};

export type GuidedAbilityRequest = {
  mode: "guided";
  fingerprint: AbilityWorkflowFingerprint;
  /** SOL-10F-L3-R1: the generic entry point this guided resolution is invoked
   * through -- the ordinary Night Order or the Day entry. Runtime-validated;
   * the coordinator applies the shared invocation-eligibility contract
   * (src/abilities/invocation.ts) for exactly this path. */
  invocationPath: InvocationPath;
  /** The Role whose ability/procedure is performed (the wake identity). */
  roleId: RoleId;
  inputs: AbilityInputs;
  judgments?: AbilityJudgments;
  resolutionId?: string;
  context?: MutationContext;
  /** Also mark the fingerprint's Night step done in the SAME snapshot. */
  completeStep?: boolean;
};

/** Phase 10F Section 15.5: "Resolve manually / unmodeled interaction". The
 * Storyteller's already-resolved outcome over the same frozen primitives,
 * explicitly labelled (never presented as the computed rule). */
export type ManualAbilityRequest = {
  mode: "manual";
  fingerprint?: AbilityWorkflowFingerprint;
  roleId?: RoleId;
  outcome: AbilityOutcome;
  /** Why it is resolved manually (recorded on every record's Provenance). */
  reason: string;
  resolutionId?: string;
  context?: MutationContext;
  completeStep?: boolean;
};

export type AbilityResolutionRequest = GuidedAbilityRequest | ManualAbilityRequest;

export type AbilityRefusalCode =
  | "needsInput"
  | "unsupported"
  | "notApplicable"
  | "stale"
  | "invalid"
  | "illegal"
  | "domain"
  | "invalidComposition";

export type AbilityRefusal = {
  ok: false;
  code: AbilityRefusalCode;
  message: string;
  /** needsInput: the explicit choices / judgments still required. */
  requirements?: readonly AbilityInputRequirement[];
  /** domain: which frozen planner refused, with its own code and indices. */
  domain?: AbilityDomain;
  domainCode?: string;
  operationIndex?: number;
  intentIndex?: number;
};

export type AbilityPlan = {
  game: StorytellerLobbyRecord;
  resolutionId: string;
  outcome: AbilityOutcome;
  /** Section 15.4: whether this resolution needs a consequence preview and
   * explicit confirmation before commit. */
  needsConfirmation: boolean;
};

export type AbilityPlanResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; plan: AbilityPlan }
  | AbilityRefusal;

export type AbilityIdSources = {
  life?: LifeIdSource;
  effect?: EffectIdSource;
  reminder?: ReminderIdSource;
  role?: RoleIdSource;
  alignment?: AlignmentIdSource;
  deliveryId?: () => string;
  resolutionId?: () => string;
};

export type AbilityEnvironment = {
  script: Script | null;
  registry: RoleRegistry;
  semantics?: AbilitySemanticsRegistry;
  /** Defaults to activeModifiers(game, registry). */
  modifiers?: readonly ModifierDefinition[];
  ids?: AbilityIdSources;
};

export const MAX_ABILITY_OPERATIONS = 32;
/** The judgment id the coordinator asks when the actor's functioning is unknown. */
export const FUNCTIONING_JUDGMENT = "actor:functioning";
export const MAX_MANUAL_REASON_LENGTH = 500;

export const newResolutionId = (): string =>
  "res-" + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const refuse = (code: AbilityRefusalCode, message: string, extra: Partial<AbilityRefusal> = {}): AbilityRefusal =>
  ({ ok: false, code, message, ...extra });

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isOutcome = (value: unknown): value is AbilityOutcome =>
  isObject(value) && Array.isArray(value.operations) && value.operations.every((operation) => isObject(operation) && typeof operation.domain === "string" &&
    (operation.domain === "information" || operation.domain === "nightStep" || Array.isArray(operation.intents)));
const isBinding = (value: unknown): value is ParticipantBinding =>
  isObject(value) && typeof value.playerId === "string" && typeof value.participantId === "string" && !!value.participantId;

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/** Captures the workflow fingerprint from the record the Storyteller sees. */
export function captureFingerprint(
  game: StorytellerLobbyRecord,
  actorPlayerId: PlayerId,
  step?: { day: number; stepKey: string },
): AbilityWorkflowFingerprint | null {
  const player = Object.prototype.hasOwnProperty.call(game.players, actorPlayerId) ? game.players[actorPlayerId]! : undefined;
  if (!player || player.isEmpty || !player.participantId) return null;
  return {
    actor: { playerId: player.id, participantId: player.participantId },
    actualRole: player.actualRole,
    shownRole: player.shownRole,
    isTraveler: player.isTraveler,
    phase: game.phase,
    day: game.day,
    abilityUsed: player.abilityUsed,
    ...(step ? { step: { ...step, status: game.nightProgress[`${step.day}:${step.stepKey}`]?.status ?? "absent" } } : {}),
  };
}

const PHASES: readonly unknown[] = ["setup", "night", "day", "ended"];
const STEP_STATUSES: readonly unknown[] = ["pending", "done", "skipped", "absent"];
const isNonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * SOL-10F-L4: STRUCTURAL validation of a runtime fingerprint, before any
 * comparison with Current State. A malformed / incomplete fingerprint is a
 * malformed caller request (`invalid`), never stale state. Null when well-formed.
 */
export function fingerprintShapeError(fingerprint: unknown): string | null {
  if (!isObject(fingerprint)) return "The workflow fingerprint is missing or malformed.";
  if (!isBinding(fingerprint.actor)) return "The workflow fingerprint names no bound participant.";
  if (typeof fingerprint.actualRole !== "string") return "The workflow fingerprint has no Actual Role.";
  if (fingerprint.shownRole !== null && typeof fingerprint.shownRole !== "string") return "The workflow fingerprint has a malformed Shown Role.";
  if (typeof fingerprint.isTraveler !== "boolean") return "The workflow fingerprint has no Traveler status.";
  if (!PHASES.includes(fingerprint.phase) || !isNonNegativeInteger(fingerprint.day)) return "The workflow fingerprint has no valid Game Moment.";
  if (typeof fingerprint.abilityUsed !== "boolean") return "The workflow fingerprint has no ability-use state.";
  if (fingerprint.step !== undefined) {
    const step = fingerprint.step;
    if (!isObject(step) || !isNonNegativeInteger(step.day) || typeof step.stepKey !== "string" || !step.stepKey || !STEP_STATUSES.includes(step.status)) {
      return "The workflow fingerprint has a malformed Night step.";
    }
  }
  return null;
}

/** SOL-10F-L4: compares a WELL-FORMED fingerprint with Current State
 * (10F-AC-08). Null when current; otherwise why it is stale. Callers validate
 * the shape first (fingerprintShapeError). */
export function staleReason(game: StorytellerLobbyRecord, fingerprint: AbilityWorkflowFingerprint): string | null {
  const actor = boundParticipant(game, fingerprint.actor);
  if (!actor) return "The player in this seat changed since this workflow opened.";
  if (actor.actualRole !== fingerprint.actualRole || actor.shownRole !== fingerprint.shownRole || actor.isTraveler !== fingerprint.isTraveler) {
    return "This player's character changed since this workflow opened.";
  }
  if (game.phase !== fingerprint.phase || game.day !== fingerprint.day) return "The phase changed since this workflow opened.";
  if (actor.abilityUsed !== fingerprint.abilityUsed) return "This player's ability use changed since this workflow opened.";
  if (fingerprint.step) {
    const current = game.nightProgress[`${fingerprint.step.day}:${fingerprint.step.stepKey}`]?.status ?? "absent";
    if (current !== fingerprint.step.status) return "This Night step changed since this workflow opened.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Section 15.4: significant consequences need a preview + confirmation. */
export function outcomeNeedsConfirmation(outcome: AbilityOutcome, judgmentUsed: boolean): boolean {
  if (judgmentUsed) return true;
  const participants = new Set<string>();
  for (const operation of outcome.operations) {
    if (operation.domain === "role" || operation.domain === "alignment") return true;
    if (operation.domain === "life" && operation.intents.some((intent) => intent.kind !== "useAbility")) return true;
    const targets: unknown[] = operation.domain === "life" ? operation.intents.map((i) => i.target)
      : operation.domain === "effect" || operation.domain === "reminder" ? operation.intents.map((i) => (i as { target?: unknown }).target)
        : operation.domain === "information" ? [operation.recipient] : [];
    for (const target of targets) if (isBinding(target)) participants.add(target.participantId);
  }
  return participants.size > 1;
}

function translateLifeIntent(working: StorytellerLobbyRecord, intent: AbilityLifeIntent): LifeIntent | AbilityRefusal {
  if (!isObject(intent) || !isBinding(intent.target)) return refuse("invalid", "A Life outcome names no bound participant.");
  // Sol decision H-06: prove the bound participant still occupies the seat in
  // the WORKING snapshot immediately before translating to the PlayerId intent.
  if (!boundParticipant(working, intent.target)) {
    return refuse("stale", "A chosen player is no longer in that seat -- review and resolve again.");
  }
  const playerId = intent.target.playerId;
  switch (intent.kind) {
    case "death": case "resurrection": case "useAbility": case "spendGhostVote": case "restoreGhostVote":
      return { kind: intent.kind, playerId };
    case "execution":
      return { kind: "execution", playerId, outcome: intent.outcome, ...(intent.confirmations?.length ? { confirmations: intent.confirmations } : {}) };
    case "exile":
      return { kind: "exile", playerId, outcome: intent.outcome };
    case "correctStatus":
      return { kind: "correctStatus", playerId, target: intent.status };
    case "correctAbilityUsed":
      return { kind: "correctAbilityUsed", playerId, used: intent.used };
    default:
      return refuse("invalid", "That Life outcome is not an ability outcome.");
  }
}

function translateInformationValues(working: StorytellerLobbyRecord, values: unknown): InformationValue[] | AbilityRefusal {
  if (!Array.isArray(values)) return refuse("invalid", "Information values must be a list.");
  const out: InformationValue[] = [];
  for (const value of values) {
    if (!isObject(value)) return refuse("invalid", "Malformed information value.");
    if (value.kind !== "player") { out.push(value as InformationValue); continue; }
    if (!Array.isArray(value.participants) || !value.participants.every(isBinding)) return refuse("invalid", "Player-valued information must name bound participants.");
    if (!value.participants.every((binding) => boundParticipant(working, binding))) {
      return refuse("stale", "A player named in the information is no longer in that seat.");
    }
    out.push({ requirementId: String(value.requirementId), kind: "player", playerIds: value.participants.map((b) => b.playerId) });
  }
  return out;
}

/** The structural ordering contract (Section 4). */
function checkOrdering(outcome: AbilityOutcome): AbilityRefusal | null {
  const domains = outcome.operations.map((operation) => operation.domain);
  const mechanical = new Set(domains.filter(isMechanical));
  if (mechanical.size > 1 && outcome.mechanicalOrder !== "declared") {
    return refuse("unsupported", "This ability changes more than one kind of game state but declares no order -- the definition is incomplete. Resolve it manually.");
  }
  const lastMechanical = domains.reduce((last, domain, index) => (isMechanical(domain) ? index : last), -1);
  const firstBookkeeping = domains.findIndex((domain) => !isMechanical(domain));
  if (firstBookkeeping >= 0 && firstBookkeeping < lastMechanical) {
    return refuse("invalid", "Notation, information and step completion follow the resolved mechanics.");
  }
  // A same-participant Role or Alignment chain the frozen seam does not
  // support is refused, never silently collapsed.
  // The Role seam itself accepts ONE Actual Role intent per participant with
  // perception intents alongside it (PHASE10D), so only Actual Role intents
  // form a chain; a perception update with its Role change is not one.
  for (const domain of ["role", "alignment"] as const) {
    const seen = new Set<string>();
    for (const operation of outcome.operations) {
      if (operation.domain !== domain) continue;
      for (const intent of operation.intents) {
        if (domain === "role" && (intent as { kind?: unknown }).kind === "setPerception") continue;
        const target = (intent as { target?: unknown }).target;
        if (!isBinding(target)) continue;
        if (seen.has(target.participantId)) {
          return refuse("unsupported", `This outcome changes one player's ${domain === "role" ? "character" : "alignment"} more than once -- resolve it manually in separate steps.`);
        }
        seen.add(target.participantId);
      }
    }
  }
  return null;
}

type ComposeOptions = {
  context?: MutationContext;
  resolutionId: string;
  completeStep?: AbilityWorkflowFingerprint["step"];
  /** A simulated wake has no ability: only bookkeeping may result. */
  simulated?: { performedRole: RoleId };
};

/** Plans an ordered outcome against one evolving working snapshot. Pure. */
export function composeAbilityOutcome(
  game: StorytellerLobbyRecord,
  outcome: AbilityOutcome,
  environment: AbilityEnvironment,
  options: ComposeOptions,
): AbilityPlanResult {
  if (!isOutcome(outcome)) return refuse("invalid", "Malformed ability outcome.");
  if (outcome.operations.length > MAX_ABILITY_OPERATIONS) return refuse("invalid", `At most ${MAX_ABILITY_OPERATIONS} operations can be resolved at once.`);
  if (!outcome.operations.every((operation) => isObject(operation) && typeof operation.domain === "string" &&
    ["life", "effect", "reminder", "role", "alignment", "information", "nightStep"].includes(operation.domain))) {
    return refuse("invalid", "Malformed ability operation.");
  }
  const ordering = checkOrdering(outcome);
  if (ordering) return ordering;
  if (options.simulated && outcome.operations.some((operation) => isMechanical(operation.domain))) {
    return refuse("illegal", "A simulated wake has no ability: it never changes Life, Effects, Role or Alignment.");
  }
  const ids = environment.ids ?? {};
  const { context, resolutionId } = options;
  let working = game;

  for (const [operationIndex, operation] of outcome.operations.entries()) {
    const domainRefusal = (domain: AbilityDomain, result: { code: string; message: string; intentIndex?: number }): AbilityRefusal =>
      refuse("domain", result.message, { domain, domainCode: result.code, operationIndex, ...(result.intentIndex !== undefined ? { intentIndex: result.intentIndex } : {}) });
    if (operation.domain !== "information" && operation.domain !== "nightStep" && !Array.isArray(operation.intents)) {
      return refuse("invalid", "Malformed ability operation.", { operationIndex });
    }
    switch (operation.domain) {
      case "life": {
        const intents: LifeIntent[] = [];
        for (const [intentIndex, intent] of operation.intents.entries()) {
          const translated = translateLifeIntent(working, intent);
          if ("ok" in translated) return { ...translated, operationIndex, intentIndex };
          intents.push(translated);
        }
        const result = planLifeTransaction(working, { intents, resolutionId, ...(context ? { context } : {}) }, ids.life);
        if (!result.ok) return domainRefusal("life", result);
        if (result.changed) working = applyLifePlan(working, result.plan);
        break;
      }
      case "effect": {
        const result = planEffectTransaction(working, { intents: [...operation.intents], resolutionId, ...(context ? { context } : {}) }, ids.effect);
        if (!result.ok) return domainRefusal("effect", result);
        if (result.changed) working = applyEffectPlan(working, result.plan);
        break;
      }
      case "reminder": {
        const result = planReminderTransaction(working, { intents: [...operation.intents], resolutionId, ...(context ? { context } : {}) }, ids.reminder);
        if (!result.ok) return domainRefusal("reminder", result);
        if (result.changed) working = applyReminderPlan(working, result.plan);
        break;
      }
      case "role": {
        const result = planRoleTransaction(working, { intents: [...operation.intents], resolutionId, ...(context ? { context } : {}) },
          { script: environment.script, ids: ids.role ?? defaultRoleIds });
        if (!result.ok) return domainRefusal("role", result);
        if (result.changed) working = applyRolePlan(working, result.plan);
        break;
      }
      case "alignment": {
        const result = planAlignmentTransaction(working, { intents: [...operation.intents], resolutionId, ...(context ? { context } : {}) },
          { ids: ids.alignment ?? defaultAlignmentIds });
        if (!result.ok) return domainRefusal("alignment", result);
        if (result.changed) working = applyAlignmentPlan(working, result.plan);
        break;
      }
      case "information": {
        if (!isBinding(operation.recipient)) return refuse("invalid", "The information recipient is not a bound participant.", { operationIndex });
        if (!boundParticipant(working, operation.recipient)) return refuse("stale", "The information recipient is no longer in that seat.", { operationIndex });
        const values = translateInformationValues(working, operation.values);
        if ("ok" in values) return { ...values, operationIndex };
        const performedRole = options.simulated?.performedRole ?? operation.performedRole;
        const result = planInformationDelivery(working, {
          recipientPlayerId: operation.recipient.playerId,
          informationActionId: operation.informationActionId,
          values,
          resolutionId,
          ...(performedRole ? { performedRole } : {}),
          ...(context ? { context } : {}),
        }, { registry: environment.registry, ...(ids.deliveryId ? { deliveryId: ids.deliveryId } : {}) });
        if (!result.ok) return domainRefusal("information", { code: "refused", message: result.message });
        working = applyInformationDeliveryPlan(working, result.record);
        break;
      }
      case "nightStep": {
        if (typeof operation.day !== "number" || typeof operation.stepKey !== "string" || !operation.stepKey ||
          !["pending", "done", "skipped"].includes(operation.status)) return refuse("invalid", "Malformed Night step.", { operationIndex });
        working = planNightStepStatus(working, operation.day, operation.stepKey, operation.status) ?? working;
        break;
      }
    }
  }
  if (options.completeStep) {
    working = planNightStepStatus(working, options.completeStep.day, options.completeStep.stepKey, "done") ?? working;
  }

  // True no-op: no authoritative state and no requested progress changed.
  if (working === game) return { ok: true, changed: false };

  // Final validation of the WHOLE composed snapshot (10F-AC-05).
  const parsed = StorytellerGamePersistedSchema.safeParse(working);
  if (!parsed.success) {
    return refuse("invalidComposition", "The combined result failed validation -- nothing was recorded.");
  }
  return { ok: true, changed: true, plan: { game: working, resolutionId, outcome, needsConfirmation: outcomeNeedsConfirmation(outcome, false) } };
}

// ---------------------------------------------------------------------------
// Typed information constraints (SOL-10F-L5)
// ---------------------------------------------------------------------------

const CONSTRAINT_KINDS: readonly unknown[] = ["number", "boolean", "text", "role", "alignment", "player"];
function isConstraintValue(value: unknown): value is InformationConstraintValue {
  if (!isObject(value) || !CONSTRAINT_KINDS.includes(value.kind)) return false;
  switch (value.kind) {
    case "number": return typeof value.value === "number" && Number.isFinite(value.value);
    case "boolean": return typeof value.value === "boolean";
    case "text": return typeof value.value === "string";
    case "role": return typeof value.roleId === "string" && !!value.roleId;
    case "alignment": return value.alignment === "good" || value.alignment === "evil";
    case "player": return Array.isArray(value.participantIds) && value.participantIds.every((id) => typeof id === "string" && !!id) &&
      (value.order === "ordered" || value.order === "unordered");
  }
  return false;
}

/** Whether one delivered value is exactly an allowed constraint value. Kinds
 * must match; Player-valued information compares the bound ParticipantIds
 * (never the reusable PlayerId), with the constraint's explicit cardinality and
 * order. */
function constraintAllows(allowed: InformationConstraintValue, delivered: Record<string, unknown>): boolean {
  switch (allowed.kind) {
    case "number": case "boolean": case "text":
      return delivered.kind === allowed.kind && delivered.value === allowed.value;
    case "role": return delivered.kind === "role" && delivered.roleId === allowed.roleId;
    case "alignment": return delivered.kind === "alignment" && delivered.alignment === allowed.alignment;
    case "player": {
      if (delivered.kind !== "player" || !Array.isArray(delivered.participants) || !delivered.participants.every(isBinding)) return false;
      const ids = delivered.participants.map((binding) => binding.participantId);
      if (ids.length !== allowed.participantIds.length) return false;
      const [a, b] = allowed.order === "ordered" ? [ids, [...allowed.participantIds]] : [[...ids].sort(), [...allowed.participantIds].sort()];
      return a.every((id, index) => id === b[index]);
    }
  }
}

// ---------------------------------------------------------------------------
// Guided evaluation
// ---------------------------------------------------------------------------

/** Structural validation of every declared input. Missing -> needsInput;
 * malformed -> invalid; stale binding -> stale; violated constraint -> illegal. */
function checkInputs(game: StorytellerLobbyRecord, descriptor: AbilityDescriptor, actor: ParticipantBinding, inputs: AbilityInputs): AbilityRefusal | null {
  if (!isObject(inputs)) return refuse("invalid", "Malformed ability inputs.");
  const missing = descriptor.inputs.filter((requirement) => !Object.prototype.hasOwnProperty.call(inputs, requirement.id));
  if (missing.length) return refuse("needsInput", "Choose: " + missing.map((r) => r.label).join(", ") + ".", { requirements: missing });
  for (const requirement of descriptor.inputs) {
    const value = inputs[requirement.id] as AbilityInputValue;
    if (!isObject(value) || value.kind !== requirement.kind) return refuse("invalid", `Malformed answer for "${requirement.label}".`);
    if (value.kind !== "participant") continue;
    const count = requirement.count ?? 1;
    const none = requirement.allowNone === true && Array.isArray(value.participants) && value.participants.length === 0;
    if (!Array.isArray(value.participants) || !value.participants.every(isBinding) || (value.participants.length !== count && !none)) {
      return refuse("invalid", `"${requirement.label}" needs exactly ${count} player${count === 1 ? "" : "s"}${requirement.allowNone ? " (or nobody)" : ""}.`);
    }
    for (const binding of value.participants) {
      const player = boundParticipant(game, binding);
      if (!player) return refuse("stale", "A chosen player is no longer in that seat -- review and resolve again.");
      const constraints = requirement.constraints ?? [];
      if (constraints.includes("notSelf") && binding.participantId === actor.participantId) return refuse("illegal", `"${requirement.label}" cannot be the player themself.`);
      if (constraints.includes("alive") && !player.alive) return refuse("illegal", `"${requirement.label}" must be a living player.`);
      if (constraints.includes("dead") && player.alive) return refuse("illegal", `"${requirement.label}" must be a dead player.`);
    }
    if ((requirement.constraints ?? []).includes("distinct") &&
      new Set(value.participants.map((b) => b.participantId)).size !== value.participants.length) {
      return refuse("illegal", `"${requirement.label}" must name different players.`);
    }
  }
  return null;
}

/** The pure coordinator. Never throws; never writes the store. */
export function planAbilityResolution(
  game: StorytellerLobbyRecord,
  request: AbilityResolutionRequest,
  environment: AbilityEnvironment,
): AbilityPlanResult {
  try {
    return plan(game, request, environment);
  } catch {
    // Backstop: hostile input must surface as a structured refusal.
    return refuse("invalid", "Malformed ability request.");
  }
}

function plan(game: StorytellerLobbyRecord, request: AbilityResolutionRequest, environment: AbilityEnvironment): AbilityPlanResult {
  if (!isObject(request) || (request.mode !== "guided" && request.mode !== "manual")) return refuse("invalid", "Malformed ability request.");
  const { resolutionId: requested } = request;
  if (requested !== undefined && (typeof requested !== "string" || !requested || requested.length > MAX_RESOLUTION_ID_LENGTH)) {
    return refuse("invalid", "Invalid resolution id.");
  }
  const resolutionId = requested ?? (environment.ids?.resolutionId ?? newResolutionId)();
  if (request.fingerprint !== undefined) {
    const malformed = fingerprintShapeError(request.fingerprint);
    if (malformed) return refuse("invalid", malformed);
    const stale = staleReason(game, request.fingerprint);
    if (stale) return refuse("stale", stale);
  }
  const completeStep = request.completeStep ? request.fingerprint?.step : undefined;
  if (request.completeStep && !completeStep) return refuse("invalid", "There is no Night step to complete.");

  if (request.mode === "manual") {
    if (typeof request.reason !== "string" || !request.reason.trim() || request.reason.length > MAX_MANUAL_REASON_LENGTH) {
      return refuse("invalid", "Say why this is resolved manually.");
    }
    // The bypass is visible: every record of this resolution carries it.
    const provenance = { ...(request.context?.provenance ?? {}), reason: "manual", note: request.reason.trim() };
    const result = composeAbilityOutcome(game, request.outcome, environment, { context: { ...(request.context ?? {}), provenance }, resolutionId, ...(completeStep ? { completeStep } : {}) });
    if (result.ok && result.changed) result.plan.needsConfirmation = true;
    return result;
  }

  // --- Guided ----------------------------------------------------------------
  if (!isObject(request.fingerprint)) return refuse("invalid", "A guided resolution needs the workflow it was opened from.");
  if (!isInvocationPath(request.invocationPath)) return refuse("invalid", "A guided resolution must name its invocation path (the Night Order or the Day entry).");
  const actor = boundParticipant(game, request.fingerprint.actor);
  if (!actor) return refuse("stale", "The player in this seat changed since this workflow opened.");
  const semantics = resolveAbilitySemantics(request.roleId, environment.registry, environment.semantics ?? CANONICAL_ABILITY_SEMANTICS);
  if (semantics.kind === "homebrew") return refuse("unsupported", `${semantics.role.name} is not a verified official character -- resolve it manually.`);
  if (semantics.kind === "verifiedManual") return refuse("unsupported", semantics.note);
  if (semantics.kind === "unsupported") return refuse("unsupported", "Silverwick has no verified rules for this ability yet -- resolve it manually.");
  const { descriptor } = semantics;

  // The performed Role must be the actor's own ability or their simulated wake.
  const wake = wakeIdentity(actor, environment.registry);
  const performsActual = request.roleId === actor.actualRole && !(wake?.simulated && wake.shownRoleId !== actor.actualRole);
  const simulated = !performsActual && wake?.simulated === true && wake.shownRoleId === request.roleId;
  if (!performsActual && !simulated) return refuse("invalid", "That is not this player's ability.");

  // SOL-10F-L3-R1: the SAME timing + invocation contract the entry points use;
  // a crafted request cannot reach an ability its path may not invoke.
  const eligibility = invocationEligibility(descriptor, request.invocationPath, game);
  if (!eligibility.eligible) return refuse("notApplicable", eligibility.reason);
  if (descriptor.usage.kind === "oncePerGame" && actor.abilityUsed && !simulated) return refuse("notApplicable", "This ability has already been used.");
  // Slice 7: participant-scoped Night progress is the authority for "already
  // acted tonight" -- a step this participation instance already completed or
  // had skipped (e.g. a new Imp after a star-pass) is never re-granted by the
  // ordinary Night Order, whatever the re-derived rows or a crafted request say.
  if ((request.invocationPath === "nightOrder" || request.invocationPath === "nightTrigger") && actor.participantId) {
    const own = game.nightProgress[`${game.day}:${participantStepKey(actor.participantId, request.roleId)}`]?.status;
    if (own === "done" || own === "skipped") return refuse("notApplicable", "This player's step for this ability is already complete or skipped tonight.");
  }
  // Slice 7: a verified Night trigger resolves as THIS participation instance's
  // own step, so it can be completed exactly once (no duplicate execution).
  if (request.invocationPath === "nightTrigger" && actor.participantId) {
    const step = request.fingerprint.step;
    if (!step || step.day !== game.day || step.stepKey !== participantStepKey(actor.participantId, request.roleId)) {
      return refuse("invalid", "A triggered ability resolves as this player's own Night step.");
    }
  }

  const actorBinding = { playerId: actor.id, participantId: actor.participantId! };
  const inputCheck = checkInputs(game, descriptor, actorBinding, request.inputs);
  if (inputCheck) return inputCheck;

  const query = createRulesQuery(game, { registry: environment.registry, script: environment.script, ...(environment.semantics ? { semantics: environment.semantics } : {}),
    modifiers: environment.modifiers ?? activeModifiers(game, environment.registry) });
  const judgments = isObject(request.judgments) ? request.judgments : {};
  let judgmentUsed = false;
  // 10F-AC-12: impairment is derived, never guessed. Unknown -> an explicit
  // Storyteller judgment; a simulated wake never functions.
  let functioning = false;
  if (!simulated) {
    const answer = query.abilityFunctions(actorBinding);
    if (answer.known) functioning = answer.value;
    else {
      const judged = judgments[FUNCTIONING_JUDGMENT];
      if (!isObject(judged) || judged.kind !== "boolean") {
        return refuse("needsInput", answer.reason, { requirements: [{ id: FUNCTIONING_JUDGMENT, kind: "boolean", source: "judgment",
          label: `${actor.name || "This player"}'s ability is functioning` }] });
      }
      functioning = judged.value;
      judgmentUsed = true;
    }
  }
  // Slice 7: the verified trigger must be established from authoritative state
  // (Life Event Window with coverage); unknown is an explicit Storyteller
  // judgment, never "did not trigger".
  if (request.invocationPath === "nightTrigger") {
    const trigger = nightTriggerStatus(descriptor, actorBinding, query);
    if (trigger.kind === "notTriggered") return refuse("notApplicable", trigger.reason);
    if (trigger.kind === "unknown") {
      const id = nightTriggerJudgmentId(descriptor.nightTrigger!);
      const judged = judgments[id];
      if (!isObject(judged) || judged.kind !== "boolean") {
        return refuse("needsInput", trigger.reason, { requirements: [{ id, kind: "boolean", source: "judgment", label: "This ability triggered tonight" }] });
      }
      if (!judged.value) return refuse("notApplicable", "The Storyteller judged that this ability did not trigger.");
      judgmentUsed = true;
    }
  }
  const gate = query.modifierGate(request.roleId, descriptor.hooks);
  if (gate.kind === "gated") {
    const open = gate.modifiers.filter((modifier) => {
      const answer = judgments[`modifier:${modifier.id}`];
      return !(isObject(answer) && answer.kind === "boolean" && answer.value === true);
    });
    if (open.length) {
      return refuse("needsInput", "A rule modifier in play could change this ability. Confirm it does not, or resolve manually.", {
        requirements: open.map((modifier) => ({ id: `modifier:${modifier.id}`, kind: "boolean", source: "judgment", label: `${modifier.label} does not change this resolution` })),
      });
    }
    judgmentUsed = true;
  }
  const constraints: InformationConstraint[] = [];
  if (gate.kind === "constrained") {
    for (const { modifier, result } of gate.results) {
      if (result.kind === "unsupported") return refuse("unsupported", result.message);
      if (result.kind === "judgment") {
        const answer = judgments[`modifier:${modifier.id}`];
        if (!(isObject(answer) && answer.kind === "boolean" && answer.value === true)) {
          return refuse("needsInput", result.message, { requirements: [{ id: `modifier:${modifier.id}`, kind: "boolean", source: "judgment", label: result.message }] });
        }
        judgmentUsed = true;
      }
      if (result.kind === "constrainInformation") {
        constraints.push({ modifierId: modifier.id, requirementId: result.requirementId, allowed: result.allowed, reason: result.reason });
      }
    }
  }
  if (!descriptor.evaluator) return refuse("unsupported", "This ability's outcome is not modeled -- resolve it manually.");
  const evaluation = descriptor.evaluator({ actor: { binding: actorBinding, player: actor }, roleId: request.roleId, simulated, functioning,
    inputs: request.inputs, judgments, query, constraints });
  switch (evaluation.kind) {
    case "needsInput": return refuse("needsInput", evaluation.message, { requirements: evaluation.requirements });
    case "notApplicable": return refuse("notApplicable", evaluation.message);
    case "unsupported": return refuse("unsupported", evaluation.message);
    case "illegal": return refuse("illegal", evaluation.message);
    case "stale": return refuse("stale", evaluation.message);
    case "outcome": break;
    default: return refuse("invalid", "The ability evaluator returned no outcome.");
  }
  const outcome = evaluation.outcome;
  if (!isOutcome(outcome)) return refuse("invalid", "The ability evaluator returned a malformed outcome.");
  const usesOwnAbility = (operation: AbilityOperation) => operation.domain === "life" && operation.intents.length > 0 &&
    operation.intents.every((intent) => intent.kind === "useAbility" && isBinding(intent.target) && intent.target.participantId === actorBinding.participantId);
  // A once-per-game ability that does something must record its use through
  // the Life boundary in the same snapshot (10F-AC-15).
  if (descriptor.usage.kind === "oncePerGame" && !simulated && !outcome.operations.some((operation) =>
    operation.domain === "life" && operation.intents.some((intent) =>
      intent.kind === "useAbility" && isBinding(intent.target) && intent.target.participantId === actorBinding.participantId))) {
    return refuse("unsupported", "This once-per-game ability's definition does not record its use -- the definition is incomplete.");
  }
  // A non-functioning ability changes no Current State beyond recording its use.
  if (!functioning && !simulated && outcome.operations.some((operation) => isMechanical(operation.domain) && !usesOwnAbility(operation))) {
    return refuse("illegal", "This ability is not functioning (drunk, poisoned or lost): it changes nothing but its use.");
  }
  // A verified information modifier constrains what may be delivered: EVERY
  // delivered value of the constrained requirement -- Player-valued included
  // (SOL-10F-L5), compared by stable ParticipantId -- must be one the modifier
  // allows. A constraint that cannot be enforced fails safe (unsupported); it
  // is never silently skipped.
  for (const constraint of constraints) {
    if (!Array.isArray(constraint.allowed) || !constraint.allowed.every(isConstraintValue)) {
      return refuse("unsupported", "A rule modifier's information constraint cannot be enforced -- resolve manually.");
    }
    for (const operation of outcome.operations) {
      if (operation.domain !== "information" || !Array.isArray(operation.values)) continue;
      for (const value of operation.values) {
        if (!isObject(value) || value.requirementId !== constraint.requirementId) continue;
        if (!constraint.allowed.some((allowed) => constraintAllows(allowed, value))) return refuse("illegal", constraint.reason);
      }
    }
  }
  const judgmentAnswered = judgmentUsed || descriptor.inputs.some((requirement) => requirement.source === "judgment") || Object.keys(judgments).length > 0;
  const result = composeAbilityOutcome(game, outcome, environment, {
    resolutionId,
    ...(request.context ? { context: request.context } : {}),
    ...(completeStep ? { completeStep } : {}),
    ...(simulated ? { simulated: { performedRole: request.roleId } } : {}),
  });
  if (result.ok && result.changed) result.plan.needsConfirmation = outcomeNeedsConfirmation(outcome, judgmentAnswered);
  return result;
}
