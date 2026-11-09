import { isCanonicalRole } from "@/data/canonical";
import { scarletWomanSuccession } from "@/abilities/characters/scarletWoman";
import { bindingOf, createRulesQuery, effectSemanticsOf, type RulesQueryEnvironment } from "./rulesQuery";
import { applyGameRuleFactPlan, planCapturedVictoryEvidence, planGameRuleFactTransaction } from "./gameRuleFacts";
import { isVictoryEvidenceType, isSaintNonqualifyingEvidenceType, victoryEvidenceInvalidReason, victoryEvidenceCollectionInvalidReason, SAINT_EXECUTION_GOOD_TEAM_LOST, SAINT_EXECUTION_EVIL_TEAM_LOST, SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED, SAINT_EXECUTION_EVIL_TEAM_NOT_QUALIFIED, MAYOR_DAY_END_GOOD_TEAM_WON, MAYOR_DAY_END_EVIL_TEAM_WON, RESOLVED_DEMON_DEATH_NO_SUCCESSOR } from "./gameRuleFactRegistry";
export { isSaintNonqualifyingEvidenceType } from "./gameRuleFactRegistry";
import { executionsAt, momentOrdinal } from "./lifeEvents";
import { sameSnapshot } from "./history";
import type { GameRuleFactRecord, STPlayerRecord, StorytellerLobbyRecord } from "./types";

export type VictoryEvidenceResult = { ok: true; game: StorytellerLobbyRecord } | { ok: false; message: string };
const accepted = (game: StorytellerLobbyRecord): VictoryEvidenceResult => ({ ok: true, game });
const supportedRoles = new Set(["washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor", "butler", "drunk", "recluse", "saint", "poisoner", "spy", "scarletwoman", "baron", "imp", "bureaucrat", "thief", "gunslinger", "scapegoat", "beggar"]);

/** A finite reviewed interaction envelope, independent of script name/id. The
 * broader ability coverage list also contains non-TB game-ending abilities;
 * it is intentionally not a victory assertion. No new modifier vocabulary. */
export function victoryCoverageEligibility(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): { kind: "automated" } | { kind: "manual"; reason: string } {
  const manual = (reason: string) => ({ kind: "manual" as const, reason });
  if (!environment.script) return manual("The current script is unavailable.");
  if (game.fabled.length || game.lorics.length) return manual("A Fabled or Loric may affect the game-ending rules.");
  if (game.gameRuleFacts.some(fact => !isVictoryEvidenceType(fact.type))) return manual("A game rule fact has unverified game-ending interactions.");
  for (const player of Object.values(game.players)) {
    if (player.isEmpty || !player.participantId) continue;
    const role = environment.registry.get(player.actualRole);
    if (!role || !isCanonicalRole(role) || !supportedRoles.has(role.id)) return manual("A character has unverified game-ending interactions.");
    if (player.effects.some(effect => effect.state === "active" && (!effectSemanticsOf(effect.type) || effectSemanticsOf(effect.type) === "judgment"))) return manual("An effect requires Storyteller judgment.");
  }
  const query = createRulesQuery(game, environment);
  for (const role of ["saint", "mayor"]) if (query.modifierGate(role, ["death", "alignment", "role", "voting"]).kind !== "clear") return manual("A rule modifier needs manual game-ending adjudication.");
  return { kind: "automated" };
}

const participants = (game: StorytellerLobbyRecord) => Object.values(game.players).filter(player => !player.isEmpty && !!player.participantId);
const ordinaryEndingAlreadyReached = (game: StorytellerLobbyRecord, environment: RulesQueryEnvironment) => {
  const livingOrdinary = participants(game).filter(player => player.alive && environment.registry.get(player.actualRole)?.type !== "traveler");
  return livingOrdinary.length <= 2 || !livingOrdinary.some(player => environment.registry.get(player.actualRole)?.type === "demon");
};
const sameGame = (before: StorytellerLobbyRecord, after: StorytellerLobbyRecord) => before.code === after.code && before.scriptId === after.scriptId;
// packetEpoch also rotates for perception-only edits. It is not a historical
// participation or qualification identity and must not invalidate this fact.
const sameSource = (before: STPlayerRecord, after: STPlayerRecord | undefined) => !!after && !after.isEmpty && after.participantId === before.participantId && after.actualRole === before.actualRole && after.actualAlignment === before.actualAlignment;

