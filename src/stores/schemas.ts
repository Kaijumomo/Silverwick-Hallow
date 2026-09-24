import { z } from "zod";

export const AlignmentSchema = z.enum(["good", "evil"]);

export const RoleTypeSchema = z.enum([
  "townsfolk",
  "outsider",
  "minion",
  "demon",
  "traveler",
  "fabled",
  "loric",
]);

export const BehaviorModeSchema = z.enum([
  "normal",
  "drunk_fake_role_behavior",
  "fake_demon_behavior",
  "marionette_fake_good_behavior",
  "poisoned",
  "custom",
]);

export const InformationTimingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("firstNight") }),
  z.object({ kind: z.literal("otherNight") }),
  z.object({ kind: z.literal("triggered") }),
  z.object({ kind: z.literal("manual") }),
]);

export const InformationRequirementKindSchema = z.enum([
  "number", "player", "role", "alignment", "boolean", "text",
]);

export const InformationCardinalitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exactly"), count: z.number().int().positive() }),
  z.object({ kind: z.literal("atLeast"), count: z.number().int().positive() }),
  z.object({ kind: z.literal("optional") }),
]);

export const InformationRequirementSchema = z.object({
  id: z.string().min(1),
  kind: InformationRequirementKindSchema,
  cardinality: InformationCardinalitySchema.optional(),
  label: z.string().optional(),
});

export const InformationActionSchema = z.object({
  id: z.string().min(1),
  timing: InformationTimingSchema,
  requirements: z.array(InformationRequirementSchema),
  instruction: z.string().optional(),
});

export const RoleDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: RoleTypeSchema,
    edition: z.string().optional(),
    alignment: AlignmentSchema.optional(),
    ability: z.string().optional(),
    flavor: z.string().optional(),
    icon: z.string().optional(),
    iconUrl: z.string().optional(),
    firstNight: z.number().optional(),
    otherNight: z.number().optional(),
    provenance: z.object({
      status: z.enum(["official", "official-experimental", "homebrew", "unverified"]),
      source: z.string().optional(), revision: z.string().optional(), verifiedAt: z.string().optional(),
    }).optional(),
    firstNightPrompt: z.string().optional(),
    otherNightPrompt: z.string().optional(),
    firstNightReminder: z.string().optional(),
    otherNightReminder: z.string().optional(),
    oncePerGame: z.boolean().optional(),
    setup: z.boolean().optional(),
    reminders: z.array(z.string()).optional(),
    remindersGlobal: z.array(z.string()).optional(),
    jinxes: z
      .array(z.object({ id: z.string().min(1), reason: z.string() }))
      .optional(),
    informationActions: z.array(InformationActionSchema).optional(),
  })
  .passthrough();

export const ScriptSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    author: z.string().optional(),
    characters: z.array(RoleDefSchema).min(1),
    fabled: z.array(RoleDefSchema).optional(),
  })
  .passthrough();

export const PrivateInfoSchema = z.object({
  travelerDemon: z.string().min(1).optional(),
  bluffs: z.array(z.string().min(1)).optional(),
  fakeMinions: z.array(z.string().min(1)).optional(),
  extraText: z.string().optional(),
});

export const StatusesSchema = z.record(z.string().min(1), z.boolean());

export const GamePhaseSchema = z.enum(["setup", "night", "day"]);

export const GameMomentSchema = z.object({
  phase: GamePhaseSchema,
  day: z.number().int().nonnegative(),
});

export const EffectLifetimeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("untilDawn") }),
  z.object({ kind: z.literal("throughFollowingDay") }),
  z.object({ kind: z.literal("untilNextNight") }),
  z.object({ kind: z.literal("nights"), count: z.number().int().positive() }),
  z.object({ kind: z.literal("days"), count: z.number().int().positive() }),
]);

/**
 * Phase 9R.2: a durable historical participant snapshot (see
 * ParticipantRef in types.ts). Both variants are `.strict()`: a snapshot is
 * exactly its declared fields -- in particular a "legacy" ref can never
 * smuggle a participantId/nameAtTime that migration deliberately refused to
 * invent.
 */
export const ParticipantRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("participant"),
    participantId: z.string().min(1),
    playerId: z.string().min(1),
    nameAtTime: z.string(),
  }).strict(),
  z.object({ kind: z.literal("legacy"), playerId: z.string().min(1) }).strict(),
]);

