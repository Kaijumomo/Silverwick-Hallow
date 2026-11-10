import { useEffect, useLayoutEffect } from "react";

/* iPhones, above all the installed Home Screen app, can leave the page panned after the on-screen keyboard
   closes (the name and game code on Join, the Script search in game). The next screens then draw shifted up,
   with an empty band under the tab bar, until the player scrolls. The phone shell never scrolls the page
   itself: it is exactly one screen tall and every list scrolls inside it. So any page offset while no text
   field is being edited is leftover, and is put back to the top. */

const NOT_TEXT = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);
/** Settle again once the keyboard has finished closing (it animates for about a quarter of a second). */
const SETTLE_AFTER_MS = [60, 350, 800] as const;

function editingText(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NOT_TEXT.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Puts the page back at the top unless the player is typing or has pinch-zoomed in. */
export function settlePhoneViewport(): void {
  if (typeof window === "undefined" || editingText()) return;
  if ((window.visualViewport?.scale ?? 1) > 1.01) return;
  window.scrollTo(0, 0);
}

/** Keeps the phone shell at the top of the screen: on every screen change, and after the keyboard closes. */
export function usePhoneViewportSettle(screen: string | undefined): void {
  useLayoutEffect(() => {
    settlePhoneViewport();
    const frame = requestAnimationFrame(settlePhoneViewport);
    const timers = SETTLE_AFTER_MS.map((ms) => window.setTimeout(settlePhoneViewport, ms));
    return () => { cancelAnimationFrame(frame); timers.forEach((t) => window.clearTimeout(t)); };
  }, [screen]);

  useEffect(() => {
    const timers = new Set<number>();
    const settleSoon = () => {
      for (const ms of SETTLE_AFTER_MS) {
        const t = window.setTimeout(() => { timers.delete(t); settlePhoneViewport(); }, ms);
        timers.add(t);
      }
    };
    const vv = window.visualViewport;
    document.addEventListener("focusout", settleSoon);
    vv?.addEventListener("resize", settleSoon);
    window.addEventListener("orientationchange", settleSoon);
    window.addEventListener("pageshow", settleSoon);
    return () => {
      document.removeEventListener("focusout", settleSoon);
      vv?.removeEventListener("resize", settleSoon);
      window.removeEventListener("orientationchange", settleSoon);
      window.removeEventListener("pageshow", settleSoon);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
}
