import { useState } from "react";
import { buildRegistry } from "@/data/roleRegistry";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { hasPrivateDraft, previewPrivatePacket } from "@/stores/privatePackets";
import { projectToSelf } from "@/stores/projections";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { publishPrivatePacket } from "@/firebase/privatePacketCommands";
import { packetKey, usePacketDeliveryState } from "@/firebase/packetDeliveryState";
import { PrivateInformation } from "@/features/player/PrivateInformation";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupInformationWarning } from "@/features/nightOrder/nightRules";

/** Contextual send controls. Preview is derived, never stored or synchronized. */
export function PlayerInformation({ playerId, purpose }: { playerId: string; purpose: "setup" | "result" }) {
  const state = useStorytellerStore();
  const backend = useSessionRuntime(s => s.backend);
  const delivery = usePacketDeliveryState();
  const hidden = usePrivacyStore(s => s.enabled);
  const [error, setError] = useState<string | null>(null);
  const game = state.game;
  const p = game?.players[playerId];
  const script = game && selectScriptById(state, game.scriptId);
  if (hidden || !game || !p || p.isEmpty || !script) return null;
  const registry = buildRegistry(script);
  const setupWarning = purpose === "setup" ? setupInformationWarning(Object.values(game.players), registry, game) : undefined;
  let preview: ReturnType<typeof previewPrivatePacket> | undefined;
  let invalid: string | undefined;
  if (hasPrivateDraft(p)) {
    try { preview = previewPrivatePacket(p, game, registry); }
    catch (cause) { invalid = cause instanceof Error ? cause.message : "Review the information."; }
  }
  const key = packetKey(state.lobby?.code ?? "", playerId);
  const queued = delivery.queued[key];
  const current = projectToSelf(p, registry);
  const acknowledged = !!backend && !!p.publishedPacket && delivery.receipts[key] === p.publishedPacket.id;
  const matches = !!preview && JSON.stringify(current) === JSON.stringify(preview.payload);
  const sent = acknowledged && matches && (purpose === "setup" ||
    p.publishedPacket?.forDay === game.day && p.publishedPacket?.forPhase === game.phase);
  const sendLabel = purpose === "result" ? "Send to player view" : p.privateInfo?.fakeMinions?.length ? "Send setup information" : "Send bluffs";
  return <div className="player-information" aria-label={`Information for ${p.name}`}>
    {setupWarning && <p className="behavior-help">{setupWarning} Deliberate sending is a manual override, not a rules decision.</p>}
    {purpose === "result" && <label className="information-input">
      Information
      <textarea className="input" rows={2} maxLength={4000} value={p.privateInfo?.extraText ?? ""}
        onChange={event => { state.setPrivateText(playerId, event.target.value); setError(null); }} />
    </label>}
    {preview && <details className="information-review">
      <summary>Player view</summary>
      <PrivateInformation payload={preview.payload} showIdentity showBluffs />
    </details>}
    {purpose === "setup" && !hasPrivateDraft(p) && <p className="behavior-help">Choose setup information before sending.</p>}
    <button className="btn btn-sm" disabled={!backend || !!queued || !preview || !!sent}
      onClick={async () => {
        if (!preview) return;
        setError(null);
        try { await publishPrivatePacket(playerId, preview); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Information could not be sent."); }
      }}>{sendLabel}</button>
    {queued ? <p role="status">Sending…</p> : sent ? <p role="status">Sent to player view</p> : null}
    {!backend && <p className="behavior-help">Connect the lobby to send digitally. You can still give information in person.</p>}
    {(error || invalid) && <p className="field-error" role="alert">{error || invalid}</p>}
    {current && <details className="information-review">
      <summary>Currently shown to player</summary>
      {!backend && <p className="behavior-help">Saved player view; reconnect to verify.</p>}
      <PrivateInformation payload={current} showIdentity showBluffs />
    </details>}
  </div>;
}
