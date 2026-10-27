/**
 * Preview-only tablet rendering diagnostics (branch package4-tablet-diag, never merged).
 *
 * Everything is off unless the URL asks for it, so the default page is identical to PR #12:
 *   ?diag=nomultiply   hide the Show screen's multiply feTurbulence layer
 *   ?diag=nonoise      hide both of the Show screen's noise blend layers
 *   ?diag=tex          swap the two noise layers' feTurbulence SVGs for pre-rendered images of the same noise (same layers, same blend modes)
 *   ?diag=bgblend      draw both noise textures inside the Show screen's base gradient with background-blend-mode, no extra layers
 *   ?diag=noflicker    stop the Show screen's glow flicker animation (it sits under the blend layers)
 *   ?diag=noboard      hide the board while a full-screen scene (Show or victory) is open
 *   ?diag=vv           on-screen readout of viewport numbers and frame gaps
 *   ?kb=overlays | resizes | vk   keyboard experiments (overlays/resizes are applied from index.html)
 * Switches combine with commas: ?diag=nonoise,vv&kb=overlays
 */
export type DiagFlags = { diag: Set<string>; kb: string };

export function parseDiag(search: string): DiagFlags {
  const q = new URLSearchParams(search);
  const diag = new Set((q.get("diag") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return { diag, kb: q.get("kb") ?? "" };
}

const SHOW = `[role="dialog"][style*="z-index: 90"]`;
const SCENE = `[role="dialog"][style*="z-index: 95"]`;

export function diagCss(flags: DiagFlags): string {
  const rules: string[] = [];
  if (flags.diag.has("nonoise")) rules.push(`.gv-root ${SHOW} > [style*="mix-blend-mode"] { display: none !important; }`);
  else if (flags.diag.has("nomultiply")) rules.push(`.gv-root ${SHOW} > [style*="mix-blend-mode: multiply"] { display: none !important; }`);
  const noise = "/diag-noise";
  if (flags.diag.has("tex") && !flags.diag.has("nonoise")) {
    rules.push(`.gv-root ${SHOW} > [style*="mix-blend-mode: overlay"] { background-image: url(${noise}/overlay-240.webp) !important; background-size: 240px 240px !important; }`);
    rules.push(`.gv-root ${SHOW} > [style*="mix-blend-mode: multiply"] { background-image: url(${noise}/multiply-600.webp) !important; background-size: 600px 600px !important; }`);
  }
  if (flags.diag.has("bgblend") && !flags.diag.has("nonoise")) {
    rules.push(`.gv-root ${SHOW} > [style*="mix-blend-mode"], .gv-root ${SHOW} > :has(+ [style*="mix-blend-mode: overlay"]) { display: none !important; }`);
    rules.push(
      `.gv-root ${SHOW} > :first-child { background-color: #0d0607 !important; background-size: 600px 600px, 240px 240px, auto, auto, auto !important; background-blend-mode: multiply, overlay, normal, normal, normal !important; background-image: ` +
        `url(${noise}/multiply-600-baked.webp), url(${noise}/overlay-240-baked.webp), ` +
        `radial-gradient(ellipse 40% 30% at 18% 100%, rgba(110,40,30,.22), transparent 70%), radial-gradient(ellipse 40% 30% at 82% 0%, rgba(80,44,96,.18), transparent 70%), ` +
        `radial-gradient(ellipse 70% 60% at 50% 48%, #3b1a1d 0%, #261011 45%, #120708 80%) !important; }`,
    );
  }
  if (flags.diag.has("noflicker")) rules.push(`.gv-root ${SHOW} > [style*="swFlicker"] { animation: none !important; }`);
  if (flags.diag.has("noboard")) {
    rules.push(`.gv-root :has(> ${SHOW}) > :not([role="dialog"]) { display: none !important; }`);
    rules.push(`.gv-root :has(> ${SCENE}) > :not([role="dialog"]) { display: none !important; }`);
  }
  return rules.join("\n");
}

function readout(flags: DiagFlags) {
  const box = document.createElement("pre");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;left:6px;top:6px;z-index:2147483647;margin:0;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.78);color:#9fe3a0;font:11px/1.35 ui-monospace,monospace;pointer-events:none;white-space:pre";
  document.body.appendChild(box);
  const vv = window.visualViewport;
  let resizes = 0, minH = Infinity, maxGap = 0, last = performance.now(), windowStart = last, windowMax = 0, shownGap = 0;
  const mode = new URLSearchParams(location.search).get("kb") || "default";
  const draw = () => {
    const h = vv?.height ?? 0;
    if (h) minH = Math.min(minH, h);
    box.textContent =
      `kb=${mode}  diag=${[...flags.diag].join(",") || "-"}\n` +
      `inner ${innerWidth}x${innerHeight}  client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}\n` +
      `visual ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} off ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)} x${vv.scale.toFixed(2)}` : "n/a"}\n` +
      `dpr ${devicePixelRatio}  resizes ${resizes}  min visual h ${Number.isFinite(minH) ? Math.round(minH) : "-"}\n` +
      `frame gap max/5s ${Math.round(shownGap)} ms (all-time ${Math.round(maxGap)})`;
  };
  const bump = () => { resizes += 1; draw(); };
  vv?.addEventListener("resize", bump);
  vv?.addEventListener("scroll", draw);
  addEventListener("resize", bump);
  const nav = navigator as Navigator & { virtualKeyboard?: EventTarget & { boundingRect: DOMRect } };
  nav.virtualKeyboard?.addEventListener("geometrychange", () => { box.dataset.vk = JSON.stringify(nav.virtualKeyboard!.boundingRect); draw(); });
  const tick = (t: number) => {
    const gap = t - last; last = t;
    windowMax = Math.max(windowMax, gap); maxGap = Math.max(maxGap, gap);
    if (t - windowStart > 5000) { shownGap = windowMax; windowMax = 0; windowStart = t; draw(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  draw();
}

export function installDiagnostics(search: string = location.search) {
  const flags = parseDiag(search);
  if (!flags.diag.size && !flags.kb) return flags;
  const css = diagCss(flags);
  if (css) {
    const style = document.createElement("style");
    style.id = "diag-style";
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (flags.kb === "vk") {
    const vk = (navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } }).virtualKeyboard;
    if (vk) vk.overlaysContent = true;
  }
  if (flags.diag.has("vv")) readout(flags);
  return flags;
}
