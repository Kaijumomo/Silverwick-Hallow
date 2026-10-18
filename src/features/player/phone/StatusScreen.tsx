import type { ReactNode } from "react";
import { DiamondRule, GoldButton, OutlineButton, PhoneFrame } from "./PhoneParts";

export type StatusAction = { label: string; onClick: () => void; disabled?: boolean };

export type StatusTone = "neutral" | "warm" | "error" | "seal" | "good" | "evil";

const GLOW: Record<StatusTone, string | undefined> = {
  neutral: undefined,
  warm: "rgba(232, 168, 88, .2)",
  error: "rgba(200, 80, 70, .16)",
  seal: "rgba(200, 60, 55, .2)",
  good: "rgba(134, 183, 212, .3)",
  evil: "rgba(200, 60, 55, .32)",
};

/** Shared full-screen status layout (design: "Shared status-screen layout").
 * It replaces the whole phone UI, so nothing private can render behind it. */
export function StatusScreen({ tone = "neutral", reserve, link, big, emblem, eyebrow, title, body, message, primary, secondary, children, label }: {
  tone?: StatusTone;
  /** Height (px) of the band the design reserves for its review-only
   * "Simulate" links, so centred content sits where the mockup puts it. */
  reserve?: number;
  /** A discreet text link under the actions (e.g. Connection Settings). */
  link?: { label: string; onClick: () => void };
  /** Result style (Game ended with a winner): rule + large Cinzel title. */
  big?: boolean;
  emblem?: ReactNode;
  eyebrow: string;
  title: string;
  body?: string;
  /** Rendered verbatim in the red alert box (the store's own message). */
  message?: string | null;
  primary?: StatusAction;
  secondary?: StatusAction;
  /** Extra content under the message (e.g. the town-notes review). */
  children?: ReactNode;
  label: string;
}) {
  return (
    <PhoneFrame dark glow="status" glowColor={GLOW[tone]} label={label}>
      <div className="swp-page">
        <div className="swp-status-scroll">
          <div className="swp-status" role={message ? "alert" : "status"} aria-live={message ? undefined : "polite"}>
            {emblem}
            {big && <DiamondRule className="swp-status-rule" />}
            <span className="swp-eyebrow">{eyebrow}</span>
            {big
              ? <h1 className={`swp-status-big swp-status-big-${tone}`}>{title}</h1>
              : <h1 className="swp-title swp-status-title">{title}</h1>}
            {body && <p className="swp-status-body">{body}</p>}
            {message && <div className="swp-status-msg"><p>{message}</p></div>}
            {children}
          </div>
        </div>
        {(primary || secondary) && (
          <div className="swp-actions">
            {primary && <GoldButton full onClick={primary.onClick} disabled={primary.disabled}>{primary.label}</GoldButton>}
            {secondary && <OutlineButton onClick={secondary.onClick} disabled={secondary.disabled}>{secondary.label}</OutlineButton>}
          </div>
        )}
        {link && <div className="swp-linkrow"><button type="button" className="swp-textlink" onClick={link.onClick}>{link.label}</button></div>}
        {reserve ? <div className="swp-actions-spacer" style={{ height: reserve }} aria-hidden="true" /> : null}
      </div>
    </PhoneFrame>
  );
}
