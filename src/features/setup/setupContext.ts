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
      // Ordinary composition target = total planned participants - the
      // intended Traveler count out of that total (Phase 9 Setup
      // finalization B4). Travelers never consume an ordinary bag slot, so
      // this never derives from total occupancy either -- only the static
      // plan. Floored at 0: a plan with more intended Travelers than total
      // participants is never negative, just unresolved.
      targetNonTravelerCount: Number.isInteger(game.plannedPlayerCount) && game.plannedPlayerCount > 0
        ? Math.max(0, game.plannedPlayerCount - (game.plannedTravelerCount ?? 0))
        : null,
      occupiedNonTravelerCount: ordinary.length,
      occupiedTravelerCount: travelers.length,
      // FINAL POPULATION CLOSURE, Section 3/5: an empty seat reserving
      // planned Traveler capacity (plannedTravelerSeat) is never an "unused
      // ordinary seat" -- counting it here would spuriously block Deal
      // (empty-seats has no action scope) over a reservation Deal was never
      // meant to depend on, breaking Traveler Deal independence.
      emptyPlannedSeatCount: seated.filter(p => p.isEmpty && !p.isTraveler && !p.plannedTravelerSeat).length,
      totalPhysicalSeatCount: game.seatOrder.length,
    },
    occupied, ordinary, travelers,
    pool: [...(game.rolePool ?? [])],
    assigned: ordinary.map(p => p.actualRole).filter(Boolean),
  };
}
