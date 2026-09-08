export type Point = { x: number; y: number };

/** Storyteller workspace contract. Independent of seat count and viewport guesses. */
export function grimoireDiameter(width: number, height: number): number {
  return Math.max(0, Math.min(width, height, 720));
}

export type TokenBounds = { width: number; height: number };

/** Align disc centers on a circle, fitting the actual label stack at each seat.
 * A reminder on a top seat can extend inward without shrinking every other seat.
 */
export function fitTokenRing(diameter: number, discSize: number, tokens: TokenBounds[]) {
  if (!tokens.length || diameter <= 0) return { radius: 0, x: 0, y: 0 };
  const extent = (radius: number) => {
    const boxes = tokens.map((token, index) => {
      const point = seatPosition(index, tokens.length, radius);
      return { left: point.x - token.width / 2, right: point.x + token.width / 2,
        top: point.y - discSize / 2, bottom: point.y + token.height - discSize / 2 };
    });
    return { left: Math.min(0, ...boxes.map(b => b.left)), right: Math.max(0, ...boxes.map(b => b.right)),
      top: Math.min(0, ...boxes.map(b => b.top)), bottom: Math.max(0, ...boxes.map(b => b.bottom)) };
  };
  let low = 0;
  let high = diameter / 2;
  for (let iteration = 0; iteration < 24; iteration++) {
    const radius = (low + high) / 2;
    const box = extent(radius);
    if (box.right - box.left <= diameter - 32 && box.bottom - box.top <= diameter - 32) low = radius;
    else high = radius;
  }
  const box = extent(low);
  return { radius: low, x: -(box.left + box.right) / 2, y: -(box.top + box.bottom) / 2 };
}

export function seatPosition(seat: number, total: number, radius: number): Point {
  if (total <= 0) return { x: 0, y: 0 };
  const angle = -Math.PI / 2 + (2 * Math.PI * seat) / total;
  return {
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle),
  };
}

export function ringRadius(containerSize: number, tokenSize: number): number {
  const margin = 24;
  return Math.max(60, containerSize / 2 - tokenSize / 2 - margin);
}

export function tokenSizeForCount(total: number): number {
  if (total <= 5) return 110;
  if (total <= 8) return 100;
  if (total <= 11) return 90;
  if (total <= 14) return 80;
  return 72;
}
