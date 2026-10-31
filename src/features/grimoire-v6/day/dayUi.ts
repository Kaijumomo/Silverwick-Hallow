import { create } from "zustand";

/**
 * Session-local UI memory of the Day slice that v6Store has no field for. Never persisted and never
 * part of the game record: the authoritative Slayer use is the Life event the engine records.
 */
export type SlayLogEntry = { code: string; day: number; shooter: string; target: string; dies: boolean; real: boolean };

type DayUi = {
  /** The "···" options row of the nomination card is open. */
  more: boolean;
  log: SlayLogEntry[];
  setMore: (more: boolean) => void;
  addLog: (entry: SlayLogEntry) => void;
};

export const useDayUi = create<DayUi>()((set) => ({
  more: false,
  log: [],
  setMore: (more) => set({ more }),
  addLog: (entry) => set((s) => ({ log: [...s.log, entry].slice(-24) })),
}));
