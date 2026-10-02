import { z } from "zod";

export const AlignmentSchema = z.enum(["good", "evil"]);
/** Phase 10E (v23): STORED player-facing alignment perception. `undisclosed`
 * is perception only -- never an Actual Alignment, and never on the self wire
 * (PlayerSelfRecordSchema keeps AlignmentSchema). */
export const ShownAlignmentSchema = z.enum(["good", "evil", "undisclosed"]);

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

/** Phase 10A: a Game Moment inside Live Play (Night/Day, day >= 1). Also the
 * Phase 10B Effect expiry boundary. */
export const LiveGameMomentSchema = z.object({
  phase: z.enum(["night", "day"]),
  day: z.number().int().positive(),
}).strict();
/** A ParticipantRef naming a real participation instance (never "legacy"). */
export const CurrentParticipantRefSchema = ParticipantRefSchema.options[0];

/**
 * Phase 10B (store v20): the authoritative Effect lifecycle.
 *
 * `state` and `expiry` are REQUIRED on every current-version Effect -- a v20
 * Effect missing them is malformed current-version data and is rejected,
 * never defaulted here (v19 Effects receive them only from migration,
 * gameMigration.ts). Every lifecycle object is `.strict()`.
 */
export const EffectStateSchema = z.enum(["active", "suppressed"]);
export const EffectExpirySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("at"), moment: LiveGameMomentSchema }).strict(),
  z.object({ kind: z.literal("unresolved") }).strict(),
]);

/** A structured Effect parameter key: short and Firebase-key-safe. */
export const EFFECT_PARAMETER_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const MAX_EFFECT_PARAMETERS = 16;
export const MAX_EFFECT_PARAMETER_ITEMS = 20;
export const MAX_EFFECT_TEXT = 500;
/** STORED parameter values. Participant values are durable current-kind
 * ParticipantRefs (never live PlayerIds, never "legacy" refs); lists are
 * non-empty and bounded. */
