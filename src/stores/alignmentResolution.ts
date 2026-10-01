import { MAX_TOTAL_PLAYERS } from "@/data/setupCounts";
import { cloneOwned, durableProvenance, historyId, isLiveGamePhase, sameSnapshot, type MutationContext } from "./history";
import { isInitialRevealComplete } from "./identity";
import { currentLiveMoment } from "./lifeEvents";
import { participantRefOf } from "./participants";
import { MutationContextInputSchema, ProvenanceSchema } from "./schemas";
import type {
  Alignment,
  HistoryRecord,
  ParticipantId,
  PlayerId,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10E: the authoritative Actual Alignment boundary.
 *
 * Every live/general change to a participant's Actual Alignment is PLANNED
 * here, purely, from the game as it stands:
 *
 *   AlignmentIntent[] -> planAlignmentTransaction (pure) -> AlignmentPlan |
 *   no-op | AlignmentRefusal -> applyAlignmentPlan (pure) -> resolveAlignments
 *   (store) -> ONE game replacement (one Undo entry, one localSeq step, one
 *   projection cycle)
 *
 * Nothing here evaluates a character ability: no Snake Charmer, Cult Leader,
 * Goon, Ogre, ... The module only keeps an Alignment change participant-safe,
 * stale-safe, atomic and explained. Actual Role and Actual Alignment are
 * independent: an Alignment intent is never bound to, and never changes, the
 * Actual Role or ordinary-vs-Traveler status.
 *
 * PERCEPTION IS NOT OWNED HERE. Player-facing alignment (`shownAlignment`:
 * Normal / explicit Good / explicit Evil / undisclosed) belongs to the Phase
 * 10D perception seam (setPerception in roleResolution.ts). This seam writes
 * Actual Alignment and the Alignment-specific Traveler private-packet cleanup
 * only (see ALIGNMENT_PLAN_FIELDS).
 *
 * PURITY: the planner and `applyAlignmentPlan` read only their arguments.
 * Every id the plan needs (History ids, packet epochs) comes from the injected
 * `AlignmentIdSource`; `defaultAlignmentIds` is exported for the store, and is
 * never used inside this module.
 *
 * PARTIAL-FIELD PATCHES (load-bearing for 10F composition): an
 * `AlignmentPlan` never carries a whole player record, so it can be planned
 * and applied on a working snapshot a Life/Effect/Reminder/Role plan already
 * produced without reverting or overwriting any of those domains:
 *
 *   workingGame -> ... -> planRoles/applyRoles -> planAlignments/
 *   applyAlignments -> (a future coordinator commits once)
 *
 * State ownership: Current State stays authoritative. Alignment History only
 * explains committed Actual Alignment mutations; mechanics never rebuild
 * Current State from it.
 */

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/** A CURRENT participant, bound to the participation instance the caller
 * observed. If the seat no longer holds that participation instance the whole
 * transaction is refused as `stale`. */
export type AlignmentParticipantBinding = { playerId: PlayerId; participantId: ParticipantId };

/**
 * A REAL gameplay change of Actual Alignment. Bound to the participation
 * instance AND the observed current state: `expectedActualAlignment` (null
 * when the caller saw it unresolved) and `expectedIsTraveler`. Never bound to
 * the Actual Role. The destination is always Good or Evil -- there is no live
 * destination that clears Actual Alignment back to unresolved.
 */
export type ChangeActualAlignmentIntent = {
  kind: "changeActualAlignment";
  target: AlignmentParticipantBinding;
  expectedActualAlignment: Alignment | null;
  expectedIsTraveler: boolean;
  actualAlignment: Alignment;
};

/**
 * Silverwick's recorded Actual Alignment is being REPAIRED -- not a gameplay
 * event. Same binding and destination; the final truth is identical to a
 * gameplay change, only the explanation differs (Live Play History carries
 * `correction: true`).
 */
export type CorrectActualAlignmentIntent = {
  kind: "correctActualAlignment";
  target: AlignmentParticipantBinding;
  expectedActualAlignment: Alignment | null;
  expectedIsTraveler: boolean;
  actualAlignment: Alignment;
};

export type AlignmentIntent = ChangeActualAlignmentIntent | CorrectActualAlignmentIntent;

/**
 * One atomic Alignment resolution: every intent is validated before anything
 * is committed; all are accepted (one commit) or none is. At most ONE intent
 * per ParticipantId; gameplay and correction intents never mix. There is no
 * same-participant A -> B -> C ordering primitive.
 */
export type AlignmentTransaction = {
  intents: readonly AlignmentIntent[];
  /** Mutation provenance: what caused THIS mutation. */
  context?: MutationContext;
  /** Correlation METADATA only (stored on every Alignment History Record
   * produced): not an idempotency key, not authority, not assumed globally
   * unique. */
  resolutionId?: string;
};

export type AlignmentRefusalCode =
  /** Malformed input (shape, unknown/inherited key, bad type/value). */
  | "invalid"
  /** The Alignment seam cannot make this change in this phase (ended; a
   * gameplay change after the initial Reveal but before Night 1, other than an
   * unresolved Traveler's starting alignment). */
  | "phase"
  /** The named seat does not exist, or a Provenance source is not seated. */
  | "notSeated"
  /** The seat no longer holds the bound participation instance, or the
   * observed Actual Alignment / Traveler status no longer matches. */
  | "stale"
  /** A second Alignment intent for one participant in one transaction. */
  | "conflict"
  /** Gameplay and correction Alignment intents in one transaction. */
  | "mixedCorrection"
  /** Empty or oversized transaction. */
  | "tooMany";

/** UI-facing `message` copy is concise and never discloses an alignment
 * value. */
export type AlignmentRefusal = { ok: false; code: AlignmentRefusalCode; message: string; intentIndex?: number };

/** The removable optional player fields an Alignment plan may clear. */
export type AlignmentRemovableField = "privateInfo" | "publishedPacket";
/** The ONLY player fields an Alignment plan may set (see
 * ALIGNMENT_PLAN_FIELDS). Never perception, Role, Traveler status, Life,
 * Effects, Reminders, travelerArrival or participant identity. */
export type AlignmentPlayerSet = Partial<Pick<STPlayerRecord, "actualAlignment" | "privateInfo" | "packetEpoch">>;
/** A partial-field patch of ONE participant. Never a whole player record. */
export type AlignmentPlayerPatch = { set: AlignmentPlayerSet; remove: AlignmentRemovableField[] };

/** One committed Actual Alignment mutation. `from` null = unresolved. */
export type AlignmentChange = {
  playerId: PlayerId;
  participantId: ParticipantId;
  from: Alignment | null;
  to: Alignment;
  correction: boolean;
  isTraveler: boolean;
};

/** What an accepted transaction changes -- nothing is applied yet. */
export type AlignmentPlan = {
  /** Field patches of exactly the participants whose Actual Alignment
   * changes. */
  players: Record<PlayerId, AlignmentPlayerPatch>;
  /** One Alignment History Record per Actual Alignment mutation, in intent
   * order (Live Play only -- Setup records none). */
  history: HistoryRecord[];
  /** The Actual Alignment mutations this plan makes, in intent order. */
  alignmentChanges: AlignmentChange[];
};

export type AlignmentPlanResult =
  | { ok: true; changed: true; plan: AlignmentPlan }
  | { ok: true; changed: false }
  | AlignmentRefusal;

/** Injectable identity generation: the planner never draws randomness itself. */
export type AlignmentIdSource = { historyId: () => string; packetEpoch: () => string };
export const defaultAlignmentIds: AlignmentIdSource = {
  historyId,
  packetEpoch: () => globalThis.crypto?.randomUUID?.() ?? `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
};

/** What the planner needs besides the game. `ids` is required (never
 * defaulted inside the module). */
export type AlignmentEnvironment = { ids: AlignmentIdSource };

/** At most one intent per participant, so the participant cap bounds every
 * legitimate transaction. */
export const MAX_ALIGNMENT_INTENTS = MAX_TOTAL_PLAYERS;
const MAX_RESOLUTION_ID_LENGTH = 200;

/** The complete, closed list of player fields an Alignment plan may patch. */
export const ALIGNMENT_PLAN_FIELDS = ["actualAlignment", "privateInfo", "publishedPacket", "packetEpoch"] as const;
type AlignmentPlanField = (typeof ALIGNMENT_PLAN_FIELDS)[number];

// ---------------------------------------------------------------------------
// Plan application
// ---------------------------------------------------------------------------

/**
 * Applies an accepted plan: the one Current State + History replacement the
 * store commits. Pure -- returns a new snapshot and mutates nothing. Only the
 * planned fields of the planned participants change; everything else in
 * `game` (including state an earlier domain plan already applied to it) is
 * carried through untouched.
 */
export function applyAlignmentPlan(
  game: StorytellerLobbyRecord,
  plan: Pick<AlignmentPlan, "players" | "history">,
): StorytellerLobbyRecord {
  const players = { ...game.players };
  for (const [playerId, patch] of Object.entries(plan.players)) {
    if (!Object.prototype.hasOwnProperty.call(game.players, playerId)) continue;
    const next: STPlayerRecord = { ...game.players[playerId]!, ...cloneOwned(patch.set) };
    for (const field of patch.remove) delete next[field];
    players[playerId] = next;
  }
  return {
    ...game,
    players,
    history: plan.history.length ? [...game.history, ...plan.history] : game.history,
  };
}

// ---------------------------------------------------------------------------
// Strict input
// ---------------------------------------------------------------------------

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
/** A plain data object: an object literal / `Object.create(null)`, never an
 * array, class instance or prototype-carrying stand-in. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
/** Own-property player lookup (never an inherited Object.prototype name). */
const ownPlayer = (game: Pick<StorytellerLobbyRecord, "players">, id: unknown): STPlayerRecord | undefined =>
  typeof id === "string" && hasOwn(game.players, id) ? game.players[id] : undefined;
/** An unsupported key is refused because it is PRESENT as an own property --
 * whatever its value, `undefined` included; it is never silently stripped. */
const unknownKey = (value: Record<string, unknown>, allowed: ReadonlySet<string>): string | undefined =>
  Object.keys(value).find((key) => !allowed.has(key));

const TRANSACTION_KEYS = new Set(["intents", "context", "resolutionId"]);
const BINDING_KEYS = new Set(["playerId", "participantId"]);
const INTENT_KEYS = new Set(["kind", "target", "expectedActualAlignment", "expectedIsTraveler", "actualAlignment"]);
const INTENT_KINDS = new Set<AlignmentIntent["kind"]>(["changeActualAlignment", "correctActualAlignment"]);

const isAlignment = (value: unknown): value is Alignment => value === "good" || value === "evil";

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Plans one atomic Alignment transaction against `game`. Pure: reads `game`
 * (any valid snapshot -- including one a future coordinator already derived
 * by applying other domain plans), returns a plan, a true no-op or a
 * structured refusal; never mutates anything and never throws on malformed
 * caller input.
 */
export function planAlignmentTransaction(
  game: StorytellerLobbyRecord,
  transaction: AlignmentTransaction,
  environment: AlignmentEnvironment,
): AlignmentPlanResult {
  const refuse = (code: AlignmentRefusalCode, message: string, intentIndex?: number): AlignmentRefusal =>
    ({ ok: false, code, message, ...(intentIndex !== undefined ? { intentIndex } : {}) });

  // --- Guards --------------------------------------------------------------
  // Ended games are frozen: no Actual Alignment changes.
  if (game.phase === "ended") return refuse("phase", "This game has ended; alignments are frozen.");
  if (!isPlainObject(transaction)) return refuse("invalid", "Invalid alignment transaction.");
  const unknownTransactionKey = unknownKey(transaction as unknown as Record<string, unknown>, TRANSACTION_KEYS);
  if (unknownTransactionKey !== undefined) return refuse("invalid", `Unknown alignment transaction field "${unknownTransactionKey}".`);
  if (!hasOwn(transaction, "intents") || !Array.isArray(transaction.intents)) return refuse("invalid", "Invalid alignment transaction.");
  const intents = transaction.intents as readonly unknown[];
  if (intents.length === 0) return refuse("tooMany", "Nothing to change.");
  if (intents.length > MAX_ALIGNMENT_INTENTS) return refuse("tooMany", `At most ${MAX_ALIGNMENT_INTENTS} alignment changes can be made at once.`);
  // Validated index by index (array helpers skip the holes of a sparse
  // array): every position 0 <= i < length must be an OWN element holding a
  // plain object whose `kind` is an OWN string naming a known intent -- an
  // inherited `kind` is never read. A failure is a structured refusal with
  // its index, never an exception.
  for (let index = 0; index < intents.length; index++) {
    const intent: unknown = hasOwn(intents, String(index)) ? intents[index] : undefined;
    if (!isPlainObject(intent) || !hasOwn(intent, "kind") || typeof intent.kind !== "string" ||
      !INTENT_KINDS.has(intent.kind as AlignmentIntent["kind"])) {
      return refuse("invalid", "Invalid alignment change.", index);
    }
  }
  const list = intents as readonly AlignmentIntent[];
  if (new Set(list.map((intent) => intent.kind)).size > 1) {
    return refuse("mixedCorrection", "A correction cannot be combined with an ordinary alignment change.");
  }
  const { resolutionId } = transaction;
  if (resolutionId !== undefined && (typeof resolutionId !== "string" || !resolutionId || resolutionId.length > MAX_RESOLUTION_ID_LENGTH)) {
    return refuse("invalid", "Invalid resolution id.");
  }
  // The Mutation Context is runtime-untrusted: validated by the strict
  // caller-facing schema against the RAW value (an unknown key is refused by
  // presence), then converted to durable provenance.
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

  const { ids } = environment;
  const setup = game.phase === "setup";
  const live = isLiveGamePhase(game.phase);
  const current = currentLiveMoment(game);
  const revealed = isInitialRevealComplete(game);

  /** At most ONE Alignment intent per ParticipantId -- even a no-op one. */
  const claimed = new Set<ParticipantId>();
  /** The real mutations, in intent order. */
  const changes: AlignmentChange[] = [];

  // --- Intents -------------------------------------------------------------
  for (let index = 0; index < list.length; index++) {
    const intent = list[index]!;
    const at = (code: AlignmentRefusalCode, message: string): AlignmentRefusal => refuse(code, message, index);
    const extra = unknownKey(intent as unknown as Record<string, unknown>, INTENT_KEYS);
    if (extra !== undefined) return at("invalid", `Unknown alignment change field "${extra}".`);
    const isCorrection = intent.kind === "correctActualAlignment";

    // Binding: a CURRENT participant, named only by an own-property plain
    // binding.
    const binding: unknown = hasOwn(intent, "target") ? intent.target : undefined;
    if (!isPlainObject(binding)) return at("invalid", "Choose the player.");
    if (unknownKey(binding, BINDING_KEYS) !== undefined) return at("invalid", "The player is named only by a bound current participant.");
    const playerId: unknown = hasOwn(binding, "playerId") ? binding.playerId : undefined;
    const participantId: unknown = hasOwn(binding, "participantId") ? binding.participantId : undefined;
    if (typeof playerId !== "string" || !playerId) return at("invalid", "Choose the player.");
    if (typeof participantId !== "string" || !participantId) return at("invalid", "The player must be bound to a participant.");

    // Shape of the observed state and the destination (own properties only;
    // `null` is the explicit "observed unresolved" value).
    if (!hasOwn(intent, "expectedActualAlignment") ||
      (intent.expectedActualAlignment !== null && !isAlignment(intent.expectedActualAlignment))) {
      return at("invalid", "The observed alignment must be given.");
    }
    if (!hasOwn(intent, "expectedIsTraveler") || typeof intent.expectedIsTraveler !== "boolean") {
      return at("invalid", "The observed Traveler status must be given.");
    }
    if (!hasOwn(intent, "actualAlignment") || !isAlignment(intent.actualAlignment)) {
      return at("invalid", "Choose Good or Evil.");
    }

    const player = ownPlayer(game, playerId);
    if (!player) return at("notSeated", "The player's seat does not exist.");
    if (player.isEmpty || !player.participantId) return at("stale", "The player is no longer seated -- nothing was changed. Review and try again.");
    if (player.participantId !== participantId) return at("stale", "The seat now holds a different player -- nothing was changed. Review and try again.");
    if (!participantRefOf(game, player.id)) return at("notSeated", "The player is not seated.");

    // One Alignment intent per participation instance per planner call.
    if (claimed.has(player.participantId)) return at("conflict", "A participant's alignment can change only once in one resolution.");
    claimed.add(player.participantId);

    // Stale-state guards: same participant, but the observed truth moved.
    const from = player.actualAlignment ?? null;
    if (from !== intent.expectedActualAlignment || player.isTraveler !== intent.expectedIsTraveler) {
      return at("stale", "This player's alignment or Traveler status changed -- nothing was changed. Review and try again.");
    }

    // Lifecycle: after the initial Reveal but before Night 1 a GAMEPLAY change
    // is refused -- except an unresolved Traveler receiving their starting
    // alignment. A correction is always allowed (outside an ended game).
    if (setup && revealed && !isCorrection && !(player.isTraveler && from === null)) {
      return at("phase", "Roles are revealed. Correct the recorded alignment instead, or begin Night 1.");
    }

    // Setting the current Actual Alignment is a TRUE no-op for this
    // participant (still claimed above).
    if (from === intent.actualAlignment) continue;
    changes.push({ playerId: player.id, participantId: player.participantId, from, to: intent.actualAlignment,
      correction: isCorrection, isTraveler: player.isTraveler });
  }

  // True no-op: nothing changes, nothing is recorded, nothing is minted.
  if (changes.length === 0) return { ok: true, changed: false };

  // --- Finalize --------------------------------------------------------------
  const players: Record<PlayerId, AlignmentPlayerPatch> = {};
  for (const change of changes) {
    const original = ownPlayer(game, change.playerId)!;
    const final: STPlayerRecord = { ...original, actualAlignment: change.to };
    if (change.isTraveler) {
      // A Traveler's packet may hold alignment-dependent information (arrival
      // Demon information), so a genuine Actual Alignment change withdraws the
      // published packet and mints a fresh epoch -- even when an explicit
      // perception override keeps the visible label unchanged -- and drops the
      // prepared Traveler Demon draft. Nothing else is touched: arrival
      // completion (what was already given is never "forgotten"), unrelated
      // drafts, Information Delivery, Night progress, Role, Life, Effects and
      // Reminders all stay as they are; no travelerArrival is ever created.
      delete final.publishedPacket;
      final.packetEpoch = ids.packetEpoch();
      if (original.privateInfo && original.privateInfo.travelerDemon !== undefined) {
        const { travelerDemon: _withdrawn, ...remaining } = original.privateInfo;
        if (Object.keys(remaining).length) final.privateInfo = remaining;
        else delete final.privateInfo;
      }
    }
    const patch: AlignmentPlayerPatch = { set: {}, remove: [] };
    for (const field of ALIGNMENT_PLAN_FIELDS as readonly AlignmentPlanField[]) {
      if (sameSnapshot(original[field], final[field])) continue;
      if (final[field] === undefined) {
        if (field === "privateInfo" || field === "publishedPacket") patch.remove.push(field);
      } else {
        (patch.set as Record<string, unknown>)[field] = cloneOwned(final[field]);
      }
    }
    players[change.playerId] = patch;
  }

  // History explains COMMITTED Actual Alignment mutations only (Live Play);
  // Setup records none. An unresolved origin is the canonical empty snapshot.
  const history: HistoryRecord[] = [];
  if (live && current) {
    for (const change of changes) {
      const participant = participantRefOf(game, change.playerId);
      if (!participant) return refuse("notSeated", "The player is not seated.");
      history.push(cloneOwned({
        id: ids.historyId(),
        category: "alignment" as const,
        participant,
        moment: { ...current },
        change: { kind: "value" as const, from: change.from === null ? {} : { actualAlignment: change.from }, to: { actualAlignment: change.to } },
        ...(change.correction ? { correction: true as const } : {}),
        ...(resolutionId ? { resolutionId } : {}),
        ...(provenance ? { provenance } : {}),
      }));
    }
  }
  return { ok: true, changed: true, plan: { players, history, alignmentChanges: changes } };
}

// ---------------------------------------------------------------------------
// Caller helpers: build intents from the record the caller RENDERED, so the
// bound participant and observed state are exactly what the Storyteller saw.
// ---------------------------------------------------------------------------

const bindingOf = (player: Pick<STPlayerRecord, "id" | "participantId">): AlignmentParticipantBinding =>
  ({ playerId: player.id, participantId: player.participantId ?? "" });

/** A gameplay Actual Alignment change of `player` (as rendered). */
export function changeAlignmentIntent(player: STPlayerRecord, actualAlignment: Alignment): ChangeActualAlignmentIntent {
  return { kind: "changeActualAlignment", target: bindingOf(player), expectedActualAlignment: player.actualAlignment ?? null,
    expectedIsTraveler: player.isTraveler, actualAlignment };
}

/** A correction of `player`'s (as rendered) recorded Actual Alignment. */
export function correctAlignmentIntent(player: STPlayerRecord, actualAlignment: Alignment): CorrectActualAlignmentIntent {
  return { kind: "correctActualAlignment", target: bindingOf(player), expectedActualAlignment: player.actualAlignment ?? null,
    expectedIsTraveler: player.isTraveler, actualAlignment };
}

/** Whether a GAMEPLAY Alignment change of `player` is open in this lifecycle
 * (the same rule the planner enforces) -- lets render-bound UI offer only what
 * the seam accepts. A correction is open whenever the game has not ended. */
export function alignmentChangeOpen(
  game: Pick<StorytellerLobbyRecord, "phase" | "day" | "setupRolesRevealed">,
  player: Pick<STPlayerRecord, "isTraveler" | "actualAlignment">,
): boolean {
  if (game.phase === "ended") return false;
  if (game.phase === "setup" && isInitialRevealComplete(game)) return player.isTraveler && player.actualAlignment === undefined;
  return true;
}
