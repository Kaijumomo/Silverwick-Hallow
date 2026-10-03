import raw from "@/data/canonical/roles.json";
import type { ModifierDefinition } from "../modifiers";

/**
 * Phase 10F Slice 7: VERIFIED modifier hooks (matrix Section 16). A verified
 * hook only ever answers rules-neutral results; it never pretends to know
 * state Silverwick does not hold.
 *
 * Toymaker: "The Demon may choose not to attack & must do this at least once
 * per game." Whether the mandatory skip already happened is game-level state
 * with no authoritative home until 10G (never a Reminder). So the hook asks an
 * explicit Storyteller judgment for a canonical Demon's death-touching
 * evaluation (its attack) and has NO effect on any other evaluation -- the
 * previous blanket gate over every death / targeting / setup / information
 * evaluation is narrowed to what the verified rule can affect.
 */
const CANONICAL_DEMONS = new Set((raw as { id: string; team: string }[]).filter((r) => r.team === "demon").map((r) => r.id));

export const TOYMAKER_ATTACK_MESSAGE = "Toymaker is in play: the Demon may choose not to attack, and must skip at least once per game; if this attack could end the game and the required skip has not happened, the Demon does not attack. Silverwick does not track that skip history -- confirm this attack is allowed, or resolve manually.";

export const VERIFIED_MODIFIER_HOOKS: ReadonlyMap<string, NonNullable<ModifierDefinition["hook"]>> = new Map([
  ["fabled:toymaker", ({ roleId, scopes }) => (CANONICAL_DEMONS.has(roleId) && scopes.includes("death")
    ? { kind: "judgment", message: TOYMAKER_ATTACK_MESSAGE }
    : { kind: "noEffect" })],
]);
