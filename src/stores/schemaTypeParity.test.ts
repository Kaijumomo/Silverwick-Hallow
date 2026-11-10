// @vitest-environment node
/**
 * F-16: the hand-written record types (types.ts) and the validators that check saved and remote data (schemas.ts)
 * must describe the same shapes. This file is checked by `npm run typecheck`. For the records checked with `Same`
 * (46 of 58), any field added, removed, retyped or made optional on one side only stops the matching line
 * compiling. The 12 checked with `Compatible` are explained above that helper. It costs nothing at run time.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type * as T from "./types";
import type * as S from "./schemas";

/** Strips `| undefined` from every property, so `a?: X` and `a?: X | undefined` read the same; keeps `?` and nesting. */
type Norm<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer E)[] ? Norm<E>[]
  : T extends object ? { [K in keyof T]: Norm<Exclude<T[K], undefined>> }
  : T;
/** Exact type equality after normalising: an extra, missing, retyped or optional-vs-required field all fail. */
type Same<A, B> = (<G>() => G extends Norm<A> ? 1 : 2) extends (<G>() => G extends Norm<B> ? 1 : 2) ? true : false;
/**
 * Weaker: each type is assignable to the other. Used only for the records marked below, whose two sides differ on
 * purpose: retired legacy fields the schema rejects (`sourcePlayer?: undefined`, `playerIds`), `?: never` fields the
 * types use to keep union members apart (voting and manual delivery records), and players or player envelopes
 * whose exported schema is the base that the persisted schema extends. This catches a changed or newly required
 * field, but not an extra optional one.
 */
type Compatible<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Parsed<K extends keyof typeof S> = (typeof S)[K] extends z.ZodTypeAny ? z.output<(typeof S)[K]> : never;

