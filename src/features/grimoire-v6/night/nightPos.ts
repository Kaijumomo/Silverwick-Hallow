import { create } from "zustand";
import type { NightCursor } from "@/stores/shellStore";

/**
 * Where the Night strip is when it rests on Dusk or Dawn (the two transition checkpoints of the V2 design).
 * Session-local UI state, like the Night cursor: never stored in the game record, Undo or projections.
 *
 * A checkpoint is only honoured while the Night cursor is still the one it was set against, so anything
 * that moves the cursor (Undo reopening a step, tapping the acting seat) takes the strip off the checkpoint.
 */
export type NightCheckpoint = "dusk" | "dawn";

type NightPosState = {
  day: number;
  at: NightCheckpoint | null;
  cursor: NightCursor | null;
  go: (day: number, at: NightCheckpoint | null, cursor: NightCursor | null) => void;
};

export const useNightPos = create<NightPosState>()((set) => ({
  day: 0,
  at: null,
  cursor: null,
  go: (day, at, cursor) => set({ day, at, cursor }),
}));

/** The checkpoint the strip rests on, or null when it is on a step (or has not been moved yet). */
export function activeCheckpoint(pos: Pick<NightPosState, "day" | "at" | "cursor">, day: number, cursor: NightCursor | null): NightCheckpoint | null {
  return pos.at && pos.day === day && pos.cursor === cursor ? pos.at : null;
}
