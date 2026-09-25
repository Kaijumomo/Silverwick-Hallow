import { useEffect, useRef, useState } from "react";
import { usePrivacyStore } from "@/stores/privacyStore";

/**
 * Phase 10A (10A-ASTRA-003): every Life Event-bearing dialog is private
 * Storyteller UI and must never stay logically open under Privacy Mode.
 *
 * Returns true when the dialog must render nothing. Once Privacy Mode has
 * been seen -- at mount or at any later point -- the dialog:
 *  1. asks its parent to close it (`onClose`, from an effect -- never during
 *     render), and
 *  2. stays suppressed for the rest of this mount, even if Privacy Mode is
 *     later disabled or the parent ignores the close request.
 *
 * So disabling Privacy Mode can never automatically reveal stale private
 * event content; the Storyteller must explicitly open the dialog again.
 */
export function usePrivateDialog(onClose: () => void): boolean {
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const [closedForPrivacy, setClosedForPrivacy] = useState(privacyMode);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!privacyMode) return;
    setClosedForPrivacy(true);
    closeRef.current();
  }, [privacyMode]);
  return privacyMode || closedForPrivacy;
}
