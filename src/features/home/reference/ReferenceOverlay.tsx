// Home Character Reference overlay (Package 1): card shelf, night order and
// character detail, following the Claude Design "Reference" screens.
//
// Characters, ability text, night reminders and jinxes all come from data the
// app already ships. Icons use the app's existing icon resolver (iconUrlFor);
// no new image source is introduced, and a character whose icon cannot load
// shows a clearly marked temporary monogram instead of a broken image.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "@/components/Modal";
import { iconUrlFor } from "@/data/iconUrl";
import type { RoleDef } from "@/stores/types";
import type { ReferenceCategory } from "../referenceCategories";
import { EDITION_LOGO, useLoadedArt } from "../art";
import {
  arcLetters,
  buildNightColumns,
  groupByTeam,
  jinxesOf,
  reminderLabels,
  teamOf,
  cleanReminder,
} from "./referenceData";

type Props = {
  category: ReferenceCategory;
  onClose: () => void;
};

type Tab = "characters" | "night";

/** Character icon with a marked temporary fallback when the image is unavailable. */
function RoleIcon({ role, className }: { role: RoleDef; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`${className} ref-icon-fallback`} data-temporary-art="true" aria-hidden="true">
        {role.name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={iconUrlFor(role)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function ReferenceOverlay({ category, onClose }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("characters");
  const [detail, setDetail] = useState<RoleDef | null>(null);
  useModalBehavior(dialogRef, layerRef, onClose, backRef);

  const logoSrc = EDITION_LOGO[category.id];
  const logoLoaded = useLoadedArt(logoSrc ? [logoSrc] : []);
  const hasNight = category.id !== "carousel";
  const groups = useMemo(() => groupByTeam(category.roles), [category]);
  const night = useMemo(() => (hasNight ? buildNightColumns(category.roles) : []), [category, hasNight]);
  const showNight = hasNight && tab === "night";
  // Each view starts at the top rather than inheriting the other view's scroll.
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [tab]);

  return createPortal(
    <div ref={layerRef} className="ref-layer">
      <div
        ref={dialogRef}
        className="ref-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Character reference: ${category.name}`}
        tabIndex={-1}
      >
        <div className="ref-photo" aria-hidden="true" />
        <div className="ref-veil" aria-hidden="true" />
        <header className="ref-head">
          <button ref={backRef} type="button" className="ref-back" onClick={onClose}>
            <span aria-hidden="true">‹</span>Home
          </button>
          <div className="ref-head-mid">
            {/* Official logo when installed locally; otherwise the design's own text fallback. */}
            <h2 className={logoSrc && logoLoaded.has(logoSrc) ? "ref-title ref-title-logo" : "ref-title"}>
              {logoSrc && logoLoaded.has(logoSrc) ? <img src={logoSrc} alt={category.name} draggable={false} /> : category.name}
            </h2>
            {hasNight && (
              <div className="ref-tabs" role="group" aria-label="Reference view">
                <button type="button" aria-pressed={tab === "characters"} onClick={() => setTab("characters")}>
                  Characters
                </button>
                <button type="button" aria-pressed={tab === "night"} onClick={() => setTab("night")}>
                  Night order
                </button>
              </div>
            )}
          </div>
          <span className="ref-count">{category.roles.length} characters</span>
        </header>

        <div ref={bodyRef} className="ref-body">
          {!showNight &&
            (
              <div className="ref-shelves">
                {groups.map((g) => (
                  <section key={g.type} className="ref-shelf" aria-label={g.label}>
                    <div className="ref-shelf-head">
                      <h3 style={{ color: g.color }}>{g.label}</h3>
                      <span className="ref-shelf-n">{g.roles.length}</span>
                      <span className="ref-shelf-rule" style={{ background: `linear-gradient(90deg, ${g.color}66, transparent)` }} />
                    </div>
                    <ul className="ref-cards">
                      {g.roles.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="ref-card" onClick={() => setDetail(r)}>
                            <span className="ref-card-bar" style={{ background: g.color }} />
                            <RoleIcon role={r} className="ref-card-icon" />
                            <span className="ref-card-name">{r.name}</span>
                            <span className="ref-card-ability">{r.ability}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          {showNight && (
            <div className="ref-night">
              {night.map((col) => (
                <section key={col.key} className="ref-night-col" aria-label={col.label}>
                  <div className="ref-night-head">
                    <h3>{col.label}</h3>
                    <span>{col.wakes} wake</span>
                  </div>
                  <ol className="ref-night-list">
                    {col.rows.map((row) => {
                      if (row.kind === "step") {
                        return (
                          <li key={row.id} className="ref-night-row ref-night-step">
                            <span className="ref-night-num" />
                            <span className="ref-night-ico">
                              <i className="ref-diamond" aria-hidden="true" />
                            </span>
                            <RowText name={row.name} text={row.text} />
                          </li>
                        );
                      }
                      return (
                        <li key={row.id}>
                          <button type="button" className="ref-night-row" onClick={() => setDetail(row.role)}>
                            <span className="ref-night-num">{row.num}</span>
                            <span className="ref-night-ico">
                              <RoleIcon role={row.role} className="ref-night-icon" />
                            </span>
                            <RowText name={row.role.name} text={row.text} />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </div>

        {detail && <ReferenceDetail role={detail} onClose={() => setDetail(null)} />}
      </div>
    </div>,
    document.body,
  );
}

function RowText({ name, text }: { name: string; text: string }): ReactNode {
  return (
    <span className="ref-night-text">
      <span className="ref-night-name">{name}</span>
      <span className="ref-night-desc">{text}</span>
    </span>
  );
}

function ReferenceDetail({ role, onClose }: { role: RoleDef; onClose: () => void }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalBehavior(dialogRef, layerRef, onClose, closeRef);

  const team = teamOf(role.type);
  const tokens = reminderLabels(role);
  const jinxes = useMemo(() => jinxesOf(role.id), [role.id]);
  const nights = [
    ["First night", role.firstNightReminder],
    ["Other nights", role.otherNightReminder],
  ].filter((n): n is [string, string] => !!n[1]);

  return (
    <div ref={layerRef} className="ref-detail-layer" onClick={onClose}>
      <div
        ref={dialogRef}
        className="ref-detail"
        role="dialog"
        aria-modal="true"
        aria-label={role.name}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="ref-detail-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <RoleIcon role={role} className="ref-detail-icon" />
        <div className="ref-detail-id">
          <span className="ref-detail-team" style={{ color: team?.color }}>
            {team?.kicker ?? role.type}
          </span>
          <h3 className="ref-detail-name">{role.name}</h3>
        </div>
        {role.ability && <p className="ref-detail-ability">{role.ability}</p>}
        {role.flavor && <p className="ref-detail-flavor">{role.flavor}</p>}
        {tokens.length > 0 && (
          <div className="ref-detail-sec ref-detail-sec-centre">
            <span className="ref-detail-label">Reminder tokens</span>
            <ul className="ref-tokens">
              {tokens.map((label) => {
                const { fs, letters } = arcLetters(label);
                return (
                  <li key={label} className="ref-token" aria-label={label}>
                    <span className="ref-token-ring" aria-hidden="true" />
                    <RoleIcon role={role} className="ref-token-icon" />
                    <span className="ref-token-arc" aria-hidden="true">
                      {letters.map((l, i) => (
                        <span
                          key={i}
                          style={{ fontSize: fs, transform: `rotate(${l.rot}deg) translateY(36px)` }}
                        >
                          {l.ch}
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {nights.map(([label, text]) => (
          <div key={label} className="ref-detail-sec">
            <span className="ref-detail-label">{label}</span>
            <p className="ref-detail-text">{cleanReminder(text)}</p>
          </div>
        ))}
        {jinxes.length > 0 && (
          <div className="ref-detail-sec">
            <span className="ref-detail-label">Jinxes</span>
            <ul className="ref-jinxes">
              {jinxes.map((j) => (
                <li key={j.id}>
                  {j.role ? <RoleIcon role={j.role} className="ref-jinx-icon" /> : <span className="ref-jinx-icon" />}
                  <span>
                    <span className="ref-jinx-name">{j.name}</span>
                    <span className="ref-jinx-reason">{j.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
