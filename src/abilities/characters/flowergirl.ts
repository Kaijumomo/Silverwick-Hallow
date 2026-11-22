import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import { answerOf, ask, nameOf, outcome, requireLivingActor, subjectId } from "./shared";
import { asGiven, informationAbilityRefusal, recluseRegistrationChoice, storytellerChooses, yesNoTruth, type WorkedTruth } from "./informationSupport";

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
 * unless a Demon certainly voted (then YES). A YES in a vote that was abandoned, by a player who is or may have been a Demon, is also
 * the Storyteller's question (a vote still open counts at once). One certain Demon YES anywhere in the Day is YES. An incomplete or missing record: by hand, as the Town Crier's.
 * Drunk or poisoned (or a Drunk shown the Flowergirl): the Storyteller chooses YES or NO. Shared rules:
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 8, information support). SV-5i: a Vortox makes the answer false
 * (src/abilities/falseInformation.ts): the truth is worked out as above, for a drunk or poisoned Flowergirl too, and the opposite is
 * given; the tokens still follow the record.
 */
export const FLOWERGIRL_COMMUNICATED = "communicated";
export const FLOWERGIRL_DEMON_VOTED = "flowergirl:demonVoted";

export type DemonVotedRecord =
  | { kind: "known"; voted: boolean }
  /** The Storyteller rules: `changed` voters' characters may have changed since they voted; `recluses` may register as a Demon;
   * `unfinished` voted YES in a vote that was abandoned. */
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
  // Every YES is read before deciding: one certain Demon vote anywhere in the Day is YES, whatever else the record holds.
  let manual: string | null = null;
  for (const round of voting.rounds) {
    if (round.mode !== "nomination") continue;
    // A hand raised in a vote still open counts at once ("DEMON VOTED once the Demon votes"); only an abandoned vote is doubtful.
    const abandoned = round.status === "abandoned";
    for (const response of round.responses) {
      if (response.choice !== "yes") continue;
      const voter = { playerId: response.voter.playerId, participantId: response.voter.participantId };
      const player = query.participant(voter);
      if (!player) { manual ??= "A voter's seat changed since the vote: the Storyteller decides."; continue; }
      if (!characterHeldSince(query.game, player, day)) { add(changed, voter); continue; }
      const demon = query.registersAsType(voter, "demon", "flowergirl");
      if (demon.known && !demon.value) continue;
      if (!demon.known && !recluseRegistrationChoice(query, voter)) { manual ??= demon.reason; continue; }
      if (abandoned) { add(unfinished, voter); continue; }
      if (demon.known) return { kind: "known", voted: true };
      add(recluses, voter);
    }
  }
  if (manual) return { kind: "manual", message: manual };
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

/** Did a Demon vote during Day `day`, with the Storyteller's ruling where a voter may have been one? Shared by the evaluator and, under
 * a Vortox, by the descriptor's truth (SV-5i). */
function demonVoted(context: AbilityEvaluationContext, day: number): WorkedTruth<boolean> {
  const record = demonVotedOn(context.query, day);
  if (record.kind === "manual") return { kind: "unsupported", message: record.message };
  if (record.kind === "known") return { kind: "known", value: record.voted };
  const names = (list: ParticipantBinding[]) => list.map((who) => nameOf(context, who)).join(" and ");
  const why = [
    record.changed.length ? `${names(record.changed)} voted and ${record.changed.length === 1 ? "has" : "have"} changed character since, so may have been a Demon then.` : "",
    record.recluses.length ? `${names(record.recluses)} voted and may register as a Demon.` : "",
    record.unfinished.length ? `${names(record.unfinished)} voted in a vote that was abandoned.` : "",
  ].filter(Boolean).join(" ");
  const id = subjectId(FLOWERGIRL_DEMON_VOTED, ...record.changed, ...record.recluses, ...record.unfinished);
  const ruled = answerOf(context.inputs, id, "boolean");
  if (ruled) return { kind: "known", value: ruled.value };
  return { kind: "ask", evaluation: ask(`${why} Did a Demon vote today?`,
    { id, kind: "boolean", source: "storyteller", label: `A Demon voted today (Yes: the Flowergirl learns ${context.mustBeFalse ? "NO" : "YES"}; No: ${context.mustBeFalse ? "YES" : "NO"})` }) };
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
    if (storytellerChooses(context)) {
      const told = answerOf(context.inputs, FLOWERGIRL_COMMUNICATED, "boolean");
      if (!told) return ask(context.simulated ? "Simulated wake: this player has no Flowergirl ability. Choose the answer to show."
        : "This Flowergirl's ability is not functioning. Choose the answer to show.",
      { id: FLOWERGIRL_COMMUNICATED, kind: "boolean", source: "storyteller", label: "Show YES (a Demon voted today)" });
      return deliver(context, told.value);
    }
    // SV-5i: under a Vortox the truth is worked out the same way (a drunk or poisoned Flowergirl too, the doubtful-voter question
    // included) and given as its opposite. The official DEMON VOTED / NOT VOTED tokens keep following the record: they are the
    // Storyteller's notation of what happened, not what the Flowergirl was told.
    const truth = demonVoted(context, moment.day - 1);
    if (truth.kind === "unsupported") return { kind: "unsupported", message: truth.message };
    if (truth.kind === "ask") return truth.evaluation;
    return deliver(context, asGiven(context, truth.value));
  },
  truth: (context) => {
    const moment = context.query.moment();
    return yesNoTruth("demonVoted", moment ? demonVoted(context, moment.day - 1) : { kind: "unsupported", message: "There was no previous Day to learn about." });
  },
};
