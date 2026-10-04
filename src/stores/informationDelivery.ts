import { z } from "zod";
import type { RoleRegistry } from "@/data/roleRegistry";
import { currentGameMoment } from "./effects";
import { cloneOwned, durableProvenance, type MutationContext } from "./history";
import { participantRefOf, recordedInformationValues } from "./participants";
import { InformationValueSchema, MAX_MANUAL_DELIVERY_TEXT, MAX_RESOLUTION_ID_LENGTH } from "./schemas";
import { currentLiveMoment } from "./lifeEvents";
import { wakeIdentity } from "./wakeIdentity";
import type {
  InformationActionId,
  InformationDeliveryId,
  InformationDeliveryRecord,
  InformationRequirement,
  InformationTiming,
  InformationValue,
  ManualInformationDeliveryRecord,
  PlayerId,
  RoleId,
  StorytellerLobbyRecord,
} from "./types";

export const informationDeliveryId = (): InformationDeliveryId =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2, 10)}`;

export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Structural coherence of an Information Action's own Requirement
 * definitions -- not the supplied Information Values. A malformed Role
 * Information definition (duplicate Requirement ids within one Action, an
 * invalid cardinality count) must fail the command safely rather than
 * silently resolving to whichever requirement happened to be found first.
 */
export function validateRequirementsCoherent(requirements: InformationRequirement[]): ValidationResult {
  const seen = new Set<string>();
  for (const requirement of requirements) {
    if (seen.has(requirement.id)) {
      return { ok: false, message: `Malformed Information Action: duplicate requirement id "${requirement.id}".` };
    }
    seen.add(requirement.id);
    const cardinality = requirement.cardinality;
    if (cardinality && cardinality.kind !== "optional"
      && !(Number.isInteger(cardinality.count) && cardinality.count > 0)) {
      return { ok: false, message: `Malformed Information Action: invalid cardinality for requirement "${requirement.id}".` };
    }
    // Phase 9R.1 (Finding B3.3): only a "player" Information Value ever
    // carries an array (`playerIds`) -- every other kind's InformationValue
    // shape represents exactly one value, structurally. A requirement of a
    // non-player kind declaring a cardinality that needs more than one
    // value (exactly N>1, or atLeast N>1) can therefore never be satisfied
    // by any value this data model can express -- that is a malformed/
    // unsupported requirement definition, never something a single scalar
    // value should be allowed to silently "satisfy".
    if (cardinality && cardinality.kind !== "optional" && requirement.kind !== "player" && cardinality.count > 1) {
      return {
        ok: false,
        message: `Malformed Information Action: requirement "${requirement.id}" is a scalar kind ("${requirement.kind}") but declares a cardinality of ${cardinality.count}, which no single Information Value can satisfy.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Enforce Information Action timing only where Silverwick already has
 * explicit knowledge (Phase 9D.4 Section 2): firstNight is valid only on
 * Night 1, otherNight only on a later Night. Triggered/manual Actions
 * remain entirely Storyteller-controlled -- no trigger condition is
 * modeled, so they are always accepted here.
 */
export function validateInformationTiming(
  timing: InformationTiming,
  game: { phase: string; day: number }
): ValidationResult {
  if (timing.kind === "firstNight") {
    return game.phase === "night" && game.day === 1
      ? { ok: true }
      : { ok: false, message: "This is a first-night Information Action; it is valid only during Night 1." };
  }
  if (timing.kind === "otherNight") {
    return game.phase === "night" && game.day > 1
      ? { ok: true }
      : { ok: false, message: "This is an other-night Information Action; it is valid only during a later Night." };
  }
  return { ok: true };
}

type ExistenceLookup<T> = { has: (id: T) => boolean };

/** What Player/Role ids Silverwick can confirm actually exist right now.
 * Passed in by the caller (which holds the authoritative game snapshot
 * and Role registry) so this module stays a pure structural validator.
 * A plain Set satisfies this, and so does a thin `{ has }` wrapper around
 * RoleRegistry.get -- the caller is never required to enumerate every
 * Role id up front just to check membership. */
