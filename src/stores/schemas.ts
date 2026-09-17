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

export const EffectRecordSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  sourceCharacter: z.string().min(1).optional(),
  sourcePlayer: z.string().min(1).optional(),
  appliedAt: GameMomentSchema.optional(),
  lifetime: EffectLifetimeSchema,
  note: z.string().optional(),
});

export const ReminderRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sourceCharacter: z.string().min(1).optional(),
  sourcePlayer: z.string().min(1).optional(),
  createdAt: GameMomentSchema.optional(),
  lifetime: EffectLifetimeSchema,
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
const STPlayerRecordPersistedSchema = STPlayerRecordSchema.extend({
  actualRole: z.string(),
  name: z.string(),
  isEmpty: z.boolean().optional(),
  plannedTravelerSeat: z.boolean().optional(),
});

export const StorytellerGamePersistedSchema = StorytellerLobbyRecordSchema.extend({
  code: z.string(),
  storytellerUid: z.string(),
  players: z.record(z.string(), STPlayerRecordPersistedSchema),
  pendingPlayers: z.record(z.string(), z.string()).default({}),
});

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
