import { useRef } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { GoldButton } from "./PhoneParts";
import type { RevealTone } from "./RevealScreen";

/** "The veil has fallen" (design: death overlay). Shown once, the first time
 * the player is dead; "Continue as a ghost" dismisses it. It covers the whole
 * phone surface, so it renders as the frame's overlay. */
export function DeathVeil({ art, tone, vote, onContinue }: { art: string; tone: RevealTone; /** Whether a ghost vote is still available. */ vote: boolean; onContinue: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onContinue);
  return (
    <div ref={ref} tabIndex={-1} className="swp-veil" role="dialog" aria-modal="true" aria-label="The veil has fallen">
      <div className="swp-veil-drop" aria-hidden="true" />
      <div className="swp-veil-body">
        <span className={`swp-veil-token swp-tone-${tone}`} aria-hidden="true">
          <span className="swp-token-face-ring" style={{ inset: 6 }} />
          <span className="swp-token-art" style={{ backgroundImage: `url(${art})` }} />
          <span className="swp-token-veil" />
        </span>
        <h1 className="swp-veil-title">The veil has fallen</h1>
        <p className="swp-veil-text">{vote ? "You have died. You may still speak, and you keep one ghost vote." : "You have died. You may still speak."}</p>
        <div className="swp-veil-cta"><GoldButton full onClick={onContinue}>Continue as a ghost</GoldButton></div>
      </div>
    </div>
  );
}
