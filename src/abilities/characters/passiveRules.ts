import { isCanonicalRole } from "@/data/canonical";
import type { ModifierDefinition } from "../modifiers";
import type { RulesQuery, QueryAnswer } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { Alignment, EffectRecord, RoleId, RoleType } from "@/stores/types";

/** Official Spy/Recluse almanacs: optional registration per interaction,
 * including while dead. These are possible forms, never an identity choice.
 * https://wiki.bloodontheclocktower.com/Spy
 * https://wiki.bloodontheclocktower.com/Recluse
 * The caller must verify canonical ownership and current ability functioning.
 */
const OPTIONAL_REGISTRATION: Readonly<Record<RoleId, { alignment: Alignment; types: readonly RoleType[]; whileDead: boolean }>> = {
  spy: { alignment: "good", types: ["townsfolk", "outsider"], whileDead: true },
  recluse: { alignment: "evil", types: ["minion", "demon"], whileDead: true },
};
export const passiveRegistrationOptions = (roleId: RoleId) =>
  Object.prototype.hasOwnProperty.call(OPTIONAL_REGISTRATION, roleId) ? OPTIONAL_REGISTRATION[roleId] : undefined;

/** Character Intelligence 1a/1b extends matrix Section 3 of
 * PHASE10F_CHARACTER_RULES_MATRIX.md. Official rule references:
 * https://wiki.bloodontheclocktower.com/Soldier
 * https://wiki.bloodontheclocktower.com/Vortox
 * Other protections below deliberately have NO resolver. No token text is read.
 */

/**
 * LS-1b: the life-rules table (proposal section 5.2). One row per character whose own ability changes whether a death happens;
 * the death gate (`passiveProtection`, `survivesFirstDeath`, `deathOutcome`) reads these rows and names no character. Adding a
 * character is adding a row (plus, where a rule cannot be plain data, one named helper the row points to).
 *
 * Knobs read today:
 *  - holder: "self" (the holder's own death), "neighbours" (protects others through the row's `covers` helper; without one it
 *    fails closed), "anyGood" (concerns any good player: only ever a Storyteller-choice row).
 *  - duration: "permanent" (always on) or "once" (used up by the first survival).
 *  - needsFunctioning: the holder must be sober and healthy.
 *  - causes: which death the row stops: "demon" (the Demon's attack only), "execution" (an execution only) or "any" (every cause).
 *  - bypassedBy (LS-2a): causes that go around the row ("assassin": "they die, even if for some reason they could not"). A bypassed
 *    row answers "no protection" without asking anything, and a spending row spends nothing.
 *  - decision: "auto" (the gate answers), "choice" (the Storyteller chooses; the app only shows the row's advice and the gate
 *    never answers from it) or "unmodelled" (not modelled: the whole action stays Manual while the holder's ability may work).
 *  - onSurvive: "nothing" (the death simply does not happen) or "spend" (the ability is used up: abilityUsed + NO ABILITY).
 *    A union so "hiddenLife" can be added as a value; NOTE the gate's RESULT types (DeathOutcomeAnswer in rulesQuery.ts, DeathDecision
 *    in shared.ts) still carry only a yes/no spend, so LS-3 must widen them and their readers (survivedOutcome, executionAdvice, voting).
 *  - alsoCreditedTo: roles whose own protection could equally be the reason for a survival; a spending survival then becomes
 *    ambiguous and nothing is spent automatically (the Storyteller chooses).
 *  - earlyProtection: a named helper for a reviewed rule that cannot be plain data (checked before the row applies).
 *  - covers (LS-2b): for a row that protects OTHER players, the named helper that says whether the holder's ability covers this
 *    target right now, leaving out the holder's own sobriety (the gate adds that through needsFunctioning).
 * Monk and Innkeeper protection are deliberately NOT rows (PO ruling 2026-11-12 21:36Z): they are Effects (safeFromDemon, cannotDie)
 * with approved semantics, read by the Rules Query for every holder; the table is for what a character's OWN ability does to a death.
 * Knobs from the proposal not read yet (shownAs, abilityAfter, holder "chosen") arrive with the first behaviour that uses them.
 * `duration: "once"` only acts through spending rows (the Fool).
 * https://wiki.bloodontheclocktower.com/Fool
 * https://wiki.bloodontheclocktower.com/Sailor
 * https://wiki.bloodontheclocktower.com/Soldier
 * https://wiki.bloodontheclocktower.com/Assassin
 */
