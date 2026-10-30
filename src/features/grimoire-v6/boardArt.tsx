import { createElement as E, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { RingLayout } from "./ringLayout";
import { stutterFlags, type MistMode } from "@/diag/stutterDiag";
import { SkyPainter } from "./skyCanvas";
import type { SkyMessage } from "./skyWorker";

// Backdrop sky and the Crescent Ring centrepiece of the V2 Grimoire design, ported from the prototype.

const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

let starSeed = 7;
const rn = () => (starSeed = (starSeed * 16807) % 2147483647) / 2147483647;
const STARS = Array.from({ length: 90 }, () => ({ x: rn() * 100, y: rn() * 70, r: rn() < 0.15 ? 1.7 : rn() < 0.5 ? 1.15 : 0.75, d: 2.5 + rn() * 5, dl: -rn() * 8 }));

/**
 * Night sky (or its dimmed dawn variant) behind the board, drawn on one canvas (skyCanvas.ts). Where a canvas cannot
 * be drawn (no 2D context, or the worker fails), and with the preview-only ?sky=v2 switch, the V2 design's own layers
 * are used instead.
 */
export function moonBackdrop(night: boolean, mistMode: MistMode = stutterFlags.mist, canvas = stutterFlags.sky !== "v2"): ReactNode {
  return canvas ? E(SkyCanvas, { night, fallback: () => layeredBackdrop(night, mistMode) }) : layeredBackdrop(night, mistMode);
}

const SKY_IMAGE = "silverwick-night-sky-v3.png";

/**
 * The canvas the sky is drawn on. The drawing runs in a worker when the browser can hand a canvas to one, otherwise
 * on the page (and always on the page with the preview-only ?sky=main switch). The board's rest (boardRest.ts) hides
 * the board with visibility; the canvas then stops drawing until the board shows again.
 */
function SkyCanvas({ night, fallback }: { night: boolean; fallback: () => ReactNode }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const setNight = useRef<((night: boolean) => void) | null>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = () => { const r = canvas.getBoundingClientRect(); return { w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 }; };
    const shown = () => (canvas.checkVisibility ? canvas.checkVisibility({ visibilityProperty: true }) : true);
    const image = new URL(publicUrl(SKY_IMAGE), window.location.href).href;
    let send: (message: SkyMessage) => void;
    let end: () => void;
    if (stutterFlags.sky !== "main" && typeof Worker !== "undefined" && "transferControlToOffscreen" in canvas) {
      const worker = new Worker(new URL("./skyWorker.ts", import.meta.url), { type: "module" });
      worker.onerror = () => setFailed(true);
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: "start", canvas: offscreen, night, calm: stutterFlags.calm, image, ...size() } satisfies SkyMessage, [offscreen]);
      send = (message) => worker.postMessage(message);
      end = () => { worker.postMessage({ type: "stop" } satisfies SkyMessage); };
    } else {
      let painter: SkyPainter;
      try { painter = new SkyPainter(canvas, night, stutterFlags.calm); } catch { setFailed(true); return; }
      const { w, h, dpr } = size();
      painter.setSize(w, h, dpr);
      const art = new Image();
      art.decoding = "async";
      art.onload = () => painter.setArt({ image: art });
      art.src = image;
      painter.run();
      send = (message) => {
        if (message.type === "size") painter.setSize(message.w, message.h, message.dpr);
        else if (message.type === "night") painter.setNight(message.night);
        else if (message.type === "paused") painter.setPaused(message.paused);
      };
      end = () => painter.stop();
    }
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => send({ type: "size", ...size() }));
    resize?.observe(canvas);
    // The board's rest changes the style attribute of one of the canvas's ancestors.
    const rest = new MutationObserver(() => send({ type: "paused", paused: !shown() }));
    for (let node = canvas.parentElement; node; node = node.parentElement) rest.observe(node, { attributes: true, attributeFilter: ["style"] });
    send({ type: "paused", paused: !shown() });
    setNight.current = (value) => send({ type: "night", night: value });
    return () => { resize?.disconnect(); rest.disconnect(); setNight.current = null; end(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);
  useEffect(() => { setNight.current?.(night); }, [night]);
  if (failed) return fallback();
  return E("canvas", { ref, "aria-hidden": true, style: { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" } });
}

/** The V2 design's sky as page layers: the reference the canvas reproduces. */
function layeredBackdrop(night: boolean, mistMode: MistMode): ReactNode {
  const fade: CSSProperties = { transition: "opacity 1.6s ease" };
  const SKY = `url("${publicUrl(SKY_IMAGE)}")`;
  const sky = E("div", { key: "sky", style: { position: "absolute", inset: 0, backgroundImage: SKY, backgroundSize: "cover", backgroundPosition: "center", filter: night ? "none" : "saturate(.6) brightness(.75)", ...fade, transition: "filter 1.6s ease" } });
  const cloudMask = "linear-gradient(180deg, transparent 30%, #000 62%)";
  const swirl = E("div", { key: "swirl", style: { position: "absolute", inset: "-6%", backgroundImage: SKY, backgroundSize: "cover", backgroundPosition: "center", mixBlendMode: "screen", filter: "blur(1.5px)", opacity: night ? 0.32 : 0.14, WebkitMaskImage: cloudMask, maskImage: cloudMask, ...fade } });
  const moonGlow = E("div", { key: "moon", style: { position: "absolute", left: "74%", top: "-6%", width: "24%", aspectRatio: "1", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(225,232,250,.22), rgba(200,212,240,.08) 55%, transparent)", mixBlendMode: "screen", animation: "swHaunt 7s ease-in-out infinite", opacity: night ? 1 : 0.2, ...fade } });
  // The ember glow's two gradients are transparent beyond 70% of their ellipses. Each is drawn in a layer cropped to
  // that area (left, top, width, height in % of the board) instead of one full-board layer, so the browser keeps less
  // of it in graphics memory. The gradient is laid out on the full board inside the crop, so every pixel is unchanged.
  const emberCrop = (k: string, gradient: string, [l, t, w, h]: [number, number, number, number]) => E("div", { key: k, style: { position: "absolute", left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`, overflow: "hidden", mixBlendMode: "screen", animation: "swEmber 9s ease-in-out infinite" } },
    E("div", { style: { position: "absolute", left: `${(-l / w) * 100}%`, top: `${(-t / h) * 100}%`, width: `${(100 / w) * 100}%`, height: `${(100 / h) * 100}%`, background: gradient } }));
  const ember = [
    emberCrop("ember1", "radial-gradient(ellipse 30% 22% at 12% 52%, rgba(220,160,100,.12), transparent 70%)", [0, 36, 34, 32]),
    emberCrop("ember2", "radial-gradient(ellipse 32% 18% at 66% 72%, rgba(220,160,100,.1), transparent 70%)", [43, 59, 46, 27]),
  ];
  const glow = E("div", { key: "glow", style: { position: "absolute", inset: 0, backgroundImage: SKY, backgroundSize: "cover", backgroundPosition: "center", mixBlendMode: "screen", filter: "blur(6px) brightness(1.6)", animation: night ? "swNebula 9s ease-in-out infinite" : "none", opacity: 0 } });
  const shoot = (k: string, l: string, tp: string, dl: number, dur?: number) => E("div", { key: k, style: { position: "absolute", left: l, top: tp, width: 140, height: 1.5, borderRadius: 1, background: "linear-gradient(90deg, #f2f5fb, rgba(200,215,245,0))", boxShadow: "0 0 6px rgba(220,230,250,.8)", opacity: 0, transformOrigin: "0 50%", animation: night ? `swShoot ${dur || 14}s linear ${dl}s infinite` : "none" } });
  const stars = STARS.map((p, i) => E("div", { key: "s" + i, style: { position: "absolute", left: p.x + "%", top: p.y + "%", width: p.r * 2, height: p.r * 2, borderRadius: "50%", background: "#e4e9f4", boxShadow: p.r > 1.2 ? "0 0 6px rgba(200,215,245,.8)" : "none", opacity: 0.55, animation: `swTwinkle ${p.d}s ease-in-out ${p.dl}s infinite` } }));
  // Preview-only ?mist= switch (src/diag/stutterDiag.ts). "v2" is the design's two-ellipse gradients under a live
  // blur(28px), redrawn every frame while the bands drift. "soft" draws each ellipse already softened: a taller ellipse
  // whose stops follow the blurred falloff (fitted on the 1480 x 924 board; at most about one colour level away on the
  // tablet and two in portrait). Stops are fractions of the tint's alpha at every tenth of the radius. "off" omits them.
  const soft = (rgb: string, a: number, at: string, rx: number, ry: number, stops: number[]) =>
    `radial-gradient(ellipse ${rx}% ${ry}% at ${at}, ${stops.map((f, i) => `rgba(${rgb},${+(f * a).toFixed(3)}) ${i * 10}%`).join(", ")}, rgba(${rgb},0) ${stops.length * 10}%)`;
  const mist = (k: string, top: string, h: string, op: number, dur: number, dir: boolean, rgb: string, a: number, [ry1, ry2]: [number, number], [s1, s2]: [number[], number[]]) => {
    if (mistMode === "off") return null;
    const tint = `rgba(${rgb},${a})`;
    const look: CSSProperties = mistMode === "soft"
      ? { background: `${soft(rgb, a, "30% 50%", 50, ry1, s1)}, ${soft(rgb, a, "75% 55%", 40, ry2, s2)}` }
      : { filter: "blur(28px)", background: `radial-gradient(ellipse 50% 50% at 30% 50%, ${tint}, transparent 70%), radial-gradient(ellipse 40% 45% at 75% 55%, ${tint}, transparent 70%)` };
    return E("div", { key: k, style: { position: "absolute", left: "-20%", right: "-20%", top, height: h, pointerEvents: "none", opacity: op, ...look, animation: `swDrift ${dur}s ease-in-out infinite ${dir ? "alternate-reverse" : "alternate"}`, ...fade } });
  };
  return E("div", { "aria-hidden": true, style: { position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" } },
    sky, swirl, glow, ...ember, moonGlow, shoot("sh1", "78%", "12%", 3), shoot("sh2", "30%", "8%", 10), shoot("sh3", "58%", "4%", 6, 17), shoot("sh4", "92%", "22%", 13, 19), shoot("sh5", "44%", "16%", 1, 23),
    E("div", { key: "st", style: { position: "absolute", inset: 0, opacity: night ? 0.8 : 0.1, ...fade } }, ...stars),
    E("div", { key: "beam", style: { position: "absolute", left: "-10%", top: "-30%", width: "70%", height: "120%", transform: "rotate(-24deg)", transformOrigin: "0 0", background: "linear-gradient(90deg, transparent 0%, rgba(190,205,240,.07) 35%, rgba(210,222,250,.11) 50%, rgba(190,205,240,.06) 65%, transparent 100%)", filter: "blur(10px)", opacity: night ? 1 : 0, ...fade } }),
    E("div", { key: "dawn", style: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", background: "linear-gradient(0deg, rgba(210,150,90,.16), rgba(170,120,80,.05) 55%, transparent)", opacity: night ? 0 : 1, ...fade } }),
    mist("m1", "58%", "46%", night ? 0.5 : 0.35, 70, false, night ? "150,165,200" : "225,200,170", night ? 0.35 : 0.3, [53.75, 49.5], [[.86, .79, .67, .53, .39, .25, .12, .03], [.84, .78, .66, .52, .38, .24, .11, .03]]),
    mist("m2", "-8%", "34%", night ? 0.32 : 0.22, 90, true, night ? "130,145,185" : "225,200,170", night ? 0.3 : 0.25, [57.5, 52.88], [[.8, .75, .64, .5, .36, .22, .11, .03, .01], [.78, .73, .62, .49, .35, .22, .11, .03, .01]]),
    E("div", { key: "rim", style: { position: "absolute", inset: 0, background: "radial-gradient(ellipse 90% 80% at 50% 50%, transparent 55%, rgba(2,3,6,.55) 85%, rgba(0,0,0,.85) 100%)" } }),
  );
}

/**
 * The pulsing glow around the acting seat (Night) and the current voter (Day). The V2 design animates a box shadow
 * (swGlow), which the browser repaints on the page every frame. Here the two end states of that animation are drawn
 * once and cross-faded with opacity, which the graphics chip animates without repainting: the rest and peak frames
 * are unchanged, frames in between differ slightly. The ring is split from the halo so it brightens steadily: its
 * peak layer (alpha .8 over the resting .75) composes to the design's .95.
 */
export function seatGlow(seconds: number): ReactNode {
  const layer = (boxShadow: string, animation?: string) => E("div", { style: { position: "absolute", inset: 0, borderRadius: "50%", boxShadow, ...(animation ? { animation: `${animation} ${seconds}s ease-in-out infinite` } : {}) } });
  return E("div", { key: "g", style: { position: "absolute", inset: -7, borderRadius: "50%", pointerEvents: "none" } },
    layer("0 0 22px 4px rgba(214,224,245,.3)", "swGlowRest"),
    layer("0 0 40px 12px rgba(214,224,245,.48)", "swGlowPeak"),
    layer("0 0 0 2px rgba(226,234,250,.75)"),
    layer("0 0 0 2px rgba(240,245,255,.8)", "swGlowPeak"));
}

const star4 = (x: number, y: number, r: number, fill: string) =>
  `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}"/>`;

/** Remembers the rotation of the pointer star and how many times the sun/moon morph has played. */
export function useCrescentMemory() {
  return useRef({ handA: null as number | null, lastNight: undefined as boolean | undefined, morph: 0 }).current;
}

type CrescentArgs = {
  layout: RingLayout;
  night: boolean;
  /** Where the ring's pointer star should aim (the acting or selected seat), if anywhere. */
  target: { x: number; y: number } | null;
  memory: ReturnType<typeof useCrescentMemory>;
};

/** The "Crescent Ring" centrepiece: halo, ring ornaments, the sun/moon orb and the pointer star. */
export function crescentArt({ layout, night, target, memory }: CrescentArgs): ReactNode[] {
  const { cx, cy, rx, ry } = layout;
  const c = 100;
  const dr = Math.min(rx, ry) * 0.72;
  const box = (k: string, html: string, extra?: CSSProperties) => E("div", { key: k, "aria-hidden": true, style: { position: "absolute", left: cx - dr, top: cy - dr, width: dr * 2, height: dr * 2, pointerEvents: "none", transition: "left .5s, top .5s, width .5s, height .5s", ...extra }, dangerouslySetInnerHTML: { __html: html } });

  const want = target ? (Math.atan2(target.y - cy, target.x - cx) * 180) / Math.PI + 90 : 0;
  const prev = memory.handA == null ? want : memory.handA;
  memory.handA = prev + ((((want - prev) % 360) + 540) % 360 - 180);

  const deco = `<svg viewBox="0 0 200 200" width="100%" height="100%" style="overflow:visible"><circle cx="100" cy="100" r="96" fill="none" stroke="rgba(214,222,236,.16)" stroke-width=".4"/>${[0, 90, 180, 270].map((d) => { const a = ((d - 90) * Math.PI) / 180; return star4(c + 96 * Math.cos(a), c + 96 * Math.sin(a), 2.6, "rgba(226,231,240,.55)"); }).join("")}</svg>`;
  const mark = `<svg viewBox="0 0 200 200" width="100%" height="100%" style="overflow:visible"><g style="filter:drop-shadow(0 0 4px rgba(220,230,250,.9))">${star4(100, 4, 4.4, "#f2f4f8")}</g></svg>`;

  if (memory.lastNight !== undefined && memory.lastNight !== night) memory.morph += 1;
  memory.lastNight = night;
  const anim = memory.morph > 0;
  const K = "m" + memory.morph;
  const A = (dayAnim: string, nightAnim: string, dayStatic: CSSProperties, nightStatic: CSSProperties): CSSProperties => (anim ? { animation: night ? nightAnim : dayAnim } : night ? nightStatic : dayStatic);
  const ez = "cubic-bezier(.6,0,.3,1)";
  const orb = E("svg", { key: K, viewBox: "0 0 200 200", width: "100%", height: "100%", style: { overflow: "visible" } },
    E("defs", { key: "d" },
      E("mask", { key: "mk", id: "swmm", maskUnits: "userSpaceOnUse", x: -100, y: -100, width: 400, height: 400 },
        E("circle", { key: "w", cx: 100, cy: 100, r: 91, fill: "#fff" }),
        E("circle", { key: "b", cx: 117, cy: 88, r: 82, fill: "#000", style: A(`swCutOut 1.4s ${ez} both`, `swCutIn 1.4s ${ez} 1.2s both`, { transform: "translate(140px,-150px)" }, {}) })),
      E("linearGradient", { key: "g1", id: "swmg", x1: 0, y1: 0, x2: 0.6, y2: 1 }, E("stop", { key: 1, offset: 0, stopColor: "#fbfcfe" }), E("stop", { key: 2, offset: 0.5, stopColor: "#e3e8f1" }), E("stop", { key: 3, offset: 1, stopColor: "#aeb8cb" })),
      E("radialGradient", { key: "g5", id: "swmd2", cx: "50%", cy: "50%", r: "50%" }, E("stop", { key: 1, offset: 0, stopColor: "rgba(14,20,36,.6)" }), E("stop", { key: 2, offset: 0.8, stopColor: "rgba(40,52,82,.45)" }), E("stop", { key: 3, offset: 1, stopColor: "rgba(190,205,240,.5)" })),
      E("radialGradient", { key: "g4", id: "swmt", cx: "64%", cy: "40%", r: "62%" }, E("stop", { key: 1, offset: 0.78, stopColor: "rgba(40,50,72,0)" }), E("stop", { key: 2, offset: 1, stopColor: "rgba(40,50,72,.35)" })),
      E("linearGradient", { key: "g2", id: "swsg", x1: 0, y1: 0, x2: 1, y2: 1 }, E("stop", { key: 1, offset: 0, stopColor: "#fff0c2" }), E("stop", { key: 2, offset: 0.5, stopColor: "#f2c46a" }), E("stop", { key: 3, offset: 1, stopColor: "#c98a36" })),
      E("radialGradient", { key: "g3", id: "swsd", cx: "50%", cy: "50%", r: "50%" }, E("stop", { key: 1, offset: 0, stopColor: "rgba(60,36,14,.6)" }), E("stop", { key: 2, offset: 0.8, stopColor: "rgba(120,74,28,.45)" }), E("stop", { key: 3, offset: 1, stopColor: "rgba(240,180,90,.55)" }))),
    E("circle", { key: "amb", cx: 100, cy: 100, r: 88, fill: "url(#swsd)", style: A("swIn 1.4s both", "swOut 1.4s both", {}, { opacity: 0 }) }),
    E("g", { key: "gold", style: { filter: "drop-shadow(0 0 12px rgba(255,200,110,.7)) drop-shadow(0 0 34px rgba(240,160,70,.4))", ...A("swIn 1.4s both", "swOut 1.4s both", {}, { opacity: 0 }) } },
      E("circle", { key: "gf", cx: 100, cy: 100, r: 89, fill: "url(#swsg)", stroke: "url(#swsg)", strokeWidth: 4.5, fillOpacity: 0 }),
      E("circle", { key: "gi", cx: 100, cy: 100, r: 82, fill: "none", stroke: "rgba(255,226,160,.35)", strokeWidth: 0.5 })),
    E("g", { key: "moon", style: { filter: "drop-shadow(0 0 12px rgba(200,215,250,.65)) drop-shadow(0 0 34px rgba(150,175,230,.4))", ...A("swOut 1.4s both", "swIn 1.4s both", { opacity: 0 }, {}) } },
      E("circle", { key: "md", cx: 100, cy: 100, r: 88, fill: "url(#swmd2)" }),
      E("circle", { key: "mr", cx: 100, cy: 100, r: 89, fill: "none", stroke: "url(#swmg)", strokeWidth: 4.5 }),
      E("circle", { key: "mi", cx: 100, cy: 100, r: 82, fill: "none", stroke: "rgba(225,232,244,.35)", strokeWidth: 0.5 })));

  return [
    E("div", { key: "halo", "aria-hidden": true, style: { position: "absolute", left: cx - dr * 0.9, top: cy - dr * 0.9, width: dr * 1.8, height: dr * 1.8, borderRadius: "50%", pointerEvents: "none", background: "radial-gradient(closest-side, rgba(4,6,12,.55), rgba(4,6,12,.2) 45%, transparent 70%)", transition: "background 1.2s, left .5s, top .5s, width .5s, height .5s" } }),
    box("deco", deco),
    E("div", { key: "orbw", "aria-hidden": true, style: { position: "absolute", left: cx - dr, top: cy - dr, width: dr * 2, height: dr * 2, pointerEvents: "none", transition: "left .5s, top .5s, width .5s, height .5s" } }, orb),
    box("mark", mark, { opacity: target ? 1 : 0, transform: `rotate(${memory.handA}deg)`, transition: "transform 1.1s cubic-bezier(.3,1.35,.5,1), opacity .4s, left .5s, top .5s, width .5s, height .5s" }),
  ];
}
