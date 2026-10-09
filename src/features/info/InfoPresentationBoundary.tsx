import { createContext, useContext, useState, type ReactNode, type RefObject } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { infoContextCurrent, type InfoContext } from "./infoCommands";
import { PlayerPresentation, type PresentationPayload } from "./PlayerPresentation";

type Presentation = { context: InfoContext; payload: PresentationPayload; returnFocusRef?: RefObject<HTMLElement> };
const PresentationContext = createContext<((presentation: Presentation | null) => void) | null>(null);

/** The safe screen outlives the responsive panel that opened it. UI state only. */
export function InfoPresentationBoundary({ children }: { children: ReactNode }) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  useStorytellerStore();
  usePrivacyStore();
  useSessionRuntime();
  return <PresentationContext.Provider value={setPresentation}>
    {children}
    {presentation && <PlayerPresentation returnFocusRef={presentation.returnFocusRef}
      payload={infoContextCurrent(presentation.context) ? presentation.payload : {
        kind: "setup", groups: [{ heading: "Information changed", names: ["Return to review the current information."] }],
      }} onClose={() => setPresentation(null)} />}
  </PresentationContext.Provider>;
}

export function useInfoPresentation() {
  const present = useContext(PresentationContext);
  if (!present) throw new Error("InfoPanel requires an InfoPresentationBoundary.");
  return present;
}
