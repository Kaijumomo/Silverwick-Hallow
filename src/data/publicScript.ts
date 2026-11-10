import type { PublicHomebrewRole, PublicLobbyRecord, RoleDef } from "@/stores/types";
import { getBuiltinScript } from "./scripts";
import { lookupOfficialRole } from "./officialRoles";
import { ART_BASE } from "./localArt";

type PublicScriptFields = Pick<PublicLobbyRecord, "scriptId" | "scriptName" | "scriptCharacters" | "scriptHomebrew">;

/**
 * A published homebrew character as a phone shows it: the name, team and ability the script sheet prints,
 * drawn with the generic icon of its team (never the art of an official character that shares its id, and
 * never an image from an address the script's author chose).
 */
const homebrewRole = (entry: PublicHomebrewRole): RoleDef => ({
  id: entry.id,
  name: entry.name,
  type: entry.type,
  ...(entry.ability ? { ability: entry.ability } : {}),
  provenance: { status: "homebrew" },
  iconUrl: `${ART_BASE}/characters/generic/${entry.type}.png`,
});

/**
 * The script a phone shows, from what the lobby publicly carries. A built-in
 * script is looked up by id; any other (an imported custom script) comes from
 * the published name, the official character ids (resolved against the official
 * catalogue) and the published homebrew characters. An id that does not resolve
 * is skipped, never guessed.
 */
export function publicScriptOf(
  lobby: Pick<PublicLobbyRecord, "scriptId"> & Partial<PublicScriptFields> | null | undefined,
): { name?: string; characters: RoleDef[] } {
  if (!lobby?.scriptId) return { characters: [] };
  const builtin = getBuiltinScript(lobby.scriptId);
  if (builtin) return { name: builtin.name, characters: builtin.characters };
  const official = (lobby.scriptCharacters ?? [])
    .map((id) => lookupOfficialRole(id))
    .filter((role): role is RoleDef => role !== undefined);
  const characters = [...official, ...(lobby.scriptHomebrew ?? []).map(homebrewRole)];
  return { ...(lobby.scriptName ? { name: lobby.scriptName } : {}), characters };
}

/**
 * The character a phone shows for an id (the player's own, a bluff, a guess): the lobby's published
 * homebrew definition first, so a modified character is never shown with an official one's ability,
 * and otherwise the official catalogue, as before.
 */
export function publicRoleOf(
  lobby: Pick<PublicLobbyRecord, "scriptHomebrew"> | null | undefined,
  id: string,
): RoleDef | undefined {
  const entry = lobby?.scriptHomebrew?.find((role) => role.id === id);
  return entry ? homebrewRole(entry) : lookupOfficialRole(id);
}
