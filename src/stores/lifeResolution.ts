import { cloneOwned, durableProvenance, historyId, type MutationContext } from "./history";
import { participantRefOf } from "./participants";
import { currentLiveMoment, previousLiveMoment, sameMoment } from "./lifeEvents";
import type {
  CurrentParticipantRef,
  DayGameMoment,
  ExecutionOutcome,
  ExileOutcome,
  HistoryRecord,
  LifeEvent,
  LifeEventId,
  LiveGameMoment,
  ParticipantId,
  PlayerId,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10A: the authoritative life-resolution boundary.
 *
 * Every change to a player's life fields (`alive`, `ghostVote`, `exiled`, and
 * the ability reset a true resurrection performs) and every change to the
 * Life Event Window is PLANNED here, purely, from the game as it stands:
 *
 *   intents -> guard -> plan (Current State patch + Life Event Window
 *   update + one History mirror per affected participant) -> or a
 *   structured refusal / true no-op
 *
 * The store command (resolveLife in storytellerStore.ts) then commits an
 * accepted plan as exactly one game replacement: one Undo entry, one localSeq
 * step, one projection. Nothing is ever applied partially.
 *
 * FUTURE ABILITY-ENGINE SEAM: a later rules engine evaluates Role abilities
 * (asking the Storyteller where required), then submits the resulting,
 * already-resolved Life Intent(s) -- possibly several subjects at once --
 * as ONE LifeTransaction with a shared `resolutionId`. It never writes life
 * fields directly. Phase 10A itself contains no Role logic at all: no Imp,
 * protection, poisoning or Shabaloth evaluation.
 */

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/** A death not represented by an execution/exile (Night or Day). */
export type DeathIntent = { kind: "death"; playerId: PlayerId };
/** The ACTUAL executee (not necessarily the nominee), Day only. */
export type ExecutionIntent = {
  kind: "execution";
  playerId: PlayerId;
  outcome: ExecutionOutcome;
  /** Explicit confirmations of exceptional cases, exactly as the planner
   * issued them in a `needsConfirmation` refusal. A second (or later)
   * execution on the same Day, or a Traveler executee, is legal only with
   * its own confirmation -- Role abilities can cause extra executions, so
   * there is no hard maximum.
   *
   * Phase 10A (10A-ASTRA-002): a confirmation is bound to the participation
   * instance and Game Moment it was issued for. Presenting one for any other
   * participant (e.g. a later occupant of the same PlayerId, even with the
   * same name or UID) or at any other moment refuses the whole transaction
   * as stale; it never authorizes the new context. */
  confirmations?: readonly LifeConfirmationToken[];
};
/** A Traveler exile, Day only. Never assumed to kill. */
export type ExileIntent = { kind: "exile"; playerId: PlayerId; outcome: ExileOutcome };
/** A true resurrection -- NOT a correction. */
export type ResurrectionIntent = { kind: "resurrection"; playerId: PlayerId };
export type SpendGhostVoteIntent = { kind: "spendGhostVote"; playerId: PlayerId };
export type RestoreGhostVoteIntent = { kind: "restoreGhostVote"; playerId: PlayerId };

/** The complete life status a Storyteller correction sets. A living player
 * always holds their vote and is never exiled; only a dead Traveler may be
 * exile-dead. */
export type LifeStatusTarget =
  | { alive: true }
  | { alive: false; ghostVote: boolean; exiled?: boolean };

/** Status-only correction: fixes Current State without pretending any
 * gameplay event happened. Never restores a used ability. */
export type CorrectStatusIntent = { kind: "correctStatus"; playerId: PlayerId; target: LifeStatusTarget };
/** Removes one event still in the window. Current State is repaired only by
 * an explicit CorrectStatusIntent in the same transaction. */
export type RetractEventIntent = { kind: "retractEvent"; eventId: LifeEventId };

/** The event a correction records. `playerId` names a CURRENT participant;
 * an amendment may omit it to keep the original event's durable subject
 * (which may since have left their seat). */
export type LifeEventSpec =
  | { kind: "death" | "resurrection"; playerId?: PlayerId }
  | { kind: "execution"; playerId?: PlayerId; outcome: ExecutionOutcome }
  | { kind: "exile"; playerId?: PlayerId; outcome: ExileOutcome };

/** Retract `eventId` and append `replacement` (new id, the original's
 * moment and resolutionId). */
