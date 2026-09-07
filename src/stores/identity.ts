import type { RoleRegistry } from "@/data/roleRegistry";
import type { BehaviorMode, RoleId, STPlayerRecord } from "./types";

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
