/**
 * The Crescent Ring geometry from the V2 Grimoire design (Storyteller Grimoire v6): an oval fitted to
 * the measured board, seats spaced by arc length so they are evenly distributed on an ellipse.
 * The header band (84px) and the dock band (124px) are reserved on every screen, so the seat
 * geometry never moves when a card opens or closes.
 */
export type RingLayout = {
  w: number;
  h: number;
  /** Seat disc diameter. */
  S: number;
  rx: number;
  ry: number;
  cx: number;
  cy: number;
  /** Seat angles (radians, clockwise from the top). */
  angles: number[];
  /** Average arc length available to one seat. */
  per: number;
  crowded: boolean;
  /** Widest a seat name may be. */
  nameMax: number;
};

const PAD_T = 84;
const PAD_B = 124;
const PAD_L = 16;
const PAD_R = 16;

export function seatAngles(n: number, rx: number, ry: number): number[] {
  if (n <= 0) return [];
  const start = -Math.PI / 2;
  const steps = 720;
  const cum = [0];
  let pv = { x: rx * Math.cos(start), y: ry * Math.sin(start) };
  for (let k = 1; k <= steps; k++) {
    const t = start + (2 * Math.PI * k) / steps;
    const pt = { x: rx * Math.cos(t), y: ry * Math.sin(t) };
    cum.push(cum[k - 1]! + Math.hypot(pt.x - pv.x, pt.y - pv.y));
    pv = pt;
  }
  const per = cum[steps]!;
  return Array.from({ length: n }, (_, i) => {
    const target = (per * (i + 0.5)) / n;
    let k = 0;
    while (k < steps && cum[k + 1]! < target) k++;
    const span = cum[k + 1]! - cum[k]!;
    return start + (2 * Math.PI * (k + (span > 0 ? (target - cum[k]!) / span : 0))) / steps;
  });
}

/** `seats` is the number of seats on the ring; `minSeats` keeps a sparse lobby spaced as a full table. */
export function computeRing(w: number, h: number, seats: number, minSeats = 0): RingLayout {
  const n = Math.max(1, seats);
  const S0 = Math.round(Math.max(64, Math.min(92, Math.min(w, h) / 9.6)));
  const rad = (z: number): [number, number] => [
    Math.max(100, (w - PAD_R - PAD_L) / 2 - z / 2 - 20),
    Math.max(90, (h - PAD_T - PAD_B - z - 30) / 2),
  ];
  const [rx0, ry0] = rad(S0);
  const per0 = (2 * Math.PI * Math.sqrt((rx0 * rx0 + ry0 * ry0) / 2)) / n;
  const S = Math.round(Math.max(48, Math.min(S0, per0 * 0.58)));
  const [rx, ry] = rad(S);
  const cx = (PAD_L + w - PAD_R) / 2;
  const cy = PAD_T + S / 2 + ry;
  const per = (2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2)) / n;
  return {
    w, h, S, rx, ry, cx, cy,
    angles: seatAngles(Math.max(minSeats, seats), rx, ry),
    per,
    crowded: seats > 15 || per < 120,
    nameMax: Math.round(Math.max(104, Math.min(150, per - 6))),
  };
}

const ROMAN: Array<[number, string]> = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
/** Seat numbers are written in roman numerals on the board. */
export function roman(n: number): string {
  let r = "";
  for (const [k, s] of ROMAN) while (n >= k) { r += s; n -= k; }
  return r || "0";
}
