import type { CurrentParticipantRef, ExecutionOutcome, ExileOutcome } from "./types";
import type { LifeConfirmationToken } from "./lifeResolution";

export type VotingBinding = { playerId: string; participantId: string };
export type VoteChoice = "yes" | "no";
export type VoteResponse = {
  voter: CurrentParticipantRef;
  choice: VoteChoice | "skipped";
  weight: number;
  spentGhostVote: boolean;
  refundSafe: boolean;
  lifeSafe: boolean;
};
export type VotingRound = {
  id: string;
  mode: "nomination" | "exile";
  nominator: CurrentParticipantRef;
  nominee: CurrentParticipantRef;
  order: CurrentParticipantRef[];
  responses: VoteResponse[];
  threshold: number;
  status: "voting" | "outcome" | "acknowledged" | "abandoned";
  result: "belowThreshold" | "block" | "tie" | "exilePassed" | "exileFailed" | "virgin" | null;
  tally: number;
  virginPending: boolean;
  contextStamp: string;
  executionEventIds: string[];
};
export type VotingBlock = { nominee: CurrentParticipantRef | null; tally: number; roundId: string };
/** Authoritative selection, separate from optional human Reminder notation. */
export type VotingModifier = {
  id: string;
  kind: "bureaucrat";
  source: CurrentParticipantRef;
  target: CurrentParticipantRef;
  appliesDay: number;
};
export type VotingDayState = {
  day: number;
  revision: number;
  coverage: "known" | "unknown";
  rounds: VotingRound[];
  activeRoundId: string | null;
  block: VotingBlock | null;
  modifiers: VotingModifier[];
};
export type VotingScope = { code: string; day: number; expectedRevision: number };
export type VotingIntent = VotingScope & (
  | { kind: "begin"; roundId: string; mode: "nomination" | "exile"; nominator: VotingBinding; nominee: VotingBinding; confirmUnknown?: boolean }
  | { kind: "respond"; roundId: string; voter: VotingBinding; choice: VoteChoice; weightOverride?: number }
  | { kind: "undoLast"; roundId: string }
  | { kind: "correctResponse"; roundId: string; voter: VotingBinding; choice: VoteChoice; weightOverride?: number }
  | { kind: "abandon" | "acknowledge" | "acknowledgeContext"; roundId: string }
  | { kind: "bureaucrat"; modifierId: string; source: VotingBinding; target: VotingBinding; completeStep?: { day: number; stepKey: string } }
  | { kind: "removeModifier"; modifierId: string }
  | { kind: "virgin"; roundId: string; execute: boolean; outcome?: ExecutionOutcome; confirmations?: LifeConfirmationToken[] }
  | { kind: "execution"; target: VotingBinding; outcome: ExecutionOutcome; confirmations?: LifeConfirmationToken[] }
  | { kind: "exileOutcome"; roundId: string; outcome: ExileOutcome }
);
