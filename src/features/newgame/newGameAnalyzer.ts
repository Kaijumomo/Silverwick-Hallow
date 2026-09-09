import { analyzeSetup } from "@/features/setup/setupAnalyzer";
import { selectSetupContext } from "@/features/setup/setupContext";
import type { RoleId, RoleDef, StorytellerLobbyRecord } from "@/stores/types";

/** Planning is allowed to be incomplete; the UI shows pool findings, not start gates. */
export function analyzeRolePool(
  rolePool: RoleId[], plannedPlayerCount: number, roleById: Map<RoleId, RoleDef>,
  fabled: RoleId[] = [], lorics: RoleId[] = [],
) {
  const game: StorytellerLobbyRecord = {
    code: "", storytellerUid: "local", scriptId: "planning", phase: "setup", day: 0,
    players: {}, seatOrder: [], rolePool, plannedPlayerCount, fabled, lorics,
    bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {},
  };
  return analyzeSetup(selectSetupContext(game, { id: "planning", name: "Planning", characters: [...roleById.values()] }));
}
