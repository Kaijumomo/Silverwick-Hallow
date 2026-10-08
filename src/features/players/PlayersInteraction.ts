import { createContext, useContext } from "react";

export const PlayersInteraction = createContext<{
  active: boolean;
  swapping: boolean;
  swappingPlayerId?: string;
  tap: (id: string) => boolean;
} | null>(null);
export const usePlayersInteraction = () => useContext(PlayersInteraction);