export type AmendEventIntent = { kind: "amendEvent"; eventId: LifeEventId; replacement: LifeEventSpec };
/** Append a forgotten event at the immediately previous phase. */
export type LateRecordIntent = { kind: "lateRecord"; event: LifeEventSpec & { playerId: PlayerId } };

export type GameplayLifeIntent =
  | DeathIntent
  | ExecutionIntent
  | ExileIntent
  | ResurrectionIntent
  | SpendGhostVoteIntent
  | RestoreGhostVoteIntent;
export type CorrectionLifeIntent = CorrectStatusIntent | RetractEventIntent | AmendEventIntent | LateRecordIntent;
export type LifeIntent = GameplayLifeIntent | CorrectionLifeIntent;

/**
 * One atomic life resolution: every intent is applied in order against the
 * evolving working state, and either ALL are accepted (one commit) or none
 * is. A transaction is either gameplay or correction, never a mix, so a
 * History Record's `correction` flag is always truthful.
 */
export type LifeTransaction = {
  intents: readonly LifeIntent[];
  /** Provenance for every event and History Record this produces. */
  context?: MutationContext;
  /** Correlates the events one resolution produces (future ability engine). */
  resolutionId?: string;
};

export type LifeConfirmation = "additionalExecution" | "travelerExecutee";

/** Phase 10A (10A-ASTRA-002): one explicit confirmation, bound to the exact
 * participation instance and Game Moment the planner evaluated. Issued only
 * by the planner (needsConfirmation) and re-verified on resubmission. */
export type LifeConfirmationToken = {
  kind: LifeConfirmation;
  participantId: ParticipantId;
  moment: LiveGameMoment;
};

export type LifeRefusal =
  | { ok: false; code: "refused"; message: string }
  /** A presented confirmation no longer matches the current participant or
   * Game Moment -- nothing was changed; the caller must re-evaluate. */
  | { ok: false; code: "stale"; message: string }
  | { ok: false; code: "needsConfirmation"; confirmation: LifeConfirmationToken; message: string };

/** What an accepted transaction changes -- nothing is applied yet. */
export type LifePlan = {
  /** The complete next life fields of every player whose fields change. */
  playerPatches: Record<PlayerId, LifeFieldPatch>;
  lifeEventWindow: StorytellerLobbyRecord["lifeEventWindow"];
  /** Exactly one per affected participant, in first-touched order. */
  history: HistoryRecord[];
  addedEventIds: LifeEventId[];
};

export type LifePlanResult =
  | { ok: true; changed: true; plan: LifePlan }
  | { ok: true; changed: false }
  | LifeRefusal;

export const MAX_LIFE_INTENTS = 20;

const isCorrectionIntent = (intent: LifeIntent): intent is CorrectionLifeIntent =>
  intent.kind === "correctStatus" || intent.kind === "retractEvent" ||
  intent.kind === "amendEvent" || intent.kind === "lateRecord";

export const newLifeEventId = (): LifeEventId =>
  "le-" + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export type LifeIdSource = { eventId: () => LifeEventId; historyId: () => string };
const DEFAULT_IDS: LifeIdSource = { eventId: newLifeEventId, historyId };

// ---------------------------------------------------------------------------
// Life fields
// ---------------------------------------------------------------------------

/** The Current State fields the life boundary owns. `exiled` is normalized:
 * false and absent both mean "not exiled"; the canonical stored form of
 * "not exiled" is an ABSENT key. */
type LifeFields = { alive: boolean; ghostVote: boolean; exiled: boolean; abilityUsed: boolean };
export type LifeFieldPatch = Pick<STPlayerRecord, "alive" | "ghostVote" | "abilityUsed"> & { exiled: boolean };

const lifeFieldsOf = (p: STPlayerRecord): LifeFields =>
  ({ alive: p.alive, ghostVote: p.ghostVote, exiled: p.exiled === true, abilityUsed: p.abilityUsed });

const LIFE_KEYS = ["alive", "ghostVote", "exiled", "abilityUsed"] as const;

function lifeDiff(before: LifeFields, after: LifeFields): { from: Record<string, unknown>; to: Record<string, unknown> } | null {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const key of LIFE_KEYS) {
    if (before[key] !== after[key]) { from[key] = before[key]; to[key] = after[key]; }
  }
  return Object.keys(from).length ? { from, to } : null;
}

/** Applies a planned patch to one player record -- the canonical alive/dead
 * representation (a living player holds their vote and is not exiled; "not
 * exiled" is stored as an absent key). */
