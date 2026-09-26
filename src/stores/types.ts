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

/** Phase 10A: a Game Moment inside Live Play -- Night or Day, day >= 1.
 * Life Events only ever happen here; Setup and an ended game have none. */
export type LiveGameMoment = { phase: "night" | "day"; day: number };
/** Phase 10A: a Day moment. Executions and exiles are Day-only. */
export type DayGameMoment = { phase: "day"; day: number };

export type LifeEventId = string;
export type LifeEventKind = "death" | "execution" | "exile" | "resurrection";
/** How an execution resolved for its actual executee. An execution is not
 * a death: a player can survive one, and a dead player can be executed. */
export type ExecutionOutcome = "died" | "survived" | "alreadyDead";
/** How a Traveler exile resolved. Exile is never assumed to kill. */
export type ExileOutcome = "died" | "survived";

/** A durable ParticipantRef that names a real participation instance (never
 * a pre-v17 "legacy" ref). Every Life Event is recorded against one, since
 * Life Events only exist from v19 onward. */
export type CurrentParticipantRef = Extract<ParticipantRef, { kind: "participant" }>;

type LifeEventCommon = {
  /** Never reused, and never edited in place (Phase 10A Section 8). */
  id: LifeEventId;
  /** WHO the event happened to -- the actual executee/exilee, never
   * re-derived from whoever currently occupies `subject.playerId`. */
  subject: CurrentParticipantRef;
  /** Correlates several Life Events produced by ONE resolution (e.g. a
   * future multi-target ability). Absent for a single manual action. */
  resolutionId?: string;
  provenance?: Provenance;
};

/**
 * Phase 10A: one recent, mechanically relevant life/death event. Authoritative
 * temporary gameplay state held in `lifeEventWindow` -- NOT History. One
 * semantic action produces exactly one event per subject: an execution that
 * kills is `{ kind: "execution", outcome: "died" }`, never an execution plus
 * a separate death. A generic "did X die?" query therefore counts
 * `kind === "death"` OR `outcome === "died"` (see src/stores/lifeEvents.ts).
 *
 * Structurally, `outcome` is required for execution/exile and forbidden for
 * death/resurrection, and execution/exile moments are Day moments.
 */
export type LifeEvent =
  | (LifeEventCommon & { kind: "death"; moment: LiveGameMoment })
  | (LifeEventCommon & { kind: "resurrection"; moment: LiveGameMoment })
  | (LifeEventCommon & { kind: "execution"; moment: DayGameMoment; outcome: ExecutionOutcome })
  | (LifeEventCommon & { kind: "exile"; moment: DayGameMoment; outcome: ExileOutcome });

/**
 * Phase 10A: the Storyteller-private Life Event Window. Retains only Life
 * Events whose moment is the current phase or the immediately previous one;
 * every phase change prunes the rest (atomically, inside the same Undo step).
 * Never reconstructed from History, and never used to reconstruct Current
 * State.
 *
 * `coverageFrom` is the earliest Game Moment from which the ABSENCE of a
 * matching event may be read as "none occurred". Before it -- or outside the
 * retained phases -- absence is unknown, never "none". A fresh game covers
 * from Night 1; a game migrated from v18 mid-game starts coverage at the
 * NEXT phase (see migratedLifeEventCoverage in lifeEvents.ts), which can
 * legitimately be later than the current phase.
 */
export type LifeEventWindow = {
  coverageFrom: LiveGameMoment;
  /** In acceptance order. */
  events: LifeEvent[];
};

/** How long an effect or reminder is intended to remain, as vocabulary.
 * For a Reminder this is still intent only. For an Effect (Phase 10B) an
 * accepted finite lifetime is resolved ONCE, when the Effect is created, into
 * an exact `EffectExpiry` boundary (see resolveEffectExpiry in
 * effectResolution.ts); expiry mechanics read that resolved boundary, never
 * this vocabulary plus `appliedAt`. */
export type EffectLifetime =
  | { kind: "manual" }
  | { kind: "untilDawn" }
  | { kind: "throughFollowingDay" }
  | { kind: "untilNextNight" }
  | { kind: "nights"; count: number }
  | { kind: "days"; count: number };

export type EffectId = string;

/** Phase 10B: the Effect's explicit lifecycle state. `suppressed` is an
 * authoritative lifecycle DECISION that this Effect instance currently does
 * not apply; it still exists in Current State (same id, origin, application,
 * expiry and parameters) and is never deleted and later re-created from
 * History. Mechanical queries ignore it; inspection/audit queries return it.
 *
 * SOL-10B-R5: `state` is not a cache of every derived reason an Effect may
 * fail to operate (its source no longer functioning, other Effects, jinxes,
 * ability semantics...). A future rules engine (10F) derives applicability
 * FROM stored state and must never continuously write such conclusions into
 * `state`. */
export type EffectState = "active" | "suppressed";

