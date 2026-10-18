import { formatCode } from "./PhoneStates";

/** "Request to leave?" bottom sheet (design: leave confirm / sending). Both
 * buttons are inert while the request is in flight. */
export function LeaveSheet({ code, seat, name, sending, onConfirm, onClose }: {
  code: string;
  seat: number | null;
  name: string;
  sending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const eyebrow = [formatCode(code), seat ? `Seat ${seat}` : null, name].filter(Boolean).join(" · ");
  return (
    <div className="swp-sheet-layer">
      <div className="swp-sheet-backdrop" onClick={sending ? undefined : onClose} />
      <div className="swp-sheet swp-leave-sheet" role="dialog" aria-modal="true" aria-label="Request to leave?">
        <div className="swp-rule" aria-hidden="true"><span className="swp-rule-line" /><span className="swp-rule-gem" /><span className="swp-rule-line" /></div>
        <span className="swp-sheet-eyebrow swp-leave-eyebrow">{eyebrow}</span>
        <h2 className="swp-leave-title">Request to leave?</h2>
        <p className="swp-fell swp-leave-body">You will remain seated in the game until the Storyteller accepts your request.</p>
        <button type="button" className="swp-danger" onClick={onConfirm} disabled={sending} aria-busy={sending}>
          {sending ? (<><span className="swp-dot" aria-hidden="true" />Sending…</>) : "Request to leave"}
        </button>
        <button type="button" className="swp-cancel" onClick={onClose} disabled={sending} style={sending ? { opacity: .4 } : undefined}>Cancel</button>
      </div>
    </div>
  );
}
