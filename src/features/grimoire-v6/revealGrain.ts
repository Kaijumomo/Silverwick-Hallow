import type { CSSProperties } from "react";

/**
 * The Reveal (Show) screen's backdrop: base gradient, corner glows and film grain drawn as ONE element.
 *
 * The V2 design stacks the grain as two full-screen mix-blend-mode layers over the flickering centre glow. On the
 * Samsung Tab S8 Ultra that arrangement left bands of the Reveal unpainted. In five recorded runs it failed with the
 * two blend layers present (shipped, or with the grain drawn from images instead of SVG filters) and passed with them
 * removed (this arrangement) or with the glow's flicker stopped. The mechanism inside the browser is not established.
 *
 * Here the grain is two pre-rendered textures blended into the gradients with background-blend-mode, so the Reveal has
 * no blend layers. The textures are Chromium renders of the V2 file's own noise definitions, with the layer opacities
 * (.22 and .35) folded into their alpha; see docs/ai/design/REVEAL_GRAIN_TEXTURES.md. The glow and its flicker are unchanged.
 */
const texture = (file: string) => `${import.meta.env.BASE_URL}textures/${file}`;
export const GRAIN_OVERLAY = texture("reveal-grain-overlay.webp");
export const GRAIN_MULTIPLY = texture("reveal-grain-multiply.webp");

export const REVEAL_BACKDROP: CSSProperties = {
  position: "absolute",
  inset: "0",
  pointerEvents: "none",
  backgroundColor: "#0d0607",
  backgroundImage: [
    `url(${GRAIN_MULTIPLY})`,
    `url(${GRAIN_OVERLAY})`,
    "radial-gradient(ellipse 40% 30% at 18% 100%, rgba(110,40,30,.22), transparent 70%)",
    "radial-gradient(ellipse 40% 30% at 82% 0%, rgba(80,44,96,.18), transparent 70%)",
    "radial-gradient(ellipse 70% 60% at 50% 48%, #3b1a1d 0%, #261011 45%, #120708 80%)",
  ].join(", "),
  backgroundSize: "600px 600px, 240px 240px, auto, auto, auto",
  backgroundBlendMode: "multiply, overlay, normal, normal, normal",
};

const kept: HTMLImageElement[] = [];

/** Fetch the grain once the Grimoire is up so the first Reveal does not wait for it. The Reveal paints without them. */
export function preloadRevealGrain(): void {
  if (kept.length || typeof Image === "undefined") return;
  for (const src of [GRAIN_OVERLAY, GRAIN_MULTIPLY]) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    kept.push(img);
  }
}
