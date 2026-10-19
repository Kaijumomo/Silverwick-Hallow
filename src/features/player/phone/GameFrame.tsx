import type { ReactNode } from "react";
import { PhoneFrame } from "./PhoneParts";
import { formatCode } from "./PhoneStates";

export type GameTab = "character" | "notes" | "town" | "script";

const TABS: ReadonlyArray<{ id: GameTab; label: string; path: string }> = [
  { id: "character", label: "Character", path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6.5 18.5c1.4-2 3.3-3 5.5-3s4.1 1 5.5 3" },
  { id: "notes", label: "Notes", path: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" },
  { id: "town", label: "Town", path: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { id: "script", label: "Script", path: "M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" },
];

/** The in-game phone frame (design: header, content, four-tab bar). The
 * header's right side is the game code while alive and the ghost pill once
 * dead; the player's own life is private to them and shown at Night as well. */
export function GameFrame({ eyebrow, name, code, ghost, tab, onTab, evil, overlay, children }: {
  /** "Day 2 · Seat 2". */
  eyebrow: string;
  name: string;
  code: string;
  /** Present once the player is dead. */
  ghost?: { label: string };
  tab: GameTab;
  onTab: (tab: GameTab) => void;
  evil?: boolean;
  /** Full-screen overlay (the veil); covers the header and the tab bar. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PhoneFrame dark {...(evil ? { evil: true } : {})} label="game">
      <div className="swp-game-head">
        <div className="swp-game-who">
          <span className="swp-game-eyebrow">{eyebrow}</span>
          <span className="swp-game-name">{name}</span>
        </div>
        {ghost
          ? <span className="swp-ghost-pill" role="status"><span className="swp-ghost-dot" aria-hidden="true" />{ghost.label}</span>
          : <span className="swp-game-code">{formatCode(code)}</span>}
      </div>
      <div className="swp-game-content">{children}</div>
      <nav className="swp-tabbar" aria-label="Player views">
        {TABS.map(({ id, label, path }) => (
          <button
            key={id}
            type="button"
            className={`swp-tab${tab === id ? " swp-tab-on" : ""}`}
            aria-pressed={tab === id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => onTab(id)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {overlay}
    </PhoneFrame>
  );
}
