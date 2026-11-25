import { interactionCoverageEligibility } from "@/abilities/automationEligibility";
import { lifeRuleCreditedRoles, lifeRuleOf } from "@/abilities/characters/passiveRules";
import { canonicalRoles, isCanonicalRole } from "@/data/canonical";
import { bindingOf, createRulesQuery, type RulesQueryEnvironment } from "./rulesQuery";
import type { PlayerId, STPlayerRecord, StorytellerLobbyRecord } from "./types";

/**
 * LS-1: what the shared death gate says about an EXECUTION of one player. Advice for the Storyteller, never a decision: the
 * Storyteller records the actual outcome ("died" / "survived") exactly as before, and may always override.
 *
 * - `survives`: the gate knows this execution does not kill (the Fool's first death, a sober Sailor, known protection).
 *   `spends`: the survival uses up the player's own ability (the Fool), so recording "survived" also records that use.
 * - A Pacifist in play makes the Fool's survival ambiguous (who saved them is the Storyteller's choice, and the Fool does not
 *   use its ability when someone else protects it), so nothing is spent automatically and the note says so.
 * - Unknown protection (custom or generic Protected markers) gives no advice here: the Storyteller decides, as before.
 *
 * Cause: "execution" (LS-2a; it was "any", which answers the same for every character built before LS-2). The Soldier and the
 * Monk protect from the Demon only, so they never advise on an execution.
 */
export type ExecutionAdvice = { kind: "survives"; spends: boolean; note: string } | { kind: "ambiguous"; note: string };

export function executionAdvice(game: StorytellerLobbyRecord, playerId: PlayerId, environment?: RulesQueryEnvironment): ExecutionAdvice | null {
  const player = game.players[playerId];
  if (!environment || !player || player.isEmpty || !player.participantId || !player.alive) return null;
  // Advice follows the same line automation draws: every character in play must be reviewed (a Sailor's nightly drunk choice, a Devil's Advocate's protection and the like are not modelled).
  const query = createRulesQuery(game, environment);
  // Roles any row names as equally able to be the reason for a survival are handled below, so they do not force Manual here.
  if (interactionCoverageEligibility(query, [...lifeRuleCreditedRoles]).kind === "manual") return null;
  const credited = lifeRuleOf(player.actualRole)?.alsoCreditedTo ?? [];
  const outcome = query.deathOutcome({ playerId, participantId: player.participantId }, "execution");
  if (!outcome.known || outcome.value.kind !== "survives") return null;
  const rivals = credited.filter(id => Object.values(game.players).some(p => !p.isEmpty && p.alive && p.actualRole === id));
  const name = query.roleOf(player.actualRole)?.name ?? player.actualRole;
  if (outcome.value.spends && rivals.length) {
    const rival = query.roleOf(rivals[0]!)?.name ?? rivals[0];
    return { kind: "ambiguous", note: `${player.name} is a ${name} whose ability is unused, and a ${rival} is in play: if the ${name} survives, you decide whether the ${name}'s ability or the ${rival} did it. Nothing is spent automatically.` };
  }
  if (outcome.value.spends) {
    return { kind: "survives", spends: true, note: `${player.name} is a ${name} with the ability unused: the ${name} survives this execution, and recording "survived" also uses up the ability.` };
  }
  return { kind: "survives", spends: false, note: `${player.name} is protected from this death: they survive the execution.` };
}

/**
 * SV-4 (review finding): whether the rules POSITIVELY establish that an execution of this player kills them: the same coverage line as
 * `executionAdvice`, and the shared death gate answers "dies" (not unknown protection, a custom or generic Protected marker, or an
 * unreviewed character in play). Where it does not, the Storyteller is asked, as the ordinary execution prompt always does.
 */
export function executionDeathKnown(game: StorytellerLobbyRecord, playerId: PlayerId, environment?: RulesQueryEnvironment): boolean {
  const player = game.players[playerId];
  if (!environment || !player || player.isEmpty || !player.participantId || !player.alive) return false;
  const query = createRulesQuery(game, environment);
  if (interactionCoverageEligibility(query, [...lifeRuleCreditedRoles]).kind === "manual") return false;
  // A Fabled or Loric rule that touches death (the Ventriloquist) is the Storyteller's to apply: never a certain death.
  if (query.modifierGate(player.actualRole, ["death"]).kind !== "clear") return false;
  const outcome = query.deathOutcome({ playerId, participantId: player.participantId }, "execution");
  return outcome.known && outcome.value.kind === "dies";
}

