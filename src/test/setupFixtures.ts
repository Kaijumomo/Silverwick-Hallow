import { canonicalRoles } from "@/data/canonical";
import raw from "@/data/canonical/roles.json";
import { SETUP_COUNTS } from "@/data/setupCounts";
import { buildRegistry } from "@/data/roleRegistry";
import { dealtIdentity } from "@/stores/identity";
import { makeSTPlayer } from "./fixtures";
import type { RoleId, StorytellerLobbyRecord, Script } from "@/stores/types";
export const setupScript: Script = { id: "setup-test", name: "Setup test", characters: canonicalRoles(raw.map(r => r.id)) };
export function standardRoles(count = 7) {
  const c = SETUP_COUNTS[count]!;
  return [
    ...["washerwoman","librarian","investigator","chef","empath","fortuneteller","undertaker","monk","ravenkeeper"].slice(0,c.townsfolk),
    ...["drunk","saint"].slice(0,c.outsider),
    ...["poisoner","scarletwoman","spy"].slice(0,c.minion), "imp",
  ];
}

const setupRegistry = buildRegistry(setupScript);
// A "ready" fixture must never equate shown to actual identity: concealed
// roles (Phase 9C.4) keep an unrevealed shownRole until the Storyteller
// explicitly configures perception, so a completed fixture instead gives
// each one an explicit, plausible, DIFFERENT shown identity — matching what
// a Storyteller genuinely configures before Night 1, not a shortcut through
// the concealment.
const readyConcealedShown: Record<string, RoleId> = {
  drunk: "washerwoman",
  marionette: "washerwoman",
  lunatic: "imp",
};
/** Perception a fully-configured ("ready to begin") seat would carry, given
 * only its actual role — never used to invent perception for a role that
 * doesn't resolve, so unresolved-role fixtures still exercise those findings. */
function readyPerception(actualRole: RoleId): Pick<import("@/stores/types").STPlayerRecord, "shownRole" | "shownAlignment" | "behaviorMode"> | Record<string, never> {
  if (!actualRole || !setupRegistry.get(actualRole)) return {};
  const dealt = dealtIdentity(actualRole, setupRegistry);
  if (dealt.shownRole) return dealt;
  const shownRole = readyConcealedShown[actualRole];
  if (!shownRole) return dealt; // unlisted concealed role: leave unrevealed rather than guess.
  return { shownRole, shownAlignment: setupRegistry.alignmentOf(shownRole), behaviorMode: dealt.behaviorMode };
}
export function setupGame(roles = standardRoles(), over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const players = roles.map((actualRole, seat) =>
    makeSTPlayer({ id: "p"+seat, name: "Player "+seat, seat, actualRole, ...readyPerception(actualRole) }));
  return {
    code: "", storytellerUid: "local", scriptId: setupScript.id, phase: "setup", day: 0,
    players: Object.fromEntries(players.map(p => [p.id,p])), seatOrder: players.map(p => p.id),
    plannedPlayerCount: roles.length, rolePool: [], fabled: [], lorics: [], bluffs: [],
    notes: "", nightProgress: {}, pendingPlayers: {}, ...over,
  };
}
