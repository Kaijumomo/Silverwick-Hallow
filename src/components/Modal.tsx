import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

type ModalEntry = { layer: HTMLElement; dialog: HTMLElement };
const modalStack: ModalEntry[] = [];
let isolated: { element: HTMLElement; inert: string | null }[] = [];
let bodyOverflow = "";

function refreshIsolation() {
  for (const { element, inert } of isolated) {
    if (inert === null) element.removeAttribute("inert");
    else element.setAttribute("inert", inert);
  }
  isolated = [];
  let branch: HTMLElement | null = modalStack.at(-1)?.layer ?? null;
  while (branch && branch !== document.body) {
    for (const sibling of Array.from(branch.parentElement?.children ?? [])) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      isolated.push({ element: sibling, inert: sibling.getAttribute("inert") });
      sibling.setAttribute("inert", "");
    }
    branch = branch.parentElement;
  }
}

function isAvailable(element: HTMLElement) {
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const summary = Array.from(ancestor.children).find(child => child.tagName === "SUMMARY");
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

function focusableControls(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    "button, input:not([type='hidden']), textarea, select, a[href], summary, [tabindex], [contenteditable='true']"
  )).filter(element => !element.matches(":disabled") && element.tabIndex >= 0 && isAvailable(element));
}

/** One focus/isolation contract shared by dialogs and the player drawer. */
export function useModalBehavior(
  dialogRef: RefObject<HTMLElement>,
  layerRef: RefObject<HTMLElement>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement>,
  returnFocusRef?: RefObject<HTMLElement>,
) {
  const closeRef = useRef(onClose);
  const initialRef = useRef(initialFocusRef);
  const returnRef = useRef(returnFocusRef);
  closeRef.current = onClose;
  initialRef.current = initialFocusRef;
  returnRef.current = returnFocusRef;

  useEffect(() => {
    const dialog = dialogRef.current;
    const layer = layerRef.current;
    if (!dialog || !layer) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = { dialog, layer };
    if (modalStack.length === 0) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    // Child effects mount before their parents; a nested dialog must stay on top.
    const childIndex = modalStack.findIndex(item => layer.contains(item.layer));
    if (childIndex < 0) modalStack.push(entry);
    else modalStack.splice(childIndex, 0, entry);
    refreshIsolation();

    const focusFirst = () => {
      const requested = initialRef.current?.current ?? dialog.querySelector<HTMLElement>("[data-modal-initial-focus]");
      const target = requested && isAvailable(requested) && !requested.matches(":disabled")
        ? requested : focusableControls(dialog)[0] ?? dialog;
      target.focus({ preventScroll: true });
    };
    if (modalStack.at(-1) === entry) focusFirst();
    const onFocusIn = (event: FocusEvent) => {
      if (modalStack.at(-1) === entry && !dialog.contains(event.target as Node)) focusFirst();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== entry) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const controls = focusableControls(dialog);
        const first = controls[0] ?? dialog;
        const last = controls.at(-1) ?? dialog;
        const current = document.activeElement;
        if (!controls.length || !dialog.contains(current) || current === dialog ||
          (event.shiftKey ? current === first : current === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const wasTop = modalStack.at(-1) === entry;
      modalStack.splice(modalStack.indexOf(entry), 1);
      refreshIsolation();
      if (!modalStack.length) document.body.style.overflow = bodyOverflow;
      const returnTarget = trigger !== document.body && trigger?.isConnected && isAvailable(trigger)
        ? trigger : returnRef.current?.current;
      if (wasTop && returnTarget?.isConnected && isAvailable(returnTarget)) returnTarget.focus({ preventScroll: true });
      else if (wasTop) {
        const remaining = modalStack.at(-1)?.dialog;
        if (remaining) (focusableControls(remaining)[0] ?? remaining).focus({ preventScroll: true });
      }
    };
  }, [dialogRef, layerRef]);

  // Privacy mode or a completed action can remove the currently focused control.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && modalStack.at(-1)?.dialog === dialog && !dialog.contains(document.activeElement)) {
      (focusableControls(dialog)[0] ?? dialog).focus({ preventScroll: true });
    }
  });
}

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  returnFocusRef?: RefObject<HTMLElement>;
};

/** Shared accessible modal shell for Storyteller dialogs and seat sheets. */
export function Modal({ title, onClose, children, className = "", closeLabel = "Close", initialFocusRef, returnFocusRef }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useModalBehavior(dialogRef, layerRef, onClose, initialFocusRef, returnFocusRef);

  return (
    <div ref={layerRef} className="dialog-layer">
      <div className="dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} className={`dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="dialog-header">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button className="btn btn-sm dialog-close" onClick={onClose} aria-label={closeLabel}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}
