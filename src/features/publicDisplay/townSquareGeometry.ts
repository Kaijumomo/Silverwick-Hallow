// Package 4G: the Town Square Display's fixed 1920x1080 stage geometry.
// Pure functions only, ported from the Town Square Display v5 prototype: seat
// size by count, the table ellipse, equal arc-length seat angles, and a name
// plate width cap that keeps 5-20 seats (residents plus travellers) clear of
// one another.

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;
export const TABLE_CX = 960;
export const TABLE_CY = 548;
/** The seat discs sit 12px above the table centre line (the name plates hang below). */
export const SEAT_LIFT = 12;

export type SeatSize = { disc: number; name: number };

export function seatSizeFor(count: number): SeatSize {
  if (count <= 6) return { disc: 150, name: 28 };
  if (count <= 10) return { disc: 136, name: 26 };
  if (count <= 13) return { disc: 122, name: 24 };
  if (count <= 16) return { disc: 108, name: 22 };
  return { disc: 94, name: 20 };
}

export function tableRadii(count: number): { rx: number; ry: number } {
  return count > 12 ? { rx: 860, ry: 400 } : { rx: 800, ry: 380 };
}

/** Radius of the centre Crescent Ring disc. */
export function crescentRadius(count: number): number {
  const { rx, ry } = tableRadii(count);
  return Math.round(Math.min(rx, ry) * 0.72);
}

const SEGMENTS = 1440;

/** Seat angles spaced at equal ARC LENGTH along the ellipse, seat 1 at the top. */
export function seatAngles(count: number): number[] {
  if (count <= 0) return [];
  const { rx, ry } = tableRadii(count);
  const step = (2 * Math.PI) / SEGMENTS;
  const cum = [0];
  for (let j = 1; j <= SEGMENTS; j++) {
    const a0 = -Math.PI / 2 + (j - 1) * step;
    const a1 = a0 + step;
    cum.push(cum[j - 1]! + Math.hypot(rx * (Math.cos(a1) - Math.cos(a0)), ry * (Math.sin(a1) - Math.sin(a0))));
  }
  const total = cum[SEGMENTS]!;
  return Array.from({ length: count }, (_, i) => {
    const target = (total * i) / count;
    let j = 0;
    while (j < SEGMENTS && cum[j + 1]! < target) j++;
    return -Math.PI / 2 + j * step;
  });
}

export type SeatPoint = { x: number; y: number };

/** Disc centres in stage pixels. */
export function seatPoints(count: number): SeatPoint[] {
  const { rx, ry } = tableRadii(count);
  return seatAngles(count).map((a) => ({
    x: Math.round(TABLE_CX + rx * Math.cos(a)),
    y: Math.round(TABLE_CY + ry * Math.sin(a)) - SEAT_LIFT,
  }));
}

// ---- name plate cap (the Decision 15 safety net) --------------------------

/** Plate: 1px border + 3px/5px vertical padding around one line of the name. */
export function plateHeight(nameSize: number): number {
  return Math.round(nameSize * 1.3) + 10;
}
/** The plate hangs 2px below the disc's outer edge. */
export const PLATE_GAP = 2;
/** Breathing room that must remain between any two seat elements. */
const CLEARANCE = 6;
/** The disc plus its two rim rings (4px + 2px). */
const RIM = 6;
const MIN_PLATE = 96;
const MAX_PLATE = 480;

type Rect = { l: number; r: number; t: number; b: number };

function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad;
}
function circleHitsRect(cx: number, cy: number, rad: number, q: Rect, pad: number): boolean {
  const nx = Math.max(q.l, Math.min(cx, q.r));
  const ny = Math.max(q.t, Math.min(cy, q.b));
  return Math.hypot(cx - nx, cy - ny) < rad + pad;
}

function collides(count: number, plateWidth: number): boolean {
  const { disc, name } = seatSizeFor(count);
  const pts = seatPoints(count);
  const h = plateHeight(name);
  const plates: Rect[] = pts.map((p) => ({
    l: p.x - plateWidth / 2,
    r: p.x + plateWidth / 2,
    t: p.y + disc / 2 + PLATE_GAP,
    b: p.y + disc / 2 + PLATE_GAP + h,
  }));
  for (let i = 0; i < count; i++) {
    const a = plates[i]!;
    if (a.l < 0 || a.r > STAGE_WIDTH || a.b > STAGE_HEIGHT) return true;
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      if (j > i && rectsOverlap(a, plates[j]!, CLEARANCE)) return true;
      if (circleHitsRect(pts[j]!.x, pts[j]!.y, disc / 2 + RIM, a, CLEARANCE)) return true;
    }
  }
  return false;
}

const capCache = new Map<number, number>();

/** The widest name plate (px) at which no plate overlaps another plate or disc
 * for this seat count. Longer names ellipsise inside it. */
export function plateMaxWidth(count: number): number {
  const key = Math.max(1, count);
  const hit = capCache.get(key);
  if (hit !== undefined) return hit;
  let lo = MIN_PLATE;
  let hi = MAX_PLATE;
  if (!collides(key, hi)) lo = hi;
  else while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (collides(key, mid)) hi = mid;
    else lo = mid;
  }
  capCache.set(key, lo);
  return lo;
}

/** True when every seat element is clear of the others at this cap (test seam). */
export function seatsAreClear(count: number, plateWidth: number): boolean {
  return !collides(count, plateWidth);
}