function capture(after: StorytellerLobbyRecord, atMoment: StorytellerLobbyRecord, source: STPlayerRecord, type: string, eventId?: string): VictoryEvidenceResult {
  // Refuse a conflicting existing capture rather than silently replacing or
  // reinterpreting evidence. Normally only one trigger can qualify per Day.
  const existing = after.gameRuleFacts.filter(fact => isVictoryEvidenceType(fact.type));
  if (existing.length) {
    const same = existing.find(fact => fact.type === type);
    if (same && !victoryEvidenceCollectionInvalidReason(existing, after.lifeEventWindow.events) && same.resolutionId === eventId && same.recordedAt.day === atMoment.day && same.recordedAt.phase === atMoment.phase && same.provenance?.sourceParticipant?.kind === "participant" && same.provenance.sourceParticipant.participantId === source.participantId) return accepted(after);
    const permittedPair = type === RESOLVED_DEMON_DEATH_NO_SUCCESSOR && existing.length === 1 && isSaintNonqualifyingEvidenceType(existing[0]!.type);
    if (!permittedPair) return { ok: false, message: "Conflicting game-ending evidence needs Storyteller correction." };
  }
  const result = planCapturedVictoryEvidence({ ...after, phase: atMoment.phase, day: atMoment.day }, {
    intents: [{ kind: "apply", type }], context: { provenance: { sourcePlayer: source.id, sourceCharacter: source.actualRole } }, ...(eventId ? { resolutionId: eventId } : {}),
  });
  if (!result.ok) return result;
  if (!result.changed) return { ok: false, message: "The qualification could not be captured atomically." };
  const next = applyGameRuleFactPlan(after, result.plan);
  const fact = next.gameRuleFacts.find(fact => fact.type === type)!;
  const reason = victoryEvidenceInvalidReason(next, fact) ?? victoryEvidenceCollectionInvalidReason(next.gameRuleFacts, next.lifeEventWindow.events);
  return reason ? { ok: false, message: reason } : accepted(next);
}

/** Called only while accepting a new execution. Functioning and actual team
 * come from BEFORE death/cleanup, never from a later snapshot or History. */
export function captureSaintQualification(before: StorytellerLobbyRecord, after: StorytellerLobbyRecord, eventId: string, environment: RulesQueryEnvironment): VictoryEvidenceResult {
  if (!sameGame(before, after) || before.phase !== "day" || after.phase !== "day" || before.day !== after.day || before.lifeEventWindow.events.some(event => event.id === eventId)) return accepted(after);
  const event = after.lifeEventWindow.events.find(event => event.id === eventId);
  if (!event || event.kind !== "execution" || event.outcome !== "died" || event.actualRoleAtEvent !== "saint" || event.moment.day !== before.day) return accepted(after);
  const source = before.players[event.subject.playerId];
  if (!source || source.participantId !== event.subject.participantId || source.actualRole !== "saint" || !source.alive || !sameSource(source, after.players[source.id]) || after.players[source.id]!.alive) return accepted(after);
  if (participants(before).filter(player => player.actualRole === "saint" && player.alive).length !== 1 || victoryCoverageEligibility(before, environment).kind !== "automated") return accepted(after);
  if (ordinaryEndingAlreadyReached(before, environment)) return accepted(after);
  const functioning = createRulesQuery(before, environment).abilityFunctions(bindingOf(source));
  if (!functioning.known || !source.actualAlignment) return accepted(after);
  // Known non-functioning is equally event-time evidence. It prevents later
  // poison expiry from turning this execution into an unknown historical
  // Saint override of an ordinary game-ending condition. It never declares
  // a winner or asserts why the ability did not function.
  const type = functioning.value
    ? source.actualAlignment === "good" ? SAINT_EXECUTION_GOOD_TEAM_LOST : SAINT_EXECUTION_EVIL_TEAM_LOST
    : source.actualAlignment === "good" ? SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED : SAINT_EXECUTION_EVIL_TEAM_NOT_QUALIFIED;
  return capture(after, before, source, type, eventId);
}

