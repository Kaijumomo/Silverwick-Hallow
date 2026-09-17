export type PlayerId = string;
export type RoleId = string;
export type Alignment = "good" | "evil";
export type RoleType =
  | "townsfolk"
  | "outsider"
  | "minion"
  | "demon"
  | "traveler"
  | "fabled"
  | "loric";

export type BehaviorMode =
  | "normal"
  | "drunk_fake_role_behavior"
  | "fake_demon_behavior"
  | "marionette_fake_good_behavior"
  | "poisoned"
  | "custom";

export type RoleDef = {
  provenance?: {
    status: "official" | "official-experimental" | "homebrew" | "unverified";
    source?: string;
    revision?: string;
    verifiedAt?: string;
  };
  id: RoleId;
  name: string;
  type: RoleType;
  edition?: string;
  alignment?: Alignment;
  ability?: string;
  flavor?: string;
  icon?: string;
  iconUrl?: string;
  firstNight?: number;
  otherNight?: number;
  firstNightPrompt?: string;
  otherNightPrompt?: string;
  firstNightReminder?: string;
  otherNightReminder?: string;
  oncePerGame?: boolean;
  setup?: boolean;
  reminders?: string[];
  remindersGlobal?: string[];
  jinxes?: { id: RoleId; reason: string }[];
  [extra: string]: unknown;
};

export type Script = {
  id: string;
  name: string;
  author?: string;
  characters: RoleDef[];
  fabled?: RoleDef[];
  [extra: string]: unknown;
};

export type PrivateInfo = {
  travelerDemon?: PlayerId;
  bluffs?: RoleId[];
  fakeMinions?: PlayerId[];
  extraText?: string;
};

export type PrivatePacket = {
  id: string;
  payload: PlayerSelfRecord;
  /** ST-only delivery context. Older snapshots may lack it. */
  forDay?: number;
  forPhase?: StorytellerLobbyRecord["phase"];
};

export type Statuses = Record<string, boolean>;

export type GamePhase = "setup" | "night" | "day";

/** A point in the game timeline, coarse enough for effect/reminder
 * provenance -- never wall-clock. Omitted on a record whose real moment is
 * not known (e.g. a migrated legacy record); never invented. */
export type GameMoment = {
  phase: GamePhase;
  day: number;
};

/** How long an effect or reminder is intended to remain, in vocabulary
 * only. Phase 9D.1 stores this intent; no phase yet executes automatic
 * expiry from it. */
export type EffectLifetime =
  | { kind: "manual" }
  | { kind: "untilDawn" }
  | { kind: "throughFollowingDay" }
  | { kind: "untilNextNight" }
  | { kind: "nights"; count: number }
  | { kind: "days"; count: number };

export type EffectId = string;

/** A single active effect on a player -- Drunk/Poisoned/Protected today,
 * any future ability-created effect later. `type` is a free-form semantic
 * label, not a closed enum: a manual Storyteller effect and a later
 * ability-sourced effect of the same `type` (e.g. two "poisoned" entries,
 * one manual and one from a Poisoner) must be able to coexist as distinct
 * records. Target is implicit -- an EffectRecord always lives on its
 * target player's own `effects` array. */
export type EffectRecord = {
  id: EffectId;
  type: string;
  sourceCharacter?: RoleId;
  sourcePlayer?: PlayerId;
  appliedAt?: GameMoment;
  lifetime: EffectLifetime;
  note?: string;
};

export type ReminderId = string;

/** A single structured reminder token on a player (e.g. "Red Herring",
 * "Chosen", "Protected"). Target is implicit -- always the player whose
 * `reminders` array holds it. */
export type ReminderRecord = {
  id: ReminderId;
  label: string;
  sourceCharacter?: RoleId;
  sourcePlayer?: PlayerId;
  createdAt?: GameMoment;
  lifetime: EffectLifetime;
  note?: string;
};

export type GrimoireMode = "ring" | "freeRoam";
export type TokenPosition = { x: number; y: number };

/** `writeGuard` is not literally allocated by Firebase: a SessionWriter reads
 * the current server guard after acquiring its lease, initializes its local
 * revision counter from that observation, and increments it locally for each
 * commit thereafter. Firebase rules enforce that accepted revisions only
 * increase. Treat a GuardStamp as client-allocated from server-observed
 * state, with server-enforced monotonic ordering — never as a timestamp. */
export type GuardStamp = {
  token: string;
  revision: number;
};

/** Persisted Storyteller reconnect/acknowledgement metadata, scoped to one
 * (code, sessionId) pair. See src/firebase/reconnectDecision.ts (Phase
 * 9C.2A, OPUS-001) for how this is used to decide reconnect outcomes. */
export type SyncMeta = {
  code: string;
  sessionId: string;
  /** Latest server guard this local store has positively accepted as its
   * durable baseline — from our own writer's success, or an accepted
   * (automatic or explicit) remote restore. */
  ackedGuard: GuardStamp | null;
  /** Highest local game sequence known to have been included in a
   * successful projection/checkpoint flush. */
  ackedGameSeq: number;
  /** Most recent allocated writer revision whose outcome may need
   * reconciliation after an interruption. An atomic token/revision pair —
   * never decomposed into independent loose fields that could accidentally
   * combine values from different writer instances. */
  lastAttempt: GuardStamp | null;
};

