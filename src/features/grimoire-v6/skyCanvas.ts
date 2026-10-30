/**
 * The V2 night sky (boardArt.tsx moonBackdrop) drawn on one canvas instead of about a hundred page layers.
 *
 * The V2 sky is built from full-screen layers: the sky image, a blurred swirl copy, a blurred and brightened nebula
 * copy, two blurred mist bands wider than the screen, the light beam, the dawn wash, the rim, two ember glows, the
 * moon glow, five shooting stars and ninety twinkling stars. Chrome keeps most of them as separate layers in graphics
 * memory and blurs the mist and nebula again on every frame. On a tablet that left too little memory for the rest of
 * the board (docs/ai/design/TABLET_RENDER_BUDGET.md). Here the same layers, in the same order, with the same blend
 * modes, gradients, blurs and animation curves, are painted into one canvas the size of the board. The blurred pieces
 * are blurred once, when the board is sized, and the canvas is redrawn 30 times a second while the board is visible.
 * Where the browser allows it the drawing runs in a worker (skyWorker.ts), so a busy page (a phase change, saving the
 * game) does not hold the sky still.
 *
 * Every number below is copied from moonBackdrop and grimoire-v6.css; keep the two in step.
 */

export type SkyArt = { image: CanvasImageSource & { width: number; height: number } };

const FADE_MS = 1600; // transition: opacity 1.6s ease (and the sky's filter 1.6s ease)
const FRAME_MS = 1000 / 30;

/** CSS cubic-bezier timing functions. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (u: number) => ((ax * u + bx) * u + cx) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = x(u) - t;
      if (Math.abs(err) < 1e-6) break;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 30 && Math.abs(x(u) - t) > 1e-6; i++) { if (x(u) < t) lo = u; else hi = u; u = (lo + hi) / 2; }
    return ((ay * u + by) * u + cy) * u;
  };
}
export const ease = cubicBezier(0.25, 0.1, 0.25, 1);
export const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

/** A keyframe value, as CSS computes it: the timing function applies inside each keyframe interval. */
export function keyframes(stops: [number, number][], progress: number, timing: (t: number) => number = easeInOut): number {
  for (let i = 1; i < stops.length; i++) {
    const [o0, v0] = stops[i - 1]!, [o1, v1] = stops[i]!;
    if (progress <= o1) return v0 + (v1 - v0) * timing(o1 === o0 ? 1 : (progress - o0) / (o1 - o0));
  }
  return stops[stops.length - 1]![1];
}

/** Iteration progress of an infinite animation at `ms` after it started; `delay` in seconds as in the CSS shorthand. */
export function cycle(ms: number, seconds: number, delay = 0): number | null {
  const t = ms / 1000 - delay;
  if (t < 0) return null; // before a positive delay the animation does not apply yet
  return (t / seconds) % 1;
}

/** Progress for direction alternate / alternate-reverse: forwards on even iterations, backwards on odd ones. */
export function alternate(ms: number, seconds: number, reverse: boolean): number {
  const t = ms / 1000 / seconds;
  const iteration = Math.floor(t), p = t - iteration;
  const forwards = (iteration % 2 === 0) !== reverse;
  return forwards ? p : 1 - p;
}

const NEBULA: [number, number][] = [[0, 0], [0.5, 0.45], [1, 0]];
const EMBER: [number, number][] = [[0, 0.85], [0.5, 1], [1, 0.85]];
const HAUNT: [number, number][] = [[0, 0.7], [0.5, 1], [1, 0.7]];
const TWINKLE_OPACITY: [number, number][] = [[0, 0.12], [0.5, 1], [1, 0.12]];
const TWINKLE_SCALE: [number, number][] = [[0, 0.6], [0.5, 1.25], [1, 0.6]];

let starSeed = 7;
const rn = () => (starSeed = (starSeed * 16807) % 2147483647) / 2147483647;
/** The same ninety stars as moonBackdrop (same generator and seed). */
export const STARS = Array.from({ length: 90 }, () => ({ x: rn() * 100, y: rn() * 70, r: rn() < 0.15 ? 1.7 : rn() < 0.5 ? 1.15 : 0.75, d: 2.5 + rn() * 5, dl: -rn() * 8 }));
const SHOOTS: [number, number, number, number][] = [[78, 12, 3, 14], [30, 8, 10, 14], [58, 4, 6, 17], [92, 22, 13, 19], [44, 16, 1, 23]];