export type ReferenceContext = {
  playerIds?: ExistenceLookup<PlayerId>;
  roleIds?: ExistenceLookup<RoleId>;
};

export type ParsedInformationValues =
  | { ok: true; values: InformationValue[] }
  | { ok: false; message: string };

/**
 * Phase 9R.1 Astra remediation (Finding A1): complete runtime structural
 * validation of caller-supplied Information Values, against the SAME
 * InformationValueSchema (schemas.ts) the persisted/checkpoint boundary
 * already validates against -- the one canonical structural definition,
 * never a second hand-duplicated copy of the union. TypeScript's
 * InformationValue union constrains authoring, never runtime callers: a
 * Boolean value with no `value`, a Player value whose `playerIds` is
 * missing, not an array, contains `undefined`, or contains an empty
 * string, a Number value that is missing or not a number, and similar
 * malformed runtime-only shapes can all reach this command despite never
 * compiling as valid TypeScript input.
 *
 * Returns the SCHEMA-PARSED values, not the raw input, as the canonical
 * representation every subsequent step -- reference/cardinality
 * validation (validateInformationValues, unchanged below) and eventual
 * storage -- must use: zod's object parsing silently strips any property
 * that is not part of the schema, so a malformed extra or unsafe nested
 * property on an otherwise-valid value can never survive into
 * authoritative state (Finding A1, "canonical stored Information").
 */
export function parseInformationValues(values: unknown): ParsedInformationValues {
  const parsed = z.array(InformationValueSchema).safeParse(values);
  if (parsed.success) return { ok: true, values: parsed.data };
  const issue = parsed.error.issues[0];
  const path = issue?.path.join(".") ?? "";
  return {
    ok: false,
    message: `Malformed Information Value${path ? ` at "${path}"` : ""}: ${issue?.message ?? "does not match the expected structure"}.`,
  };
}

/**
 * Structural validation only: did the Storyteller supply the type and
 * amount of information this Information Action's Requirements expect,
 * and do any Player/Role references actually resolve? This never judges
 * whether the recorded answer is the mechanically correct BOTC one --
 * that stays Storyteller judgment (Phase 9D.3 Section 9/13; Phase 9D.4
 * Section 10). A structurally valid but mechanically false answer (a
 * poisoned Empath's real number, a Fortune Teller's red herring "no") is
 * exactly what this must accept. Whether the *chosen* Player/Role was the
 * mechanically correct one is likewise never judged here -- only whether
 * it exists.
 */
