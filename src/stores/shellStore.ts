import { create } from "zustand";
import type { ParticipantId, PlayerId } from "./types";

/**
 * Phase 10H (contract §9): Storyteller UI-only state. Session-local by
 * construction -- a plain (non-persisted) zustand store, never part of the
 * game record, schema, checkpoints, projections, Undo or URLs.
 *
 *  - nightCursor: the Night step the Storyteller is on (null = the first
 *    unresolved step); the step owns the action context (§8.1). It is
 *    GAME-SCOPED: step keys repeat across games, so it is cleared at the
 *    new-game / end-game boundary (resetGameScope, PR-10H-003);
 *  - litActor: the derived actor of that step, published by the Night
 *    dashboard while it is mounted (absent at Day and under Privacy Mode);
 *  - actionOpen: whether the floating action card is showing (its draft is
 *    kept while hidden so tapping the actor RESUMES it).
 */
export type NightCursor = { day: number; stepKey: string };
export type LitActor = { playerId: PlayerId; participantId: ParticipantId; stepKey: string };

type ShellState = {
  nightCursor: NightCursor | null;
  litActor: LitActor | null;
  actionOpen: boolean;
  /** Bumped when the Storyteller taps the lit seat: open / resume the action. */
  actionRequest: number;
  setNightCursor: (cursor: NightCursor | null) => void;
  setLitActor: (actor: LitActor | null) => void;
  setActionOpen: (open: boolean) => void;
  requestAction: () => void;
  /** PR-10H-003: ends the game-scoped part of this state -- the Night cursor
   * and the action context it owns -- with its game. */
  resetGameScope: () => void;
  reset: () => void;
};

const INITIAL = {
  nightCursor: null,
  litActor: null,
  actionOpen: false,
  actionRequest: 0,
};

/**
 * Session-local UI stores that live outside this module (the Day slice's Slayer log, the Night strip's
 * checkpoint, the shown-information overlay) register here, so the same new-game / end-game boundary that
 * clears the Night cursor also clears them. Offline games all carry the empty room code, so a store keyed
 * by `code` cannot tell one game from the next.
 */
const gameScopeListeners = new Set<() => void>();
export function onGameScopeReset(listener: () => void): void { gameScopeListeners.add(listener); }

export const useShellStore = create<ShellState>()((set) => ({
  ...INITIAL,
  setNightCursor: (nightCursor) => set({ nightCursor }),
  setLitActor: (litActor) => set((s) => (sameActor(s.litActor, litActor) ? s : { litActor })),
  setActionOpen: (actionOpen) => set({ actionOpen }),
  requestAction: () => set((s) => ({ actionOpen: true, actionRequest: s.actionRequest + 1 })),
  resetGameScope: () => {
    set({ nightCursor: null, litActor: null, actionOpen: false });
    gameScopeListeners.forEach((listener) => listener());
  },
  reset: () => set(INITIAL),
}));

const sameActor = (a: LitActor | null, b: LitActor | null) =>
  a === b || (!!a && !!b && a.playerId === b.playerId && a.participantId === b.participantId && a.stepKey === b.stepKey);
