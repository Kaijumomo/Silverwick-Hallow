import { seatCentre, seatShapesFit, type TablePlacement, type TierSpec } from "./densityTiers";

/** Approved Claude tablet v3 geometry, expressed in canvas-centred coordinates.
 * A crowded surface keeps the existing density fallback instead of shrinking
 * touch targets below 44px or allowing canonical seats to cover each other. */
export function storytellerGeometry(width: number, height: number, count: number) {
  if (width < 761 || height < 460 || count <= 0) return null;
  const original = Math.round(Math.max(64, Math.min(92, Math.min(width, height) / 9.6)));
  const radii = (disc: number) => ({
    rx: Math.max(100, (width - 76 - 12) / 2 - disc / 2 - 20),
    ry: Math.max(90, (height - 70 - 70 - disc - 30) / 2),
  });
  const estimate = radii(original);
  const perSeat = 2 * Math.PI * Math.sqrt((estimate.rx ** 2 + estimate.ry ** 2) / 2) / count;
  const disc = Math.round(Math.max(48, Math.min(original, perSeat * 0.58)));
  const { rx, ry } = radii(disc);
  const offsetX = -32;
  const placement: TablePlacement = { rx, ry, cy: 70 + disc / 2 + ry - height / 2 };
  // Role text is curved inside the disc; the name is the only line below it.
  // Reminder detail remains on the token/popover rather than changing geometry.
  const spec: TierSpec = { tier: "L", disc, width: Math.max(104, disc), height: disc + 24,
    text: true, reminderLabels: 0, reminderCount: true };
  const positions = Array.from({ length: count }, (_, i) => {
    const point = seatCentre(i, count, placement, 0.5);
    return { x: point.x + offsetX, y: point.y };
  });
  const fits = (nameWidth: number) => seatShapesFit({ width, height }, positions.map(({ x, y }) => [
    { left: x - disc / 2, right: x + disc / 2, top: y - disc / 2, bottom: y + disc / 2,
      circle: { cx: x, cy: y, r: disc / 2 } },
    { left: x - nameWidth / 2, right: x + nameWidth / 2, top: y + disc / 2,
      bottom: y + disc / 2 + 24 },
  ]));
  // A pinned panel can narrow a tablet without making its character discs
  // collide. Shorten the name pill (its full name remains in title/accessible
  // text) before discarding the entire named layout because of unused width.
  for (const nameWidth of [104, 92, 80, 68, 56].map(value => Math.max(disc, value))) {
    if (fits(nameWidth)) return { spec: { ...spec, width: nameWidth }, placement, offsetX, positions };
  }
  return null;
}
