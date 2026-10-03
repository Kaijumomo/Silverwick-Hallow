import { MAX_TOTAL_PLAYERS } from "@/data/setupCounts";
import { ORDINARY_ROLE_TYPES, buildRegistry, isOrdinaryRoleType, ownedScriptCharacters } from "@/data/roleRegistry";
import { getTraveler } from "@/data/travelers";
import { cloneOwned, durableProvenance, historyId, isLiveGamePhase, sameSnapshot, type MutationContext } from "./history";
import { isInitialRevealComplete } from "./identity";
import { currentLiveMoment } from "./lifeEvents";
import { isParticipantRoleStepEntry } from "./nightProgress";
import { participantRefOf } from "./participants";
import { pruneInapplicablePrivateInfo } from "./privatePackets";
import { BehaviorModeSchema, MutationContextInputSchema, ProvenanceSchema } from "./schemas";
import { newTravelerArrival } from "./travelers";
import type {
  BehaviorMode,
  HistoryRecord,
  ParticipantId,
  PlayerId,
  RoleDef,
  RoleId,
  Script,
  ShownAlignment,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10D: the authoritative Role boundary.
 *
 * Every live/general change to a participant's Actual Role, ordinary-vs-
 * Traveler status and explicit perception (Shown Role, Shown Alignment,
 * behavior mode) is PLANNED here, purely, from the game as it stands:
 *
 *   RoleIntent[] -> planRoleTransaction (pure) -> RolePlan | no-op |
 *   RoleRefusal -> applyRolePlan (pure) -> resolveRoles (store) -> ONE game
 *   replacement (one Undo entry, one localSeq step, one projection cycle)
 *
 * Nothing here evaluates a character ability: no Pit-Hag, Barber, Hatter, ...
 * The module only keeps a Role change participant-safe, stale-safe, atomic and
 * explained. Character uniqueness is deliberately NOT an invariant here --
 * duplicates are structurally possible so later (10F) ability semantics can
 * decide them.
 *
 * PURITY: the planner and `applyRolePlan` read only their arguments. Every id
 * the plan needs (History ids, packet epochs) comes from the injected
 * `RoleIdSource`; `defaultRoleIds` is exported for the store/UI callers, and is
 * never used inside this module.
 *
 * PARTIAL-FIELD PATCHES (load-bearing for 10F composition): a `RolePlan`
 * never carries a whole player record. It patches only the fields Role /
 * perception semantics legitimately own, so it can be planned and applied on a
 * working snapshot a Life/Effect/Reminder plan already produced without
 * reverting or overwriting any of those domains:
 *
 *   workingGame -> planLife/applyLife -> planEffects/applyEffects ->
 *   planReminders/applyReminders -> planRoles/applyRoles -> (a future
 *   coordinator commits once)
 *
 * State ownership: Current State stays authoritative. There is no Role Event
 * Window; Role History only ever explains Actual Role mutations, and
 * mechanics never rebuild Current State from it.
 */

// ---------------------------------------------------------------------------
// Role classification (by authoritative Role TYPE, not "exists somewhere")
// ---------------------------------------------------------------------------

/** The only types an ORDINARY participant's Actual or Shown Role may have --
 * ONE definition, shared with the registry's Role ownership (ASTRA-10D-004). */
export { ORDINARY_ROLE_TYPES, isOrdinaryRoleType };

/** Own-property script character lookup (never an inherited name). */
function scriptCharacter(script: Script | null | undefined, id: string): RoleDef | undefined {
  if (!script || !Array.isArray(script.characters)) return undefined;
  return script.characters.find((role) => role && role.id === id);
}

export type RoleClass =
  /** A townsfolk/outsider/minion/demon character on the current script. */
  | { kind: "ordinary"; role: RoleDef }
  /** A supported Traveler from the canonical Traveler catalogue. */
  | { kind: "traveler"; role: RoleDef }
  /** Never a legal player Role: fabled, loric, off-script or unknown. */
  | { kind: "refused" };

/**
 * Classifies a Role id for a participant. The canonical Traveler catalogue
 * decides Traveler characters (the same precedence the registry uses);
 * everything else must be an ordinary-typed character of the current script.
 * Fabled and Loric never qualify -- as an Actual Role or a Shown Role.
 */
export function classifyRole(script: Script | null | undefined, id: unknown): RoleClass {
  if (typeof id !== "string" || !id) return { kind: "refused" };
  const traveler = getTraveler(id);
  if (traveler) return { kind: "traveler", role: traveler };
  const role = scriptCharacter(script, id);
  if (role && isOrdinaryRoleType(role.type)) return { kind: "ordinary", role };
  return { kind: "refused" };
}

/** The Roles an ordinary participant may be given or shown on `script`. UI
 * pickers use exactly this so they never offer a choice the command rejects.
 * One choice per RoleId -- its FIRST definition, the owner classifyRole
 * admits (SOL-10D-C03); a legacy later duplicate is never offered. */
export function ordinaryRoleChoices(script: Script | null | undefined): RoleDef[] {
  return ownedScriptCharacters(script).filter((role) => isOrdinaryRoleType(role.type) && !getTraveler(role.id));
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

/** A CURRENT participant, bound to the participation instance the caller
 * observed. If the seat no longer holds that participation instance the whole
 * transaction is refused as `stale` -- a Role change is never applied to a
 * replacement occupant. */
export type RoleParticipantBinding = { playerId: PlayerId; participantId: ParticipantId };

/**
 * A REAL gameplay character transition occurred. Bound to the participation
 * instance AND the observed current state: `expectedActualRole` and
 * `expectedIsTraveler` (the ordinary-vs-Traveler status the destination Role's
 * type may overwrite). The destination status follows the destination Role's
 * type. Gameplay only: it resets `abilityUsed`.
 */
export type ChangeActualRoleIntent = {
  kind: "changeActualRole";
  target: RoleParticipantBinding;
  expectedActualRole: RoleId;
  expectedIsTraveler: boolean;
  actualRole: RoleId;
};

/**
 * Silverwick's recorded Role / ordinary-vs-Traveler truth is being REPAIRED --
 * not a gameplay character-change event. Preserves `abilityUsed`. For a
 * Traveler arrival, `travelerArrivalPolicy` decides explicitly: `preserve`
 * (the default) keeps the existing arrival/progress, `restart` reinitializes
 * it. Packet invalidation never implies either.
 */
export type CorrectActualRoleIntent = {
  kind: "correctActualRole";
  target: RoleParticipantBinding;
  expectedActualRole: RoleId;
  expectedIsTraveler: boolean;
  actualRole: RoleId;
  travelerArrivalPolicy?: TravelerArrivalPolicy;
};
export type TravelerArrivalPolicy = "preserve" | "restart";

/**
 * Explicitly change what character / alignment / behavior this participant is
 * being shown. Neutral with respect to gameplay-vs-correction. The primitive
 * never infers an ordinary player's Shown Role from the Actual Role.
 *
 * Phase 10E (v23) player-facing alignment: `shownAlignment: null` is Normal
 * (an ordinary participant's alignment derives from the SHOWN Role only; a
 * Traveler's follows their Actual Alignment); explicit `good` / `evil` are
 * shown explicitly; `undisclosed` shows the character without an alignment.
 * This is the ONE perception writer -- the Alignment seam never writes it.
 * Every field being overwritten carries its expected current value
 * (`expectedBehaviorMode` exactly when `behaviorMode` is supplied).
 */
export type SetPerceptionIntent = {
  kind: "setPerception";
  target: RoleParticipantBinding;
  expectedShownRole: RoleId | null;
  expectedShownAlignment: ShownAlignment | null;
  expectedBehaviorMode?: BehaviorMode;
  shownRole: RoleId | null;
  shownAlignment: ShownAlignment | null;
  behaviorMode?: BehaviorMode;
};

export type GameplayRoleIntent = ChangeActualRoleIntent;
export type CorrectionRoleIntent = CorrectActualRoleIntent;
export type RoleIntent = ChangeActualRoleIntent | CorrectActualRoleIntent | SetPerceptionIntent;

/**
 * One atomic Role resolution: every intent applies IN ORDER against the
 * evolving working state; all are accepted (one commit) or none is. At most
 * ONE Actual Role intent per ParticipantId; gameplay and correction Actual
 * intents never mix; perception intents may accompany either.
 */
export type RoleTransaction = {
  intents: readonly RoleIntent[];
  /** Mutation provenance: what caused THIS mutation. */
  context?: MutationContext;
  /** Correlation METADATA only (stored on every Role History Record produced):
   * not an idempotency key, not authority, not assumed globally unique. */
  resolutionId?: string;
};

export type RoleRefusalCode =
  /** Malformed input (shape, unknown/inherited key, bad type/value). */
  | "invalid"
  /** The Role seam cannot make this change in this phase (ended; a gameplay
   * change after the initial Reveal but before Night 1; Traveler status in
   * Setup). */
  | "phase"
  /** The named seat does not exist. */
  | "notSeated"
  /** The seat no longer holds the bound participation instance, or the
   * observed Role/status/perception no longer matches. Nothing was changed. */
  | "stale"
  /** A second Actual Role intent for one participant in one transaction. */
  | "conflict"
  /** Gameplay and correction Actual Role intents in one transaction. */
  | "mixedCorrection"
  /** Empty or oversized transaction. */
  | "tooMany"
  /** A destination Role that is not legal for this participant. */
  | "role"
  /** A perception the participant may not end with (or one that must be
   * chosen explicitly in the same resolution). */
  | "perception";

export type RoleRefusal = { ok: false; code: RoleRefusalCode; message: string; intentIndex?: number };

/** The removable optional player fields a Role plan may clear. */
export type RoleRemovableField = "privateInfo" | "publishedPacket" | "travelerArrival";
/** The ONLY player fields a Role plan may set. Never alive, ghostVote,
 * exiled, effects, reminders, actualAlignment, participantId or anything else
 * (see ROLE_PLAN_FIELDS). */
export type RolePlayerSet = Partial<Pick<STPlayerRecord,
  "actualRole" | "isTraveler" | "abilityUsed" | "shownRole" | "shownAlignment" | "behaviorMode" |
  "publicDisplayRole" | "privateInfo" | "packetEpoch" | "travelerArrival">>;
/** A partial-field patch of ONE participant: fields to set and fields to
 * remove. Never a whole player record. */
export type RolePlayerPatch = { set: RolePlayerSet; remove: RoleRemovableField[] };

/** What an accepted transaction changes -- nothing is applied yet. */
export type RolePlan = {
  /** Field patches of exactly the participants whose Role/perception state
   * changes. */
  players: Record<PlayerId, RolePlayerPatch>;
  /** `nightProgress` keys to remove (a Traveler's arrival / role night steps
   * cleared by a gameplay transition or an explicit restart). Removing keys
   * never touches any other step. */
  nightProgressRemove: string[];
  /** One Role History Record per Actual Role mutation, in intent order (Live
   * Play only -- Setup records none). Perception produces none. */
  history: HistoryRecord[];
  /** The Actual Role mutations this plan makes, in intent order. */
  actualRoleChanges: { playerId: PlayerId; from: RoleId; to: RoleId; correction: boolean }[];
};

export type RolePlanResult =
  | { ok: true; changed: true; plan: RolePlan }
  | { ok: true; changed: false }
  | RoleRefusal;

/** Injectable identity generation: the planner never draws randomness itself. */
export type RoleIdSource = { historyId: () => string; packetEpoch: () => string };
export const defaultRoleIds: RoleIdSource = {
  historyId,
  packetEpoch: () => globalThis.crypto?.randomUUID?.() ?? `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
};

/** What the planner needs besides the game. `script` resolves Role types;
 * `ids` is required (never defaulted inside the module). */
export type RoleEnvironment = { script: Script | null | undefined; ids: RoleIdSource };

/** Table-wide bookkeeping at the participant cap without unbounded input. */
export const MAX_ROLE_INTENTS = MAX_TOTAL_PLAYERS * 3;
export const MAX_ROLE_ID_LENGTH = 200;
const MAX_RESOLUTION_ID_LENGTH = 200;

/** The complete, closed list of player fields a Role plan may patch. */
export const ROLE_PLAN_FIELDS = [
  "actualRole", "isTraveler", "abilityUsed", "shownRole", "shownAlignment", "behaviorMode",
  "publicDisplayRole", "privateInfo", "publishedPacket", "packetEpoch", "travelerArrival",
] as const;
type RolePlanField = (typeof ROLE_PLAN_FIELDS)[number];

// ---------------------------------------------------------------------------
// Plan application
// ---------------------------------------------------------------------------

/**
 * Applies an accepted plan: the one Current State + History replacement the
 * store commits. Pure -- returns a new snapshot and mutates nothing. Only the
 * planned fields of the planned participants change; everything else in
 * `game` (including Life/Effect/Reminder state a previous plan already
 * applied to it) is carried through untouched.
 */
export function applyRolePlan(
  game: StorytellerLobbyRecord,
  plan: Pick<RolePlan, "players" | "nightProgressRemove" | "history">,
): StorytellerLobbyRecord {
  const players = { ...game.players };
  for (const [playerId, patch] of Object.entries(plan.players)) {
    if (!Object.prototype.hasOwnProperty.call(game.players, playerId)) continue;
    const next: STPlayerRecord = { ...game.players[playerId]!, ...cloneOwned(patch.set) };
    for (const field of patch.remove) delete next[field];
    players[playerId] = next;
  }
  const nightProgress = plan.nightProgressRemove.length
    ? Object.fromEntries(Object.entries(game.nightProgress).filter(([key]) => !plan.nightProgressRemove.includes(key)))
    : game.nightProgress;
  return {
    ...game,
    players,
    nightProgress,
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
export function unknownRoleKey(value: Record<string, unknown>, allowed: ReadonlySet<string>): string | undefined {
  return Object.keys(value).find((key) => !allowed.has(key));
}

const TRANSACTION_KEYS = new Set(["intents", "context", "resolutionId"]);
const BINDING_KEYS = new Set(["playerId", "participantId"]);
const INTENT_KEYS: Record<RoleIntent["kind"], Set<string>> = {
  changeActualRole: new Set(["kind", "target", "expectedActualRole", "expectedIsTraveler", "actualRole"]),
  correctActualRole: new Set(["kind", "target", "expectedActualRole", "expectedIsTraveler", "actualRole", "travelerArrivalPolicy"]),
  setPerception: new Set(["kind", "target", "expectedShownRole", "expectedShownAlignment", "expectedBehaviorMode",
    "shownRole", "shownAlignment", "behaviorMode"]),
};
const isActualKind = (kind: RoleIntent["kind"]): boolean => kind === "changeActualRole" || kind === "correctActualRole";

const isShownAlignment = (value: unknown): value is ShownAlignment =>
  value === "good" || value === "evil" || value === "undisclosed";
const isRoleIdString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ROLE_ID_LENGTH;
const isBehaviorMode = (value: unknown): value is BehaviorMode => BehaviorModeSchema.safeParse(value).success;

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Plans one atomic Role transaction against `game`. Pure: reads `game` (any
 * valid snapshot -- including one a future coordinator already derived by
 * applying Life/Effect/Reminder plans), returns a plan, a true no-op or a
 * structured refusal; never mutates anything and never throws on malformed
 * caller input.
 */
export function planRoleTransaction(
  game: StorytellerLobbyRecord,
  transaction: RoleTransaction,
  environment: RoleEnvironment,
): RolePlanResult {
  const refuse = (code: RoleRefusalCode, message: string, intentIndex?: number): RoleRefusal =>
    ({ ok: false, code, message, ...(intentIndex !== undefined ? { intentIndex } : {}) });

  // --- Guards --------------------------------------------------------------
  // Ended games are frozen: nothing about Role or perception changes.
  if (game.phase === "ended") return refuse("phase", "This game has ended; its Roles are frozen.");
  // SOL-10E-A3 (ASTRA-10E-003, defense in depth): a Live Play Actual Role
  // mutation always carries its History, which needs a valid live Game
  // Moment. A Night/Day snapshot without one is malformed: refuse before any
  // id, patch or epoch.
  if (isLiveGamePhase(game.phase) && currentLiveMoment(game) === null) {
    return refuse("phase", "This game's live moment is invalid; nothing was changed.");
  }
  if (!isPlainObject(transaction)) return refuse("invalid", "Invalid Role transaction.");
  const unknownTransactionKey = unknownRoleKey(transaction as unknown as Record<string, unknown>, TRANSACTION_KEYS);
  if (unknownTransactionKey !== undefined) return refuse("invalid", `Unknown Role transaction field "${unknownTransactionKey}".`);
  if (!hasOwn(transaction, "intents") || !Array.isArray(transaction.intents)) return refuse("invalid", "Invalid Role transaction.");
  const intents = transaction.intents as readonly unknown[];
  if (intents.length === 0) return refuse("tooMany", "Nothing to change.");
  if (intents.length > MAX_ROLE_INTENTS) return refuse("tooMany", `At most ${MAX_ROLE_INTENTS} Role changes can be made at once.`);
  // Validated index by index (array helpers skip the holes of a sparse
  // array): every position 0 <= i < length must be an OWN element holding a
  // plain object whose `kind` is an OWN string naming a known intent -- an
  // inherited `kind` is never read. A failure is a structured refusal with
  // its index, never an exception.
  for (let index = 0; index < intents.length; index++) {
    const intent: unknown = hasOwn(intents, String(index)) ? intents[index] : undefined;
    if (!isPlainObject(intent) || !hasOwn(intent, "kind") || typeof intent.kind !== "string" || !hasOwn(INTENT_KEYS, intent.kind)) {
      return refuse("invalid", "Invalid Role change.", index);
    }
  }
  const list = intents as readonly RoleIntent[];
  const actualKinds = new Set(list.filter((intent) => isActualKind(intent.kind)).map((intent) => intent.kind));
  if (actualKinds.size > 1) return refuse("mixedCorrection", "A correction cannot be combined with an ordinary Role change.");
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

  const { script, ids } = environment;
  const setup = game.phase === "setup";
  const live = isLiveGamePhase(game.phase);
  const current = currentLiveMoment(game);
  const revealed = isInitialRevealComplete(game);

  // --- Working state -------------------------------------------------------
  /** The evolving working copy of each touched participant (never `game`'s). */
  const working = new Map<PlayerId, STPlayerRecord>();
  const workingOf = (player: STPlayerRecord): STPlayerRecord => working.get(player.id) ?? player;
  /** Participants whose Actual Role / Traveler status really changed: what was
   * prepared for the old Role is invalid (draft cleared, packet withdrawn, one
   * epoch minted at the end). Perception-derived invalidation is NOT tracked
   * per intent -- it is derived once, at the end, from the ORIGINAL versus the
   * FINAL perception (ASTRA-10D-002). */
  const invalidated = new Set<PlayerId>();
  /** Participants whose Traveler night-progress is cleared. */
  const clearProgress = new Set<PlayerId>();
  /** Travelers whose arrival is explicitly restarted WITHOUT a Role change. */
  const restarted = new Set<PlayerId>();
  /** At most ONE Actual Role intent per ParticipantId. */
  const actualClaimed = new Set<ParticipantId>();
  /** The last intent index that touched each participant (for refusals). */
  const lastTouch = new Map<PlayerId, number>();
  const changes: RolePlan["actualRoleChanges"] = [];
  const registry = buildRegistry(script ?? { id: game.scriptId, name: game.scriptId, characters: [] });

  type Refused = { refusal: RoleRefusal };
  const fail = (code: RoleRefusalCode, message: string): Refused => ({ refusal: refuse(code, message) });
  const isRefused = (value: unknown): value is Refused => isPlainObject(value) && "refusal" in value;

  /** Resolves a bound CURRENT participant. */
  const bind = (binding: unknown): STPlayerRecord | Refused => {
    if (!isPlainObject(binding)) return fail("invalid", "Choose the player.");
    if (unknownRoleKey(binding, BINDING_KEYS) !== undefined) return fail("invalid", "The player is named only by a bound current participant.");
    const expected = binding.participantId;
    if (typeof binding.playerId !== "string" || !binding.playerId) return fail("invalid", "Choose the player.");
    if (typeof expected !== "string" || !expected) return fail("invalid", "The player must be bound to a participant.");
    const player = ownPlayer(game, binding.playerId);
    if (!player) return fail("notSeated", "The player's seat does not exist.");
    if (player.isEmpty || !player.participantId) return fail("stale", "The player is no longer seated -- nothing was changed. Review and try again.");
    if (player.participantId !== expected) return fail("stale", "The seat now holds a different player -- nothing was changed. Review and try again.");
    if (!participantRefOf(game, player.id)) return fail("notSeated", "The player is not seated.");
    return player;
  };

  // --- Intents -------------------------------------------------------------
  for (let index = 0; index < list.length; index++) {
    const intent = list[index]!;
    const at = (refused: Refused): RoleRefusal => ({ ...refused.refusal, intentIndex: index });
    const extra = unknownRoleKey(intent as unknown as Record<string, unknown>, INTENT_KEYS[intent.kind]);
    if (extra !== undefined) return at(fail("invalid", `Unknown Role change field "${extra}".`));
    const bound = bind(intent.target);
    if (isRefused(bound)) return at(bound);
    const original = bound;
    const w = workingOf(original);
    lastTouch.set(original.id, index);

    if (intent.kind === "changeActualRole" || intent.kind === "correctActualRole") {
      const isCorrection = intent.kind === "correctActualRole";
      // Shape.
      if (typeof intent.expectedActualRole !== "string") return at(fail("invalid", "The observed Role must be given."));
      if (typeof intent.expectedIsTraveler !== "boolean") return at(fail("invalid", "The observed Traveler status must be given."));
      if (typeof intent.actualRole !== "string" || intent.actualRole.length > MAX_ROLE_ID_LENGTH) return at(fail("invalid", "Choose a Role."));
      let policy: TravelerArrivalPolicy = "preserve";
      if (intent.kind === "correctActualRole" && intent.travelerArrivalPolicy !== undefined) {
        if (intent.travelerArrivalPolicy !== "preserve" && intent.travelerArrivalPolicy !== "restart") {
          return at(fail("invalid", "A Traveler arrival policy is preserve or restart."));
        }
        policy = intent.travelerArrivalPolicy;
      }
      // One Actual Role transition/correction per ParticipantId per planner call.
      if (actualClaimed.has(original.participantId!)) {
        return at(fail("conflict", "A participant's Role can change only once in one resolution."));
      }
      actualClaimed.add(original.participantId!);
      // Stale-state guards: same participant, but the observed truth moved.
      if (w.actualRole !== intent.expectedActualRole || w.isTraveler !== intent.expectedIsTraveler) {
        return at(fail("stale", "This player's Role changed -- nothing was changed. Review and try again."));
      }
      // Destination.
      const destination = intent.actualRole;
      let toTraveler: boolean;
      if (destination === "") {
        // Only a Traveler may be (re)opened as "unassigned"; an ordinary
        // participant is never made Role-empty, and never by a gameplay change.
        if (isCorrection && w.isTraveler) toTraveler = true;
        else return at(fail("role", isCorrection
          ? "Only a Traveler's character can be reopened as unassigned."
          : "A Role change needs a character; use a correction to reopen a Traveler's unassigned character."));
      } else {
        const cls = classifyRole(script, destination);
        if (cls.kind === "refused") return at(fail("role", "That is not a character this player can have on this script."));
        toTraveler = cls.kind === "traveler";
      }
      // Setup: ordinary-vs-Traveler status is a Setup command (before Reveal)
      // and locked afterward; after the initial Reveal a GAMEPLAY change is
      // refused (only assigning an unassigned Traveler's character is allowed).
      if (setup) {
        if (toTraveler !== w.isTraveler) return at(fail("phase", "Traveler status is set up through Setup, not through a Role change."));
        if (!isCorrection && revealed && !(w.isTraveler && w.actualRole === "")) {
          return at(fail("phase", "Roles are revealed. Correct the starting assignment instead, or begin Night 1."));
        }
      }
      if (destination === w.actualRole && toTraveler === w.isTraveler) {
        // Same Actual Role under the same status. An explicit Traveler arrival
        // `restart` is still a real correction of the arrival WORKFLOW: it
        // reinitializes travelerArrival and clears only this Traveler's
        // arrival/role night steps. It changes nothing about the Role itself
        // (no packet withdrawal, no epoch, no Role History value record,
        // abilityUsed / alignment / perception untouched). Otherwise -- or when
        // the arrival is already initial with no step to clear -- it is a TRUE
        // no-op (the finalizer drops it as net-zero).
        if (isCorrection && policy === "restart" && w.isTraveler && destination !== "") {
          working.set(original.id, { ...w, travelerArrival: newTravelerArrival() });
          clearProgress.add(original.id);
          restarted.add(original.id);
        }
        continue;
      }

      const next: STPlayerRecord = { ...w, actualRole: destination, isTraveler: toTraveler };
      // A real change invalidates what was prepared for the old Role.
      delete next.privateInfo;
      delete next.publishedPacket;
      invalidated.add(original.id);
      if (!isCorrection) next.abilityUsed = false;
      if (toTraveler) {
        // Traveler character is public: Actual / Shown / public stay together.
        next.shownRole = destination || null;
        next.publicDisplayRole = destination || null;
        // Phase 10E (PHASE10E.md 26, semantic question 1): a Traveler ->
        // Traveler change/correction PRESERVES the independent player-facing
        // alignment perception (Normal / Good / Evil / Not told); only an
        // ordinary -> Traveler change starts at Normal (a perception intent
        // later in the same resolution may set another value).
        if (!w.isTraveler) next.shownAlignment = null;
        next.behaviorMode = "normal";
        if (!isCorrection || policy === "restart") {
          next.travelerArrival = newTravelerArrival();
          clearProgress.add(original.id);
        }
      } else if (w.isTraveler) {
        // Traveler -> ordinary: the public character and arrival go away. The
        // Shown Role is NOT invented -- see the final perception check.
        next.publicDisplayRole = null;
        delete next.travelerArrival;
        clearProgress.add(original.id);
      }
      working.set(original.id, next);
      changes.push({ playerId: original.id, from: w.actualRole, to: destination, correction: isCorrection });
      continue;
    }

    // --- setPerception ----------------------------------------------------
    const p = intent;
    if (p.expectedShownRole !== null && !isRoleIdString(p.expectedShownRole)) return at(fail("invalid", "The observed Shown Role must be given."));
    if (p.expectedShownAlignment !== null && !isShownAlignment(p.expectedShownAlignment)) return at(fail("invalid", "The observed Shown Alignment must be given."));
    if (p.shownRole !== null && !isRoleIdString(p.shownRole)) return at(fail("invalid", "Choose what to show."));
    if (p.shownAlignment !== null && !isShownAlignment(p.shownAlignment)) return at(fail("invalid", "Shown Alignment is Normal (null), good, evil or undisclosed."));
    const changingMode = p.behaviorMode !== undefined;
    if (changingMode && !isBehaviorMode(p.behaviorMode)) return at(fail("invalid", "Invalid behavior mode."));
    if (changingMode !== (p.expectedBehaviorMode !== undefined)) {
      return at(fail("invalid", "The observed behavior mode goes with a behavior mode change, and only then."));
    }
    if (changingMode && !isBehaviorMode(p.expectedBehaviorMode)) return at(fail("invalid", "Invalid observed behavior mode."));
    // Expected-state guards for every field being overwritten.
    if (w.shownRole !== p.expectedShownRole || w.shownAlignment !== p.expectedShownAlignment ||
      (changingMode && w.behaviorMode !== p.expectedBehaviorMode)) {
      return at(fail("stale", "This player's shown identity changed -- nothing was changed. Review and try again."));
    }
    // Ordinary perception is explicit; a Traveler's public character is not a
    // choice (Actual / Shown / public character stay together). Phase 10E: a
    // Traveler's player-facing alignment is honored by their own projection --
    // Normal (null) follows their Actual Alignment, an explicit good / evil /
    // undisclosed overrides it (see projectIdentity).
    if (w.isTraveler) {
      if (p.shownRole !== (w.actualRole || null)) {
        return at(fail("perception", "A Traveler's character is public and is shown as themself."));
      }
    } else {
      if (p.shownRole !== null && classifyRole(script, p.shownRole).kind !== "ordinary") {
        return at(fail("perception", "A player can only be shown a Townsfolk, Outsider, Minion or Demon of this script."));
      }
      if (p.shownRole === null && p.shownAlignment !== null) {
        return at(fail("perception", "Choose a character to show before choosing its alignment."));
      }
    }
    const nextMode = changingMode ? p.behaviorMode! : w.behaviorMode;
    // Identical bundle: a TRUE no-op (nothing cleared, withdrawn or recorded).
    if (p.shownRole === w.shownRole && p.shownAlignment === w.shownAlignment && nextMode === w.behaviorMode) continue;
    // Only the perception itself moves here. What a perception change
    // invalidates (draft, published packet, epoch) is decided once, at the end,
    // from the ORIGINAL versus the FINAL perception: an intermediate perception
    // a later intent reverts invalidates nothing.
    working.set(original.id, { ...w, shownRole: p.shownRole, shownAlignment: p.shownAlignment, behaviorMode: nextMode });
  }

  // --- Final perception check ------------------------------------------------
  // A non-Traveler never ends with a Traveler, Fabled, Loric, off-script or
  // unknown Shown Role. This is what makes a Traveler -> ordinary change need
  // an explicit setPerception in the same resolution -- the primitive never
  // invents an ordinary perception.
  for (const [playerId, w] of working) {
    if (w.isTraveler || w.shownRole === null) continue;
    if (classifyRole(script, w.shownRole).kind !== "ordinary") {
      return refuse("perception", "This player must be shown a Townsfolk, Outsider, Minion or Demon of this script -- choose what they are shown in the same change.", lastTouch.get(playerId));
    }
  }

  // --- Finalize --------------------------------------------------------------
  const players: Record<PlayerId, RolePlayerPatch> = {};
  const finalOf = new Map<PlayerId, STPlayerRecord>();
  for (const [playerId, planned] of working) {
    const original = ownPlayer(game, playerId)!;
    let w = planned;
    // Perception invalidation is a function of the ORIGINAL versus the FINAL
    // semantic perception only (ASTRA-10D-002): a round trip (Chef -> Librarian
    // -> Chef) deletes, prunes, withdraws and mints nothing. A real change is
    // applied exactly once, against the final record: the published packet is
    // withdrawn; a changed Shown Role clears the draft, otherwise only what the
    // final perception makes inapplicable is pruned. A real Actual Role /
    // Traveler-status change already invalidated everything for the old Role
    // (see the change branch) whatever the perception does.
    const perceptionChanged = original.shownRole !== w.shownRole || original.shownAlignment !== w.shownAlignment ||
      original.behaviorMode !== w.behaviorMode;
    if (perceptionChanged && !invalidated.has(playerId)) {
      w = { ...w };
      delete w.publishedPacket;
      if (original.shownRole !== w.shownRole) delete w.privateInfo;
      else w = pruneInapplicablePrivateInfo(w, registry);
    }
    const differs = ROLE_PLAN_FIELDS.some((field) => field !== "packetEpoch" && !sameSnapshot(original[field], w[field]));
    if (!differs) continue; // net-zero for this participant: nothing to patch
    // The packet epoch is minted once, only for a participant whose Role or
    // perception assumptions differ at the END -- never for an intermediate
    // state, and never merely because another field (e.g. an explicit Traveler
    // arrival restart) changed.
    const final: STPlayerRecord = invalidated.has(playerId) || perceptionChanged ? { ...w, packetEpoch: ids.packetEpoch() } : w;
    finalOf.set(playerId, final);
    const patch: RolePlayerPatch = { set: {}, remove: [] };
    for (const field of ROLE_PLAN_FIELDS as readonly RolePlanField[]) {
      if (sameSnapshot(original[field], final[field])) continue;
      if (final[field] === undefined) {
        if (field === "privateInfo" || field === "publishedPacket" || field === "travelerArrival") patch.remove.push(field);
      } else {
        (patch.set as Record<string, unknown>)[field] = cloneOwned(final[field]);
      }
    }
    players[playerId] = patch;
  }
  const nightProgressRemove: string[] = [];
  for (const playerId of clearProgress) {
    if (!finalOf.has(playerId) && !restarted.has(playerId)) continue;
    // Phase 10F (v24): tonight's arrival / guided-wake steps are keyed by the
    // participation instance (src/stores/nightProgress.ts), never the seat.
    const participantId = game.players[playerId]?.participantId;
    if (!participantId) continue;
    for (const key of Object.keys(game.nightProgress)) {
      if (isParticipantRoleStepEntry(key, game.day, participantId)) {
        if (!nightProgressRemove.includes(key)) nightProgressRemove.push(key);
      }
    }
  }

  // True no-op: no Current State change (no patch, no step to clear) and no
  // History.
  if (Object.keys(players).length === 0 && nightProgressRemove.length === 0) return { ok: true, changed: false };

  // History explains COMMITTED Actual Role mutations only (Live Play);
  // perception and Setup record none.
  const history: HistoryRecord[] = [];
  const actualRoleChanges = changes.filter(({ playerId, from, to }) => finalOf.has(playerId) && from !== to);
  if (live && current) {
    for (const change of actualRoleChanges) {
      const participant = participantRefOf(game, change.playerId);
      if (!participant) return refuse("notSeated", "The player is not seated.");
      history.push(cloneOwned({
        id: ids.historyId(),
        category: "role" as const,
        participant,
        moment: { ...current },
        change: { kind: "value" as const, from: { actualRole: change.from }, to: { actualRole: change.to } },
        ...(change.correction ? { correction: true as const } : {}),
        ...(resolutionId ? { resolutionId } : {}),
        ...(provenance ? { provenance } : {}),
      }));
    }
  }
  return { ok: true, changed: true, plan: { players, nightProgressRemove, history, actualRoleChanges } };
}

// ---------------------------------------------------------------------------
// Caller helpers: build intents from the record the caller RENDERED, so the
// bound participant and observed state are exactly what the Storyteller saw.
// ---------------------------------------------------------------------------

const bindingOf = (player: Pick<STPlayerRecord, "id" | "participantId">): RoleParticipantBinding =>
  ({ playerId: player.id, participantId: player.participantId ?? "" });

/** A gameplay Actual Role change of `player` (as rendered) to `actualRole`. */
export function changeRoleIntent(player: STPlayerRecord, actualRole: RoleId): ChangeActualRoleIntent {
  return { kind: "changeActualRole", target: bindingOf(player), expectedActualRole: player.actualRole,
    expectedIsTraveler: player.isTraveler, actualRole };
}

/** A correction of `player`'s (as rendered) recorded Actual Role. */
export function correctRoleIntent(
  player: STPlayerRecord,
  actualRole: RoleId,
  travelerArrivalPolicy?: TravelerArrivalPolicy,
): CorrectActualRoleIntent {
  return { kind: "correctActualRole", target: bindingOf(player), expectedActualRole: player.actualRole,
    expectedIsTraveler: player.isTraveler, actualRole, ...(travelerArrivalPolicy ? { travelerArrivalPolicy } : {}) };
}

/** An explicit perception change of `player` (as rendered). `behaviorMode`
 * is included only when given. */
export function setPerceptionIntent(
  player: STPlayerRecord,
  perception: { shownRole: RoleId | null; shownAlignment: ShownAlignment | null; behaviorMode?: BehaviorMode },
): SetPerceptionIntent {
  return {
    kind: "setPerception", target: bindingOf(player),
    expectedShownRole: player.shownRole, expectedShownAlignment: player.shownAlignment,
    ...(perception.behaviorMode !== undefined ? { expectedBehaviorMode: player.behaviorMode, behaviorMode: perception.behaviorMode } : {}),
    shownRole: perception.shownRole, shownAlignment: perception.shownAlignment,
  };
}

/** Phase 10F Slice 7: a gameplay Actual Role change of `player` (as rendered)
 * that the player is TOLD about -- the Actual Role change followed by the
 * matching Shown Role in the same Role transaction (one Actual Role intent plus
 * its perception, as the seam allows), keeping the player-facing alignment
 * exactly as it is (alignment never changes merely because a character does).
 * Only for a participant whose perception is ordinary; callers decide that. */
export function toldRoleChangeIntents(player: STPlayerRecord, actualRole: RoleId): [ChangeActualRoleIntent, SetPerceptionIntent] {
  return [changeRoleIntent(player, actualRole), setPerceptionIntent(player, { shownRole: actualRole, shownAlignment: player.shownAlignment })];
}

/** Phase 10E: a player-facing alignment change of `player` (as rendered) --
 * Normal (null), Shown Good, Shown Evil or Not told (undisclosed) -- keeping
 * the rendered Shown Role. One setPerception bundle. */
export function shownAlignmentIntent(player: STPlayerRecord, shownAlignment: ShownAlignment | null): SetPerceptionIntent {
  return setPerceptionIntent(player, { shownRole: player.shownRole, shownAlignment });
}
