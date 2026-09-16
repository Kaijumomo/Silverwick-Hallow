import { buildRegistry, type RoleRegistry } from "@/data/roleRegistry";
import type { Script, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

export type SetupAction = "deal" | "begin";
export type SetupSource = "pool" | "assigned" | "shared";
export type SetupFinding = {
  code: string;
  severity: "blocker" | "warning" | "check" | "info";
  message: string;
  source: SetupSource;
  actions?: SetupAction[];
  playerId?: string;
};
export type SetupPopulation = {
  targetNonTravelerCount: number | null;
  occupiedNonTravelerCount: number;
  occupiedTravelerCount: number;
  emptyPlannedSeatCount: number;
  totalPhysicalSeatCount: number;
};
export type SetupContext = {
  game: StorytellerLobbyRecord;
  script?: Script;
  registry?: RoleRegistry;
  population: SetupPopulation;
  occupied: STPlayerRecord[];
  ordinary: STPlayerRecord[];
  travelers: STPlayerRecord[];
  pool: string[];
  assigned: string[];
};

/**
 * A fresh Day-0 game only has evidence of a completed initial deal once
 * dealRolePool() records setupRolesDealt; day > 0 means the game already left
 * Setup at least once, which is the only other trustworthy signal — a
 * running/legacy game returning to Setup must remain usable without
 * fabricating deal history it cannot know occurred.
 */
export function isPostDeal(game: StorytellerLobbyRecord): boolean {
  return !game.rolePool.length && (!!game.setupRolesDealt || game.day > 0);
}

/** No presence, roster, shown identity, or geometry enters population selection. */
export function selectSetupContext(game: StorytellerLobbyRecord, script?: Script): SetupContext {
  const seated = [...new Set(game.seatOrder)].flatMap(id => game.players[id] ? [game.players[id]!] : []);
  const occupied = seated.filter(p => !p.isEmpty);
  const ordinary = occupied.filter(p => !p.isTraveler);
  const travelers = occupied.filter(p => p.isTraveler);
  return {
    game, script, registry: script ? buildRegistry(script) : undefined,
    population: {
      targetNonTravelerCount: Number.isInteger(game.plannedPlayerCount) && game.plannedPlayerCount > 0 ? game.plannedPlayerCount : null,
      occupiedNonTravelerCount: ordinary.length,
      occupiedTravelerCount: travelers.length,
      emptyPlannedSeatCount: seated.filter(p => p.isEmpty && !p.isTraveler).length,
      totalPhysicalSeatCount: game.seatOrder.length,
    },
    occupied, ordinary, travelers,
    pool: [...(game.rolePool ?? [])],
    assigned: ordinary.map(p => p.actualRole).filter(Boolean),
  };
}