export const EffectParameterValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("participant"),
    participants: z.array(CurrentParticipantRefSchema).min(1).max(MAX_EFFECT_PARAMETER_ITEMS) }).strict(),
  z.object({ kind: z.literal("role"),
    roleIds: z.array(z.string().min(1)).min(1).max(MAX_EFFECT_PARAMETER_ITEMS) }).strict(),
  z.object({ kind: z.literal("alignment"), alignment: AlignmentSchema }).strict(),
  z.object({ kind: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("text"), value: z.string().max(MAX_EFFECT_TEXT) }).strict(),
]);
export const EffectParametersSchema = z.record(z.string().regex(EFFECT_PARAMETER_KEY), EffectParameterValueSchema)
  .superRefine((params, ctx) => {
    const count = Object.keys(params).length;
    if (count === 0 || count > MAX_EFFECT_PARAMETERS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Effect parameters must hold 1-${MAX_EFFECT_PARAMETERS} entries (omit when none)` });
    }
  });

/** The Effect's field shape. `EffectRecordSchema` below adds strictness and
 * the lifecycle-consistency rule; History snapshot contracts pick from this
 * object (a refined schema cannot be picked from). */
const EffectRecordObject = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  sourceCharacter: z.string().min(1).optional(),
  sourceParticipant: ParticipantRefSchema.optional(),
  sourcePlayer: RetiredPlayerIdField,
  appliedAt: GameMomentSchema.optional(),
  lifetime: EffectLifetimeSchema,
  note: z.string().optional(),
  state: EffectStateSchema,
  expiry: EffectExpirySchema,
  parameters: EffectParametersSchema.optional(),
});

/** Phase 10B (SOL-10B-R7): Effect ids beginning `manual:` are reserved for
 * the Storyteller quick-control Effect of exactly that type. */
export const MANUAL_EFFECT_ID_PREFIX = "manual:";

/**
 * Record-level Effect validity. Never repaired -- a violation fails
 * validation.
 *
 * SOL-10B-R2 (truth hierarchy): `expiry` is the sole mechanical duration
 * authority; `lifetime` is the duration DECLARED when the Effect was
 * applied. Once an Effect exists, `none` and `at` are valid authoritative
 * expiries whatever the declared lifetime (an ordinary Update may extend,
 * shorten or end the automatic timer without rewriting what was declared).
 * The only record-level rule left is: `unresolved` -- migrated incomplete
 * legacy state -- exists only for a finite (non-manual) declared lifetime.
 * Initial coherence (manual -> none, finite -> exact `at`) is enforced where
 * an Effect is applied (the planner), not here.
 *
 * SOL-10B-R7 (manual namespace): a `manual:` id must be exactly
 * `manual:<type>`, declare a manual lifetime, and carry no source
 * participant or source character. Its authoritative expiry may still be
 * scheduled later (R2).
 */
function checkEffectRecord(
  effect: { id: string; type: string; lifetime: { kind: string }; expiry: { kind: string }; sourceParticipant?: unknown; sourceCharacter?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (effect.expiry.kind === "unresolved" && effect.lifetime.kind === "manual") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an unresolved expiry exists only for a finite legacy lifetime", path: ["expiry"] });
  }
  if (effect.id.startsWith(MANUAL_EFFECT_ID_PREFIX)) {
    if (effect.id !== MANUAL_EFFECT_ID_PREFIX + effect.type) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a manual: Effect id is reserved for the Storyteller quick Effect of exactly its type", path: ["id"] });
    }
    if (effect.lifetime.kind !== "manual") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a Storyteller quick Effect declares a manual lifetime", path: ["lifetime"] });
    }
    if (effect.sourceParticipant !== undefined || effect.sourceCharacter !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a Storyteller quick Effect has no source", path: ["sourceParticipant"] });
    }
  }
}

export const EffectRecordSchema = EffectRecordObject.strict().superRefine(checkEffectRecord);

/**
 * Phase 10C (store v21): a Reminder's cleanup hint -- presentation metadata
 * only (see ReminderCleanupCue in types.ts). `at` names an exact live moment;
 * `unresolved` exists only for migrated legacy finite-lifetime Reminders.
 * Absent = no cleanup hint. Never temporally judged against the current
 * moment: a cue at or before now is exactly what "Needs cleanup" means.
 */
export const ReminderCleanupCueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), moment: LiveGameMomentSchema }).strict(),
  z.object({ kind: z.literal("unresolved") }).strict(),
]);

/**
 * Phase 10C (store v21): the non-authoritative Reminder notation record.
 * `.strict()`: an unknown key -- including the retired v20 `lifetime`, a
 * retired v16 `sourcePlayer`, or any smuggled mechanical field -- is REJECTED,
 * never silently stripped. The label has no length rule here, so a long legacy
 * label migrates exactly; input limits live in the planner. Temporal validity
 * of `createdAt` is judged at the game boundary (checkReminderTemporalCoherence).
 */
export const ReminderRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sourceCharacter: z.string().min(1).optional(),
  sourceParticipant: ParticipantRefSchema.optional(),
  createdAt: GameMomentSchema.strict().optional(),
  cleanupCue: ReminderCleanupCueSchema.optional(),
  note: z.string().optional(),
}).strict();

/**
 * Phase 10C (LUNA-10C-001): EXACTLY what v20 accepted as a Reminder -- the
 * v20 ReminderRecordSchema, preserved verbatim for the v20 -> v21 migration
 * preflight only. Pre-v21 semantics, not a tightened v21 reading: `lifetime`
 * is REQUIRED (a valid v20 lifetime), a retired v16 `sourcePlayer` is
 * forbidden, and -- as in v20 -- unrecognized keys are not judged here (the
 * v20 gate stripped them); an occupied seat's Reminder must still pass the
 * strict v21 schema after migration. Never used to validate current data.
 */
export const LegacyV20ReminderRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sourceCharacter: z.string().min(1).optional(),
  sourceParticipant: ParticipantRefSchema.optional(),
  sourcePlayer: RetiredPlayerIdField,
  createdAt: GameMomentSchema.optional(),
  lifetime: EffectLifetimeSchema,
  note: z.string().optional(),
});

/**
 * Phase 10C: the identity contract a LEGACY (pre-v21, no `reminderOperation`)
 * Reminder History snapshot keeps obeying -- exactly the Phase 9R.2 source
 * rule it was written under (a retired `sourcePlayer` is rejected, a present
 * `sourceParticipant` must be a valid ParticipantRef). Every other key --
 * notably the old `lifetime` -- is deliberately NOT judged: legacy History
 * describes what the old system recorded and is never made invalid, or
 * rewritten, because Current State now uses a better Reminder representation.
 */
const LegacyReminderSnapshotSourceContract = z.object({
  sourceParticipant: ParticipantRefSchema.optional(),
  sourcePlayer: RetiredPlayerIdField,
});

// v18: canonical names only. The v17 "identity" category is renamed to "role"
// by migration (gameMigration.ts) and is never accepted here.
export const HistoryCategorySchema = z.enum(["role", "alignment", "life", "effect", "reminder"]);

export const ProvenanceSchema = z.object({
  sourceParticipant: ParticipantRefSchema.optional(),
  sourcePlayer: RetiredPlayerIdField,
  sourceCharacter: z.string().min(1).optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

/**
 * Phase 10B (ASTRA-10B-001): the CALLER-FACING Mutation Context an Effect
 * transaction accepts -- runtime-untrusted input, validated before anything
 * is converted or stored. Exactly the supported typed fields; `.strict()` so
 * an unknown key (including a smuggled durable `sourceParticipant`) is
 * refused, never stripped; nothing is coerced. The live `sourcePlayer` is
 * converted to a durable ParticipantRef only after this passes.
 */
export const ProvenanceInputSchema = z.object({
  sourcePlayer: z.string().min(1).optional(),
  sourceCharacter: z.string().min(1).optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
}).strict();
export const MutationContextInputSchema = z.object({
  provenance: ProvenanceInputSchema.optional(),
}).strict();

/**
 * Phase 10A: Life Event structure (store v19). Structural only -- ids,
 * ParticipantRef shape, Game Moment shape, kind, the outcome each kind
 * requires or forbids, the Day-only rule for execution/exile, optional
 * resolutionId and Provenance. Every variant is `.strict()`: an unknown key
 * (including a stray `outcome` on a death) is rejected, never stripped.
 *
 * Deliberately NOT judged here (Section 14): whether the subject is still
 * seated, whether the event is stale for the current phase, or whether
 * Current State agrees with it. Those are recoverable conditions that
 * command/query logic and the Storyteller's "Needs check" surface handle --
 * never a reason to reset local state or reject a checkpoint.
 */
const DayGameMomentSchema = z.object({ phase: z.literal("day"), day: z.number().int().positive() }).strict();
const lifeEventCommon = {
  id: z.string().min(1),
  subject: CurrentParticipantRefSchema,
  resolutionId: z.string().min(1).optional(),
  provenance: ProvenanceSchema.optional(),
};
export const LifeEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...lifeEventCommon, kind: z.literal("death"), moment: LiveGameMomentSchema }).strict(),
  z.object({ ...lifeEventCommon, kind: z.literal("resurrection"), moment: LiveGameMomentSchema }).strict(),
  z.object({ ...lifeEventCommon, kind: z.literal("execution"), moment: DayGameMomentSchema,
    outcome: z.enum(["died", "survived", "alreadyDead"]) }).strict(),
  z.object({ ...lifeEventCommon, kind: z.literal("exile"), moment: DayGameMomentSchema,
    outcome: z.enum(["died", "survived"]) }).strict(),
]);

/** Phase 10A: the Life Event Window. Event ids are unique within it (ids
 * are never reused); nothing else about the events' mutual consistency is
 * judged structurally.
 *
 * `events` defaults to [] exactly like `history`/`informationDeliveries`:
 * the Firebase RTDB `storyteller` projection drops an empty array, so an
 * RTDB-shaped copy of a game with no recent events legitimately arrives
 * without the key. Only an ABSENT list defaults -- a present malformed one
 * is still rejected -- and the window object itself stays required. */
export const LifeEventWindowSchema = z.object({
  coverageFrom: LiveGameMomentSchema,
  events: z.array(LifeEventSchema).default([]),
}).strict().superRefine((window, ctx) => {
  const seen = new Set<string>();
  window.events.forEach((event, index) => {
    if (seen.has(event.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate Life Event id", path: ["events", index, "id"] });
    }
    seen.add(event.id);
  });
});

/** Phase 10A: the ordered Life Event operations a "life" History Record
 * mirrors (10A-ASTRA-004). An array, never a set: order is transaction
 * order; at least one operation. */
const HistoryLifeEventOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added"), event: LifeEventSchema }).strict(),
  z.object({ kind: z.literal("removed"), event: LifeEventSchema }).strict(),
]);
const HistoryLifeEventSchema = z.object({
  operations: z.array(HistoryLifeEventOperationSchema).min(1),
}).strict();

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
  effect: EffectRecordObject.pick({ sourceParticipant: true, sourcePlayer: true }),
  reminder: LegacyReminderSnapshotSourceContract,
};

export const EffectHistoryOperationSchema = z.enum(["apply", "update", "remove", "suppress", "resume", "expire"]);
/** Phase 10B: the change shape each Effect lifecycle operation must use. */
const EFFECT_OPERATION_CHANGE: Record<z.infer<typeof EffectHistoryOperationSchema>, "added" | "removed" | "value"> = {
  apply: "added",
  remove: "removed",
  expire: "removed",
  update: "value",
  suppress: "value",
  resume: "value",
};

/** Phase 10C: the change shape each v21 Reminder operation must use. */
export const ReminderHistoryOperationSchema = z.enum(["place", "amend", "remove"]);
const REMINDER_OPERATION_CHANGE: Record<z.infer<typeof ReminderHistoryOperationSchema>, "added" | "removed" | "value"> = {
  place: "added",
  remove: "removed",
  amend: "value",
};

const addSnapshotIssues = (
  ctx: z.RefinementCtx, prefix: string, path: (string | number)[], issues: z.ZodIssue[],
) => {
  for (const issue of issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${prefix}: ${issue.message}`, path: [...path, ...issue.path] });
  }
};

