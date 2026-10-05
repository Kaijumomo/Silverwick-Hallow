import { TRAVELERS } from "@/data/travelers";
import { ownedScriptCharacters } from "@/data/roleRegistry";
import type { RoleDef, Script } from "@/stores/types";

/** The ONE displayed definition per RoleId on the Storyteller Table, Roster
 * and Inspector. */
export function buildRoleDisplayMap(script: Script | undefined): Map<string, RoleDef> {
  // SOL-10D-C03: one definition per RoleId -- the first, its owner.
  const map = new Map(ownedScriptCharacters(script).map((c) => [c.id, c]));
  for (const t of TRAVELERS) map.set(t.id, t);
  return map;
}
