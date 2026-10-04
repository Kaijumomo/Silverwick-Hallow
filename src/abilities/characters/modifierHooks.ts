import raw from "@/data/canonical/roles.json";
import type { ModifierDefinition } from "../modifiers";
import { TOYMAKER_DEMON_SKIP_OCCURRED, gameRuleFactActive } from "@/stores/gameRuleFacts";

/**
 * Phase 10F Slice 7: VERIFIED modifier hooks (matrix Section 16). A verified
 * hook only ever answers rules-neutral results; it never pretends to know
 * state Silverwick does not hold.
 *
 * Toymaker: "The Demon may choose not to attack & must do this at least once
 * per game." Phase 10G (PHASE10G Section 11.1): whether the mandatory skip
 * already happened is now authoritative game-scoped state -- the positive
 * `toymakerDemonSkipOccurred` Rule Fact, read from Current State (never a
 * Reminder, never Night progress or a skipped Demon row). For a canonical
 * Demon's death-touching evaluation (its attack):
 *  - skip recorded -> no effect: the missing-skip history no longer gates an
 *    otherwise valid attack;
 *  - skip NOT recorded -> an explicit Storyteller judgment, because whether
 *    this attack could end the game is never computed (no win solver).
 * Any other evaluation is unaffected.
 */
const CANONICAL_DEMONS = new Set((raw as { id: string; team: string }[]).filter((r) => r.team === "demon").map((r) => r.id));

export const TOYMAKER_ATTACK_MESSAGE = "Toymaker is in play and the Demon's required skip has not been recorded yet: if this attack could end the game, the Demon does not attack. Confirm this attack is allowed, or record the skip under Game rule facts / resolve manually.";

export const VERIFIED_MODIFIER_HOOKS: ReadonlyMap<string, NonNullable<ModifierDefinition["hook"]>> = new Map([
  ["fabled:toymaker", ({ roleId, scopes, game }) => {
    if (!CANONICAL_DEMONS.has(roleId) || !scopes.includes("death")) return { kind: "noEffect" };
    return gameRuleFactActive(game, TOYMAKER_DEMON_SKIP_OCCURRED) ? { kind: "noEffect" } : { kind: "judgment", message: TOYMAKER_ATTACK_MESSAGE };
  }],
]);