/** Phase 10D (v22): the strict `from` / `to` snapshot of an Actual Role
 * History change -- only the Actual Role, never perception. */
const RoleHistorySnapshotSchema = z.object({ actualRole: z.string() }).strict();
/** Phase 10E (v23): the strict snapshots of an Actual Alignment History
 * change -- only the Actual Alignment, never perception. `to` is always
 * exactly `{ actualAlignment: good|evil }`; `from` is that, or the canonical
 * empty `{}` for an unresolved origin. */
const AlignmentHistoryToSchema = z.object({ actualAlignment: AlignmentSchema }).strict();
const AlignmentHistoryFromSchema = z.union([z.object({}).strict(), AlignmentHistoryToSchema]);

/**
 * SOL-10E-A5 (ASTRA-10E-005): the strict v23 Alignment snapshot contract,
 * checked against the RAW snapshot objects -- before the generic
 * `z.record` snapshot parser can drop an own key it cannot represent (e.g. a
 * JSON-parsed own `__proto__`). Applies only to an "alignment" record
 * carrying v23 metadata (`correction` / `resolutionId`) with a value change;
 * legacy Alignment History keeps its loose contract, and every other shape
 * is left to the parsed refinement below.
 */
function rawAlignmentSnapshotIssue(raw: unknown): string | null {
  if (!isPlainRecord(raw) || raw.category !== "alignment") return null;
  if (!hasOwn(raw, "correction") && !hasOwn(raw, "resolutionId")) return null;
  const change = raw.change;
  if (!isPlainRecord(change) || change.kind !== "value") return null;
  const exactAlignment = (side: unknown): boolean => isPlainRecord(side) &&
    Object.keys(side).length === 1 && hasOwn(side, "actualAlignment") && (side.actualAlignment === "good" || side.actualAlignment === "evil");
  const emptyOrAlignment = (side: unknown): boolean => (isPlainRecord(side) && Object.keys(side).length === 0) || exactAlignment(side);
  if (!emptyOrAlignment(change.from)) return "from";
  if (!exactAlignment(change.to)) return "to";
  return null;
}