export function applyLifeFieldPatch(player: STPlayerRecord, patch: LifeFieldPatch): STPlayerRecord {
  const next: STPlayerRecord = { ...player, alive: patch.alive, ghostVote: patch.ghostVote, abilityUsed: patch.abilityUsed };
  if (patch.exiled) next.exiled = true;
  else delete next.exiled;
  return next;
}

/**
 * Phase 10A (10A-LUNA-001): canonical starting life state at the ONE
 * Setup -> Live Play boundary (beginNightOne). Setup is not gameplay, so a
 * Setup participant's life fields -- including stale pre-v19 values a
 * migrated v18 Setup may carry (e.g. dead, vote used, exiled) -- are never
 * authoritative: every OCCUPIED participant enters Night 1 alive, holding
 * their vote, and not exiled ("not exiled" stored as an absent key; an
 * explicit `false` is already canonical and left as is).
 *
 * This is Setup canonicalization, not a Life Intent: it records no Life
 * Event, no History and no Provenance, and implies no resurrection or
 * correction. Empty planned seats are never touched. `abilityUsed` is
 * deliberately out of scope (it is reset at Deal/assignment, not here).
 * Pure; returns the SAME map when every participant is already canonical,
 * and the same record for each canonical participant.
 */
export function canonicalizeStartingLife(
  players: StorytellerLobbyRecord["players"],
): StorytellerLobbyRecord["players"] {
  let changed = false;
  const next: StorytellerLobbyRecord["players"] = {};
  for (const [id, player] of Object.entries(players)) {
    const canonical = player.isEmpty || (player.alive && player.ghostVote && player.exiled !== true);
    if (canonical) {
      next[id] = player;
      continue;
    }
    changed = true;
    const fixed: STPlayerRecord = { ...player, alive: true, ghostVote: true };
    delete fixed.exiled;
    next[id] = fixed;
  }
  return changed ? next : players;
}

/** Applies an accepted plan: the one Current State + Life Event Window +
 * History replacement the store commits. Pure. */
