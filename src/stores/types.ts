/** Live seat/slot address. A seat may be vacated and later reused by a
 * different person, so a PlayerId alone never identifies WHO a historical
 * record was about -- see ParticipantId/ParticipantRef (Phase 9R.2). */
export type PlayerId = string;
/**
 * Phase 9R.2: the immutable identity of ONE continuous participation
 * instance -- one real person occupying a seat in this game, from the
 * moment they occupy it until they are unseated or removed. Preserved
 * across seat movement, rename, Role/alignment changes, death, and every
 * other ordinary gameplay change; never reused for anyone else, and never
 * re-derived from name, uid, prior seat, or joinedAt. A person who later
 * returns is a NEW participation instance with a new ParticipantId. Not a
 * user account or cross-game identity -- Storyteller-private bookkeeping
 * only (never projected to public/self views).
 */
export type ParticipantId = string;
/**
 * Phase 9R.2: a durable, immutable snapshot of the participant a
 * historical record refers to. Stored wherever a record must keep meaning
 * "the person this was about" even after that seat is later reused
 * (History, Provenance, Information Delivery, Effect/Reminder sources).
 *
 *  - "participant": the authoritative identity is `participantId`;
 *    `playerId` is historical seat/slot context only, and `nameAtTime` is
 *    the name as it stood when the record was made -- never later
 *    re-derived from Current State (a rename never rewrites history).
 *  - "legacy": a pre-v17 PlayerId-only reference whose original
 *    participant cannot be proven. Deliberately carries NO participantId
 *    or name -- migration must never attach it to whoever currently
 *    occupies that PlayerId (Phase 9R.2 Section 6/22). Less informative,
 *    never falsely informative.
 *
 * Only ever built by participantRefOf()/legacyParticipantRef()
 * (src/stores/participants.ts) -- never hand-assembled by a command.
 */
export type ParticipantRef =
  | { kind: "participant"; participantId: ParticipantId; playerId: PlayerId; nameAtTime: string }
  | { kind: "legacy"; playerId: PlayerId };
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

export type InformationActionId = string;

/**
 * When, in BOTC play, an Information Action can occur. Reuses the same
 * night concepts RoleDef already carries (firstNight/otherNight) rather
 * than inventing a parallel timing model -- "triggered" and "manual" cover
 * the two shapes a fixed night cadence cannot: an Action that only occurs
 * on some condition (Ravenkeeper dying at night), and one the Storyteller
 * resolves at will with no fixed cadence at all. Phase 9D.3 does not model
 * the trigger CONDITION itself, only that one exists.
 */
export type InformationTiming =
  | { kind: "firstNight" }
  | { kind: "otherNight" }
  | { kind: "triggered" }
  | { kind: "manual" };

export type InformationRequirementKind = "number" | "player" | "role" | "alignment" | "boolean" | "text";

/** How many values a single Information Requirement expects. Omitted on a
 * requirement means exactly one -- the common case for every kind except
 * "player", where BOTC Roles frequently name two. */
export type InformationCardinality =
  | { kind: "exactly"; count: number }
  | { kind: "atLeast"; count: number }
  | { kind: "optional" };

/** One piece of structured information an Information Action expects the
 * Storyteller to record -- never the answer itself, only its shape. */
export type InformationRequirement = {
  /** Stable within its Information Action. */
  id: string;
  kind: InformationRequirementKind;
  cardinality?: InformationCardinality;
  /** Optional human-readable description of what this value represents
   * (e.g. "the two players shown", "the character learned"). */
  label?: string;
};

/**
 * A BOTC Role ability interaction where information is communicated to a
 * Recipient. Identifies which Role ability produced a later Information
 * Delivery Record and what structure the Storyteller is expected to
 * record for it -- never the answer, and never how to compute one.
 */
export type InformationAction = {
  /** Stable within its Role. */
  id: InformationActionId;
  timing: InformationTiming;
  requirements: InformationRequirement[];
  /** Optional descriptive prompt for the Storyteller, distinct from
   * RoleDef's own firstNightPrompt/otherNightPrompt (which describe the
   * whole night-order wake), scoped to this specific Action. */
  instruction?: string;
};

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
  /** Phase 9D.3: this Role's structured Information Actions, when known.
   * Absent means "not yet structured" -- never inferred from `ability`
   * prose. Overrides the centralized canonical definitions in
   * src/data/informationActions.ts for this exact Role id (see
   * RoleRegistry.informationActionsOf), so a custom/homebrew script can
   * define its own. */
  informationActions?: InformationAction[];
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