const HistoryRecordObjectSchema = z.object({
  id: z.string().min(1),
  category: HistoryCategorySchema,
  participant: ParticipantRefSchema,
  playerId: RetiredPlayerIdField,
  moment: GameMomentSchema.optional(),
  change: HistoryChangeSchema.optional(),
  provenance: ProvenanceSchema.optional(),
  note: z.string().optional(),
  lifeEvent: HistoryLifeEventSchema.optional(),
  correction: z.literal(true).optional(),
  effectOperation: EffectHistoryOperationSchema.optional(),
  resolutionId: z.string().min(1).max(200).optional(),
  reminderOperation: ReminderHistoryOperationSchema.optional(),
}).superRefine((record, ctx) => {
  // Phase 10A: meaningful content. Every non-life record keeps its required
  // Current State `change` and never carries Life Event fields; a life
  // record carries a change, a mirrored Life Event, or both -- never
  // neither (no empty-diff record).
  if (record.category !== "life") {
    if (record.change === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a History Record must carry a change", path: ["change"] });
    }
    if (record.lifeEvent !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only a life History Record mirrors Life Events", path: ["lifeEvent"] });
    }
    // Phase 10B/10C/10D/10E: a correction is valid for "life", "effect",
    // "reminder", (v22) "role" and (v23) "alignment" only.
    if (record.correction !== undefined && record.category !== "effect" && record.category !== "reminder" &&
      record.category !== "role" && record.category !== "alignment") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only a life, effect, reminder, role or alignment History Record may be a correction", path: ["correction"] });
    }
  } else if (record.change === undefined && record.lifeEvent === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a life History Record must carry a change or a Life Event", path: ["change"] });
  }
  // Phase 10B: Effect lifecycle metadata belongs to "effect" records only;
  // Phase 10C: Reminder operation metadata to "reminder" records only, and a
  // resolutionId to either.
  if (record.category !== "effect" && record.effectOperation !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only an effect History Record carries Effect lifecycle metadata", path: ["effectOperation"] });
  }
  if (record.category !== "reminder" && record.reminderOperation !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only a reminder History Record carries a Reminder operation", path: ["reminderOperation"] });
  }
  if (record.resolutionId !== undefined && record.category !== "effect" && record.category !== "reminder" &&
    record.category !== "role" && record.category !== "alignment") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only an effect, reminder, role or alignment History Record carries a resolution id", path: ["resolutionId"] });
  }
  if (record.category === "role" && (record.correction !== undefined || record.resolutionId !== undefined)) {
    // Phase 10D (v22): a role record carrying v22-only metadata is a
    // NEW-shape Actual Role change: exactly `{ actualRole }` on each side.
    // (Legacy role History has neither key and keeps its original, looser
    // contract -- it is never rewritten into this shape.)
    const change = record.change;
    const strictSides = change?.kind === "value" &&
      RoleHistorySnapshotSchema.safeParse(change.from).success && RoleHistorySnapshotSchema.safeParse(change.to).success;
    if (!strictSides) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a role correction or correlated role record is a value change of exactly { actualRole }", path: ["change"] });
    }
  }
  if (record.category === "alignment" && (record.correction !== undefined || record.resolutionId !== undefined)) {
    // Phase 10E (v23): an alignment record carrying v23-only metadata is a
    // NEW-shape Actual Alignment change: a value change from `{}` (unresolved)
    // or `{ actualAlignment }` to exactly `{ actualAlignment }`. (Legacy
    // alignment History has neither key and keeps its original, looser
    // contract -- it is never rewritten into this shape.)
    const change = record.change;
    const strictSides = change?.kind === "value" &&
      AlignmentHistoryFromSchema.safeParse(change.from).success && AlignmentHistoryToSchema.safeParse(change.to).success;
    if (!strictSides) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an alignment correction or correlated alignment record is a value change from {} or { actualAlignment } to exactly { actualAlignment }", path: ["change"] });
    }
  }
  if (record.category === "reminder") {
    // Phase 10C: legacy (pre-v21) Reminder History has no operation, never a
    // correction and never a resolution id -- anything carrying those names
    // its v21 operation, and each operation has exactly one change shape.
    if (record.reminderOperation === undefined && (record.correction !== undefined || record.resolutionId !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a reminder correction or correlated reminder record must name its Reminder operation", path: ["reminderOperation"] });
    }
    if (record.reminderOperation && record.change && record.change.kind !== REMINDER_OPERATION_CHANGE[record.reminderOperation]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `a Reminder ${record.reminderOperation} is recorded as ${REMINDER_OPERATION_CHANGE[record.reminderOperation]}`, path: ["change", "kind"] });
    }
    // ASTRA-10C-002: pre-v21 Reminder mutation only ever added or removed a
    // Reminder, so a genuine legacy (operation-less) Reminder record is
    // `added` or `removed` -- never `value`. Such a record is an impossible
    // hybrid (it would otherwise bypass every snapshot contract), never
    // reinterpreted as a v21 amend.
    if (record.reminderOperation === undefined && record.change?.kind === "value") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a legacy Reminder History Record is an addition or a removal (a Reminder amend names its operation)", path: ["change", "kind"] });
    }
  }
  if (record.category === "effect") {
    // A v19 Effect record (no effectOperation) predates corrections, so an
    // effect correction always names its operation; expiry is gameplay
    // lifecycle, never a correction; and each operation has exactly one
    // truthful change shape.
    if (record.correction !== undefined && record.effectOperation === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an effect correction must name its Effect operation", path: ["effectOperation"] });
    }
    if (record.resolutionId !== undefined && record.effectOperation === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a correlated effect record must name its Effect operation", path: ["effectOperation"] });
    }
    if (record.effectOperation === "expire" && record.correction !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Effect expiry is never a correction", path: ["correction"] });
    }
    if (record.correction !== undefined && (record.effectOperation === "suppress" || record.effectOperation === "resume")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an effect correction is an apply, remove or update", path: ["effectOperation"] });
    }
    if (record.effectOperation && record.change && record.change.kind !== EFFECT_OPERATION_CHANGE[record.effectOperation]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `an Effect ${record.effectOperation} is recorded as ${EFFECT_OPERATION_CHANGE[record.effectOperation]}`, path: ["change", "kind"] });
    }
  }
  if (!record.change) return;
  // Phase 10B: a v20 Effect lifecycle record (one naming its operation)
  // snapshots COMPLETE current-version Effects -- the added/removed item, or
  // both value sides -- so a malformed lifecycle, parameter or source
  // structure can never hide inside History.
  const snapshots: { value: unknown; path: (string | number)[] }[] = record.change.kind === "value"
    ? [{ value: record.change.from, path: ["change", "from"] }, { value: record.change.to, path: ["change", "to"] }]
    : [{ value: record.change.item, path: ["change", "item"] }];
  if (record.category === "effect" && record.effectOperation !== undefined) {
    for (const snapshot of snapshots) {
      const checked = EffectRecordSchema.safeParse(snapshot.value);
      if (!checked.success) addSnapshotIssues(ctx, "effect History snapshot", snapshot.path, checked.error.issues);
    }
    return;
  }
  // Phase 10C: a v21 Reminder record (one naming its operation) snapshots
  // COMPLETE, strict v21 Reminders -- no lifetime, no smuggled key. Legacy
  // Reminder History (no operation) keeps only its original source contract
  // below and is never judged against the v21 record shape.
  if (record.category === "reminder" && record.reminderOperation !== undefined) {
    for (const snapshot of snapshots) {
      const checked = ReminderRecordSchema.safeParse(snapshot.value);
      if (!checked.success) addSnapshotIssues(ctx, "reminder History snapshot", snapshot.path, checked.error.issues);
    }
    return;
  }
  // An already-v17 record never goes through v16 -> v17 migration again
  // (detectLegacyGameVersion / STORE_VERSION), so a stale v16-shaped source
  // nested inside an added/removed Effect/Reminder snapshot must fail
  // validation here rather than survive -- never silently stripped or
  // converted. Phase 10B: an Effect `value` record's before/after snapshots
  // obey the same source contract (no v19 command ever wrote one).
  if (record.change.kind === "value" && record.category !== "effect") return;
  // ASTRA-10C-002: a v21-only cleanup cue inside an operation-less Reminder
  // snapshot is a modern/legacy hybrid, never genuine legacy History.
  if (record.category === "reminder") {
    for (const snapshot of snapshots) {
      if (isPlainRecord(snapshot.value) && hasOwn(snapshot.value, "cleanupCue")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a legacy Reminder History snapshot cannot carry a v21 cleanup cue", path: [...snapshot.path, "cleanupCue"] });
      }
    }
  }
  const contract = HISTORY_SNAPSHOT_SOURCE_CONTRACT[record.category];
  if (!contract) return;
  for (const snapshot of snapshots) {
    const checked = contract.safeParse(snapshot.value);
    if (!checked.success) addSnapshotIssues(ctx, `${record.category} History snapshot`, snapshot.path, checked.error.issues);
  }
});

