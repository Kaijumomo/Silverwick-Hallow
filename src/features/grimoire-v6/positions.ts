import type { PlayerId } from "@/stores/types";
import type { RingLayout } from "./ringLayout";

export type Point = { x: number; y: number };

/**
 * Where each seat's disc is centred, in board pixels. A seat sits on the Crescent Ring unless the
 * Storyteller has dragged its token (storytellerStore.tokenPositions, stored relative to the board
 * centre exactly as before), in which case the saved position is used and kept inside the board.
 */
export function seatPositions(seatOrder: readonly PlayerId[], layout: RingLayout, saved: Record<PlayerId, Point>): Record<PlayerId, Point> {
  const { cx, cy, rx, ry, angles, w, h, S } = layout;
  const out: Record<PlayerId, Point> = {};
  seatOrder.forEach((id, i) => {
    const stored = saved[id];
    if (stored) {
      const m = S / 2 + 6;
      out[id] = { x: Math.max(m, Math.min(w - m, w / 2 + stored.x)), y: Math.max(m, Math.min(h - m, h / 2 + stored.y)) };
      return;
    }
    const a = angles[i] ?? 0;
    out[id] = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  return out;
}
