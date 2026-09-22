import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { BUILTIN_SCRIPTS, BUILTIN_SCRIPT_IDS } from "@/data/scripts";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { StorytellerStateSchema } from "./schemas";
import { buildRegistry, type RoleRegistry } from "@/data/roleRegistry";
import { dealtIdentity, isInitialRevealComplete, needsShownIdentity } from "./identity";
import { currentGameMoment, manualEffectId } from "./effects";
import { cloneOwned, diffFields, type MutationContext, provenanceOf, recordIfLive, sameSnapshot } from "./history";
import { migrateGameEntry } from "./gameMigration";
import {
  informationDeliveryId,
  parseInformationValues,
  validateInformationTiming,
  validateInformationValues,
  validateRequirementsCoherent,
} from "./informationDelivery";
import { initialRevealReadiness } from "@/features/setup/revealReadiness";
import { invalidatePrivatePacket, pruneInapplicablePrivateInfo } from "./privatePackets";
import { usePrivacyStore } from "./privacyStore";
import { analyzeSetup } from "@/features/setup/setupAnalyzer";
import { isPostDeal, selectSetupContext } from "@/features/setup/setupContext";
import { assignedBagIsCoherent, canRefineSetup, matchBagToAssignments } from "@/features/setup/setupRefinement";
import { isBagType } from "@/features/setup/setupPolicies";
import { arrivalsAreTravelers, newTravelerArrival, publicTravelerRole, travelerDemonInformation, travelerNeedsFirstNight, travelerNeedsArrivalCheck } from "./travelers";
import { getTraveler } from "@/data/travelers";
import { MAX_PLAYERS, MAX_TOTAL_PLAYERS, MIN_PLAYERS } from "@/data/setupCounts";
import type { SetupCommandResult } from "@/features/setup/setupReadiness";
import type {
  Alignment,
  BehaviorMode,
  EffectId,
  EffectRecord,
  GrimoireMode,
  GuardStamp,
  InformationActionId,
  InformationDeliveryId,
  InformationDeliveryRecord,
  InformationValue,
  NightStepRecord,
  NightStepStatus,
  PlayerId,
  ReminderId,
  ReminderRecord,
  RoleId,
  Script,
  STPlayerRecord,
  StorytellerLobbyRecord,
  SyncMeta,
  TokenPosition,
} from "./types";

const UNDO_LIMIT = 20;

/** The persisted store's current schema version — also the single source
 * `merge` (Phase 9C.2B.2) passes to migrateStoreState when Zustand's own
 * persist middleware skips calling `migrate` outright, which it does
 * whenever the persisted version already equals this one. */
const STORE_VERSION = 16;

let _migrationResetFlag = false;
/** Returns true (once) when migrate() discarded incompatible persisted state. */
export function takeMigrationResetFlag(): boolean {
  const v = _migrationResetFlag;
  _migrationResetFlag = false;
  return v;
}

const newId = (): PlayerId =>
  globalThis.crypto?.randomUUID?.() ?? `p-${Math.random().toString(36).slice(2, 10)}`;

const blankPlayer = (id: PlayerId, name: string, seat: number, isEmpty = false): STPlayerRecord => ({
  id,
  name,
  seat,
  joinedAt: Date.now(),
  actualRole: "",
  shownRole: null,
  shownAlignment: null,
  behaviorMode: "normal",
  publicDisplayRole: null,
  alive: true,
  ghostVote: true,
  abilityUsed: false,
  statuses: {},
  reminders: [],
  effects: [],
  stNotes: "",
  isTraveler: false,
  isEmpty,
});

// Used only when creating an arrival or filling an empty seat. A planned
// ordinary identity must not become a late arrival's identity.
//
// FINAL POPULATION CLOSURE, Section 5: whether this arrival/fill must be a
// Traveler is decided here, atomically, against the game state as it stood
// before this seat was touched -- never re-derived afterward from
// occupancy counts the fill itself just changed (that reintroduced the
// exact timing bug this section closes: filling a seat could silently push
// occupied-ordinary to the cap and then have a *later* recheck of
// arrivalsAreTravelers() spuriously suppress an explicit Traveler request).
// plannedTravelerSeat -- a planned Traveler reservation on an empty seat --
// is an equally authoritative trigger alongside the arrival-cap policy;
// blankPlayer() below never carries the marker forward, so occupying a
// reserved seat always fulfills and clears it in the same step.
const arrivalPlayer = (player: STPlayerRecord, game: StorytellerLobbyRecord): STPlayerRecord =>
  (arrivalsAreTravelers(game) || player.plannedTravelerSeat) && !player.isTraveler
    ? { ...blankPlayer(player.id, player.name, player.seat, player.isEmpty), isTraveler: true, travelerArrival: newTravelerArrival() }
    : player;

const clone = <T,>(v: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v));

/**
 * FINAL SEAT & TRAVELLER RESERVATION CLOSURE, Section 2: every command that
 * creates new starting capacity before Reveal must refuse atomically -- no
 * seat, no player, no plan increment -- once EITHER the plan or physical
 * seats are already at the supported cap. Checking only plannedPlayerCount
 * left a bypass whenever the two had already diverged (e.g. legacy/
 * adversarial state, or a plan reduced independently of physical seats);
 * checking both closes it regardless of how they diverged.
 */
const atCapacity = (game: StorytellerLobbyRecord): boolean =>
  !isInitialRevealComplete(game) &&
  (game.plannedPlayerCount >= MAX_TOTAL_PLAYERS || game.seatOrder.length >= MAX_TOTAL_PLAYERS);

export type AddScriptResult = { ok: true } | { ok: false; error: string };

/** Phase 9D.3: result of the Authoritative Information command. Mirrors
 * the codebase's existing {ok:true}|{ok:false,message} command-result
 * shape (e.g. SetupCommandResult) rather than a bare id/null, since
 * structural validation has several distinct rejection reasons a caller
 * should be able to surface. */
export type RecordInformationDeliveryResult =
  | { ok: true; id: InformationDeliveryId }
  | { ok: false; message: string };

export type LobbyConnection = {
  code: string;
  uid: string;
  sessionId?: string;
  status: "live" | "reconnecting";
};

export type NewGameOpts = {
  plannedPlayerCount?: number;
  /** Intended Traveler count out of plannedPlayerCount. Never derives the
   * bag from total participants -- see setupContext's targetNonTravelerCount. */
  plannedTravelerCount?: number;
  plannedRoles?: RoleId[];
  plannedFabled?: RoleId[];
  plannedLorics?: RoleId[];
};

