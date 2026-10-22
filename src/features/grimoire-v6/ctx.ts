import { useEffect, useMemo, useRef, useState } from "react";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { buildRegistry, type RoleRegistry } from "@/data/roleRegistry";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useVotingInteraction } from "@/features/voting/VotingWorkspace";
import type { PlayerId, Script, StorytellerLobbyRecord } from "@/stores/types";
import { useV6Ui, type V6UiActions, type V6UiState } from "./v6Store";
import { computeRing, type RingLayout } from "./ringLayout";
import { seatPositions, type Point } from "./positions";

/**
 * Everything a view-model slice needs, computed once per render of the screen.
 * Slices read from here and return the part of the view-model they own (see useGrimoireVm).
 */
export type V6Ctx = {
  game: StorytellerLobbyRecord;
  script: Script | undefined;
  registry: RoleRegistry;
  ui: V6UiState & V6UiActions;
  layout: RingLayout;
  /** Seat disc centres in board pixels (saved token positions applied). */
  positions: Record<PlayerId, Point>;
  /** Privacy Mode: tokens and private surfaces are hidden. */
  privacy: boolean;
  /** A terminal close is in flight or being recovered: nothing may be changed. */
  mutationLocked: boolean;
  ended: boolean;
  setupPhase: boolean;
  /** The design's "night look": Night phase (also drives the sky). */
  isNight: boolean;
  session: ReturnType<typeof useSessionRuntime>;
  voting: ReturnType<typeof useVotingInteraction>;
  /** Which centred card is on the board; derived from the panel and the phase. */
  cards: { town: boolean; strip: boolean; day: boolean; info: boolean; reference: boolean; any: boolean };
  boardRef: React.RefObject<HTMLDivElement>;
};

/** Measures the board region; the ring is laid out from it. */
function useBoardSize(ref: React.RefObject<HTMLDivElement>, frozen: boolean) {
  const [size, setSize] = useState({ w: 1372, h: 900 });
  const pending = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w <= 200 || h <= 200) return;
      // Privacy Mode keeps the geometry it began with (10H-AC-024): a private surface closing must not move a seat.
      if (usePrivacyStore.getState().enabled) { pending.current = { w, h }; return; }
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  useEffect(() => {
    if (frozen || !pending.current) return;
    const p = pending.current; pending.current = null;
    setSize(p);
  }, [frozen]);
  return size;
}

export function useV6Ctx(game: StorytellerLobbyRecord): V6Ctx {
  const script = useStorytellerStore((s) => selectScriptById(s, game.scriptId));
  const registry = useMemo(() => buildRegistry(script ?? { id: game.scriptId ?? "", name: "", characters: [] }), [script, game.scriptId]);
  const ui = useV6Ui();
  const privacy = usePrivacyStore((s) => s.enabled);
  const mutationLocked = useStorytellerStore((s) => s.terminalClose?.status === "closing" || !!s.terminalClose?.confirmedRecovery || !!s.terminalClose?.recoveryPending);
  const tokenPositions = useStorytellerStore((s) => s.tokenPositions);
  const session = useSessionRuntime();
  const voting = useVotingInteraction();
  const boardRef = useRef<HTMLDivElement>(null);
  const { w, h } = useBoardSize(boardRef, privacy);
  const seats = game.seatOrder.length;
  const layout = useMemo(() => computeRing(w, h, seats, game.phase === "setup" ? 5 : 0), [w, h, seats, game.phase]);
  const positions = useMemo(() => seatPositions(game.seatOrder, layout, tokenPositions), [game.seatOrder, layout, tokenPositions]);
  const phase = game.phase;
  const panel = ui.panel;
  const noOverlay = !ui.picker && !ui.show;
  const cards = {
    town: panel === "players" && !ui.picker && !ui.seatMode && !ui.prepEdit,
    strip: panel === "night" && phase === "night" && !privacy,
    day: panel === "night" && phase === "day" && !privacy && !voting?.open && !ui.slay && noOverlay,
    info: panel === "info" && noOverlay,
    reference: panel === "reference" && noOverlay,
    any: false,
  };
  cards.any = cards.info || cards.reference || cards.day;
  return {
    game, script, registry, ui, layout, positions, privacy, mutationLocked,
    ended: phase === "ended", setupPhase: phase === "setup", isNight: phase === "night",
    session, voting, cards, boardRef,
  };
}
