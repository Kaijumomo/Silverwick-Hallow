import { MAX_TOTAL_PLAYERS } from "@/data/setupCounts";
import { cloneOwned, durableProvenance, historyId, isLiveGamePhase, sameSnapshot, type MutationContext } from "./history";
import { participantRefOf } from "./participants";
import { currentLiveMoment, momentAtOrdinal, momentOrdinal } from "./lifeEvents";
import { EFFECT_PARAMETER_KEY, EffectRecordSchema, LiveGameMomentSchema, GameMomentSchema, MANUAL_EFFECT_ID_PREFIX } from "./schemas";
import type {
  CurrentParticipantRef,
  EffectExpiry,
  EffectHistoryOperation,
  EffectId,
  EffectLifetime,
  EffectParameters,
  EffectParameterValue,
  EffectRecord,
  EffectState,
  GameMoment,
  HistoryRecord,
  LiveGameMoment,
  ParticipantId,
  PlayerId,
  Provenance,
  RoleId,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10B: the authoritative Effect lifecycle boundary.
 *
 * Every change to a participant's `effects[]` -- apply, update, remove,
 * suppress, resume, correction, and deterministic phase expiry -- is PLANNED
 * here, purely, from the game as it stands:
 *
 *   EffectIntent[] -> validate (identity binding, shape, lifecycle) -> plan
 *   (complete next effects[] per affected participant + History) -> or a
 *   structured refusal / a true no-op
 *
 * The store (resolveEffects in storytellerStore.ts) commits an accepted plan
 * as exactly one game replacement: one Undo entry, one localSeq step, one
 * projection cycle. Phase rollover (advancePhase) commits planEffectExpiry's
 * result inside its own single replacement. Outside migration and validated
 * recovery restoration, nothing else writes `player.effects`.
 *
 * FUTURE ABILITY-ENGINE SEAM (Phase 10F): a rules engine evaluates a Role
 * ability (asking the Storyteller only where judgment is required), then
 * submits the resulting already-resolved Effect intents -- possibly several
 * participants at once, correlated by `resolutionId` -- to this planner. It
 * never writes `player.effects` directly. This module contains no Role
 * logic: no Poisoner, Monk, Courtier, ... and no generic type conflict or
 * precedence rules. "Protected" in particular has no universal meaning here.
 */

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/** A CURRENT participant, bound to the participation instance the caller
 * observed. The UI captures `participantId` automatically from the player
 * record it rendered; the Storyteller never enters it. If the seat no longer
 * holds that participation instance, the whole transaction is refused as
 * `stale`. */
export type EffectParticipantBinding = { playerId: PlayerId; participantId: ParticipantId };

/** The command-facing form of a structured parameter. Participant values
 * name bound current participants and are stored as durable
 * ParticipantRefs; everything else is stored as given (after validation). */
export type EffectParameterInput =
  | { kind: "participant"; participants: EffectParticipantBinding[] }
  | Exclude<EffectParameterValue, { kind: "participant" }>;

/** An explicit expiry a caller may choose instead of the one resolved from
 * the lifetime. `unresolved` can never be chosen -- it exists only for
 * migrated legacy Effects. */
export type EffectExpiryInput = { kind: "none" } | { kind: "at"; moment: LiveGameMoment };

/** What a new Effect is. `appliedAt`, `state` and (unless overridden) the
 * exact expiry are filled in by the planner -- never asked for. */
export type EffectSpec = {
  /** Absent: a fresh id is allocated. Present: exact-duplicate Apply is a
   * no-op; different content under the same id is refused (never upsert). */
  id?: EffectId;
  type: string;
  /** The live participant who originally caused the Effect, if any. */
  source?: EffectParticipantBinding;
  sourceCharacter?: RoleId;
  lifetime: EffectLifetime;
  expiry?: EffectExpiryInput;
  parameters?: Record<string, EffectParameterInput>;
  note?: string;
};

/** The ONLY fields an ordinary Update may change. Origin (type, source,
 * source character, applied moment), id, lifetime and operational state are
 * immutable here (state changes through suppress/resume; everything else
 * through a correction). `parameters` merges per key (`null` deletes);
 * `note: null` clears the note. */
export type EffectUpdateChanges = {
  expiry?: EffectExpiryInput;
  parameters?: Record<string, EffectParameterInput | null>;
  note?: string | null;
};

/** Correction amendment: may repair any recorded field except the id.
 * `null` clears an optional field. */
export type EffectAmendment = {
  type?: string;
  source?: EffectParticipantBinding | null;
  sourceCharacter?: RoleId | null;
  appliedAt?: GameMoment | null;
  lifetime?: EffectLifetime;
  expiry?: EffectExpiryInput;
  parameters?: Record<string, EffectParameterInput | null>;
  note?: string | null;
  state?: EffectState;
};

export type ApplyEffectIntent = { kind: "apply"; target: EffectParticipantBinding; effect: EffectSpec };
export type UpdateEffectIntent = { kind: "update"; target: EffectParticipantBinding; effectId: EffectId; changes: EffectUpdateChanges };
export type RemoveEffectIntent = { kind: "remove"; target: EffectParticipantBinding; effectId: EffectId };
export type SuppressEffectIntent = { kind: "suppress"; target: EffectParticipantBinding; effectId: EffectId };
export type ResumeEffectIntent = { kind: "resume"; target: EffectParticipantBinding; effectId: EffectId };
/** Correction: add an Effect that should have been recorded (optionally at
 * an earlier applied moment, or already suppressed). */
export type CorrectApplyEffectIntent = {
  kind: "correctApply";
  target: EffectParticipantBinding;
  effect: EffectSpec & { appliedAt?: GameMoment; state?: EffectState };
};
/** Correction: remove an Effect that was recorded in error. */
export type CorrectRemoveEffectIntent = { kind: "correctRemove"; target: EffectParticipantBinding; effectId: EffectId };
/** Correction: repair wrongly recorded fields of an existing Effect. */
export type CorrectAmendEffectIntent = {
  kind: "correctAmend";
  target: EffectParticipantBinding;
  effectId: EffectId;
  amendment: EffectAmendment;
};

export type GameplayEffectIntent =
  | ApplyEffectIntent
  | UpdateEffectIntent
  | RemoveEffectIntent
  | SuppressEffectIntent
  | ResumeEffectIntent;
export type CorrectionEffectIntent = CorrectApplyEffectIntent | CorrectRemoveEffectIntent | CorrectAmendEffectIntent;
export type EffectIntent = GameplayEffectIntent | CorrectionEffectIntent;

/**
 * One atomic Effect resolution: every intent is applied IN ORDER against the
 * evolving working state, and either all are accepted (one commit) or none
 * is. A transaction is gameplay or correction, never a mix, so each History
 * Record's `correction` flag is truthful.
 */
export type EffectTransaction = {
  intents: readonly EffectIntent[];
  /** Mutation provenance: what caused THIS lifecycle mutation. Distinct from
   * an Effect's origin (sourceParticipant/sourceCharacter). */
  context?: MutationContext;
  /** Correlation METADATA only: not an idempotency key, not authority, not
   * assumed globally unique. Stored on every History Record produced. */
  resolutionId?: string;
};

export type EffectRefusalCode =
  /** Malformed input (shape, parameters, lifetime, unknown intent...). */
  | "invalid"
  /** Effects cannot change in this game phase (an ended game). */
  | "phase"
  /** The named seat does not exist or holds no participant. */
  | "notSeated"
  /** The seat no longer holds the bound participation instance. */
  | "stale"
  /** No Effect with that id on that participant. */
  | "notFound"
  /** Apply under an id already used by a DIFFERENT Effect. */
  | "conflict"
  /** An ordinary Update tried to rewrite an immutable field. */
  | "immutable"
  /** A finite Effect whose exact expiry cannot be resolved (or is not in
   * the future). */
  | "expiryUnresolvable"
  /** Gameplay and correction intents in one transaction. */
  | "mixedCorrection"
  /** Empty or oversized transaction. */
  | "tooMany";

export type EffectRefusal = { ok: false; code: EffectRefusalCode; message: string; intentIndex?: number };

/** What an accepted transaction changes -- nothing is applied yet. */
export type EffectPlan = {
  /** The complete next `effects[]` of every participant whose Effects change. */
  effects: Record<PlayerId, EffectRecord[]>;
  /** One record per changed Effect operation, in intent order (Live Play
   * only -- Setup records no History). */
  history: HistoryRecord[];
  /** Ids of Effects created by this transaction, in intent order. */
  appliedEffectIds: EffectId[];
};

export type EffectPlanResult =
  | { ok: true; changed: true; plan: EffectPlan }
  | { ok: true; changed: false }
  | EffectRefusal;

/** Supports table-wide Effects at the supported participant cap (several
 * operations per participant) without admitting unbounded input. */
export const MAX_EFFECT_INTENTS = MAX_TOTAL_PLAYERS * 4;
export const MAX_EFFECT_TYPE_LENGTH = 64;
export const MAX_EFFECT_NOTE_LENGTH = 1000;
export const MAX_EFFECT_ID_LENGTH = 200;
export const MAX_LIFETIME_COUNT = 100;

/** The deterministic mutation provenance of automatic phase expiry. */
export const EFFECT_EXPIRY_PROVENANCE: Provenance = { reason: "expired" };

export const newEffectId = (): EffectId =>
  "fx-" + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export type EffectIdSource = { effectId: () => EffectId; historyId: () => string };
const DEFAULT_IDS: EffectIdSource = { effectId: newEffectId, historyId };

const isCorrectionIntent = (intent: EffectIntent): intent is CorrectionEffectIntent =>
  intent.kind === "correctApply" || intent.kind === "correctRemove" || intent.kind === "correctAmend";

// ---------------------------------------------------------------------------
// Expiry resolution
// ---------------------------------------------------------------------------

const isPositiveCount = (count: unknown): count is number =>
  typeof count === "number" && Number.isSafeInteger(count) && count >= 1 && count <= MAX_LIFETIME_COUNT;

/**
 * Resolves a lifetime, anchored at the LIVE moment an Effect took hold, into
 * its exact expiry boundary -- the Game Moment whose ENTRY ends it. Pure and
 * deterministic; no wall clock. Timeline: Night 1, Day 1, Night 2, ...
 *
 *  - manual              -> none
 *  - untilDawn           -> the next Day            (Night N -> Day N;   Day N -> Day N+1)
 *  - untilNextNight      -> the next Night          (Night N -> Night N+1; Day N -> Night N+1)
 *  - throughFollowingDay -> the Night after the next Day
 *                                                   (Night N -> Night N+1; Day N -> Night N+2)
 *  - nights(k)           -> the k-th next Day       (nights(1) = untilDawn)
 *  - days(k)             -> the k-th next Night     (days(1) = untilNextNight)
 *
 * Returns null when a finite lifetime cannot be resolved: the anchor is not
 * a live moment (Setup has no countdown -- Phase 10B Section 33) or the
 * lifetime is malformed.
 */
export function resolveEffectExpiry(lifetime: EffectLifetime, anchor: GameMoment | undefined): EffectExpiry | null {
  if (!lifetime || typeof lifetime !== "object") return null;
  if (lifetime.kind === "manual") return { kind: "none" };
  if (!anchor || (anchor.phase !== "night" && anchor.phase !== "day") || !Number.isSafeInteger(anchor.day) || anchor.day < 1) return null;
  const ordinal = momentOrdinal(anchor);
  const isNight = anchor.phase === "night";
  const nextDay = (k: number) => (isNight ? ordinal + 1 : ordinal + 2) + 2 * (k - 1);
  const nextNight = (k: number) => (isNight ? ordinal + 2 : ordinal + 1) + 2 * (k - 1);
  let at: number;
  switch (lifetime.kind) {
    case "untilDawn": at = nextDay(1); break;
    case "untilNextNight": at = nextNight(1); break;
    case "throughFollowingDay": at = nextDay(1) + 1; break;
    case "nights":
      if (!isPositiveCount(lifetime.count)) return null;
      at = nextDay(lifetime.count); break;
    case "days":
      if (!isPositiveCount(lifetime.count)) return null;
      at = nextNight(lifetime.count); break;
    default: return null;
  }
  return { kind: "at", moment: momentAtOrdinal(at) };
}

/** True when an Effect's exact boundary is reached on ENTERING `destination`. */
export function effectExpiresAt(effect: Pick<EffectRecord, "expiry">, destination: LiveGameMoment): boolean {
  return effect.expiry.kind === "at" && momentOrdinal(effect.expiry.moment) <= momentOrdinal(destination);
}

// ---------------------------------------------------------------------------
// Plan application
// ---------------------------------------------------------------------------

/** Applies an accepted plan: the one Current State + History replacement the
 * store commits. Pure. */
export function applyEffectPlan(
  game: StorytellerLobbyRecord,
  plan: Pick<EffectPlan, "effects" | "history">,
): StorytellerLobbyRecord {
  const players = { ...game.players };
  for (const [playerId, effects] of Object.entries(plan.effects)) {
    players[playerId] = { ...players[playerId]!, effects };
  }
  return { ...game, players, history: plan.history.length ? [...game.history, ...plan.history] : game.history };
}

// ---------------------------------------------------------------------------
// Deterministic phase expiry
// ---------------------------------------------------------------------------

/**
 * Phase 10B Section 30: the Effects whose exact expiry boundary is reached on
 * entering `destination`, as a plan the phase transition commits INSIDE its
 * own single replacement (with Life Event Window pruning and the phase move).
 * Returns null when nothing expires. Suppressed Effects expire too:
 * suppression pauses whether an Effect applies, never its lifetime.
 * `none` and `unresolved` never expire automatically.
 *
 * History: one `removed` record per expired Effect, at the DESTINATION Game
 * Moment, `effectOperation: "expire"`, deterministic-expiry provenance, never
 * a correction. Pure.
 *
 * SOL-10B-R1: an empty seat never owns an Effect (persisted-schema
 * invariant), so every Effect considered here belongs to a seated
 * participant. Should impossible (never-validated, in-memory) state ever
 * reach this function, a seat without a participant is LEFT UNTOUCHED -- no
 * silent removal, no History against an unknowable person, no repair path.
 */
export function planEffectExpiry(
  game: StorytellerLobbyRecord,
  destination: LiveGameMoment,
  ids: Pick<EffectIdSource, "historyId"> = DEFAULT_IDS,
): Pick<EffectPlan, "effects" | "history"> | null {
  const order = [...game.seatOrder, ...Object.keys(game.players).filter((id) => !game.seatOrder.includes(id))];
  const effects: Record<PlayerId, EffectRecord[]> = {};
  const history: HistoryRecord[] = [];
  for (const playerId of order) {
    const player = ownPlayer(game, playerId);
    if (!player || !Array.isArray(player.effects)) continue;
    const participant = participantRefOf(game, playerId);
    if (!participant) continue;
    const expired = player.effects.filter((effect) => effectExpiresAt(effect, destination));
    if (!expired.length) continue;
    effects[playerId] = player.effects.filter((effect) => !effectExpiresAt(effect, destination));
    for (const effect of expired) {
      history.push(cloneOwned({
        id: ids.historyId(),
        category: "effect" as const,
        participant,
        moment: { ...destination },
        change: { kind: "removed" as const, item: effect },
        effectOperation: "expire" as const,
        provenance: { ...EFFECT_EXPIRY_PROVENANCE },
      }));
    }
  }
  return Object.keys(effects).length ? { effects, history } : null;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/** Own-property player lookup (never an inherited Object.prototype name). */
const ownPlayer = (game: Pick<StorytellerLobbyRecord, "players">, id: unknown): STPlayerRecord | undefined =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(game.players, id) ? game.players[id] : undefined;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const UPDATE_KEYS = new Set(["expiry", "parameters", "note"]);
const AMENDMENT_KEYS = new Set(["type", "source", "sourceCharacter", "appliedAt", "lifetime", "expiry", "parameters", "note", "state"]);
const SPEC_KEYS = new Set(["id", "type", "source", "sourceCharacter", "lifetime", "expiry", "parameters", "note"]);
const CORRECTION_SPEC_KEYS = new Set([...SPEC_KEYS, "appliedAt", "state"]);

/**
 * Plans one atomic Effect transaction against `game`. Pure: reads `game`,
 * returns a plan, a true no-op, or a structured refusal; never mutates
 * anything. `ids` exists so tests can make ids deterministic.
 */
export function planEffectTransaction(
  game: StorytellerLobbyRecord,
  transaction: EffectTransaction,
  ids: EffectIdSource = DEFAULT_IDS,
): EffectPlanResult {
  const refuse = (code: EffectRefusalCode, message: string, intentIndex?: number): EffectRefusal =>
    ({ ok: false, code, message, ...(intentIndex !== undefined ? { intentIndex } : {}) });

  // --- Guards --------------------------------------------------------------
  if (game.phase === "ended") return refuse("phase", "This game has ended; its Effects are frozen.");
  const intents = Array.isArray(transaction?.intents) ? transaction.intents : [];
  if (intents.length === 0) return refuse("tooMany", "Nothing to record.");
  if (intents.length > MAX_EFFECT_INTENTS) return refuse("tooMany", `At most ${MAX_EFFECT_INTENTS} Effect changes can be recorded at once.`);
  if (intents.some((intent) => !isPlainObject(intent))) return refuse("invalid", "Invalid Effect change.");
  const correction = isCorrectionIntent(intents[0]!);
  if (intents.some((intent) => isCorrectionIntent(intent) !== correction)) {
    return refuse("mixedCorrection", "A correction cannot be combined with gameplay Effect changes.");
  }
  const { resolutionId } = transaction;
  if (resolutionId !== undefined && (typeof resolutionId !== "string" || !resolutionId || resolutionId.length > 200)) {
    return refuse("invalid", "Invalid resolution id.");
  }
  const provenance = durableProvenance(game, transaction.context?.provenance);
  if (provenance === null) return refuse("notSeated", "The Provenance source Player is not seated.");

  const live = isLiveGamePhase(game.phase);
  const current = currentLiveMoment(game);
  const currentOrdinal = current ? momentOrdinal(current) : 0;
  // The moment a gameplay Apply takes hold: now. Setup is "setup, day 0".
  const now: GameMoment = { phase: game.phase as GameMoment["phase"], day: game.day };

  // --- Working state -------------------------------------------------------
  const working = new Map<PlayerId, EffectRecord[]>();
  const effectsOf = (player: STPlayerRecord) => working.get(player.id) ?? player.effects;
  const history: HistoryRecord[] = [];
  const appliedEffectIds: EffectId[] = [];

  // Each helper returns a refusal (with no intent index yet) or a value.
  type Refused = { refusal: EffectRefusal };
  const fail = (code: EffectRefusalCode, message: string): Refused => ({ refusal: refuse(code, message) });
  const isRefused = (value: unknown): value is Refused => isPlainObject(value) && "refusal" in value;

  /** Resolves a bound CURRENT participant (target, source or parameter). */
  const bind = (binding: unknown, what: string): { player: STPlayerRecord; ref: CurrentParticipantRef } | Refused => {
    if (!isPlainObject(binding)) return fail("invalid", `Choose the ${what}.`);
    const player = ownPlayer(game, binding.playerId);
    const expected = binding.participantId;
    if (typeof expected !== "string" || !expected) return fail("invalid", `The ${what} must be bound to a participant.`);
    if (!player) return fail("notSeated", `The ${what}'s seat does not exist.`);
    if (player.isEmpty || !player.participantId) {
      return fail("stale", `The ${what} is no longer seated -- nothing was changed. Review and try again.`);
    }
    if (player.participantId !== expected) {
      return fail("stale", `The ${what}'s seat now holds a different player -- nothing was changed. Review and try again.`);
    }
    const ref = participantRefOf(game, player.id);
    if (!ref || ref.kind !== "participant") return fail("notSeated", `The ${what} is not seated.`);
    return { player, ref };
  };

  const checkType = (type: unknown): string | Refused => {
    if (typeof type !== "string" || !type.trim()) return fail("invalid", "Choose an Effect type.");
    const trimmed = type.trim();
    if (trimmed.length > MAX_EFFECT_TYPE_LENGTH) return fail("invalid", "That Effect type is too long.");
    return trimmed;
  };
  const checkNote = (note: unknown): string | undefined | Refused => {
    if (note === undefined) return undefined;
    if (typeof note !== "string") return fail("invalid", "An Effect note must be text.");
    if (note.length > MAX_EFFECT_NOTE_LENGTH) return fail("invalid", "That Effect note is too long.");
    return note;
  };
  const checkRole = (role: unknown, what: string): string | undefined | Refused => {
    if (role === undefined) return undefined;
    if (typeof role !== "string" || !role) return fail("invalid", `Invalid ${what}.`);
    return role;
  };

  /** Merges parameter inputs into `existing`; `null` deletes a key. */
  const mergeParameters = (
    existing: EffectParameters | undefined,
    input: unknown,
    allowDelete: boolean,
  ): EffectParameters | undefined | Refused => {
    if (input === undefined) return existing;
    if (!isPlainObject(input)) return fail("invalid", "Effect parameters must be a keyed collection.");
    const next: EffectParameters = { ...(existing ?? {}) };
    for (const key of Object.keys(input)) {
      if (!EFFECT_PARAMETER_KEY.test(key)) return fail("invalid", `Invalid Effect parameter name "${key}".`);
      const value = input[key];
      if (value === null && allowDelete) { delete next[key]; continue; }
      if (!isPlainObject(value)) return fail("invalid", `Invalid value for Effect parameter "${key}".`);
      if (value.kind === "participant") {
        if (!Array.isArray(value.participants) || value.participants.length === 0) {
          return fail("invalid", `Effect parameter "${key}" must name at least one participant.`);
        }
        const participants: CurrentParticipantRef[] = [];
        for (const binding of value.participants) {
          const bound = bind(binding, `participant in "${key}"`);
          if (isRefused(bound)) return bound;
          participants.push(bound.ref);
        }
        next[key] = { kind: "participant", participants };
      } else {
        // Stored as given; the final EffectRecordSchema gate judges its shape.
        next[key] = cloneOwned(value) as EffectParameterValue;
      }
    }
    return Object.keys(next).length ? next : undefined;
  };

  /**
   * SOL-10B-R2: an explicit AUTHORITATIVE expiry -- `none`, or a strictly
   * future live `at`. Valid whatever the declared lifetime; `unresolved` can
   * never be chosen (it exists only for migrated legacy Effects).
   */
  const checkExpiryInput = (input: unknown): EffectExpiry | Refused => {
    if (!isPlainObject(input)) return fail("invalid", "Invalid Effect expiry.");
    if (input.kind === "none") return { kind: "none" };
    if (input.kind === "at") {
      const moment = LiveGameMomentSchema.safeParse(input.moment);
      if (!moment.success) return fail("invalid", "Choose a Night or Day for the Effect to expire.");
      if (!current) return fail("expiryUnresolvable", "Timed Effects start once live play begins.");
      if (momentOrdinal(moment.data) <= currentOrdinal) return fail("expiryUnresolvable", "An Effect can only be set to expire at a future Night or Day.");
      return { kind: "at", moment: moment.data };
    }
    return fail("invalid", "Invalid Effect expiry.");
  };

  /** SOL-10B-R2: at gameplay Apply the declared lifetime and the INITIAL
   * expiry are coherent -- manual starts with none, a timed lifetime starts
   * with an exact future end. (It may be changed later by an Update.) */
  const checkInitialExpiry = (input: unknown, lifetime: EffectLifetime): EffectExpiry | Refused => {
    const expiry = checkExpiryInput(input);
    if (isRefused(expiry)) return expiry;
    const manual = lifetime.kind === "manual";
    if (manual && expiry.kind !== "none") return fail("invalid", "A manual Effect starts with no automatic end -- schedule its end with an update once it is applied.");
    if (!manual && expiry.kind === "none") return fail("expiryUnresolvable", "A timed Effect starts with an exact end -- use a manual lifetime for an Effect that never ends by itself.");
    return expiry;
  };

  /**
   * Derives the exact expiry from the DECLARED facts: `lifetime` anchored at
   * the live `appliedAt` it was applied at. Manual -> none. A timed lifetime
   * with no live applied moment (Setup, or none recorded) cannot be derived.
   * A derived end at or before now is refused (SOL-10B-R3), never kept.
   */
  const deriveExpiry = (lifetime: EffectLifetime, appliedAt: GameMoment | undefined): EffectExpiry | Refused => {
    const anchor = appliedAt && appliedAt.phase !== "setup" ? appliedAt : undefined;
    const resolved = resolveEffectExpiry(lifetime, anchor);
    if (!resolved) {
      const timed = isPlainObject(lifetime) && ["untilDawn", "untilNextNight", "throughFollowingDay", "nights", "days"].includes(String(lifetime.kind));
      if (timed && !current) return fail("expiryUnresolvable", "Timed Effects start once live play begins -- use a manual Effect during Setup.");
      if (timed && !anchor) return fail("expiryUnresolvable", "The exact end cannot be derived without a Night or Day applied moment -- supply the exact end.");
      return fail(timed ? "expiryUnresolvable" : "invalid", "This Effect's lifetime cannot be resolved to an exact expiry.");
    }
    if (resolved.kind === "at" && momentOrdinal(resolved.moment) <= currentOrdinal) {
      return fail("expiryUnresolvable", "By these facts the Effect would already have ended -- remove it as recorded in error, or supply its current exact end.");
    }
    return resolved;
  };

  /** Validates an applied moment a correction supplies (never in the future). */
  const checkAppliedAt = (value: unknown): GameMoment | Refused => {
    const moment = GameMomentSchema.strict().safeParse(value);
    if (!moment.success) return fail("invalid", "Invalid applied moment.");
    const m = moment.data;
    if (m.phase === "setup") {
      if (m.day !== 0) return fail("invalid", "Invalid applied moment.");
      return { phase: "setup", day: 0 };
    }
    if (m.day < 1) return fail("invalid", "Invalid applied moment.");
    if (!current || momentOrdinal(m) > currentOrdinal) return fail("invalid", "An Effect cannot have been applied in the future.");
    return { phase: m.phase, day: m.day };
  };

  /** The final structural gate: never plan a record the v20 schema rejects. */
  const finalize = (record: EffectRecord): EffectRecord | Refused => {
    const owned = cloneOwned(record);
    const checked = EffectRecordSchema.safeParse(owned);
    if (!checked.success) return fail("invalid", `Invalid Effect: ${checked.error.issues[0]?.message ?? "malformed"}.`);
    return owned;
  };

  /** Builds a new Effect from a spec (Apply / correction Apply). */
  const buildEffect = (
    rawSpec: unknown,
    allowedKeys: Set<string>,
    appliedAt: GameMoment | undefined,
    state: EffectState,
  ): EffectRecord | Refused => {
    if (!isPlainObject(rawSpec)) return fail("invalid", "Describe the Effect to apply.");
    for (const key of Object.keys(rawSpec)) {
      if (rawSpec[key] !== undefined && !allowedKeys.has(key)) {
        return fail("invalid", key === "sourceParticipant" || key === "sourcePlayer"
          ? "Name the Effect's source as a bound current participant."
          : `Unknown Effect field "${key}".`);
      }
    }
    const spec = rawSpec as EffectSpec;
    let id: EffectId;
    if (spec.id === undefined) id = ids.effectId();
    else if (typeof spec.id !== "string" || !spec.id || spec.id.length > MAX_EFFECT_ID_LENGTH) return fail("invalid", "Invalid Effect id.");
    else id = spec.id;
    const type = checkType(spec.type); if (isRefused(type)) return type;
    const note = checkNote(spec.note); if (isRefused(note)) return note;
    const sourceCharacter = checkRole(spec.sourceCharacter, "source character"); if (isRefused(sourceCharacter)) return sourceCharacter;
    let sourceParticipant: CurrentParticipantRef | undefined;
    if (spec.source !== undefined) {
      const source = bind(spec.source, "source");
      if (isRefused(source)) return source;
      sourceParticipant = source.ref;
    }
    if (!isPlainObject(spec.lifetime)) return fail("invalid", "Choose how long the Effect lasts.");
    // SOL-10B-R7: the `manual:` namespace is reserved for the Storyteller's
    // quick Effect of exactly that type -- `manual:<type>`, a manual declared
    // lifetime, no source participant or character. An ability-shaped Effect
    // (sourced, or timed) can never claim it. (Also schema-enforced.)
    if (id.startsWith(MANUAL_EFFECT_ID_PREFIX) &&
      (id !== MANUAL_EFFECT_ID_PREFIX + type || spec.lifetime.kind !== "manual" || spec.source !== undefined || spec.sourceCharacter !== undefined)) {
      return fail("invalid", "Ids beginning \"manual:\" are reserved for the Storyteller's quick Effect of that type.");
    }
    // Gameplay Apply: initial expiry coherent with the declared lifetime.
    // Correction Apply: an explicit expiry is authoritative (SOL-10B-R2/R3).
    const expiry = spec.expiry !== undefined
      ? (correction ? checkExpiryInput(spec.expiry) : checkInitialExpiry(spec.expiry, spec.lifetime))
      : deriveExpiry(spec.lifetime, appliedAt);
    if (isRefused(expiry)) return expiry;
    const parameters = mergeParameters(undefined, spec.parameters, false);
    if (isRefused(parameters)) return parameters;
    return finalize({
      id,
      type,
      ...(sourceCharacter ? { sourceCharacter } : {}),
      ...(sourceParticipant ? { sourceParticipant } : {}),
      ...(appliedAt ? { appliedAt } : {}),
      lifetime: spec.lifetime,
      ...(note !== undefined ? { note } : {}),
      state,
      expiry,
      ...(parameters ? { parameters } : {}),
    });
  };

  /** SOL-10B-R9: the Effect identity (target participant + EffectId) each
   * History record explains, parallel to `history`. */
  const historyIdentity: { playerId: PlayerId; effectId: EffectId }[] = [];

  /** Records one lifecycle operation's History (Live Play only). */
  const record = (
    target: { player: STPlayerRecord; ref: CurrentParticipantRef },
    effectId: EffectId,
    operation: EffectHistoryOperation,
    change: HistoryRecord["change"],
  ) => {
    if (!live || !current) return;
    // SOL-10B-R8: mutation provenance ("what caused THIS lifecycle
    // mutation") comes only from the transaction's Mutation Context, for
    // every operation. The Effect's ORIGIN is already inside the snapshot
    // (sourceParticipant/sourceCharacter) and is never copied here; with no
    // Mutation Context, no provenance is stored.
    const mutationProvenance = provenance;
    historyIdentity.push({ playerId: target.player.id, effectId });
    history.push(cloneOwned({
      id: ids.historyId(),
      category: "effect" as const,
      participant: target.ref,
      moment: { ...current },
      change,
      effectOperation: operation,
      ...(correction ? { correction: true as const } : {}),
      ...(resolutionId ? { resolutionId } : {}),
      ...(mutationProvenance ? { provenance: mutationProvenance } : {}),
    }));
  };

  // --- Intents -------------------------------------------------------------
  for (let index = 0; index < intents.length; index++) {
    const intent = intents[index]!;
    const at = (refused: Refused): EffectRefusal => ({ ...refused.refusal, intentIndex: index });
    const target = bind(intent.target, "target player");
    if (isRefused(target)) return at(target);
    const list = effectsOf(target.player);
    const setList = (next: EffectRecord[]) => working.set(target.player.id, next);
    const findExisting = (effectId: unknown): EffectRecord | undefined =>
      typeof effectId === "string" ? list.find((effect) => effect.id === effectId) : undefined;

    switch (intent.kind) {
      case "apply":
      case "correctApply": {
        let appliedAt: GameMoment = now;
        let state: EffectState = "active";
        if (intent.kind === "correctApply" && isPlainObject(intent.effect)) {
          if (intent.effect.appliedAt !== undefined) {
            const checked = checkAppliedAt(intent.effect.appliedAt);
            if (isRefused(checked)) return at(checked);
            appliedAt = checked;
          }
          if (intent.effect.state !== undefined) {
            if (intent.effect.state !== "active" && intent.effect.state !== "suppressed") return at(fail("invalid", "Invalid Effect state."));
            state = intent.effect.state as EffectState;
          }
        }
        const built = buildEffect(intent.effect, intent.kind === "apply" ? SPEC_KEYS : CORRECTION_SPEC_KEYS, appliedAt, state);
        if (isRefused(built)) return at(built);
        const existing = findExisting(built.id);
        if (existing) {
          // Exact duplicate: true no-op. Anything else under the same id is a
          // different Effect instance -- Apply never upserts.
          if (sameSnapshot(existing, built)) break;
          return at(fail("conflict", "An Effect with this id already exists with different details -- update or correct it instead."));
        }
        setList([...list, built]);
        appliedEffectIds.push(built.id);
        record(target, built.id, "apply", { kind: "added", item: built });
        break;
      }
      case "remove":
      case "correctRemove": {
        // Removing an Effect that is not there leaves the intended state
        // already current: a true no-op for this intent.
        const existing = findExisting(intent.effectId);
        if (!existing) break;
        setList(list.filter((effect) => effect.id !== existing.id));
        record(target, existing.id, "remove", { kind: "removed", item: existing });
        break;
      }
      case "suppress":
      case "resume": {
        const existing = findExisting(intent.effectId);
        if (!existing) return at(fail("notFound", "That Effect is no longer on this player."));
        const state: EffectState = intent.kind === "suppress" ? "suppressed" : "active";
        if (existing.state === state) break; // already current: no-op
        const next = { ...existing, state };
        setList(list.map((effect) => (effect.id === existing.id ? next : effect)));
        record(target, existing.id, intent.kind, { kind: "value", from: existing, to: next });
        break;
      }
      case "update": {
        const existing = findExisting(intent.effectId);
        if (!existing) return at(fail("notFound", "That Effect is no longer on this player."));
        const changes = intent.changes;
        if (!isPlainObject(changes)) return at(fail("invalid", "Describe the Effect update."));
        for (const key of Object.keys(changes)) {
          if (changes[key] !== undefined && !UPDATE_KEYS.has(key)) {
            return at(fail("immutable", key === "state"
              ? "Suppress or resume the Effect to change whether it applies."
              : `An ordinary update cannot change the Effect's ${key} -- use a correction if it was recorded wrongly.`));
          }
        }
        const next: EffectRecord = { ...existing };
        if (changes.expiry !== undefined) {
          // SOL-10B-R2: the authoritative end may be extended, shortened or
          // removed; the declared lifetime is never rewritten by an Update.
          const expiry = checkExpiryInput(changes.expiry);
          if (isRefused(expiry)) return at(expiry);
          next.expiry = expiry;
        }
        if (changes.parameters !== undefined) {
          const parameters = mergeParameters(existing.parameters, changes.parameters, true);
          if (isRefused(parameters)) return at(parameters);
          if (parameters) next.parameters = parameters; else delete next.parameters;
        }
        if (changes.note !== undefined) {
          if (changes.note === null) delete next.note;
          else {
            const note = checkNote(changes.note); if (isRefused(note)) return at(note);
            next.note = note!;
          }
        }
        const final = finalize(next);
        if (isRefused(final)) return at(final);
        if (sameSnapshot(existing, final)) break; // nothing changes: no-op
        setList(list.map((effect) => (effect.id === existing.id ? final : effect)));
        record(target, existing.id, "update", { kind: "value", from: existing, to: final });
        break;
      }
      case "correctAmend": {
        const existing = findExisting(intent.effectId);
        if (!existing) return at(fail("notFound", "That Effect is no longer on this player."));
        const amendment = intent.amendment;
        if (!isPlainObject(amendment)) return at(fail("invalid", "Describe the correction."));
        for (const key of Object.keys(amendment)) {
          if (amendment[key] !== undefined && !AMENDMENT_KEYS.has(key)) {
            return at(fail("invalid", key === "id" ? "An Effect id cannot be corrected -- remove it and add the right Effect." : `Unknown Effect field "${key}".`));
          }
        }
        const next: EffectRecord = { ...existing };
        if (amendment.type !== undefined) {
          const type = checkType(amendment.type); if (isRefused(type)) return at(type);
          next.type = type;
        }
        if (amendment.source === null) delete next.sourceParticipant;
        else if (amendment.source !== undefined) {
          const source = bind(amendment.source, "source"); if (isRefused(source)) return at(source);
          next.sourceParticipant = source.ref;
        }
        if (amendment.sourceCharacter === null) delete next.sourceCharacter;
        else if (amendment.sourceCharacter !== undefined) {
          const role = checkRole(amendment.sourceCharacter, "source character"); if (isRefused(role)) return at(role);
          next.sourceCharacter = role!;
        }
        if (amendment.appliedAt === null) delete next.appliedAt;
        else if (amendment.appliedAt !== undefined) {
          const appliedAt = checkAppliedAt(amendment.appliedAt); if (isRefused(appliedAt)) return at(appliedAt);
          next.appliedAt = appliedAt;
        }
        if (amendment.lifetime !== undefined) {
          if (!isPlainObject(amendment.lifetime as unknown)) return at(fail("invalid", "Choose how long the Effect lasts."));
          next.lifetime = cloneOwned(amendment.lifetime as EffectLifetime);
        }
        // SOL-10B-R3: correcting the declared facts an expiry was derived
        // from (applied moment or lifetime) re-derives it -- an old derived
        // end is never silently kept. An explicitly supplied expiry is
        // authoritative instead (R2), still temporally valid.
        const declaredFactsChanged = !sameSnapshot(next.lifetime, existing.lifetime) || !sameSnapshot(next.appliedAt, existing.appliedAt);
        if (amendment.expiry !== undefined) {
          const expiry = checkExpiryInput(amendment.expiry); if (isRefused(expiry)) return at(expiry);
          next.expiry = expiry;
        } else if (declaredFactsChanged) {
          const expiry = deriveExpiry(next.lifetime, next.appliedAt); if (isRefused(expiry)) return at(expiry);
          next.expiry = expiry;
        }
        if (amendment.parameters !== undefined) {
          const parameters = mergeParameters(existing.parameters, amendment.parameters, true);
          if (isRefused(parameters)) return at(parameters);
          if (parameters) next.parameters = parameters; else delete next.parameters;
        }
        if (amendment.note === null) delete next.note;
        else if (amendment.note !== undefined) {
          const note = checkNote(amendment.note); if (isRefused(note)) return at(note);
          next.note = note!;
        }
        if (amendment.state !== undefined) {
          if (amendment.state !== "active" && amendment.state !== "suppressed") return at(fail("invalid", "Invalid Effect state."));
          next.state = amendment.state;
        }
        const final = finalize(next);
        if (isRefused(final)) return at(final);
        if (sameSnapshot(existing, final)) break;
        setList(list.map((effect) => (effect.id === existing.id ? final : effect)));
        record(target, existing.id, "update", { kind: "value", from: existing, to: final });
        break;
      }
      default:
        return at(fail("invalid", "Invalid Effect change."));
    }
  }

  // --- Finalize --------------------------------------------------------------
  const effects: Record<PlayerId, EffectRecord[]> = {};
  for (const [playerId, next] of working) {
    const before = ownPlayer(game, playerId)!.effects;
    if (!sameSnapshot(before, next)) effects[playerId] = next;
  }
  // True no-op: no Current State change and no History (Setup records none,
  // so Current State alone decides there).
  if (Object.keys(effects).length === 0) return { ok: true, changed: false };
  // SOL-10B-R9: Effect History explains COMMITTED Current State changes; it
  // is not an Effect event window. An Effect identity whose pre-transaction
  // and final snapshots are identical (apply X -> remove X, suppress X ->
  // resume X, ...) changed nothing, so every record this transaction made
  // for it is dropped -- History never claims X existed in committed state.
  const snapshotOf = (list: readonly EffectRecord[] | undefined, effectId: EffectId) =>
    list?.find((effect) => effect.id === effectId);
  const netZero = (playerId: PlayerId, effectId: EffectId) => sameSnapshot(
    snapshotOf(ownPlayer(game, playerId)?.effects, effectId),
    snapshotOf(working.get(playerId), effectId),
  );
  const committedHistory = history.filter((_, index) => {
    const identity = historyIdentity[index]!;
    return !netZero(identity.playerId, identity.effectId);
  });
  return {
    ok: true,
    changed: true,
    plan: {
      effects,
      history: committedHistory,
      appliedEffectIds: appliedEffectIds.filter((id) => Object.values(effects).some((list) => list.some((e) => e.id === id))),
    },
  };
}
