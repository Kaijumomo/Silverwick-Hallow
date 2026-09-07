import { useState } from "react";
import { buildRegistry } from "@/data/roleRegistry";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { getPrivateInfoApplicability, packetReadiness, previewPrivatePacket } from "@/stores/privatePackets";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { publishPrivatePacket } from "@/firebase/privatePacketCommands";
import { packetKey, usePacketDeliveryState } from "@/firebase/packetDeliveryState";
import { PrivateInformation } from "@/features/player/PrivateInformation";

/** Same controls on the player editor and the Storyteller's night sheet. */
export function PrivatePacketPanel({ playerId }: { playerId: string }) {
  const state = useStorytellerStore();
  const backend = useSessionRuntime(s => s.backend);
  const delivery = usePacketDeliveryState();
  const [error, setError] = useState<string | null>(null);
  const game = state.game;
  const p = game?.players[playerId];
  const script = game && selectScriptById(state, game.scriptId);
  if (!game || !p || p.isEmpty || !script) return null;
  const registry = buildRegistry(script);
  const applicability = getPrivateInfoApplicability(p, registry);
  if (!applicability.genericPacket) return null;
  const readiness = packetReadiness(p, game, registry);
  const key = packetKey(state.lobby?.code ?? "", playerId);
  const queued = delivery.queued[key];
  const published = !!backend && !!p.publishedPacket && delivery.receipts[key] === p.publishedPacket.id;
  const currentPublished = published && p.packetPreview && readiness.state === "ready"
    && p.publishedPacket?.forDay === game.day && p.publishedPacket?.forPhase === game.phase
    && JSON.stringify(p.packetPreview.payload) === JSON.stringify(p.publishedPacket?.payload);
  const label = queued ? "Queued — awaiting server" : currentPublished ? "Published" : readiness.state === "ready" ? "Previewed — ready to publish" : readiness.state;
  const title = applicability.fakeMinions ? "Fake Demon information" : applicability.bluffs && !applicability.simulatedInfo ? "Demon bluff delivery" : "Simulated information";
  return <section className="drawer-section" aria-label={`Private information for ${p.name}`}>
    <h3 className="drawer-section-title">{title} · {p.name}</h3>
    <p role="status">{label}</p>
    {published && !currentPublished && <p className="behavior-help">Earlier information is published; a new draft or night requires review and publication.</p>}
    {!backend && p.publishedPacket && <p className="behavior-help">Saved publication — reconnect to verify.</p>}
    {p.publishedPacket && <details>
      <summary>Last published packet{p.publishedPacket.forPhase !== undefined ? ` · ${p.publishedPacket.forPhase} ${p.publishedPacket.forDay}` : ""}</summary>
      <PrivateInformation payload={p.publishedPacket.payload} showIdentity showBluffs />
    </details>}
    {applicability.extraText && <label>
      Information to send
      <textarea className="textarea" rows={3} maxLength={4000} value={p.privateInfo?.extraText ?? ""}
        onChange={event => state.setPrivateText(playerId, event.target.value)} />
    </label>}
    <p className="behavior-help">{applicability.fakeMinions ? "Configure fake Demon information in the player editor, then preview and publish it." : applicability.bluffs && !applicability.simulatedInfo ? "Configure Demon bluffs above, then preview and publish them." : "Choose simulated information manually; a simulated wake grants no real ability."}</p>
    {(applicability.fakeMinions || applicability.bluffs) && <button className="btn btn-sm" onClick={() => { state.selectPlayer(playerId); state.setView("game"); }}>Edit player information</button>}
    <button className="btn btn-sm" disabled={!!queued || readiness.state === "not configured"} onClick={() => {
      try { state.previewPrivateInfo(playerId); setError(null); }
      catch (error) { setError(error instanceof Error ? error.message : "Preview failed."); }
    }}>Preview packet</button>
    {readiness.state === "ready" && p.packetPreview && <div aria-label="Player preview">
      <PrivateInformation payload={previewPrivatePacket(p, game, registry).payload} showIdentity showBluffs />
    </div>}
    <button className="btn btn-sm btn-gold" disabled={!backend || !!queued || readiness.state !== "ready" || !!currentPublished}
      onClick={async () => {
        setError(null);
        try { await publishPrivatePacket(playerId); }
        catch (error) { setError(error instanceof Error ? error.message : "Publication failed."); }
      }}>Publish packet</button>
    {readiness.error && <p className="field-error">{readiness.error}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <p className="behavior-help">Published means the server accepted the player-facing record. Player reading is not tracked. Night completion does not publish information.</p>
  </section>;
}
