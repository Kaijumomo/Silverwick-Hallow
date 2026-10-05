
/**
 * Phase 10H (contract §6.1; 10H-AC-009/010/013): adaptive seat density tiers
 * selected from the MEASURED stage geometry (the ResizeObserver-measured
 * diameter the ring renders into) -- never from a viewport guess, and never by
 * reading layout during render.
 *
 *  L  -- name, role, up to two Reminder labels;
 *  M  -- name, role, one Reminder label;
 *  M2 -- name, role, a count-only Reminder;
 *  S  -- disc + compact markers, no Table text;
 *  XS -- a compact last-resort disc only.
 *
 * Each tier has a FIXED seat footprint. Positions come from that footprint, so
 * a seat's content (a Reminder added, Privacy Mode removing private marks) can
 * never move a seat or reflow the ring (10H-AC-024), and a picked tier is
 * collision-free by construction. The largest collision-free tier wins.
 *
 * PROVISIONAL numbers: these footprints are the mock-derived starting values;
 * 10H-AC-013 requires them to be re-measured with real character art in the
 * production build before Phase 10H closes (Slice 7 evidence).
 */
export type DensityTier = "L" | "M" | "M2" | "S" | "XS";

export type TierSpec = {
  tier: DensityTier;
  /** Character disc diameter. */
  disc: number;
  /** The whole seat footprint (disc + text stack), fixed per tier. */
  width: number;
  height: number;
  /** Visible Reminder labels on the Table (0 = count only / none). */
  reminderLabels: number;
  /** Whether name / role text renders on the Table at all. */
  text: boolean;
  /** Whether a Reminder COUNT renders when labels do not. */
  reminderCount: boolean;
};

export const TIER_SPECS: readonly TierSpec[] = [
  { tier: "L", disc: 80, width: 124, height: 152, reminderLabels: 2, text: true, reminderCount: true },
  { tier: "M", disc: 68, width: 108, height: 134, reminderLabels: 1, text: true, reminderCount: true },
  { tier: "M2", disc: 58, width: 96, height: 92, reminderLabels: 0, text: true, reminderCount: true },
  { tier: "S", disc: 50, width: 50, height: 50, reminderLabels: 0, text: false, reminderCount: true },
  { tier: "XS", disc: 44, width: 44, height: 44, reminderLabels: 0, text: false, reminderCount: false },
];

export const tierSpec = (tier: DensityTier): TierSpec => TIER_SPECS.find((spec) => spec.tier === tier)!;

/** Minimum clear gap between neighbouring seat footprints (target-hit safety). */
export const SEAT_GAP = 4;

/** The measured stage the Table renders into (CSS px). */
export type Stage = { width: number; height: number };

/** Margin between the outermost seat footprint and the stage edge. */
export const STAGE_MARGIN = 16;
/** The Table is an oval no flatter than this (width : height of the seat path). */
export const MAX_TABLE_ASPECT = 1.75;

/**
 * The Table's own rectangle inside the measured stage: the full stage height
 * (capped) and a width no wider than MAX_TABLE_ASPECT of it -- so on a wide
 * desktop the Table spreads into the width it is given instead of shrinking
 * to a height-bound circle, and on a square stage it is a circle.
 */
export function tableStage(width: number, height: number): Stage {
  const h = Math.max(0, Math.min(height, 900));
  const w = Math.max(0, Math.min(width, h * MAX_TABLE_ASPECT + 160));
  return { width: Math.round(w), height: Math.round(h) };
}

/** An oval seat path: disc centres at (rx·cosθ, cy + ry·sinθ), seat 1 at the top. */
export type TablePlacement = { rx: number; ry: number; cy: number };

/** The oval for `count` seats of one tier inside `stage`, sized so every
 * footprint (disc on top, text stack below) stays inside the stage margin. */
export function placeTable(stage: Stage, count: number, spec: TierSpec): TablePlacement {
  if (count <= 1) return { rx: 0, ry: 0, cy: spec.disc / 2 - spec.height / 2 };
  const ry = Math.max(0, (stage.height - 2 * STAGE_MARGIN - spec.height) / 2);
  const rx = Math.max(0, Math.min(stage.width / 2 - STAGE_MARGIN - spec.width / 2, Math.max(ry, 1) * MAX_TABLE_ASPECT));
  const cy = -stage.height / 2 + STAGE_MARGIN + ry + spec.disc / 2;
  return { rx, ry, cy };
}

/** Seat angles spaced by EQUAL ARC LENGTH along the oval (identical to equal
 * angles on a circle): an oval's seats are then evenly spread instead of
 * crowding at the ends of its short axis. Seat 1 is at the top; clockwise. */
