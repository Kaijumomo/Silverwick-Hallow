import { isCanonicalRole } from "@/data/canonical";
import type { ModifierDefinition } from "../modifiers";
import type { RulesQuery, QueryAnswer } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { Alignment, RoleId, RoleType } from "@/stores/types";

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
 *  - holder: "self" (the holder's own death), "neighbours" (protects the alive neighbours: only ever a Storyteller gap for now).
 *  - duration: "permanent" (always on) or "once" (used up by the first survival).
 *  - needsFunctioning: the holder must be sober and healthy.
 *  - causes: "demon" (the Demon's attack only) or "any" (every cause). Further causes (execution, exile, assassin) are added with
 *    the first row that uses them.
 *  - decision: "auto" (the gate answers) or "storyteller" (modelled only as a gap: the whole action stays Manual).
 *  - onSurvive: "nothing" (the death simply does not happen) or "spend" (the ability is used up: abilityUsed + NO ABILITY).
 *    Shaped as a union so a later "hiddenLife" value can be added without reworking the gate.
 *  - alsoCreditedTo: roles whose own protection could equally be the reason for a survival; a spending survival then becomes
 *    ambiguous and nothing is spent automatically (the Storyteller chooses).
 *  - earlyProtection: a named helper for a reviewed rule that cannot be plain data (checked before the row applies).
 * Monk and Innkeeper protection are deliberately NOT rows: they are Effects (safeFromDemon, cannotDie) with approved semantics, read by
 * the Rules Query for every holder; the table is for what a character's OWN ability does to its own death.
 * Knobs from the proposal not read yet (bypassedBy, shownAs, abilityAfter, holder "chosen") arrive with the first behaviour that uses them.
 * https://wiki.bloodontheclocktower.com/Fool
 * https://wiki.bloodontheclocktower.com/Sailor
 * https://wiki.bloodontheclocktower.com/Soldier
 */
export type LifeRuleCause = "demon" | "any";
export type LifeRule = {
  readonly holder: "self" | "neighbours";
  readonly duration: "permanent" | "once";
  readonly needsFunctioning: boolean;
  readonly causes: LifeRuleCause;
  readonly decision: "auto" | "storyteller";
  readonly onSurvive: "nothing" | "spend";
  readonly alsoCreditedTo?: readonly RoleId[];
  readonly earlyProtection?: (query: RulesQuery, target: ParticipantBinding, cause: LifeRuleCause) => boolean;
};

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

const GAP = { holder: "self", duration: "permanent", needsFunctioning: true, causes: "any", decision: "storyteller", onSurvive: "nothing" } as const;
export const LIFE_RULES: Readonly<Partial<Record<RoleId, LifeRule>>> = Object.freeze({
  soldier: { holder: "self", duration: "permanent", needsFunctioning: true, causes: "demon", decision: "auto", onSurvive: "nothing" },
  sailor: { holder: "self", duration: "permanent", needsFunctioning: true, causes: "any", decision: "auto", onSurvive: "nothing" },
  fool: { holder: "self", duration: "once", needsFunctioning: true, causes: "any", decision: "auto", onSurvive: "spend", alsoCreditedTo: ["pacifist"] },
  // Not modelled: the whole action stays Manual while the holder's ability may be working.
  mayor: { ...GAP, earlyProtection: monkProtectsFromDemon },
  lleech: GAP,
  zombuul: GAP,
  tealady: { ...GAP, holder: "neighbours" },
});
export const lifeRuleOf = (roleId: RoleId): LifeRule | undefined =>
  Object.prototype.hasOwnProperty.call(LIFE_RULES, roleId) ? LIFE_RULES[roleId] : undefined;

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
 * known(false) for every other character, a spent holder, or an impaired one; UNKNOWN when sobriety cannot be established.
 */
export function survivesFirstDeath(query: RulesQuery, target: ParticipantBinding): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  const rule = player && lifeRuleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role) || !rule || rule.onSurvive !== "spend") return { known: true, value: false };
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
    // A row that protects others is only ever a gap today: until its neighbour logic exists, it fails closed (Manual) whatever its decision.
    if (!rule || rule.holder === "self") continue;
    const definition = query.roleOf(other.actualRole);
    if (!definition || !isCanonicalRole(definition)) continue;
    const functioning = query.abilityFunctions({ playerId: other.id, participantId: other.participantId });
    if (!functioning.known || functioning.value) return { known: false, reason: `${definition.name} protection is not modeled. Resolve the whole action manually.` };
  }
  if (!player.alive) return { known: true, value: false };
  const functioning = query.abilityFunctions(target);
  const rule = lifeRuleOf(player.actualRole);
  if (!rule || rule.holder !== "self") return { known: true, value: false };
  if (rule.earlyProtection?.(query, target, cause)) return { known: true, value: true };
  if (rule.decision === "storyteller") {
    if (!functioning.known || functioning.value) return { known: false, reason: `${role.name} death interactions are not modeled. Resolve the whole action manually.` };
    return { known: true, value: false };
  }
  // A spending row is not a prevention row: callers that cannot spend the ability (curses, direct protection questions) keep asking.
  if (rule.onSurvive === "spend") {
    if (spendHandled) return { known: true, value: false };
    const survives = survivesFirstDeath(query, target);
    if (!survives.known || survives.value) return { known: false, reason: `The ${role.name} survives its first death and then loses its ability: this attempt must go through the death gate. Resolve manually.` };
    return { known: true, value: false };
  }
  if (rule.causes !== "any" && rule.causes !== cause) return { known: true, value: false };
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
  // Marionette has no ability effects of its own: it is an evil Minion who believes they are good, and every query reads its ACTUAL role and alignment.
  "marionette",
  // Information-only characters (Sects & Violets / Bad Moon Rising): each only reads game state and changes none, so it has no
  // passive effect on another character's ability. Their own answers stay with the Storyteller (REVIEWED_MANUAL, classification.ts).
  "clockmaker", "dreamer", "mathematician", "flowergirl", "savant", "seamstress", "artist", "juggler", "mutant", "chambermaid",
]);