export type STPlayerRecord = {
  id: PlayerId;
  name: string;
  seat: number;
  joinedAt: number;
  actualRole: RoleId;
  /** Explicit intended identity for the next sync. Null means unrevealed. */
  shownRole: RoleId | null;
  /** Null derives from shownRole only; never from actual identity. */
  shownAlignment: Alignment | null;
  behaviorMode: BehaviorMode;
  publicDisplayRole: RoleId | null;
  alive: boolean;
  ghostVote: boolean;
  abilityUsed: boolean;
  statuses: Statuses;
  reminders: ReminderRecord[];
  stNotes: string;
  isTraveler: boolean;
  /** Current Storyteller truth for this player's alignment; never derived
   * from perception. Universal (Phase 9D.1): every player -- not only
   * Travelers -- may have one. Absent means unresolved; never invented for
   * a Traveler, and never overwritten by a later gameplay character change
   * (see freshAssignment vs assignRole in storytellerStore.ts). Use
   * actualAlignmentOf() (src/stores/effects.ts) for the explicit
   * Good/Evil/unresolved tri-state view. */
  actualAlignment?: Alignment;
  /** Structured active effects (Drunk, Poisoned, Protected, and any future
   * ability-created effect). Storyteller-private -- never projected to
   * public/self views. Replaces bare `statuses` booleans as the source of
   * truth; `statuses` is left in place only for legacy wire compatibility
   * and is no longer written by any command. */
  effects: EffectRecord[];
  /** Missing means legacy/unknown, not completed. No inferred arrival history. */
  travelerArrival?: { demonInfoComplete: boolean; firstNightComplete: boolean; completedAtNight?: number; arrivalCheckComplete?: boolean };
  exiled?: boolean;
  privateInfo?: PrivateInfo;
  /** Draft edits never imply delivery. The last sent snapshot is ST-only. */
  publishedPacket?: PrivatePacket;
  /** Invalidates in-flight publication when identity is reset. */
  packetEpoch?: string;
  /** True for pre-allocated seats that haven't been assigned to a player yet. */
  isEmpty?: boolean;
  /** Storyteller/setup planning metadata only, set exclusively on an empty
   * seat (isEmpty: true): this reservation represents unfulfilled planned
   * Traveler capacity, distinct from isTraveler (which represents an actual
   * Traveler player). Never public, never player identity. Consumed and
   * cleared the moment a real player occupies the seat -- see
   * arrivalPlayer() in storytellerStore.ts, which designates that occupant
   * a Traveler to fulfill the reservation, never double-counted against
   * plannedTravelerCount (Phase 9 Setup finalization, FINAL POPULATION
   * CLOSURE, Section 3). */
  plannedTravelerSeat?: boolean;
};

export type NightStepStatus = "pending" | "done" | "skipped";

export type NightStepRecord = {
  status: NightStepStatus;
  notes: string;
};

export type StorytellerLobbyRecord = {
  code: string;
  storytellerUid: string;
  scriptId: string;
  phase: "setup" | "night" | "day" | "ended";
  day: number;
  bluffs: RoleId[];
  fabled: RoleId[];
  lorics: RoleId[];
  notes: string;
  players: Record<PlayerId, STPlayerRecord>;
  seatOrder: PlayerId[];
  /** Keys: "${day}:${stepKey}" — e.g. "1:demonInfo", "2:p:abc123" */
  nightProgress: Record<string, NightStepRecord>;
  /** Pre-picked roles waiting to be dealt. ST-only — never written to public/*. */
  rolePool: RoleId[];
  /** Target total participant count chosen at New Game setup time. */
  plannedPlayerCount: number;
  /** Intended Traveler count out of plannedPlayerCount, chosen at New Game
   * setup time. Ordinary composition target = plannedPlayerCount -
   * plannedTravelerCount. Deliberately not auto-synced with actual seated
   * Traveler designations -- see setIsTraveler, which adjusts this value
   * explicitly as part of an in-Grimoire conversion. */
  plannedTravelerCount: number;
  /** Current preparation step; absent in legacy games. Not an event history. */
  setupRolesDealt?: boolean;
  /** True once the Storyteller has explicitly published the initial private
   * Deal to players. Deal never implies Reveal. Absent/false withholds
   * ordinary self projections even when every identity is complete; see
   * isInitialRevealComplete in ./identity.ts for the legacy day > 0
   * compatibility rule. Reset to false by a fresh initial dealRolePool(). */
  setupRolesRevealed?: boolean;
  /** Confirmed ordinary population at first successful start; unknown for legacy games. ST-only. */
  startingNonTravelerCount?: number;
  /** Players who have knocked but not yet been assigned to a seat. uid → requested name. */
  pendingPlayers: Record<string, string>;
};

/** Delivered identity at player/{id}; an absent record means unrevealed. */
export type PlayerSelfRecord = {
  shownRole: RoleId;
  /** Travelers have no default alignment. Only an explicit shown choice is sent. */
  shownAlignment?: Alignment;
  demon?: { id: PlayerId; name: string; seat: number };
  bluffs?: RoleId[];
  /** Names/seats selected by the ST at publication time; no actual roles. */
  minions?: { id: PlayerId; name: string; seat: number }[];
  extraText?: string;
};

export type PlayerPublicRecord = {
  id: PlayerId;
  name: string;
  seat: number;
  alive: boolean;
  ghostVote: boolean;
  online: boolean;
  joinedAt: number;
  isTraveler: boolean;
  publicDisplayRole?: RoleId;
};

export type PublicLobbyRecord = {
  code: string;
  scriptId: string;
  phase: "setup" | "night" | "day" | "ended";
  day: number;
  seatOrder: PlayerId[];
  players: Record<PlayerId, PlayerPublicRecord>;
  fabled: RoleId[];
  lorics: RoleId[];
  winner?: Alignment;
  /** Legacy projection marker; lifecycle state is authoritative in session. */
  status?: "ended";
};
