import type { StorytellerLobbyRecord } from "./types";
import type { RulesQueryEnvironment } from "./rulesQuery";
import { validVictoryEvidence, victoryCoverageEligibility } from "./victoryEvidence";
import { bindingOf, createRulesQuery } from "./rulesQuery";
import { executionsAt } from "./lifeEvents";
import { twinPairOf } from "./twinPair";
import { SAINT_EXECUTION_GOOD_TEAM_LOST, SAINT_EXECUTION_EVIL_TEAM_LOST, MAYOR_DAY_END_GOOD_TEAM_WON, RESOLVED_DEMON_DEATH_NO_SUCCESSOR as DEMON_DEATH_NO_SUCCESSOR, isSaintNonqualifyingEvidenceType,
  KLUTZ_CHOICE_RULING, KLUTZ_EVIL_TEAM_LOST, KLUTZ_GOOD_TEAM_LOST } from "./gameRuleFactRegistry";

export type EndGameEligibility = { kind: "verified"; team: "good" | "evil"; reason: "saint" | "mayor" | "demonDeath" | "twoAlive" }
  | { kind: "none" } | { kind: "unknown"; reason: string };
const unknown = (reason: string): EndGameEligibility => ({ kind: "unknown", reason });

/** Read-only assistance for the existing End control. No winner is recorded,
 * and uncertain succession or missing historical qualification stays manual. SV-4d: no route proposes "good wins" while the Evil
 * Twin's block holds ("Good can't win if both Twins live"): that proposal becomes the Storyteller's call. */
export function endGameEligibility(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): EndGameEligibility {
  const result = baseEligibility(game, environment);
  if (result.kind !== "verified" || result.team !== "good") return result;
  const block = twinGoodWinBlock(game, environment);
  return block ? unknown(block.reason) : result;
}

/** What the Evil Twin's "Good can't win if both Twins live" asks of a "good wins" proposal: `blocked` (the Evil Twin functions and both
 * Twins live), or `unknown` (the pair needs the Storyteller before anything is proposed), or null (nothing in the way). Never a winner. */
export type GoodWinBlock = { kind: "blocked"; reason: string } | { kind: "unknown"; reason: string };
export const TWINS_BLOCK_GOOD_WIN = "The Evil Twin and the Good Twin are both alive: good cannot win";

export function twinGoodWinBlock(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): GoodWinBlock | null {
  const pair = twinPairOf(game.players);
  if (pair.kind === "none") return null;
  if (pair.kind === "many") return { kind: "unknown", reason: "More than one Evil Twin is in play: the Twins need manual adjudication." };
  // A dead Evil Twin (even one a Vigormortis lets keep its ability) leaves the Twins no longer both alive.
  if (!pair.evil.alive) return null;
  if (!pair.valid) return { kind: "unknown", reason: pair.reason };
  if (!pair.other!.alive) return null;
  const functions = createRulesQuery(game, environment).abilityFunctions(bindingOf(pair.evil));
  if (!functions.known) return { kind: "unknown", reason: functions.reason };
  return functions.value ? { kind: "blocked", reason: TWINS_BLOCK_GOOD_WIN } : null;
}

/**
 * SV-4d: the Evil Twin's lines for the End control (a reminder only; it records nothing and ends nothing). "If the good player is
 * executed, evil wins": the Good Twin's execution this Day. An execution that did not kill is the Storyteller's ruling. The block on
 * "good wins" has its own line.
 */
export function twinAdvisory(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): string | null {
  if (game.phase !== "day") return null;
  const pair = twinPairOf(game.players);
  if (pair.kind !== "single" || !pair.valid || !pair.good) return null;
  const good = pair.good;
  const evil = pair.evil;
  const query = createRulesQuery(game, environment);
  // Dead without a retained ability: nothing left to fire. A Vigormortis-kept Evil Twin still has its ability.
  if (!evil.alive) { const kept = query.retainsAbility(bindingOf(evil)); if (!kept.known || !kept.value) return null; }
  const events = executionsAt(game, { phase: "day", day: game.day });
  const executed = (events.status === "known" ? events.events : events.recorded).filter((event) => event.kind === "execution" && event.subject.participantId === good.participantId);
  if (!executed.length) return null;
  const functions = query.abilityFunctions(bindingOf(evil));
  if (functions.known && !functions.value) return null;
  const died = executed.some((event) => event.kind === "execution" && event.outcome === "died");
  if (functions.known && died) return "The Good Twin was executed. Evil wins. Check before ending the game";
  return "The Good Twin was executed but may not have died, or the Evil Twin's ability is in doubt. Your ruling";
}

