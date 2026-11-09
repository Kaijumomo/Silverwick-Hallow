import type { CSSProperties, ReactNode } from "react";

/** The phone surface every player screen sits on (design: "Global frame").
 * `dark` and `evil` add the in-game and evil-team washes; `glow` picks the
 * candle glow behind join screens or a status tone behind status screens. */
export function PhoneFrame({ dark, evil, reference, glow, glowColor, children, label }: {
  dark?: boolean;
  /** Character Reference backdrop. */
  reference?: boolean;
  evil?: boolean;
  glow?: "join" | "status" | "fb";
  glowColor?: string;
  label?: string;
  children: ReactNode;
}) {
  const glowStyle = glowColor ? ({ "--swp-glow": glowColor } as CSSProperties) : undefined;
  return (
    <div className="swp-root" data-screen={label}>
      <img className="swp-bg" src="/bg/BackgroundMenuPhone.png" alt="" />
      <div className="swp-wash" />
      {dark && <div className="swp-wash-dark" />}
      {evil && <div className="swp-wash-evil" />}
      {reference && <div className="swp-wash-ref" />}
      <div className="swp-topgap" aria-hidden="true" />
      {glow === "join" && <div className="swp-glow swp-glow-join" aria-hidden="true" />}
      {glow === "status" && <div className="swp-glow swp-glow-status" style={glowStyle} aria-hidden="true" />}
      {glow === "fb" && <div className="swp-glow swp-glow-fb" aria-hidden="true" />}
      {children}
    </div>
  );
}

export function DiamondRule({ className }: { className?: string }) {
  return (
    <div className={`swp-rule${className ? ` ${className}` : ""}`} aria-hidden="true">
      <span className="swp-rule-line" /><span className="swp-rule-gem" /><span className="swp-rule-line" />
    </div>
  );
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="swp-back" onClick={onClick}>
      <span className="swp-back-chev" aria-hidden="true">‹</span>{label}
    </button>
  );
}

export function GoldButton({ children, onClick, disabled, full, className, type = "button" }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const cls = ["swp-gold", full ? "swp-gold-full" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function OutlineButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className="swp-outline" onClick={onClick} disabled={disabled}>{children}</button>;
}

/** "seat ring" emblem point on a circle, seat 1 at the top, clockwise. */
export function ringPoint(index: number, count: number, box: number, radius: number): { x: number; y: number } {
  const a = ((-90 + (index * 360) / count) * Math.PI) / 180;
  return { x: Math.round(box / 2 + radius * Math.cos(a)), y: Math.round(box / 2 + radius * Math.sin(a)) };
}

export type MoonProps = {
  /** lit = in progress; eclipsed = failed or stopped. */
  lit: boolean;
  tone?: "neutral" | "error";
  /** Seconds per revolution of the dashed ring; 0 = static. */
  spin: number;
  /** Shade offset (%): 26 normal crescent, 44 waning (Ending). */
  shade?: number;
};

export function MoonEmblem({ lit, tone = "neutral", spin, shade = 26 }: MoonProps) {
  const style = { "--swp-spin": `${spin || 16}s`, "--swp-shade": `${shade}%` } as CSSProperties;
  const ringStyle: CSSProperties = spin ? {} : { animation: "none" };
  return (
    <div className={`swp-emblem ${lit ? "swp-moon-lit-state" : "swp-moon-eclipsed"}`} style={style} aria-hidden="true">
      <div className={`swp-moon-ring${tone === "error" ? " swp-moon-ring-err" : ""}`} style={ringStyle} />
      <div className="swp-moon-halo" />
      <div className="swp-moon-disc">
        <span className="swp-moon-grain" />
        <span className="swp-moon-inner" />
        <span className="swp-moon-star" style={{ left: "24%", top: "30%", width: 3, height: 3 }} />
        <span className="swp-moon-star" style={{ left: "72%", top: "26%", width: 4, height: 4 }} />
        <span className="swp-moon-star" style={{ left: "68%", top: "70%", width: 3, height: 3 }} />
        <span className="swp-moon-crescent">
          <span className="swp-moon-lit" />
          <span className="swp-moon-shade" />
        </span>
      </div>
      {lit && <div className="swp-moon-flame" />}
    </div>
  );
}

const TORN_LEFT = "polygon(0 0, 52% 0, 47% 14%, 55% 28%, 46% 42%, 54% 56%, 45% 70%, 53% 84%, 49% 100%, 0 100%)";
const TORN_RIGHT = "polygon(52% 0, 100% 0, 100% 100%, 49% 100%, 53% 84%, 45% 70%, 54% 56%, 46% 42%, 55% 28%, 47% 14%)";

function SealToken({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="swp-seal-token">
      <span className="swp-seal-ring" />
      <span className="swp-seal-ribbon">{sub}</span>
      <span className="swp-seal-plate">
        <span className="swp-seal-plate-eyebrow">Player</span>
        <span className="swp-seal-plate-name">{name}</span>
      </span>
    </div>
  );
}

/** Parchment player token: stamped when rejected, torn in two when revoked. */
export function SealEmblem({ name, torn, sub }: { name: string; torn?: boolean; sub: string }) {
  return (
    <div className={`swp-emblem${torn ? " swp-seal-torn" : ""}`} aria-hidden="true">
      <div className="swp-seal-glow" />
      <div className="swp-seal-half" style={torn ? { clipPath: TORN_LEFT, transform: "translate(-8px, 4px) rotate(-8deg)" } : undefined}>
        <SealToken name={name} sub={sub} />
      </div>
      {torn && (
        <div className="swp-seal-half" style={{ clipPath: TORN_RIGHT, transform: "translate(8px, -3px) rotate(7deg)" }}>
          <SealToken name={name} sub={sub} />
        </div>
      )}
      {!torn && <div className="swp-stamp"><span className="swp-stamp-bar" /></div>}
    </div>
  );
}

/** 12-seat (or actual-count) ring with the player's own seat lit. */
export function SeatRingEmblem({ seatNumber, seatCount }: { seatNumber: number; seatCount: number }) {
  const count = Math.max(seatCount, 1);
  const own = Math.max(0, Math.min(count - 1, seatNumber - 1));
  return (
    <div className="swp-emblem" aria-hidden="true">
      <div className="swp-seatring-core" />
      <div className="swp-seatring-label">
        <span className="swp-seatring-word">Seat</span>
        <span className="swp-seatring-num">{seatNumber}</span>
      </div>
      {Array.from({ length: count }, (_, i) => {
        const me = i === own;
        const size = me ? 24 : 12;
        const p = ringPoint(i, count, 160, 66);
        return (
          <span
            key={i}
            className={`swp-seatring-seat${me ? " swp-seatring-seat-me" : ""}`}
            style={{ left: p.x, top: p.y, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
          />
        );
      })}
    </div>
  );
}