export const HistoryRecordSchema = z.preprocess((raw, ctx) => {
  const side = rawAlignmentSnapshotIssue(raw);
  if (side !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["change", side],
      message: "an alignment correction or correlated alignment record is a value change from {} or { actualAlignment } to exactly { actualAlignment } -- no other own key" });
  }
  return raw;
}, HistoryRecordObjectSchema);

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

/** Phase 10F (v24): the bound on an Information Delivery's correlation id --
 * the same bound every other domain's `resolutionId` uses. */
export const MAX_RESOLUTION_ID_LENGTH = 200;

/**
 * Phase 10F (v24): one Information Delivery Record. STRICT -- an unknown or
 * malformed current-version field fails closed instead of being silently
 * stripped. `performedRole` names the character procedure actually performed
 * when it differs from the recipient's Actual Role (a simulated wake, e.g. a
 * Drunk shown as the Empath); it is never equal to `actualRole` and never
 * invented by migration. `resolutionId` is optional correlation metadata
 * shared with the other records one ability resolution produced (not an
 * idempotency key; never invented by migration).
 */
export const InformationDeliveryRecordSchema = z.object({
  id: z.string().min(1),
  recipient: ParticipantRefSchema,
  recipientPlayerId: RetiredPlayerIdField,
  actualRole: z.string().min(1),
  performedRole: z.string().min(1).optional(),
  informationActionId: z.string().min(1),
  moment: GameMomentSchema.optional(),
  values: z.array(RecordedInformationValueSchema),
  provenance: ProvenanceSchema.optional(),
  note: z.string().optional(),
  resolutionId: z.string().min(1).max(MAX_RESOLUTION_ID_LENGTH).optional(),
}).strict().superRefine((delivery, ctx) => {
  if (delivery.performedRole !== undefined && delivery.performedRole === delivery.actualRole) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "performedRole is recorded only when it differs from the Actual Role", path: ["performedRole"] });
  }
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
  shownAlignment: ShownAlignmentSchema.nullable(),
  behaviorMode: BehaviorModeSchema,
  publicDisplayRole: z.string().min(1).nullable(),
  alive: z.boolean(),
  ghostVote: z.boolean(),
  abilityUsed: z.boolean(),
  statuses: StatusesSchema,
  // Phase 10C: a Reminder's identity is (participant, id) -- ids are unique
  // within one participant's reminders[]; identical labels are distinct
  // instances and are never de-duplicated.
  reminders: z.array(ReminderRecordSchema).superRefine((reminders, ctx) => {
    const seen = new Set<string>();
    reminders.forEach((reminder, index) => {
      if (seen.has(reminder.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate Reminder id", path: [index, "id"] });
      seen.add(reminder.id);
    });
  }),
  stNotes: z.string(),
  isTraveler: z.boolean(),
  actualAlignment: AlignmentSchema.optional(),
  // Phase 10B: an Effect's identity is (participant, id) -- ids are unique
  // within one participant's effects[]; never de-duplicated by type/source.
  effects: z.array(EffectRecordSchema).superRefine((effects, ctx) => {
    const seen = new Set<string>();
    effects.forEach((effect, index) => {
      if (seen.has(effect.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate Effect id", path: [index, "id"] });
      seen.add(effect.id);
    });
  }),
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

/** Phase 10F (v24): a public player record. Life State (`alive`, `ghostVote`,
 * `exiled`) is ABSENT -- withheld, not false -- while the public phase is
 * Night (see publicLifeWithheld / checkPublicLifeWithholding); outside Night
 * `alive` and `ghostVote` are both present. */
export const PlayerPublicRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  seat: z.number().int().nonnegative(),
  alive: z.boolean().optional(),
  ghostVote: z.boolean().optional(),
  online: z.boolean(),
  joinedAt: z.number().int().nonnegative(),
  isTraveler: z.boolean(),
  publicDisplayRole: z.string().min(1).optional(),
  exiled: z.literal(true).optional(),
});

export const NightStepStatusSchema = z.enum(["pending", "done", "skipped"]);

export const NightStepRecordSchema = z.object({
  status: NightStepStatusSchema,
  notes: z.string(),
});

/** Phase 10B: the current game snapshot schema version (see
 * StorytellerLobbyRecord.gameSchemaVersion). Phase 10C: v21. Phase 10D: v22.
 * Phase 10E: v23. Phase 10F: v24. */
export const GAME_SCHEMA_VERSION = 24 as const;
/** Phase 10F: the explicit markers migration still accepts, routed PER ENTRY
 * (see migrateGameEntry): 20 receives v20 -> ... -> v24, 21 receives v21 ->
 * ... -> v24, 22 receives v22 -> v23 -> v24, 23 receives v23 -> v24, 24 is
 * current and receives nothing. Any other marker is never reinterpreted as
 * legacy -- the current schema rejects it. */
export const MIGRATABLE_GAME_SCHEMA_VERSIONS = [20, 21, 22, 23] as const;
/** The immediately previous explicit marker (v23 -> v24). */
export const PREVIOUS_GAME_SCHEMA_VERSION = 23 as const;

export const StorytellerLobbyRecordSchema = z.object({
  // Phase 10B (v20) / 10C (v21) / 10D (v22) / 10E (v23) / 10F (v24): required explicit version evidence, NO
  // default -- a current-version game missing it (or carrying any other
  // value, including a stale 20) is rejected; older data receives it only
  // from migration.
  gameSchemaVersion: z.literal(GAME_SCHEMA_VERSION),
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
  // Phase 10A (v19): required, with NO default -- a v19 game missing it is
  // incomplete current-version data and fails here; genuine v18 data gets it
  // from migration (gameMigration.ts), never from this schema.
  lifeEventWindow: LifeEventWindowSchema,
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
  // Phase 10B (SOL-10B-R1): an Effect belongs to a participation instance,
  // so an empty seat never owns one. Rejected, never repaired.
  if (player.isEmpty === true && player.effects.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an empty seat cannot own Effects", path: ["effects"] });
  }
  // Phase 10C: a Reminder belongs to exactly one participation instance, so
  // an empty seat never owns one. Rejected, never repaired (only the v20 ->
  // v21 migration step drops legacy empty-seat Reminders).
  if (player.isEmpty === true && player.reminders.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an empty seat cannot own Reminders", path: ["reminders"] });
  }
});

/** Timeline ordinal (Setup 0, Night N = 2N-1, Day N = 2N) -- the same
 * ordering lifeEvents.ts uses, restated here so the schema module stays
 * dependency-free. */
const ordinalOf = (moment: { phase: string; day: number }): number =>
  moment.phase === "night" ? 2 * moment.day - 1 : moment.phase === "day" ? 2 * moment.day : 0;

/**
 * Phase 10B (SOL-10B-R4): Effect temporal coherence against the game's own
 * current moment -- enforced here, at the persisted authoritative game
 * boundary every Current State, Undo snapshot and recovered checkpoint
 * passes. Never repaired: phase rollover must never be what conceals an
 * already-invalid overdue Effect.
 *
 *  - Night/Day: every `at` expiry is strictly after the current moment; an
 *    `appliedAt` is never after it (a Setup marker applied at {setup, 0}
 *    legitimately survives into Live Play).
 *  - Setup: no `at` expiry at all; a present `appliedAt` is {setup, 0}.
 *  - Ended: the final snapshot is frozen; no live moment is manufactured and
 *    this rule does not apply.
 */
/**
 * Phase 10B (SOL-10B-R4 / RC1): whether an Effect's `appliedAt` is coherent
 * with a game at `game.phase`/`game.day` under the monotonic v20 timeline --
 * the one rule both the persisted schema and v19 -> v20 migration use.
 *
 *  - Setup: the application moment is always exactly {setup, 0} (never
 *    derived from a legacy Setup `day`).
 *  - Night/Day: never after the current moment.
 *  - Ended (or an unusable phase): not judged here (a frozen snapshot).
 */
export function isEffectAppliedAtCoherent(
  game: { phase: string; day: number },
  applied: { phase: string; day: number },
): boolean {
  if (game.phase === "setup") return applied.phase === "setup" && applied.day === 0;
  if (game.phase === "night" || game.phase === "day") return ordinalOf(applied) <= ordinalOf(game);
  return true;
}

function checkEffectTemporalCoherence(
  game: { phase: string; day: number; players: Record<string, { effects: { expiry: { kind: string; moment?: { phase: string; day: number } }; appliedAt?: { phase: string; day: number } }[] }> },
  ctx: z.RefinementCtx,
): void {
  if (game.phase === "ended") return;
  const live = game.phase === "night" || game.phase === "day";
  const current = ordinalOf(game);
  for (const [key, player] of Object.entries(game.players)) {
    player.effects.forEach((effect, index) => {
      const path = ["players", key, "effects", index];
      if (effect.expiry.kind === "at" && effect.expiry.moment) {
        if (!live) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a Setup Effect has no timed expiry", path: [...path, "expiry"] });
        } else if (ordinalOf(effect.expiry.moment) <= current) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an Effect's expiry must be after the current Game Moment", path: [...path, "expiry"] });
        }
      }
      const applied = effect.appliedAt;
      if (!applied || isEffectAppliedAtCoherent(game, applied)) return;
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "appliedAt"], message: live
        ? "an Effect cannot have been applied after the current Game Moment"
        : "a Setup Effect is applied at the Setup moment" });
    });
  }
}

