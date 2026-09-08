import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement>;
};

/** Shared accessible modal shell for Storyteller dialogs and seat sheets. */
export function Modal({
  title,
  onClose,
  children,
  className = "",
  closeLabel = "Close",
  initialFocusRef,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusTarget = initialFocusRef?.current ?? dialog.querySelector<HTMLElement>(
      "[data-modal-initial-focus], button, input, textarea, select, [tabindex]:not([tabindex=\"-1\"])"
    );
    focusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex=\"-1\"]):not([aria-hidden=\"true\"])"
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      if (triggerRef.current && document.contains(triggerRef.current)) {
        triggerRef.current.focus();
      }
    };
  }, [initialFocusRef, onClose]);

  return (
    <div className="dialog-layer">
      <div className="dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={`dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button className="btn btn-sm dialog-close" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