export function applyLifePlan(game: StorytellerLobbyRecord, plan: LifePlan): StorytellerLobbyRecord {
  const players = { ...game.players };
  for (const [playerId, patch] of Object.entries(plan.playerPatches)) {
    players[playerId] = applyLifeFieldPatch(players[playerId]!, patch);
  }
  return {
    ...game,
    players,
    lifeEventWindow: plan.lifeEventWindow,
    history: [...game.history, ...plan.history],
  };
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

type Touched = {
  participant: CurrentParticipantRef;
  playerId?: PlayerId;
  before?: LifeFields;
  after?: LifeFields;
  added?: LifeEvent;
  removed?: LifeEvent;
};

const refuse = (message: string): LifeRefusal => ({ ok: false, code: "refused", message });

/** A structurally valid confirmation token issued for exactly this
 * participation instance at exactly this Game Moment. */
function isBoundTo(token: unknown, participantId: ParticipantId, moment: LiveGameMoment): boolean {
  if (!token || typeof token !== "object") return false;
  const t = token as Partial<LifeConfirmationToken>;
  return (t.kind === "additionalExecution" || t.kind === "travelerExecutee") &&
    t.participantId === participantId &&
    !!t.moment && typeof t.moment === "object" && sameMoment(t.moment, moment);
}

/** Own-property player lookup (never an inherited Object.prototype name). */
const ownPlayer = (game: StorytellerLobbyRecord, id: unknown): STPlayerRecord | undefined =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(game.players, id) ? game.players[id] : undefined;

const displayName = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;

/**
 * Plans one atomic life transaction against `game`. Pure: reads `game`,
 * returns a plan or a refusal, never mutates anything. `ids` exists so tests
 * can make ids deterministic.
 */
export function planLifeTransaction(
  game: StorytellerLobbyRecord,
  transaction: LifeTransaction,
  ids: LifeIdSource = DEFAULT_IDS,
): LifePlanResult {
  // --- Guards --------------------------------------------------------------
  const current = currentLiveMoment(game);
  if (!current) return refuse("Life changes are recorded only during Night or Day.");
  const intents = Array.isArray(transaction?.intents) ? transaction.intents : [];
  if (intents.length === 0) return refuse("Nothing to record.");
  if (intents.length > MAX_LIFE_INTENTS) return refuse(`At most ${MAX_LIFE_INTENTS} life changes can be recorded at once.`);
  const correction = isCorrectionIntent(intents[0]!);
  if (intents.some((intent) => isCorrectionIntent(intent) !== correction)) {
    return refuse("A correction cannot be combined with gameplay events.");
  }
  const { resolutionId } = transaction;
  if (resolutionId !== undefined && (typeof resolutionId !== "string" || !resolutionId || resolutionId.length > 200)) {
    return refuse("Invalid resolution id.");
  }
  const provenance = durableProvenance(game, transaction.context?.provenance);
  if (provenance === null) return refuse("The Provenance source Player is not seated.");

  // --- Working state -------------------------------------------------------
  const working = new Map<PlayerId, LifeFields>();
  const fieldsOf = (p: STPlayerRecord) => working.get(p.id) ?? lifeFieldsOf(p);
  let events = [...game.lifeEventWindow.events];
  const touched = new Map<ParticipantId, Touched>();

  const touch = (participant: CurrentParticipantRef, player?: STPlayerRecord): Touched => {
    let entry = touched.get(participant.participantId);
    if (!entry) {
      entry = { participant };
      touched.set(participant.participantId, entry);
    }
    if (player && !entry.playerId) {
      entry.playerId = player.id;
      entry.participant = participant;
      entry.before = lifeFieldsOf(player);
    }
    return entry;
  };
  const setFields = (player: STPlayerRecord, participant: CurrentParticipantRef, next: LifeFields) => {
    working.set(player.id, next);
    touch(participant, player).after = next;
  };
  const addEvent = (event: LifeEvent): LifeRefusal | null => {
    const entry = touch(event.subject);
    if (entry.added) return refuse("One resolution records at most one Life Event per player.");
    entry.added = event;
    events.push(event);
    return null;
  };
  const removeEvent = (event: LifeEvent): LifeRefusal | null => {
    const entry = touch(event.subject);
    if (entry.removed) return refuse("One correction retracts at most one Life Event per player.");
    entry.removed = event;
    events = events.filter((e) => e.id !== event.id);
    return null;
  };

  /** A current, occupied participant, never an empty planned seat. */
  const seated = (playerId: unknown): { player: STPlayerRecord; ref: CurrentParticipantRef } | LifeRefusal => {
    const player = ownPlayer(game, playerId);
    const ref = player ? participantRefOf(game, player.id) : null;
    if (!player || !ref || ref.kind !== "participant") return refuse("That seat has no player.");
    return { player, ref };
  };
  const eventCommon = (subject: CurrentParticipantRef, extraResolution?: string) => ({
    id: ids.eventId(),
    subject: cloneOwned(subject),
    ...((extraResolution ?? resolutionId) ? { resolutionId: extraResolution ?? resolutionId } : {}),
    ...(provenance ? { provenance: cloneOwned(provenance) } : {}),
  });

  /** Builds a correction-recorded event at `moment`, validating the
   * structural rules (Day-only kinds, required outcomes, Traveler exile). */
  const buildSpecEvent = (
    spec: LifeEventSpec,
    moment: LiveGameMoment,
    fallbackSubject: CurrentParticipantRef | null,
    extraResolution?: string,
  ): LifeEvent | LifeRefusal => {
    if (!spec || typeof spec !== "object") return refuse("Invalid Life Event.");
    let subject: CurrentParticipantRef;
    let subjectPlayer: STPlayerRecord | undefined;
    if (spec.playerId !== undefined) {
      const resolved = seated(spec.playerId);
      if ("ok" in resolved) return resolved;
      subject = resolved.ref;
      subjectPlayer = resolved.player;
    } else if (fallbackSubject) {
      subject = fallbackSubject;
      // The original subject may still be seated; if so, judge them by it.
      const maybe = ownPlayer(game, fallbackSubject.playerId);
      if (maybe?.participantId === fallbackSubject.participantId) subjectPlayer = maybe;
    } else {
      return refuse("Choose a player.");
    }
    const common = eventCommon(subject, extraResolution);
    switch (spec.kind) {
      case "death":
      case "resurrection":
        return { ...common, kind: spec.kind, moment: { ...moment } };
      case "execution":
        if (moment.phase !== "day") return refuse("Executions happen during the Day.");
        if (!["died", "survived", "alreadyDead"].includes(spec.outcome)) return refuse("Choose an execution outcome.");
        return { ...common, kind: "execution", moment: moment as DayGameMoment, outcome: spec.outcome };
      case "exile":
        if (moment.phase !== "day") return refuse("Exiles happen during the Day.");
        if (!["died", "survived"].includes(spec.outcome)) return refuse("Choose an exile outcome.");
        if (subjectPlayer && !subjectPlayer.isTraveler) return refuse("Only a Traveler can be exiled.");
        return { ...common, kind: "exile", moment: moment as DayGameMoment, outcome: spec.outcome };
      default:
        return refuse("Invalid Life Event.");
    }
  };

  const DEAD = (f: LifeFields, exiled: boolean): LifeFields => ({ ...f, alive: false, ghostVote: true, exiled });

  // --- Intents -------------------------------------------------------------
  for (const intent of intents) {
    if (!intent || typeof intent !== "object") return refuse("Invalid life change.");
    switch (intent.kind) {
      case "death": {
        const s = seated(intent.playerId); if ("ok" in s) return s;
        const f = fieldsOf(s.player);
        if (!f.alive) return refuse(`${displayName(s.player)} is already dead.`);
        setFields(s.player, s.ref, DEAD(f, false));
        const refusal = addEvent({ ...eventCommon(s.ref), kind: "death", moment: { ...current } });
        if (refusal) return refusal;
        break;
      }
      case "execution": {
        if (current.phase !== "day") return refuse("Executions happen during the Day.");
        const s = seated(intent.playerId); if ("ok" in s) return s;
        const f = fieldsOf(s.player);
        if (!["died", "survived", "alreadyDead"].includes(intent.outcome)) return refuse("Choose an execution outcome.");
        if (intent.outcome === "alreadyDead" && f.alive) return refuse(`${displayName(s.player)} is alive -- choose Died or Survived.`);
        if (intent.outcome !== "alreadyDead" && !f.alive) return refuse(`${displayName(s.player)} is already dead -- choose Already dead.`);
        // 10A-ASTRA-002: every presented confirmation must name THIS
        // participation instance at THIS moment -- a PlayerId, name or UID
        // match is never enough.
        const tokens: readonly LifeConfirmationToken[] = Array.isArray(intent.confirmations) ? intent.confirmations : [];
        if (!tokens.every((t) => isBoundTo(t, s.ref.participantId, current))) {
          return { ok: false, code: "stale",
            message: "This confirmation is out of date -- the player or the phase changed. Review and record again." };
        }
        const confirmed = (kind: LifeConfirmation) => tokens.some((t) => t.kind === kind);
        const token = (kind: LifeConfirmation): LifeConfirmationToken =>
          ({ kind, participantId: s.ref.participantId, moment: { ...current } });
        if (s.player.isTraveler && !confirmed("travelerExecutee")) {
          return { ok: false, code: "needsConfirmation", confirmation: token("travelerExecutee"),
            message: `${displayName(s.player)} is a Traveler. Travelers are normally exiled, not executed. Record them as the executee anyway?` };
        }
        const today = events.filter((e) => e.kind === "execution" && sameMoment(e.moment, current));
        if (today.length > 0 && !confirmed("additionalExecution")) {
          return { ok: false, code: "needsConfirmation", confirmation: token("additionalExecution"),
            message: `An execution is already recorded for Day ${current.day}. Record an additional execution?` };
        }
        if (intent.outcome === "died") setFields(s.player, s.ref, DEAD(f, false));
        const refusal = addEvent({ ...eventCommon(s.ref), kind: "execution", moment: current as DayGameMoment, outcome: intent.outcome });
        if (refusal) return refusal;
        break;
      }
      case "exile": {
        if (current.phase !== "day") return refuse("Exiles happen during the Day.");
        const s = seated(intent.playerId); if ("ok" in s) return s;
        if (!s.player.isTraveler) return refuse("Only a Traveler can be exiled.");
        const f = fieldsOf(s.player);
        if (!f.alive) return refuse(`${displayName(s.player)} is already dead.`);
        if (intent.outcome !== "died" && intent.outcome !== "survived") return refuse("Choose an exile outcome.");
        if (intent.outcome === "died") setFields(s.player, s.ref, DEAD(f, true));
        const refusal = addEvent({ ...eventCommon(s.ref), kind: "exile", moment: current as DayGameMoment, outcome: intent.outcome });
        if (refusal) return refusal;
        break;
      }
      case "resurrection": {
        const s = seated(intent.playerId); if ("ok" in s) return s;
        const f = fieldsOf(s.player);
        if (f.alive) return refuse(`${displayName(s.player)} is alive.`);
        // Generic BOTC resurrection: alive again, holding their vote, no
        // longer exile-dead, and their ability (once-per-game included)
        // restored.
        setFields(s.player, s.ref, { alive: true, ghostVote: true, exiled: false, abilityUsed: false });
        const refusal = addEvent({ ...eventCommon(s.ref), kind: "resurrection", moment: { ...current } });
        if (refusal) return refusal;
        break;
      }
      case "spendGhostVote":
      case "restoreGhostVote": {
        const s = seated(intent.playerId); if ("ok" in s) return s;
        const f = fieldsOf(s.player);
        if (f.alive) return refuse("Only a dead player has a ghost vote.");
        const spend = intent.kind === "spendGhostVote";
        if (f.ghostVote !== spend) return refuse(spend ? "That vote is already used." : "That vote is already available.");
        setFields(s.player, s.ref, { ...f, ghostVote: !spend });
        break;
      }
      case "correctStatus": {
        const s = seated(intent.playerId); if ("ok" in s) return s;
        const target = intent.target;
        if (!target || typeof target !== "object" || typeof target.alive !== "boolean") return refuse("Choose a status.");
        const f = fieldsOf(s.player);
        let next: LifeFields;
        if (target.alive) {
          if ("ghostVote" in target || "exiled" in target) return refuse("A living player always holds their vote and is not exiled.");
          next = { ...f, alive: true, ghostVote: true, exiled: false };
        } else {
          if (typeof target.ghostVote !== "boolean") return refuse("Choose whether the vote is available.");
          const exiled = target.exiled === true;
          if (exiled && !s.player.isTraveler) return refuse("Only a Traveler can be exile-dead.");
          next = { ...f, alive: false, ghostVote: target.ghostVote, exiled };
        }
        // A correction never restores a used ability (no resurrection).
        setFields(s.player, s.ref, next);
        break;
      }
      case "retractEvent": {
        const event = events.find((e) => e.id === intent.eventId);
        if (!event) return refuse("That event is no longer in the recent Life Event window.");
        const refusal = removeEvent(event);
        if (refusal) return refusal;
        break;
      }
      case "amendEvent": {
        const original = events.find((e) => e.id === intent.eventId);
        if (!original) return refuse("That event is no longer in the recent Life Event window.");
        const replacement = buildSpecEvent(intent.replacement, original.moment, original.subject, original.resolutionId);
        if ("ok" in replacement) return replacement;
        if (replacement.kind === original.kind && replacement.subject.participantId === original.subject.participantId &&
          ("outcome" in replacement ? replacement.outcome : undefined) === ("outcome" in original ? original.outcome : undefined)) {
          return refuse("The amended event is identical to the original.");
        }
        const removed = removeEvent(original);
        if (removed) return removed;
        const added = addEvent(replacement);
        if (added) return added;
        break;
      }
      case "lateRecord": {
        const previous = previousLiveMoment(current);
        if (!previous) return refuse("There is no previous phase to record into.");
        if (!intent.event || intent.event.playerId === undefined) return refuse("Choose a player.");
        const event = buildSpecEvent(intent.event, previous, null);
        if ("ok" in event) return event;
        const refusal = addEvent(event);
        if (refusal) return refusal;
        break;
      }
      default:
        return refuse("Invalid life change.");
    }
  }

  // --- Finalize: one History mirror per affected participant ---------------
  const playerPatches: Record<PlayerId, LifeFieldPatch> = {};
  const history: HistoryRecord[] = [];
  for (const entry of touched.values()) {
    const diff = entry.before && entry.after ? lifeDiff(entry.before, entry.after) : null;
    if (diff && entry.playerId) playerPatches[entry.playerId] = { ...entry.after! };
    if (!diff && !entry.added && !entry.removed) continue;
    history.push(cloneOwned({
      id: ids.historyId(),
      category: "life" as const,
      participant: entry.participant,
      moment: { ...current },
      ...(diff ? { change: { kind: "value" as const, ...diff } } : {}),
      ...(entry.added || entry.removed ? { lifeEvent: {
        ...(entry.removed ? { removed: entry.removed } : {}),
        ...(entry.added ? { added: entry.added } : {}),
      } } : {}),
      ...(correction ? { correction: true as const } : {}),
      ...(provenance ? { provenance } : {}),
    }));
  }
  // True no-op: nothing about Current State, the window or History changes.
  if (history.length === 0) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    plan: {
      playerPatches,
      // The window object is replaced only when an event was added or
      // removed; a vote-token change or status correction leaves it as is.
      lifeEventWindow: [...touched.values()].some((entry) => entry.added || entry.removed)
        ? { coverageFrom: game.lifeEventWindow.coverageFrom, events }
        : game.lifeEventWindow,
      history,
      addedEventIds: [...touched.values()].flatMap((entry) => entry.added ? [entry.added.id] : []),
    },
  };
}