/**
 * Phase 10B: the authoritative, already-resolved automatic expiry of an
 * Effect.
 *
 *  - `none`: no automatic phase expiry (a manual/indefinite Effect -- the
 *    Storyteller ends it).
 *  - `at`: the Effect expires when live play ENTERS exactly this Game Moment
 *    (or any later one) -- Night N -> Day N or Day N -> Night N+1, inside the
 *    same atomic phase rollover commit.
 *  - `unresolved`: a legacy (pre-v20) finite Effect whose exact boundary was
 *    never recorded. It never expires automatically and surfaces to the
 *    Storyteller as a concise "Needs check"; it is never guessed.
 *
 * SOL-10B-R2 truth hierarchy: `expiry` is the SOLE mechanical duration
 * authority. The declared `lifetime` establishes the initial expiry at Apply
 * (manual -> none; timed -> an exact future `at`) and is thereafter only
 * metadata; mechanics never recompute current truth from it. An ordinary
 * Update may set `none` or any strictly future `at` without rewriting the
 * declared lifetime; only a correction changes the declared lifetime.
 * Schema-enforced: `unresolved` exists only for a finite declared lifetime.
 */
export type EffectExpiry =
  | { kind: "none" }
  | { kind: "at"; moment: LiveGameMoment }
  | { kind: "unresolved" };

/**
 * Phase 10B: one STORED structured Effect parameter -- typed data future
 * mechanics can read without ever parsing a free-text `note`. Participant
 * values are durable ParticipantRefs (built centrally from live, bound
 * participants when the Effect is accepted), so a later occupant of the same
 * seat never silently becomes the referenced participant.
 */
export type EffectParameterValue =
  | { kind: "participant"; participants: CurrentParticipantRef[] }
  | { kind: "role"; roleIds: RoleId[] }
  | { kind: "alignment"; alignment: Alignment }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

/** Keyed by a short identifier (letters, digits, `_`, `-`; see
 * EFFECT_PARAMETER_KEY in schemas.ts). Absent when an Effect has none. */
export type EffectParameters = Record<string, EffectParameterValue>;

/** A single causal Effect on one participant -- Drunk/Poisoned/Protected
 * today, any future ability-created or homebrew Effect later. `type` is a
 * free-form semantic label, not a closed enum: a manual Storyteller effect
 * and a later ability-sourced effect of the same `type` (e.g. two "poisoned"
 * entries, one manual and one from a Poisoner) coexist as distinct records.
 * Target is implicit -- an EffectRecord always lives on its target
 * participant's own `effects` array, and its identity is that participant
 * plus `id` (unique within that array; not globally).
 *
 * `sourceParticipant`/`sourceCharacter` are the Effect's ORIGIN: what
 * originally caused it (a Poisoner Alice poisoning Carol). Phase 9R.2: the
 * origin is a durable ParticipantRef that survives Alice leaving and Bob
 * later occupying her seat; it is never rewritten by an ordinary update. The
 * provenance of each later lifecycle mutation (update, removal, ...) is
 * recorded separately, on its History Record.
 *
 * Phase 10B (store v20): `state`, `expiry` and optional `parameters` make
 * the lifecycle authoritative. Every change goes through the Effect planner
 * (effectResolution.ts). */
export type EffectRecord = {
  id: EffectId;
  type: string;
  sourceCharacter?: RoleId;
  sourceParticipant?: ParticipantRef;
  appliedAt?: GameMoment;
  /** The duration DECLARED when the Effect was applied (metadata; see
   * EffectExpiry for the authoritative end). */
  lifetime: EffectLifetime;
  note?: string;
  state: EffectState;
  expiry: EffectExpiry;
  parameters?: EffectParameters;
};

/** Phase 9R.2: addEffect's caller-facing input (a compatibility wrapper over
 * the Phase 10B Apply intent). The Storyteller selects a CURRENT player as
 * the source, so the source is a live PlayerId here and only becomes a
 * durable ParticipantRef once the command accepts it. A caller can never
 * supply a pre-built `sourceParticipant` snapshot, nor the lifecycle fields
 * the planner resolves itself. */
export type EffectInput = Partial<Pick<EffectRecord, "id">> &
  Omit<EffectRecord, "id" | "sourceParticipant" | "state" | "expiry" | "parameters"> & { sourcePlayer?: PlayerId };

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

/** The Current State domains Phase 9D.2 records. Generic recording is
 * preferred over one-off structures per feature; a new domain-specific
 * value here is warranted only when its game meaning would otherwise be
 * misrepresented as a lower-level field change (see "role" vs
 * "alignment" vs "life", which share no fields but the same shapes).
 *
 * "role" is a change to a player's Actual Role -- deliberately not a
 * generic "identity" category: participant identity (ParticipantRef) and
 * Actual/Shown perception are different concepts (see TERMINOLOGY.md).
 * v17 persisted this value as "identity"; the v17 -> v18 migration
 * (gameMigration.ts) renames it, and the v18 schema rejects the old name. */
