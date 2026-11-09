import { useV6Ui } from "../v6Store";

/**
 * The board chooses a target on pointerup, and the picker can open under the same finger. The browser's
 * following compatibility click must not pick the token that appeared there: until a new pointer gesture
 * starts, pointer clicks are swallowed. Keyboard activation (detail 0) is always deliberate.
 */
export function guardGesture() {
  let armed = false;
  const arm = () => { armed = true; };
  const swallow = (event: MouseEvent) => { if (!armed && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } };
  window.addEventListener("pointerdown", arm, true);
  window.addEventListener("click", swallow, true);
  const stop = useV6Ui.subscribe((state) => {
    if (state.picker?.mode === "show" && state.picker.onPick) return;
    window.removeEventListener("pointerdown", arm, true);
    window.removeEventListener("click", swallow, true);
    stop();
  });
}