export function validateInformationValues(
  requirements: InformationRequirement[],
  values: InformationValue[],
  refs: ReferenceContext = {}
): ValidationResult {
  const knownRequirementIds = new Set(requirements.map((r) => r.id));
  const seenRequirementIds = new Set<string>();

  for (const value of values) {
    if (!knownRequirementIds.has(value.requirementId)) {
      return { ok: false, message: `Value supplied for unknown requirement "${value.requirementId}".` };
    }
    // Ambiguous duplicate supplied values for the same Requirement are
    // rejected outright, never silently collapsed to "last one wins".
    if (seenRequirementIds.has(value.requirementId)) {
      return { ok: false, message: `Multiple values supplied for requirement "${value.requirementId}".` };
    }
    seenRequirementIds.add(value.requirementId);

    // Phase 9R.1 (Finding B3.1): a non-finite Number Information Value
    // (NaN, Infinity, -Infinity) must never enter authoritative state --
    // JSON conversion silently turns NaN/±Infinity into `null` on the way
    // to persistence/Firebase, which would then rehydrate as a value the
    // Storyteller never actually recorded. This is purely a structural
    // guard, not an invented gameplay range limit: any finite number,
    // including negative or zero, continues to be accepted exactly as
    // before.
    if (value.kind === "number" && !Number.isFinite(value.value)) {
      return { ok: false, message: `"${value.requirementId}" must be a finite number.` };
    }

    if (value.kind === "player" && refs.playerIds) {
      for (const playerId of value.playerIds) {
        if (!refs.playerIds.has(playerId)) {
          return { ok: false, message: `"${value.requirementId}" references a Player who does not exist ("${playerId}").` };
        }
      }
    }
    if (value.kind === "role" && refs.roleIds && !refs.roleIds.has(value.roleId)) {
      return { ok: false, message: `"${value.requirementId}" references a Role that does not exist ("${value.roleId}").` };
    }
  }

  const byRequirement = new Map(values.map((v) => [v.requirementId, v]));
  for (const requirement of requirements) {
    const cardinality = requirement.cardinality ?? { kind: "exactly" as const, count: 1 };
    const value = byRequirement.get(requirement.id);

    if (!value) {
      if (cardinality.kind === "optional") continue;
      return { ok: false, message: `Missing required value for "${requirement.id}".` };
    }

    if (value.kind !== requirement.kind) {
      return {
        ok: false,
        message: `"${requirement.id}" expects a ${requirement.kind} value, but received ${value.kind}.`,
      };
    }

    if (value.kind === "player") {
      const count = value.playerIds.length;
      if (cardinality.kind === "exactly" && count !== cardinality.count) {
        return {
          ok: false,
          message: `"${requirement.id}" expects exactly ${cardinality.count} player(s), but received ${count}.`,
        };
      }
      if (cardinality.kind === "atLeast" && count < cardinality.count) {
        return {
          ok: false,
          message: `"${requirement.id}" expects at least ${cardinality.count} player(s), but received ${count}.`,
        };
      }
      if (cardinality.kind === "optional" && count > 1) {
        return { ok: false, message: `"${requirement.id}" expects at most one player.` };
      }
    }
  }

  return { ok: true };
}


/**
 * Phase 10F foundation: pure Information Delivery planning.
 *
 * The old store command performed validation, durable-reference conversion,
 * record construction and the store commit in one function. Ability resolution
 * needs the first four steps without creating an intermediate authoritative
 * commit, so they live here as a pure planner. The legacy store command remains
 * an adapter over this plan and therefore keeps its existing behavior.
 *
 * Phase 10F (v24): a delivery may additionally record
 *  - `performedRole`: the character procedure actually performed when it
 *    differs from the recipient's Actual Role. AUTHORIZED, never trusted: it
 *    must be the recipient's current SIMULATED wake identity (wakeIdentity --
 *    e.g. a Drunk shown as the Empath), resolvable in the active registry, and
 *    the Information Action must belong to it. A caller can never attach an
 *    arbitrary Role. Recording it creates no Current State and never implies
 *    the recipient holds that Role.
 *  - `resolutionId`: correlation with the other records of one ability
 *    resolution (bounded; metadata only).
 */
export type InformationDeliveryPlanRequest = {
  recipientPlayerId: PlayerId;
  informationActionId: InformationActionId;
  values: unknown;
  context?: MutationContext;
  /** Phase 10F: the simulated procedure performed (see above). Omitted, or
   * equal to the Actual Role, means the Actual Role's own ability. */
  performedRole?: RoleId;
  resolutionId?: string;
};

export type InformationDeliveryPlanEnvironment = {
  /** The game's active Role registry; null when its script cannot be
   * resolved (refused as "Unknown script." after the recipient checks). */
  registry: RoleRegistry | null;
  deliveryId?: () => InformationDeliveryId;
};

export type InformationDeliveryPlanResult =
  | { ok: true; record: InformationDeliveryRecord }
  | { ok: false; message: string };

