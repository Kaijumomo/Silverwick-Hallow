import { isCanonicalRole } from "@/data/canonical";
import { bindingOf, createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import { applyGameRuleFactPlan, planCapturedMastermindFact, planGameRuleFactTransaction } from "./gameRuleFacts";
import { MASTERMIND_FINAL_DAY, MASTERMIND_FINAL_DAY_RULING, isMastermindFinalDayType } from "./gameRuleFactRegistry";
import { twinGoodWinBlock } from "./endGameEligibility";
import { lifeEventCoverageAt } from "./lifeEvents";
import type { STPlayerRecord, StorytellerLobbyRecord } from "./types";

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
    return !subject || subject.isEmpty || subject.participantId !== event.subject.participantId || subject.alive;
  });
  if (!remove.length) return accepted(game);
  const result = planGameRuleFactTransaction(game, { intents: remove.map((fact) => ({ kind: "remove", type: fact.type })), correction: true });
  if (!result.ok) return { ok: false, message: result.message };
  return accepted(result.changed ? applyGameRuleFactPlan(game, result.plan) : game);
}

