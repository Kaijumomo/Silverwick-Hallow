import { create } from "zustand";
import type { ParticipantId, PlayerId } from "./types";

/**
 * Phase 10H (contract §9): Storyteller UI-only state. Session-local by
 * construction -- a plain (non-persisted) zustand store, never part of the
 * game record, schema, checkpoints, projections, Undo or URLs.
 *
 *  - lens: how the Table is read (the spatial Table, the textual Roster, or
 *    the Labels view that preserves full Effect / Reminder detail);
 *  - inspectorDetent: the participant workspace detent (peek -> expanded ->
 *    hidden); null means "the layout's default" (phone peek, wider expanded);
 *  - dockTab: which ONE secondary surface the tablet dock / phone sheet shows;
 *  - nightCursor: the Night step the Storyteller is on (null = the first
 *    unresolved step); the step owns the action context (§8.1). It is
 *    GAME-SCOPED: step keys repeat across games, so it is cleared at the
 *    new-game / end-game boundary (resetGameScope, PR-10H-003);
 *  - litActor: the derived actor of that step, published by the Night
 *    dashboard while it is mounted (absent at Day and under Privacy Mode);
 *  - actionOpen: whether the floating action card is showing (its draft is
 *    kept while hidden so tapping the actor RESUMES it).
 */
export type TableLens = "table" | "roster" | "labels";
export type InspectorDetent = "peek" | "expanded" | "hidden";
export type DockTab = "night" | "seat";
export type NightCursor = { day: number; stepKey: string };
export type LitActor = { playerId: PlayerId; participantId: ParticipantId; stepKey: string };

type ShellState = {
  lens: TableLens;
  inspectorDetent: InspectorDetent | null;
  dockTab: DockTab;
  nightCursor: NightCursor | null;
  litActor: LitActor | null;
  actionOpen: boolean;
  /** Bumped when the Storyteller taps the lit seat: open / resume the action. */
  actionRequest: number;
  setLens: (lens: TableLens) => void;
  setInspectorDetent: (detent: InspectorDetent | null) => void;
  setDockTab: (tab: DockTab) => void;
  setNightCursor: (cursor: NightCursor | null) => void;
  setLitActor: (actor: LitActor | null) => void;
  setActionOpen: (open: boolean) => void;
  requestAction: () => void;
  /** PR-10H-003: ends the game-scoped part of this state -- the Night cursor
   * and the action context it owns -- with its game. View preferences (lens,
   * dock tab, workspace detent) are kept. */
  resetGameScope: () => void;
  reset: () => void;
};

const INITIAL = {
  lens: "table" as TableLens,
  inspectorDetent: null,
  dockTab: "night" as DockTab,
  nightCursor: null,
  litActor: null,
  actionOpen: false,
  actionRequest: 0,
};

export const useShellStore = create<ShellState>()((set) => ({
  ...INITIAL,
  setLens: (lens) => set({ lens }),
  setInspectorDetent: (inspectorDetent) => set({ inspectorDetent }),
  setDockTab: (dockTab) => set({ dockTab }),
  setNightCursor: (nightCursor) => set({ nightCursor }),
  setLitActor: (litActor) => set((s) => (sameActor(s.litActor, litActor) ? s : { litActor })),
  setActionOpen: (actionOpen) => set({ actionOpen }),
  requestAction: () => set((s) => ({ actionOpen: true, actionRequest: s.actionRequest + 1 })),
  resetGameScope: () => set({ nightCursor: null, litActor: null, actionOpen: false }),
  reset: () => set(INITIAL),
}));

const sameActor = (a: LitActor | null, b: LitActor | null) =>
  a === b || (!!a && !!b && a.playerId === b.playerId && a.participantId === b.participantId && a.stepKey === b.stepKey);