const parity = {
  Alignment: true as Same<Parsed<"AlignmentSchema">, T.Alignment>,
  ShownAlignment: true as Same<Parsed<"ShownAlignmentSchema">, T.ShownAlignment>,
  RoleType: true as Same<Parsed<"RoleTypeSchema">, T.RoleType>,
  BehaviorMode: true as Same<Parsed<"BehaviorModeSchema">, T.BehaviorMode>,
  InformationTiming: true as Same<Parsed<"InformationTimingSchema">, T.InformationTiming>,
  InformationRequirementKind: true as Same<Parsed<"InformationRequirementKindSchema">, T.InformationRequirementKind>,
  InformationCardinality: true as Same<Parsed<"InformationCardinalitySchema">, T.InformationCardinality>,
  InformationRequirement: true as Same<Parsed<"InformationRequirementSchema">, T.InformationRequirement>,
  InformationAction: true as Same<Parsed<"InformationActionSchema">, T.InformationAction>,
  RoleDef: true as Same<Parsed<"RoleDefSchema">, T.RoleDef>,
  Script: true as Same<Parsed<"ScriptSchema">, T.Script>,
  PrivateInfo: true as Same<Parsed<"PrivateInfoSchema">, T.PrivateInfo>,
  PrivatePacket: true as Same<Parsed<"PrivatePacketSchema">, T.PrivatePacket>,
  Statuses: true as Same<Parsed<"StatusesSchema">, T.Statuses>,
  GamePhase: true as Same<Parsed<"GamePhaseSchema">, T.GamePhase>,
  GameMoment: true as Same<Parsed<"GameMomentSchema">, T.GameMoment>,
  LiveGameMoment: true as Same<Parsed<"LiveGameMomentSchema">, T.LiveGameMoment>,
  CurrentParticipantRef: true as Same<Parsed<"CurrentParticipantRefSchema">, T.CurrentParticipantRef>,
  ParticipantRef: true as Same<Parsed<"ParticipantRefSchema">, T.ParticipantRef>,
  LifeEvent: true as Compatible<Parsed<"LifeEventSchema">, T.LifeEvent>,
  LifeEventWindow: true as Compatible<Parsed<"LifeEventWindowSchema">, T.LifeEventWindow>,
  EffectLifetime: true as Same<Parsed<"EffectLifetimeSchema">, T.EffectLifetime>,
  EffectState: true as Same<Parsed<"EffectStateSchema">, T.EffectState>,
  EffectExpiry: true as Same<Parsed<"EffectExpirySchema">, T.EffectExpiry>,
  EffectParameterValue: true as Same<Parsed<"EffectParameterValueSchema">, T.EffectParameterValue>,
  EffectParameters: true as Same<Parsed<"EffectParametersSchema">, T.EffectParameters>,
  EffectRecord: true as Compatible<Parsed<"EffectRecordSchema">, T.EffectRecord>,
  ReminderCleanupCue: true as Same<Parsed<"ReminderCleanupCueSchema">, T.ReminderCleanupCue>,
  ReminderRecord: true as Same<Parsed<"ReminderRecordSchema">, T.ReminderRecord>,
  HistoryCategory: true as Same<Parsed<"HistoryCategorySchema">, T.HistoryCategory>,
  HistoryChange: true as Same<Parsed<"HistoryChangeSchema">, T.HistoryChange>,
  Provenance: true as Compatible<Parsed<"ProvenanceSchema">, T.Provenance>,
  ProvenanceInput: true as Same<Parsed<"ProvenanceInputSchema">, T.ProvenanceInput>,
  GameRuleFactRecord: true as Compatible<Parsed<"GameRuleFactRecordSchema">, T.GameRuleFactRecord>,
  GameRuleFactHistoryOperation: true as Same<Parsed<"GameRuleFactHistoryOperationSchema">, T.GameRuleFactHistoryOperation>,
  GameRuleFactHistoryRecord: true as Compatible<Parsed<"GameRuleFactHistoryRecordSchema">, T.GameRuleFactHistoryRecord>,
  VotingHistoryRecord: true as Compatible<Parsed<"VotingHistoryRecordSchema">, T.VotingHistoryRecord>,
  ReminderHistoryOperation: true as Same<Parsed<"ReminderHistoryOperationSchema">, T.ReminderHistoryOperation>,
  EffectHistoryOperation: true as Same<Parsed<"EffectHistoryOperationSchema">, T.EffectHistoryOperation>,
  InformationValue: true as Same<Parsed<"InformationValueSchema">, T.InformationValue>,
  RecordedInformationValue: true as Compatible<Parsed<"RecordedInformationValueSchema">, T.RecordedInformationValue>,
  ManualInformationDeliveryRecord: true as Compatible<Parsed<"ManualInformationDeliveryRecordSchema">, T.ManualInformationDeliveryRecord>,
  PreparedInformationRecord: true as Same<Parsed<"PreparedInformationRecordSchema">, T.PreparedInformationRecord>,
  GuardStamp: true as Same<Parsed<"GuardStampSchema">, T.GuardStamp>,
  SyncMeta: true as Same<Parsed<"SyncMetaSchema">, T.SyncMeta>,
  STPlayerRecord: true as Compatible<Parsed<"STPlayerRecordSchema">, T.STPlayerRecord>,
  NightStepStatus: true as Same<Parsed<"NightStepStatusSchema">, T.NightStepStatus>,
  NightStepRecord: true as Same<Parsed<"NightStepRecordSchema">, T.NightStepRecord>,
  GameResult: true as Same<Parsed<"GameResultSchema">, T.GameResult>,
  StorytellerLobbyRecord: true as Compatible<Parsed<"StorytellerLobbyRecordSchema">, T.StorytellerLobbyRecord>,
  PlayerSelfRecord: true as Same<Parsed<"PlayerSelfRecordSchema">, T.PlayerSelfRecord>,
  PlayerSelfLife: true as Same<Parsed<"PlayerSelfLifeSchema">, T.PlayerSelfLife>,
  PlayerSelfEnvelope: true as Compatible<Parsed<"PlayerSelfEnvelopeSchema">, T.PlayerSelfEnvelope>,
  PlayerInfoView: true as Same<Parsed<"PlayerInfoViewSchema">, T.PlayerInfoView>,
  PlayerPublicRecord: true as Same<Parsed<"PlayerPublicRecordSchema">, T.PlayerPublicRecord>,
  PublicLobbyRecord: true as Same<Parsed<"PublicLobbyRecordSchema">, T.PublicLobbyRecord>,
  PlayerInfoContent: true as Same<Parsed<"PlayerInfoContentSchema">, T.PlayerInfoContent>,
  PlayerInfoEntry: true as Same<Parsed<"PlayerInfoEntrySchema">, T.PlayerInfoEntry>,
} satisfies Record<string, true>;

describe("record types and their validators", () => {
  it("are checked against each other at compile time", () => {
    expect(Object.values(parity).every(Boolean)).toBe(true);
  });
});
