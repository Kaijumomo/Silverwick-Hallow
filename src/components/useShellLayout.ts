import { useMediaQuery } from "./useMediaQuery";

/**
 * Phase 10H (contract §5): the Storyteller shell's three layouts.
 *  - desktop: coordinated regions around a dominant Table;
 *  - tablet: ONE secondary dock at a time;
 *  - phone: the Table as locator, ONE bottom workspace at a time.
 * The same breakpoints as the CSS (760 / 1100).
 */
export type ShellLayout = "desktop" | "tablet" | "phone";

export function useShellLayout(): ShellLayout {
  const phone = useMediaQuery("(max-width: 760px)");
  const tablet = useMediaQuery("(max-width: 1100px)");
  return phone ? "phone" : tablet ? "tablet" : "desktop";
}
