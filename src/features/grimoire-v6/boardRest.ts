import { useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties } from "react";

/**
 * Stops drawing the board while a solid full-screen scene (the Reveal or the victory scene) covers all of it.
 *
 * The board is the heaviest thing the browser paints. On a tablet-sized graphics-memory allowance Chrome could not
 * also paint a Reveal or the victory scene on top of it and left parts of them blank (reproduced in Chromium with
 * --force-gpu-mem-available-mb; docs/ai/design/TABLET_RENDER_BUDGET.md). Both scenes are opaque and sit above
 * everything on the board, so once a scene has finished fading in the board cannot be seen. It is then hidden with
 * visibility, which keeps its layout, state and animations as they are, and shown again in the frame the scene closes.
 * Without the fade-in (no animationend) the board simply stays drawn.
 * Both scenes carry will-change: transform so they keep their own layer when the board under them disappears;
 * otherwise Chrome folds them back into the page and repaints them, which showed as a black frame on a small allowance.
 *
 * A hidden button loses keyboard focus, so the focus a scene was opened from is given back when it closes, unless
 * focus moved into the scene meanwhile (closing from there leaves focus on the page, as before).
 */
export function useBoardRest(revealOpen: boolean, winOpen: boolean) {
  const [settled, setSettled] = useState({ reveal: false, win: false });
  if ((settled.reveal && !revealOpen) || (settled.win && !winOpen)) setSettled({ reveal: settled.reveal && revealOpen, win: settled.win && winOpen });
  const rest = (revealOpen && settled.reveal) || (winOpen && settled.win);
  const focus = useRef<HTMLElement | null>(null);

  const settle = (scene: "reveal" | "win") => (event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.animationName !== "swRise") return;
    if (!rest) {
      const active = document.activeElement;
      focus.current = active instanceof HTMLElement && active !== document.body && !event.currentTarget.contains(active) ? active : null;
    }
    setSettled((current) => ({ ...current, [scene]: true }));
  };

  useLayoutEffect(() => {
    if (!rest) return;
    const moved = (event: FocusEvent) => { if (event.target !== document.body) focus.current = null; };
    document.addEventListener("focusin", moved);
    return () => document.removeEventListener("focusin", moved);
  }, [rest]);
  useLayoutEffect(() => {
    if (rest) return;
    const target = focus.current;
    focus.current = null;
    if (target?.isConnected && (!document.activeElement || document.activeElement === document.body)) target.focus({ preventScroll: true });
  }, [rest]);

  return { boardStyle: (style: CSSProperties): CSSProperties => (rest ? { ...style, visibility: "hidden" } : style), settleReveal: settle("reveal"), settleWin: settle("win") };
}
