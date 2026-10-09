import { createContext, useContext } from "react";
import type { SeatSwapLayout } from "@/stores/storytellerStore";

export const PlayersInteraction = createContext<{
  active: boolean;
  swapping: boolean;
  swappingPlayerId?: string;
  tap: (id: string, layout?: SeatSwapLayout) => boolean;
} | null>(null);
export const usePlayersInteraction = () => useContext(PlayersInteraction);