const angleCache = new Map<string, number[]>();
function seatAngles(count: number, rx: number, ry: number): number[] {
  const key = `${count}:${rx.toFixed(2)}:${ry.toFixed(2)}`;
  const cached = angleCache.get(key);
  if (cached) return cached;
  const start = -Math.PI / 2;
  let angles: number[];
  if (count <= 0) angles = [];
  else if (Math.abs(rx - ry) < 1e-6 || rx <= 0 || ry <= 0) {
    angles = Array.from({ length: count }, (_, i) => start + (2 * Math.PI * i) / count);
  } else {
    const steps = 720;
    const cumulative = [0];
    let previous = { x: rx * Math.cos(start), y: ry * Math.sin(start) };
    for (let k = 1; k <= steps; k++) {
      const t = start + (2 * Math.PI * k) / steps;
      const point = { x: rx * Math.cos(t), y: ry * Math.sin(t) };
      cumulative.push(cumulative[k - 1]! + Math.hypot(point.x - previous.x, point.y - previous.y));
      previous = point;
    }
    const perimeter = cumulative[steps]!;
    angles = Array.from({ length: count }, (_, i) => {
      const target = (perimeter * i) / count;
      let k = 0;
      while (k < steps && cumulative[k + 1]! < target) k++;
      const span = cumulative[k + 1]! - cumulative[k]!;
      const fraction = span > 0 ? (target - cumulative[k]!) / span : 0;
      return start + (2 * Math.PI * (k + fraction)) / steps;
    });
  }
  if (angleCache.size > 200) angleCache.clear();
  angleCache.set(key, angles);
  return angles;
}

/** The disc centre of seat `index` of `count` (relative to the stage centre). */
export function seatCentre(index: number, count: number, table: TablePlacement): { x: number; y: number } {
  if (count <= 0) return { x: 0, y: table.cy };
  const angle = seatAngles(count, table.rx, table.ry)[index] ?? -Math.PI / 2;
  return { x: table.rx * Math.cos(angle), y: table.cy + table.ry * Math.sin(angle) };
}

type Box = { left: number; right: number; top: number; bottom: number };
/** A seat shape: the circular disc, or the text stack's rectangle. Both are
 * what is drawn AND what is hit-tested (the seat button is circular when it
 * carries no text -- see system.css). */
export type SeatShape = Box & { circle?: { cx: number; cy: number; r: number } };

/** The footprint of seat `index` (relative to the stage centre) as the shapes
 * actually rendered: the disc on top and the centred text stack below it.
 * Overprint means one seat's disc or text touching another's. */
export function seatShapes(index: number, count: number, spec: TierSpec, table: TablePlacement): SeatShape[] {
  const centre = seatCentre(index, count, table);
  const r = spec.disc / 2;
  const top = centre.y - r;
  const disc: SeatShape = { left: centre.x - r, right: centre.x + r, top, bottom: top + spec.disc, circle: { cx: centre.x, cy: centre.y, r } };
  if (spec.height <= spec.disc) return [disc];
  return [disc, { left: centre.x - spec.width / 2, right: centre.x + spec.width / 2, top: top + spec.disc, bottom: top + spec.height }];
}

const rectsOverlap = (a: Box, b: Box, gap: number) =>
  a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
function circleRect(c: { cx: number; cy: number; r: number }, b: Box, gap: number) {
  const nx = Math.max(b.left, Math.min(c.cx, b.right));
  const ny = Math.max(b.top, Math.min(c.cy, b.bottom));
  return Math.hypot(c.cx - nx, c.cy - ny) < c.r + gap;
}
const overlaps = (a: SeatShape, b: SeatShape, gap: number) => {
  if (a.circle && b.circle) return Math.hypot(a.circle.cx - b.circle.cx, a.circle.cy - b.circle.cy) < a.circle.r + b.circle.r + gap;
  if (a.circle) return circleRect(a.circle, b, gap);
  if (b.circle) return circleRect(b.circle, a, gap);
  return rectsOverlap(a, b, gap);
};

/** True when no two seats' shapes overlap (with SEAT_GAP clearance) and every
 * shape stays inside the stage -- the collision / same-seat-overprint /
 * clipping checks the tier must pass. */
export function tierFits(stage: Stage, count: number, spec: TierSpec): boolean {
  if (count === 0) return true;
  if (stage.width <= 0 || stage.height <= 0) return false;
  if (stage.width < spec.width + 2 * STAGE_MARGIN || stage.height < spec.height + 2 * STAGE_MARGIN) return false;
  return footprintsFit(stage, count, spec, placeTable(stage, count, spec));
}

/** The collision / overprint / clipping check for one given oval placement
 * (tierFits uses the Table's own placement; the Public Display its own). */
export function footprintsFit(stage: Stage, count: number, spec: TierSpec, table: TablePlacement): boolean {
  if (count === 0) return true;
  if (count > 1 && (table.rx <= 0 || table.ry <= 0)) return false;
  return seatShapesFit(stage, Array.from({ length: count }, (_, index) => seatShapes(index, count, spec, table)));
}

/** The same check over already-built seat shapes (one list per seat). */
export function seatShapesFit(stage: Stage, seats: readonly SeatShape[][]): boolean {
  const halfW = stage.width / 2;
  const halfH = stage.height / 2;
  if (seats.flat().some((box) => box.left < -halfW - 0.5 || box.right > halfW + 0.5 || box.top < -halfH - 0.5 || box.bottom > halfH + 0.5)) return false;
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      if (seats[i]!.some((a) => seats[j]!.some((b) => overlaps(a, b, SEAT_GAP)))) return false;
    }
  }
  return true;
}

/** The largest collision-free tier for `count` seats in a measured `stage`;
 * XS is the last resort (the Roster remains the reader). */
export function pickDensityTier(stage: Stage, count: number): DensityTier {
  for (const spec of TIER_SPECS) {
    if (spec.tier === "XS") break;
    if (tierFits(stage, count, spec)) return spec.tier;
  }
  return "XS";
}
