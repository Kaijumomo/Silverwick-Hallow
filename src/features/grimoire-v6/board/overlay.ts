import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { create } from "zustand";
import type { PlayerId } from "@/stores/types";

/**
 * Package 4 (board slice): the two seams other slices use to touch the seats without owning them.
 *
 * - Decorations: the Day slice (nominator / nominee / "on the block" / hands raised) and the Night slice
 *   (picked targets) publish per-seat presentation here; the board merges it into the token it draws.
 * - Tap interceptors: a slice that is mid-gesture (guided seating, preparation targets, the Slayer
 *   face-off ...) claims a seat tap before the board treats it as "select this player".
 *
 * Both are UI-only, session-local and never part of the game record.
 */
export type TokenDecoration = {
  filter?: string;
  ringOn?: boolean;
  ringColor?: string;
  tagOn?: boolean;
  tagText?: string;
  tagColor?: string;
  handOn?: boolean;
  glow?: ReactNode;
  cursor?: string;
};

type DecorationState = {
  bySource: Record<string, Record<PlayerId, TokenDecoration>>;
  set: (source: string, decorations: Record<PlayerId, TokenDecoration> | null) => void;
};

export const useTokenDecorations = create<DecorationState>()((set) => ({
  bySource: {},
  set: (source, decorations) => set((s) => {
    if (!decorations) {
      if (!(source in s.bySource)) return s;
      const { [source]: _drop, ...rest } = s.bySource;
      return { bySource: rest };
    }
    return { bySource: { ...s.bySource, [source]: decorations } };
  }),
}));

const signature = (decorations: Record<PlayerId, TokenDecoration> | null) =>
  decorations ? JSON.stringify(decorations, (_k, v) => (v && typeof v === "object" && "$$typeof" in v ? "node" : v)) : "";

/** Publishes `decorations` under `source` for as long as the calling slice renders them. */
export function usePublishTokenDecorations(source: string, decorations: Record<PlayerId, TokenDecoration> | null) {
  const key = signature(decorations);
  const latest = useRef(decorations);
  latest.current = decorations;
  useEffect(() => {
    useTokenDecorations.getState().set(source, latest.current);
    return () => useTokenDecorations.getState().set(source, null);
  }, [source, key]);
}

/** Merges every published decoration for a seat; later sources (by name) win field by field. */
export function mergedDecoration(bySource: DecorationState["bySource"], id: PlayerId): TokenDecoration {
  const out: TokenDecoration = {};
  for (const source of Object.keys(bySource).sort()) Object.assign(out, bySource[source]?.[id] ?? {});
  return out;
}

export type TapInterceptor = (id: PlayerId) => boolean;
const interceptors = new Map<string, TapInterceptor>();

/** Claims seat taps while mounted. Return true from `handler` when the tap was consumed. */
export function useTokenTapInterceptor(source: string, handler: TapInterceptor | null) {
  const ref = useRef(handler);
  ref.current = handler;
  const active = !!handler;
  useEffect(() => {
    if (!active) return;
    interceptors.set(source, (id) => ref.current?.(id) ?? false);
    return () => { interceptors.delete(source); };
  }, [source, active]);
}

/** Offers a tap to every interceptor in registration order; true when one consumed it. */
export function offerTokenTap(id: PlayerId): boolean {
  for (const handler of [...interceptors.values()]) if (handler(id)) return true;
  return false;
}

export function clearTokenTapInterceptors() { interceptors.clear(); }