export function planInformationDelivery(
  game: StorytellerLobbyRecord,
  request: InformationDeliveryPlanRequest,
  environment: InformationDeliveryPlanEnvironment,
): InformationDeliveryPlanResult {
  const recipient = participantRefOf(game, request.recipientPlayerId);
  const player = recipient ? game.players[request.recipientPlayerId] : undefined;
  if (!recipient || !player) return { ok: false, message: "This player is not seated." };
  if (!player.actualRole) return { ok: false, message: "This player has no Actual Role yet." };
  const { registry } = environment;
  if (!registry) return { ok: false, message: "Unknown script." };

  const { resolutionId } = request;
  if (resolutionId !== undefined &&
    (typeof resolutionId !== "string" || !resolutionId || resolutionId.length > MAX_RESOLUTION_ID_LENGTH)) {
    return { ok: false, message: "Invalid resolution id." };
  }
  // Phase 10F: the Role whose Information Action was performed. An explicit
  // performedRole equal to the Actual Role is the ordinary case (never stored).
  let performedRole: RoleId | undefined;
  if (request.performedRole !== undefined && request.performedRole !== player.actualRole) {
    if (typeof request.performedRole !== "string" || !request.performedRole) {
      return { ok: false, message: "Invalid performed character." };
    }
    const wake = wakeIdentity(player, registry);
    if (!wake || !wake.simulated || wake.shownRoleId !== request.performedRole) {
      return { ok: false, message: "That character is not this player's simulated wake -- a delivery can only record a performed character the player is currently shown." };
    }
    performedRole = request.performedRole;
  }
  const actingRole = performedRole ?? player.actualRole;

  const matchingActions = registry
    .informationActionsOf(actingRole)
    .filter((action) => action.id === request.informationActionId);
  if (matchingActions.length === 0) {
    return { ok: false, message: `"${actingRole}" has no Information Action "${request.informationActionId}".` };
  }
  if (matchingActions.length > 1) {
    return { ok: false, message: `Malformed Role Information: duplicate Information Action id "${request.informationActionId}".` };
  }
  const action = matchingActions[0]!;

  const timingCheck = validateInformationTiming(action.timing, game);
  if (!timingCheck.ok) return timingCheck;

  const coherence = validateRequirementsCoherent(action.requirements);
  if (!coherence.ok) return coherence;

  const parsedValues = parseInformationValues(request.values);
  if (!parsedValues.ok) return parsedValues;

  const validation = validateInformationValues(action.requirements, parsedValues.values, {
    playerIds: { has: (id) => participantRefOf(game, id) !== null },
    roleIds: { has: (id) => !!registry.get(id) },
  });
  if (!validation.ok) return validation;

  const recordedValues = recordedInformationValues(game, parsedValues.values);
  if (!recordedValues) return { ok: false, message: "A referenced Player is not seated." };

  const provenance = durableProvenance(game, request.context?.provenance);
  if (provenance === null) return { ok: false, message: "The Provenance source Player is not seated." };

  const moment = currentGameMoment(game);
  const record: InformationDeliveryRecord = cloneOwned({
    id: (environment.deliveryId ?? informationDeliveryId)(),
    recipient,
    actualRole: player.actualRole,
    ...(performedRole ? { performedRole } : {}),
    informationActionId: request.informationActionId,
    ...(moment ? { moment } : {}),
    values: recordedValues,
    ...(provenance ? { provenance } : {}),
    ...(resolutionId ? { resolutionId } : {}),
  });

  return { ok: true, record };
}

/**
 * Phase 10G (PHASE10G Section 12.2-12.4): pure Manual Information Delivery
 * planning -- what the Storyteller actually communicated through the Manual /
 * unmodeled path, for an interaction that owns no registered Information
 * Action. Composed ONLY inside a Manual ability resolution (resolveAbility);
 * there is no standalone store command for it.
 *
 *  - Refused outside Night/Day (an ended game is final; Setup has no
 *    communication to record).
 *  - `text` must be non-blank and at most MAX_MANUAL_DELIVERY_TEXT characters;
 *    oversized text is REFUSED, never truncated.
 *  - `performedRole` is authorized, never trusted: it must be the workflow's own
 *    Role (`workflowRole`) AND the recipient's current SIMULATED wake identity
 *    (the same wakeIdentity safety the structured planner applies). Equal to
 *    the Actual Role it is the ordinary case and is not stored.
 *  - The record never carries an `informationActionId` or structured `values`:
 *    it can never impersonate a registered Information Action, and it is never
 *    mechanical input.
 */
