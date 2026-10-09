import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useShellLayout } from "./useShellLayout";

/**
 * Phase 10H (contract §§8.2, 9; I2; 10H-AC-016/018/063): the floating MODULAR
 * action card. Non-blocking by construction: no backdrop, no inert, no focus
 * trap, no scroll lock -- the Table stays fully operable (target choices are
 * made ON it). It is a non-modal dialog (role="dialog", aria-modal="false").
 *
 *  - Desktop: it floats over the stage's lower-left corner, sized to its
 *    content, never covering the whole Table.
 *  - Tablet / phone: it renders at the top of the ONE dock (the Night
 *    surface), so there is never a second, stacked sheet.
 *
 * Hide keeps the draft (the parent keeps it mounted with `hidden`), so tapping
 * the acting seat RESUMES it; Close discards it. Escape hides. Opening moves
 * focus to the card heading; hiding returns focus to where it came from.
 */
export const ACTION_CARD_STAGE_HOST = "action-card-stage-host";
export const ACTION_CARD_DOCK_HOST = "action-card-dock-host";

export function ActionCard({ title, subtitle, hidden = false, onHide, onClose, children, className = "", dockHostId }: {
  title: string;
  subtitle?: ReactNode;
  hidden?: boolean;
  /** Hide (keep the draft). Defaults to Close when not given. */
  onHide?: () => void;
  /** Close (discard the draft). */
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** A containing workflow can keep its controls in its own panel at every width. */
  dockHostId?: string;
}) {
  const shellLayout = useShellLayout();
  const layout = dockHostId ? "tablet" : shellLayout;
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  // undefined = not yet resolved (render nothing, so focus is never placed on
  // an element that is about to move into the host); null = render in place.
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  // The host is looked up after mount (it belongs to the shell); without one
  // (a standalone render) the card renders in place.
  useLayoutEffect(() => {
    // Docked layouts with no Night dock (a Day ability from the Inspector)
    // render the card in place -- inside the one dock -- never floating.
    setHost(document.getElementById(dockHostId ?? (layout === "desktop" ? ACTION_CARD_STAGE_HOST : ACTION_CARD_DOCK_HOST)));
  }, [layout, dockHostId]);
  const resolved = host !== undefined;
  useEffect(() => {
    if (!resolved) return;
    if (hidden) {
      const invoker = invokerRef.current;
      if (cardRef.current?.contains(document.activeElement) || document.activeElement === document.body) {
        if (invoker?.isConnected) invoker.focus({ preventScroll: true });
      }
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !cardRef.current?.contains(active)) invokerRef.current = active;
    headingRef.current?.focus({ preventScroll: true });
  }, [hidden, resolved]);
  // Closing (unmount) returns focus to the invoker when focus would otherwise
  // fall to the page (§9: focus returns predictably to the invoker).
  useEffect(() => () => {
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected || !!cardRef.current?.contains(active);
    const invoker = invokerRef.current;
    if (lost && invoker?.isConnected) requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) invoker.focus({ preventScroll: true });
    });
  }, []);
  const hide = onHide ?? onClose;
  const card = (
    <section ref={cardRef} className={`action-card ${className}`.trim()} role="dialog" aria-modal="false" aria-labelledby={titleId}
      hidden={hidden} data-layout={layout}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        hide();
      }}>
      <header className="action-card-header">
        <div className="action-card-titles">
          <h2 ref={headingRef} id={titleId} tabIndex={-1} className="action-card-title">{title}</h2>
          {subtitle && <div className="action-card-subtitle">{subtitle}</div>}
        </div>
        <div className="action-card-controls">
          {onHide && (layout === "desktop" || dockHostId
            ? <button type="button" className="btn btn-sm" onClick={onHide} aria-label="Hide the action card (keeps your choices)">Hide</button>
            // ASTRA-10H-002: in the one dock, Hide is the way back to the Night list.
            : <button type="button" className="btn btn-sm" onClick={onHide} aria-label="Back to the Night list (keeps your choices)">← Night list</button>)}
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>
      {children}
    </section>
  );
  if (!resolved) return null;
  return host ? createPortal(card, host) : card;
}
