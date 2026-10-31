import { useEffect, useState, type CSSProperties } from "react";
import { EmptySeat, PublicSeat } from "./PublicSeat";
import { QrCode } from "./QrCode";
import { crescentRadius, plateMaxWidth, seatPoints, seatSizeFor, STAGE_HEIGHT, STAGE_WIDTH, TABLE_CX, TABLE_CY, SEAT_LIFT } from "./townSquareGeometry";
import type { TownSquareView } from "./townSquareModel";
import "./townSquare.css";

// Package 4G: the Town Square Display stage (v5 prototype). Presentational:
// it renders a TownSquareView and nothing else, so every scene can be shown
// from explicit input.

/** The scale that fits the fixed stage inside the window, letterboxed. */
export function useStageScale(): number {
  const [k, setK] = useState(1);
  useEffect(() => {
    const fit = () => {
      const el = document.documentElement;
      const w = el.clientWidth || window.innerWidth;
      const h = el.clientHeight || window.innerHeight;
      const next = Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT);
      if (next > 0) setK(next);
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(document.documentElement);
    return () => { window.removeEventListener("resize", fit); ro?.disconnect(); };
  }, []);
  return k;
}

// Deterministic star field (the prototype's), so the sky is the same every load.
const STARS = Array.from({ length: 26 }, (_, i) => {
  const r = Math.sin(i * 91.7) * 10000;
  const f = r - Math.floor(r);
  const g = Math.sin(i * 37.3) * 10000;
  const h = g - Math.floor(g);
  return { x: Math.round(380 + f * 1500), y: Math.round(40 + h * 420), r: i % 5 === 0 ? 3 : 2, d: (3 + (i % 4) * 1.3).toFixed(1), dl: (h * 4).toFixed(1) };
});

const LAMPS = [
  { x: 18, y: 952, s: 140, d: 3.1, dl: 0 },
  { x: 1784, y: 992, s: 140, d: 3.7, dl: 0.6 },
  { x: 368, y: 999, s: 90, d: 2.6, dl: 0.3 },
  { x: 681, y: 1037, s: 80, d: 4.2, dl: 1.1 },
  { x: 1484, y: 1028, s: 80, d: 3.4, dl: 0.9 },
];

