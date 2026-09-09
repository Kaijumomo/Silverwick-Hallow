import { canonicalRoles } from "@/data/canonical";
import raw from "@/data/canonical/roles.json";
import { SETUP_COUNTS } from "@/data/setupCounts";
import { makeSTPlayer } from "./fixtures";
import type { StorytellerLobbyRecord, Script } from "@/stores/types";
export const setupScript: Script = { id: "setup-test", name: "Setup test", characters: canonicalRoles(raw.map(r => r.id)) };
export function standardRoles(count = 7) {
  const c = SETUP_COUNTS[count]!;
  return [
    ...["washerwoman","librarian","investigator","chef","empath","fortuneteller","undertaker","monk","ravenkeeper"].slice(0,c.townsfolk),
    ...["drunk","saint"].slice(0,c.outsider),
    ...["poisoner","scarletwoman","spy"].slice(0,c.minion), "imp",
  ];
}
export function setupGame(roles = standardRoles(), over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: "p"+seat, name: "Player "+seat, seat, actualRole }));
  return {
    code: "", storytellerUid: "local", scriptId: setupScript.id, phase: "setup", day: 0,
    players: Object.fromEntries(players.map(p => [p.id,p])), seatOrder: players.map(p => p.id),
    plannedPlayerCount: roles.length, rolePool: [], fabled: [], lorics: [], bluffs: [],
    notes: "", nightProgress: {}, pendingPlayers: {}, ...over,
  };
}