export type LifeRuleCause = "demon" | "execution" | "assassin" | "any";
export type LifeRule = {
  readonly holder: "self" | "neighbours" | "anyGood";
  readonly duration: "permanent" | "once";
  readonly needsFunctioning: boolean;
  readonly causes: "demon" | "execution" | "any";
  readonly bypassedBy?: readonly LifeRuleCause[];
  readonly decision: "auto" | "choice" | "unmodelled";
  readonly onSurvive: "nothing" | "spend";
  readonly alsoCreditedTo?: readonly RoleId[];
  readonly earlyProtection?: (query: RulesQuery, target: ParticipantBinding, cause: LifeRuleCause) => boolean;
  readonly covers?: (query: RulesQuery, holder: ParticipantBinding, target: ParticipantBinding) => QueryAnswer<boolean>;
};

/** Causes that go around EVERY prevention, Effects included (the Assassin: "they die, even if for some reason they could not").
 * The Rules Query reads this instead of naming the cause, so it stays free of character names. */
const BYPASSES_EVERY_PROTECTION: ReadonlySet<LifeRuleCause> = new Set(["assassin"]);
export const causeBypassesEffectProtection = (cause: LifeRuleCause): boolean => BYPASSES_EVERY_PROTECTION.has(cause);

/** Whether a row stops a death of `cause`: not bypassed by it, and the row's causes cover it. */
export const lifeRuleStops = (rule: LifeRule, cause: LifeRuleCause): boolean =>
  !rule.bypassedBy?.includes(cause) && (rule.causes === "any" || rule.causes === cause);

/** Official Monk example: a protected Mayor cannot bounce the Imp's attack. A reviewed exception for that interaction, not general
 * precedence over other unresolved protections; uncertain or suppressed Safe stays Manual. https://wiki.bloodontheclocktower.com/Monk */
const monkProtectsFromDemon = (query: RulesQuery, target: ParticipantBinding, cause: LifeRuleCause): boolean => {
  const player = query.participant(target);
  if (!player || cause !== "demon") return false;
  return player.effects.some(effect => {
    if (effect.type !== "safeFromDemon") return false;
    const applies = query.effectApplies(target, effect);
    return applies.known && applies.value;
  });
};

/**
 * LS-2b: how a Spy or Recluse registers FOR THE TEA LADY'S ABILITY, decided by the Storyteller during setup (the PO's design,
 * 2026-11-12 23:56Z): a Storyteller fact Effect with no source on that player, set from the Prepare checklist. It never changes the
 * player's real alignment or how they register to anyone else; the Rules Query reads it for the observer "tealady" only, and only
 * while the Spy or Recluse is sober and healthy. No official token, so it is drawn nowhere.
 */
export const TEA_LADY_REGISTRATION_FACTS = { good: "registersGoodToTeaLady", evil: "registersEvilToTeaLady" } as const;
const OBSERVER_REGISTRATION_FACTS: Readonly<Record<RoleId, { readonly good: string; readonly evil: string }>> = { tealady: TEA_LADY_REGISTRATION_FACTS };

/** The stored registration decision for `observer` on these Effects: the alignment, "conflict" if both are stored, or undefined. */
export function observerRegistrationDecision(observer: RoleId | undefined, effects: readonly EffectRecord[]): Alignment | "conflict" | undefined {
  const facts = observer && Object.prototype.hasOwnProperty.call(OBSERVER_REGISTRATION_FACTS, observer) ? OBSERVER_REGISTRATION_FACTS[observer]! : undefined;
  if (!facts) return undefined;
  const good = effects.some(effect => effect.state === "active" && effect.type === facts.good);
  const evil = effects.some(effect => effect.state === "active" && effect.type === facts.evil);
  return good && evil ? "conflict" : good ? "good" : evil ? "evil" : undefined;
}

