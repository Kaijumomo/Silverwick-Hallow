/**
 * Preview-only switches for the scene-opening stutter test (branch package4-stutter-diag, never merged).
 *
 * Everything is off unless the URL asks for it, so the default page is identical to PR #12 at 8626a2d:
 *   ?mist=soft   draw the board's two mist bands already softened instead of under a live blur(28px)
 *   ?mist=off    leave the mist bands out (test only: shows whether they cause the stutter)
 *   ?veil=late   change the board under the Night/Day veil once it is dark (650 ms after the tap) instead of at the tap
 * Switches combine: ?mist=soft&veil=late
 */
export type MistMode = "v2" | "soft" | "off";
export type StutterFlags = { mist: MistMode; veilLate: boolean };

export function parseStutter(search: string): StutterFlags {
  const q = new URLSearchParams(search);
  const mist = q.get("mist");
  return { mist: mist === "soft" || mist === "off" ? mist : "v2", veilLate: q.get("veil") === "late" };
}

export const stutterFlags: StutterFlags = parseStutter(typeof window === "undefined" ? "" : window.location.search);

/** With ?veil=late the veil is fully dark from 20% of its 2.1 s (420 ms) and the title has tracked in by 30% (630 ms). */
export const VEIL_LATE_MS = 650;
