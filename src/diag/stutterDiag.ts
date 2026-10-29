/**
 * Preview-only switches for the scene-opening stutter test (branch package4-stutter-diag, never merged).
 *
 * Everything is off unless the URL asks for it, so the default page is identical to PR #12 at 8626a2d:
 *   ?mist=soft   draw the board's two mist bands already softened instead of under a live blur(28px)
 *   ?mist=off    leave the mist bands out (test only: shows whether they cause the stutter)
 *   ?veil=late   change the board under the Night/Day veil once it is dark (650 ms after the tap) instead of at the tap
 *   ?rest=off    keep drawing the board under the Reveal and the victory scene (test only: the blank areas may return)
 *   ?calm=1      freeze the sky's movement: mist, stars, nebula, moon glow, embers, shooting stars (test only)
 *   ?meter=1     on-screen frame meter: frame rate, longest pause in the last 5 s, and the longest pause within 3 s of each tap
 * Switches combine: ?mist=soft&veil=late&meter=1
 */
export type MistMode = "v2" | "soft" | "off";
export type StutterFlags = { mist: MistMode; veilLate: boolean; restOff: boolean; calm: boolean; meter: boolean };

export function parseStutter(search: string): StutterFlags {
  const q = new URLSearchParams(search);
  const mist = q.get("mist");
  return {
    mist: mist === "soft" || mist === "off" ? mist : "v2",
    veilLate: q.get("veil") === "late",
    restOff: q.get("rest") === "off",
    calm: q.get("calm") === "1",
    meter: q.get("meter") === "1",
  };
}

export const stutterFlags: StutterFlags = parseStutter(typeof window === "undefined" ? "" : window.location.search);

/** With ?veil=late the veil is fully dark from 20% of its 2.1 s (420 ms) and the title has tracked in by 30% (630 ms). */
export const VEIL_LATE_MS = 650;

/** The sky's never-ending animations, by keyframe name (boardArt.tsx moonBackdrop). */
const SKY_MOTION = ["swDrift", "swTwinkle", "swNebula", "swHaunt", "swEmber", "swShoot"];

export function calmCss(flags: StutterFlags): string {
  return flags.calm ? `${SKY_MOTION.map((k) => `[style*="${k}"]`).join(", ")} { animation-play-state: paused !important; }` : "";
}

/** Installs the switches that act outside React: the calm style and the frame meter. Does nothing by default. */
export function installStutterDiag(flags: StutterFlags = stutterFlags) {
  const css = calmCss(flags);
  if (css) {
    const style = document.createElement("style");
    style.id = "stutter-calm";
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (flags.meter) installMeter(flags);
}

function installMeter(flags: StutterFlags) {
  const box = document.createElement("pre");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;left:6px;top:6px;z-index:2147483647;margin:0;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.8);color:#9fe3a0;font:12px/1.4 ui-monospace,monospace;pointer-events:none;white-space:pre";
  document.body.appendChild(box);
  const on = Object.entries({ mist: flags.mist !== "v2" ? flags.mist : "", veil: flags.veilLate ? "late" : "", rest: flags.restOff ? "off" : "", calm: flags.calm ? "1" : "" }).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ") || "no switches";
  const gaps: [number, number][] = [];
  const taps: { at: number; worst: number; slow: number }[] = [];
  let last = performance.now(), drawn = 0;
  addEventListener("pointerdown", () => { taps.unshift({ at: performance.now(), worst: 0, slow: 0 }); taps.length = Math.min(taps.length, 4); }, true);
  const tick = (t: number) => {
    const gap = t - last; last = t;
    gaps.push([t, gap]);
    while (gaps.length && t - gaps[0]![0] > 5000) gaps.shift();
    for (const tap of taps) if (t - tap.at <= 3000) { tap.worst = Math.max(tap.worst, gap); if (gap > 50) tap.slow += 1; }
    requestAnimationFrame(tick);
    if (t - drawn < 250) return; // redraw the readout four times a second so it adds little work of its own
    drawn = t;
    const second = gaps.filter(([at]) => t - at <= 1000);
    box.textContent =
      `${on}\n` +
      `fps ${second.length}   longest pause (5 s) ${Math.round(Math.max(...gaps.map(([, g]) => g)))} ms\n` +
      (taps.length ? taps.map((tap, i) => `tap ${i ? `-${i}` : "now"}: longest ${Math.round(tap.worst)} ms, ${tap.slow} pauses > 50 ms`).join("\n") : "tap something: the 3 s after it are measured");
  };
  requestAnimationFrame(tick);
}