/** Only the exact accepted Day N -> Night N+1 boundary establishes the Mayor
 * condition. The record's Day moment names the completed Day, not the Night. */
export function captureMayorQualification(before: StorytellerLobbyRecord, after: StorytellerLobbyRecord, environment: RulesQueryEnvironment): VictoryEvidenceResult {
  if (!sameGame(before, after) || before.phase !== "day" || after.phase !== "night" || after.day !== before.day + 1 || victoryCoverageEligibility(before, environment).kind !== "automated") return accepted(after);
  const living = participants(before).filter(player => player.alive);
  if (living.length !== 3) return accepted(after); // Travellers count here.
  if (ordinaryEndingAlreadyReached(before, environment)) return accepted(after);
  const executions = executionsAt(before, { phase: "day", day: before.day });
  if (executions.status !== "known" || executions.events.length) return accepted(after);
  const mayors = living.filter(player => player.actualRole === "mayor");
  if (mayors.length !== 1) return accepted(after);
  const source = mayors[0]!;
  if (!sameSource(source, after.players[source.id]) || !after.players[source.id]!.alive || !source.actualAlignment) return accepted(after);
  const functioning = createRulesQuery(before, environment).abilityFunctions(bindingOf(source));
  if (!functioning.known || !functioning.value) return accepted(after);
  return capture(after, before, source, source.actualAlignment === "good" ? MAYOR_DAY_END_GOOD_TEAM_WON : MAYOR_DAY_END_EVIL_TEAM_WON);
}

export type ResolvedDemonDeathMode = "recordedDay" | "recordedNight" | "automaticImp" | "automaticSlayer";

/** The reviewed capture envelope belongs to the rule domain, not the generic
 * ability coordinator. Unsupported abilities cannot assert resolved evidence. */
export function automaticDemonDeathEvidenceMode(roleId: string | undefined): ResolvedDemonDeathMode | null {
  return roleId === "imp" ? "automaticImp" : roleId === "slayer" ? "automaticSlayer" : null;
}

/** Capture only from an accepted complete death pipeline. The caller supplies
 * the immediate pre-death snapshot and the result AFTER every role/succession
 * consequence. These mode values are internal call-site provenance, never a
 * generic command option or stored free-text claim. A recorded Night death
 * proves completion only when no possible self-pass recipient exists. */
export function captureResolvedDemonDeath(before: StorytellerLobbyRecord, after: StorytellerLobbyRecord, eventId: string, environment: RulesQueryEnvironment, mode: ResolvedDemonDeathMode): VictoryEvidenceResult {
  if (!["recordedDay", "recordedNight", "automaticImp", "automaticSlayer"].includes(mode)) return accepted(after);
  if (!sameGame(before, after) || (before.phase !== "day" && before.phase !== "night") || after.phase !== before.phase || after.day !== before.day) return accepted(after);
  if ((mode === "recordedDay" || mode === "automaticSlayer") && before.phase !== "day") return accepted(after);
  if ((mode === "recordedNight" || mode === "automaticImp") && before.phase !== "night") return accepted(after);
  const newEvents = after.lifeEventWindow.events.filter(event => !before.lifeEventWindow.events.some(previous => previous.id === event.id));
  // No multi-event reconstruction or backfill; corrections and incomplete
  // compound chains remain unknown, even if their final counts look simple.
  if (newEvents.length !== 1 || newEvents[0]!.id !== eventId) return accepted(after);
  const event = newEvents[0]!;
  if (!(event.kind === "death" || event.kind === "execution" && event.outcome === "died") || event.actualRoleAtEvent !== "imp" || event.moment.phase !== before.phase || event.moment.day !== before.day) return accepted(after);
  const source = before.players[event.subject.playerId];
  if (!source || !source.alive || source.actualRole !== "imp" || source.participantId !== event.subject.participantId || !sameSource(source, after.players[source.id]) || after.players[source.id]!.alive) return accepted(after);
  if (victoryCoverageEligibility(before, environment).kind !== "automated" || victoryCoverageEligibility(after, environment).kind !== "automated") return accepted(after);
  const livingDemons = (game: StorytellerLobbyRecord) => participants(game).filter(player => player.alive && environment.registry.get(player.actualRole)?.type === "demon");
  if (livingDemons(before).length !== 1 || livingDemons(after).length !== 0 || ordinaryEndingAlreadyReached(before, environment)) return accepted(after);
  const prior = before.gameRuleFacts.filter(fact => isVictoryEvidenceType(fact.type));
  if (prior.some(fact => !isSaintNonqualifyingEvidenceType(fact.type))) return accepted(after);
  const query = createRulesQuery(before, environment);
  if (query.modifierGate("imp", ["death", "role", "registration"]).kind !== "clear" || scarletWomanSuccession(query, bindingOf(source)).kind !== "none") return accepted(after);
  if (mode === "recordedNight" || mode === "automaticImp") {
    for (const candidate of participants(before).filter(player => player.alive && !player.isTraveler && player.participantId !== source.participantId)) {
      const eligible = query.registersAsType(bindingOf(candidate), "minion", "imp");
      if (!eligible.known || eligible.value) return accepted(after);
    }
  }
  return capture(after, before, source, RESOLVED_DEMON_DEATH_NO_SUCCESSOR, eventId);
}

