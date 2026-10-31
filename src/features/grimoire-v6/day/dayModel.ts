import type { CurrentParticipantRef, StorytellerLobbyRecord } from "@/stores/types";
import type { VotingBlock, VotingDayState, VotingRound } from "@/stores/votingTypes";

/**
 * Pure helpers for the Day slice (Package 4E): the words and numbers the V2 Grimoire shows for
 * nominations, votes and the block. Nothing here reads a store or decides a rule -- the Voting
 * engine (src/stores/voting.ts) stays the authority; this only describes what it recorded.
 */

/** The block as it stood before `roundId` was cast (replays the earlier rounds of the day). */
export function blockBefore(rounds: readonly VotingRound[], roundId: string): { nominee: CurrentParticipantRef | null; tally: number } | null {
  let block: { nominee: CurrentParticipantRef | null; tally: number } | null = null;
  for (const round of rounds) {
    if (round.id === roundId) break;
    if (round.mode !== "nomination") continue;
    if (round.result === "block") block = { nominee: round.nominee, tally: round.tally };
    else if (round.result === "tie") block = { nominee: null, tally: round.tally };
  }
  return block;
}

export type ResultCopy = { title: string; sub: string; color: string };

const RED = "#f4a595";
const DEEP = "#e8584a";
const PLAIN = "#ddd6c8";

/** The verdict line under a finished vote (V2 wording, mapped from the engine's recorded result). */
export function resultCopy(round: VotingRound, nameOf: (ref: CurrentParticipantRef) => string, prior: ReturnType<typeof blockBefore>): ResultCopy {
  const nominee = nameOf(round.nominee);
  const votes = `${round.tally} ${round.mode === "exile" ? "supporters" : "votes"}`;
  switch (round.result) {
    case "block": {
      const freed = prior?.nominee && prior.nominee.participantId !== round.nominee.participantId ? ` ${nameOf(prior.nominee)} is freed.` : "";
      return { title: `${nominee} is on the block`, sub: `${votes}, ${round.threshold} needed.${freed}`, color: RED };
    }
    case "tie":
      return { title: "A tie", sub: `${round.tally} votes each. No one is on the block.`, color: DEEP };
    case "virgin":
      return { title: `${nameOf(round.nominator)} was executed`, sub: `${nominee} was a Virgin.`, color: RED };
    case "exilePassed":
      return { title: "Exile supported", sub: `${votes}, ${round.threshold} needed.`, color: RED };
    case "exileFailed":
      return { title: "Exile declined", sub: `${round.tally} of ${round.threshold} supporters needed.`, color: PLAIN };
    default:
      // Reached the threshold but could not displace the block: "Not enough"; otherwise the nominee is spared.
      if (prior && round.tally >= round.threshold) {
        return { title: "Not enough", sub: `${round.tally} votes. ${prior.nominee ? `${nameOf(prior.nominee)} stays on the block` : "The tie holds"} at ${prior.tally}.`, color: PLAIN };
      }
      return { title: `${nominee} is spared`, sub: `${round.tally} of ${round.threshold} votes needed.`, color: PLAIN };
  }
}

/** One segment of the vote progress bar (V2 "pips"). */
export function pipBackground(round: VotingRound, index: number): string {
  const answered = round.responses[index];
  if (answered) return answered.choice === "yes" ? "#e8584a" : "rgba(222,216,204,.16)";
  return index === round.responses.length && round.status === "voting" ? "rgba(255,122,104,.55)" : "rgba(222,216,204,.08)";
}

/** What a vote needs to put its nominee on the block, given the block already standing. */
export function votesNeeded(round: VotingRound, block: VotingBlock | null): number {
  if (round.mode === "exile") return round.threshold;
  return Math.max(round.threshold, (block?.tally ?? -1) + 1);
}

export const aliveSeated = (game: StorytellerLobbyRecord): number =>
  Object.values(game.players).filter((p) => !p.isEmpty && p.alive).length;

/** "Day actions" panel and the toolbar both ask: how many votes put someone on the block? */
export const toExecute = (game: StorytellerLobbyRecord): number => Math.ceil(aliveSeated(game) / 2);

/** Rounds that count as "nominated today" (an abandoned vote still spent its nomination). */
export const nominationsToday = (state: VotingDayState): VotingRound[] => state.rounds.filter((r) => r.mode === "nomination");

/** Ordinal shown on the card: the round being worked on, or the next one to open. */
export function roundOrdinal(state: VotingDayState, round: VotingRound | null, exile: boolean): number {
  const mode = round ? round.mode : exile ? "exile" : "nomination";
  const same = state.rounds.filter((r) => r.mode === mode);
  return round ? same.findIndex((r) => r.id === round.id) + 1 : same.length + 1;
}
