import type { RoleRegistry } from "@/data/roleRegistry";
import type { BehaviorMode, RoleDef, RoleId, STPlayerRecord, StorytellerLobbyRecord } from "./types";

// Central setup policy only. Projection never consults actual identity or this
// table to invent what a player believes. Custom perception remains explicit.
const concealedIdentities = new Map<RoleId, BehaviorMode>([
  ["drunk", "drunk_fake_role_behavior"],
  ["marionette", "marionette_fake_good_behavior"],
  ["lunatic", "fake_demon_behavior"],
]);

export function needsShownIdentity(role: RoleId): boolean {
  return concealedIdentities.has(role);
}

/**
 * Which shown-role choices are policy-valid for a concealed behavior mode.
 * The single source of truth for both the Storyteller's shown-role picker
 * (PlayerDrawer) and initial-reveal readiness (revealReadiness.ts) — never
 * duplicated between them. Undefined means no restriction (normal/poisoned/
 * custom behavior never constrains the shown role).
 */
export function shownRoleFilter(behavior: BehaviorMode): ((r: RoleDef) => boolean) | undefined {
  if (behavior === "drunk_fake_role_behavior") return (r) => r.type === "townsfolk";
  if (behavior === "fake_demon_behavior") return (r) => r.type === "demon";
  if (behavior === "marionette_fake_good_behavior")
    return (r) => r.type === "townsfolk" || r.type === "outsider";
  return undefined;
}

/**
 * Initial Deal establishes Storyteller truth; initial Reveal is the separate,
 * explicit act of publishing it to players. Legacy compatibility mirrors
 * isPostDeal's day > 0 rule: a game that already left Setup at least once
 * has necessarily already passed its initial reveal, even for an older
 * snapshot recorded before this field existed.
 */
export function isInitialRevealComplete(
  game: Pick<StorytellerLobbyRecord, "day" | "setupRolesRevealed">
): boolean {
  return !!game.setupRolesRevealed || game.day > 0;
}

/** Dealing explicitly establishes ordinary perception; concealed roles wait. */
export function dealtIdentity(role: RoleId, registry: RoleRegistry): Pick<STPlayerRecord,
  "actualRole" | "shownRole" | "shownAlignment" | "behaviorMode"> {
  const mode = concealedIdentities.get(role);
  return {
    actualRole: role,
    shownRole: mode ? null : role,
    shownAlignment: mode ? null : registry.alignmentOf(role),
    behaviorMode: mode ?? "normal",
  };
}
