import { seatShapes, seatShapesFit, STAGE_MARGIN, type Stage, type TablePlacement, type TierSpec } from "@/features/grimoire/densityTiers";

/**
 * Phase 10H (10H-AC-069): the Public Display seats on the Storyteller Table's
 * oval geometry -- equal arc-length seat centres and the same collision /
 * overprint / clipping check (footprintsFit) -- fitted to the measured
 * display. A display is a wide screen with nothing beside the seats, so the
 * oval may use the full width (no Table aspect cap). Each seat's footprint is
 * its disc plus a text stack whose rows have FIXED heights (see
 * `.public-seat-*` in system.css), so the fitted bound is real. Each seat is
 * checked with its OWN rows (a Traveler's character and pill); the Life row
 * is always reserved, so a death (or Day / Night) never reflows the display.
 *
 * Density tiers, roomiest first. A denser table on a smaller display steps
 * down, shedding SECONDARY presentation before primary public information:
 *   full     names on two lines, then one;
 *   compact  the "Traveler" pill goes (the public Traveler character stays);
 *   minimal  the Life TEXT line goes -- the shroud ("Dead" / "Exiled", in
 *            words) and the vote token (solid / struck-through) still carry
 *            dead/alive and ghost-vote state, and the seat's accessible name
 *            still says it in full.
 * Seat position, seat number and player name are never shed.
 *
 * Layout only: what a seat shows (name, Life grammar, public Traveler
 * character) is unchanged and still comes only from the public projection.
 */

/** Text-stack rows, in CSS px -- mirrored by the `.public-seat-*` rules. */
export const PUBLIC_ROW_GAP = 4;
export const PUBLIC_NAME_LINE = 20;
export const PUBLIC_SMALL_ROW = 14;
export const PUBLIC_PILL_ROW = 20;
export const PUBLIC_DISC_MAX = 150;
export const PUBLIC_DISC_MIN = 40;
/** The smallest disc at which the roomiest tier is still preferred. */
export const PUBLIC_DISC_COMFORT = 72;

export type PublicTierName = "full" | "compact" | "minimal";
/** One density tier: how a seat's text stack is presented, and the smallest
 * disc for which this tier is preferred over the next, more compact one. */
export type PublicLabelTier = {
  tier: PublicTierName;
  nameLines: 1 | 2;
  width: number;
  travelerPill: boolean;
  lifeText: boolean;
  minDisc: number;
};
export const PUBLIC_LABEL_TIERS: readonly PublicLabelTier[] = [
  { tier: "full", nameLines: 2, width: 140, travelerPill: true, lifeText: true, minDisc: PUBLIC_DISC_COMFORT },
  { tier: "full", nameLines: 1, width: 120, travelerPill: true, lifeText: true, minDisc: 56 },
  { tier: "compact", nameLines: 1, width: 120, travelerPill: false, lifeText: true, minDisc: 48 },
  { tier: "minimal", nameLines: 1, width: 96, travelerPill: false, lifeText: false, minDisc: PUBLIC_DISC_MIN },
];

/** The optional rows one seat shows beyond its name and Life row. */
export type PublicSeatContent = { role: boolean; traveler: boolean };

export function publicTextStack(label: PublicLabelTier, content: PublicSeatContent): number {
  let height = PUBLIC_ROW_GAP + PUBLIC_NAME_LINE * label.nameLines;
  if (label.lifeText) height += PUBLIC_ROW_GAP + PUBLIC_SMALL_ROW;
  if (label.travelerPill) {
    if (content.role) height += PUBLIC_ROW_GAP + PUBLIC_SMALL_ROW;
    if (content.traveler) height += PUBLIC_ROW_GAP + PUBLIC_PILL_ROW;
  } else if (content.role || content.traveler) {
    // Without the pill, the Traveler's public character (or "Traveler") is one row.
    height += PUBLIC_ROW_GAP + PUBLIC_SMALL_ROW;
  }
  return height;
}

export function publicSeatSpec(disc: number, label: PublicLabelTier, content: PublicSeatContent): TierSpec {
  return {
    tier: "L", disc, width: Math.max(disc, label.width), height: disc + publicTextStack(label, content),
    reminderLabels: 0, text: true, reminderCount: false,
  };
}

/** The oval inside the display: full width, full height less the footprint. */
export function placePublicTable(stage: Stage, count: number, spec: TierSpec): TablePlacement {
  if (count <= 1) return { rx: 0, ry: 0, cy: spec.disc / 2 - spec.height / 2 };
  const ry = Math.max(0, (stage.height - 2 * STAGE_MARGIN - spec.height) / 2);
  const rx = Math.max(0, stage.width / 2 - STAGE_MARGIN - spec.width / 2);
  return { rx, ry, cy: -stage.height / 2 + STAGE_MARGIN + ry + spec.disc / 2 };
}

export type PublicSeatLayout = { spec: TierSpec; label: PublicLabelTier; table: TablePlacement; fits: boolean };

/** The tallest seat's rows -- what the oval's placement must leave room for. */
const tallest = (seats: readonly PublicSeatContent[]): PublicSeatContent =>
  ({ role: seats.some((s) => s.role), traveler: seats.some((s) => s.traveler) });

function largestFit(stage: Stage, seats: readonly PublicSeatContent[], label: PublicLabelTier): PublicSeatLayout | null {
  if (stage.width <= 0 || stage.height <= 0) return null;
  const count = seats.length;
  for (let disc = PUBLIC_DISC_MAX; disc >= PUBLIC_DISC_MIN; disc -= 2) {
    const spec = publicSeatSpec(disc, label, tallest(seats));
    if (stage.width < spec.width + 2 * STAGE_MARGIN || stage.height < spec.height + 2 * STAGE_MARGIN) continue;
    const table = placePublicTable(stage, count, spec);
    if (count > 1 && (table.rx <= 0 || table.ry <= 0)) continue;
    const shapes = seats.map((content, index) => seatShapes(index, count, publicSeatSpec(disc, label, content), table));
    if (seatShapesFit(stage, shapes)) return { spec, label, table, fits: true };
  }
  return null;
}

/** The roomiest tier whose largest collision-free disc reaches that tier's
 * minimum. When nothing fits (a very dense table on a small display), the
 * most compact tier at the minimum disc is returned with `fits: false`. */
export function publicSeatLayout(stage: Stage, seats: readonly PublicSeatContent[]): PublicSeatLayout {
  for (const label of PUBLIC_LABEL_TIERS) {
    const layout = largestFit(stage, seats, label);
    if (layout && layout.spec.disc >= label.minDisc) return layout;
  }
  const label = PUBLIC_LABEL_TIERS[PUBLIC_LABEL_TIERS.length - 1]!;
  const spec = publicSeatSpec(PUBLIC_DISC_MIN, label, tallest(seats));
  return { spec, label, table: placePublicTable(stage, seats.length, spec), fits: false };
}
