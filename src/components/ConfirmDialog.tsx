import { useRef, type ReactNode } from "react";
import { Modal } from "./Modal";

/**
 * Phase 10H (contract §9): a TRUE confirmation -- the one place a modal is
 * right. Replaces window.confirm so the question is styled, keyboard-safe and
 * names exactly what will happen ("Remove Alice", never "OK"). Initial focus
 * lands on Cancel for a destructive action.
 */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Cancel", danger = false, busy = false, onConfirm, onCancel }: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal title={title} onClose={onCancel} className="confirm-dialog" initialFocusRef={danger ? cancelRef : confirmRef}>
      <div className="confirm-dialog-body">{children}</div>
      {/* 10H-AC-067: while the confirmed action commits, say so in words. */}
      {busy && <p className="disabled-reason" role="status">Working…</p>}
      <div className="confirm-dialog-actions">
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button ref={confirmRef} type="button" className={`btn ${danger ? "btn-danger" : "btn-gold"}`} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
