import type { StorytellerLobbyRecord } from "./types";
import type { RulesQueryEnvironment } from "./rulesQuery";
import { validVictoryEvidence, victoryCoverageEligibility } from "./victoryEvidence";
import { SAINT_EXECUTION_GOOD_TEAM_LOST, SAINT_EXECUTION_EVIL_TEAM_LOST, MAYOR_DAY_END_GOOD_TEAM_WON, RESOLVED_DEMON_DEATH_NO_SUCCESSOR as DEMON_DEATH_NO_SUCCESSOR, isSaintNonqualifyingEvidenceType } from "./gameRuleFactRegistry";

export type EndGameEligibility = { kind: "verified"; team: "good" | "evil"; reason: "saint" | "mayor" | "demonDeath" | "twoAlive" }
  | { kind: "none" } | { kind: "unknown"; reason: string };
const unknown = (reason: string): EndGameEligibility => ({ kind: "unknown", reason });

/** Read-only assistance for the existing End control. No winner is recorded,
 * and uncertain succession or missing historical qualification stays manual. */
export function endGameEligibility(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): EndGameEligibility {
  if (game.phase !== "day" && game.phase !== "night") return { kind: "none" };
  const coverage = victoryCoverageEligibility(game, environment);
  if (coverage.kind === "manual") return unknown(coverage.reason);
  const evidence = validVictoryEvidence(game);
  const positive = evidence.filter(fact => !isSaintNonqualifyingEvidenceType(fact.type));
  if (positive.length > 1) return unknown("Competing game-ending evidence needs Storyteller adjudication.");
  if (positive.length === 1 && positive[0]!.type !== DEMON_DEATH_NO_SUCCESSOR) {
    const type = positive[0]!.type;
    const saint = type === SAINT_EXECUTION_GOOD_TEAM_LOST || type === SAINT_EXECUTION_EVIL_TEAM_LOST;
    return { kind: "verified", reason: saint ? "saint" : "mayor", team: type === SAINT_EXECUTION_EVIL_TEAM_LOST || type === MAYOR_DAY_END_GOOD_TEAM_WON ? "good" : "evil" };
  }
  const players = Object.values(game.players).filter(player => !player.isEmpty && !!player.participantId);
  const living = players.filter(player => player.alive && !player.isTraveler);
  const demons = living.filter(player => environment.registry.get(player.actualRole)?.type === "demon");
  // An older or corrected execution has no event-time functioning/team proof.
  if (game.lifeEventWindow.events.some(event => event.kind === "execution" && event.outcome === "died" && event.actualRoleAtEvent === "saint" && !evidence.some(fact => isSaintNonqualifyingEvidenceType(fact.type) && fact.resolutionId === event.id)))
    return unknown("The Saint execution has no retained qualification evidence.");
  if (demons.length === 0) {
    if (!positive.some(fact => fact.type === DEMON_DEATH_NO_SUCCESSOR))
      return unknown("The Demon death has no retained proof that succession fully resolved.");
    // If ordinary Good and Evil conditions occur simultaneously, Good wins.
    return { kind: "verified", team: "good", reason: "demonDeath" };
  }
  if (demons.length > 1) return unknown("Multiple Demons need manual adjudication.");
  return living.length <= 2 ? { kind: "verified", team: "evil", reason: "twoAlive" } : { kind: "none" };
}
