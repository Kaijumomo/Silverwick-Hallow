import { useCallback, useEffect, useRef, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import type { PlayerId } from "@/stores/types";
import type { RingLayout } from "../ringLayout";
import { toStoredPosition, type Point } from "../positions";
import { flash } from "../v6Store";

/** A press that moves less than this is a tap, not a drag (unchanged from the previous board). */
export const TAP_MAX_PX = 6;

export type DragGhost = { id: PlayerId } & Point;

/** Keeps a dragged disc fully on the board, with the margin the saved layout is read back with. */
export function clampToBoard(p: Point, layout: Pick<RingLayout, "w" | "h" | "S">): Point {
  const m = layout.S / 2 + 6;
  return { x: Math.max(m, Math.min(layout.w - m, p.x)), y: Math.max(m, Math.min(layout.h - m, p.y)) };
}


type Options = {
  boardRef: React.RefObject<HTMLDivElement>;
  layout: RingLayout;
  positions: Record<PlayerId, Point>;
  /** The seat was tapped rather than dragged. */
  onTap: (id: PlayerId) => void;
  /** Dragging is a local arrangement of the table: closed games are read-only like before. */
  enabled: boolean;
};

/**
 * Free token dragging, kept exactly as before: a primary-pointer press on a seat follows the
 * pointer; releasing under TAP_MAX_PX of travel is a tap (never a move), anything further saves the
 * new position through the existing `moveToken` command (a local layout change with its own Undo).
 */
export function useTokenDrag({ boardRef, layout, positions, onTap, enabled }: Options) {
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const latest = useRef({ layout, positions, onTap, enabled });
  latest.current = { layout, positions, onTap, enabled };
  const active = useRef<{ id: PlayerId; pointerId: number; startX: number; startY: number; base: Point; scale: number; exceeded: boolean } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  const finish = useCallback(() => { cleanup.current?.(); cleanup.current = null; active.current = null; setGhost(null); }, []);
  useEffect(() => finish, [finish]);

  const onDown = useCallback((id: PlayerId, e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (active.current || e.isPrimary === false) return;
    const { positions: pos, enabled: movable } = latest.current;
    const base = pos[id];
    if (!base) return;
    e.preventDefault();
    const el = boardRef.current;
    const rect = el?.getBoundingClientRect();
    // The board can be drawn at a different size than it is laid out (a scaled preview): follow the pointer 1:1.
    const scale = el && rect && el.clientWidth > 0 ? rect.width / el.clientWidth : 1;
    const drag = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, base, scale: scale || 1, exceeded: false };
    active.current = drag;
    const at = (ev: PointerEvent): Point => clampToBoard({ x: base.x + (ev.clientX - drag.startX) / drag.scale, y: base.y + (ev.clientY - drag.startY) / drag.scale }, latest.current.layout);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) >= TAP_MAX_PX) drag.exceeded = true;
      if (drag.exceeded && movable) setGhost({ id, ...at(ev) });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      const dist = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY);
      const tapped = dist < TAP_MAX_PX && !drag.exceeded;
      // Use the release point too: a fast drag need not dispatch a final pointermove.
      const dropped = at(ev);
      finish();
      if (tapped) { latest.current.onTap(id); return; }
      if (!movable) return;
      const stored = toStoredPosition(dropped, latest.current.layout);
      const result = useStorytellerStore.getState().moveToken(id, stored.x, stored.y);
      if (!result.ok) flash(result.message ?? "The token position could not be saved.");
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === drag.pointerId) finish(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [boardRef, finish]);

  return { ghost, onDown };
}