/**
 * Phase 10C: Reminder `createdAt` coherence against the game's own current
 * moment -- the same rule Effect `appliedAt` uses (isEffectAppliedAtCoherent):
 * a v21 createdAt never lies in the future relative to the snapshot holding
 * it (Setup: exactly {setup, 0}; Night/Day: not after now; ended: frozen, not
 * judged). Never repaired: only the v20 -> v21 migration omits an incoherent
 * LEGACY createdAt. A cleanup cue is deliberately not judged here.
 */
function checkReminderTemporalCoherence(
  game: { phase: string; day: number; players: Record<string, { reminders: { createdAt?: { phase: string; day: number } }[] }> },
  ctx: z.RefinementCtx,
): void {
  for (const [key, player] of Object.entries(game.players)) {
    player.reminders.forEach((reminder, index) => {
      if (!reminder.createdAt || isEffectAppliedAtCoherent(game, reminder.createdAt)) return;
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["players", key, "reminders", index, "createdAt"], message: game.phase === "setup"
        ? "a Setup Reminder is created at the Setup moment"
        : "a Reminder cannot have been created after the current Game Moment" });
    });
  }
}

/**
 * Phase 10C (ASTRA-10C-001): every OCCUPIED participant in Current State has
 * a ParticipantId that is unique within this game snapshot. Two current
 * player records sharing one participation-instance identity make every
 * ParticipantId-keyed rule ambiguous (Reminder/Effect identity, Life
 * grouping, source "still present?", future cross-planner composition), so
 * such a snapshot is invalid -- enforced here, at the one persisted-game
 * boundary every Current State, Undo snapshot and recovered checkpoint
 * passes. Never repaired: no id is regenerated, no occupant chosen, nothing
 * merged or inferred from PlayerId/name/UID.
 *
 * Only live roster records count. Empty seats carry no ParticipantId, and
 * historical ParticipantRefs (History, Provenance, Information Delivery,
 * Effect/Reminder origins, Life Events) legitimately repeat a current or
 * departed participant's id -- they are never part of this set.
 */
