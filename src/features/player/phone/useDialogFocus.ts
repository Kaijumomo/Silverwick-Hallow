import { useEffect, type RefObject } from "react";

/** Moves focus into a dialog when it opens, closes it on Escape and returns
 * focus to where it was. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    const before = document.activeElement as HTMLElement | null;
    const first = node.querySelector<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']");
    (first ?? node).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    node.addEventListener("keydown", onKey);
    return () => { node.removeEventListener("keydown", onKey); before?.focus?.({ preventScroll: true }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
