import { create } from "zustand";
import { onGameScopeReset } from "@/stores/shellStore";

/**
 * Session-local UI memory of the Day slice that v6Store has no field for. Never persisted and never
 * part of the game record: the authoritative Slayer use is the Life event the engine records.
 */
type DayUi = {
  /** The "···" options row of the nomination card is open. */
  more: boolean;
  setMore: (more: boolean) => void;
};

export const useDayUi = create<DayUi>()((set) => ({
  more: false,
  setMore: (more) => set({ more }),
}));

onGameScopeReset(() => useDayUi.setState({ more: false }));
