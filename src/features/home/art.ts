// Official edition logos and Carousel icons (Package 1).
//
// The artwork is The Pandemonium Institute's, kept under public/art/ with its
// provenance and rights notes in public/art/PROVENANCE.md (private-personal-use
// artwork that the project owner chose to include). Every use below still checks
// that the file really loads and otherwise keeps the marked temporary treatment,
// so removing public/art/ degrades gracefully.

import { useEffect, useState } from "react";

import { ART_BASE, localCharacterArt } from "@/data/localArt";

export { ART_BASE, localCharacterArt };

export const EDITION_LOGO: Record<string, string> = {
  tb: `${ART_BASE}/scripts/tb.png`,
  bmr: `${ART_BASE}/scripts/bmr.png`,
  snv: `${ART_BASE}/scripts/snv.png`,
};

/** The generic team icons beside the setup flow's composition counts. */
export const GENERIC_TEAM_ICON: Record<"townsfolk" | "outsider" | "minion" | "demon", string> = {
  townsfolk: `${ART_BASE}/characters/generic/townsfolk.png`,
  outsider: `${ART_BASE}/characters/generic/outsider.png`,
  minion: `${ART_BASE}/characters/generic/minion.png`,
  demon: `${ART_BASE}/characters/generic/demon.png`,
};

/** The design's eight orbiting Carousel icons, in its order. */
export const CAROUSEL_ORBIT: readonly string[] = [
  "lleech", "balloonist", "harpy", "pixie", "kazali", "huntsman", "boffin", "king",
].map((id) => `${ART_BASE}/characters/carousel/${id}.png`);


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