type Mode = { swirl: number; stars: number; beam: number; dawn: number; m1: number; m2: number; day: number };
const modeOf = (night: boolean): Mode => night
  ? { swirl: 0.32, stars: 0.8, beam: 1, dawn: 0, m1: 0.5, m2: 0.32, day: 0 }
  : { swirl: 0.14, stars: 0.1, beam: 0, dawn: 1, m1: 0.35, m2: 0.22, day: 1 };
const MIST = {
  night: [{ rgb: "150,165,200", a: 0.35 }, { rgb: "130,145,185", a: 0.3 }],
  day: [{ rgb: "225,200,170", a: 0.3 }, { rgb: "225,200,170", a: 0.25 }],
};

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
function surface(w: number, h: number): { canvas: Surface; ctx: Ctx } | null {
  const width = Math.max(1, Math.ceil(w)), height = Math.max(1, Math.ceil(h));
  const canvas: Surface = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d") as Ctx | null;
  return ctx ? { canvas, ctx } : null;
}

/** background-size: cover; background-position: center, for a box at (x, y) of w x h. */
export function cover(iw: number, ih: number, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / iw, h / ih);
  return { x: x + (w - iw * s) / 2, y: y + (h - ih * s) / 2, w: iw * s, h: ih * s };
}

/** A CSS radial-gradient(ellipse rx ry at cx cy, ...) as a canvas fill: the circle is stretched by a transform. */
function ellipseFill(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, stops: [number, string][], box: [number, number, number, number]) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  ctx.fillStyle = g;
  const [x, y, w, h] = box;
  ctx.fillRect(x - cx, (y - cy) * (rx / ry), w, h * (rx / ry));
  ctx.restore();
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws the sky into `canvas` (sized to the board) until stop() is called. Works on the page or in a worker. */
export class SkyPainter {
  private ctx: Canvas2D;
  private art: SkyArt | null = null;
  private w = 0; private h = 0; private dpr = 1;
  private baked: { swirl?: Surface; nebula?: Surface; beam?: Surface; skyDay?: Surface; mist: Record<string, Surface>; star: Record<string, Surface>; shoot?: Surface } = { mist: {}, star: {} };
  private from: Mode; private to: Mode; private changedAt = -Infinity;
  private night: boolean; private nightSince: number;
  private start = performance.now();
  private raf = 0; private last = -Infinity; private running = false;
  private paused = false;