function checkCurrentParticipantIdentityUniqueness(
  game: { players: Record<string, { isEmpty?: boolean; participantId?: string }> },
  ctx: z.RefinementCtx,
): void {
  const holder = new Map<string, string>();
  for (const [key, player] of Object.entries(game.players)) {
    if (player.isEmpty === true || typeof player.participantId !== "string") continue;
    const first = holder.get(player.participantId);
    if (first !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["players", key, "participantId"],
        message: `occupied seats ${JSON.stringify(first)} and ${JSON.stringify(key)} carry the same current ParticipantId` });
      continue;
    }
    holder.set(player.participantId, key);
  }
}

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
}).superRefine((game, ctx) => {
  // SOL-10E-A3 (ASTRA-10E-003): Live Play has a valid live Game Moment --
  // Night/Day are day >= 1. Setup may be day 0; an ended snapshot keeps the
  // day it ended at. Rejected, never repaired.
  if ((game.phase === "night" || game.phase === "day") && game.day < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a Night/Day game must be on day 1 or later", path: ["day"] });
  }
  checkSeatGeometry(game, ctx);
  checkCurrentParticipantIdentityUniqueness(game, ctx);
  checkEffectTemporalCoherence(game, ctx);
  checkReminderTemporalCoherence(game, ctx);
}));

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
