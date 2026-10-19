import { useMemo } from "react";
import { buildReferenceCategories, type ReferenceCategory } from "@/features/home/referenceCategories";
import { CAROUSEL_ORBIT, EDITION_LOGO, useLoadedArt } from "@/features/home/art";
import { BackButton, DiamondRule, PhoneFrame } from "./PhoneParts";

/** Character Reference script picker (design screen 22): a two-column grid of
 * script tiles. Opening a script hands over to the reference overlay. */
export function PhoneReferencePicker({ onBack, onOpen }: { onBack: () => void; onOpen: (category: ReferenceCategory) => void }) {
  const categories = useMemo(() => buildReferenceCategories(), []);
  const art = useLoadedArt([...Object.values(EDITION_LOGO), ...CAROUSEL_ORBIT]);
  const orbit = CAROUSEL_ORBIT.filter((src) => art.has(src));
  return (
    <PhoneFrame reference label="reference-picker">
      <main className="swp-ref-page">
        <BackButton label="Home" onClick={onBack} />
        <DiamondRule />
        <div className="swp-ref-head">
          <h1 className="swp-title swp-ref-title">Character Reference</h1>
          <p className="swp-fell swp-ref-sub">Browse scripts, abilities and night order.</p>
        </div>
        <div className="swp-ref-list">
          {categories.map((c) => (
            <button key={c.id} type="button" className="swp-ref-row" onClick={() => onOpen(c)} data-category={c.id} aria-label={c.name}>
              {c.id === "carousel" ? (
                <span className="swp-ref-orbit" role="img" aria-label="The Carousel">
                  <span className="swp-ref-orbit-ring" aria-hidden="true">
                    {orbit.map((src, i) => {
                      const a = (i / orbit.length) * Math.PI * 2 - Math.PI / 2;
                      return (
                        <span
                          key={src}
                          className="swp-ref-orbit-icon"
                          style={{ left: Math.round(48 + Math.cos(a) * 36 - 12), top: Math.round(48 + Math.sin(a) * 36 - 12), backgroundImage: `url(${src})` }}
                        />
                      );
                    })}
                  </span>
                  <span className="swp-ref-orbit-label" aria-hidden="true">The<br />Carousel</span>
                </span>
              ) : (
                <span
                  className="swp-ref-logo"
                  role="img"
                  aria-label={c.name}
                  style={EDITION_LOGO[c.id] && art.has(EDITION_LOGO[c.id]!) ? { backgroundImage: `url(${EDITION_LOGO[c.id]})` } : undefined}
                />
              )}
              <span className="swp-ref-text">
                <span className="swp-ref-name">{c.name}</span>
                <span className="swp-ref-count">{c.id === "carousel" ? "Experimental" : `${c.scriptCount} characters`}</span>
              </span>
              <span className="swp-ref-chev" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
        <DiamondRule />
      </main>
    </PhoneFrame>
  );
}
