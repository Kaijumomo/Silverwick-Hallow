import { isCanonicalRole } from "@/data/canonical";
import { bindingOf, createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import { applyGameRuleFactPlan, planCapturedMastermindFact, planGameRuleFactTransaction } from "./gameRuleFacts";
import { MASTERMIND_FINAL_DAY, MASTERMIND_FINAL_DAY_RULING, isMastermindFinalDayType } from "./gameRuleFactRegistry";
import { twinGoodWinBlock, TWINS_BLOCK_GOOD_WIN } from "./endGameEligibility";
import { executionsAt, lifeEventCoverageAt, momentOrdinal } from "./lifeEvents";
import type { GameRuleFactRecord, STPlayerRecord, StorytellerLobbyRecord } from "./types";

/**
 * SV-5m / SV-5n: the Mastermind (https://wiki.bloodontheclocktower.com/Mastermind).
 *
 * "If the Demon dies by execution (ending the game), play for 1 more day. If a player is then executed, their team loses."
 * How to run: "If the Demon is executed and dies, and the game would end, continue playing the game. (Add a shroud as normal. Do not say
 * that the Demon has died.) Tomorrow, if a good player is executed, declare that the game ends and evil wins, but if an evil player or
 * no player is executed, declare that the game ends and good wins."
 *
 * The app never ends the game and never names a winner on its own: it records that the ability triggered (a captured fact tied to the
 * execution), and the End control carries advisory lines. Nothing is shown to players: the Public Display and phones see only the shroud.
 */

export type MastermindCaptureResult = { ok: true; game: StorytellerLobbyRecord } | { ok: false; message: string };
const accepted = (game: StorytellerLobbyRecord): MastermindCaptureResult => ({ ok: true, game });

const participants = (game: StorytellerLobbyRecord) => Object.values(game.players).filter((player) => !player.isEmpty && !!player.participantId);
const ordinary = (game: StorytellerLobbyRecord) => participants(game).filter((player) => !player.isTraveler);
const sameGame = (before: StorytellerLobbyRecord, after: StorytellerLobbyRecord) => before.code === after.code && before.scriptId === after.scriptId;
/** Demons the Mastermind's jinxes or rulings make the Storyteller's call: the Zombuul's first death "appears" only; the Al-Hadikhia's and
 * the Lleech's jinxes with the Mastermind change what happens. */
const RULING_DEMONS = new Set(["zombuul", "alhadikhia", "lleech"]);

/**
 * SV-5m: called only while accepting a NEW Day execution, with the snapshot immediately before it (`before`) and the result after every
 * consequence (`after`). Records `mastermindFinalDay` (or the ruling fact) when, at that moment: the executed player was the only living
 * Demon (any Demon type) and died; no Demon lives afterwards; no functioning Scarlet Woman succeeds (five or more alive); the Evil Twin's
 * block does not hold ("good cannot win": the game would not end); and a living Mastermind's ability works. Unknown functioning, a
 * Scarlet Woman or Twins in doubt, a Mastermind kept by the Vigormortis's jinx, an Alchemist in play (its jinx), or a Zombuul, Al-Hadikhia
 * or Lleech record the ruling fact instead. The fact names the Mastermind as its source and the execution's Life Event id as its cause.
 * Never a winner and never an ending.
 */
export function captureMastermindFinalDay(before: StorytellerLobbyRecord, after: StorytellerLobbyRecord, eventId: string, environment: RulesQueryEnvironment): MastermindCaptureResult {
  if (!sameGame(before, after) || before.phase !== "day" || after.phase !== "day" || before.day !== after.day) return accepted(after);
  if (before.lifeEventWindow.events.some((event) => event.id === eventId)) return accepted(after);
  const event = after.lifeEventWindow.events.find((event) => event.id === eventId);
  if (!event || event.kind !== "execution" || event.outcome !== "died" || event.moment.day !== before.day) return accepted(after);
  const executed = before.players[event.subject.playerId];
  if (!executed || executed.isEmpty || executed.participantId !== event.subject.participantId || !executed.alive || executed.isTraveler) return accepted(after);
  const now = after.players[executed.id];
  if (!now || now.participantId !== executed.participantId || now.alive) return accepted(after);
  const isDemon = (player: STPlayerRecord) => environment.registry.get(player.actualRole)?.type === "demon";
  if (!isDemon(executed) || event.actualRoleAtEvent !== executed.actualRole) return accepted(after);
  // Another living Demon: the game would not end. The same after every consequence (a succession made the successor a Demon).
  const livingBefore = ordinary(before).filter((player) => player.alive);
  if (livingBefore.filter(isDemon).length !== 1 || ordinary(after).some((player) => player.alive && isDemon(player))) return accepted(after);
  // Two or fewer alive with a living Demon: the game had already ended before this execution.
  if (livingBefore.length <= 2) return accepted(after);
  // A second trigger while a final day is already running (a Pit-Hag's new Demon): the running final day's lines decide.
  if (after.gameRuleFacts.some((fact) => isMastermindFinalDayType(fact.type))) return accepted(after);

  const query = createRulesQuery(before, environment);
  let working: STPlayerRecord | undefined;
  let doubtful: STPlayerRecord | undefined;
  for (const player of participants(before)) {
    const role = environment.registry.get(player.actualRole);
    if (player.actualRole !== "mastermind" || !role || !isCanonicalRole(role) || player.id === executed.id) continue;
    if (player.alive) {
      const functions = query.abilityFunctions(bindingOf(player));
      if (!functions.known) doubtful ??= player;
      else if (functions.value) { working ??= player; }
    } else {
      // The Vigormortis jinx: "A Mastermind that has their ability keeps it if the Vigormortis dies." A dead Mastermind the Vigormortis
      // let keep its ability: the Storyteller's ruling.
      const kept = query.retainsAbility(bindingOf(player));
      if (!kept.known || kept.value) doubtful ??= player;
    }
  }
  const source = working ?? doubtful;
  if (!source) return accepted(after);

  let ruling = !working;
  const demonRole = environment.registry.get(executed.actualRole);
  if (!demonRole || !isCanonicalRole(demonRole) || RULING_DEMONS.has(executed.actualRole)) ruling = true;
  // The Alchemist jinx: "An Alchemist-Mastermind has no Mastermind ability & the Mastermind is not-in-play."
  if (participants(before).some((player) => player.actualRole === "alchemist")) ruling = true;
  // A Scarlet Woman becomes the Demon if five or more players were alive: then the game does not end and nothing triggers.
  if (livingBefore.length >= 5) {
    for (const woman of livingBefore.filter((player) => player.actualRole === "scarletwoman" && player.id !== executed.id)) {
      const functions = query.abilityFunctions(bindingOf(woman));
      if (functions.known && functions.value) return accepted(after);
      if (!functions.known) ruling = true;
    }
  }
  // The Evil Twin's "good cannot win" while both Twins live: the game would not end, so nothing triggers. In doubt: a ruling.
  const block = twinGoodWinBlock(before, environment);
  if (block?.kind === "blocked") return accepted(after);
  if (block?.kind === "unknown") ruling = true;

  const result = planCapturedMastermindFact(after, {
    intents: [{ kind: "apply", type: ruling ? MASTERMIND_FINAL_DAY_RULING : MASTERMIND_FINAL_DAY }],
    context: { provenance: { sourcePlayer: source.id, sourceCharacter: source.actualRole } },
    resolutionId: eventId,
  });
  if (!result.ok) return { ok: false, message: result.message };
  return accepted(result.changed ? applyGameRuleFactPlan(after, result.plan) : after);
}

/**
 * SV-5m: the fact is tied to its execution. While that Day's execution record is still held (the Day itself and the Night after it), a
 * retraction or amendment of the execution, or a correction that brings the executed Demon back to life, takes the fact away in the same
 * commit (a correction History record). Undo needs nothing here: it restores the whole earlier game. Once the record has rolled away the
 * trigger stands ("play for 1 more day").
 */
export function reconcileMastermindFinalDay(game: StorytellerLobbyRecord): MastermindCaptureResult {
  if (game.phase !== "day" && game.phase !== "night") return accepted(game);
  const remove = game.gameRuleFacts.filter((fact) => {
    if (!isMastermindFinalDayType(fact.type) || fact.recordedAt.phase !== "day") return false;
    if (lifeEventCoverageAt(game, { phase: "day", day: fact.recordedAt.day }).status !== "covered") return false;
    const event = game.lifeEventWindow.events.find((event) => event.id === fact.resolutionId);
    if (!event || event.kind !== "execution" || event.outcome !== "died" || event.moment.day !== fact.recordedAt.day) return true;
    const subject = game.players[event.subject.playerId];
    // A correction of the executed player's character (they were not the Demon after all) takes it away too.
    return !subject || subject.isEmpty || subject.participantId !== event.subject.participantId || subject.alive
      || (!!event.actualRoleAtEvent && subject.actualRole !== event.actualRoleAtEvent);
  });
  if (!remove.length) return accepted(game);
  const result = planGameRuleFactTransaction(game, { intents: remove.map((fact) => ({ kind: "remove", type: fact.type })), correction: true });
  if (!result.ok) return { ok: false, message: result.message };
  return accepted(result.changed ? applyGameRuleFactPlan(game, result.plan) : game);
}

/** The Mastermind's fact in force now (recorded on a Day, before its expiry), or null. */
export function activeMastermindFact(game: Pick<StorytellerLobbyRecord, "phase" | "day" | "gameRuleFacts">): GameRuleFactRecord | null {
  if (game.phase !== "day" && game.phase !== "night") return null;
  const now = momentOrdinal({ phase: game.phase, day: game.day });
  return (game.gameRuleFacts ?? []).find((fact) => isMastermindFinalDayType(fact.type) && fact.recordedAt.phase === "day"
    && momentOrdinal(fact.recordedAt) <= now && (!fact.expiresAt || now < momentOrdinal(fact.expiresAt))) ?? null;
}

/** SV-5n (Q13 B): the Day card heading's "Mastermind's final day": the Day after a certain trigger. Not for the ruling fact. */
export function isMastermindFinalDay(game: Pick<StorytellerLobbyRecord, "phase" | "day" | "gameRuleFacts" | "players">, environment: Pick<RulesQueryEnvironment, "registry">): boolean {
  const fact = activeMastermindFact(game);
  return !!fact && fact.type === MASTERMIND_FINAL_DAY && game.phase === "day" && game.day === fact.recordedAt.day + 1 && !livingDemon(game, environment);
}

/** A living, non-Traveller Demon (a Pit-Hag's new Demon, or a correction): the final day's rule no longer reads plainly. */
const livingDemon = (game: Pick<StorytellerLobbyRecord, "players">, environment: Pick<RulesQueryEnvironment, "registry">) =>
  Object.values(game.players).some((player) => !player.isEmpty && !!player.participantId && !player.isTraveler && player.alive && environment.registry.get(player.actualRole)?.type === "demon");

export const MASTERMIND_TRIGGER_LINE = "The Demon was executed and died, but the Mastermind’s ability keeps the game going for one more day";
export const MASTERMIND_TRIGGER_RULING_LINE = "The Demon was executed and died, and the Mastermind may keep the game going for one more day. Your ruling";
export const MASTERMIND_FINAL_DAY_LINE = "Mastermind’s final day: if a good player is executed today, evil wins; if an evil player or nobody is executed, good wins";
export const MASTERMIND_FINAL_DAY_RULING_LINE = "If the Mastermind’s ability worked, today is the final day: a good player executed means evil wins; otherwise good wins. Your ruling";
export const MASTERMIND_GOOD_EXECUTED_LINE = "A good player was executed on the Mastermind’s final day. Evil wins. Check before ending the game";
export const MASTERMIND_EVIL_EXECUTED_LINE = "An evil player was executed on the Mastermind’s final day. Good wins. Check before ending the game";
export const MASTERMIND_NOBODY_EXECUTED_LINE = "Nobody was executed on the Mastermind’s final day. Good wins. Check before ending the game";
export const MASTERMIND_EXECUTION_RULING_LINE = "The player executed on the Mastermind’s final day may count as good or evil. Your ruling";
export const MASTERMIND_NO_RECORD_LINE = "Whether anyone was executed on the Mastermind’s final day is not on record. Your ruling";
export const MASTERMIND_DEMON_ALIVE_LINE = "A Demon is alive again during the Mastermind’s extra day. Your ruling";
export const MASTERMIND_NIGHT_DEATH_LINE = "The Demon died at night, and the Mastermind is alive. Your ruling";

/**
 * SV-5n: the Mastermind's line for the End control (a reminder only; it records nothing and ends nothing). On the Day of the trigger and
 * the Night after it: the game goes on. On the final Day: the rule, then, the moment an execution is recorded (Q14 A), who wins by the
 * executed player's team, whatever the execution's outcome. "Nobody executed" waits for dusk (the Night after the final Day). The final
 * Day's executions are read live from the record, so Undo or a correction of that execution changes the line. A player who may register
 * either way, or whose character changed since the execution, is the Storyteller's ruling. The ruling fact gives ruling lines throughout.
 */
export function mastermindAdvisory(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): string | null {
  const fact = activeMastermindFact(game);
  if (!fact) return null;
  const source = fact.provenance?.sourceParticipant;
  if (source?.kind !== "participant") return null;
  const owner = game.players[source.playerId];
  if (!owner || owner.isEmpty || owner.participantId !== source.participantId) return null;
  const ruling = fact.type === MASTERMIND_FINAL_DAY_RULING;
  const trigger = fact.recordedAt.day;
  if (livingDemon(game, environment)) return MASTERMIND_DEMON_ALIVE_LINE;
  if ((game.phase === "day" && game.day === trigger) || (game.phase === "night" && game.day === trigger + 1))
    return ruling ? MASTERMIND_TRIGGER_RULING_LINE : MASTERMIND_TRIGGER_LINE;
  const finalDay = trigger + 1;
  if (!(game.phase === "day" && game.day === finalDay) && !(game.phase === "night" && game.day === finalDay + 1)) return null;
  const record = executionsAt(game, { phase: "day", day: finalDay });
  const executions = record.status === "known" ? record.events : record.recorded;
  const block = twinGoodWinBlock(game, environment)?.kind ?? null;
  const result = (line: string) => {
    // The Evil Twin's "good cannot win" while both Twins live and the Evil Twin works (as the Klutz's good-win line reads it).
    const good = line === MASTERMIND_EVIL_EXECUTED_LINE || line === MASTERMIND_NOBODY_EXECUTED_LINE;
    const lead = line.slice(0, line.indexOf(". ") + 1);
    if (good && block === "blocked") return `${lead} ${TWINS_BLOCK_GOOD_WIN}. ${ruling ? "Your ruling" : "Check before ending the game"}`;
    if (good && block === "unknown") return `${lead} Good may win, but the Twins need your ruling`;
    return ruling ? line.replace(" Check before ending the game", " Your ruling") : line;
  };
  if (!executions.length) {
    if (game.phase === "day") return ruling ? MASTERMIND_FINAL_DAY_RULING_LINE : MASTERMIND_FINAL_DAY_LINE;
    return record.status === "known" ? result(MASTERMIND_NOBODY_EXECUTED_LINE) : MASTERMIND_NO_RECORD_LINE;
  }
  if (executions.length > 1) return MASTERMIND_EXECUTION_RULING_LINE;
  const event = executions[0]!;
  const subject = game.players[event.subject.playerId];
  if (!subject || subject.isEmpty || subject.participantId !== event.subject.participantId || (event.actualRoleAtEvent && subject.actualRole !== event.actualRoleAtEvent))
    return MASTERMIND_EXECUTION_RULING_LINE;
  const team = createRulesQuery(game, environment).registration(bindingOf(subject)).alignment;
  if (!team.known) return MASTERMIND_EXECUTION_RULING_LINE;
  return result(team.value === "good" ? MASTERMIND_GOOD_EXECUTED_LINE : MASTERMIND_EVIL_EXECUTED_LINE);
}

/**
 * SV-5n (Q15 A): with no trigger recorded, a Demon who died at night (an ordinary night death, or a night "execution" such as the
 * Mutant's, which the app records as a death) while a Mastermind is alive: the Storyteller's ruling. The app never starts a final day by
 * itself. Read from the Life Event record (the current and previous phase); null otherwise.
 */
export function mastermindNightDeathLine(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): string | null {
  if (activeMastermindFact(game)) return null;
  const players = ordinary(game);
  const isDemonRole = (role: string | undefined) => !!role && environment.registry.get(role)?.type === "demon";
  if (players.some((player) => player.alive && isDemonRole(player.actualRole))) return null;
  if (!players.some((player) => player.alive && player.actualRole === "mastermind")) return null;
  const night = game.lifeEventWindow.events.some((event) => event.kind === "death" && event.moment.phase === "night"
    && isDemonRole(event.actualRoleAtEvent ?? game.players[event.subject.playerId]?.actualRole));
  return night ? MASTERMIND_NIGHT_DEATH_LINE : null;
}
