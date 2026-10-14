import { useRef, useState } from "react";
import { InfoPresentationBoundary, useInfoPresentation } from "@/features/info/InfoPresentationBoundary";
import { captureInfoContext, infoContextCurrent } from "@/features/info/infoCommands";
import { setupPayload } from "@/features/info/infoModel";
import { buildRegistry } from "@/data/roleRegistry";
import { evilInformationPolicy } from "./nightRules";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import type { NightStep } from "./nightOrder";

type Props = { game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "global" }>; visible: boolean; resolved: boolean };

/** Presentation only, just like Setup Info. Night Next retains its existing
 * authoritative completion command; displaying a card is never a delivery. */
export function SetupInformationAction(props: Props) {
  return <InfoPresentationBoundary><SetupInformation {...props} /></InfoPresentationBoundary>;
}

function SetupInformation({ game, script, step, visible, resolved }: Props) {
  const present = useInfoPresentation();
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ game, visible });
  live.current = { game, visible };
  const policy = evilInformationPolicy(game.seatOrder.map(id => game.players[id]!).filter(Boolean), buildRegistry(script), game);
  const view = step.stepKey === "minionInfo" ? "minion" : policy.automaticTeamInfo ? "demon" : "bluffs";
  const recipients = (step.recipientIds ?? []).flatMap(id => game.players[id] ? [game.players[id]!] : []);
  const label = view === "minion" ? "Show Minion Information" : view === "demon" ? "Show Demon Information" : "Show Demon Bluffs";
  return <div className="night-setup-information">
    {recipients.map(player => <div className="night-setup-recipient" key={player.participantId ?? player.id}>
      <p>{player.name || `Seat ${player.seat + 1}`}</p>
      <button type="button" className="btn btn-gold" onClick={() => {
        const context = captureInfoContext();
        if (!live.current.visible || live.current.game !== game || context.game !== game || !infoContextCurrent(context)) return;
        try {
          const payload = setupPayload(game, script, view, player.id);
          setError(null); present({ context, payload });
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Review setup information in Additional night controls."); }
      }} aria-label={recipients.length > 1 ? `${label} to ${player.name || `Seat ${player.seat + 1}`}` : label}>{label}</button>
    </div>)}
    {!recipients.length && <p>No eligible recipients. Review Additional night controls.</p>}
    {resolved && <p className="modern-night-result">Completed</p>}
    {error && <p role="alert" className="behavior-help">{error}</p>}
  </div>;
}