  /** `calm` holds the sky's animations at their first frame (preview-only ?calm=1, for comparing frames in tests). */
  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas, night: boolean, private calm = false) {
    const ctx = canvas.getContext("2d", { alpha: false }) as Canvas2D | null;
    if (!ctx) throw new Error("no 2d canvas");
    this.ctx = ctx;
    this.night = night;
    this.from = this.to = modeOf(night);
    this.nightSince = 0;
  }

  setArt(art: SkyArt) { this.art = art; this.baked = { mist: {}, star: {} }; this.draw(true); }

  setSize(w: number, h: number, dpr: number) {
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.baked = { mist: {}, star: {} };
    this.draw(true);
  }

  setNight(night: boolean) {
    if (night === this.night) return;
    const now = this.time();
    this.from = this.mode(now); // a change mid-fade starts from where the fade is, as a CSS transition does
    this.to = modeOf(night);
    this.changedAt = now;
    this.night = night;
    if (night) this.nightSince = this.calm ? 0 : now; // the nebula and shooting stars start their animations when Night begins
    this.draw(true);
  }

  /**
   * The board rests (visibility: hidden) under the Reveal and the victory scene. Nothing is drawn then; the sky is
   * drawn again, current, as the board comes back.
   */
  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!paused) this.draw(true);
  }

  run() {
    this.running = true;
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f: (t: number) => void) => setTimeout(() => f(performance.now()), FRAME_MS) as unknown as number;
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = frame(tick);
      if (now - this.last < FRAME_MS - 4) return;
      this.last = now;
      this.draw(false);
    };
    this.raf = frame(tick);
  }

  stop() {
    this.running = false;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.raf); else clearTimeout(this.raf);
  }

  private time() { return performance.now() - this.start; }

  private mode(now: number): Mode {
    const p = ease(Math.min(1, (now - this.changedAt) / FADE_MS));
    const mix = (k: keyof Mode) => this.from[k] + (this.to[k] - this.from[k]) * p;
    return { swirl: mix("swirl"), stars: mix("stars"), beam: mix("beam"), dawn: mix("dawn"), m1: mix("m1"), m2: mix("m2"), day: mix("day") };
  }

  draw(force: boolean) {
    const art = this.art, { w, h, ctx } = this;
    if (!art || !w || !h) return;
    if (!force && this.paused) return;
    const now = this.time();
    const at = this.calm ? 0 : now; // the sky's own animations; the Night/Day fade always runs
    const m = this.mode(now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none"; ctx.imageSmoothingQuality = "high";

    // sky: filter none (Night) or saturate(.6) brightness(.75) (Day), 1.6 s ease between
    const sky = cover(art.image.width, art.image.height, 0, 0, w, h);
    if (m.day <= 0) ctx.drawImage(art.image, sky.x, sky.y, sky.w, sky.h);
    else if (m.day >= 1) ctx.drawImage(this.skyDay(), sky.x, sky.y, sky.w, sky.h);
    else {
      ctx.filter = `saturate(${1 - 0.4 * m.day}) brightness(${1 - 0.25 * m.day})`;
      ctx.drawImage(art.image, sky.x, sky.y, sky.w, sky.h);
      ctx.filter = "none";
    }

    ctx.globalCompositeOperation = "screen";
    // swirl: inset -6%, blur(1.5px), masked to the lower part, screen
    ctx.globalAlpha = m.swirl;
    ctx.drawImage(this.swirl(), -0.06 * w - 6, -0.06 * h - 6, 1.12 * w + 12, 1.12 * h + 12);
    // nebula glow: blur(6px) brightness(1.6), swNebula 9s at Night only
    if (this.night) {
      const p = cycle(at - this.nightSince, 9);
      const a = p === null ? 0 : keyframes(NEBULA, p);
      if (a > 0.001) { ctx.globalAlpha = a; ctx.drawImage(this.nebula(), -12, -12, w + 24, h + 24); }
    }
    // embers: swEmber 9s
    const ember = keyframes(EMBER, cycle(at, 9)!);
    ctx.globalAlpha = ember;
    ellipseFill(ctx, 0.12 * w, 0.52 * h, 0.3 * w, 0.22 * h, [[0, "rgba(220,160,100,.12)"], [0.7, "rgba(220,160,100,0)"]], [0, 0.36 * h, 0.34 * w, 0.32 * h]);
    ellipseFill(ctx, 0.66 * w, 0.72 * h, 0.32 * w, 0.18 * h, [[0, "rgba(220,160,100,.1)"], [0.7, "rgba(220,160,100,0)"]], [0.43 * w, 0.59 * h, 0.46 * w, 0.27 * h]);
    // moon glow: swHaunt 7s (the animation overrides the element's own opacity in both phases)
    ctx.globalAlpha = keyframes(HAUNT, cycle(at, 7)!);
    const ms = 0.24 * w, mx = 0.74 * w + ms / 2, my = -0.06 * h + ms / 2;
    const moon = ctx.createRadialGradient(mx, my, 0, mx, my, ms / 2);
    moon.addColorStop(0, "rgba(225,232,250,.22)"); moon.addColorStop(0.55, "rgba(200,212,240,.08)"); moon.addColorStop(1, "rgba(200,212,240,0)");
    ctx.fillStyle = moon;
    ctx.beginPath(); ctx.arc(mx, my, ms / 2, 0, Math.PI * 2); ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    // shooting stars (Night only): swShoot, linear, positive delays
    if (this.night) {
      for (const [l, t, delay, seconds] of SHOOTS) {
        const p = cycle(at - this.nightSince, seconds, delay);
        if (p === null || p >= 0.08) continue;
        const alpha = keyframes([[0, 0], [0.02, 1], [0.08, 0]], p, (x) => x);
        const dx = -520 * (p / 0.08);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(l / 100 * w, t / 100 * h + 0.75);
        ctx.rotate(-32 * Math.PI / 180);
        ctx.drawImage(this.shoot(), dx - 12, -0.75 - 12, 164, 25.5);
        ctx.restore();
      }
    }
    // stars: the container fades .8 (Night) / .1 (Day); each star twinkles (opacity .12-1, scale .6-1.25)
    if (m.stars > 0.001) {
      for (const s of STARS) {
        const p = cycle(at, s.d, s.dl)!;
        const a = keyframes(TWINKLE_OPACITY, p) * m.stars, k = keyframes(TWINKLE_SCALE, p);
        const cx = s.x / 100 * w + s.r, cy = s.y / 100 * h + s.r, size = (s.r + 9) * 2 * k;
        ctx.globalAlpha = a;
        ctx.drawImage(this.star(s.r), cx - size / 2, cy - size / 2, size, size);
      }
    }
    // beam (Night) and dawn wash (Day)
    if (m.beam > 0.001) { ctx.globalAlpha = m.beam; ctx.save(); ctx.translate(-0.1 * w, -0.3 * h); ctx.rotate(-24 * Math.PI / 180); ctx.drawImage(this.beam(), -24, -24, 0.7 * w + 48, 1.2 * h + 48); ctx.restore(); }
    if (m.dawn > 0.001) {
      ctx.globalAlpha = m.dawn;
      const g = ctx.createLinearGradient(0, h, 0, 0.45 * h);
      g.addColorStop(0, "rgba(210,150,90,.16)"); g.addColorStop(0.55, "rgba(170,120,80,.05)"); g.addColorStop(1, "rgba(170,120,80,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0.45 * h, w, 0.55 * h);
    }
    // mist bands: swDrift 70 s alternate and 90 s alternate-reverse, blur(28px); the tint switches with the phase
    const tint = this.night ? MIST.night : MIST.day;
    this.mistBand(0, 0.58, 0.46, m.m1, alternate(at, 70, false), tint[0]!);
    this.mistBand(1, -0.08, 0.34, m.m2, alternate(at, 90, true), tint[1]!);
    // rim
    ctx.globalAlpha = 1;
    ellipseFill(ctx, w / 2, h / 2, 0.9 * w, 0.8 * h, [[0, "rgba(2,3,6,0)"], [0.55, "rgba(2,3,6,0)"], [0.85, "rgba(2,3,6,.55)"], [1, "rgba(0,0,0,.85)"]], [0, 0, w, h]);
  }

  private mistBand(i: number, top: number, height: number, opacity: number, progress: number, tint: { rgb: string; a: number }) {
    if (opacity <= 0.001) return;
    const { ctx, w, h } = this;
    const bw = 1.4 * w, bh = height * h, k = easeInOut(progress);
    const tx = (-0.06 + 0.12 * k) * bw, ty = -0.02 * k * bh;
    const pad = 84;
    ctx.globalAlpha = opacity;
    ctx.drawImage(this.mist(i, tint), -0.2 * w + tx - pad, top * h + ty - pad, bw + 2 * pad, bh + 2 * pad);
  }

  // Baked pieces. Blurred pieces are kept at the board's CSS size (or half of it for the mist): they are smooth, so
  // the canvas scales them up without visible change, and they take a quarter (or a sixteenth) of the memory.

  private skyDay(): Surface {
    if (this.baked.skyDay) return this.baked.skyDay;
    const img = this.art!.image, s = surface(img.width, img.height)!;
    s.ctx.filter = "saturate(.6) brightness(.75)";
    s.ctx.drawImage(img, 0, 0);
    return (this.baked.skyDay = s.canvas);
  }

  private swirl(): Surface {
    if (this.baked.swirl) return this.baked.swirl;
    const { w, h } = this, img = this.art!.image;
    const bw = 1.12 * w, bh = 1.12 * h, s = surface(bw + 12, bh + 12)!;
    const c = cover(img.width, img.height, 6, 6, bw, bh);
    s.ctx.filter = "blur(1.5px)";
    s.ctx.drawImage(img, c.x, c.y, c.w, c.h);
    s.ctx.filter = "none";
    s.ctx.globalCompositeOperation = "destination-in";
    const mask = s.ctx.createLinearGradient(0, 6, 0, 6 + bh);
    mask.addColorStop(0, "rgba(0,0,0,0)"); mask.addColorStop(0.3, "rgba(0,0,0,0)"); mask.addColorStop(0.62, "#000"); mask.addColorStop(1, "#000");
    s.ctx.fillStyle = mask; s.ctx.fillRect(0, 0, bw + 12, bh + 12);
    // the mask covers the element's box only, so the blur's spill outside it is cut off
    s.ctx.clearRect(0, 0, bw + 12, 6); s.ctx.clearRect(0, bh + 6, bw + 12, 6); s.ctx.clearRect(0, 0, 6, bh + 12); s.ctx.clearRect(bw + 6, 0, 6, bh + 12);
    return (this.baked.swirl = s.canvas);
  }

  private nebula(): Surface {
    if (this.baked.nebula) return this.baked.nebula;
    const { w, h } = this, img = this.art!.image, s = surface(w + 24, h + 24)!;
    const c = cover(img.width, img.height, 12, 12, w, h);
    // the element is the board's size: the blur fades its edges into the transparent space around it
    const tmp = surface(w + 24, h + 24)!;
    tmp.ctx.save(); tmp.ctx.beginPath(); tmp.ctx.rect(12, 12, w, h); tmp.ctx.clip();
    tmp.ctx.drawImage(img, c.x, c.y, c.w, c.h); tmp.ctx.restore();
    s.ctx.filter = "blur(6px) brightness(1.6)";
    s.ctx.drawImage(tmp.canvas, 0, 0);
    return (this.baked.nebula = s.canvas);
  }

  private beam(): Surface {
    if (this.baked.beam) return this.baked.beam;
    const bw = 0.7 * this.w, bh = 1.2 * this.h, s = surface(bw + 48, bh + 48)!;
    const g = s.ctx.createLinearGradient(24, 0, 24 + bw, 0);
    g.addColorStop(0, "rgba(190,205,240,0)"); g.addColorStop(0.35, "rgba(190,205,240,.07)"); g.addColorStop(0.5, "rgba(210,222,250,.11)"); g.addColorStop(0.65, "rgba(190,205,240,.06)"); g.addColorStop(1, "rgba(190,205,240,0)");
    s.ctx.filter = "blur(10px)";
    s.ctx.fillStyle = g; s.ctx.fillRect(24, 24, bw, bh);
    return (this.baked.beam = s.canvas);
  }

  private mist(i: number, tint: { rgb: string; a: number }): Surface {
    const key = `${i}:${tint.rgb}:${tint.a}`;
    if (this.baked.mist[key]) return this.baked.mist[key];
    const height = i === 0 ? 0.46 : 0.34, pad = 84, k = 0.5; // drawn at half the CSS size
    const bw = 1.4 * this.w, bh = height * this.h;
    const s = surface((bw + 2 * pad) * k, (bh + 2 * pad) * k)!;
    const band = surface((bw + 2 * pad) * k, (bh + 2 * pad) * k)!;
    band.ctx.scale(k, k);
    const clear = `rgba(${tint.rgb},0)`, colour = `rgba(${tint.rgb},${tint.a})`;
    const box: [number, number, number, number] = [pad, pad, bw, bh];
    // background: the first gradient is on top of the second
    ellipseFill(band.ctx, pad + 0.75 * bw, pad + 0.55 * bh, 0.4 * bw, 0.45 * bh, [[0, colour], [0.7, clear]], box);
    ellipseFill(band.ctx, pad + 0.3 * bw, pad + 0.5 * bh, 0.5 * bw, 0.5 * bh, [[0, colour], [0.7, clear]], box);
    s.ctx.filter = `blur(${28 * k}px)`;
    s.ctx.drawImage(band.canvas, 0, 0);
    return (this.baked.mist[key] = s.canvas);
  }

  /** One star at scale 1: a disc of radius r, with the 6 px glow on the larger ones, drawn at device resolution. */
  private star(r: number): Surface {
    const key = String(r);
    if (this.baked.star[key]) return this.baked.star[key];
    const size = (r + 9) * 2, k = this.dpr * 1.25, s = surface(size * k, size * k)!;
    s.ctx.scale(k, k);
    if (r > 1.2) { s.ctx.shadowColor = "rgba(200,215,245,.8)"; s.ctx.shadowBlur = 6 * k; }
    s.ctx.fillStyle = "#e4e9f4";
    s.ctx.beginPath(); s.ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); s.ctx.fill();
    return (this.baked.star[key] = s.canvas);
  }

  /** One shooting star: 140 x 1.5, rounded, white fading to clear, with a 6 px glow around the whole box. */
  private shoot(): Surface {
    if (this.baked.shoot) return this.baked.shoot;
    const k = this.dpr, s = surface(164 * k, 25.5 * k)!;
    s.ctx.scale(k, k);
    const box = () => { s.ctx.beginPath(); s.ctx.roundRect(12, 12, 140, 1.5, 1); };
    s.ctx.save();
    s.ctx.shadowColor = "rgba(220,230,250,.8)"; s.ctx.shadowBlur = 6 * k; s.ctx.shadowOffsetX = 1000 * k;
    s.ctx.translate(-1000, 0); box(); s.ctx.fillStyle = "#000"; s.ctx.fill();
    s.ctx.restore();
    // a box shadow is not drawn under its own box, where the gradient turns clear
    s.ctx.globalCompositeOperation = "destination-out"; box(); s.ctx.fill(); s.ctx.globalCompositeOperation = "source-over";
    const g = s.ctx.createLinearGradient(12, 0, 152, 0);
    g.addColorStop(0, "#f2f5fb"); g.addColorStop(1, "rgba(200,215,245,0)");
    box(); s.ctx.fillStyle = g; s.ctx.fill();
    return (this.baked.shoot = s.canvas);
  }
}