export type ManualInformationDeliveryPlanRequest = {
  recipientPlayerId: PlayerId;
  text: unknown;
  performedRole?: RoleId;
  context?: MutationContext;
  resolutionId?: string;
};

export type ManualInformationDeliveryPlanEnvironment = {
  registry: RoleRegistry | null;
  /** The Role of the Manual workflow (its wake identity), when it has one --
   * the only performed Role a Manual delivery may name. */
  workflowRole?: RoleId;
  deliveryId?: () => InformationDeliveryId;
};

export type ManualInformationDeliveryPlanResult =
  | { ok: true; record: ManualInformationDeliveryRecord }
  | { ok: false; message: string };

export function planManualInformationDelivery(
  game: StorytellerLobbyRecord,
  request: ManualInformationDeliveryPlanRequest,
  environment: ManualInformationDeliveryPlanEnvironment,
): ManualInformationDeliveryPlanResult {
  if (game.phase === "ended") return { ok: false, message: "This game has ended: nothing more can be recorded as told." };
  const moment = currentLiveMoment(game);
  if (!moment) return { ok: false, message: "Information is recorded as told only during Night or Day." };
  const recipient = participantRefOf(game, request.recipientPlayerId);
  const player = recipient ? game.players[request.recipientPlayerId] : undefined;
  if (!recipient || recipient.kind !== "participant" || !player) return { ok: false, message: "This player is not seated." };
  if (!player.actualRole) return { ok: false, message: "This player has no Actual Role yet." };
  const { text } = request;
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "Say what was communicated." };
  if (text.length > MAX_MANUAL_DELIVERY_TEXT) {
    return { ok: false, message: `What was told can be at most ${MAX_MANUAL_DELIVERY_TEXT} characters (${text.length} given) -- shorten it; nothing is cut off automatically.` };
  }
  const { resolutionId } = request;
  if (resolutionId !== undefined &&
    (typeof resolutionId !== "string" || !resolutionId || resolutionId.length > MAX_RESOLUTION_ID_LENGTH)) {
    return { ok: false, message: "Invalid resolution id." };
  }
  let performedRole: RoleId | undefined;
  if (request.performedRole !== undefined && request.performedRole !== player.actualRole) {
    if (typeof request.performedRole !== "string" || !request.performedRole) return { ok: false, message: "Invalid performed character." };
    const wake = environment.registry ? wakeIdentity(player, environment.registry) : null;
    if (request.performedRole !== environment.workflowRole || !wake || !wake.simulated || wake.shownRoleId !== request.performedRole) {
      return { ok: false, message: "A Manual delivery can only record the performed character of this workflow's simulated wake for this player." };
    }
    performedRole = request.performedRole;
  }
  const provenance = durableProvenance(game, request.context?.provenance);
  if (provenance === null) return { ok: false, message: "The Provenance source Player is not seated." };
  const record: ManualInformationDeliveryRecord = cloneOwned({
    kind: "manual" as const,
    id: (environment.deliveryId ?? informationDeliveryId)(),
    recipient,
    actualRole: player.actualRole,
    ...(performedRole ? { performedRole } : {}),
    moment: { ...moment },
    text,
    ...(provenance ? { provenance } : {}),
    ...(resolutionId ? { resolutionId } : {}),
  });
  return { ok: true, record };
}

/** Pure application of one accepted Information Delivery plan (structured or
 * Manual). */
export function applyInformationDeliveryPlan(
  game: StorytellerLobbyRecord,
  record: InformationDeliveryRecord | ManualInformationDeliveryRecord,
): StorytellerLobbyRecord {
  return {
    ...game,
    informationDeliveries: [...game.informationDeliveries, record],
  };
}
