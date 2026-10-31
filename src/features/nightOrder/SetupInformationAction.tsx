import { useRef, useState } from "react";
import { InfoPresentationBoundary, useInfoPresentation } from "@/features/info/InfoPresentationBoundary";
import { captureInfoContext, infoContextCurrent, type InfoContext } from "@/features/info/infoCommands";
import { setupPayload, type SetupView } from "@/features/info/infoModel";
import { buildRegistry } from "@/data/roleRegistry";
import { evilInformationPolicy } from "./nightRules";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import type { NightStep } from "./nightOrder";

/** How a host screen shows the information: its own player view, given the same view, recipient and captured
 * context. Answers with a refusal message, or undefined once the view is on screen. */
export type SetupPresentHost = (view: SetupView, recipientId: string, context: InfoContext) => string | undefined;
type Props = { game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "global" }>; visible: boolean; resolved: boolean; present?: SetupPresentHost };

/** Presentation only, just like Setup Info. Night Next retains its existing
 * authoritative completion command; displaying a card is never a delivery. */
export function SetupInformationAction(props: Props) {
  return <InfoPresentationBoundary><SetupInformation {...props} /></InfoPresentationBoundary>;
}

function SetupInformation({ game, script, step, visible, resolved, present: host }: Props) {
  const present = useInfoPresentation();
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ game, visible });
  live.current = { game, visible };
  const policy = evilInformationPolicy(game.seatOrder.map(id => game.players[id]!).filter(Boolean), buildRegistry(script), game);
  const view: SetupView = step.stepKey === "minionInfo" ? "minion" : policy.automaticTeamInfo ? "demon" : "bluffs";
  const recipients = (step.recipientIds ?? []).flatMap(id => game.players[id] ? [game.players[id]!] : []);
  const label = view === "minion" ? "Show Minion Information" : view === "demon" ? "Show Demon Information" : "Show Demon Bluffs";
  const show = (player: (typeof recipients)[number]) => {
    const context = captureInfoContext();
    if (!live.current.visible || live.current.game !== game || context.game !== game || !infoContextCurrent(context)) return;
    if (host) { setError(host(view, player.id, context) ?? null); return; }
    try {
      const payload = setupPayload(game, script, view, player.id);
      setError(null); present({ context, payload });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review setup information in Additional night controls."); }
  };
  // PO review C09/C10: the V2 show row. Minions wake together and see the same team, so they share one row.
  const rows = view === "minion" ? recipients.slice(0, 1) : recipients;
  const title = view === "minion" ? "Minion Information" : view === "demon" ? "Demon Information" : "Demon Bluffs";
  const sub = view === "minion" ? "Demon and fellow Minions" : view === "demon" ? "Minions and 3 bluffs" : "3 characters not in play";
  return <div className="night-setup-information">
    {rows.map(player => <button type="button" className="gvn-show" key={player.participantId ?? player.id} onClick={() => show(player)}
      aria-label={rows.length > 1 ? `${label} to ${player.name || `Seat ${player.seat + 1}`}` : label}>
      <span className="gvn-show-eye" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg></span>
      <span className="gvn-show-text"><strong>{title}</strong><small>{rows.length > 1 ? `For ${player.name || `Seat ${player.seat + 1}`}` : sub}</small></span>
      <span className="gvn-show-go" aria-hidden="true">Show<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
    </button>)}
    {!recipients.length && <p>No eligible recipients. Review Additional night controls.</p>}
    {resolved && <p className="modern-night-result">Completed</p>}
    {error && <p role="alert" className="behavior-help">{error}</p>}
  </div>;
}
