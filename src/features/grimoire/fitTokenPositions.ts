type Point = { x: number; y: number };

/** Fit saved free-roam positions for display only. A smaller canvas must not
 * pile clipped tokens on one edge. While pinned, saved positions also yield
 * to canonical seats that reflow onto them. Unpinned in-bounds arrangements
 * remain untouched. Never write these temporary positions to the store. */
export function fitTokenPositions(points: Point[], bounds: Point, footprint: { width: number; height: number }, reflow: boolean[] = []) {
  const clamp = (point: Point) => ({
    x: Math.max(-bounds.x, Math.min(bounds.x, point.x)),
    y: Math.max(-bounds.y, Math.min(bounds.y, point.y)),
  });
  const result = points.map(clamp);
  const movable = points.map((point, i) => reflow[i] || point.x !== result[i]!.x || point.y !== result[i]!.y);
  const placed = result.filter((_, i) => !movable[i]);
  const gapX = footprint.width + 4;
  const gapY = footprint.height + 4;
  const clear = (point: Point) => placed.every(other =>
    Math.abs(point.x - other.x) >= gapX || Math.abs(point.y - other.y) >= gapY);
  for (let i = 0; i < points.length; i++) {
    if (!movable[i]) continue;
    const desired = result[i]!;
    if (!clear(desired)) {
      // Nearest free rectangle: a best candidate touches a boundary or an
      // already placed footprint. Keep the player's intended side/location.
      const xs = [desired.x, -bounds.x, bounds.x, ...placed.flatMap(p => [p.x - gapX, p.x + gapX])];
      const ys = [desired.y, -bounds.y, bounds.y, ...placed.flatMap(p => [p.y - gapY, p.y + gapY])];
      const candidates = xs.flatMap(x => ys.map(y => ({ x, y })))
        .filter(p => Math.abs(p.x) <= bounds.x && Math.abs(p.y) <= bounds.y && clear(p));
      candidates.sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y));
      result[i] = candidates[0] ?? desired;
    }
    placed.push(result[i]!);
  }
  return result;
}