/**
 * SV-4d: the line for a "good wins" route the Evil Twin's block withheld, other than the Demon's death (whose own line carries it):
 * the same wording, naming the route. Null when nothing was withheld.
 */
export function withheldGoodWinLine(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): string | null {
  const base = baseEligibility(game, environment);
  if (base.kind !== "verified" || base.team !== "good" || base.reason === "demonDeath") return null;
  if (twinGoodWinBlock(game, environment)?.kind !== "blocked") return null;
  return `${base.reason === "saint" ? "The Saint was executed" : "The Mayor’s condition is met"}. ${TWINS_BLOCK_GOOD_WIN}`;
}

function baseEligibility(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): EndGameEligibility {
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

/**
 * A reminder only (it never says who wins and records nothing): every Demon is dead but the rules cannot prove the game is over --
 * a Scarlet Woman or Mastermind is still alive, or the death's succession was not recorded. Lets the End control carry its
 * discreet "!" so the Storyteller checks, instead of the cue silently missing.
 */
export function demonGoneAdvisory(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment, twins = true): string | null {
  if (game.phase !== "day" && game.phase !== "night") return null;
  const players = Object.values(game.players).filter(player => !player.isEmpty && !!player.participantId && !player.isTraveler);
  const demon = (player: (typeof players)[number]) => environment.registry.get(player.actualRole)?.type === "demon";
  if (players.some(player => player.alive && demon(player)) || !players.some(player => !player.alive && demon(player))) return null;
  const living = (role: string) => players.some(player => player.alive && player.actualRole === role);
  if (living("scarletwoman")) return "The Demon is dead, but a Scarlet Woman is alive. Check before ending the game";
  if (living("mastermind")) return "The Demon is dead, but the Mastermind is alive. Check before ending the game";
  if (twins && twinGoodWinBlock(game, environment)?.kind === "blocked") return `The Demon is dead. ${TWINS_BLOCK_GOOD_WIN}`;
  return "The Demon is dead. Check whether the game has ended";
}

/**
 * SV-1c: a reminder only (it records nothing and ends nothing), carried on the End control's "!" like the line above. The Klutz's
 * recorded public choice: "if they are evil, your team loses" -- or, for an evil Klutz, good wins. A choice that may register either
 * way is the Storyteller's ruling. https://wiki.bloodontheclocktower.com/Klutz
 */
export function klutzAdvisory(game: Pick<StorytellerLobbyRecord, "phase" | "day" | "gameRuleFacts">, goodCannotWin = false): string | null {
  // Only during the Day the Klutz chose: once the Storyteller lets play go on into the night, the line goes (the fact stays).
  if (game.phase !== "day") return null;
  const has = (type: string) => (game.gameRuleFacts ?? []).some((fact) => fact.type === type && fact.recordedAt?.phase === "day" && fact.recordedAt.day === game.day);
  if (has(KLUTZ_CHOICE_RULING)) return "The Klutz chose a player who may register as evil. Your ruling";
  if (has(KLUTZ_GOOD_TEAM_LOST)) return "The Klutz chose an evil player. Evil wins. Check before ending the game";
  // SV-4d: the Evil Twin's block on "good wins" (the caller reads it: it needs the whole game).
  if (has(KLUTZ_EVIL_TEAM_LOST)) return goodCannotWin ? `The Klutz chose an evil player. ${TWINS_BLOCK_GOOD_WIN}. Check before ending the game` : "The Klutz chose an evil player. Good wins. Check before ending the game";
  return null;
}