/**
 * Phase 9R.2: a pre-v17 PlayerId-only historical field that v16 -> v17
 * migration (gameMigration.ts) always converts to a ParticipantRef. Present
 * in a v17-shaped record, it means migration never ran on that record, so it
 * is REJECTED rather than silently stripped by zod's default unknown-key
 * handling -- the same absent-vs-malformed rule Phase 9R.1 Finding A3
 * applies everywhere else.
 */
const RetiredPlayerIdField = z.never().optional();

export const EffectRecordSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  sourceCharacter: z.string().min(1).optional(),
  sourceParticipant: ParticipantRefSchema.optional(),
  sourcePlayer: RetiredPlayerIdField,
  appliedAt: GameMomentSchema.optional(),
  lifetime: EffectLifetimeSchema,
  note: z.string().optional(),
});

export const ReminderRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sourceCharacter: z.string().min(1).optional(),
  sourceParticipant: ParticipantRefSchema.optional(),
  sourcePlayer: RetiredPlayerIdField,
  createdAt: GameMomentSchema.optional(),
  lifetime: EffectLifetimeSchema,
  note: z.string().optional(),
});

export const HistoryCategorySchema = z.enum(["identity", "alignment", "life", "effect", "reminder"]);

export const ProvenanceSchema = z.object({
  sourceParticipant: ParticipantRefSchema.optional(),
  sourcePlayer: RetiredPlayerIdField,
  sourceCharacter: z.string().min(1).optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

export const HistoryChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), from: z.record(z.string(), z.unknown()), to: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("added"), item: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("removed"), item: z.record(z.string(), z.unknown()) }),
]);

/**
 * Phase 9R.2 (Luna remediation): the participant-source identity contract an
 * Effect/Reminder snapshot stored inside History must obey -- exactly the
 * live EffectRecord/ReminderRecord's own source rules, picked from the
 * canonical schemas rather than hand-duplicated: a retired `sourcePlayer`
 * is rejected, and a present `sourceParticipant` must be a valid
 * ParticipantRef. Deliberately ONLY the identity fields: HistoryChange's
 * `item` stays a generic snapshot otherwise (Section 11 -- no tightening of
 * unrelated snapshot fields), and `z.object`'s default unknown-key handling
 * means every other key is simply not judged here.
 */
const HISTORY_SNAPSHOT_SOURCE_CONTRACT: Partial<Record<z.infer<typeof HistoryCategorySchema>, z.ZodTypeAny>> = {
  effect: EffectRecordSchema.pick({ sourceParticipant: true, sourcePlayer: true }),
  reminder: ReminderRecordSchema.pick({ sourceParticipant: true, sourcePlayer: true }),
};

