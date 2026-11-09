// @vitest-environment node
/**
 * F-16: the hand-written record types (types.ts) and the validators that check saved and remote data (schemas.ts)
 * must describe the same shapes. This file is checked by `npm run typecheck`: if a field is added, removed or
 * retyped on one side only, the matching line below stops compiling. It costs nothing at run time.
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type * as T from "./types";
import type * as S from "./schemas";

/** True when each type is assignable to the other (optional-vs-undefined spellings are treated as the same). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
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
  LifeEvent: true as Same<Parsed<"LifeEventSchema">, T.LifeEvent>,
  LifeEventWindow: true as Same<Parsed<"LifeEventWindowSchema">, T.LifeEventWindow>,
  EffectLifetime: true as Same<Parsed<"EffectLifetimeSchema">, T.EffectLifetime>,
  EffectState: true as Same<Parsed<"EffectStateSchema">, T.EffectState>,
  EffectExpiry: true as Same<Parsed<"EffectExpirySchema">, T.EffectExpiry>,
  EffectParameterValue: true as Same<Parsed<"EffectParameterValueSchema">, T.EffectParameterValue>,
  EffectParameters: true as Same<Parsed<"EffectParametersSchema">, T.EffectParameters>,
  EffectRecord: true as Same<Parsed<"EffectRecordSchema">, T.EffectRecord>,
  ReminderCleanupCue: true as Same<Parsed<"ReminderCleanupCueSchema">, T.ReminderCleanupCue>,
  ReminderRecord: true as Same<Parsed<"ReminderRecordSchema">, T.ReminderRecord>,
  HistoryCategory: true as Same<Parsed<"HistoryCategorySchema">, T.HistoryCategory>,
  HistoryChange: true as Same<Parsed<"HistoryChangeSchema">, T.HistoryChange>,
  Provenance: true as Same<Parsed<"ProvenanceSchema">, T.Provenance>,
  ProvenanceInput: true as Same<Parsed<"ProvenanceInputSchema">, T.ProvenanceInput>,
  GameRuleFactRecord: true as Same<Parsed<"GameRuleFactRecordSchema">, T.GameRuleFactRecord>,
  GameRuleFactHistoryOperation: true as Same<Parsed<"GameRuleFactHistoryOperationSchema">, T.GameRuleFactHistoryOperation>,
  GameRuleFactHistoryRecord: true as Same<Parsed<"GameRuleFactHistoryRecordSchema">, T.GameRuleFactHistoryRecord>,
  VotingHistoryRecord: true as Same<Parsed<"VotingHistoryRecordSchema">, T.VotingHistoryRecord>,
  ReminderHistoryOperation: true as Same<Parsed<"ReminderHistoryOperationSchema">, T.ReminderHistoryOperation>,
  EffectHistoryOperation: true as Same<Parsed<"EffectHistoryOperationSchema">, T.EffectHistoryOperation>,
  InformationValue: true as Same<Parsed<"InformationValueSchema">, T.InformationValue>,
  RecordedInformationValue: true as Same<Parsed<"RecordedInformationValueSchema">, T.RecordedInformationValue>,
  ManualInformationDeliveryRecord: true as Same<Parsed<"ManualInformationDeliveryRecordSchema">, T.ManualInformationDeliveryRecord>,
  PreparedInformationRecord: true as Same<Parsed<"PreparedInformationRecordSchema">, T.PreparedInformationRecord>,
  GuardStamp: true as Same<Parsed<"GuardStampSchema">, T.GuardStamp>,
  SyncMeta: true as Same<Parsed<"SyncMetaSchema">, T.SyncMeta>,
  STPlayerRecord: true as Same<Parsed<"STPlayerRecordSchema">, T.STPlayerRecord>,
  NightStepStatus: true as Same<Parsed<"NightStepStatusSchema">, T.NightStepStatus>,
  NightStepRecord: true as Same<Parsed<"NightStepRecordSchema">, T.NightStepRecord>,
  GameResult: true as Same<Parsed<"GameResultSchema">, T.GameResult>,
  StorytellerLobbyRecord: true as Same<Parsed<"StorytellerLobbyRecordSchema">, T.StorytellerLobbyRecord>,
  PlayerSelfRecord: true as Same<Parsed<"PlayerSelfRecordSchema">, T.PlayerSelfRecord>,
  PlayerSelfLife: true as Same<Parsed<"PlayerSelfLifeSchema">, T.PlayerSelfLife>,
  PlayerSelfEnvelope: true as Same<Parsed<"PlayerSelfEnvelopeSchema">, T.PlayerSelfEnvelope>,
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
