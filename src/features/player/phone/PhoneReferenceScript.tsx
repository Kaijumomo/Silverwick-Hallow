import { useMemo, useState } from "react";
import { EDITION_LOGO, useLoadedArt } from "@/features/home/art";
import type { ReferenceCategory } from "@/features/home/referenceCategories";
import { buildNightColumns, groupByTeam } from "@/features/home/reference/referenceData";
import type { RoleDef } from "@/stores/types";
import { BackButton, PhoneFrame } from "./PhoneParts";
import { TarotCard } from "./TarotCard";
import { roleArt } from "./roleArt";

type Tab = "chars" | "first" | "other";

/** Character Reference script view (design screens 23 to 26): the script logo,
 * three tabs (Characters, First night, Other nights) and the character card.
 * The Carousel is a single list with no tabs. */
export function PhoneReferenceScript({ category, onBack }: { category: ReferenceCategory; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("chars");
  const [card, setCard] = useState<RoleDef | null>(null);
  const carousel = category.id === "carousel";
  const logo = EDITION_LOGO[category.id];
  const art = useLoadedArt(logo ? [logo] : []);
  const groups = useMemo(() => groupByTeam(category.roles), [category]);
  const nights = useMemo(() => buildNightColumns(category.roles), [category]);
  const night = tab === "chars" ? undefined : nights.find((n) => n.key === tab);
  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "chars", label: "Characters", n: category.roles.length },
    { id: "first", label: "First night", n: nights[0]?.wakes ?? 0 },
    { id: "other", label: "Other nights", n: nights[1]?.wakes ?? 0 },
  ];
  const at = tabs.findIndex((t) => t.id === tab);
  return (
    <PhoneFrame reference label="reference-script">
      <div className="swp-rs">
        <header className="swp-rs-head">
          <div className="swp-rs-top">
            <BackButton label="Scripts" onClick={onBack} />
            <span className="swp-rs-count">{category.roles.length} characters</span>
          </div>
          <div className="swp-rs-logo">
            {logo && art.has(logo) ? (
              <span role="img" aria-label={category.name} className="swp-rs-logo-img" style={{ backgroundImage: `url(${logo})` }} />
            ) : (
              <h1 className="swp-rs-logo-text">{category.name}</h1>
            )}
          </div>
          {!carousel && (
            <div className="swp-rs-tabs" role="tablist" aria-label={`${category.name} reference`} style={{ ["--swp-tab-at" as string]: at }}>
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" id={`swp-rs-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="swp-rs-panel"
                  className={`swp-rs-tab${tab === t.id ? " swp-rs-tab-on" : ""}`} onClick={() => setTab(t.id)}>
                  {t.label}<span className="swp-rs-tab-n">{t.n}</span>
                </button>
              ))}
              <span className="swp-rs-ind" aria-hidden="true"><span className="swp-rs-ind-gem" /><span className="swp-rs-ind-line" /></span>
            </div>
          )}
        </header>
        <div className="swp-rs-body" id="swp-rs-panel" role={carousel ? undefined : "tabpanel"} aria-labelledby={carousel ? undefined : `swp-rs-tab-${tab}`}>
          {!night && (
            <div className="swp-rs-groups">
              {groups.map((g) => (
                <section key={g.type} className="swp-rs-group" aria-label={g.label}>
                  <div className="swp-rs-ghead">
                    <span className="swp-rs-gname" style={{ color: g.color }}>{g.label}</span>
                    <span className="swp-rs-gn">{g.roles.length}</span>
                    <span className="swp-rs-grule" style={{ background: `linear-gradient(90deg, ${g.color}66, transparent)` }} aria-hidden="true" />
                  </div>
                  {g.roles.map((r) => (
                    <button key={r.id} type="button" className="swp-rs-row" onClick={() => setCard(r)}>
                      <span role="img" aria-label="" className="swp-rs-icon" style={{ backgroundImage: `url(${roleArt(r)})` }} />
                      <span className="swp-rs-text">
                        <span className="swp-rs-name">{r.name}</span>
                        {r.ability && <span className="swp-rs-ability">{r.ability}</span>}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
          {night && (
            <ol className="swp-rs-night" aria-label={night.label}>
              {night.rows.map((row) =>
                row.kind === "step" ? (
                  <li key={row.id} className="swp-rs-nrow swp-rs-nrow-step">
                    <span className="swp-rs-num" />
                    <span className="swp-rs-nicon"><span className="swp-rs-diamond" aria-hidden="true" /></span>
                    <span className="swp-rs-text">
                      <span className="swp-rs-nname swp-rs-nname-step">{row.name}</span>
                      <span className="swp-rs-ntext">{row.text}</span>
                    </span>
                  </li>
                ) : (
                  <li key={row.id}>
                    <button type="button" className="swp-rs-nrow" onClick={() => setCard(row.role)}>
                      <span className="swp-rs-num">{row.num}</span>
                      <span className="swp-rs-nicon"><span role="img" aria-label="" className="swp-rs-nicon-img" style={{ backgroundImage: `url(${roleArt(row.role)})` }} /></span>
                      <span className="swp-rs-text">
                        <span className="swp-rs-nname">{row.role.name}</span>
                        <span className="swp-rs-ntext">{row.text}</span>
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      </div>
      {card && <TarotCard role={card} onClose={() => setCard(null)} />}
    </PhoneFrame>
  );
}
