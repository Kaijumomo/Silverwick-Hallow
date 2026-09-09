import { buildRegistry, type RoleRegistry } from "@/data/roleRegistry";
import type { Script, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

export type SetupAction = "deal" | "manual";
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
