import { MAX_TOTAL_PLAYERS } from "@/data/setupCounts";
import { cloneOwned, durableProvenance, historyId, isLiveGamePhase, sameSnapshot, type MutationContext } from "./history";
import { participantRefOf } from "./participants";
import { currentLiveMoment, momentAtOrdinal, momentOrdinal } from "./lifeEvents";
import { MutationContextInputSchema, ProvenanceSchema, ReminderRecordSchema } from "./schemas";
import type {
  CurrentParticipantRef,
  GameMoment,
  HistoryRecord,
  LiveGameMoment,
  ParticipantId,
  PlayerId,
  ReminderCleanupCue,
  ReminderHistoryOperation,
  ReminderId,
  ReminderRecord,
  RoleId,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10C: the Reminder boundary.
 *
 * A Reminder is participant-bound, Storyteller-private, NON-AUTHORITATIVE
 * notation for human bookkeeping. It is never a source of mechanical truth:
 * no mechanic, rule query, planner or future ability evaluator answers a
 * rules question from `player.reminders`, and labels/notes are never parsed.
 * This module therefore owns no rules -- it only keeps the notation
 * participant-safe, atomic and explained:
 *
 *   ReminderIntent[] -> planReminderTransaction (pure) -> ReminderPlan |
 *   no-op | ReminderRefusal -> applyReminderPlan (pure) -> resolveReminders
 *   (store) -> one game replacement
 *
 * The store commits an accepted plan as exactly one game replacement: one
 * Undo entry, one localSeq step, one projection cycle. Outside migration,
 * validated recovery restoration and membership transitions (a new
 * participation instance starts with `[]`; an unseated/removed one takes its
 * notation with it), nothing else writes `player.reminders`. Reminders never
 * expire: phase rollover does not read or touch them.
 *
 * FUTURE ABILITY-ENGINE SEAM (Phase 10F): a coordinator may plan Life, apply
 * it, plan Effects against the result, apply them, then plan Reminders
 * against THAT result (planReminderTransaction works on any valid supplied
 * snapshot) and commit once, correlating the domains by `resolutionId`. Future
 * ability logic may WRITE Reminder notation through this seam; it must never
 * READ Reminders to determine rules.
 */

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/** A CURRENT participant, bound to the participation instance the caller
 * observed. The UI captures `participantId` from the player record it
 * rendered; the Storyteller never enters it. If the seat no longer holds that
 * participation instance the whole transaction is refused as `stale` -- a
 * Reminder is never applied to a replacement occupant. */
export type ReminderParticipantBinding = { playerId: PlayerId; participantId: ParticipantId };

/** The only cleanup request a caller can make. The planner resolves it ONCE
 * into an exact next live moment (Setup -> Night 1, Night N -> Day N, Day N
 * -> Night N+1). A caller can never supply the stored cue itself. */
export type ReminderCleanupRequest = { kind: "nextPhase" };

/** What a new Reminder is. `createdAt` and the resolved cue are filled in by
 * the planner -- never accepted from a caller. */
export type ReminderSpec = {
  /** Absent: a fresh id is allocated. Present: exact-duplicate Place is a
   * no-op; different content under the same id is refused (never upsert). */
  id?: ReminderId;
  /** Human-facing display text. Never parsed for mechanics. */
  label: string;
  /** The live participant the notation originated from, if any. */
  source?: ReminderParticipantBinding;
  sourceCharacter?: RoleId;
  cleanup?: ReminderCleanupRequest;
  note?: string;
};

/** The ONLY things an ordinary Amend may change: presentation / cleanup-hint
 * information that does not redefine the Reminder's identity or origin.
 * `null` clears. Resolving a legacy `unresolved` cue is a correction. */
export type ReminderAmendChanges = {
  note?: string | null;
  cleanup?: ReminderCleanupRequest | null;
};

/** Correction amendment: repairs wrongly recorded notation (label, origin,
 * note, cleanup state). Never the id or createdAt. `null` clears. A source
 * must still be a bindable current participant. */
export type ReminderCorrection = {
  label?: string;
  source?: ReminderParticipantBinding | null;
  sourceCharacter?: RoleId | null;
  note?: string | null;
  cleanup?: ReminderCleanupRequest | null;
};

export type PlaceReminderIntent = { kind: "place"; target: ReminderParticipantBinding; reminder: ReminderSpec };
export type AmendReminderIntent = { kind: "amend"; target: ReminderParticipantBinding; reminderId: ReminderId; changes: ReminderAmendChanges };
export type RemoveReminderIntent = { kind: "remove"; target: ReminderParticipantBinding; reminderId: ReminderId };
/** Correction: a Reminder that should exist now but was missing. Recorded
 * now -- never with a fabricated, backdated createdAt. */
export type CorrectPlaceReminderIntent = { kind: "correctPlace"; target: ReminderParticipantBinding; reminder: ReminderSpec };
/** Correction: repair wrongly recorded fields of an existing Reminder. */
export type CorrectAmendReminderIntent = {
  kind: "correctAmend";
  target: ReminderParticipantBinding;
  reminderId: ReminderId;
  amendment: ReminderCorrection;
};
/** Correction: a Reminder recorded in error. */
export type CorrectRemoveReminderIntent = { kind: "correctRemove"; target: ReminderParticipantBinding; reminderId: ReminderId };

export type GameplayReminderIntent = PlaceReminderIntent | AmendReminderIntent | RemoveReminderIntent;
export type CorrectionReminderIntent = CorrectPlaceReminderIntent | CorrectAmendReminderIntent | CorrectRemoveReminderIntent;
export type ReminderIntent = GameplayReminderIntent | CorrectionReminderIntent;

/**
 * One atomic Reminder resolution: every intent applies IN ORDER against the
 * evolving working state, and either all are accepted (one commit) or none
 * is. Gameplay and correction intents never mix, so each History Record's
 * `correction` flag is truthful.
 */
export type ReminderTransaction = {
  intents: readonly ReminderIntent[];
  /** Mutation provenance: what caused THIS mutation. Never derived from a
   * Reminder's origin or note. */
  context?: MutationContext;
  /** Correlation METADATA only: not an idempotency key, not authority, not
   * assumed globally unique. Stored on every History Record produced. */
  resolutionId?: string;
};

export type ReminderRefusalCode =
  /** Malformed input (shape, unknown/smuggled key, bad text...). */
  | "invalid"
  /** Reminders cannot change in this game phase (an ended game). */
  | "phase"
  /** The named seat does not exist or holds no participant. */
  | "notSeated"
  /** The seat no longer holds the bound participation instance. */
  | "stale"
  /** No Reminder with that id on that participant. */
  | "notFound"
  /** Place under an id already used by a DIFFERENT Reminder. */
  | "conflict"
  /** An ordinary Amend tried to change identity/origin, or to resolve a
   * legacy cue (a correction). */
  | "immutable"
  /** Gameplay and correction intents in one transaction. */
  | "mixedCorrection"
  /** Empty or oversized transaction. */
  | "tooMany";

export type ReminderRefusal = { ok: false; code: ReminderRefusalCode; message: string; intentIndex?: number };

/** What an accepted transaction changes -- nothing is applied yet. */
export type ReminderPlan = {
  /** The complete next `reminders[]` of every participant whose Reminders change. */
  reminders: Record<PlayerId, ReminderRecord[]>;
  /** One record per changed operation, in intent order (Live Play only --
   * Setup records none). Net-zero identities leave none. */
  history: HistoryRecord[];
  /** Ids of Reminder PLACEMENTS that survive in the final state, in intent
   * order, per target identity (participant + ReminderId). Ids are
   * participant-local, so the same text may appear more than once. */
  placedReminderIds: ReminderId[];
};

export type ReminderPlanResult =
  | { ok: true; changed: true; plan: ReminderPlan }
  | { ok: true; changed: false }
  | ReminderRefusal;

/** Table-wide bookkeeping at the participant cap without unbounded input. */
export const MAX_REMINDER_INTENTS = MAX_TOTAL_PLAYERS * 4;
/** Input limits for NEW text only; the stored schema keeps legacy labels as
 * they were. */
export const MAX_REMINDER_LABEL_LENGTH = 100;
export const MAX_REMINDER_NOTE_LENGTH = 1000;
export const MAX_REMINDER_ID_LENGTH = 200;

export const newReminderId = (): ReminderId =>
  "rm-" + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export type ReminderIdSource = { reminderId: () => ReminderId; historyId: () => string };
const DEFAULT_IDS: ReminderIdSource = { reminderId: newReminderId, historyId };

const isCorrectionIntent = (intent: ReminderIntent): intent is CorrectionReminderIntent =>
  intent.kind === "correctPlace" || intent.kind === "correctAmend" || intent.kind === "correctRemove";

// ---------------------------------------------------------------------------
// Pure helpers (presentation reads them; mechanics never do)
// ---------------------------------------------------------------------------

/** The moment a Reminder placed now is created at: Setup is exactly
 * {setup, 0}, Live Play the current Night N / Day N, an ended game none. */
export function reminderCreationMoment(game: Pick<StorytellerLobbyRecord, "phase" | "day">): GameMoment | undefined {
  if (game.phase === "setup") return { phase: "setup", day: 0 };
  if (game.phase === "night" || game.phase === "day") return { phase: game.phase, day: game.day };
  return undefined;
}

/** The exact cue "clean up at the next phase" resolves to from `game`:
 * Setup -> Night 1, Night N -> Day N, Day N -> Night N+1. Null for an ended
 * (or unusable) game. */
export function nextPhaseCleanupMoment(game: Pick<StorytellerLobbyRecord, "phase" | "day">): LiveGameMoment | null {
  if (game.phase === "setup") return momentAtOrdinal(1);
  const now = currentLiveMoment(game);
  return now ? momentAtOrdinal(momentOrdinal(now) + 1) : null;
}

/**
 * PRESENTATION ONLY: the Storyteller-facing cleanup status of a Reminder,
 * DERIVED from its stored cue and the game's current moment -- never stored.
 *
 *  - `due`: the cue's moment has been reached ("Needs cleanup");
 *  - `check`: a legacy cue whose exact point was never recorded ("Needs check");
 *  - `scheduled`: a cue not yet reached;
 *  - `none`: no cleanup hint.
 *
 * Outside Live Play (Setup, ended) nothing is `due`. Reaching a cue never
 * removes or changes anything.
 */
export type ReminderCleanupStatus = "none" | "scheduled" | "due" | "check";
export function reminderCleanupStatus(
  reminder: Pick<ReminderRecord, "cleanupCue">,
  game: Pick<StorytellerLobbyRecord, "phase" | "day">,
): ReminderCleanupStatus {
  const cue = reminder.cleanupCue;
  if (!cue) return "none";
  if (cue.kind === "unresolved") return "check";
  const now = currentLiveMoment(game);
  return now && momentOrdinal(now) >= momentOrdinal(cue.moment) ? "due" : "scheduled";
}

// ---------------------------------------------------------------------------
// Plan application
// ---------------------------------------------------------------------------

/** Applies an accepted plan: the one Current State + History replacement the
 * store commits. Pure -- returns a new snapshot and mutates nothing. */
export function applyReminderPlan(
  game: StorytellerLobbyRecord,
  plan: Pick<ReminderPlan, "reminders" | "history">,
): StorytellerLobbyRecord {
  const players = { ...game.players };
  for (const [playerId, reminders] of Object.entries(plan.reminders)) {
    players[playerId] = { ...players[playerId]!, reminders };
  }
  return { ...game, players, history: plan.history.length ? [...game.history, ...plan.history] : game.history };
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/** Own-property player lookup (never an inherited Object.prototype name). */
const ownPlayer = (game: Pick<StorytellerLobbyRecord, "players">, id: unknown): STPlayerRecord | undefined =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(game.players, id) ? game.players[id] : undefined;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const SPEC_KEYS = new Set(["id", "label", "source", "sourceCharacter", "cleanup", "note"]);
const AMEND_KEYS = new Set(["note", "cleanup"]);
/** Record fields an ordinary Amend may never change (refused `immutable`). */
const IMMUTABLE_KEYS = new Set(["id", "label", "source", "sourceParticipant", "sourcePlayer", "sourceCharacter", "createdAt"]);
const CORRECTION_KEYS = new Set(["label", "source", "sourceCharacter", "note", "cleanup"]);
const INTENT_KEYS: Record<ReminderIntent["kind"], Set<string>> = {
  place: new Set(["kind", "target", "reminder"]),
  correctPlace: new Set(["kind", "target", "reminder"]),
  amend: new Set(["kind", "target", "reminderId", "changes"]),
  correctAmend: new Set(["kind", "target", "reminderId", "amendment"]),
  remove: new Set(["kind", "target", "reminderId"]),
  correctRemove: new Set(["kind", "target", "reminderId"]),
};
const TRANSACTION_KEYS = new Set(["intents", "context", "resolutionId"]);
const BINDING_KEYS = new Set(["playerId", "participantId"]);
const CLEANUP_REQUEST_KEYS = new Set(["kind"]);

/**
 * LUNA-10C-002: the ONE strictness rule for every caller-facing Reminder
 * object (transaction, intent, participant binding, Place spec, Amend
 * changes, correction amendment, cleanup request). An unsupported key is
 * refused because it is PRESENT as an own property -- whatever its value,
 * `undefined` included; it is never silently stripped. A known optional
 * field present with `undefined` is handled by that field's own semantics
 * (normally "not supplied").
 */
export function unknownOwnKey(value: Record<string, unknown>, allowed: ReadonlySet<string>): string | undefined {
  return Object.keys(value).find((key) => !allowed.has(key));
}

/**
 * Plans one atomic Reminder transaction against `game`. Pure: reads `game`
 * (any valid snapshot -- including one a future coordinator already derived
 * by applying Life/Effect plans), returns a plan, a true no-op, or a
 * structured refusal; never mutates anything. `ids` exists so tests can make
 * ids deterministic.
 */
export function planReminderTransaction(
  game: StorytellerLobbyRecord,
  transaction: ReminderTransaction,
  ids: ReminderIdSource = DEFAULT_IDS,
): ReminderPlanResult {
  const refuse = (code: ReminderRefusalCode, message: string, intentIndex?: number): ReminderRefusal =>
    ({ ok: false, code, message, ...(intentIndex !== undefined ? { intentIndex } : {}) });

  // --- Guards --------------------------------------------------------------
  // Ended games are frozen: no Reminder is placed, amended or removed after
  // the game ends (with or without History).
  if (game.phase === "ended") return refuse("phase", "This game has ended; its Reminders are frozen.");
  if (!isPlainObject(transaction)) return refuse("invalid", "Invalid Reminder transaction.");
  const unknownTransactionKey = unknownOwnKey(transaction as unknown as Record<string, unknown>, TRANSACTION_KEYS);
  if (unknownTransactionKey !== undefined) return refuse("invalid", `Unknown Reminder transaction field "${unknownTransactionKey}".`);
  const intents: readonly ReminderIntent[] = Array.isArray(transaction.intents) ? transaction.intents : [];
  if (intents.length === 0) return refuse("tooMany", "Nothing to record.");
  if (intents.length > MAX_REMINDER_INTENTS) return refuse("tooMany", `At most ${MAX_REMINDER_INTENTS} Reminder changes can be recorded at once.`);
  if (intents.some((intent) => !isPlainObject(intent) || !Object.prototype.hasOwnProperty.call(INTENT_KEYS, String(intent.kind)))) {
    const index = intents.findIndex((intent) => !isPlainObject(intent) || !Object.prototype.hasOwnProperty.call(INTENT_KEYS, String(intent.kind)));
    return refuse("invalid", "Invalid Reminder change.", index);
  }
  const correction = isCorrectionIntent(intents[0]!);
  if (intents.some((intent) => isCorrectionIntent(intent) !== correction)) {
    return refuse("mixedCorrection", "A correction cannot be combined with ordinary Reminder changes.");
  }
  const { resolutionId } = transaction;
  if (resolutionId !== undefined && (typeof resolutionId !== "string" || !resolutionId || resolutionId.length > 200)) {
    return refuse("invalid", "Invalid resolution id.");
  }
  // The Mutation Context is runtime-untrusted (ASTRA-10B-001 pattern):
  // validate its exact caller-facing shape first (malformed -> "invalid",
  // never coerced or stored), convert a live sourcePlayer to its durable ref,
  // then confirm the stored form meets the stored Provenance contract. The
  // RAW context is parsed (never an undefined-stripped copy), so the strict
  // schema refuses an unknown key by presence (LUNA-10C-002); the parsed
  // result is a new object, and durableProvenance owns/strips it before use.
  let contextInput: MutationContext | undefined;
  if (transaction.context !== undefined) {
    const parsed = MutationContextInputSchema.safeParse(transaction.context);
    if (!parsed.success) return refuse("invalid", "Invalid Mutation Context -- provenance takes only a source player, source character, reason and note.");
    contextInput = parsed.data;
  }
  const provenance = durableProvenance(game, contextInput?.provenance);
  if (provenance === null) return refuse("notSeated", "The Provenance source Player is not seated.");
  if (provenance !== undefined && !ProvenanceSchema.strict().safeParse(provenance).success) {
    return refuse("invalid", "Invalid Mutation Context provenance.");
  }

  const live = isLiveGamePhase(game.phase);
  const current = currentLiveMoment(game);
  const createdAt = reminderCreationMoment(game);
  if (!createdAt) return refuse("phase", "Reminders can only change during Setup or live play.");

  // --- Working state -------------------------------------------------------
  const working = new Map<PlayerId, ReminderRecord[]>();
  const remindersOf = (player: STPlayerRecord) => working.get(player.id) ?? player.reminders;
  const history: HistoryRecord[] = [];
  /** Net-zero bookkeeping: the identity each History record explains. */
  const historyIdentity: { playerId: PlayerId; reminderId: ReminderId }[] = [];
  const placements: { playerId: PlayerId; reminderId: ReminderId }[] = [];

  type Refused = { refusal: ReminderRefusal };
  const fail = (code: ReminderRefusalCode, message: string): Refused => ({ refusal: refuse(code, message) });
  const isRefused = (value: unknown): value is Refused => isPlainObject(value) && "refusal" in value;

  /** Resolves a bound CURRENT participant (target or source). */
  const bind = (binding: unknown, what: string): { player: STPlayerRecord; ref: CurrentParticipantRef } | Refused => {
    if (!isPlainObject(binding)) return fail("invalid", `Choose the ${what}.`);
    if (unknownOwnKey(binding, BINDING_KEYS) !== undefined) {
      return fail("invalid", `The ${what} is named only by a bound current participant.`);
    }
    const expected = binding.participantId;
    if (typeof binding.playerId !== "string" || !binding.playerId) return fail("invalid", `Choose the ${what}.`);
    if (typeof expected !== "string" || !expected) return fail("invalid", `The ${what} must be bound to a participant.`);
    const player = ownPlayer(game, binding.playerId);
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

  const checkLabel = (label: unknown): string | Refused => {
    if (typeof label !== "string" || !label.trim()) return fail("invalid", "Write the Reminder's text.");
    const trimmed = label.trim();
    if (trimmed.length > MAX_REMINDER_LABEL_LENGTH) return fail("invalid", "That Reminder text is too long.");
    return trimmed;
  };
  const checkNote = (note: unknown): string | undefined | Refused => {
    if (note === undefined) return undefined;
    if (typeof note !== "string") return fail("invalid", "A Reminder note must be text.");
    if (note.length > MAX_REMINDER_NOTE_LENGTH) return fail("invalid", "That Reminder note is too long.");
    const trimmed = note.trim();
    return trimmed ? trimmed : undefined;
  };
  const checkRole = (role: unknown): string | Refused => {
    if (typeof role !== "string" || !role) return fail("invalid", "Invalid source character.");
    return role;
  };
  /** Resolves the one caller cleanup request into the exact stored cue. */
  const resolveCleanup = (request: unknown): ReminderCleanupCue | Refused => {
    if (!isPlainObject(request) || request.kind !== "nextPhase" || unknownOwnKey(request, CLEANUP_REQUEST_KEYS) !== undefined) {
      return fail("invalid", "A cleanup reminder can only be set for the next phase.");
    }
    const moment = nextPhaseCleanupMoment(game);
    if (!moment) return fail("phase", "A cleanup reminder needs a next phase.");
    return { kind: "at", moment };
  };
  /** The final structural gate: never plan a record the v21 schema rejects. */
  const finalize = (record: ReminderRecord): ReminderRecord | Refused => {
    const owned = cloneOwned(record);
    const checked = ReminderRecordSchema.safeParse(owned);
    if (!checked.success) return fail("invalid", `Invalid Reminder: ${checked.error.issues[0]?.message ?? "malformed"}.`);
    return owned;
  };

  /** Builds a new Reminder from a spec (Place / correction Place). */
  const buildReminder = (rawSpec: unknown): ReminderRecord | Refused => {
    if (!isPlainObject(rawSpec)) return fail("invalid", "Describe the Reminder to place.");
    const unknown = unknownOwnKey(rawSpec, SPEC_KEYS);
    if (unknown !== undefined) {
      return fail("invalid", unknown === "sourceParticipant" || unknown === "sourcePlayer"
        ? "Name the Reminder's source as a bound current participant."
        : unknown === "createdAt" || unknown === "cleanupCue"
          ? `A Reminder's ${unknown} is recorded by Silverwick, never supplied.`
          : `Unknown Reminder field "${unknown}".`);
    }
    let id: ReminderId;
    if (rawSpec.id === undefined) id = ids.reminderId();
    else if (typeof rawSpec.id !== "string" || !rawSpec.id || rawSpec.id.length > MAX_REMINDER_ID_LENGTH) return fail("invalid", "Invalid Reminder id.");
    else id = rawSpec.id;
    const label = checkLabel(rawSpec.label); if (isRefused(label)) return label;
    const note = checkNote(rawSpec.note); if (isRefused(note)) return note;
    let sourceCharacter: string | undefined;
    if (rawSpec.sourceCharacter !== undefined) {
      const role = checkRole(rawSpec.sourceCharacter); if (isRefused(role)) return role;
      sourceCharacter = role;
    }
    let sourceParticipant: CurrentParticipantRef | undefined;
    if (rawSpec.source !== undefined) {
      const source = bind(rawSpec.source, "source");
      if (isRefused(source)) return source;
      sourceParticipant = source.ref;
    }
    let cleanupCue: ReminderCleanupCue | undefined;
    if (rawSpec.cleanup !== undefined) {
      const cue = resolveCleanup(rawSpec.cleanup); if (isRefused(cue)) return cue;
      cleanupCue = cue;
    }
    return finalize({
      id,
      label,
      ...(sourceCharacter ? { sourceCharacter } : {}),
      ...(sourceParticipant ? { sourceParticipant } : {}),
      createdAt: { ...createdAt },
      ...(cleanupCue ? { cleanupCue } : {}),
      ...(note !== undefined ? { note } : {}),
    });
  };

  /** Records one operation's History (Live Play only; Setup records none). */
  const record = (
    target: { player: STPlayerRecord; ref: CurrentParticipantRef },
    reminderId: ReminderId,
    operation: ReminderHistoryOperation,
    change: HistoryRecord["change"],
  ) => {
    if (!live || !current) return;
    // Mutation provenance comes ONLY from the validated Mutation Context --
    // never from the Reminder's origin or note (its origin is already inside
    // the snapshot). With no context, no provenance is stored.
    historyIdentity.push({ playerId: target.player.id, reminderId });
    history.push(cloneOwned({
      id: ids.historyId(),
      category: "reminder" as const,
      participant: target.ref,
      moment: { ...current },
      change,
      reminderOperation: operation,
      ...(correction ? { correction: true as const } : {}),
      ...(resolutionId ? { resolutionId } : {}),
      ...(provenance ? { provenance } : {}),
    }));
  };

  // --- Intents -------------------------------------------------------------
  for (let index = 0; index < intents.length; index++) {
    const intent = intents[index]!;
    const at = (refused: Refused): ReminderRefusal => ({ ...refused.refusal, intentIndex: index });
    const extra = unknownOwnKey(intent as unknown as Record<string, unknown>, INTENT_KEYS[intent.kind]);
    if (extra !== undefined) return at(fail("invalid", `Unknown Reminder change field "${extra}".`));
    const target = bind(intent.target, "target player");
    if (isRefused(target)) return at(target);
    const list = remindersOf(target.player);
    const setList = (next: ReminderRecord[]) => working.set(target.player.id, next);
    const findExisting = (reminderId: unknown): ReminderRecord | undefined =>
      typeof reminderId === "string" ? list.find((reminder) => reminder.id === reminderId) : undefined;
    if ((intent.kind !== "place" && intent.kind !== "correctPlace") && (typeof intent.reminderId !== "string" || !intent.reminderId)) {
      return at(fail("invalid", "Name the Reminder."));
    }

    switch (intent.kind) {
      case "place":
      case "correctPlace": {
        const built = buildReminder(intent.reminder);
        if (isRefused(built)) return at(built);
        const existing = findExisting(built.id);
        if (existing) {
          // Exact duplicate: true no-op. Anything else under the same id is a
          // different Reminder instance -- Place never upserts or replaces.
          if (sameSnapshot(existing, built)) break;
          return at(fail("conflict", "A Reminder with this id already exists with different details -- amend or correct it instead."));
        }
        setList([...list, built]);
        placements.push({ playerId: target.player.id, reminderId: built.id });
        record(target, built.id, "place", { kind: "added", item: built });
        break;
      }
      case "remove":
      case "correctRemove": {
        // Removing a Reminder that is not there leaves the intended state
        // already current: a true no-op for this intent.
        const existing = findExisting(intent.reminderId);
        if (!existing) break;
        setList(list.filter((reminder) => reminder.id !== existing.id));
        record(target, existing.id, "remove", { kind: "removed", item: existing });
        break;
      }
      case "amend": {
        const existing = findExisting(intent.reminderId);
        if (!existing) return at(fail("notFound", "That Reminder is no longer on this player."));
        const changes = intent.changes;
        if (!isPlainObject(changes)) return at(fail("invalid", "Describe the Reminder change."));
        const disallowed = unknownOwnKey(changes, AMEND_KEYS);
        if (disallowed !== undefined) {
          return at(IMMUTABLE_KEYS.has(disallowed)
            ? fail("immutable", `An ordinary change cannot rewrite the Reminder's ${disallowed} -- correct it if it was recorded wrongly.`)
            : fail("invalid", `Unknown Reminder field "${disallowed}".`));
        }
        // Resolving migrated legacy uncertainty repairs incomplete Current
        // State: a correction, never an ordinary amend.
        if (changes.cleanup !== undefined && existing.cleanupCue?.kind === "unresolved") {
          return at(fail("immutable", "This legacy Reminder's cleanup point was not recorded; resolve it as a correction."));
        }
        const next: ReminderRecord = { ...existing };
        if (changes.note === null) delete next.note;
        else if (changes.note !== undefined) {
          const note = checkNote(changes.note); if (isRefused(note)) return at(note);
          if (note === undefined) delete next.note; else next.note = note;
        }
        if (changes.cleanup === null) delete next.cleanupCue;
        else if (changes.cleanup !== undefined) {
          const cue = resolveCleanup(changes.cleanup); if (isRefused(cue)) return at(cue);
          next.cleanupCue = cue;
        }
        const final = finalize(next);
        if (isRefused(final)) return at(final);
        if (sameSnapshot(existing, final)) break; // nothing changes: no-op
        setList(list.map((reminder) => (reminder.id === existing.id ? final : reminder)));
        record(target, existing.id, "amend", { kind: "value", from: existing, to: final });
        break;
      }
      case "correctAmend": {
        const existing = findExisting(intent.reminderId);
        if (!existing) return at(fail("notFound", "That Reminder is no longer on this player."));
        const amendment = intent.amendment;
        if (!isPlainObject(amendment)) return at(fail("invalid", "Describe the correction."));
        const disallowed = unknownOwnKey(amendment, CORRECTION_KEYS);
        if (disallowed !== undefined) {
          return at(disallowed === "id" || disallowed === "createdAt"
            ? fail("immutable", `A Reminder's ${disallowed} cannot be corrected -- remove it and place the right Reminder.`)
            : fail("invalid", `Unknown Reminder field "${disallowed}".`));
        }
        const next: ReminderRecord = { ...existing };
        if (amendment.label !== undefined) {
          const label = checkLabel(amendment.label); if (isRefused(label)) return at(label);
          next.label = label;
        }
        if (amendment.source === null) delete next.sourceParticipant;
        else if (amendment.source !== undefined) {
          // A new origin must still be a bindable current participant; no
          // arbitrary historical ParticipantRef is ever manufactured.
          const source = bind(amendment.source, "source"); if (isRefused(source)) return at(source);
          next.sourceParticipant = source.ref;
        }
        if (amendment.sourceCharacter === null) delete next.sourceCharacter;
        else if (amendment.sourceCharacter !== undefined) {
          const role = checkRole(amendment.sourceCharacter); if (isRefused(role)) return at(role);
          next.sourceCharacter = role;
        }
        if (amendment.note === null) delete next.note;
        else if (amendment.note !== undefined) {
          const note = checkNote(amendment.note); if (isRefused(note)) return at(note);
          if (note === undefined) delete next.note; else next.note = note;
        }
        if (amendment.cleanup === null) delete next.cleanupCue;
        else if (amendment.cleanup !== undefined) {
          const cue = resolveCleanup(amendment.cleanup); if (isRefused(cue)) return at(cue);
          next.cleanupCue = cue;
        }
        const final = finalize(next);
        if (isRefused(final)) return at(final);
        if (sameSnapshot(existing, final)) break;
        setList(list.map((reminder) => (reminder.id === existing.id ? final : reminder)));
        record(target, existing.id, "amend", { kind: "value", from: existing, to: final });
        break;
      }
    }
  }

  // --- Finalize --------------------------------------------------------------
  const reminders: Record<PlayerId, ReminderRecord[]> = {};
  for (const [playerId, next] of working) {
    const before = ownPlayer(game, playerId)!.reminders;
    if (!sameSnapshot(before, next)) reminders[playerId] = next;
  }
  // True no-op: no Current State change and no History.
  if (Object.keys(reminders).length === 0) return { ok: true, changed: false };
  // History explains COMMITTED Current State (the SOL-10B-R9 principle): a
  // Reminder identity whose pre-transaction and final snapshots are identical
  // (place X -> remove X, amend X -> amend back...) leaves no record.
  const snapshotOf = (list: readonly ReminderRecord[] | undefined, reminderId: ReminderId) =>
    list?.find((reminder) => reminder.id === reminderId);
  const netZero = (playerId: PlayerId, reminderId: ReminderId) => sameSnapshot(
    snapshotOf(ownPlayer(game, playerId)?.reminders, reminderId),
    snapshotOf(working.get(playerId) ?? ownPlayer(game, playerId)?.reminders, reminderId),
  );
  const placedReminderIds = placements
    .filter(({ playerId, reminderId }, index) =>
      !placements.some((later, laterIndex) => laterIndex > index && later.playerId === playerId && later.reminderId === reminderId) &&
      snapshotOf(working.get(playerId), reminderId) !== undefined &&
      !netZero(playerId, reminderId))
    .map(({ reminderId }) => reminderId);
  const committedHistory = history.filter((_, index) => {
    const identity = historyIdentity[index]!;
    return !netZero(identity.playerId, identity.reminderId);
  });
  return { ok: true, changed: true, plan: { reminders, history: committedHistory, placedReminderIds } };
}
