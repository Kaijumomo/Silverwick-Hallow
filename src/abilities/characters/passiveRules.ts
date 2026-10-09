import { isCanonicalRole } from "@/data/canonical";
import type { ModifierDefinition } from "../modifiers";
import type { RulesQuery, QueryAnswer } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";

/** Character Intelligence 1a/1b extends matrix Section 3 of
 * PHASE10F_CHARACTER_RULES_MATRIX.md. Official rule references:
 * https://wiki.bloodontheclocktower.com/Soldier
 * https://wiki.bloodontheclocktower.com/Vortox
 * Other protections below deliberately have NO resolver. No token text is read.
 */
const TARGET_DEATH_GAPS = new Set(["fool", "sailor", "mayor", "lleech", "zombuul"]);
const EXTERNAL_PROTECTION_GAPS = new Set(["tealady", "innkeeper"]);

export function passiveProtection(query: RulesQuery, target: ParticipantBinding, cause: "demon" | "any"): QueryAnswer<boolean> {
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
  if (TARGET_DEATH_GAPS.has(player.actualRole) && (!functioning.known || functioning.value)) {
    return { known: false, reason: `${role.name} death interactions are not modeled. Resolve the whole action manually.` };
  }
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
]);
