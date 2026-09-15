import { useEffect, useState } from "react";
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
import type { STPlayerRecord } from "@/stores/types";

/** A sibling-owned extra-text draft (e.g. LunaticInfo's own "Additional
 * setup information" field) that Send must fold in before publishing. */
export type PendingExtraTextDraft = { value: string; commit: () => void };

/** Commit a local extra-text draft through setPrivateText, but only when it
 * differs from the latest authoritative value — repeated commit boundaries
 * (blur, then Send) must never produce duplicate game mutations. */
export function commitExtraTextDraft(playerId: string, draft: string): void {
  const latest = useStorytellerStore.getState().game?.players[playerId];
  if (latest && draft !== (latest.privateInfo?.extraText ?? "")) {
    useStorytellerStore.getState().setPrivateText(playerId, draft);
  }
}

/** Contextual send controls. Preview is derived, never stored or synchronized. */
export function PlayerInformation({ playerId, purpose, pendingExtraText }: {
  playerId: string;
  purpose: "setup" | "result" | "traveler";
  pendingExtraText?: PendingExtraTextDraft;
}) {
  const state = useStorytellerStore();
  const backend = useSessionRuntime(s => s.backend);
  const delivery = usePacketDeliveryState();
  const hidden = usePrivacyStore(s => s.enabled);
  const [error, setError] = useState<string | null>(null);
  const game = state.game;
  const p = game?.players[playerId];
  // Local UI draft state for the "result" purpose's own Information field.
  // Typing here must stay local until blur or Send; it never calls
  // setPrivateText directly.
  const [extraTextDraft, setExtraTextDraft] = useState(p?.privateInfo?.extraText ?? "");
  useEffect(() => {
    setExtraTextDraft(p?.privateInfo?.extraText ?? "");
  }, [playerId, p?.privateInfo?.extraText]);
  const commitOwnExtraText = () => commitExtraTextDraft(playerId, extraTextDraft);
  const script = game && selectScriptById(state, game.scriptId);
  if (hidden || !game || !p || p.isEmpty || !script) return null;
  const registry = buildRegistry(script);
  const setupWarning = purpose === "setup" ? setupInformationWarning(Object.values(game.players), registry, game) : undefined;
  // The preview reflects any live, uncommitted draft so the Storyteller sees
  // the Player View update immediately while typing. This transient overlay
  // is only ever used to compute the preview here — never stored or synced.
  const previewPlayer: STPlayerRecord = purpose === "result"
    ? { ...p, privateInfo: { ...p.privateInfo, extraText: extraTextDraft } }
    : pendingExtraText
      ? { ...p, privateInfo: { ...p.privateInfo, extraText: pendingExtraText.value } }
      : p;
  let preview: ReturnType<typeof previewPrivatePacket> | undefined;
  let invalid: string | undefined;
  if (hasPrivateDraft(previewPlayer)) {
    try { preview = previewPrivatePacket(previewPlayer, game, registry); }
    catch (cause) { invalid = cause instanceof Error ? cause.message : "Review the information."; }
  }
  const key = packetKey(state.lobby?.code ?? "", playerId);
  const queued = delivery.queued[key];
  const current = projectToSelf(p, registry);
  const acknowledged = !!backend && !!p.publishedPacket && delivery.receipts[key] === p.publishedPacket.id;
  const matches = !!preview && JSON.stringify(current) === JSON.stringify(preview.payload);
  const sent = acknowledged && matches && (purpose !== "result" ||
    p.publishedPacket?.forDay === game.day && p.publishedPacket?.forPhase === game.phase);
  const sendLabel = purpose === "traveler" ? "Show Demon to Traveler" : purpose === "result" ? "Send to player view" : p.privateInfo?.fakeMinions?.length ? "Send setup information" : "Send bluffs";
  return <div className="player-information" aria-label={`Information for ${p.name}`}>
    {setupWarning && <p className="behavior-help">{setupWarning} Deliberate sending is a manual override, not a rules decision.</p>}
    {purpose === "result" && <label className="information-input">
      Information
      <textarea className="input" rows={2} maxLength={4000} value={extraTextDraft}
        onChange={event => { setExtraTextDraft(event.target.value); setError(null); }}
        onBlur={commitOwnExtraText} />
    </label>}
    {preview && <details className="information-review">
      <summary>Player view</summary>
      <PrivateInformation payload={preview.payload} showIdentity showBluffs />
    </details>}
    {purpose === "setup" && !hasPrivateDraft(previewPlayer) && <p className="behavior-help">Choose setup information before sending.</p>}
    <button className="btn btn-sm" disabled={!backend || !!queued || !preview || !!sent}
      onClick={async () => {
        setError(null);
        // Fold any still-uncommitted draft into authoritative state exactly
        // once, then rebuild the canonical preview from that now-committed
        // state — Send must never publish a stale or draft-only preview.
        if (purpose === "result") commitOwnExtraText();
        pendingExtraText?.commit();
        const fresh = useStorytellerStore.getState();
        const freshGame = fresh.game;
        const freshPlayer = freshGame?.players[playerId];
        const freshScript = freshGame && selectScriptById(fresh, freshGame.scriptId);
        if (!freshGame || !freshPlayer || !freshScript) return;
        const freshRegistry = buildRegistry(freshScript);
        try {
          const freshPreview = previewPrivatePacket(freshPlayer, freshGame, freshRegistry);
          await publishPrivatePacket(playerId, freshPreview);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Information could not be sent."); }
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
