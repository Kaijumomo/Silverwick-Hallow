import type { ReactNode } from "react";
import "./choice.css";

/**
 * PO design direction 2026-11-19: the parts of a choice the Storyteller taps on the board (the Barber's Night card is the
 * reference; the Klutz's card uses the same parts). Presentation only: every action is the caller's.
 */

/** The prompt line: the pulsing dot, the serif text, and an optional quiet action on the right. */
export function ChoicePrompt({ text, action, long = false, quiet = false }: { text: string; action?: ReactNode; long?: boolean; quiet?: boolean }) {
  return <div className={["gv-choice-prompt", long ? "is-long" : "", quiet ? "is-quiet" : ""].filter(Boolean).join(" ")}>
    <p className="gv-choice-prompt-text">{text}</p>
    {action}
  </div>;
}

export type ChoiceSlotProps = {
  /** The player's name once chosen; otherwise the slot's own label ("Player 1"). */
  label: string;
  sub: string;
  /** Token art of the chosen player's character; absent while the slot waits. */
  img?: string;
  filled: boolean;
  /** How an empty slot draws its token: a dashed ring (the Barber's) or a blank token (the Klutz's). */
  empty?: "ring" | "blank";
};

/** One player to tap: a dashed slot until filled, then the player's token, name and a short line. */
export function ChoiceSlot({ label, sub, img, filled, empty = "ring" }: ChoiceSlotProps) {
  const token = filled && img ? "is-art" : filled ? "is-blank" : empty === "ring" ? "is-ring" : "is-blank";
  return <div className={`gv-choice-slot${filled ? " is-filled" : ""}`} data-filled={filled || undefined}>
    <span className={`gv-choice-token ${token}`} aria-hidden="true">
      {filled && img && <span className="gv-choice-token-art" style={{ backgroundImage: `url(${img})` }} />}
    </span>
    <span className="gv-choice-slot-text">
      <span className="gv-choice-slot-label">{label}</span>
      <span className="gv-choice-slot-sub">{sub}</span>
    </span>
  </div>;
}

/** The ⇄ between two slots. */
export function ChoiceSwapIcon() {
  return <svg className="gv-choice-swap" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h15M15 5l4 4-4 4M20 15H5M9 11l-4 4 4 4" /></svg>;
}
