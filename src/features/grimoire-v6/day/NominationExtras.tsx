import { createElement as E, type CSSProperties, type ReactNode } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { useVotingInteraction } from "@/features/voting/VotingWorkspace";

/**
 * What the V2 nomination card has no slot for, drawn inside the same card in the same button language:
 * the Virgin / exile / execution follow-ups, the engine's refusal text and its "confirm" step. Controls only -- every action is a Voting intent.
 */
export type ExtraAction = { label: string; onClick: () => void; tone?: "secondary" | "quiet" };

const BUTTON: CSSProperties = { minHeight: 44, padding: "0 16px", borderRadius: 12, border: "1px solid rgba(176,186,204,.25)", background: "transparent", color: "#ddd6c8", fontFamily: "inherit", fontSize: 14, cursor: "pointer" };
const QUIET: CSSProperties = { minHeight: 36, padding: "0 10px", border: "none", background: "transparent", color: "rgba(222,216,204,.6)", fontFamily: "inherit", fontSize: 13, cursor: "pointer" };
const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };
const NOTE: CSSProperties = { margin: 0, fontSize: 13, color: "#f4a595" };

function Row({ children }: { children: ReactNode }) {
  return <div style={ROW}>{children}</div>;
}

export function NominationExtras({ actions, contextNote }: { actions: ExtraAction[]; contextNote: string | null }) {
  const ui = useVotingInteraction();
  const game = useStorytellerStore((s) => s.game);
  if (!ui?.open || !game) return null;
  const flow = !!contextNote || !!ui.error || !!ui.confirmation || actions.length > 0;
  if (!flow) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {contextNote && <p style={NOTE}>{contextNote}</p>}
      {ui.error && <p role="alert" style={NOTE}>{ui.error}</p>}
      {ui.confirmation && <button style={BUTTON} onClick={ui.confirmation.accept}>{ui.confirmation.message} Confirm</button>}
      {actions.length > 0 && (
        <Row>{actions.map((a) => <button key={a.label} style={a.tone === "quiet" ? QUIET : BUTTON} onClick={a.onClick}>{a.label}</button>)}</Row>
      )}
    </div>
  );
}

export const nominationExtras = (actions: ExtraAction[], contextNote: string | null) => E(NominationExtras, { actions, contextNote });