export function validVictoryEvidence(game: StorytellerLobbyRecord): GameRuleFactRecord[] {
  if (game.phase !== "day" && game.phase !== "night" && game.phase !== "ended") return [];
  if (victoryEvidenceCollectionInvalidReason(game.gameRuleFacts, game.lifeEventWindow.events)) return [];
  return game.gameRuleFacts.filter(fact => isVictoryEvidenceType(fact.type) && !victoryEvidenceInvalidReason(game, fact) && (game.phase === "ended" || (!!fact.expiresAt && momentOrdinal({ phase: game.phase, day: game.day }) >= momentOrdinal(fact.recordedAt) && momentOrdinal({ phase: game.phase, day: game.day }) < momentOrdinal(fact.expiresAt))));
}

const correctionState = (game: StorytellerLobbyRecord) => [game.fabled, game.lorics, game.lifeEventWindow, participants(game).map(player => [player.id, player.participantId, player.actualRole, player.actualAlignment, player.alive, player.effects])];

/** Corrections invalidate relevant retained evidence; they never rerun past
 * qualification. Normal impairment expiry does not rewrite historical truth.
 * Passing before===after is safe for hydration/Undo validation. */
export function reconcileVictoryEvidence(before: StorytellerLobbyRecord, after: StorytellerLobbyRecord, options: { correction?: boolean } = {}): VictoryEvidenceResult {
  const corrected = options.correction && !sameSnapshot(correctionState(before), correctionState(after));
  const remove = after.gameRuleFacts.filter(fact => {
    if (!isVictoryEvidenceType(fact.type)) return false;
    if (!sameGame(before, after) || corrected || victoryEvidenceInvalidReason(after, fact)) return true;
    if (after.phase !== "ended" && (!fact.expiresAt || momentOrdinal({ phase: after.phase, day: after.day }) >= momentOrdinal(fact.expiresAt))) return true;
    const source = fact.provenance?.sourceParticipant;
    if (source?.kind !== "participant") return true;
    const previous = before.players[source.playerId];
    return !!previous && previous.participantId === source.participantId && !sameSource(previous, after.players[source.playerId]);
  });
  if (!remove.length) return accepted(after);
  // Setup/end transitions do not accept live fact transactions. Setup owns a
  // fresh game; ended-state cleanup still retains the original fact History.
  if (after.phase !== "day" && after.phase !== "night") return accepted({ ...after, gameRuleFacts: after.gameRuleFacts.filter(fact => !remove.includes(fact)) });
  const result = planGameRuleFactTransaction(after, { intents: remove.map(fact => ({ kind: "remove", type: fact.type })), correction: !!options.correction });
  return !result.ok ? result : result.changed ? accepted(applyGameRuleFactPlan(after, result.plan)) : accepted(after);
}