const star4 = (x: number, y: number, r: number) => `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
const CRESCENT_STARS = [0, 90, 180, 270].map((deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return star4(100 + 96 * Math.cos(a), 100 + 96 * Math.sin(a), 2.6);
});

type Props = {
  view: TownSquareView;
  /** Stage scale; defaults to fitting the window. */
  scale?: number;
  /** false pauses the ambient background motion (still frames, tests). */
  motion?: boolean;
  showSeatNumbers?: boolean;
};

export function TownSquare({ view, scale, motion = true, showSeatNumbers = true }: Props) {
  const fitted = useStageScale();
  const k = scale ?? fitted;
  const { disc, name } = seatSizeFor(view.layoutCount);
  const cap = plateMaxWidth(view.layoutCount);
  const points = seatPoints(view.seatCount);
  const dr = crescentRadius(view.layoutCount);
  const waiting = view.mode === "waiting";

  return (
    <div className="ts-viewport" data-testid="town-square">
      <div
        className="ts-stage"
        data-screen-label="Town Square"
        data-tone={view.tone}
        data-mode={view.mode}
        data-motion={motion ? "running" : "paused"}
        style={{ "--ts-k": k } as CSSProperties}
      >
        <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
          <defs>
            <radialGradient id="tsVoid" cx=".5" cy=".2" r=".7"><stop offset="0" stopColor="#1b1320" /><stop offset="1" stopColor="#060407" /></radialGradient>
          </defs>
        </svg>

        <div className="ts-pan">
          <div className="ts-art" />
          <div className="ts-moon" />
          <div className="ts-lamps">
            {LAMPS.map((l) => (
              <div
                key={l.x}
                className="ts-lamp"
                style={{ left: l.x, top: l.y, width: l.s, height: l.s, margin: `${-l.s / 2}px 0 0 ${-l.s / 2}px`, "--ts-flicker": `${l.d}s`, "--ts-delay": `${l.dl}s` } as CSSProperties}
              />
            ))}
          </div>
          <div className="ts-stars">
            {STARS.map((s, i) => (
              <span key={i} className="ts-star" style={{ left: s.x, top: s.y, width: s.r, height: s.r, "--ts-twinkle": `${s.d}s`, "--ts-delay": `${s.dl}s` } as CSSProperties} />
            ))}
          </div>
        </div>
        <div className="ts-fog" />
        <div className="ts-tint" />
        <div className="ts-vignette" />

        <div className="ts-header">
          <div className="ts-brand">
            <span className="ts-brand-name">Silverwick Hollow</span>
            {view.scriptName && <span className="ts-brand-script">{view.scriptName}</span>}
          </div>
          {view.glow.length > 0 && (
            <div className="ts-glow-ring">
              {view.glow.map((g) => (
                <div key={`${g.kind}-${g.id}`} className="ts-glow-item" data-kind={g.kind} title={g.name}>
                  <div className="ts-glow-text">
                    <span className="ts-glow-kind">{g.kind === "fabled" ? "Fabled" : "Loric"}</span>
                    <span className="ts-glow-name">{g.name}</span>
                  </div>
                  <div className="ts-glow-token">
                    <div className="ts-art-img" role="img" aria-label={g.name} style={{ backgroundImage: `url(${g.src})` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {view.seats.map((seat) => {
          const p = points[seat.index];
          if (!p) return null;
          return seat.kind === "empty"
            ? <EmptySeat key={`empty-${seat.index}`} index={seat.index} roman={seat.roman} size={disc} nameSize={name} plateMax={cap} x={p.x} y={p.y} />
            : <PublicSeat key={seat.player.id} player={seat.player} size={disc} nameSize={name} plateMax={cap} x={p.x} y={p.y} showSeatNumber={showSeatNumbers} />;
        })}

        <div className="ts-crescent" aria-hidden="true" style={{ left: TABLE_CX - dr, top: TABLE_CY - SEAT_LIFT - dr, width: dr * 2, height: dr * 2 }}>
          <div className="ts-crescent-glow" />
          <svg viewBox="0 0 200 200" width="100%" height="100%">
            <defs>
              <linearGradient id="tsMoonG" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stopColor="#fbfcfe" /><stop offset=".5" stopColor="#e3e8f1" /><stop offset="1" stopColor="#aeb8cb" /></linearGradient>
              <linearGradient id="tsSunG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff0c2" /><stop offset=".5" stopColor="#f2c46a" /><stop offset="1" stopColor="#c98a36" /></linearGradient>
              <radialGradient id="tsMoonD" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="rgba(14,20,36,.6)" /><stop offset=".8" stopColor="rgba(40,52,82,.45)" /><stop offset="1" stopColor="rgba(190,205,240,.5)" /></radialGradient>
              <radialGradient id="tsSunD" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="rgba(60,36,14,.6)" /><stop offset=".8" stopColor="rgba(120,74,28,.45)" /><stop offset="1" stopColor="rgba(240,180,90,.55)" /></radialGradient>
            </defs>
            <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(214,222,236,.16)" strokeWidth=".4" />
            {CRESCENT_STARS.map((d, i) => <path key={i} d={d} fill="rgba(226,231,240,.55)" />)}
            <g>
              <g className="ts-sun">
                <circle cx="100" cy="100" r="88" fill="url(#tsSunD)" />
                <g className="ts-sun-rim"><circle cx="100" cy="100" r="89" fill="none" stroke="url(#tsSunG)" strokeWidth="4.5" /><circle cx="100" cy="100" r="82" fill="none" stroke="rgba(255,226,160,.35)" strokeWidth=".5" /></g>
              </g>
              <g className="ts-moon-ring">
                <circle cx="100" cy="100" r="88" fill="url(#tsMoonD)" />
                <circle cx="100" cy="100" r="89" fill="none" stroke="url(#tsMoonG)" strokeWidth="4.5" />
                <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(225,232,244,.35)" strokeWidth=".5" />
              </g>
            </g>
          </svg>
        </div>

        <div className="ts-centre" style={{ left: TABLE_CX, top: TABLE_CY - SEAT_LIFT }}>
          <div className="ts-eyebrow">{view.eyebrow}</div>
          {waiting && view.join && (
            <div className="ts-qr"><QrCode text={view.join.url} label={`Join ${view.join.code} on your phone`} /></div>
          )}
          <div className="ts-title" style={{ fontSize: Math.round(dr * (view.compactTitle ? 0.16 : 0.2)) }}>{view.title}</div>
          <div className="ts-sub" style={{ maxWidth: Math.round(dr * 1.3) }}>{view.sub}</div>
        </div>

        {view.reconnecting && (
          <div className="ts-reconnect" role="status">
            <span className="ts-reconnect-dot" />
            <span className="ts-reconnect-title">Reconnecting to the Storyteller…</span>
            <span className="ts-reconnect-sub">Showing the last update</span>
          </div>
        )}
      </div>
    </div>
  );
}
