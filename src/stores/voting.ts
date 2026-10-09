import { applyLifePlan, planLifeTransaction, type LifeIntent, type LifeRefusal } from "./lifeResolution";
import { participantRefOf } from "./participants";
import { boundParticipant, createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import type { CurrentParticipantRef, StorytellerLobbyRecord } from "./types";
import type { VoteResponse, VotingBinding, VotingDayState, VotingIntent, VotingRound } from "./votingTypes";
import { isCanonicalRole } from "@/data/canonical";
export type { VotingDayState, VotingIntent, VotingRound } from "./votingTypes";

export type VotingPlanResult = { ok: true; changed: boolean; game: StorytellerLobbyRecord } | LifeRefusal;
const refuse = (message: string): LifeRefusal => ({ ok: false, code: "refused", message });
const stale = (): LifeRefusal => ({ ok: false, code: "stale", message: "The voting context changed. Review the current round and try again." });
const canonical = (id: string, environment?: RulesQueryEnvironment): boolean => {
  const role = environment?.registry.get(id);
  return !!role && isCanonicalRole(role);
};

export function freshVotingDay(day: number, coverage: "known" | "unknown" = "known"): VotingDayState {
  return { day, revision: 0, coverage, rounds: [], activeRoundId: null, block: null, modifiers: [] };
}
export function currentVotingState(game: StorytellerLobbyRecord): VotingDayState {
  if (game.voting?.day === game.day) return game.voting;
  const state = freshVotingDay(game.day, game.voting ? "known" : "unknown");
  state.modifiers = (game.voting?.modifiers ?? []).filter(m => m.appliesDay >= game.day);
  return state;
}
export function activeVotingRound(game: StorytellerLobbyRecord): VotingRound | null {
  const state = currentVotingState(game);
  return state.rounds.find(r => r.id === state.activeRoundId) ?? null;
}
export function currentVoter(game: StorytellerLobbyRecord): CurrentParticipantRef | null {
  const round = activeVotingRound(game);
  return round?.status === "voting" && !round.virginPending ? round.order[round.responses.length] ?? null : null;
}

/** Concurrent Life changes invalidate only the affected token refund. This
 * is persisted safety metadata, not a second authority for Life. Called by
 * the store for non-voting game mutations; restoring a full voting snapshot
 * (Undo/remote recovery) keeps that snapshot's matching evidence. */
export function reconcileVotingDependencies(previous: StorytellerLobbyRecord | null, next: StorytellerLobbyRecord): StorytellerLobbyRecord {
  if (!previous?.voting || previous.voting !== next.voting) return next;
  const lifeStamp = (g: StorytellerLobbyRecord, ref: CurrentParticipantRef) => {
    const p = boundParticipant(g, ref);
    return JSON.stringify([p?.alive, p?.ghostVote, p?.exiled, g.lifeEventWindow.events.filter(e => e.subject.participantId === ref.participantId)]);
  };
  const voting = next.voting!;
  const modifiers = voting.modifiers.filter(m => {
    const source = boundParticipant(next, m.source);
    return source?.alive && source.actualRole === "bureaucrat" && !!boundParticipant(next, m.target);
  });
  let changed = modifiers.length !== voting.modifiers.length;
  const rounds = voting.rounds.map(round => {
    const responses = round.responses.map(response => {
      if (!response.lifeSafe || lifeStamp(previous, response.voter) === lifeStamp(next, response.voter)) return response;
      changed = true; return { ...response, refundSafe: false, lifeSafe: false };
    });
    return responses.some((r, i) => r !== round.responses[i]) ? { ...round, responses } : round;
  });
  return changed ? { ...next, voting: { ...voting, rounds, modifiers, revision: voting.revision + 1 } } : next;
}

function tableStamp(game: StorytellerLobbyRecord, round: VotingRound): string {
  return JSON.stringify(game.seatOrder.map(id => {
    const p = game.players[id];
    const spentHere = round.responses.some(r => r.voter.participantId === p?.participantId && r.spentGhostVote && r.refundSafe);
    return [id, p?.participantId ?? null, p?.isEmpty ?? false, p?.alive ?? false, p?.isTraveler ?? false, spentHere ? true : p?.ghostVote ?? false];
  }));
}
export function votingContextChanged(game: StorytellerLobbyRecord, round: VotingRound): boolean { return tableStamp(game, round) !== round.contextStamp; }

/** No Reminder labels, History, shown roles or player client input are rules sources. */
export function voteWeight(game: StorytellerLobbyRecord, voter: VotingBinding, environment?: RulesQueryEnvironment): { known: true; value: number } | { known: false; reason: string } {
  const modifiers = currentVotingState(game).modifiers.filter(m => m.appliesDay === game.day && m.target.participantId === voter.participantId);
  for (const modifier of modifiers) {
    const source = boundParticipant(game, { playerId: modifier.source.playerId, participantId: modifier.source.participantId });
    if (!source || !source.alive || source.actualRole !== "bureaucrat") continue;
    if (!environment) return { known: false, reason: "Review the Bureaucrat's ability before counting this vote." };
    if (!canonical("bureaucrat", environment)) return { known: false, reason: "This Bureaucrat definition is not verified. Choose the vote contribution explicitly." };
    const functions = createRulesQuery(game, environment).abilityFunctions({ playerId: source.id, participantId: source.participantId! });
    if (!functions.known) return functions;
    if (functions.value) return { known: true, value: 3 };
  }
  return { known: true, value: 1 };
}

function snapshot(game: StorytellerLobbyRecord, binding: VotingBinding): CurrentParticipantRef | null {
  if (!boundParticipant(game, binding)) return null;
  const ref = participantRefOf(game, binding.playerId);
  return ref?.kind === "participant" ? ref : null;
}
function life(game: StorytellerLobbyRecord, intents: LifeIntent[]): VotingPlanResult {
  if (!intents.length) return { ok: true, changed: false, game };
  const result = planLifeTransaction(game, { intents });
  return !result.ok ? result : { ok: true, changed: result.changed, game: result.changed ? applyLifePlan(game, result.plan) : game };
}
function recompute(state: VotingDayState): void {
  state.block = null;
  for (const round of state.rounds) {
    round.tally = round.responses.reduce((n, r) => n + r.weight, 0);
    if (round.status === "voting" || round.status === "abandoned" || round.result === "virgin") continue;
    if (round.mode === "exile") { round.result = round.tally >= round.threshold ? "exilePassed" : "exileFailed"; continue; }
    if (round.tally < round.threshold || (state.block && round.tally < state.block.tally)) { round.result = "belowThreshold"; continue; }
    if (state.block && round.tally === state.block.tally) {
      round.result = "tie";
      state.block = { nominee: null, tally: round.tally, roundId: round.id };
    } else {
      round.result = "block";
      state.block = { nominee: round.nominee, tally: round.tally, roundId: round.id };
    }
  }
}
function advanceCursor(game: StorytellerLobbyRecord, round: VotingRound): void {
  if (round.virginPending || round.status !== "voting") return;
  while (round.responses.length < round.order.length) {
    const ref = round.order[round.responses.length]!;
    const player = boundParticipant(game, { playerId: ref.playerId, participantId: ref.participantId });
    // A departed/replaced participant is deliberately skipped, never rebound.
    if (player && (round.mode === "exile" || player.alive || player.ghostVote)) break;
    round.responses.push({ voter: ref, choice: "skipped", weight: 0, spentGhostVote: false, refundSafe: false, lifeSafe: true });
  }
  if (round.responses.length === round.order.length) round.status = "outcome";
}

/** Pure, bounded coordinator. The caller owns one persistence preflight and commit. */
export function planVoting(game: StorytellerLobbyRecord, intent: VotingIntent, environment?: RulesQueryEnvironment): VotingPlanResult {
  if (!intent || typeof intent !== "object" || game.code !== intent.code || game.day !== intent.day) return stale();
  const before = currentVotingState(game);
  if (before.revision !== intent.expectedRevision) return stale();
  const modifierAction = intent.kind === "bureaucrat" || intent.kind === "removeModifier";
  if (game.phase !== "day" && !(modifierAction && game.phase === "night")) return refuse("Voting is available during the Day.");
  const state: VotingDayState = JSON.parse(JSON.stringify(before));
  let next = game;
  const commit = (): VotingPlanResult => {
    // Life composed by voting (notably exile) also invalidates earlier
    // responses' evidence. The response intentionally corrected right now
    // receives the freshly validated evidence built below.
    const reconciled = reconcileVotingDependencies(game, next);
    for (const round of state.rounds) for (const response of round.responses) {
      if (intent.kind === "correctResponse" && intent.roundId === round.id && intent.voter.participantId === response.voter.participantId) continue;
      const prior = reconciled.voting?.rounds.find(r => r.id === round.id)?.responses.find(r => r.voter.participantId === response.voter.participantId);
      if (prior && !prior.lifeSafe) { response.lifeSafe = false; response.refundSafe = false; }
    }
    state.modifiers = state.modifiers.filter(m => {
      const source = boundParticipant(next, m.source);
      return !!source && source.alive && source.actualRole === "bureaucrat" && !!boundParticipant(next, m.target);
    });
    recompute(state);
    state.revision++;
    return { ok: true, changed: true, game: { ...next, voting: state } };
  };
  if (intent.kind === "bureaucrat") {
    const source = snapshot(game, intent.source); const target = snapshot(game, intent.target);
    const player = boundParticipant(game, intent.source);
    if (!source || !target) return stale();
    if (source.participantId === target.participantId) return refuse("The Bureaucrat must choose another player.");
    if (player?.actualRole !== "bureaucrat" || !player.alive) return refuse("Choose a living current Bureaucrat as the source.");
    if (!canonical("bureaucrat", environment)) return refuse("This character is not the verified Bureaucrat. Use an explicit voting adjustment instead.");
    if (!intent.modifierId || intent.modifierId.length > 200) return refuse("Invalid modifier identity.");
    if (state.modifiers.some(m => m.id === intent.modifierId)) return refuse("That modifier already exists.");
    state.modifiers = state.modifiers.filter(m => m.source.participantId !== source.participantId || m.appliesDay !== game.day);
    if (state.modifiers.length >= 20) return refuse("At most 20 voting modifiers can be recorded.");
    state.modifiers.push({ id: intent.modifierId, kind: "bureaucrat", source, target, appliesDay: game.day });
    return commit();
  }
  if (intent.kind === "removeModifier") {
    if (!state.modifiers.some(m => m.id === intent.modifierId)) return { ok: true, changed: false, game };
    state.modifiers = state.modifiers.filter(m => m.id !== intent.modifierId);
    return commit();
  }
  if (intent.kind === "execution") {
    const active = state.rounds.find(r => r.id === state.activeRoundId);
    if (active && (active.status !== "outcome" || active.mode !== "nomination")) return refuse("Finish the current vote before recording an execution.");
    if (active && votingContextChanged(game, active)) return stale();
    if (!snapshot(game, intent.target)) return stale();
    const planned = life(game, [{ kind: "execution", playerId: intent.target.playerId, outcome: intent.outcome, confirmations: intent.confirmations }]);
    if (!planned.ok) return planned;
    next = planned.game;
    if (active) { active.status = "acknowledged"; state.activeRoundId = null; }
    return commit();
  }
  if (intent.kind === "begin") {
    if (state.activeRoundId) return refuse("Finish or abandon the current vote first.");
    if (state.coverage === "unknown" && !intent.confirmUnknown) return refuse("Earlier nominations today are unknown. Confirm their eligibility before beginning.");
    if (!intent.roundId || intent.roundId.length > 200 || state.rounds.some(r => r.id === intent.roundId)) return refuse("Use a new round identity.");
    if (state.rounds.length >= 100) return refuse("This Day has reached its 100-round recording limit.");
    const nominator = snapshot(game, intent.nominator); const nominee = snapshot(game, intent.nominee);
    if (!nominator || !nominee) return stale();
    const from = boundParticipant(game, intent.nominator)!; const to = boundParticipant(game, intent.nominee)!;
    if (intent.mode !== "nomination" && intent.mode !== "exile") return refuse("Choose a nomination or exile.");
    if (intent.mode === "nomination") {
      if (game.lifeEventWindow.events.some(e => e.kind === "execution" && e.moment.day === game.day)) return refuse("An execution has already occurred today. Continue to Night or use the existing exceptional Life controls.");
      if (!from.alive) return refuse("Only a living player can nominate.");
      if (to.isTraveler) return refuse("Use exile for a Traveler.");
      if (state.rounds.some(r => r.mode === "nomination" && r.nominator.participantId === nominator.participantId)) return refuse("This player has already nominated today.");
      if (state.rounds.some(r => r.mode === "nomination" && r.nominee.participantId === nominee.participantId)) return refuse("This player has already been nominated today.");
    } else {
      if (!to.isTraveler || !to.alive) return refuse("Choose a living Traveler to exile.");
      if (state.rounds.some(r => r.mode === "exile" && r.nominee.participantId === nominee.participantId)) return refuse("This Traveler has already faced exile today.");
    }
    const seated = game.seatOrder.flatMap(id => { const r = participantRefOf(game, id); return r?.kind === "participant" ? [r] : []; });
    if (!seated.length || seated.length > 20) return refuse("Voting supports 1–20 occupied seats.");
    const pivot = seated.findIndex(p => p.participantId === nominee.participantId);
    if (pivot < 0) return stale();
    const order = [...seated.slice(pivot + 1), ...seated.slice(0, pivot + 1)];
    const alive = seated.filter(p => game.players[p.playerId]!.alive).length;
    const round: VotingRound = {
      id: intent.roundId, mode: intent.mode, nominator, nominee, order, responses: [],
      threshold: Math.max(1, intent.mode === "exile" ? Math.ceil(seated.length / 2) : Math.ceil(alive / 2)),
      status: "voting", result: null, tally: 0,
      virginPending: intent.mode === "nomination" && to.alive && to.actualRole === "virgin" && canonical("virgin", environment) && !to.abilityUsed, contextStamp: "",
      executionEventIds: game.lifeEventWindow.events.filter(e => e.kind === "execution" && e.moment.day === game.day).map(e => e.id),
    };
    // The first legal nomination uses the Virgin even when impaired or the
    // nominator does not register as Townsfolk. Resolution stays ST-owned.
    if (round.virginPending) {
      const planned = life(next, [{ kind: "useAbility", playerId: to.id }]);
      if (!planned.ok) return planned;
      next = planned.game;
    }
    state.rounds.push(round); state.activeRoundId = round.id;
    round.contextStamp = tableStamp(next, round);
    advanceCursor(next, round);
    return commit();
  }
  const round = state.rounds.find(r => r.id === intent.roundId);
  if (!round || (intent.kind !== "correctResponse" && state.activeRoundId !== round.id)) return stale();
  const laterExecution = game.lifeEventWindow.events.some(e => e.kind === "execution" && e.moment.day === game.day && !round.executionEventIds.includes(e.id));
  if (laterExecution && (intent.kind === "correctResponse" || intent.kind === "undoLast" || intent.kind === "respond" || intent.kind === "virgin")) return refuse("An execution followed this vote. Review the execution through Life correction before changing earlier voting.");
  if (intent.kind === "correctResponse" && round.mode === "exile" && game.lifeEventWindow.events.some(e => e.kind === "exile" && e.moment.day === game.day && e.subject.participantId === round.nominee.participantId)) return refuse("This exile has already been resolved. Review its Life outcome before correcting the supporting vote.");
  if (intent.kind === "acknowledgeContext") {
    if (round.status !== "voting" && round.status !== "outcome") return stale();
    const seated = Object.values(game.players).filter(p => !p.isEmpty);
    round.threshold = Math.max(1, round.mode === "exile" ? Math.ceil(seated.length / 2) : Math.ceil(seated.filter(p => p.alive).length / 2));
    round.contextStamp = tableStamp(game, round);
    advanceCursor(game, round);
    return commit();
  }
  // Corrections must not implicitly acknowledge an active round's changed
  // table: only acknowledgeContext refreshes its threshold and skips a
  // departed current voter. Historical rounds retain their recorded
  // threshold; their corrections still pass the identity/Life checks.
  if (intent.kind !== "abandon" && state.activeRoundId === round.id && votingContextChanged(game, round)) return { ok: false, code: "stale", message: "The table changed during this vote. Review and acknowledge the updated voting context first." };
  if (intent.kind === "acknowledge") {
    if (round.status !== "outcome") return refuse("Record every eligible response first.");
    round.status = "acknowledged"; state.activeRoundId = null;
    return commit();
  }
  if (intent.kind === "abandon") {
    round.status = "abandoned"; round.virginPending = false; state.activeRoundId = null;
    return commit();
  }
  if (intent.kind === "virgin") {
    if (!round.virginPending) return refuse("There is no pending first Virgin nomination.");
    if (!snapshot(game, round.nominee) || !snapshot(game, round.nominator)) return stale();
    if (game.players[round.nominee.playerId]?.actualRole !== "virgin") return stale();
    const intents: LifeIntent[] = [];
    if (intent.execute) {
      if (!intent.outcome) return refuse("Choose the actual execution outcome.");
      intents.push({ kind: "execution", playerId: round.nominator.playerId, outcome: intent.outcome, confirmations: intent.confirmations });
    }
    const planned = life(game, intents); if (!planned.ok) return planned;
    next = planned.game; round.virginPending = false;
    if (intent.execute) { round.status = "outcome"; round.result = "virgin"; }
    else advanceCursor(next, round);
    round.contextStamp = tableStamp(next, round);
    return commit();
  }
  if (intent.kind === "exileOutcome") {
    if (round.mode !== "exile" || round.status !== "outcome" || round.result !== "exilePassed") return refuse("This exile has not passed.");
    if (!snapshot(game, round.nominee)) return stale();
    const planned = life(game, [{ kind: "exile", playerId: round.nominee.playerId, outcome: intent.outcome }]);
    if (!planned.ok) return planned;
    next = planned.game; round.status = "acknowledged"; state.activeRoundId = null;
    return commit();
  }
  if (round.virginPending) return refuse("Resolve the Virgin's first nomination before voting.");
  if (intent.kind === "undoLast") {
    let index = round.responses.length - 1;
    while (index >= 0 && round.responses[index]!.choice === "skipped") index--;
    if (index < 0) return refuse("No response has been recorded.");
    const response = round.responses[index]!;
    if (response.spentGhostVote) {
      if (!response.refundSafe) return refuse("This player's Life changed after the vote. Correct the token separately before changing this response.");
      if (!snapshot(game, response.voter)) return stale();
      const planned = life(game, [{ kind: "restoreGhostVote", playerId: response.voter.playerId }]);
      if (!planned.ok) return planned; next = planned.game;
    }
    round.responses = round.responses.slice(0, index); round.status = "voting"; round.result = null;
    round.contextStamp = tableStamp(next, round);
    // Do not skip the response just undone; it remains the current voter.
    return commit();
  }
  if (intent.kind !== "respond" && intent.kind !== "correctResponse") return refuse("Unknown voting action.");
  if (intent.choice !== "yes" && intent.choice !== "no") return refuse("Choose Yes or No.");
  const voter = snapshot(game, intent.voter); if (!voter) return stale();
  let index = round.responses.length;
  if (intent.kind === "correctResponse") {
    index = round.responses.findIndex(r => r.voter.participantId === voter.participantId);
    if (index < 0 || round.responses[index]!.choice === "skipped") return refuse("There is no accepted response to correct.");
  } else if (round.status !== "voting" || round.order[index]?.participantId !== voter.participantId) return stale();
  const old = round.responses[index];
  if (intent.kind === "correctResponse" && old && !old.lifeSafe) return refuse("This player's Life changed after the recorded response. Review that change before correcting earlier voting.");
  const player = boundParticipant(game, intent.voter)!;
  if (round.mode === "nomination" && !player.alive && !player.ghostVote && !old?.spentGhostVote) return refuse("This player's dead vote is already spent.");
  let weight = 0;
  if (intent.choice === "yes") {
    const derived = round.mode === "exile" ? { known: true as const, value: 1 } : voteWeight(game, intent.voter, environment);
    if (intent.weightOverride !== undefined && (!Number.isInteger(intent.weightOverride) || intent.weightOverride < -20 || intent.weightOverride > 20)) return refuse("Use a vote weight between -20 and 20.");
    if (round.mode === "exile" && intent.weightOverride !== undefined && intent.weightOverride !== 1) return refuse("Exile support is always one per participant.");
    if (!derived.known && intent.weightOverride === undefined) return refuse(derived.reason);
    weight = intent.weightOverride ?? (derived.known ? derived.value : 1);
  }
  const spend = round.mode === "nomination" && intent.choice === "yes" && !player.alive;
  if (old?.spentGhostVote && !old.refundSafe && !spend) return refuse("This player's Life changed after the vote. Correct the token separately before changing this response.");
  const intents: LifeIntent[] = [];
  if (old?.spentGhostVote && !spend) intents.push({ kind: "restoreGhostVote", playerId: player.id });
  if (spend && !old?.spentGhostVote) intents.push({ kind: "spendGhostVote", playerId: player.id });
  const planned = life(game, intents); if (!planned.ok) return planned; next = planned.game;
  const response: VoteResponse = { voter: old?.voter ?? voter, choice: intent.choice, weight, spentGhostVote: spend, refundSafe: spend && (old?.spentGhostVote ? old.refundSafe : true), lifeSafe: true };
  if (old && JSON.stringify(old) === JSON.stringify(response)) return { ok: true, changed: false, game };
  round.responses[index] = response;
  round.contextStamp = tableStamp(next, round);
  if (intent.kind === "respond") advanceCursor(next, round);
  return commit();
}
