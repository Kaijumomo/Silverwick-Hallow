/**
 * Preview-only tablet rendering diagnostics (branch package4-tablet-diag, never merged).
 *
 * Everything is off unless the URL asks for it, so the default page is identical to PR #12:
 *   ?diag=nomultiply   hide the Show screen's multiply feTurbulence layer
 *   ?diag=nonoise      hide both of the Show screen's noise blend layers
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
