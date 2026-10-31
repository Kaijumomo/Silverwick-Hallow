import { create } from "zustand";
import type { InfoContext } from "@/features/info/infoCommands";
import type { PresentationPayload } from "@/features/info/PlayerPresentation";
import type { SetupView } from "@/features/info/infoModel";

/**
 * What the full-screen player view (Show) is displaying right now. UI-only and never persisted:
 * the payload is the same player-safe shape the phone presentation uses (no game state, no
 * ownership, no delivery record), and the captured context lets the view refuse to show anything
 * once the game, connection, script or Privacy Mode has changed underneath it.
 */
export type ActiveShow = { context: InfoContext; payload: PresentationPayload; setup?: SetupView };

type ShowStore = {
  current: ActiveShow | null;
  open: (show: ActiveShow) => void;
  clear: () => void;
};

export const useInfoShow = create<ShowStore>()((set) => ({
  current: null,
  open: (show) => set({ current: show }),
  clear: () => set({ current: null }),
}));
