import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  /** Something else on the board is drawn at this seat's dragged position (the selected seat's radial
   * menu and Details card): that seat is redrawn by React on every move, exactly as before. */
  anchored?: (id: PlayerId) => boolean;
};

/** The z-index the view gives the seat being dragged (vm/board.tsx); no other seat is drawn with it. */
const DRAGGED_Z = "30";

/**
 * Free token dragging, kept exactly as before: a primary-pointer press on a seat follows the
 * pointer; releasing under TAP_MAX_PX of travel is a tap (never a move), anything further saves the
 * new position through the existing `moveToken` command (a local layout change with its own Undo).
 *
 * Redraw cost (streamlining review F-02): the first move past TAP_MAX_PX sets the ghost, so React
 * draws the seat as dragged (on top, no transition). Later moves place that seat's positioned box
 * directly, at the same rounded pixels the view would draw, instead of rebuilding the whole
 * Grimoire for every pointer move. React compares against what it last drew, never the page, so
 * an unrelated redraw mid-drag leaves the seat where the pointer is. A move falls back to the
 * React redraw whenever the box cannot be proven to be the dragged seat's (it is not the box React
 * drew as dragged, e.g. before that first redraw lands or after the seats were re-ordered), or
 * when something else follows the seat (`anchored`). Before the drop or a cancel, the last placed
 * point is drawn through React once, so React's own record matches the page again; the drop itself
 * is unchanged: the ghost clears and the saved position is drawn in the same render.
 */
export function useTokenDrag({ boardRef, layout, positions, onTap, enabled, anchored }: Options) {
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const latest = useRef({ layout, positions, onTap, enabled, anchored });
  latest.current = { layout, positions, onTap, enabled, anchored };
  const active = useRef<{ id: PlayerId; pointerId: number; startX: number; startY: number; base: Point; scale: number; exceeded: boolean } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const afterRender = useRef<(() => void) | null>(null);
  // Every render during a drag re-checks that the directly placed box still belongs to the dragged seat.
  useLayoutEffect(() => { afterRender.current?.(); });

  const finish = useCallback(() => { cleanup.current?.(); cleanup.current = null; afterRender.current = null; active.current = null; setGhost(null); }, []);
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
    // The view draws the pressed disc inside the seat's positioned box.
    const pressed = e.currentTarget as unknown;
    const box = pressed instanceof HTMLElement && pressed.parentElement instanceof HTMLElement ? pressed.parentElement : null;
    let ghosted = false;
    /** The last point drawn through React, the last point placed directly, and the exact values written. */
    let drawn: Point | null = null;
    let placed: Point | null = null;
    let wrote: { left: string; top: string } | null = null;
    const px = (v: number) => `${Math.round(v)}px`;
    const ours = () => !!box && box.isConnected && box.style.zIndex === DRAGGED_Z && !latest.current.anchored?.(id);
    /** Moves the seat without a redraw when its box is provably the one React drew as dragged. */
    const place = (p: Point): boolean => {
      if (!ghosted || !ours()) return false;
      wrote = { left: px(p.x), top: px(p.y) };
      box!.style.left = wrote.left;
      box!.style.top = wrote.top;
      placed = p;
      return true;
    };
    const draw = (p: Point) => { ghosted = true; drawn = p; setGhost({ id, ...p }); };
    /** The box stopped being the dragged seat's (seats re-ordered, or the seat became selected): give back
     * any value React did not overwrite, and draw the dragged seat at the pointer through React. */
    const release = () => {
      if (!placed || ours()) return;
      const last = placed;
      if (box && wrote && drawn) {
        if (box.style.left === wrote.left) box.style.left = px(drawn.x);
        if (box.style.top === wrote.top) box.style.top = px(drawn.y);
      }
      placed = null; wrote = null;
      draw(last);
    };
    afterRender.current = release;
    /** After direct moves, draws the final point through React too, so React's record of the seat
     * matches the page again before the drop (or cancel) render compares against it. */
    const settle = (p: Point | null) => {
      if (!placed || !p) return;
      place(p); // the page shows the final point (the release need not match the last move)
      flushSync(() => setGhost({ id, ...p })); // and React's record holds it too
    };
    const at = (ev: PointerEvent): Point => clampToBoard({ x: base.x + (ev.clientX - drag.startX) / drag.scale, y: base.y + (ev.clientY - drag.startY) / drag.scale }, latest.current.layout);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) >= TAP_MAX_PX) drag.exceeded = true;
      if (!drag.exceeded || !movable) return;
      const p = at(ev);
      if (place(p)) return;
      release();
      draw(p);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== drag.pointerId) return;
      const dist = Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY);
      const tapped = dist < TAP_MAX_PX && !drag.exceeded;
      // Use the release point too: a fast drag need not dispatch a final pointermove.
      const dropped = at(ev);
      settle(dropped);
      finish();
      if (tapped) { latest.current.onTap(id); return; }
      if (!movable) return;
      const stored = toStoredPosition(dropped, latest.current.layout);
      const result = useStorytellerStore.getState().moveToken(id, stored.x, stored.y);
      if (!result.ok) flash(result.message ?? "The token position could not be saved.");
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === drag.pointerId) { settle(placed); finish(); } };
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