/**
 * LS-2b: whether this Tea Lady's ability covers `target` right now, leaving out her own sobriety: the target is one of her two alive
 * neighbours (the dead are skipped; never herself) and both alive neighbours are good, read as each registers TO THE TEA LADY (a Spy or
 * Recluse uses its stored setup decision). Unknown when a registration is the Storyteller's. Derived on every call, never stored, so a
 * neighbour dying or changing alignment changes the answer at once. https://wiki.bloodontheclocktower.com/Tea_Lady
 */
export function teaLadyCovers(query: RulesQuery, teaLady: ParticipantBinding, target: ParticipantBinding): QueryAnswer<boolean> {
  const sides = query.aliveNeighbours(teaLady);
  if (!sides.known) return sides;
  const neighbours = [sides.value.left, sides.value.right].filter((side): side is ParticipantBinding => !!side);
  if (!neighbours.some(side => side.participantId === target.participantId)) return { known: true, value: false };
  let undetermined: string | null = null;
  for (const neighbour of neighbours) {
    const alignment = query.registration(neighbour, "tealady").alignment;
    if (alignment.known) {
      if (alignment.value !== "good") return { known: true, value: false };
      continue;
    }
    const player = query.participant(neighbour);
    const role = player && query.roleOf(player.actualRole);
    // A Spy or Recluse with no setup decision: the reason names the missing decision (proposal section 8b, point 2).
    undetermined ??= player && role && isCanonicalRole(role) && passiveRegistrationOptions(player.actualRole) && !observerRegistrationDecision("tealady", player.effects)
      ? `Choose how the ${role.name} registers for the Tea Lady.` : alignment.reason;
  }
  return undetermined ? { known: false, reason: undetermined } : { known: true, value: true };
}

const ASSASSIN = ["assassin"] as const;
const GAP = { holder: "self", duration: "permanent", needsFunctioning: true, causes: "any", decision: "unmodelled", onSurvive: "nothing" } as const;
export const LIFE_RULES: Readonly<Partial<Record<RoleId, LifeRule>>> = Object.freeze({
  soldier: { holder: "self", duration: "permanent", needsFunctioning: true, causes: "demon", bypassedBy: ASSASSIN, decision: "auto", onSurvive: "nothing" },
  sailor: { holder: "self", duration: "permanent", needsFunctioning: true, causes: "any", bypassedBy: ASSASSIN, decision: "auto", onSurvive: "nothing" },
  fool: { holder: "self", duration: "once", needsFunctioning: true, causes: "any", bypassedBy: ASSASSIN, decision: "auto", onSurvive: "spend", alsoCreditedTo: ["pacifist"] },
  // Not modelled: the whole action stays Manual while the holder's ability may be working.
  mayor: { ...GAP, earlyProtection: monkProtectsFromDemon },
  lleech: GAP,
  zombuul: GAP,
  // LS-2b: "If both your alive neighbors are good, they can't die." Every cause but the Assassin. Not the Tea Lady herself.
  tealady: { holder: "neighbours", duration: "permanent", needsFunctioning: true, causes: "any", bypassedBy: ASSASSIN, decision: "auto", onSurvive: "nothing", covers: teaLadyCovers },
});
export const lifeRuleOf = (roleId: RoleId): LifeRule | undefined =>
  Object.prototype.hasOwnProperty.call(LIFE_RULES, roleId) ? LIFE_RULES[roleId] : undefined;

/** Whether a row's answer follows the seating (a row that protects neighbours): the protection-dependency stamp then includes the
 * seating and every alignment. */
export const lifeRuleReadsSeating = (roleId: RoleId): boolean => lifeRuleOf(roleId)?.holder === "neighbours";

/** Every role some row names as an equally possible reason for a survival (the Pacifist for the Fool). */
export const lifeRuleCreditedRoles: ReadonlySet<RoleId> = new Set(Object.values(LIFE_RULES).flatMap(rule => rule?.alsoCreditedTo ?? []));

