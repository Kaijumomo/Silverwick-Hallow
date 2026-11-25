import { isCanonicalRole } from "@/data/canonical";
import { needsShownIdentity } from "@/stores/identity";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { livesOnAfterDeath, REVIEWED_INTERACTION_ROLES } from "./passiveRules";
import { isTrulyAlive } from "@/stores/lifeState";

export type ScarletWomanSuccession = { kind: "none" }
  | { kind: "successor"; target: ParticipantBinding }
  | { kind: "manual"; reason: string };

/** B4 extends PHASE10F_CHARACTER_RULES_MATRIX.md Sections 6 and 18.1 from
 * self-pass priority to supported death consequences.
 * Evaluate only the snapshot immediately BEFORE the actual death. This is
 * an ephemeral character ruling, not a Life writer or a persisted trigger.
 * https://wiki.bloodontheclocktower.com/Scarlet_Woman */
/** `livesOn` (BM-2): the death's own ruling on a first death, when it carries one (an Assassin's kill is real); absent, the rules decide. */
export function scarletWomanSuccession(query: RulesQuery, target: ParticipantBinding, interaction?: "slayer", livesOn?: boolean): ScarletWomanSuccession {
  const manual = (reason: string): ScarletWomanSuccession => ({ kind: "manual", reason });
  const dying = query.participant(target);
  if (!dying) return manual("The dying participant changed. Resolve the entire action manually.");
  // BM-2: a player who registers as dead but secretly lives (the Zombuul) can still die for real: that death is a Demon death.
  if (!isTrulyAlive(dying)) return { kind: "none" };
  // A Recluse registering as a Demon to the Slayer is still an actual Outsider.
  // That shot's choice is not registration to the Scarlet Woman and cannot
  // transfer the real Demon's role.
  const dyingRole = query.roleOf(dying.actualRole);
  if (interaction === "slayer" && dyingRole?.id === "recluse" && isCanonicalRole(dyingRole)) return { kind: "none" };
  // The count is the table's (players who register as alive), with the dying player when the table still saw them alive (independent
  // check C2: a Zombuul who already registers as dead is not counted).
  const living = Object.values(query.game.players).filter(p => !p.isEmpty && p.participantId && (p.alive || (p.id === dying.id && dying.alive)) && !p.isTraveler);
  if (living.length < 5) return { kind: "none" };
  const women = living.filter(p => p.actualRole === "scarletwoman");
  if (!women.length) return { kind: "none" };
  // BM-2 (PO 2026-11-12 17:22Z): the Zombuul's first death only registers: no Demon dies, so the Scarlet Woman stays a Minion.
  const first = livesOn !== undefined ? { known: true as const, value: livesOn } : livesOnAfterDeath(query, target);
  if (!first.known) return manual(first.reason);
  if (first.value) return { kind: "none" };
  const registered = query.registersAsType(target, "demon", "scarletwoman");
  if (registered.known && !registered.value) return { kind: "none" };
  if (!registered.known) return manual(registered.reason);
  const demon = query.roleOf(dying.actualRole);
  const woman = query.roleOf("scarletwoman");
  if (!demon || demon.id !== "imp" || !isCanonicalRole(demon) || !woman || !isCanonicalRole(woman))
    return manual("This Demon succession is outside verified Trouble Brewing rules.");
  for (const player of Object.values(query.game.players)) {
    if (player.isEmpty || !player.participantId) continue;
    const role = query.roleOf(player.actualRole);
    if (!role || !isCanonicalRole(role) || !REVIEWED_INTERACTION_ROLES.has(role.id) ||
      player.effects.some(effect => effect.state === "active" &&
        !query.effectApplies({ playerId: player.id, participantId: player.participantId! }, effect).known))
      return manual("A character or effect has unverified Scarlet Woman succession interactions.");
  }
  if (living.filter(p => query.roleOf(p.actualRole)?.type === "demon").length !== 1)
    return manual("Succession with multiple living Demons requires Storyteller judgment.");
  const gate = query.modifierGate("scarletwoman", ["death", "role"]);
  if (gate.kind !== "clear") return manual("A rule affecting succession requires Storyteller judgment.");
  const candidates: ParticipantBinding[] = [];
  for (const player of women) {
    const binding = { playerId: player.id, participantId: player.participantId! };
    const functions = query.abilityFunctions(binding);
    if (!functions.known) return manual(functions.reason);
    if (functions.value) candidates.push(binding);
  }
  if (!candidates.length) return { kind: "none" };
  if (candidates.length !== 1) return manual("Multiple functioning Scarlet Women require Storyteller judgment.");
  const heir = query.participant(candidates[0]!)!;
  if (heir.shownRole !== heir.actualRole || needsShownIdentity(heir.actualRole) ||
    ["drunk_fake_role_behavior", "marionette_fake_good_behavior", "fake_demon_behavior"].includes(heir.behaviorMode))
    return manual("The successor has a concealed identity. Resolve the entire action manually.");
  return { kind: "successor", target: candidates[0]! };
}
