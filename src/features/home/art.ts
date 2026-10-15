// Official edition logos and Carousel icons (Package 1).
//
// The artwork is The Pandemonium Institute's, supplied as a private-personal-use
// PNG handoff (see ASSET_INVENTORY.md). It is NOT committed to this repository:
// public/art/ is git-ignored and filled locally by scripts/install-private-art.mjs.
// Every use below checks that the file is really there and otherwise keeps the
// marked temporary treatment, so a clone without the artwork still works.

import { useEffect, useState } from "react";

export const ART_BASE = "/art";

export const EDITION_LOGO: Record<string, string> = {
  tb: `${ART_BASE}/scripts/tb.png`,
  bmr: `${ART_BASE}/scripts/bmr.png`,
  snv: `${ART_BASE}/scripts/snv.png`,
};

/**
 * The design's Carousel tile orbits eight character icons. The handoff has six
 * of them; Harpy and Kazali are not in it (they are among the eight newly added
 * characters), so the orbit simply has six.
 */
export const CAROUSEL_ORBIT: readonly string[] = ["lleech", "balloonist", "pixie", "huntsman", "boffin", "king"].map(
  (id) => `${ART_BASE}/characters/carousel/${id}.png`,
);

/** The subset of `srcs` that actually loads, filled in as each image arrives. */
export function useLoadedArt(srcs: readonly string[]): ReadonlySet<string> {
  const key = srcs.join("|");
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    setLoaded(new Set());
    for (const src of key ? key.split("|") : []) {
      const img = new Image();
      img.onload = () => {
        if (live) setLoaded((prev) => new Set(prev).add(src));
      };
      img.src = src;
    }
    return () => {
      live = false;
    };
  }, [key]);
  return loaded;
}
