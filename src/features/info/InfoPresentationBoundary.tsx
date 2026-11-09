import { createContext, useContext, useState, type ReactNode, type RefObject } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { captureInfoContext, infoContextCurrent, type InfoContext } from "./infoCommands";
import { buildRegistry } from "@/data/roleRegistry";
import type { STPlayerRecord } from "@/stores/types";
import { characterCard, seatedPlayers } from "./infoModel";
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

/** Local hand-to-player display. Never substitutes hidden actual identity or
 * records a delivery, reveal acknowledgement, history entry or gameplay change. */
export function useShowPlayerPresentation() {
  const present = useInfoPresentation();
  const context = captureInfoContext();
  return (player: STPlayerRecord, returnFocusRef?: RefObject<HTMLElement>): string | undefined => {
    if (!infoContextCurrent(context) || context.game!.players[player.id] !== player ||
      !seatedPlayers(context.game!).includes(player)) return "The player or game changed. Select their token again.";
    const role = context.script && player.shownRole ? buildRegistry(context.script).get(player.shownRole) : undefined;
    if (!role) return "Choose this player's shown character in More settings before showing their token.";
    present({ context, payload: { kind: "character", heading: "You Are", character: characterCard(role) }, returnFocusRef });
    return undefined;
  };
}