export type HistoryCategory = "role" | "alignment" | "life" | "effect" | "reminder";

/**
 * What changed, generically enough to cover both:
 *  - a scalar truth (an Actual Role, an Actual Alignment, Life State)
 *    changing value ("value"), possibly across several fields touched by
 *    one semantic action; and
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
type HistoryRecordCommon = {
  id: HistoryId;
  participant: ParticipantRef;
  /** Absent only when the moment genuinely isn't known -- never invented. */
  moment?: GameMoment;
  provenance?: Provenance;
  note?: string;
};

/** Phase 10A: one Life Event Window operation, with an immutable snapshot
 * of the event added or removed. */
export type HistoryLifeEventOperation =
  | { kind: "added"; event: LifeEvent }
  | { kind: "removed"; event: LifeEvent };

/** Phase 10A: the Life Event Window changes a "life" History Record mirrors
 * for its participant, in TRANSACTION ORDER, so the record stays meaningful
 * after the events expire from the window. One atomic resolution may give
 * one participant several ordered events (10A-ASTRA-004: e.g. a
 * resurrection and then a death in the same resolution) -- both are kept,
 * even when the final alive value equals the initial one. At least one
 * operation is present. */
export type HistoryLifeEvent = {
  operations: HistoryLifeEventOperation[];
};

/**
 * Phase 10A: a "life" record carries meaningful content -- a Current State
 * diff (`change`), a mirrored Life Event (`lifeEvent`), or both. An
 * execution the executee survives changes no life field, yet its record
 * still explains what happened through its `lifeEvent` operations; there is no
 * empty-diff record. `correction: true` marks a Storyteller correction
 * (retract/amend/late record/status correction) as opposed to a gameplay
 * event. Every other category keeps its required `change` and never carries
 * `lifeEvent`/`correction`. Those per-category rules are enforced by
 * HistoryRecordSchema (schemas.ts) -- the one validator every persisted and
 * recovered game passes -- and by the commands that build records.
 */
export type HistoryRecord = HistoryRecordCommon & {
  category: HistoryCategory;
  change?: HistoryChange;
  lifeEvent?: HistoryLifeEvent;
  /** A Storyteller correction of wrongly recorded Current State, as opposed
   * to a gameplay mutation. Valid for "life" (Phase 10A) and, from v20,
   * "effect" records. Old History is never rewritten by a correction. */
  correction?: true;
  /** Phase 10B (v20), "effect" records only: which Effect lifecycle
   * operation this record explains -- the one thing the generic `change`
   * shape cannot tell apart (update vs suppress vs resume are all `value`;
   * remove vs expire are both `removed`). `expire` is the deterministic
   * phase-expiry provenance. */
  effectOperation?: EffectHistoryOperation;
  /** Phase 10B (v20), "effect" records only: correlation of the records one
   * Effect transaction produced (e.g. a future ability resolution).
   * Correlation METADATA only -- not an idempotency key, not authority, not
   * assumed globally unique. */
  resolutionId?: string;
};

/** Phase 10B: the Effect lifecycle operation an "effect" History Record
 * explains. `apply` = added, `remove`/`expire` = removed, and
 * `update`/`suppress`/`resume` = value (full before/after Effect snapshots).
 * A correction reuses apply/remove/update with `correction: true`. */
export type EffectHistoryOperation = "apply" | "update" | "remove" | "suppress" | "resume" | "expire";

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
  /** Phase 10A: true exactly when this player's CURRENT death resulted from
   * a Traveler exile. Only a dead Traveler may carry it; an exile the
   * Traveler survives never sets it; resurrection or a status correction
   * clears it (stored as an absent key). It is never the evidence that an
   * exile happened -- that is the exile Life Event (and its History). */
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
  /** Phase 10B: explicit game snapshot schema version evidence. Every
   * authoritative game snapshot (Current State, each Undo snapshot, the
   * remote checkpoint's game) carries it from v20 on. A snapshot carrying it
   * is never run through legacy migration -- malformed current-version data
   * fails validation instead of being "repaired". */
  gameSchemaVersion: 20;
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
  /** Phase 10A (store v19): Storyteller-private, authoritative temporary
   * gameplay state -- recent Life Events of the current and immediately
   * previous phase, plus the coverage bound that says when their absence is
   * meaningful. Not History (see LifeEventWindow). Required from v19;
   * migration adds it with honest coverage and never backfills events. */
  lifeEventWindow: LifeEventWindow;
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
  /** Phase 10A: present (true) only while this player's CURRENT death
   * resulted from a Traveler exile -- public table information, derived by
   * publicLifeOf() (src/stores/lifeState.ts). Absent otherwise. */
  exiled?: true;
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