/** Phase 9R.2 audit: these PlayerIds deliberately stay LIVE seat
 * references, not ParticipantRefs -- this is the Storyteller's current,
 * unsent draft of what to show a player about who is here NOW, re-validated
 * against the current roster when previewed/published (see privatePackets).
 * What was actually delivered is snapshotted separately, with names, in
 * publishedPacket.payload. */
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
 * target player's own `effects` array.
 *
 * Phase 9R.2: `sourceParticipant` means "the participant who originally
 * caused this Effect" (a Poisoner Alice poisoning Carol) -- a historical
 * fact that must survive Alice leaving and Bob later occupying her seat,
 * so it is a durable ParticipantRef, never a reusable PlayerId. Callers
 * still name the source by live PlayerId (EffectInput.sourcePlayer);
 * addEffect converts it through participantRefOf() before storage. */
export type EffectRecord = {
  id: EffectId;
  type: string;
  sourceCharacter?: RoleId;
  sourceParticipant?: ParticipantRef;
  appliedAt?: GameMoment;
  lifetime: EffectLifetime;
  note?: string;
};

/** Phase 9R.2: addEffect's caller-facing input. The Storyteller selects a
 * CURRENT player as the source, so the source is a live PlayerId here and
 * only becomes a durable ParticipantRef once the command accepts it. A
 * caller can never supply a pre-built `sourceParticipant` snapshot. */
export type EffectInput = Partial<Pick<EffectRecord, "id">> &
  Omit<EffectRecord, "id" | "sourceParticipant"> & { sourcePlayer?: PlayerId };

export type ReminderId = string;

/** A single structured reminder token on a player (e.g. "Red Herring",
 * "Chosen", "Protected"). Target is implicit -- always the player whose
 * `reminders` array holds it. `sourceParticipant` follows the same
 * durable-source rule as EffectRecord's (Phase 9R.2). */
export type ReminderRecord = {
  id: ReminderId;
  label: string;
  sourceCharacter?: RoleId;
  sourceParticipant?: ParticipantRef;
  createdAt?: GameMoment;
  lifetime: EffectLifetime;
  note?: string;
};

/** Phase 9R.2: addReminder's caller-facing input -- see EffectInput. */
export type ReminderInput = Partial<Pick<ReminderRecord, "id">> &
  Omit<ReminderRecord, "id" | "sourceParticipant"> & { sourcePlayer?: PlayerId };

export type HistoryId = string;

/** The live-state domains Phase 9D.2 records. Generic recording is
 * preferred over one-off structures per feature; a new domain-specific
 * value here is warranted only when its game meaning would otherwise be
 * misrepresented as a lower-level field change (see "identity" vs
 * "alignment" vs "life", which share no fields but the same shapes). */
export type HistoryCategory = "identity" | "alignment" | "life" | "effect" | "reminder";

/**
 * What changed, generically enough to cover both:
 *  - a scalar/identity-like truth changing value ("value"), possibly
 *    across several fields touched by one semantic action; and
 *  - a structured record (an effect, a reminder) being introduced or
 *    withdrawn wholesale ("added"/"removed"), snapshotted so the entry
 *    remains meaningful even after the live item is edited or removed.
 * `from`/`to`/`item` are plain field-keyed snapshots, not full player
 * records -- only the fields the responsible mutation actually touched.
 */
export type HistoryChange =
  | { kind: "value"; from: Record<string, unknown>; to: Record<string, unknown> }
  | { kind: "added"; item: Record<string, unknown> }
  | { kind: "removed"; item: Record<string, unknown> };

/** Reusable "why/how" for any history record, and later for Phase 10
 * workflows that produce one. Every field is optional and none is ever
 * invented -- a manual Storyteller action legitimately has no known
 * source beyond the Storyteller themself.
 *
 * Phase 9R.2: this is the STORED form. `sourceParticipant` is the durable
 * participant responsible for the historical action -- never resolved
 * again from the current roster after storage. Callers supply Provenance
 * through ProvenanceInput (a live PlayerId), converted centrally before
 * any History/Information storage (see durableProvenance in
 * src/stores/participants.ts). */
export type Provenance = {
  sourceParticipant?: ParticipantRef;
  sourceCharacter?: RoleId;
  reason?: string;
  note?: string;
};

/** Phase 9R.2: the caller-facing (Mutation Context) form of Provenance.
 * The Storyteller names a CURRENT player as the source, so `sourcePlayer`
 * is a live PlayerId here; it becomes Provenance.sourceParticipant only
 * once the command accepts it. */
export type ProvenanceInput = {
  sourcePlayer?: PlayerId;
  sourceCharacter?: RoleId;
  reason?: string;
  note?: string;
};

/**
 * A single meaningful live-game mutation record. Storyteller-private;
 * lives only on the authoritative game snapshot (StorytellerLobbyRecord.
 * history), so it persists, checkpoints, reconnects, and undoes exactly
 * like every other piece of current state -- never a second, independent
 * audit log. Affected entity is always a player today; a future
 * non-player-scoped domain would add its own identifying field alongside
 * `participant`, not replace this type.
 *
 * Phase 9R.2: `participant` is the durable snapshot of WHO experienced the
 * mutation (previously a bare, reusable `playerId`). It keeps identifying
 * that person after they are unseated, their seat is refilled, they move,
 * or they are renamed. `participant.playerId` is historical seat context
 * only.
 */
