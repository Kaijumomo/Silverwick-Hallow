import { useRef, useState } from "react";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { usePrivacyStore } from "@/stores/privacyStore";
import { resolvedCharacters } from "@/data/roleRegistry";
import { getFabled } from "@/data/fabled";
import { getLoric } from "@/data/lorics";
import { iconUrlFor } from "@/data/iconUrl";
import { Modal } from "@/components/Modal";
import { GrimoireIcon, type GrimoireIconName } from "@/components/GrimoireIcon";
import { RoleChooser } from "@/features/players/RoleChooser";
import type { RoleDef } from "@/stores/types";
import { PlayerPresentation, type PresentationPayload } from "./PlayerPresentation";
import { characterCard, infoRecipients, infoStatistics, seatedPlayers, setupPayload, type SetupView } from "./infoModel";
import { captureInfoContext, changeInfoBluff, infoContextCurrent, type InfoContext } from "./infoCommands";
import "./info.css";

const characterActions = ["You Are", "This Player Is", "Selected You"];
const characterSymbols: Record<string, GrimoireIconName> = { "You Are": "person", "This Player Is": "identify", "Selected You": "selected" };
const directActions = [
  { heading: "Did You Vote Today?", symbol: "vote" }, { heading: "Did You Nominate Today?", symbol: "nominate" },
  { heading: "You Are Good", symbol: "good", tone: "good" }, { heading: "You Are Evil", symbol: "evil", tone: "evil" },
] as const;
const setupActions: { view: SetupView; label: string }[] = [
  { view: "traveler", label: "Evil Traveller Information" }, { view: "demon", label: "Demon Information" },
  { view: "minion", label: "Minion Information" }, { view: "bluffs", label: "Demon Bluffs" },
];
type Choice = { context: InfoContext; heading: string; recipient?: string; slot?: number };

