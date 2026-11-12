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
const TARGET_DEATH_GAPS = new Set(["mayor", "lleech", "zombuul"]);
const EXTERNAL_PROTECTION_GAPS = new Set(["tealady"]);

/** Characters whose ability passively poisons their nearest Townsfolk neighbours
 * (derived by the Rules Query from the seating, never stored).
 * https://wiki.bloodontheclocktower.com/No_Dashii */
export const isNeighbourPoisoner = (roleId: RoleId): boolean => roleId === "nodashii";

/**
 * LS-1 (life rules): the Fool's "survives its first death" row. The Fool is genuinely alive and shown alive, so nothing is hidden:
 * the row only says "this death does not happen and the ability is spent". It applies when the Fool has not yet used the ability and
 * the ability functions (a drunk or poisoned Fool dies for real). Another character's protection is checked FIRST by the caller:
 * "If another character's ability protects the Fool from death, the Fool does not use their ability."
 * https://wiki.bloodontheclocktower.com/Fool
 * `known(false)` for every other character, a spent Fool, or an impaired one; UNKNOWN when sobriety cannot be established.
 */
export function survivesFirstDeath(query: RulesQuery, target: ParticipantBinding): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role) || player.actualRole !== "fool") return { known: true, value: false };
  if (player.abilityUsed) return { known: true, value: false };
  return query.abilityFunctions(target);
}

/** `foolHandled`: the caller (the death gate) resolves the Fool's own survival itself, after other protection, so the old
 * "Fool is not modelled" gap must not fire. Every other caller keeps the Manual fallback for an unspent, functioning Fool. */
export function passiveProtection(query: RulesQuery, target: ParticipantBinding, cause: "demon" | "any", foolHandled = false): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role)) return { known: false, reason: "This character's protection rules are not verified. Resolve the whole action manually." };
  for (const other of Object.values(query.game.players)) {
    if (other.isEmpty || !other.participantId || !other.alive || !EXTERNAL_PROTECTION_GAPS.has(other.actualRole)) continue;
    const definition = query.roleOf(other.actualRole);
    if (!definition || !isCanonicalRole(definition)) continue;
    const functioning = query.abilityFunctions({ playerId: other.id, participantId: other.participantId });
    if (!functioning.known || functioning.value) return { known: false, reason: `${definition.name} protection is not modeled. Resolve the whole action manually.` };
  }
  if (!player.alive) return { known: true, value: false };
  const functioning = query.abilityFunctions(target);
  // Official Monk example: a protected Mayor cannot bounce the Imp's attack.
  // This is a reviewed exception for that interaction, not general precedence
  // over other unresolved protections. Canonical ownership and external gaps
  // have already been checked above; uncertain/suppressed Safe stays Manual.
  // https://wiki.bloodontheclocktower.com/Monk
  if (player.actualRole === "mayor" && cause === "demon") {
    for (const effect of player.effects) {
      if (effect.type !== "safeFromDemon") continue;
      const applies = query.effectApplies(target, effect);
      if (applies.known && applies.value) return { known: true, value: true };
    }
  }
  if (TARGET_DEATH_GAPS.has(player.actualRole) && (!functioning.known || functioning.value)) {
    return { known: false, reason: `${role.name} death interactions are not modeled. Resolve the whole action manually.` };
  }
  // LS-1: the Fool is not a prevention row. Callers that cannot spend its ability (curses, direct protection questions) keep asking.
  if (player.actualRole === "fool" && !foolHandled) {
    const survives = survivesFirstDeath(query, target);
    if (!survives.known || survives.value) return { known: false, reason: "The Fool survives its first death and then loses its ability: this attempt must go through the death gate. Resolve manually." };
  }
  // LS-1: the Sailor "can't die" while sober (not while drunk or poisoned); every cause.
  // https://wiki.bloodontheclocktower.com/Sailor
  if (player.actualRole === "sailor") return functioning;
  if (player.actualRole !== "soldier" || cause !== "demon") return { known: true, value: false };
  return functioning;
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