/**
 * LS-2d: the characters whose Storyteller-choice life rule concerns an executed good player (the Pacifist), while one is alive. Their
 * note in the execution prompt is produced from the table: the two Storyteller screens no longer name a character for it. Shown while
 * the holder is alive, impaired or not (unchanged): the Storyteller decides anyway. Canonical names, one per character.
 */
export function executionChoiceNames(players: Readonly<Record<string, STPlayerRecord>>): string[] {
  const names = new Set<string>();
  for (const player of Object.values(players)) {
    if (player.isEmpty || !player.alive || !player.actualRole) continue;
    const rule = lifeRuleOf(player.actualRole);
    if (!rule || rule.decision !== "choice" || rule.holder !== "anyGood" || rule.causes !== "execution") continue;
    const role = canonicalRoles([player.actualRole])[0];
    if (role && isCanonicalRole(role)) names.add(role.name);
  }
  return [...names];
}

/**
 * BM-1a: the Storyteller-choice characters that matter for THIS execution (the Pacifist). A choice row matters only while its holder
 * is alive, its ability certainly works (a drunk, poisoned or changed holder saves nobody) and the executed player certainly is the
 * kind it covers (a good player, as they register). Anything unknown still counts: the Storyteller is asked. With no environment the
 * rules cannot be read, so every living holder counts as before. Never decides; only says whether to ask.
 */
export function executionChoiceFor(game: StorytellerLobbyRecord, playerId: PlayerId, environment?: RulesQueryEnvironment): string[] {
  const names = executionChoiceNames(game.players);
  const target = game.players[playerId];
  if (!names.length || !environment || !target || target.isEmpty || !target.participantId) return names;
  const query = createRulesQuery(game, environment);
  const covered = new Set<string>();
  for (const holder of Object.values(game.players)) {
    if (holder.isEmpty || !holder.alive || !holder.participantId || !holder.actualRole) continue;
    const rule = lifeRuleOf(holder.actualRole);
    if (!rule || rule.decision !== "choice" || rule.holder !== "anyGood" || rule.causes !== "execution") continue;
    const works = query.abilityFunctions(bindingOf(holder));
    if (works.known && !works.value) continue;
    const alignment = query.registration(bindingOf(target)).alignment;
    if (alignment.known && alignment.value !== "good") continue;
    const role = canonicalRoles([holder.actualRole])[0];
    if (role && isCanonicalRole(role)) covered.add(role.name);
  }
  return [...covered];
}

/**
 * BM-1 (PO Q1 A, 2026-11-24): the rules are CERTAIN this execution does not kill and nothing is spent: a sober Sailor, a Tea Lady's
 * neighbour, a Devil's Advocate's chosen player. Execute then records "survived" by itself, as it records "died" when certain. A
 * survival that uses up an ability (the Fool), an ambiguous one and anything unknown still ask. A Pacifist is irrelevant here: the
 * survival is already certain, so nobody is asked and nothing shows which ability did it.
 */
export function executionSurvivalKnown(game: StorytellerLobbyRecord, playerId: PlayerId, environment?: RulesQueryEnvironment): boolean {
  const advice = executionAdvice(game, playerId, environment);
  if (!environment || advice?.kind !== "survives" || advice.spends) return false;
  const player = game.players[playerId];
  // A Fabled or Loric rule that touches death (the Ventriloquist) is the Storyteller's to apply: never a certain survival.
  return !!player && createRulesQuery(game, environment).modifierGate(player.actualRole, ["death"]).kind === "clear";
}

/** Whether recording `survived` for this execution also records the player's own ability use (the Fool). Pure; used by the voting plan. */
export const executionSpendsAbility = (game: StorytellerLobbyRecord, playerId: PlayerId, environment?: RulesQueryEnvironment): boolean => {
  const advice = executionAdvice(game, playerId, environment);
  return advice?.kind === "survives" && advice.spends;
};