export type StorytellerStore = {
  game: StorytellerLobbyRecord | null;
  view: "home" | "game" | "newgame";
  undoStack: StorytellerLobbyRecord[];
  selectedPlayerId: PlayerId | null;
  customScripts: Record<string, Script>;
  lobby: LobbyConnection | null;
  // ephemeral — knocks the ST has not yet processed
  pendingKnocks: { uid: string; name: string }[];
  // grimoire layout (localStorage-only, never Firebase-synced)
  grimoireMode: GrimoireMode;
  tokenPositions: Record<PlayerId, TokenPosition>;

  // --- Phase 9C.2A (OPUS-001) reconnect/acknowledgement watermarks -------
  /** Local game-content mutation counter. Increases exactly once per game
   * mutation that should eventually be represented by a projection/
   * checkpoint (see the central bumping `set` wrapper below). Never
   * wall-clock; never advances for UI-only/local-layout state. */
  localSeq: number;
  /** Persisted reconnect metadata scoped to the current (code, sessionId).
   * Null means "no evidence" — a legacy v11 store, or no scope established
   * yet. See src/firebase/reconnectDecision.ts. */
  sync: SyncMeta | null;

  newGame: (scriptId: string, opts?: NewGameOpts) => void;
  dealRolePool: () => SetupCommandResult;
  /** Explicitly publishes the private Deal to players. Never required to be
   * online: a local/offline game still records that the Storyteller
   * completed the initial reveal step. See revealReadiness.ts. */
  revealRoles: () => SetupCommandResult;
  // --- Pre-Reveal Setup refinement (Phase 9 Setup finalization B3) -------
  // Administration of the private Deal only — available strictly between a
  // completed initial Deal and a completed initial Reveal (see
  // canRefineSetup in features/setup/setupRefinement.ts). Distinct from the
  // generic assignRole()/setShownRole(), which remain unchanged and keep
  // serving later in-game character-change mechanics.
  /** Fresh random redistribution of the current ordinary dealt bag across
   * occupied ordinary players. Same characters, new assignment. */
  shuffleSetupRoles: () => SetupCommandResult;
  /** Exchanges the private role assignments of exactly two occupied,
   * non-Traveler ordinary players. Composition-neutral. */
  swapSetupRoles: (playerIdA: PlayerId, playerIdB: PlayerId) => SetupCommandResult;
  /** Changes exactly one ordinary player's actual role to a fresh
   * assignment, without touching any other player. May leave the setup
   * composition-invalid — that is preserved as explicit Storyteller intent
   * and surfaced by the analyzer rather than silently corrected. */
  replaceSetupRole: (playerId: PlayerId, roleId: RoleId) => SetupCommandResult;
  /** Applies a fully-staged edited bag (exactly one role per occupied
   * ordinary seat). Preserves every existing assignment whose role
   * occurrence survives in the new bag; only seats whose occurrence was
   * removed are reassigned, deterministically, to the newly added
   * occurrences. Never a full reshuffle. */
  applyEditedBag: (stagedRoleIds: RoleId[]) => SetupCommandResult;
  beginNightOne: () => SetupCommandResult;
  setPlannedPlayerCount: (count: number) => void;
  setRolePool: (roles: RoleId[]) => void;
  endGame: () => void;
  setView: (view: "home" | "game" | "newgame") => void;
  selectPlayer: (id: PlayerId | null) => void;
  addCustomScript: (script: Script) => AddScriptResult;
  removeCustomScript: (id: string) => void;
  setLobby: (lobby: LobbyConnection | null) => void;
  setLobbyStatus: (status: LobbyConnection["status"]) => void;
  setPendingKnocks: (knocks: { uid: string; name: string }[]) => void;
  seatPlayerFromKnock: (uid: string, name: string) => PlayerId | null;
  bindRosterUid: (uid: string, playerId: PlayerId) => void;
  addToPendingQueue: (uid: string, name: string) => void;
  assignPendingToSeat: (uid: string, seatPlayerId: PlayerId) => boolean;
  removePendingPlayer: (uid: string) => void;

  addPlayer: (name: string) => void;
  /** Fill the first planned empty seat, falling back to a new seat when none exist. */
  addPlayerToSeat: (name: string) => void;
  /** Add one deliberate empty planned seat. */
  addEmptySeat: () => void;
  /** Add planned Traveler capacity: an ordinary-neutral empty seat plus the
   * matching plan growth (Phase 9 Setup finalization, Section 3.E). Never
   * pre-flags the seat itself isTraveler -- actual designation happens
   * through setIsTraveler once a real player occupies it. */
  addTravelerSeat: () => void;
  /** Remove a player and its seat locally. Membership is revoked by the command layer first. */
  removePlayer: (id: PlayerId) => boolean;
  /** Turn a seated player into an empty seat locally. Membership is revoked first. */
  unseatPlayer: (id: PlayerId) => boolean;
  renamePlayer: (id: PlayerId, name: string) => void;
  setSeatOrder: (order: PlayerId[]) => void;
  movePlayer: (id: PlayerId, direction: "left" | "right") => void;

  /** Phase 9D.2 closure: an optional Mutation Context lets a caller supply
   * Provenance for the History Record this produces during Live Play,
   * through this exact same command -- never a second call. */
  assignRole: (id: PlayerId, roleId: RoleId | "", context?: MutationContext) => void;
  showAssignedRole: (id: PlayerId) => void;
  setShownRole: (id: PlayerId, roleId: RoleId | null) => void;
  setShownAlignment: (id: PlayerId, alignment: Alignment | null) => void;
  setBehaviorMode: (id: PlayerId, mode: BehaviorMode) => void;
  setBluffs: (id: PlayerId, bluffs: RoleId[]) => void;
  setFakeMinions: (id: PlayerId, playerIds: PlayerId[]) => void;
  setPrivateText: (id: PlayerId, text: string) => void;
  /** Explicit ordinary<->Traveler conversion for an occupied seat (Phase 9
   * Setup finalization B4, revised). Converting ordinary->Traveler is
   * refused if it would drop occupied ordinary players below MIN_PLAYERS;
   * converting Traveler->ordinary is refused if it would raise occupied
   * ordinary players above MAX_PLAYERS. On success, plannedTravelerCount
   * (and therefore the ordinary composition target) immediately snaps to
   * match the new occupancy -- no separate planned-vs-seated reconciliation
   * action is ever required. Never restarts the game or lobby, and never
   * touches any other player's role. */
  setIsTraveler: (id: PlayerId, isTraveler: boolean) => SetupCommandResult;
  /** Optional Mutation Context (Phase 9D.2 closure) -- see assignRole. */
  setTravelerAlignment: (id: PlayerId, alignment: Alignment, context?: MutationContext) => void;
  /** Phase 9D.1: the single safe generic command for intentionally
   * changing any player's current actual alignment (ordinary or
   * Traveler). Never inferred, never called automatically. Optional
   * Mutation Context (Phase 9D.2 closure) -- see assignRole. */
  setActualAlignment: (id: PlayerId, alignment: Alignment, context?: MutationContext) => void;
  prepareTravelerDemon: (id: PlayerId) => void;
  completeTravelerInformation: (id: PlayerId) => void;
  completeTravelerArrivalCheck: (id: PlayerId) => void;
  exileTraveler: (id: PlayerId) => void;
  setFabled: (fabled: RoleId[]) => void;
  setLorics: (lorics: RoleId[]) => void;

  /** Optional Mutation Context (Phase 9D.2 closure) -- see assignRole. */
  setAlive: (id: PlayerId, alive: boolean, context?: MutationContext) => void;
  setGhostVote: (id: PlayerId, ghostVote: boolean, context?: MutationContext) => void;
  setAbilityUsed: (id: PlayerId, used: boolean) => void;
  setStatus: (id: PlayerId, status: string, on: boolean) => void;
  /** Phase 9D.1: centralized structured-effect commands. `addEffect`
   * upserts by id (a fresh id is allocated when none is given) and
   * returns the id actually used, or null if the player doesn't exist. */
  addEffect: (id: PlayerId, effect: Partial<Pick<EffectRecord, "id">> & Omit<EffectRecord, "id">) => EffectId | null;
  removeEffect: (id: PlayerId, effectId: EffectId) => void;
  setReminders: (id: PlayerId, reminders: ReminderRecord[]) => void;
  /** Phase 9D.1: centralized structured-reminder commands, backing the
   * existing per-token Storyteller reminder workflow. */
  addReminder: (id: PlayerId, reminder: Partial<Pick<ReminderRecord, "id">> & Omit<ReminderRecord, "id">) => ReminderId | null;
  removeReminder: (id: PlayerId, reminderId: ReminderId) => void;
  /** Phase 9D.3: the single Authoritative Information command. Resolves
   * the Recipient's Actual Role and its Information Actions from Role
   * data (never a Role-id branch), structurally validates the supplied
   * Information Values against that Action's Information Requirements,
   * and -- only if valid -- creates exactly one Information Delivery
   * Record snapshotting the Actual Role, Game Moment, and values.
   * Structurally valid Storyteller-provided information is always stored
   * as given; this never recalculates or rejects it based on Current
   * State. */
  recordInformationDelivery: (
    recipientPlayerId: PlayerId,
    informationActionId: InformationActionId,
    values: InformationValue[],
    context?: MutationContext
  ) => RecordInformationDeliveryResult;
  /** Phase 9D.3: removes exactly one Information Delivery Record. A
   * correction is remove-then-recordInformationDelivery again; this never
   * touches unrelated Current State. */
  removeInformationDelivery: (deliveryId: InformationDeliveryId) => void;
  setNotes: (id: PlayerId, notes: string) => void;

  setPhase: (phase: StorytellerLobbyRecord["phase"]) => SetupCommandResult;
  advancePhase: () => SetupCommandResult;

  setNightStepStatus: (day: number, stepKey: string, status: NightStepStatus) => void;
  setNightStepNotes: (day: number, stepKey: string, notes: string) => void;
  clearNightProgress: (day: number) => void;

  undo: () => void;

  setGrimoireMode: (mode: GrimoireMode) => void;
  setTokenPosition: (id: PlayerId, x: number, y: number) => void;
  clearTokenPositions: () => void;

  // --- Phase 9C.2A (OPUS-001) reconnect/acknowledgement plumbing ---------
  /** Establish (or preserve) sync metadata for exactly this scope. A no-op
   * when `sync` already matches (code, sessionId) — creating a replacement
   * SessionWriter must never overwrite unresolved `lastAttempt` evidence
   * for the same scope. Only replaces `sync` outright on a genuine scope
   * change (a different lobby/session than what's currently tracked). */
  ensureSyncScope: (code: string, sessionId: string) => void;
  /** Record that a writer commit was attempted with this exact
   * token/revision pair, for this scope. Does not touch `game` — writer
   * attempts are not game-content mutations. */
  noteWriterAttempt: (code: string, sessionId: string, guard: GuardStamp) => void;
  /** Record that a writer commit genuinely succeeded while the writer
   * remained active, for this scope. Advances `ackedGuard` and reconciles
   * a matching `lastAttempt`. Also used to promote the accepted guard when
   * reconnect recognizes a lost acknowledgement. Does not touch `game`. */
  noteWriterAck: (code: string, sessionId: string, guard: GuardStamp) => void;
  /** Advance `ackedGameSeq` to exactly `seqAtFlush` — the localSeq value
   * captured at the same moment the flushed game snapshot was captured —
   * once that specific projection flush has genuinely succeeded while the
   * writer remained active. Never advances past what was actually
   * acknowledged, and never regresses. Does not touch `game`. */
  acknowledgeGameFlush: (code: string, sessionId: string, seqAtFlush: number) => void;
  /** Durably promotes a recognized lost acknowledgement (Finding B1) to
   * accepted baseline state. Reconnect can recognize, from `lastAttempt`
   * alone, that a commit genuinely landed on the server but was never
   * acknowledged locally — but until THIS is called, that fact survives
   * only as `lastAttempt`, which any later writer attempt is free to
   * overwrite before the recovery is durable. Call synchronously, with no
   * await in between, right after recognizing the recovery and before any
   * further await that could let another writer attempt allocate a new
   * revision (see storytellerSync.ts's reconnect call site).
   *
   * Verifies scope; verifies `lastAttempt` exactly equals `guard` (else a
   * no-op — never promotes a mismatched or already-superseded attempt);
   * never lowers `ackedGuard.revision`; sets `ackedGuard = guard`; clears
   * `lastAttempt`. Deliberately never touches `ackedGameSeq`: the recovered
   * commit could equally have been a projection flush or a membership-only
   * write, and without durable seq-to-guard evidence distinguishing those,
   * only under-reporting local dirtiness would be safe to skip — so this
   * never advances it. Over-reporting dirty state is acceptable; falsely
   * reporting clean is not. */
  promoteRecoveredAck: (code: string, sessionId: string, guard: GuardStamp) => void;
  /** Atomically replace `game` with a validated remote checkpoint, clear
   * undo (because remote state was deliberately accepted), and make the
   * restored game clean with respect to the current local sequence by
   * setting `ackedGameSeq` to it and `ackedGuard` to the newly accepted
   * remote guard (null only in the legacy/no-writeGuard-yet edge case).
   * Also clears `lastAttempt` unconditionally (Luna review, Finding 1):
   * once a remote checkpoint has been deliberately accepted — explicitly
   * or automatically — any unresolved attempt evidence from the prior
   * local lineage is no longer meaningful and must not survive to be
   * mistaken for a lost acknowledgement against a later, different remote
   * guard (including one that represents a genuine server rewind relative
   * to the newly accepted baseline). This one replacement is deliberately
   * exempt from the general "a `game` change bumps localSeq" rule:
   * adopting remote content is the opposite of new local intent. */
  restoreRemoteCheckpoint: (game: StorytellerLobbyRecord, guard: GuardStamp | null) => void;
};

// Phase 9D.5 fix: an unresolved actualAlignment is `undefined`, never a
// concrete value -- History must record that absence as an absent key
// (matching the "absence means unresolved" convention actualAlignment
// already uses everywhere else), never as an explicit `undefined`-valued
// property. The two are equivalent under JSON (localStorage, the
// stringified remote checkpoint), but a literal `undefined` property
// reaches the Firebase Realtime Database client raw (writeProjections'
// un-stringified `storyteller` path) and that client rejects it outright,
// so recording a Traveler's or ordinary player's very first alignment
// while live-synced would fail this write with no history ever landing.
const alignmentHistoryValue = (value: Alignment | undefined): Record<string, unknown> =>
  value === undefined ? {} : { actualAlignment: value };

const pushUndo = (
  game: StorytellerLobbyRecord | null,
  stack: StorytellerLobbyRecord[]
): StorytellerLobbyRecord[] => {
  if (!game) return stack;
  const next = [...stack, clone(game)];
  if (next.length > UNDO_LIMIT) next.shift();
  return next;
};

const patchPlayer = (
  game: StorytellerLobbyRecord,
  id: PlayerId,
  patch: Partial<STPlayerRecord>
): StorytellerLobbyRecord => {
  const existing = game.players[id];
  if (!existing) return game;
  return {
    ...game,
    players: {
      ...game.players,
      [id]: { ...existing, ...patch },
    },
  };
};

/**
 * A fresh private assignment for `role`: the same reset dealRolePool()
 * performs per seat. Deceptive configuration from a previous assignment
 * must never follow a player into an unrelated new one — normal roles get
 * their deterministic shown identity, concealed roles become unresolved,
 * role-specific private info/packets are cleared. Shared by Deal and every
 * pre-Reveal Setup refinement command (Shuffle/Swap/Manual Override/Edit
 * Bag Apply) so this reset has exactly one implementation.
 */
const freshAssignment = (existing: STPlayerRecord, role: RoleId, registry: RoleRegistry): STPlayerRecord => {
  const next: STPlayerRecord = { ...existing, ...dealtIdentity(role, registry), abilityUsed: false };
  delete next.privateInfo;
  return invalidatePrivatePacket(next);
};

const CLEAN_STATE = { game: null, view: "home" as const, undoStack: [] as never[], customScripts: {}, lobby: null };

const resetTravelerNightProgress = (game: StorytellerLobbyRecord, id: PlayerId) =>
  Object.fromEntries(Object.entries(game.nightProgress).filter(([key]) =>
    !key.startsWith(`${game.day}:travelerArrival:${id}:`) && !key.startsWith(`${game.day}:p:${id}:`)));

