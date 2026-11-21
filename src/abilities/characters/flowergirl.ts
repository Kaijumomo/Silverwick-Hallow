import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import { answerOf, ask, nameOf, outcome, requireLivingActor, subjectId } from "./shared";
import { informationAbilityRefusal, recluseRegistrationChoice } from "./informationSupport";

/**
 * Flowergirl -- GUIDED (SV-5d, Sects & Violets). https://wiki.bloodontheclocktower.com/Flowergirl (saved 2026-11-11)
 *
 * "Each night*, you learn if a Demon voted today." "A Demon's vote counts whether or not the nominee was executed." Exiles do not
 * count. "If the Demon changes players after the original Demon voted but before the Flowergirl wakes ..., the Flowergirl detects the
 * original Demon." "If there are two (or more!) Demons, even dead Demons, ... if even one Demon voted, the Flowergirl learns a 'yes'."
 * How to Run: DEMON NOT VOTED each dawn, DEMON VOTED once the Demon votes; each night except the first, nod or shake.
 *
 * The answer and the official tokens are READ from the voting record of the Day (PO Q3: derived, never stored, so a corrected vote
 * or Undo changes them by itself): a recorded YES, in a nomination (not an exile), by a player who was a Demon when they voted (a
 * dead Demon's ghost vote counts). A voter's character at the vote is known when their current character began before that Day
 * (`characterSince`, recorded from Night 1); otherwise it changed since (a swap, a Pit-Hag, a jump) and the app cannot tell, so the
 * Storyteller is asked ONE question, never guessed. A healthy Recluse who voted may register as a Demon (PO Q2): the same question,
 * unless a Demon certainly voted (then YES). A YES in a vote that was abandoned or never finished, by a player who is or may have
 * been a Demon, is also the Storyteller's question. An incomplete or missing record: by hand, as the Town Crier's.
 * Drunk or poisoned (or a Drunk shown the Flowergirl): the Storyteller chooses YES or NO. Shared rules:
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 8, information support). A Vortox in play makes the whole step Manual
 * through the shared information modifier (passiveRules.ts) until the Vortox merge.
 */
export const FLOWERGIRL_COMMUNICATED = "communicated";
export const FLOWERGIRL_DEMON_VOTED = "flowergirl:demonVoted";

export type DemonVotedRecord =
  | { kind: "known"; voted: boolean }
  /** The Storyteller rules: `changed` voters' characters may have changed since they voted; `recluses` may register as a Demon;
   * `unfinished` voted YES in a vote that was abandoned or never finished. */
  | { kind: "ask"; changed: ParticipantBinding[]; recluses: ParticipantBinding[]; unfinished: ParticipantBinding[] }
  | { kind: "manual"; message: string };

/** Whether this player's current character was already theirs when the Day `day` began. */
function characterHeldSince(game: StorytellerLobbyRecord, player: STPlayerRecord, day: number): boolean {
  const since = player.characterSince;
  if (since) return since.day < day || (since.day === day && since.phase === "night");
  const from = game.characterSinceFrom;
  // Recorded from Night 1 (a game started with character timing): no change means since the deal.
  return !!from && from.phase === "night" && from.day === 1;
}

/** Did a Demon vote during Day `day`? Read from the voting record, never stored. Shared by the Flowergirl's evaluator and its tokens. */
export function demonVotedOn(query: RulesQuery, day: number): DemonVotedRecord {
  const voting = query.game.voting;
  if (!voting || voting.day !== day || voting.coverage !== "known")
    return { kind: "manual", message: "The Day's voting record is incomplete. Resolve this information manually." };
  const changed: ParticipantBinding[] = [], recluses: ParticipantBinding[] = [], unfinished: ParticipantBinding[] = [];
  const add = (list: ParticipantBinding[], who: ParticipantBinding) => { if (!list.some((item) => item.participantId === who.participantId)) list.push(who); };
  for (const round of voting.rounds) {
    if (round.mode !== "nomination") continue;
    const finished = round.status === "outcome" || round.status === "acknowledged";
    for (const response of round.responses) {
      if (response.choice !== "yes") continue;
      const voter = { playerId: response.voter.playerId, participantId: response.voter.participantId };
      const player = query.participant(voter);
      if (!player) return { kind: "manual", message: "A voter's seat changed since the vote: the Storyteller decides." };
      if (!characterHeldSince(query.game, player, day)) { add(changed, voter); continue; }
      const demon = query.registersAsType(voter, "demon", "flowergirl");
      if (demon.known && !demon.value) continue;
      if (!demon.known && !recluseRegistrationChoice(query, voter)) return { kind: "manual", message: demon.reason };
      if (!finished) { add(unfinished, voter); continue; }
      if (demon.known) return { kind: "known", voted: true };
      add(recluses, voter);
    }
  }
  return changed.length || recluses.length || unfinished.length ? { kind: "ask", changed, recluses, unfinished } : { kind: "known", voted: false };
}

/** The Day whose votes the Flowergirl's tokens follow: this Day, or the Day just ended once Night falls (none before Day 1). */
export function flowergirlDay(query: RulesQuery): number {
  const moment = query.moment();
  return !moment ? 0 : moment.phase === "day" ? moment.day : moment.day - 1;
}

function deliver(context: AbilityEvaluationContext, voted: boolean): AbilityEvaluation {
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "flowergirl-other-night",
    values: [{ requirementId: "demonVoted", kind: "boolean", value: voted }] }]);
}

export const FLOWERGIRL: AbilityDescriptor = {
  roleId: "flowergirl",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information", "registration"],
  informationActions: ["flowergirl-other-night"],
  presentation: { complexity: "simple", action: "Show whether a Demon voted today" },
  evaluator: (context) => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    const moment = context.query.moment();
    if (!moment || moment.phase !== "night" || moment.day <= 1) return { kind: "notApplicable", message: "There was no previous Day to learn about." };
    if (context.simulated || !context.functioning) {
      const told = answerOf(context.inputs, FLOWERGIRL_COMMUNICATED, "boolean");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Flowergirl ability. Choose the answer to show."
        : "This Flowergirl's ability is not functioning. Choose the answer to show.",
      { id: FLOWERGIRL_COMMUNICATED, kind: "boolean", source: "storyteller", label: "Show YES (a Demon voted today)" });
      return deliver(context, told.value);
    }
    const record = demonVotedOn(context.query, moment.day - 1);
    if (record.kind === "manual") return { kind: "unsupported", message: record.message };
    if (record.kind === "known") return deliver(context, record.voted);
    const names = (list: ParticipantBinding[]) => list.map((who) => nameOf(context, who)).join(" and ");
    const why = [
      record.changed.length ? `${names(record.changed)} voted and ${record.changed.length === 1 ? "has" : "have"} changed character since, so may have been a Demon then.` : "",
      record.recluses.length ? `${names(record.recluses)} voted and may register as a Demon.` : "",
      record.unfinished.length ? `${names(record.unfinished)} voted in a vote that was not finished.` : "",
    ].filter(Boolean).join(" ");
    const id = subjectId(FLOWERGIRL_DEMON_VOTED, ...record.changed, ...record.recluses, ...record.unfinished);
    const ruled = answerOf(context.inputs, id, "boolean");
    if (!ruled) return ask(`${why} Did a Demon vote today?`,
      { id, kind: "boolean", source: "storyteller", label: "A Demon voted today (Yes: the Flowergirl learns YES; No: NO)" });
    return deliver(context, ruled.value);
  },
};