/** An automatic life rule whose holder is not on the reviewed list (a Sailor's nightly drunk choice is not modelled): wherever the
 * whole roster must be reviewed before automating, this is the row-driven version of "the Sailor keeps it Manual". */
export const lifeRuleNeedsRosterReview = (roleId: RoleId): boolean => {
  const rule = lifeRuleOf(roleId);
  return !!rule && rule.decision === "auto" && !REVIEWED_INTERACTION_ROLES.has(roleId);
};

/** Characters whose ability passively poisons their nearest Townsfolk neighbours
 * (derived by the Rules Query from the seating, never stored).
 * https://wiki.bloodontheclocktower.com/No_Dashii */
export const isNeighbourPoisoner = (roleId: RoleId): boolean => roleId === "nodashii";

/**
 * LS-1: a "survives once" row (the Fool). The holder is genuinely alive and shown alive, so nothing is hidden: the row only says
 * "this death does not happen and the ability is spent". It applies when the ability has not been used and (if the row needs it)
 * functions; a drunk or poisoned holder dies for real. Another character's protection is checked FIRST by the caller: "If another
 * character's ability protects the Fool from death, the Fool does not use their ability."
 * https://wiki.bloodontheclocktower.com/Fool
 * known(false) for every other character, a spent holder, an impaired one, or a cause that bypasses the row; UNKNOWN when sobriety
 * cannot be established.
 */
export function survivesFirstDeath(query: RulesQuery, target: ParticipantBinding, cause?: LifeRuleCause): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  const rule = player && lifeRuleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role) || !rule || rule.onSurvive !== "spend") return { known: true, value: false };
  // LS-2a: a bypassing cause (the Assassin) kills a Fool for real and spends nothing.
  if (cause !== undefined && rule.bypassedBy?.includes(cause)) return { known: true, value: false };
  if (rule.duration === "once" && player.abilityUsed) return { known: true, value: false };
  return rule.needsFunctioning ? query.abilityFunctions(target) : { known: true, value: true };
}

/** `spendHandled`: the caller (the death gate) resolves a spending survival itself, after other protection, so the "spending rows
 * are not modelled here" gap must not fire. Every other caller keeps the Manual fallback for a spending row that would apply. */
export function passiveProtection(query: RulesQuery, target: ParticipantBinding, cause: LifeRuleCause, spendHandled = false): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role)) return { known: false, reason: "This character's protection rules are not verified. Resolve the whole action manually." };
  for (const other of Object.values(query.game.players)) {
    const rule = !other.isEmpty && other.participantId && other.alive ? lifeRuleOf(other.actualRole) : undefined;
    // A Storyteller-choice row only advises (the execution prompt); the gate never answers from it.
    if (!rule || rule.holder === "self" || rule.decision === "choice") continue;
    const definition = query.roleOf(other.actualRole);
    if (!definition || !isCanonicalRole(definition)) continue;
    const holder = { playerId: other.id, participantId: other.participantId! };
    // LS-2b: a modelled row that protects others (the Tea Lady) asks its helper; an unknown answer goes to the Storyteller.
    if (rule.decision === "auto" && rule.covers) {
      if (!lifeRuleStops(rule, cause)) continue;
      const covered = rule.covers(query, holder, target);
      if (!covered.known) return covered;
      if (!covered.value) continue;
      if (!rule.needsFunctioning) return { known: true, value: true };
      const working = query.abilityFunctions(holder);
      if (!working.known || working.value) return working;
      continue;
    }
    // Any other row that protects others fails closed (Manual) while its holder's ability may be working.
    const functioning = query.abilityFunctions(holder);
    if (!functioning.known || functioning.value) return { known: false, reason: `${definition.name} protection is not modeled. Resolve the whole action manually.` };
  }
  if (!player.alive) return { known: true, value: false };
  const functioning = query.abilityFunctions(target);
  const rule = lifeRuleOf(player.actualRole);
  if (!rule || rule.holder !== "self") return { known: true, value: false };
  if (rule.earlyProtection?.(query, target, cause)) return { known: true, value: true };
  if (rule.decision === "unmodelled") {
    if (!functioning.known || functioning.value) return { known: false, reason: `${role.name} death interactions are not modeled. Resolve the whole action manually.` };
    return { known: true, value: false };
  }
  // A Storyteller-choice row is advice only (see above), and a bypassing cause goes around the row without asking anything.
  if (rule.decision === "choice" || rule.bypassedBy?.includes(cause)) return { known: true, value: false };
  // A spending row is not a prevention row: callers that cannot spend the ability (curses, direct protection questions) keep asking.
  if (rule.onSurvive === "spend") {
    if (spendHandled) return { known: true, value: false };
    const survives = survivesFirstDeath(query, target, cause);
    if (!survives.known || survives.value) return { known: false, reason: `The ${role.name} survives its first death and then loses its ability: this attempt must go through the death gate. Resolve manually.` };
    return { known: true, value: false };
  }
  if (!lifeRuleStops(rule, cause)) return { known: true, value: false };
  return rule.needsFunctioning ? functioning : { known: true, value: true };
}