/** Phase 9R.1 Astra remediation (Finding M2): `undoStack` is untrusted
 * persisted-state data -- it may be genuinely absent (`undefined`), a
 * valid array, or a malformed PRESENT non-array value (e.g. `{}`, a
 * string, a number). Every migration step below that maps or spreads
 * `s.undoStack` previously assumed any truthy value was already an array;
 * `s.undoStack.map(...)` throws "is not a function" and a bare
 * `[...s.undoStack]` throws "is not iterable" for a malformed non-array
 * value instead of failing safely (`??` alone only substitutes for
 * `null`/`undefined`, never for a truthy non-array). A malformed
 * undoStack must never be silently normalized into `[]` here -- every
 * site below leaves it completely untouched when this guard fails, so the
 * final StorytellerStateSchema validation gate (which requires undoStack
 * to be an array or absent -- schemas.ts's
 * `z.array(StorytellerGamePersistedSchema).optional()`) rejects it and
 * triggers the existing reset path below, exactly the established
 * absent-vs-malformed distinction already applied to remote checkpoint
 * migration (see gameMigration.ts's own Finding A3 doc comment). */
function isMigratableUndoStack(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function migrateStoreState(state: unknown, fromVersion: number): unknown {
  const s = state as { game?: Record<string, unknown>; undoStack?: unknown; lobby?: unknown };
  if (fromVersion < 2) {
    if (s.game && !s.game.nightProgress) s.game.nightProgress = {};
    if (isMigratableUndoStack(s.undoStack)) {
      s.undoStack = s.undoStack.map((entry) => {
        const e = entry as Record<string, unknown>;
        if (!e.nightProgress) e.nightProgress = {};
        return e;
      });
    }
  }
  if (fromVersion < 3) {
    if (s.game) {
      if (!s.game.fabled) s.game.fabled = [];
      if (!s.game.bluffs) s.game.bluffs = [];
    }
    if (isMigratableUndoStack(s.undoStack)) {
      s.undoStack = s.undoStack.map((entry) => {
        const e = entry as Record<string, unknown>;
        if (!e.fabled) e.fabled = [];
        if (!e.bluffs) e.bluffs = [];
        return e;
      });
    }
  }
  if (fromVersion < 4) {
    if (s.game && !s.game.lorics) s.game.lorics = [];
    if (isMigratableUndoStack(s.undoStack)) {
      s.undoStack = s.undoStack.map((entry) => {
        const e = entry as Record<string, unknown>;
        if (!e.lorics) e.lorics = [];
        return e;
      });
    }
  }
  if (fromVersion < 5) {
    if (s.game) {
      if (!s.game.rolePool) s.game.rolePool = [];
      if (s.game.plannedPlayerCount === undefined) s.game.plannedPlayerCount = 0;
    }
    if (isMigratableUndoStack(s.undoStack)) {
      s.undoStack = s.undoStack.map((entry) => {
        const e = entry as Record<string, unknown>;
        if (!e.rolePool) e.rolePool = [];
        if (e.plannedPlayerCount === undefined) e.plannedPlayerCount = 0;
        return e;
      });
    }
  }
  // v6: grimoireMode and tokenPositions added — both are top-level optional
  // fields with Zod defaults, so no data migration is needed; old persisted
  // states pass validation and receive undefined → initial state provides "ring"/{}.

  if (fromVersion < 7) {
    if (s.game) {
      if (!s.game.pendingPlayers) s.game.pendingPlayers = {};
      const players = s.game.players as Record<string, Record<string, unknown>> | undefined;
      if (players) {
        for (const p of Object.values(players)) {
          if (p.isEmpty === undefined) p.isEmpty = false;
        }
      }
    }
    if (isMigratableUndoStack(s.undoStack)) {
      s.undoStack = s.undoStack.map((entry) => {
        const e = entry as Record<string, unknown>;
        if (!e.pendingPlayers) e.pendingPlayers = {};
        return e;
      });
    }
  }

  if (fromVersion < 8 && s?.lobby) {
    s.lobby = null;
    s.undoStack = [];
    if (s.game) { s.game.code = ""; s.game.storytellerUid = "local"; }
  }
  // v10 adds an optional starting population. Earlier snapshots cannot prove
  // this history; never derive it from their current attendance or roles.
  if (fromVersion < 10) {
    if (s.game) delete s.game.startingNonTravelerCount;
    if (Array.isArray(s.undoStack)) {
      for (const entry of s.undoStack) {
        if (entry && typeof entry === "object") delete (entry as Record<string, unknown>).startingNonTravelerCount;
      }
    }
  }
  // v11 introduces optional current Traveler facts. Leave legacy alignment,
  // completion and exile unknown. Public character can be recovered from truth.
  if (fromVersion < 11) {
    for (const entry of [s.game, ...(isMigratableUndoStack(s.undoStack) ? s.undoStack : [])]) {
      const players = (entry as { players?: Record<string, STPlayerRecord> } | undefined)?.players;
      for (const p of Object.values(players ?? {})) {
        if (p.isTraveler) p.publicDisplayRole = publicTravelerRole(p)?.id ?? null;
      }
    }
  }
  // v12 (Phase 9C.2A, OPUS-001) introduces localSeq/sync reconnect
  // watermarks. A legacy v11 store never tracked them: initialize localSeq
  // safely at 0 and leave sync null. Never invent acknowledgement evidence
  // from a legacy game's prior content, timestamps, or size — a valid
  // remote checkpoint outranks unevidenced legacy local state (see
  // reconnectDecision's "no sync metadata" rule).
  if (fromVersion < 12) {
    const withSync = s as { localSeq?: number; sync?: unknown };
    withSync.localSeq = 0;
    withSync.sync = null;
  }
  // v13 (Phase 9 Setup finalization B4) introduces plannedTravelerCount, the
  // intended Traveler count out of plannedPlayerCount. A legacy game never
  // planned any Travelers explicitly -- default to 0, mirroring
  // plannedPlayerCount's own v5 migration default.
  if (fromVersion < 13) {
    if (s.game && s.game.plannedTravelerCount === undefined) s.game.plannedTravelerCount = 0;
    if (isMigratableUndoStack(s.undoStack)) {
      s.undoStack = s.undoStack.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const e = entry as Record<string, unknown>;
        if (e.plannedTravelerCount === undefined) e.plannedTravelerCount = 0;
        return e;
      });
    }
  }
  // v14 (Phase 9D.1) -> v16 (Phase 9D.3): the structured live-state,
  // History, and Information Delivery evolution. Phase 9R.1 (Finding B1)
  // extracted the actual per-entry transformation into migrateGameEntry
  // (gameMigration.ts) so remote checkpoint recovery (readCheckpoint in
  // storytellerSync.ts) can apply the exact same rules to a bare remote
  // game -- never a second, divergent copy of them. See that function's
  // own doc comment for what each version step does and does not invent.
  if (fromVersion < 16) {
    const customScripts = (s as { customScripts?: Record<string, Script> }).customScripts ?? {};
    // Phase 9R.1 Astra remediation (Finding A2): local persisted migration
    // uses "trusted" evidence -- this state's OWN saved customScripts,
    // genuine evidence of what the game actually used (unlike remote
    // checkpoint recovery, which never has this and uses "canonical-only"
    // -- see readCheckpoint in storytellerSync.ts and MigrationScriptEvidence's
    // own doc comment).
    for (const entry of [s.game, ...(isMigratableUndoStack(s.undoStack) ? s.undoStack : [])]) {
      migrateGameEntry(entry, fromVersion, { kind: "trusted", customScripts });
    }
  }
  const check = StorytellerStateSchema.safeParse(state);
  if (!check.success) {
    // eslint-disable-next-line no-console
    console.warn("[migrate] persisted state failed validation, resetting:", check.error.flatten());
    _migrationResetFlag = true;
    return CLEAN_STATE;
  }
  // v9 drops obsolete saved previews through the schema allowlist, including
  // undo snapshots. Drafts, sent information and the active session survive.
  Object.assign(s, check.data);
  return state;
}

const guardsEqual = (a: GuardStamp | null, b: GuardStamp | null): boolean =>
  a !== null && b !== null && a.token === b.token && a.revision === b.revision;

/** Internal escape hatch: a `set` partial carrying this key bypasses the
 * central localSeq-bumping wrapper below. Never exported — only
 * `restoreRemoteCheckpoint` (the one legitimate "adopt different game
 * content without declaring new local intent" mutation) uses it, and it is
 * stripped before the partial reaches zustand. */
const SKIP_LOCAL_SEQ = Symbol("skipLocalSeq");
type StorytellerPatch =
  | (Partial<StorytellerStore> & { [SKIP_LOCAL_SEQ]?: boolean })
  | ((state: StorytellerStore) => Partial<StorytellerStore> & { [SKIP_LOCAL_SEQ]?: boolean });

