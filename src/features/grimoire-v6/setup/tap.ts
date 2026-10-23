import { useStorytellerStore } from "@/stores/storytellerStore";
import type { PlayerId } from "@/stores/types";
import { useV6Ui } from "../v6Store";
import { prepTap } from "./prepare";

/**
 * A board tap while Setup has something open. Returns true when Setup consumed the tap, so the board must not also
 * select the player:
 *   - the New Game wizard's draft table is only a preview, so its seats are not interactive;
 *   - an open preparation (Red Herring, first-night information) takes the tap as its choice;
 *   - guided seating moves its cursor to the tapped seat.
 */
export function handleSetupTap(playerId: PlayerId): boolean {
  const ui = useV6Ui.getState();
  const game = useStorytellerStore.getState().game;
  if (ui.wiz && ui.wiz.step !== "town") return true;
  if (!game || game.phase !== "setup") return false;
  if (ui.prepEdit) return prepTap(playerId);
  if (ui.seatMode) {
    const index = game.seatOrder.indexOf(playerId);
    if (index >= 0) ui.set({ seatCur: index });
    return true;
  }
  return false;
}