export const HistoryRecordSchema = z.object({
  id: z.string().min(1),
  category: HistoryCategorySchema,
  participant: ParticipantRefSchema,
  playerId: RetiredPlayerIdField,
  moment: GameMomentSchema.optional(),
  change: HistoryChangeSchema,
  provenance: ProvenanceSchema.optional(),
  note: z.string().optional(),
}).superRefine((record, ctx) => {
  // An already-v17 record is never migrated again (detectLegacyGameVersion /
  // STORE_VERSION), so a stale v16-shaped source nested inside an
  // added/removed Effect/Reminder snapshot must fail validation here rather
  // than survive -- never silently stripped or converted.
  if (record.change.kind === "value") return;
  const contract = HISTORY_SNAPSHOT_SOURCE_CONTRACT[record.category];
  if (!contract) return;
  const checked = contract.safeParse(record.change.item);
  if (checked.success) return;
  for (const issue of checked.error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${record.category} History snapshot: ${issue.message}`,
      path: ["change", "item", ...issue.path],
    });
  }
});

// The non-Player Information Value variants are shared verbatim by the
// command-input (InformationValueSchema) and stored
// (RecordedInformationValueSchema) forms -- one definition, never two
// hand-duplicated copies.
// Phase 9R.1 Astra remediation (Finding A1): `.finite()` rejects NaN and
// ±Infinity structurally, at the schema itself -- the canonical
// definition every runtime caller (not just TypeScript-checked ones) is
// now validated against, rather than a hand-duplicated check elsewhere.
const NumberInformationValueSchema = z.object({ requirementId: z.string().min(1), kind: z.literal("number"), value: z.number().finite() });
const RoleInformationValueSchema = z.object({ requirementId: z.string().min(1), kind: z.literal("role"), roleId: z.string().min(1) });
const AlignmentInformationValueSchema = z.object({ requirementId: z.string().min(1), kind: z.literal("alignment"), alignment: AlignmentSchema });
const BooleanInformationValueSchema = z.object({ requirementId: z.string().min(1), kind: z.literal("boolean"), value: z.boolean() });
const TextInformationValueSchema = z.object({ requirementId: z.string().min(1), kind: z.literal("text"), value: z.string() });

/** Command INPUT form: Player-valued Information names live PlayerIds. */
export const InformationValueSchema = z.discriminatedUnion("kind", [
  NumberInformationValueSchema,
  z.object({ requirementId: z.string().min(1), kind: z.literal("player"), playerIds: z.array(z.string().min(1)) }),
  RoleInformationValueSchema,
  AlignmentInformationValueSchema,
  BooleanInformationValueSchema,
  TextInformationValueSchema,
]);

/** Phase 9R.2: the STORED form of an Information Value (see
 * RecordedInformationValue in types.ts) -- identical to the input form
 * except Player-valued Information, stored as ParticipantRefs rather than
 * reusable PlayerIds. */
export const RecordedInformationValueSchema = z.discriminatedUnion("kind", [
  NumberInformationValueSchema,
  z.object({
    requirementId: z.string().min(1),
    kind: z.literal("player"),
    participants: z.array(ParticipantRefSchema),
    playerIds: RetiredPlayerIdField,
  }),
  RoleInformationValueSchema,
  AlignmentInformationValueSchema,
  BooleanInformationValueSchema,
  TextInformationValueSchema,
]);

export const InformationDeliveryRecordSchema = z.object({
  id: z.string().min(1),
  recipient: ParticipantRefSchema,
  recipientPlayerId: RetiredPlayerIdField,
  actualRole: z.string().min(1),
  informationActionId: z.string().min(1),
  moment: GameMomentSchema.optional(),
  values: z.array(RecordedInformationValueSchema),
  provenance: ProvenanceSchema.optional(),
  note: z.string().optional(),
});

export const PlayerSelfRecordSchema = z.object({
  shownRole: z.string().min(1),
  shownAlignment: AlignmentSchema.optional(),
  demon: z.object({ id: z.string().min(1), name: z.string().min(1), seat: z.number().int().nonnegative() }).optional(),
  bluffs: z.array(z.string().min(1)).optional(),
  minions: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), seat: z.number().int().nonnegative(),
  })).optional(),
  extraText: z.string().optional(),
});

export const PrivatePacketSchema = z.object({
  id: z.string().min(1),
  payload: PlayerSelfRecordSchema,
  forDay: z.number().int().nonnegative().optional(),
  forPhase: z.enum(["setup", "night", "day", "ended"]).optional(),
});

export const STPlayerRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  seat: z.number().int().nonnegative(),
  joinedAt: z.number().int().nonnegative(),
  actualRole: z.string().min(1),
  shownRole: z.string().min(1).nullable(),
  shownAlignment: AlignmentSchema.nullable(),
  behaviorMode: BehaviorModeSchema,
  publicDisplayRole: z.string().min(1).nullable(),
  alive: z.boolean(),
  ghostVote: z.boolean(),
  abilityUsed: z.boolean(),
  statuses: StatusesSchema,
  reminders: z.array(ReminderRecordSchema),
  stNotes: z.string(),
  isTraveler: z.boolean(),
  actualAlignment: AlignmentSchema.optional(),
  effects: z.array(EffectRecordSchema),
  travelerArrival: z.object({
    demonInfoComplete: z.boolean(), firstNightComplete: z.boolean(),
    completedAtNight: z.number().int().positive().optional(),
    arrivalCheckComplete: z.boolean().optional(),
  }).optional(),
  exiled: z.boolean().optional(),
  privateInfo: PrivateInfoSchema.optional(),
  publishedPacket: PrivatePacketSchema.optional(),
  packetEpoch: z.string().optional(),
  participantId: z.string().min(1).optional(),
});

export const PlayerPublicRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  seat: z.number().int().nonnegative(),
  alive: z.boolean(),
  ghostVote: z.boolean(),
  online: z.boolean(),
  joinedAt: z.number().int().nonnegative(),
  isTraveler: z.boolean(),
  publicDisplayRole: z.string().min(1).optional(),
});

export const NightStepStatusSchema = z.enum(["pending", "done", "skipped"]);

export const NightStepRecordSchema = z.object({
  status: NightStepStatusSchema,
  notes: z.string(),
});

export const StorytellerLobbyRecordSchema = z.object({
  code: z.string().min(1),
  storytellerUid: z.string().min(1),
  scriptId: z.string().min(1),
  phase: z.enum(["setup", "night", "day", "ended"]),
  day: z.number().int().nonnegative(),
  bluffs: z.array(z.string().min(1)).default([]),
  fabled: z.array(z.string().min(1)).default([]),
  lorics: z.array(z.string().min(1)).default([]),
  notes: z.string(),
  players: z.record(z.string().min(1), STPlayerRecordSchema),
  seatOrder: z.array(z.string().min(1)),
  nightProgress: z.record(z.string().min(1), NightStepRecordSchema).default({}),
  rolePool: z.array(z.string().min(1)).default([]),
  plannedPlayerCount: z.number().int().nonnegative().default(0),
  plannedTravelerCount: z.number().int().nonnegative().default(0),
  setupRolesDealt: z.boolean().optional(),
  setupRolesRevealed: z.boolean().optional(),
  startingNonTravelerCount: z.number().int().positive().optional(),
  pendingPlayers: z.record(z.string(), z.string()).default({}),
  history: z.array(HistoryRecordSchema).default([]),
  informationDeliveries: z.array(InformationDeliveryRecordSchema).default([]),
});

export const PublicLobbyRecordSchema = z.object({
  code: z.string().min(1),
  scriptId: z.string().min(1),
  phase: z.enum(["setup", "night", "day", "ended"]),
  day: z.number().int().nonnegative(),
  seatOrder: z.array(z.string().min(1)),
  players: z.record(z.string().min(1), PlayerPublicRecordSchema),
  fabled: z.array(z.string().min(1)),
  lorics: z.array(z.string().min(1)).default([]),
  winner: AlignmentSchema.optional(),
  status: z.literal("ended").optional(),
});

// Looser variants for validating persisted (localStorage) state.
// actualRole may be "" for un-assigned / traveler players.
// name may be "" for pre-allocated empty seats.
// code may be "" for offline (no-Firebase) games.
//
// Phase 9R.2: every persisted/checkpointed seat must also satisfy the
// participant-identity invariant -- an occupied seat (`isEmpty` not true)
// carries its participation-instance ParticipantId, and an empty seat never
// carries one. v16 -> v17 migration establishes this for legacy data
// (gameMigration.ts); anything still violating it afterward is rejected,
// never repaired by inventing or reassigning an identity here.
const STPlayerRecordPersistedSchema = STPlayerRecordSchema.extend({
  actualRole: z.string(),
  name: z.string(),
  isEmpty: z.boolean().optional(),
  plannedTravelerSeat: z.boolean().optional(),
}).superRefine((player, ctx) => {
  if (player.isEmpty === true && player.participantId !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an empty seat must not carry a participant identity", path: ["participantId"] });
  }
  if (player.isEmpty !== true && player.participantId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an occupied seat must carry a participant identity", path: ["participantId"] });
  }
});

const hasOwn = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Phase 9R.5: a recovered game may only become authoritative when its
 * seat-bearing player records and seatOrder describe ONE coherent roster/seat
 * geometry. Each check was previously applied (if at all) to `players` and
 * `seatOrder` separately, so a save/checkpoint omitting a legitimate player
 * from seatOrder hydrated fine -- and removePlayer() later deleted that
 * unseated record as collateral. Enforced here, the one canonical persisted-
 * game validator, it covers local hydration (Current State and every Undo
 * snapshot, via StorytellerStateSchema) and remote checkpoint recovery
 * (readCheckpoint, after migration) alike:
 *
 *  1. every seatOrder entry is unique;
 *  2. every seatOrder id is an OWN property of players -- an inherited
 *     Object.prototype member ("toString", "constructor", ...) never counts;
 *  3. every own players key appears in seatOrder (exactly once, by 1);
 *  4. players[key].id === key;
 *  5. players[seatOrder[i]].seat === i.
 *
 * Read-only: a violation is reported, never repaired -- no sorting,
 * de-duplication, appending, id regeneration or renumbering, and no identity
 * or geometry is ever inferred from name, uid, seat number or History.
 */
function checkSeatGeometry(
  game: { players: Record<string, { id: string; seat: number }>; seatOrder: string[] },
  ctx: z.RefinementCtx,
): void {
  const seatIndexOf = new Map<string, number>();
  game.seatOrder.forEach((id, index) => {
    const first = seatIndexOf.get(id);
    if (first !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `seatOrder[${index}] duplicates seatOrder[${first}] (${JSON.stringify(id)})`, path: ["seatOrder", index] });
      return;
    }
    seatIndexOf.set(id, index);
    if (!hasOwn(game.players, id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `seatOrder[${index}] (${JSON.stringify(id)}) names no own player record`, path: ["seatOrder", index] });
      return;
    }
    const seat = game.players[id]!.seat;
    if (seat !== index) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `player seat ${seat} disagrees with its seatOrder index ${index}`, path: ["players", id, "seat"] });
    }
  });
  for (const [key, player] of Object.entries(game.players)) {
    if (player.id !== key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `player id ${JSON.stringify(player.id)} disagrees with its players key`, path: ["players", key, "id"] });
    }
    if (!seatIndexOf.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "player record is missing from seatOrder", path: ["players", key] });
    }
  }
}

export const StorytellerGamePersistedSchema = z.preprocess((raw, ctx) => {
  // Phase 9R.5: zod's record parsing silently DROPS an own "__proto__" key
  // (it cannot be assigned as an ordinary property of the output), so the
  // geometry check below -- which only sees parsed output -- could never
  // notice such a record was discarded. A player record under that key is
  // rejected here, against the raw candidate, rather than silently lost.
  // Never mutates or normalizes the candidate.
  if (isPlainRecord(raw) && isPlainRecord(raw.players) && hasOwn(raw.players, "__proto__")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a "__proto__" players key can never be a player record', path: ["players", "__proto__"] });
  }
  return raw;
}, StorytellerLobbyRecordSchema.extend({
  code: z.string(),
  storytellerUid: z.string(),
  players: z.record(z.string(), STPlayerRecordPersistedSchema),
  pendingPlayers: z.record(z.string(), z.string()).default({}),
}).superRefine(checkSeatGeometry));

export const GuardStampSchema = z.object({
  token: z.string().min(1),
  revision: z.number().int().nonnegative().safe(),
});

export const SyncMetaSchema = z.object({
  code: z.string().min(1),
  sessionId: z.string().min(1),
  ackedGuard: GuardStampSchema.nullable(),
  ackedGameSeq: z.number().int().nonnegative().safe(),
  lastAttempt: GuardStampSchema.nullable(),
});

export const StorytellerStateSchema = z.object({
  game: StorytellerGamePersistedSchema.nullable().optional(),
  view: z.enum(["home", "game", "newgame"]).optional(),
  undoStack: z.array(StorytellerGamePersistedSchema).optional(),
  customScripts: z.record(z.string(), ScriptSchema).optional(),
  lobby: z
    .object({
      code: z.string().min(1),
      uid: z.string().min(1),
      sessionId: z.string().optional(),
      status: z.enum(["live", "reconnecting"]),
    })
    .nullable()
    .optional(),
  grimoireMode: z.enum(["ring", "freeRoam"]).optional(),
  tokenPositions: z
    .record(z.object({ x: z.number(), y: z.number() }))
    .optional(),
  /** Local game-content mutation counter. Never wall-clock; see
   * src/firebase/reconnectDecision.ts. Legacy (pre-v12) states have none —
   * migration initializes it, never inferring evidence from prior content. */
  localSeq: z.number().int().nonnegative().safe().optional(),
  sync: SyncMetaSchema.nullable().optional(),
}).superRefine((data, ctx) => {
  // Phase 9C.2B.2 (hardening): sync metadata is only ever meaningful
  // alongside the localSeq counter it was watermarked against — never
  // "repair" one from the other by guessing which value is correct; a
  // structurally valid but semantically contradictory combination (e.g. an
  // acknowledged game sequence ahead of the local counter it can only ever
  // have been captured from, per acknowledgeGameFlush/restoreRemoteCheckpoint)
  // is exactly the shape reconnect logic must never trust as evidence.
  if (!data.sync) return;
  if (data.localSeq === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sync metadata present without a localSeq counter", path: ["localSeq"] });
    return;
  }
  if (data.sync.ackedGameSeq > data.localSeq) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sync.ackedGameSeq exceeds localSeq", path: ["sync", "ackedGameSeq"] });
  }
});