export const useStorytellerStore = create<StorytellerStore>()(
  persist(
    (rawSet, get) => {
      // Central, reviewable game-mutation mechanism (Phase 9C.2A, section 2):
      // every existing action below still calls plain `set(...)` — this
      // shadows that name for the rest of the creator closure, so no
      // individual action needed to change. Any partial that changes `game`
      // to a new, non-null reference bumps `localSeq` exactly once,
      // automatically, with no per-action bookkeeping to forget. Actions
      // that only touch UI-only/local-layout fields (view, selectedPlayerId,
      // grimoireMode, tokenPositions, pendingKnocks, customScripts, lobby,
      // sync, localSeq itself) never include `game` in their partial, so
      // they never bump it. The one deliberate exception — adopting a
      // validated remote checkpoint, which must NOT read as new unsaved
      // Storyteller intent — goes through restoreRemoteCheckpoint, which
      // tags its partial with SKIP_LOCAL_SEQ.
      //
      // The cast back to `typeof rawSet` is the single contained boundary
      // where this wrapper's own permissive parameter type meets zustand's
      // real (overloaded, middleware-augmented) setter type; every action
      // below type-checks against that exact original type, unchanged.
      const set = ((partial: StorytellerPatch, replace?: boolean) => {
        rawSet((state: StorytellerStore) => {
          const resolved = typeof partial === "function" ? partial(state) : partial;
          const { [SKIP_LOCAL_SEQ]: skip, ...patch } = resolved;
          if (!skip && "game" in patch && patch.game !== state.game && patch.game != null) {
            return { ...patch, localSeq: state.localSeq + 1 };
          }
          return patch;
        }, replace as Parameters<typeof rawSet>[1]);
      }) as unknown as typeof rawSet;
      return {
      game: null,
      view: "home",
      undoStack: [],
      selectedPlayerId: null,
      customScripts: {},
      lobby: null,
      localSeq: 0,
      sync: null,
      pendingKnocks: [],
      grimoireMode: "ring",
      tokenPositions: {},

      newGame: (scriptId: string, opts: NewGameOpts = {}) => {
        const script =
          BUILTIN_SCRIPTS[scriptId] ?? get().customScripts[scriptId];
        if (!script) throw new Error(`Unknown script id: ${scriptId}`);
        // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION,
        // Section 4): the store boundary enforces the supported total cap
        // independently of the UI stepper/table, so malformed UI or
        // programmatic input can never create an unsupported plan.
        const count = Math.max(0, Math.min(opts.plannedPlayerCount ?? 0, MAX_TOTAL_PLAYERS));
        const travelerCount = Math.max(0, Math.min(opts.plannedTravelerCount ?? 0, count));
        const prePlayers: Record<PlayerId, STPlayerRecord> = {};
        const preSeatOrder: PlayerId[] = [];
        for (let i = 0; i < count; i++) {
          const id = newId();
          prePlayers[id] = blankPlayer(id, "", i, true);
          preSeatOrder.push(id);
        }
        const game: StorytellerLobbyRecord = {
          code: "",
          storytellerUid: "local",
          scriptId: script.id,
          phase: "setup",
          day: 0,
          bluffs: [],
          fabled: opts.plannedFabled ?? [],
          lorics: opts.plannedLorics ?? [],
          notes: "",
          players: prePlayers,
          seatOrder: preSeatOrder,
          nightProgress: {},
          rolePool: opts.plannedRoles ?? [],
          plannedPlayerCount: count,
          plannedTravelerCount: travelerCount,
          pendingPlayers: {},
          history: [],
          informationDeliveries: [],
        };
        usePrivacyStore.getState().reset();
        set({ game, lobby: null, pendingKnocks: [], view: "game", undoStack: [], selectedPlayerId: null });
      },

      dealRolePool: () => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        const script = selectScriptById(get(), game.scriptId);
        const context = selectSetupContext(game, script);
        const ready = analyzeSetup(context).readiness.deal;
        if (!ready.ok) return ready;
        const pool = game.rolePool ?? [];
        const nonTravelerSeats = context.ordinary.map(p => p.id);

        // Fisher-Yates shuffle
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }

        const registry = context.registry!;
        const newPlayers = { ...game.players };
        nonTravelerSeats.forEach((playerId, idx) => {
          const existing = newPlayers[playerId];
          if (!existing) return;
          newPlayers[playerId] = freshAssignment(existing, shuffled[idx]!, registry);
        });

        set({
          undoStack: pushUndo(game, undoStack),
          game: {
            ...game,
            players: newPlayers,
            rolePool: [],
            setupRolesDealt: true,
            // Deal establishes Storyteller truth only; every fresh initial
            // deal requires its own explicit Reveal before publication.
            setupRolesRevealed: false,
          },
        });
        return { ok: true };
      },

      revealRoles: () => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        if (game.phase !== "setup") return { ok: false, message: "This game is no longer in setup." };
        if (!isPostDeal(game)) return { ok: false, message: "Deal the pool before revealing roles." };
        const script = selectScriptById(get(), game.scriptId);
        const context = selectSetupContext(game, script);
        // FINAL POPULATION CLOSURE, Section 11: hard total-capacity bound --
        // even malformed/legacy/adversarial state (bypassing the store-level
        // guards on newGame/setPlannedPlayerCount/addPlayer/etc.) must never
        // reach Reveal as valid.
        if (game.plannedPlayerCount > MAX_TOTAL_PLAYERS || context.population.totalPhysicalSeatCount > MAX_TOTAL_PLAYERS)
          return { ok: false, message: `Starting capacity cannot exceed ${MAX_TOTAL_PLAYERS} participants.` };
        // Reveal requires BOTH identity readiness and setup/composition
        // readiness -- a Manual Override or Edit Bag apply may deliberately
        // leave the setup composition-invalid, and that must still block
        // Reveal even once every shown identity is otherwise complete.
        const analysis = analyzeSetup(context);
        if (!assignedBagIsCoherent(context, analysis))
          return { ok: false, message: "Setup needs correction before revealing roles." };
        const readiness = initialRevealReadiness(context);
        if (!readiness.ready) return { ok: false,
          message: `${readiness.readyCount}/${readiness.totalCount} roles ready to reveal.` };
        set({ undoStack: pushUndo(game, undoStack), game: { ...game, setupRolesRevealed: true } });
        return { ok: true };
      },

      shuffleSetupRoles: () => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        const gate = canRefineSetup(game);
        if (!gate.ok) return gate;
        const script = selectScriptById(get(), game.scriptId);
        const context = selectSetupContext(game, script);
        const analysis = analyzeSetup(context);
        if (!assignedBagIsCoherent(context, analysis))
          return { ok: false, message: "Fix the current setup before shuffling roles." };
        const registry = context.registry!;
        const bag = [...context.assigned];
        // Fisher-Yates shuffle -- a fresh private-assignment generation.
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [bag[i], bag[j]] = [bag[j]!, bag[i]!];
        }
        const newPlayers = { ...game.players };
        context.ordinary.forEach((p, idx) => {
          newPlayers[p.id] = freshAssignment(newPlayers[p.id]!, bag[idx]!, registry);
        });
        set({ undoStack: pushUndo(game, undoStack), game: { ...game, players: newPlayers } });
        return { ok: true };
      },

      swapSetupRoles: (playerIdA, playerIdB) => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        const gate = canRefineSetup(game);
        if (!gate.ok) return gate;
        if (playerIdA === playerIdB) return { ok: false, message: "Choose two different players." };
        const a = game.players[playerIdA];
        const b = game.players[playerIdB];
        if (!a || !b || a.isEmpty || b.isEmpty) return { ok: false, message: "Both players must be seated." };
        if (a.isTraveler || b.isTraveler) return { ok: false, message: "Travelers cannot use Setup Swap." };
        if (!a.actualRole || !b.actualRole) return { ok: false, message: "Both players must have an actual role." };
        const script = selectScriptById(get(), game.scriptId);
        const registry = buildRegistry(script ?? { id: game.scriptId, name: game.scriptId, characters: [] });
        const newA = freshAssignment(a, b.actualRole, registry);
        const newB = freshAssignment(b, a.actualRole, registry);
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, players: { ...game.players, [playerIdA]: newA, [playerIdB]: newB } },
        });
        return { ok: true };
      },

      replaceSetupRole: (playerId, roleId) => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        const gate = canRefineSetup(game);
        if (!gate.ok) return gate;
        const player = game.players[playerId];
        if (!player || player.isEmpty) return { ok: false, message: "This player is not seated." };
        if (player.isTraveler) return { ok: false, message: "Travelers cannot use the Setup role override." };
        const script = selectScriptById(get(), game.scriptId);
        const role = script?.characters.find(r => r.id === roleId);
        if (!role || !isBagType(role.type))
          return { ok: false, message: "Choose a valid ordinary character for this script." };
        const registry = buildRegistry(script!);
        const next = freshAssignment(player, roleId, registry);
        set({ undoStack: pushUndo(game, undoStack), game: { ...game, players: { ...game.players, [playerId]: next } } });
        return { ok: true };
      },

      applyEditedBag: (stagedRoleIds) => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        const gate = canRefineSetup(game);
        if (!gate.ok) return gate;
        const script = selectScriptById(get(), game.scriptId);
        const context = selectSetupContext(game, script);
        const ordinary = context.ordinary;
        if (stagedRoleIds.length !== ordinary.length) return { ok: false,
          message: `Choose exactly one role per occupied ordinary player (${stagedRoleIds.length}/${ordinary.length}).` };
        const matched = matchBagToAssignments(ordinary.map(p => ({ playerId: p.id, role: p.actualRole })), stagedRoleIds);
        if (!matched) return { ok: false, message: "Setup changed. Review the bag and try again." };
        const registry = context.registry!;
        const newPlayers = { ...game.players };
        for (const { playerId, role, changed } of matched) {
          if (!changed) continue;
          newPlayers[playerId] = freshAssignment(newPlayers[playerId]!, role, registry);
        }
        set({ undoStack: pushUndo(game, undoStack), game: { ...game, players: newPlayers } });
        return { ok: true };
      },

      beginNightOne: () => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        const context = selectSetupContext(game, selectScriptById(get(), game.scriptId));
        const analysis = analyzeSetup(context);
        const ready = analysis.readiness.begin;
        if (!ready.ok) return ready;
        // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION,
        // Section 2): defense-in-depth for the committed starting ordinary
        // roster -- a future accidental UI escape must not allow a valid
        // Reveal, an out-of-band mutation away from a valid composition,
        // then beginning Night 1 anyway. Only meaningful once the roster is
        // actually committed; re-uses the same coherence check Reveal itself
        // requires, never a new rule.
        if (isInitialRevealComplete(game) && !assignedBagIsCoherent(context, analysis))
          return { ok: false, message: "The starting ordinary composition is no longer valid. Review Setup before beginning Night 1." };
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, phase: "night", day: 1,
            ...(game.startingNonTravelerCount === undefined && game.day === 0
              ? { startingNonTravelerCount: context.population.occupiedNonTravelerCount } : {}) },
        });
        return { ok: true };
      },

      setPlannedPlayerCount: (count) => {
        const { game, undoStack } = get();
        if (!game || game.phase !== "setup" || !Number.isSafeInteger(count) || count < 1) return;
        // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION,
        // Section 4): the store boundary enforces the supported total cap
        // even when this is called directly, not only through the UI's own
        // stepper/table limits.
        if (count > MAX_TOTAL_PLAYERS) return;
        // FINAL SEAT & TRAVELLER RESERVATION CLOSURE, Section 1: once the
        // starting seat structure exists, plannedPlayerCount is never
        // independently edited -- New Game is the sole initial planner;
        // afterward only Add Seat/Remove Seat/Add Traveller (always in
        // lockstep with physical seats) may change it. Refusing here closes
        // the bypass at the store boundary too, not only by removing the
        // Setup panel's numeric input.
        if (game.seatOrder.length > 0) return;
        set({ undoStack: pushUndo(game, undoStack), game: { ...game, plannedPlayerCount: count } });
      },

      setRolePool: (roles) => {
        const { game, undoStack } = get();
        if (!game || game.phase !== "setup") return;
        set({ undoStack: pushUndo(game, undoStack), game: { ...game, rolePool: [...roles],
          // Reopening the pool leaves preparation, so any prior deal/reveal
          // evidence for it is no longer meaningful either.
          ...(roles.length ? { setupRolesDealt: false, setupRolesRevealed: false } : {}) } });
      },

      endGame: () => {
        usePrivacyStore.getState().reset();
        set({
          game: null,
          view: "home",
          undoStack: [],
          selectedPlayerId: null,
          lobby: null,
          pendingKnocks: [],
        });
      },

      setView: (view) => set({ view }),

      selectPlayer: (id) => set({ selectedPlayerId: id }),

      setLobby: (lobby) => set(state => ({ lobby, game: state.game && lobby ? { ...state.game, code: lobby.code, storytellerUid: lobby.uid } : state.game, undoStack: [] })),

      setLobbyStatus: (status) => {
        const { lobby } = get();
        if (!lobby) return;
        set({ lobby: { ...lobby, status } });
      },

      setPendingKnocks: (knocks) => set({ pendingKnocks: knocks }),

      seatPlayerFromKnock: (uid, name) => {
        // Legacy path: used when there are no pre-allocated empty seats.
        // Routes to pending queue; returns null since no seat is assigned yet.
        get().addToPendingQueue(uid, name);
        return null;
      },

      bindRosterUid: (_uid, _playerId) => {
        // No-op in local store. The actual roster→playerId binding lives
        // in the Firebase write done by the sync engine.
      },

      addToPendingQueue: (uid, name) => {
        const { game } = get();
        if (!game) return;
        const trimmed = name.trim().slice(0, 20);
        if (!trimmed) return;
        if (game.pendingPlayers[uid]) return; // already queued
        set({
          game: {
            ...game,
            pendingPlayers: { ...game.pendingPlayers, [uid]: trimmed },
          },
        });
      },

      assignPendingToSeat: (uid, seatPlayerId) => {
        const { game } = get();
        if (!game) return false;
        const name = game.pendingPlayers[uid];
        if (!name) return false;
        const seat = game.players[seatPlayerId];
        if (!seat?.isEmpty) return false;
        const newPending = { ...game.pendingPlayers };
        delete newPending[uid];
        set({
          // Membership transitions establish a new remote-consistency
          // boundary; older snapshots must not resurrect a stale seat.
          undoStack: [],
          game: {
            ...game,
            players: {
              ...game.players,
              [seatPlayerId]: arrivalPlayer({ ...seat, name, isEmpty: false }, game),
            },
            pendingPlayers: newPending,
          },
        });
        return true;
      },

      removePendingPlayer: (uid) => {
        const { game } = get();
        if (!game) return;
        const newPending = { ...game.pendingPlayers };
        delete newPending[uid];
        set({ game: { ...game, pendingPlayers: newPending } });
      },

      addCustomScript: (script) => {
        if (BUILTIN_SCRIPT_IDS.has(script.id)) {
          return {
            ok: false,
            error: `Script id "${script.id}" conflicts with a built-in script. Rename and re-import.`,
          };
        }
        const { customScripts } = get();
        if (customScripts[script.id]) {
          return {
            ok: false,
            error: `A custom script with id "${script.id}" is already imported. Remove it first to replace.`,
          };
        }
        set({
          customScripts: { ...customScripts, [script.id]: script },
        });
        return { ok: true };
      },

      removeCustomScript: (id) => {
        const { customScripts, game } = get();
        if (!customScripts[id]) return;
        const next = { ...customScripts };
        delete next[id];
        // If the active game uses this script, end it cleanly.
        if (game && game.scriptId === id) {
          set({
            customScripts: next,
            game: null,
            view: "home",
            undoStack: [],
            selectedPlayerId: null,
          });
        } else {
          set({ customScripts: next });
        }
      },

      addPlayer: (name) => {
        const { game, undoStack } = get();
        if (!game) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        // FINAL POPULATION CLOSURE / RESERVATION CLOSURE, Section 2: refuse
        // atomically -- before any mutation -- once either the plan or
        // physical seats are already at capacity. Never clamp the plan
        // while still creating seat/player 21; state must remain
        // completely unchanged on refusal.
        if (atCapacity(game)) return;
        const id = newId();
        const seat = game.seatOrder.length;
        const player = arrivalPlayer(blankPlayer(id, trimmed, seat), game);
        // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION,
        // Section 3.D; FINAL POPULATION CLOSURE, Section 6): addPlayer
        // always creates a brand-new seat rather than filling an existing
        // planned one, so a deliberate addition before Reveal genuinely
        // grows the plan -- never derived from occupancy. Arrival type is
        // decided first (via arrivalPlayer, above) and the plan update
        // matches it atomically in this same patch: a genuinely new
        // Traveler arrival (e.g. ordinary occupancy already at its cap)
        // must never leave plannedTravelerCount silently behind
        // plannedPlayerCount. Once the starting roster is committed
        // (Reveal), the plan is historical and no longer grows; late
        // arrivals stay a pure occupancy/geometry change.
        const planPatch = isInitialRevealComplete(game) ? {} : {
          plannedPlayerCount: game.plannedPlayerCount + 1,
          ...(player.isTraveler ? { plannedTravelerCount: game.plannedTravelerCount + 1 } : {}),
        };
        set({
          undoStack: pushUndo(game, undoStack),
          game: {
            ...game,
            ...planPatch,
            players: { ...game.players, [id]: player },
            seatOrder: [...game.seatOrder, id],
          },
        });
      },

      addPlayerToSeat: (name) => {
        const { game } = get();
        if (!game) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        const emptyId = game.seatOrder.find((id) => game.players[id]?.isEmpty);
        if (!emptyId) {
          get().addPlayer(trimmed);
          return;
        }
        const seat = game.players[emptyId];
        if (!seat) return;
        set({
          undoStack: pushUndo(game, get().undoStack),
          game: {
            ...game,
            players: {
              ...game.players,
              [emptyId]: arrivalPlayer({ ...seat, name: trimmed.slice(0, 20), isEmpty: false }, game),
            },
          },
        });
      },

      addEmptySeat: () => {
        const { game } = get();
        if (!game) return;
        // FINAL POPULATION CLOSURE / RESERVATION CLOSURE, Sections 2 & 7:
        // this represents deliberate new starting capacity before Reveal, so
        // it grows the plan exactly like addPlayer -- refused atomically
        // once either the plan or physical seats are at capacity, never
        // clamped while still creating the seat. Filling this seat later
        // (addPlayerToSeat/assignPendingToSeat) never grows the plan again;
        // it is already accounted for here.
        if (atCapacity(game)) return;
        const id = newId();
        const seat = game.seatOrder.length;
        const revealed = isInitialRevealComplete(game);
        // FINAL SEAT & TRAVELLER RESERVATION CLOSURE, Section 3: before
        // Reveal, once the ordinary target is already at its own cap (15), a
        // new generic seat cannot be an ordinary reservation -- the new
        // participant becomes planned Traveller capacity instead, exactly
        // like Add Traveller, so the ordinary target itself never silently
        // exceeds 15. The seat stays isTraveler: false, marked only
        // plannedTravelerSeat -- actual Traveller identity occurs once a
        // real player occupies it.
        const target = revealed ? null : selectSetupContext(game).population.targetNonTravelerCount;
        const atOrdinaryCap = target !== null && target >= MAX_PLAYERS;
        const planPatch = revealed ? {} : atOrdinaryCap
          ? { plannedPlayerCount: game.plannedPlayerCount + 1, plannedTravelerCount: game.plannedTravelerCount + 1 }
          : { plannedPlayerCount: game.plannedPlayerCount + 1 };
        const newPlayer = atOrdinaryCap
          ? { ...blankPlayer(id, "", seat, true), plannedTravelerSeat: true }
          : arrivalPlayer(blankPlayer(id, "", seat, true), game);
        set({
          undoStack: pushUndo(game, get().undoStack),
          game: {
            ...game,
            ...planPatch,
            players: { ...game.players, [id]: newPlayer },
            seatOrder: [...game.seatOrder, id],
          },
        });
      },

      addTravelerSeat: () => {
        const { game } = get();
        if (!game) return;
        // FINAL POPULATION CLOSURE / RESERVATION CLOSURE, Section 2: refuse
        // atomically once either the plan or physical seats are at capacity.
        if (atCapacity(game)) return;
        const id = newId();
        const seat = game.seatOrder.length;
        // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION,
        // Section 3.E; FINAL POPULATION CLOSURE, Section 3-4): capacity for
        // an intended Traveler is added directly to the plan, never by
        // pre-flagging an empty seat isTraveler -- that would treat the
        // empty seat itself as the Traveler player. The seat instead
        // carries plannedTravelerSeat, narrow Storyteller-only planning
        // metadata representing unfulfilled planned Traveler capacity.
        // Actual designation happens through arrivalPlayer() the moment a
        // real player occupies it (see assignPendingToSeat/addPlayerToSeat),
        // which fulfills and clears this exact reservation -- correctly
        // never double-counted against plannedTravelerCount.
        const planPatch = isInitialRevealComplete(game) ? {} : {
          plannedPlayerCount: game.plannedPlayerCount + 1,
          plannedTravelerCount: game.plannedTravelerCount + 1,
        };
        set({
          undoStack: pushUndo(game, get().undoStack),
          game: {
            ...game,
            ...planPatch,
            players: { ...game.players, [id]: { ...blankPlayer(id, "", seat, true), plannedTravelerSeat: true } },
            seatOrder: [...game.seatOrder, id],
          },
        });
      },

      removePlayer: (id) => {
        const { game, selectedPlayerId } = get();
        const existing = game?.players[id];
        if (!game || !existing) return false;
        const players = { ...game.players };
        delete players[id];
        const seatOrder = game.seatOrder.filter((p) => p !== id);
        // re-seat the remaining players to keep seats contiguous 0..n-1,
        // and scrub any fakeMinion reference to the removed player.
        const renumbered: typeof players = {};
        seatOrder.forEach((pid, idx) => {
          const p = players[pid];
          if (!p) return;
          let next = { ...p, seat: idx };
          if (next.privateInfo?.fakeMinions?.includes(id)) {
            const filtered = next.privateInfo.fakeMinions.filter(
              (mid) => mid !== id
            );
            const pi = { ...next.privateInfo };
            if (filtered.length > 0) pi.fakeMinions = filtered;
            else delete pi.fakeMinions;
            if (Object.keys(pi).length > 0) next.privateInfo = pi;
            else delete next.privateInfo;
          }
          renumbered[pid] = next;
        });
        // Phase 9 Setup finalization (FINAL POPULATION CLOSURE, Section 8):
        // removing a seat before Reveal always removes one unit of starting
        // capacity -- symmetric with addEmptySeat/addTravelerSeat/addPlayer
        // always having grown it, whether or not the seat was ever filled.
        // unseatPlayer -- not this command -- is the "keep the reservation"
        // action that must never touch the plan (Section 9). Exactly one
        // Traveler-planning decrement applies, never both: either this seat
        // still carried an unfulfilled Traveler reservation (empty,
        // plannedTravelerSeat), or it held an actual occupied Traveler --
        // arrivalPlayer() guarantees those two are mutually exclusive, so
        // there is never a double-decrement here.
        const adjustPlan = !isInitialRevealComplete(game);
        const planPatch = adjustPlan ? {
          plannedPlayerCount: Math.max(0, game.plannedPlayerCount - 1),
          ...(existing.plannedTravelerSeat || existing.isTraveler
            ? { plannedTravelerCount: Math.max(0, game.plannedTravelerCount - 1) } : {}),
        } : {};
        set({
          // Membership transitions establish a new remote-consistency
          // boundary; older snapshots must not resurrect a stale seat.
          undoStack: [],
          game: {
            ...game,
            ...planPatch,
            players: renumbered,
            seatOrder,
          },
          selectedPlayerId: selectedPlayerId === id ? null : selectedPlayerId,
        });
        return true;
      },

      unseatPlayer: (id) => {
        const { game, selectedPlayerId } = get();
        const existing = game?.players[id];
        if (!game || !existing || existing.isEmpty) return false;
        // FINAL SEAT & TRAVELLER RESERVATION CLOSURE, Section 4: unseating
        // changes occupancy only, never the seat's reservation type. An
        // occupied Traveler returns to an empty Traveller reservation
        // (plannedTravelerSeat: true), not a generic ordinary-neutral blank
        // seat -- otherwise refilling it would silently lose the Traveller
        // designation. Plan counts (plannedPlayerCount/plannedTravelerCount)
        // never change here; only reservation type does.
        const blank = blankPlayer(id, "", existing.seat, true);
        const restored = existing.isTraveler ? { ...blank, plannedTravelerSeat: true } : blank;
        set({
          // Membership-affecting changes deliberately do not enter the generic
          // undo stack; clearing older snapshots prevents undo from restoring
          // a remote membership that has already been revoked.
          undoStack: [],
          game: {
            ...game,
            players: {
              ...game.players,
              [id]: restored,
            },
          },
          selectedPlayerId: selectedPlayerId === id ? null : selectedPlayerId,
        });
        return true;
      },

      renamePlayer: (id, name) => {
        const { game, undoStack } = get();
        if (!game) return;
        const trimmed = name.trim().slice(0, 20);
        if (!trimmed) return;
        set({
          undoStack: pushUndo(game, undoStack),
          game: patchPlayer(game, id, { name: trimmed }),
        });
      },

      setSeatOrder: (order) => {
        const { game, undoStack } = get();
        if (!game) return;
        const renumbered = { ...game.players };
        order.forEach((pid, idx) => {
          const p = renumbered[pid];
          if (p) renumbered[pid] = { ...p, seat: idx };
        });
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, players: renumbered, seatOrder: [...order] },
        });
      },

      movePlayer: (id, direction) => {
        const { game, undoStack } = get();
        if (!game) return;
        const order = [...game.seatOrder];
        const i = order.indexOf(id);
        if (i < 0) return;
        const j = direction === "left" ? i - 1 : i + 1;
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j]!, order[i]!];
        const renumbered = { ...game.players };
        order.forEach((pid, idx) => {
          const p = renumbered[pid];
          if (p) renumbered[pid] = { ...p, seat: idx };
        });
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, players: renumbered, seatOrder: order },
        });
      },

      assignRole: (id, roleId, context) => {
        const { game, undoStack } = get();
        if (!game) return;
        const existing = game.players[id];
        if (!existing) return;
        if (existing.isTraveler && roleId && !getTraveler(roleId)) return;
        if (!existing.isTraveler && getTraveler(roleId)) return;
        if (existing.actualRole === roleId) return;
        // Ordinary truth changes preserve perception. Traveler assignment
        // explicitly publishes only its public character, never its alignment.
        // Role-specific private packets must be configured again.
        const next: STPlayerRecord = {
          ...existing,
          actualRole: roleId,
          ...(roleId ? {} : { shownRole: null, shownAlignment: null, behaviorMode: "normal" as const }),
          abilityUsed: false,
          ...(existing.isTraveler ? {
            publicDisplayRole: roleId || null,
            shownRole: roleId || null,
            shownAlignment: null,
            travelerArrival: newTravelerArrival(),
          } : {}),
        };
        delete next.privateInfo;
        const updatedGame = {
          ...game,
          ...(existing.isTraveler ? { nightProgress: resetTravelerNightProgress(game, id) } : {}),
          players: { ...game.players, [id]: invalidatePrivatePacket(next) },
        };
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "identity", playerId: id,
            change: { kind: "value", from: { actualRole: existing.actualRole }, to: { actualRole: roleId } },
            ...(context?.provenance ? { provenance: context.provenance } : {}),
          })),
        });
      },

      showAssignedRole: (id) => {
        const { game } = get();
        const player = game?.players[id];
        if (!player?.actualRole || needsShownIdentity(player.actualRole)) return;
        get().setShownRole(id, player.actualRole);
      },

      setShownRole: (id, roleId) => {
        const { game, undoStack } = get();
        if (!game) return;
        const existing = game.players[id];
        if (!existing) return;
        // A new perception cannot inherit alignment overrides or packets from
        // the previous identity. Null alignment derives only from shownRole.
        const next = { ...existing, shownRole: roleId, shownAlignment: null };
        delete next.privateInfo;
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, players: { ...game.players, [id]: invalidatePrivatePacket(next) } },
        });
      },

      setShownAlignment: (id, alignment) => {
        const { game, undoStack } = get();
        if (!game) return;
        set({
          undoStack: pushUndo(game, undoStack),
          game: game.players[id] ? { ...game, players: { ...game.players, [id]: invalidatePrivatePacket({ ...game.players[id]!, shownAlignment: alignment }) } } : game,
        });
      },

      setBehaviorMode: (id, mode) => {
        const { game, undoStack } = get();
        if (!game) return;
        set({
          undoStack: pushUndo(game, undoStack),
          game: game.players[id] ? { ...game, players: { ...game.players, [id]: invalidatePrivatePacket(pruneInapplicablePrivateInfo({ ...game.players[id]!, behaviorMode: mode }, buildRegistry(selectScriptById(get(), game.scriptId) ?? { id: game.scriptId, name: game.scriptId, characters: [] }))) } } : game,
        });
      },

      setBluffs: (id, bluffs) => {
        const { game, undoStack } = get();
        if (!game) return;
        const player = game.players[id];
        if (!player) return;
        const next = { ...player };
        const cleaned = bluffs.filter((b) => !!b).slice(0, 3);
        if (cleaned.length === 0) {
          // Drop the bluffs key entirely; if privateInfo becomes empty, drop it too.
          if (next.privateInfo) {
            const { bluffs: _drop, ...rest } = next.privateInfo;
            const remaining = Object.keys(rest).length > 0 ? rest : undefined;
            if (remaining) next.privateInfo = remaining;
            else delete next.privateInfo;
          }
        } else {
          next.privateInfo = { ...(next.privateInfo ?? {}), bluffs: cleaned };
        }
        set({
          undoStack: pushUndo(game, undoStack),
          game: {
            ...game,
            players: { ...game.players, [id]: next },
          },
        });
      },

      setFakeMinions: (id, playerIds) => {
        const { game, undoStack } = get();
        if (!game) return;
        const player = game.players[id];
        if (!player) return;
        const valid = [...new Set(playerIds.filter((pid) => !!game.players[pid] && !game.players[pid]?.isEmpty && pid !== id))];
        const next = { ...player };
        if (valid.length === 0) {
          if (next.privateInfo) {
            const { fakeMinions: _drop, ...rest } = next.privateInfo;
            const remaining = Object.keys(rest).length > 0 ? rest : undefined;
            if (remaining) next.privateInfo = remaining;
            else delete next.privateInfo;
          }
        } else {
          next.privateInfo = {
            ...(next.privateInfo ?? {}),
            fakeMinions: valid,
          };
        }
        set({
          undoStack: pushUndo(game, undoStack),
          game: {
            ...game,
            players: { ...game.players, [id]: next },
          },
        });
      },

      setPrivateText: (id, text) => {
        const { game, undoStack } = get();
        const player = game?.players[id];
        if (!game || !player) return;
        const privateInfo = { ...player.privateInfo };
        if (text.trim()) privateInfo.extraText = text.slice(0, 4000);
        else delete privateInfo.extraText;
        set({
          undoStack: pushUndo(game, undoStack),
          game: patchPlayer(game, id, { privateInfo }),
        });
      },

      setIsTraveler: (id, isTraveler) => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        const existing = game.players[id];
        if (!existing) return { ok: false, message: "This player is not seated." };
        if (existing.isTraveler === isTraveler) return { ok: true };
        // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION,
        // Section 2): Reveal is a hard starting-setup commitment boundary --
        // the starting ordinary roster is committed, so ordinary <-> Traveler
        // conversion is refused at this command boundary, not only hidden
        // in the UI.
        if (isInitialRevealComplete(game))
          return { ok: false, message: "Roles are already revealed; Traveler status is locked in for this game." };
        // Section 3.B: only an occupied player can be designated a Traveler
        // -- an empty seat is never itself a Traveler player.
        if (existing.isEmpty) return { ok: false, message: "Seat a player before designating them a Traveler." };
        const population = selectSetupContext(game).population;
        const occupiedOrdinary = population.occupiedNonTravelerCount;
        const occupiedTravelers = population.occupiedTravelerCount;
        const nextOccupiedOrdinary = isTraveler ? occupiedOrdinary - 1 : occupiedOrdinary + 1;
        if (isTraveler && nextOccupiedOrdinary < MIN_PLAYERS)
          return { ok: false, message: `Converting this player to a Traveler would drop ordinary players below the minimum of ${MIN_PLAYERS}.` };
        if (!isTraveler && nextOccupiedOrdinary > MAX_PLAYERS)
          return { ok: false, message: `Converting this Traveler to ordinary would raise ordinary players above the maximum of ${MAX_PLAYERS}.` };
        // Section 3.B/3.A: plan and occupancy are never conflated. A
        // designation either fulfills an already-planned Traveler slot
        // (occupied Travelers have not yet reached the planned count) or
        // represents a genuinely new intended Traveler -- never derived by
        // snapping to current occupancy. The reverse direction simply
        // relinquishes one intended Traveler slot from the plan.
        // FINAL SEAT & TRAVELLER RESERVATION CLOSURE, Section 5: Traveller
        // capacity already spoken for is occupied Travelers PLUS empty
        // seats still holding an outstanding Traveller reservation
        // (plannedTravelerSeat) -- counting occupied Travelers alone would
        // let a manual designation silently "steal" a reservation meant for
        // a different, still-unfilled seat instead of growing the plan for
        // itself, undercounting total planned Travellers once the
        // reservation is later filled too.
        const allocatedTravelerCapacity = occupiedTravelers + population.outstandingTravelerReservationCount;
        const nextPlannedTravelerCount = isTraveler
          ? (allocatedTravelerCapacity < game.plannedTravelerCount ? game.plannedTravelerCount : game.plannedTravelerCount + 1)
          : Math.max(0, game.plannedTravelerCount - 1);
        const next: STPlayerRecord = {
          ...existing,
          isTraveler,
          actualRole: "",
          shownRole: null,
          shownAlignment: null,
          behaviorMode: "normal",
          publicDisplayRole: null,
        };
        delete next.actualAlignment;
        delete next.exiled;
        delete next.travelerArrival;
        if (isTraveler) next.travelerArrival = newTravelerArrival();
        delete next.privateInfo;
        set({
          undoStack: pushUndo(game, undoStack),
          game: {
            ...game,
            plannedTravelerCount: nextPlannedTravelerCount,
            nightProgress: resetTravelerNightProgress(game, id),
            players: { ...game.players, [id]: invalidatePrivatePacket(next) },
          },
        });
        return { ok: true };
      },

      setTravelerAlignment: (id, alignment, context) => {
        const { game, undoStack } = get();
        const p = game?.players[id];
        if (!game || !p?.isTraveler || p.actualAlignment === alignment) return;
        const next = invalidatePrivatePacket({ ...p, actualAlignment: alignment,
          travelerArrival: { ...(p.travelerArrival ?? newTravelerArrival()), demonInfoComplete: false } });
        delete next.privateInfo;
        const updatedGame = { ...game, players: { ...game.players, [id]: next } };
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "alignment", playerId: id,
            change: { kind: "value", from: alignmentHistoryValue(p.actualAlignment), to: { actualAlignment: alignment } },
            ...(context?.provenance ? { provenance: context.provenance } : {}),
          })),
        });
      },

      setActualAlignment: (id, alignment, context) => {
        const { game, undoStack } = get();
        const p = game?.players[id];
        if (!game || !p || p.actualAlignment === alignment) return;
        // A Traveler's self projection mirrors actualAlignment directly
        // (see projectIdentity) -- changing it invalidates any already-
        // published packet exactly like setTravelerAlignment does. An
        // ordinary player's actualAlignment never reaches a projection, so
        // no invalidation is needed there.
        const patched = { ...p, actualAlignment: alignment };
        const next = p.isTraveler ? invalidatePrivatePacket(patched) : patched;
        const updatedGame = { ...game, players: { ...game.players, [id]: next } };
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "alignment", playerId: id,
            change: { kind: "value", from: alignmentHistoryValue(p.actualAlignment), to: { actualAlignment: alignment } },
            ...(context?.provenance ? { provenance: context.provenance } : {}),
          })),
        });
      },

      prepareTravelerDemon: (id) => {
        const { game, undoStack } = get();
        const p = game?.players[id];
        const script = game && selectScriptById(get(), game.scriptId);
        if (!game || !p || !script) return;
        const result = travelerDemonInformation(p, game, buildRegistry(script));
        if (!result.demon) return;
        set({ undoStack: pushUndo(game, undoStack), game: patchPlayer(game, id,
          { privateInfo: { travelerDemon: result.demon.id } }) });
      },

      completeTravelerInformation: (id) => {
        const { game, undoStack } = get();
        const p = game?.players[id];
        if (!game || !p || !publicTravelerRole(p) || p.actualAlignment !== "evil" || !p.alive || p.exiled) return;
        set({ undoStack: pushUndo(game, undoStack), game: patchPlayer(game, id,
          { travelerArrival: { ...(p.travelerArrival ?? newTravelerArrival()), demonInfoComplete: true } }) });
      },

      exileTraveler: (id) => {
        const { game, undoStack } = get();
        const p = game?.players[id];
        if (!game || !p?.isTraveler || !p.alive || p.exiled) return;
        const updatedGame = patchPlayer(game, id, { exiled: true, alive: false });
        set({
          undoStack: pushUndo(game, undoStack),
          // Exile is never collapsed into generic death (Phase 9D.1):
          // the presence of `exiled` in the change, not a separate
          // category, is what distinguishes it from an ordinary kill.
          game: recordIfLive(game, updatedGame, () => ({
            category: "life", playerId: id,
            change: { kind: "value", from: { alive: true, exiled: false }, to: { alive: false, exiled: true } },
          })),
        });
      },

      completeTravelerArrivalCheck: (id) => {
        const { game, undoStack } = get();
        const p = game?.players[id];
        if (!game || !p || !travelerNeedsArrivalCheck(p) || !p.actualAlignment || !p.alive || p.exiled) return;
        set({ undoStack: pushUndo(game, undoStack), game: patchPlayer(game, id,
          { travelerArrival: { ...(p.travelerArrival ?? newTravelerArrival()), arrivalCheckComplete: true } }) });
      },

      setFabled: (fabled) => {
        const { game, undoStack } = get();
        if (!game) return;
        const validIds = new Set(FABLED.map((f) => f.id));
        const deduped = [...new Set(fabled.filter((id) => validIds.has(id)))];
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, fabled: deduped },
        });
      },

      setLorics: (lorics) => {
        const { game, undoStack } = get();
        if (!game) return;
        const validIds = new Set(LORICS.map((l) => l.id));
        const deduped = [...new Set(lorics.filter((id) => validIds.has(id)))];
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, lorics: deduped },
        });
      },

      setAlive: (id, alive, context) => {
        const { game, undoStack } = get();
        if (!game) return;
        const player = game.players[id];
        if (!player) return;
        const patch: Partial<STPlayerRecord> = { alive };
        if (alive && player.exiled) patch.exiled = false;
        if (alive && !player.alive) patch.ghostVote = true;
        const touched = Object.keys(patch) as (keyof STPlayerRecord & string)[];
        // One semantic action (a kill/revival) may touch several fields at
        // once (alive, ghostVote, exiled) -- diffFields collapses them into
        // exactly one record covering only what genuinely changed. Computed
        // up front (Phase 9D.4 Section 9), not only inside the Live-Play
        // History gate: a true no-op (e.g. reviving an already-alive,
        // never-exiled player) must skip Current State replacement and
        // Undo bookkeeping too, in Setup as much as in Live Play.
        const diff = diffFields(player, { ...player, ...patch }, touched);
        if (!diff) return;
        const updatedGame = patchPlayer(game, id, patch);
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "life", playerId: id, change: { kind: "value", ...diff },
            ...(context?.provenance ? { provenance: context.provenance } : {}),
          })),
        });
      },

      setGhostVote: (id, ghostVote, context) => {
        const { game, undoStack } = get();
        if (!game) return;
        const player = game.players[id];
        if (!player) return;
        if (player.ghostVote === ghostVote) return; // true no-op
        const updatedGame = patchPlayer(game, id, { ghostVote });
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "life", playerId: id,
            change: { kind: "value", from: { ghostVote: player.ghostVote }, to: { ghostVote } },
            ...(context?.provenance ? { provenance: context.provenance } : {}),
          })),
        });
      },

      setAbilityUsed: (id, abilityUsed) => {
        const { game, undoStack } = get();
        if (!game) return;
        set({
          undoStack: pushUndo(game, undoStack),
          game: patchPlayer(game, id, { abilityUsed }),
        });
      },

      // Phase 9D.1: the legacy Drunk/Poisoned/Protected toggle no longer
      // writes the bare `statuses` bag. It manages exactly its own
      // deterministic manual effect (manualEffectId(status)) -- never a
      // differently-sourced effect of the same type, so a future
      // ability-created effect (e.g. a Poisoner's "poisoned") can coexist
      // with a manual Storyteller toggle of the same type.
      setStatus: (id, status, on) => {
        const { game, undoStack } = get();
        if (!game) return;
        const player = game.players[id];
        if (!player) return;
        const effectId = manualEffectId(status);
        const existing = player.effects.find((e) => e.id === effectId);
        // Phase 9R.1 (Finding B5): currentGameMoment(game) is undefined once
        // the game has ended -- omit `appliedAt` entirely rather than storing
        // it as a literal `undefined` property (Firebase RTDB rejects that).
        const appliedAt = currentGameMoment(game);
        const newEffect: EffectRecord | null = on
          ? { id: effectId, type: status, lifetime: { kind: "manual" as const }, ...(appliedAt ? { appliedAt } : {}) }
          : null;
        // A true no-op (re-toggling an already-active manual effect to the
        // identical shape, or toggling off something not currently active)
        // skips Current State replacement and Undo bookkeeping entirely
        // (Phase 9D.4 Section 9) -- not only the History record.
        if (on && existing && sameSnapshot(existing, newEffect)) return;
        if (!on && !existing) return;
        const others = player.effects.filter((e) => e.id !== effectId);
        const effects = on ? [...others, newEffect!] : others;
        const updatedGame = patchPlayer(game, id, { effects });
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => on
            ? { category: "effect", playerId: id, change: { kind: "added", item: newEffect! } }
            : { category: "effect", playerId: id, change: { kind: "removed", item: existing! } }),
        });
      },

      addEffect: (id, effect) => {
        const { game, undoStack } = get();
        if (!game) return null;
        const player = game.players[id];
        if (!player) return null;
        const effectId = effect.id ?? newId();
        // Phase 9R.1 (Finding B4/B5): own a deep-cloned, undefined-stripped
        // snapshot of the caller's input -- a shallow `{ ...effect, id }`
        // still shares nested objects (lifetime, appliedAt, ...) by
        // reference with whatever the caller passed in.
        const record: EffectRecord = cloneOwned({ ...effect, id: effectId });
        const existing = player.effects.find((e) => e.id === effectId);
        // True no-op: an identical effect already exists under this id.
        if (existing && sameSnapshot(existing, record)) return effectId;
        const others = player.effects.filter((e) => e.id !== effectId);
        const updatedGame = patchPlayer(game, id, { effects: [...others, record] });
        const provenance = provenanceOf(record);
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "effect", playerId: id,
            change: { kind: "added", item: record },
            ...(provenance ? { provenance } : {}),
          })),
        });
        return effectId;
      },

      removeEffect: (id, effectId) => {
        const { game, undoStack } = get();
        if (!game) return;
        const player = game.players[id];
        const existing = player?.effects.find((e) => e.id === effectId);
        if (!player || !existing) return;
        const updatedGame = patchPlayer(game, id, { effects: player.effects.filter((e) => e.id !== effectId) });
        const provenance = provenanceOf(existing);
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "effect", playerId: id,
            change: { kind: "removed", item: existing },
            ...(provenance ? { provenance } : {}),
          })),
        });
      },

      setReminders: (id, reminders) => {
        const { game, undoStack } = get();
        if (!game) return;
        // Phase 9R.1 follow-up (residual B4/B5): `[...reminders]` only
        // copies the array itself -- each ReminderRecord inside (and its
        // nested `lifetime` object) was still the caller's own reference.
        // cloneOwned() deep-clones every element and strips any explicit
        // `undefined` optional key, matching the same ownership boundary
        // addEffect/addReminder/recordInformationDelivery already use.
        // History/Undo/no-op behavior here is deliberately unchanged --
        // out of scope for this follow-up (reserved for Phase 9R.4).
        set({
          undoStack: pushUndo(game, undoStack),
          game: patchPlayer(game, id, { reminders: cloneOwned(reminders) }),
        });
      },

      addReminder: (id, reminder) => {
        const { game, undoStack } = get();
        if (!game) return null;
        const player = game.players[id];
        if (!player) return null;
        const reminderId = reminder.id ?? newId();
        // Phase 9R.1 (Finding B4/B5): see addEffect's identical rationale.
        const record: ReminderRecord = cloneOwned({ ...reminder, id: reminderId });
        const existing = player.reminders.find((r) => r.id === reminderId);
        // True no-op: an identical reminder already exists under this id.
        if (existing && sameSnapshot(existing, record)) return reminderId;
        const updatedGame = patchPlayer(game, id, {
          reminders: [...player.reminders.filter((r) => r.id !== reminderId), record],
        });
        const provenance = provenanceOf(record);
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "reminder", playerId: id,
            change: { kind: "added", item: record },
            ...(provenance ? { provenance } : {}),
          })),
        });
        return reminderId;
      },

      removeReminder: (id, reminderId) => {
        const { game, undoStack } = get();
        if (!game) return;
        const player = game.players[id];
        const existing = player?.reminders.find((r) => r.id === reminderId);
        if (!player || !existing) return;
        const updatedGame = patchPlayer(game, id, { reminders: player.reminders.filter((r) => r.id !== reminderId) });
        const provenance = provenanceOf(existing);
        set({
          undoStack: pushUndo(game, undoStack),
          game: recordIfLive(game, updatedGame, () => ({
            category: "reminder", playerId: id,
            change: { kind: "removed", item: existing },
            ...(provenance ? { provenance } : {}),
          })),
        });
      },

      recordInformationDelivery: (recipientPlayerId, informationActionId, values, context) => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        // 1-2. Recipient exists and has an Actual Role.
        const player = game.players[recipientPlayerId];
        if (!player) return { ok: false, message: "This player is not seated." };
        if (!player.actualRole) return { ok: false, message: "This player has no Actual Role yet." };
        const script = selectScriptById(get(), game.scriptId);
        if (!script) return { ok: false, message: "Unknown script." };
        const registry = buildRegistry(script);
        // 3. Information Action belongs to that Role. A malformed Role
        // definition with two Actions sharing one id must fail safely
        // rather than silently using whichever Array.find() finds first.
        const matchingActions = registry
          .informationActionsOf(player.actualRole)
          .filter((a) => a.id === informationActionId);
        if (matchingActions.length === 0) {
          return { ok: false, message: `"${player.actualRole}" has no Information Action "${informationActionId}".` };
        }
        if (matchingActions.length > 1) {
          return { ok: false, message: `Malformed Role Information: duplicate Information Action id "${informationActionId}".` };
        }
        const action = matchingActions[0]!;
        // 4. Timing valid where timing is known.
        const timingCheck = validateInformationTiming(action.timing, game);
        if (!timingCheck.ok) return timingCheck;
        // 5. Information Requirements are themselves coherent.
        const coherence = validateRequirementsCoherent(action.requirements);
        if (!coherence.ok) return coherence;
        // 6. Complete runtime structural validation (Phase 9R.1 Astra
        // remediation, Finding A1): TypeScript's InformationValue union
        // constrains authoring, never a runtime caller. Parses `values`
        // against the canonical InformationValueSchema and, from here on,
        // uses ONLY the schema-parsed (canonical) representation -- never
        // the raw caller input -- so a structurally malformed or
        // extra-property-bearing value can never reach reference
        // validation or storage.
        const parsedValues = parseInformationValues(values);
        if (!parsedValues.ok) return parsedValues;
        // 7-8. Information Values reference real Players/Roles in the
        // current authoritative snapshot / active Role registry, and
        // satisfy each Requirement's declared cardinality.
        const validation = validateInformationValues(action.requirements, parsedValues.values, {
          // Phase 9R.1 (Finding B3.2): an own-property-safe existence check
          // -- `id in game.players` also resolves true for an inherited
          // Object.prototype property name (e.g. "toString"), which is
          // never an actual seated player.
          playerIds: { has: (id) => Object.prototype.hasOwnProperty.call(game.players, id) },
          roleIds: { has: (id) => !!registry.get(id) },
        });
        if (!validation.ok) return validation;

        // Phase 9R.1 (Finding B5): currentGameMoment(game) is undefined
        // once the game has ended -- omit `moment` entirely rather than
        // storing it as a literal `undefined` property.
        const moment = currentGameMoment(game);
        // Phase 9R.1 (Finding B4): own a deep-cloned, undefined-stripped
        // snapshot of the canonical parsed `values` (including nested
        // arrays like `playerIds`) and `context.provenance` -- neither may
        // keep sharing references with objects/arrays the caller still
        // owns.
        const record: InformationDeliveryRecord = cloneOwned({
          id: informationDeliveryId(),
          recipientPlayerId,
          actualRole: player.actualRole,
          informationActionId,
          ...(moment ? { moment } : {}),
          values: parsedValues.values,
          ...(context?.provenance ? { provenance: context.provenance } : {}),
        });
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, informationDeliveries: [...game.informationDeliveries, record] },
        });
        return { ok: true, id: record.id };
      },

      removeInformationDelivery: (deliveryId) => {
        const { game, undoStack } = get();
        if (!game) return;
        if (!game.informationDeliveries.some((d) => d.id === deliveryId)) return;
        set({
          undoStack: pushUndo(game, undoStack),
          game: {
            ...game,
            informationDeliveries: game.informationDeliveries.filter((d) => d.id !== deliveryId),
          },
        });
      },

      setNotes: (id, notes) => {
        const { game, undoStack } = get();
        if (!game) return;
        set({
          undoStack: pushUndo(game, undoStack),
          game: patchPlayer(game, id, { stNotes: notes }),
        });
      },

      setPhase: (phase) => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        if (game.phase === "ended" && phase !== "ended")
          return { ok: false, message: "This game has ended. Create a new setup to play again." };
        if (game.phase === "setup" && (phase === "night" || phase === "day")) {
          return get().beginNightOne();
        }
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, phase },
        });
        return { ok: true };
      },

      advancePhase: () => {
        const { game, undoStack } = get();
        if (!game) return { ok: false, message: "No game is open." };
        if (game.phase === "setup") return get().beginNightOne();
        let { phase, day } = game;
        if (phase === "night") {
          phase = "day";
        } else if (phase === "day") {
          phase = "night";
          day = day + 1;
        }
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, phase, day },
        });
        return { ok: true };
      },

      setNightStepStatus: (day, stepKey, status) => {
        const { game, undoStack } = get();
        if (!game) return;
        const key = `${day}:${stepKey}`;
        const np = game.nightProgress ?? {};
        const existing: NightStepRecord = np[key] ?? { status: "pending", notes: "" };
        let players = game.players;
        const traveler = Object.values(players).find(p => p.isTraveler && travelerNeedsFirstNight(p) &&
          (stepKey === `travelerArrival:${p.id}:${p.actualRole}` || day === 1 && stepKey === `p:${p.id}:${p.actualRole}`));
        if (traveler && game.phase === "night" && game.day === day && traveler.alive && !traveler.exiled) {
          const arrival = { ...(traveler.travelerArrival ?? newTravelerArrival()), firstNightComplete: status === "done" };
          if (status === "done") arrival.completedAtNight = day;
          else delete arrival.completedAtNight;
          players = { ...players, [traveler.id]: { ...traveler, travelerArrival: arrival } };
        }
        set({
          undoStack: pushUndo(game, undoStack),
          game: {
            ...game,
            players,
            nightProgress: { ...np, [key]: { ...existing, status } },
          },
        });
      },

      setNightStepNotes: (day, stepKey, notes) => {
        const { game } = get();
        if (!game) return;
        const key = `${day}:${stepKey}`;
        const np = game.nightProgress ?? {};
        const existing: NightStepRecord = np[key] ?? { status: "pending", notes: "" };
        // No undo push — avoid polluting undo stack with every keystroke.
        set({
          game: {
            ...game,
            nightProgress: { ...np, [key]: { ...existing, notes } },
          },
        });
      },

      clearNightProgress: (day) => {
        const { game, undoStack } = get();
        if (!game) return;
        const prefix = `${day}:`;
        const next: Record<string, NightStepRecord> = {};
        for (const [k, v] of Object.entries(game.nightProgress ?? {})) {
          if (!k.startsWith(prefix)) next[k] = v;
        }
        const players = Object.fromEntries(Object.entries(game.players).map(([id, p]) => {
          if (p.travelerArrival?.completedAtNight !== day) return [id, p];
          const arrival = { ...p.travelerArrival, firstNightComplete: false };
          delete arrival.completedAtNight;
          return [id, { ...p, travelerArrival: arrival }];
        }));
        set({
          undoStack: pushUndo(game, undoStack),
          game: { ...game, players, nightProgress: next },
        });
      },

      undo: () => {
        const { undoStack } = get();
        if (undoStack.length === 0) return;
        const previous = undoStack[undoStack.length - 1]!;
        // Undo can restore a pre-existing live snapshot after returning to Setup.
        // Validate that snapshot too; never use Undo as an unguarded first start.
        if (get().game?.phase === "setup" && (previous.phase === "night" || previous.phase === "day")) {
          const context = selectSetupContext({ ...previous, phase: "setup" }, selectScriptById(get(), previous.scriptId));
          if (!analyzeSetup(context).readiness.begin.ok) return;
        }
        set({
          game: clone(previous),
          undoStack: undoStack.slice(0, -1),
        });
      },

      setGrimoireMode: (mode) => set({ grimoireMode: mode }),

      setTokenPosition: (id, x, y) =>
        set((s) => ({
          tokenPositions: { ...s.tokenPositions, [id]: { x, y } },
        })),

      clearTokenPositions: () => set({ tokenPositions: {} }),

      ensureSyncScope: (code, sessionId) => set(state => {
        if (state.sync && state.sync.code === code && state.sync.sessionId === sessionId) return {};
        return { sync: { code, sessionId, ackedGuard: null, ackedGameSeq: 0, lastAttempt: null } };
      }),

      noteWriterAttempt: (code, sessionId, guard) => set(state => {
        if (!state.sync || state.sync.code !== code || state.sync.sessionId !== sessionId) return {};
        return { sync: { ...state.sync, lastAttempt: guard } };
      }),

      noteWriterAck: (code, sessionId, guard) => set(state => {
        if (!state.sync || state.sync.code !== code || state.sync.sessionId !== sessionId) return {};
        return {
          sync: {
            ...state.sync,
            ackedGuard: guard,
            // A successful active-writer acknowledgement reconciles the
            // matching lastAttempt; it must not clear an unrelated one (a
            // newer attempt already in flight would never equal this guard).
            lastAttempt: guardsEqual(state.sync.lastAttempt, guard) ? null : state.sync.lastAttempt,
          },
        };
      }),

      acknowledgeGameFlush: (code, sessionId, seqAtFlush) => set(state => {
        if (!state.sync || state.sync.code !== code || state.sync.sessionId !== sessionId) return {};
        if (state.sync.ackedGameSeq >= seqAtFlush) return {}; // never regress, never re-advance redundantly
        return { sync: { ...state.sync, ackedGameSeq: seqAtFlush } };
      }),

      promoteRecoveredAck: (code, sessionId, guard) => set(state => {
        if (!state.sync || state.sync.code !== code || state.sync.sessionId !== sessionId) return {};
        const attempt = state.sync.lastAttempt;
        if (!attempt || attempt.token !== guard.token || attempt.revision !== guard.revision) return {};
        const currentRevision = state.sync.ackedGuard?.revision ?? -1;
        return {
          sync: {
            ...state.sync,
            ackedGuard: guard.revision > currentRevision ? guard : state.sync.ackedGuard,
            lastAttempt: null,
          },
        };
      }),

      restoreRemoteCheckpoint: (game, guard) => set(state => ({
        game,
        undoStack: [],
        selectedPlayerId: null,
        // lastAttempt is always explicitly cleared here (Luna review,
        // Finding 1): a remote checkpoint being adopted — automatically
        // or explicitly — means whatever this local lineage was in the
        // middle of attempting is no longer relevant evidence. Preserving
        // it would let a stale attempt from BEFORE this restore later be
        // mistaken for a lost acknowledgement against a guard that is
        // actually a server rewind relative to the newly accepted
        // baseline.
        sync: state.sync && state.sync.code === game.code
          ? { ...state.sync, ackedGuard: guard, ackedGameSeq: state.localSeq, lastAttempt: null }
          : { code: game.code, sessionId: state.sync?.sessionId ?? state.lobby?.sessionId ?? "", ackedGuard: guard, ackedGameSeq: state.localSeq, lastAttempt: null },
        [SKIP_LOCAL_SEQ]: true,
      })),
      };
    },
    {
      name: "new-blood-st",
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: migrateStoreState,
      // Phase 9C.2B.2 (hardening): Zustand only invokes `migrate` above when
      // the persisted version differs from STORE_VERSION — a persisted blob
      // already tagged at the current version bypasses it (and therefore
      // migrateStoreState's own validation-or-reset tail) entirely,
      // hydrating unchanged no matter what it contains. `merge` runs on
      // EVERY rehydration regardless of version match, so routing the
      // (possibly already-migrated) persisted state through the exact same
      // canonical validator here — one path, never duplicated rules —
      // closes that gap without weakening or duplicating migration's own
      // cross-version behavior; a genuinely valid current-version save
      // still round-trips unchanged (migrateStoreState is a no-op once
      // fromVersion is no longer less than any of its own thresholds).
      merge: (persistedState, currentState) => {
        if (persistedState == null) return currentState;
        return { ...currentState, ...(migrateStoreState(persistedState, STORE_VERSION) as Partial<StorytellerStore>) };
      },
      partialize: (s) => ({
        game: s.game,
        view: s.view,
        undoStack: s.undoStack,
        customScripts: s.customScripts,
        lobby: s.lobby,
        grimoireMode: s.grimoireMode,
        tokenPositions: s.tokenPositions,
        localSeq: s.localSeq,
        sync: s.sync,
      }),
    }
  )
);

/** Own-property-safe lookup (Phase 9R.1 Astra remediation, Finding M1
 * follow-up): `BUILTIN_SCRIPTS[id] ?? s.customScripts[id]` alone resolves
 * an inherited Object.prototype member for `id` "__proto__"/"constructor"/
 * "toString" (e.g. `BUILTIN_SCRIPTS["__proto__"]` returns Object.prototype
 * itself, which is truthy) instead of correctly finding nothing. `id` is a
 * schema-validated string -- ANY string, including these -- once it has
 * passed through remote checkpoint recovery: StorytellerGamePersistedSchema
 * only requires scriptId to be a non-empty string, never that it names a
 * real script, so a scriptId of exactly "__proto__" legitimately reaches
 * this function as authoritative Current State, not merely as malformed
 * input a caller failed to sanitize. */
const ownScriptEntry = (scripts: Record<string, Script>, id: string): Script | undefined =>
  Object.prototype.hasOwnProperty.call(scripts, id) ? scripts[id] : undefined;

export const selectScriptById = (
  s: StorytellerStore,
  id: string
): Script | undefined => ownScriptEntry(BUILTIN_SCRIPTS, id) ?? ownScriptEntry(s.customScripts, id);