/** Vortox's false-information rule includes impaired Townsfolk. Selecting
 * legal false information is not yet implemented; the ENTIRE action is Manual.
 * Actual character and functioning matter; script membership/shown identity do not.
 */
export function passiveInformationModifiers(query: RulesQuery, roleId: string): ModifierDefinition[] {
  const receiver = query.roleOf(roleId);
  if (!receiver || !isCanonicalRole(receiver) || receiver.type !== "townsfolk") return [];
  for (const source of query.inPlay("vortox")) {
    const player = query.participant(source)!;
    const role = query.roleOf(player.actualRole);
    if (!role || !isCanonicalRole(role) || !player.alive) continue;
    const functioning = query.abilityFunctions(source);
    if (!functioning.known || functioning.value) return [{ id: "character:vortox", source: "character", label: "Vortox information", scopes: ["information"] }];
  }
  return [];
}

/** Bounded reviewed interaction envelope, NOT a character automation catalog.
 * TB roles have either a query/evaluator-owned interaction or no extra passive
 * effect on the existing Night ability scopes. Mayor is checked at its death
 * target. Supported non-TB evaluators retain their existing rule-fact/query seams.
 * Everything else, including homebrew, remains whole-action Manual until its
 * relevant interactions have been reviewed. Dead unreviewed roles also remain
 * Manual: death does not prove their earlier effects have ended.
 */
export const REVIEWED_INTERACTION_ROLES: ReadonlySet<string> = new Set([
  "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor",
  "butler", "drunk", "recluse", "saint", "poisoner", "spy", "scarletwoman", "baron", "imp",
  "cultleader", "pithag", "alhadikhia", "harlot", "vortox",
  // Treacherous 30th: Innkeeper -- its cannotDie / drunk Effects are read through the shared protection and impairment queries.
  "innkeeper", "fool", "nodashii", "vigormortis", "gambler", "shabaloth", "witch", "godfather", "moonchild", "golem", "towncrier", "oracle", "professor",
  // LS-2b: the Tea Lady's protection is a life-rules row (neighbours, registration TO the Tea Lady with the setup decisions); an
  // unknown registration goes to the Storyteller through the death gate's existing question.
  "tealady",
  // LS-2c: the Devil's Advocate's protection is a sourced survivesExecution Effect read by the death gate for executions only.
  "devilsadvocate",
  // Marionette has no ability effects of its own: it is an evil Minion who believes they are good, and every query reads its ACTUAL role and alignment.
  "marionette",
  // Information-only characters (Sects & Violets / Bad Moon Rising): each only reads game state and changes none, so it has no
  // passive effect on another character's ability. Their own answers stay with the Storyteller (REVIEWED_MANUAL, classification.ts).
  "clockmaker", "dreamer", "mathematician", "flowergirl", "savant", "seamstress", "artist", "juggler", "mutant", "chambermaid",
]);