/** Info owns transient presentation state only; configured bluffs stay per player. */
export function InfoPanel() {
  const state = useStorytellerStore(), game = state.game;
  useSessionRuntime();
  const privacy = usePrivacyStore(s => s.enabled);
  const script = game ? selectScriptById(state, game.scriptId) : undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const [recipientId, setRecipientId] = useState("");
  const [chooser, setChooser] = useState<Choice | null>(null);
  const [presentation, setPresentation] = useState<{ context: InfoContext; payload: PresentationPayload } | null>(null);
  const [recipientView, setRecipientView] = useState<{ view: SetupView; context: InfoContext } | null>(null);
  const [detail, setDetail] = useState<RoleDef | null>(null);
  const [error, setError] = useState("");
  const [setupNotice, setSetupNotice] = useState<{ title: string; message: string } | null>(null);
  if (!game || !script || privacy) return null;
  const roles = resolvedCharacters(script), players = seatedPlayers(game), stats = infoStatistics(game);
  const recipients = infoRecipients(game, script, "bluffs");
  const recipient = recipients.find(p => p.id === recipientId) ?? (recipients.length === 1 ? recipients[0] : undefined);
  const bluffs = recipient?.privateInfo?.bluffs ?? [];
  const byId = new Map(roles.map(r => [r.id, r]));
  const holders: Record<string, string[]> = {};
  for (const player of players) if (player.actualRole) (holders[player.actualRole] ??= []).push(player.name);
  const current = captureInfoContext(), canEdit = game.phase !== "ended" && infoContextCurrent(current);
  const show = (payload: PresentationPayload, context = captureInfoContext()) => {
    if (!infoContextCurrent(context)) { setError("The game or connection changed. Review the information again."); return; }
    setError(""); setSetupNotice(null); setChooser(null); setRecipientView(null); setDetail(null); setPresentation({ context, payload });
  };
  const showSetup = (view: SetupView, id: string) => {
    try {
      const context = recipientView?.context ?? current;
      if (!infoContextCurrent(context)) throw new Error("The game changed. Close and reopen Setup Info.");
      const payload = setupPayload(context.game!, context.script!, view, id); show(payload, context);
    }
    catch (e) {
      const message = e instanceof Error ? e.message : "Review the information before showing it.";
      if (recipientView) setError(message);
      else setSetupNotice({ title: setupActions.find(action => action.view === view)!.label, message });
    }
  };
  const openSetup = (view: SetupView) => {
    setError(""); setSetupNotice(null);
    const eligible = infoRecipients(game, script, view);
    if (!eligible.length) {
      setSetupNotice({ title: setupActions.find(action => action.view === view)!.label, message: view === "traveler"
        ? "No living, non-exiled evil Traveller is seated. This information becomes available when an eligible evil Traveller joins."
        : view === "minion" ? "No eligible Minion is seated. Assign a Minion during setup before showing this information."
        : "No Demon or apparent Demon is seated. Assign a recipient during setup before showing this information." });
      return;
    }
    if ((view === "bluffs" || view === "demon") && recipient) showSetup(view, recipient.id);
    else if (eligible.length === 1) showSetup(view, eligible[0]!.id);
    else { setError(""); setRecipientView({ view, context: current }); }
  };
  const choose = (roleId?: string) => {
    if (!chooser) return;
    if (!infoContextCurrent(chooser.context)) { setError("The game changed. Close and reopen the chooser."); return; }
    if (chooser.recipient != null && chooser.slot != null) {
      const refusal = changeInfoBluff(chooser.context, chooser.recipient, chooser.slot, roleId);
      if (refusal) { setError(refusal); return; }
      setChooser(null); setPresentation(null); setError("");
    } else if (roleId) {
      const role = roles.find(r => r.id === roleId); if (!role) return;
      show({ kind: "character", heading: chooser.heading, character: characterCard(role) }, chooser.context); setChooser(null);
    }
  };
  const modifierSection = (label: string, ids: string[], lookup: (id: string) => RoleDef | undefined) => <section><h3>{label}</h3>
    {!ids.length ? <p className="info-muted">None in play.</p> : <div className="info-modifiers">{ids.map(id => {
      const role = lookup(id); return <button key={id} type="button" className="info-token-button" disabled={!role} onClick={() => role && setDetail(role)}>
        {role && <img src={iconUrlFor(role)} alt="" />}<span>{role?.name ?? id}</span></button>;
    })}</div>}</section>;
  return <div className="info-scroll" ref={panelRef} tabIndex={-1}>
    <p className="info-phase">{game.phase === "night" ? `Night ${game.day}` : game.phase === "day" ? `Day ${game.day}` : game.phase === "ended" ? "Game ended" : "Initial setup"}</p>
    <div className="info-statistics">{[[stats.alive, "Alive"], [stats.votes, "Votes"], [stats.toExecute, "To execute"]].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    <details className="info-count-note"><summary>About these counts</summary><p>Votes counts living players and unspent dead votes, including unspent votes after exile. To execute is the standard half-alive minimum. Character effects and votes already on the block may change what is required.</p></details>
    <section><h3>Composition</h3><div className="info-composition">{(["townsfolk", "outsider", "minion", "demon"] as const).map(type => <div key={type} className={`type-${type}`}><i/><span>{players.filter(p => !p.isTraveler && byId.get(p.actualRole)?.type === type).length} {type === "townsfolk" ? "Townsfolk" : type === "outsider" ? "Outsiders" : type === "minion" ? "Minions" : "Demons"}</span></div>)}</div></section>
    <section><div className="info-section-heading"><h3>Demon bluffs</h3><button type="button" className="info-text-button" disabled={!bluffs.length} onClick={() => openSetup("bluffs")}>Show</button></div>
      {recipients.length > 1 && <div className="info-recipient" role="group" aria-label="Bluffs for"><p>Choose recipient</p>{recipients.map(p => <button type="button" key={p.id} aria-pressed={recipient?.id === p.id} onClick={() => { setRecipientId(p.id); setChooser(null); setPresentation(null); }}>{p.name}{p.behaviorMode === "fake_demon_behavior" ? " · apparent Demon" : ""}</button>)}</div>}
      {!recipients.length && <p className="info-muted">Assign a Demon or apparent Demon to choose bluffs.</p>}
      <div className="info-bluffs">{[0, 1, 2].map(slot => { const role = byId.get(bluffs[slot] ?? ""); return <button key={slot} type="button" className="info-token-button" disabled={!recipient || !canEdit}
        aria-label={`Demon bluff ${slot + 1}${role ? `: ${role.name}` : ": add"}`} onClick={() => { setPresentation(null); setChooser({ context: captureInfoContext(), heading: `Demon bluff ${slot + 1} of 3`, recipient: recipient!.id, slot }); setError(""); }}>
        <span className="info-bluff-disc">{role ? <img src={iconUrlFor(role)} alt=""/> : "+"}</span><span>{role?.name ?? "Add bluff"}</span></button>; })}</div>
    </section>
    <div className="info-modifier-sections">{modifierSection("Fabled", game.fabled, getFabled)}{modifierSection("Loric", game.lorics, getLoric)}</div>
    <section><h3>Information tokens</h3><div className="info-actions">{characterActions.map(heading => <button type="button" key={heading} className={heading === "Selected You" ? "info-wide" : ""} onClick={() => { setChooser({ context: captureInfoContext(), heading }); setError(""); }}><span aria-hidden="true"><GrimoireIcon name={characterSymbols[heading]!} /></span>{heading}</button>)}
      {directActions.map(action => <button type="button" key={action.heading} data-tone={"tone" in action ? action.tone : undefined} onClick={() => show({ kind: "message", ...action })}><span aria-hidden="true"><GrimoireIcon name={action.symbol} /></span>{action.heading}</button>)}
    </div></section>
    <section><h3>Setup info</h3><div className="info-setup-actions">{setupActions.map(({ view, label }) => <button key={view} type="button" onClick={() => openSetup(view)}><GrimoireIcon name={view === "minion" ? "players" : view === "bluffs" ? "book" : "crown"} /><span>{label}<small>{view === "bluffs" ? `${bluffs.length} of 3 bluffs set` : view === "demon" ? "Minions and selected bluffs" : view === "minion" ? "Demon and fellow Minions" : "Demon only"}</small></span><span aria-hidden="true">›</span></button>)}</div></section>
    {error && !recipientView && <p role="alert" className="info-error">{error}</p>}
    {setupNotice && <Modal title={setupNotice.title} onClose={() => setSetupNotice(null)}><div className="info-setup-notice"><p role="alert">{setupNotice.message}</p><button className="btn" type="button" onClick={() => setSetupNotice(null)}>Return to Info</button></div></Modal>}
    {chooser && <RoleChooser mode="select" roles={roles} scriptName={script.name} title={chooser.heading}
      instruction={chooser.recipient ? "Choose a Townsfolk or Outsider bluff. In-play characters are marked; supported setup exceptions still apply." : "Choose a character to show. This does not change anyone's character."}
      selected={chooser.recipient ? bluffs : undefined} holders={chooser.recipient ? holders : undefined}
      onChoose={choose} onClear={chooser.recipient ? () => choose() : undefined} onClose={() => { setChooser(null); setError(""); }} error={error || undefined} />}
    {recipientView && <Modal title="Who is this information for?" onClose={() => setRecipientView(null)}><div className="info-recipient-list">{infoContextCurrent(recipientView.context) ? infoRecipients(game, script, recipientView.view).map(p => <button className="btn" key={p.id} onClick={() => showSetup(recipientView.view, p.id)}>{p.name}{p.behaviorMode === "fake_demon_behavior" ? " · apparent Demon" : ""}</button>) : <p>The game changed. Close and reopen Setup Info.</p>}{error && <p role="alert" className="info-error">{error}</p>}</div></Modal>}
    {detail && <Modal title={detail.name} onClose={() => setDetail(null)}><div className="info-modifier-detail"><img src={iconUrlFor(detail)} alt=""/><p>{detail.ability}</p><small>Selected during initial setup.</small></div></Modal>}
    {presentation && (infoContextCurrent(presentation.context) ? <PlayerPresentation returnFocusRef={panelRef} payload={presentation.payload} onClose={() => setPresentation(null)} /> : <PlayerPresentation returnFocusRef={panelRef} payload={{ kind: "setup", groups: [{ heading: "Information changed", names: ["Return to review the current information."] }] }} onClose={() => setPresentation(null)} />)}
  </div>;
}
