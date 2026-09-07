import type { RoleRegistry } from "@/data/roleRegistry";
import type { STPlayerRecord } from "./types";
import { needsShownIdentity } from "./identity";

/** Storyteller procedure only. Never use this to resolve authoritative ability. */
export function wakeIdentity(player: STPlayerRecord, registry: RoleRegistry) {
  if (player.isEmpty || !player.actualRole || !player.shownRole) return null;
  const role = registry.get(player.shownRole);
  if (!role) return null;
  const simulated = needsShownIdentity(player.actualRole)
    || player.actualRole !== player.shownRole
    || ["drunk_fake_role_behavior", "marionette_fake_good_behavior", "fake_demon_behavior"].includes(player.behaviorMode);
  return { role, actualRoleId: player.actualRole, shownRoleId: player.shownRole, simulated };
}