export type HistoryRecord = {
  id: HistoryId;
  category: HistoryCategory;
  participant: ParticipantRef;
  /** Absent only when the moment genuinely isn't known -- never invented. */
  moment?: GameMoment;
  change: HistoryChange;
  provenance?: Provenance;
  note?: string;
};

/**
 * One piece of structured information the Storyteller actually recorded,
 * matching one Information Requirement by `requirementId`. Never computed
 * by Silverwick -- always exactly what the Storyteller entered. `player`
 * always carries an array (even for a single-Player requirement) so
 * cardinality is uniform to validate regardless of count.
 *
 * Phase 9R.2: this is the COMMAND INPUT form -- the Storyteller selects
 * CURRENT players, so `playerIds` are live seat addresses, validated
 * against the current roster. Once a delivery is accepted, it is stored
 * as RecordedInformationValue instead, never as reusable PlayerIds.
 */
export type InformationValue =
  | { requirementId: string; kind: "number"; value: number }
  | { requirementId: string; kind: "player"; playerIds: PlayerId[] }
  | { requirementId: string; kind: "role"; roleId: RoleId }
  | { requirementId: string; kind: "alignment"; alignment: Alignment }
  | { requirementId: string; kind: "boolean"; value: boolean }
  | { requirementId: string; kind: "text"; value: string };

/** Phase 9R.2: the STORED form of one Information Value. Identical to
 * InformationValue except Player-valued Information, which is stored as
 * immutable ParticipantRefs -- "the players shown were Alice and Carol",
 * never "whoever now sits in seats P2 and P3". */
export type RecordedInformationValue =
  | Exclude<InformationValue, { kind: "player" }>
  | { requirementId: string; kind: "player"; participants: ParticipantRef[] };

export type InformationDeliveryId = string;

/**
 * Storyteller-private record of information actually communicated to a
 * Recipient through one of their Actual Role's Information Actions. This
 * is bookkeeping about a communication event, not a History Record (see
 * src/stores/history.ts) -- recording one never itself mutates Current
 * State. `actualRole` is a snapshot: if the Recipient's Actual Role later
 * changes, this record keeps identifying the Role that actually produced
 * the information, never the Recipient's current one.
 *
 * Phase 9R.2: `recipient` is likewise a snapshot of WHO received it
 * (previously a bare, reusable `recipientPlayerId`) -- renaming, leaving,
 * changing Role, or the seat being refilled by someone else never changes
 * the meaning of a delivery.
 */
export type InformationDeliveryRecord = {
  id: InformationDeliveryId;
  recipient: ParticipantRef;
  /** Snapshot of the Recipient's Actual Role at the moment of delivery --
   * never re-derived from their Current State. */
  actualRole: RoleId;
  informationActionId: InformationActionId;
  /** Absent only when the moment genuinely isn't known -- never invented. */
  moment?: GameMoment;
  values: RecordedInformationValue[];
  provenance?: Provenance;
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
  /** Phase 9R.2: the current occupant's participation-instance identity
   * (see ParticipantId). Present exactly when the seat is occupied
   * (`!isEmpty`); an empty seat never carries one. Generated fresh only by
   * occupySeat() (storytellerStore.ts) when a real person enters a seat,
   * cleared by unseatPlayer(), and never changed by any other command.
   * Storyteller-private -- never projected. */
  participantId?: ParticipantId;
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
  /** Phase 9D.2: structured, Storyteller-private bookkeeping of meaningful
   * live-game mutations -- explanatory record, never authoritative truth.
   * Only Night/Day mutations ever append here (see isLiveGamePhase in
   * ./history.ts); Setup construction, corrections, and identity
   * preparation never do. Current state alone remains gameplay truth: a
   * missing or stale history entry never changes it, and nothing is ever
   * reconstructed from this array. */
  history: HistoryRecord[];
  /** Phase 9D.3: Storyteller-private bookkeeping of information actually
   * communicated through a Role's Information Actions. Distinct from
   * `history` -- recording an Information Delivery is not itself a
   * Mutation to Current State (see src/stores/informationDelivery.ts).
   * Never used to reconstruct Actual Role, Actual Alignment, Effects,
   * Reminders, or Life State; Current State alone remains authoritative. */
  informationDeliveries: InformationDeliveryRecord[];
};

/** Delivered identity at player/{id}; an absent record means unrevealed.
 * Phase 9R.2 audit: a player-facing projection, never Storyteller
 * bookkeeping -- `demon`/`minions` already snapshot name+seat at
 * publication time and are invalidated on identity resets, and participant
 * identity is deliberately never exposed here (Section 20). */
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
