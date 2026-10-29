import type { PublicLobbyRecord, RoleDef } from "@/stores/types";
import { getBuiltinScript } from "./scripts";
import { lookupOfficialRole } from "./officialRoles";

/**
 * The script a phone shows, from what the lobby publicly carries. A built-in
 * script is looked up by id; any other (an imported custom script) comes from
 * the published name and official character ids, resolved against the official
 * catalogue. An id that does not resolve is skipped, never guessed.
 */
export function publicScriptOf(
  lobby: Pick<PublicLobbyRecord, "scriptId" | "scriptName" | "scriptCharacters"> | null | undefined,
): { name?: string; characters: RoleDef[] } {
  if (!lobby?.scriptId) return { characters: [] };
  const builtin = getBuiltinScript(lobby.scriptId);
  if (builtin) return { name: builtin.name, characters: builtin.characters };
  const characters = (lobby.scriptCharacters ?? [])
    .map((id) => lookupOfficialRole(id))
    .filter((role): role is RoleDef => role !== undefined);
  return { ...(lobby.scriptName ? { name: lobby.scriptName } : {}), characters };
}
