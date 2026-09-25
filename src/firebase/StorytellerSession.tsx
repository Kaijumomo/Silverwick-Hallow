import { useEffect, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { connectFirebase } from "./session";
import type { RoomBackend } from "./backend";
import { classifyStorytellerError, lifecycleMessage } from "./lifecycle";
import { applyTravelerChoice } from "./membershipCommands";
import { closeMultiplayerSession, initialConnectionStatus, leaveMultiplayerOffline, reportRuntimeError, retryStorytellerSession, scopeKey, useSessionRuntime, useStorytellerSync } from "./storytellerSync";

export function StorytellerSession() {
  const lobby = useStorytellerStore(s => s.lobby);
  const view = useStorytellerStore(s => s.view);
  const retry = useSessionRuntime(s => s.retry);
  const [backend, setBackend] = useState<RoomBackend | null>(null);
  useEffect(() => {
    let active = true;
    setBackend(null);
    if (!lobby) {
      useSessionRuntime.setState({ status: "idle", failure: null, closeFailed: false, leaveOffer: null });
      return;
    }
    useSessionRuntime.setState({ status: initialConnectionStatus(lobby) });
    void connectFirebase().then(connection => {
      if (!active) return;
      if (connection.uid !== lobby.uid) throw new Error("Session authorization changed.");
      setBackend(connection.backend);
    }).catch(error => {
      if (!active) return;
      const failure = classifyStorytellerError(error, "startup");
      reportRuntimeError("connect", failure.message);
      useSessionRuntime.setState({ status: "failed", failure });
    });
    return () => { active = false; };
  }, [lobby?.code, retry]);
  useStorytellerSync(backend);
  useApplyTravelerChoices(lobby?.code);
  // The Grimoire renders its own status in-flow beneath its header.
  return view === "game" ? null : <ConnectionStatus />;
}

const DEV = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

/**
 * Compact, in-flow multiplayer connection status for the Storyteller. It
 * never overlays Grimoire controls: callers place it in normal document flow.
 * "Connecting…"/"Reconnecting…" are polite status text with no action; a
 * failure is an alert offering only the action that can actually help:
 * - live writer stopped or runtime error: Reconnect (the existing retry seam);
 * - session ended: Leave lobby (closeMultiplayerSession clears an ended lobby);
 * - startup never reached live: Retry, or End multiplayer (authoritative
 *   close, keeping the local game);
 * - that close also failed: Try ending again, plus -- only when offered for a
 *   lobby that never reached live -- Leave multiplayer, keeping the game
 *   offline (local only).
 * Messages are plain language; the Firebase operation/path diagnostic is
 * shown only in development builds.
 */
export function ConnectionStatus() {
  const lobby = useStorytellerStore(s => s.lobby);
  const { status, error, errors, failure, closeFailed, leaveOffer } = useSessionRuntime();
  const [busy, setBusy] = useState(false);
  if (!lobby || status === "idle") return null;
  const run = (action: () => Promise<unknown>) => async () => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch { /* recorded in the runtime status */ } finally { setBusy(false); }
  };
  const endMultiplayer = run(closeMultiplayerSession);
  if ((status === "connecting" || status === "reconnecting") && !error) {
    return <div className="connection-status" data-tone="info" role="status" aria-live="polite">
      {status === "connecting" ? "Connecting to the lobby…" : "Reconnecting to the lobby…"}
    </div>;
  }
  if (status === "live" && !error && !closeFailed) return null;

  let title = "Multiplayer problem";
  let message = error ?? failure?.message ?? "The lobby connection needs attention.";
  const actions: { label: string; onClick: () => void; danger?: boolean }[] = [];
  if (closeFailed) {
    title = "The lobby could not be ended";
    message = errors.close ?? message;
    actions.push({ label: "Try ending again", onClick: endMultiplayer });
    if (leaveOffer === scopeKey(lobby)) actions.push({ label: "Leave multiplayer — keep game offline", onClick: () => { leaveMultiplayerOffline(); }, danger: true });
  } else if (failure?.category === "ended" && status !== "live") {
    title = "This lobby has ended";
    actions.push({ label: "Leave lobby", onClick: endMultiplayer });
  } else if (status === "failed") {
    title = "Multiplayer is not live";
    actions.push({ label: "Retry", onClick: retryStorytellerSession });
    actions.push({ label: "End multiplayer", onClick: endMultiplayer });
  } else if (status === "blocked") {
    title = "Reconnect needs attention";
    actions.push({ label: "Retry", onClick: retryStorytellerSession });
  } else if (status === "stopped") {
    title = "Multiplayer interrupted";
    actions.push({ label: "Reconnect", onClick: retryStorytellerSession });
  } else if (status === "live") {
    actions.push({ label: "Reconnect", onClick: retryStorytellerSession });
  } else {
    title = status === "connecting" ? "Connecting to the lobby…" : "Reconnecting to the lobby…";
  }
  return <div className="connection-status" data-tone="error" role="alert">
    <strong>{title}</strong>
    <span className="connection-status-message">{message}</span>
    {actions.length > 0 && <span className="connection-status-actions">
      {actions.map(action => <button key={action.label} type="button" className={`btn btn-sm${action.danger ? " btn-danger" : ""}`} disabled={busy} onClick={action.onClick}>{action.label}</button>)}
    </span>}
    {DEV && failure?.diagnostic && <details className="connection-status-diagnostic">
      <summary>Technical details</summary>
      <code>{failure.category}: {failure.diagnostic}</code>
    </details>}
  </div>;
}

/**
 * Player-side Traveler character choice (Phase 9 Setup finalization B4):
 * once selected, the choice is public immediately -- it does not wait for
 * the Storyteller to click anything, matching "player chooses Traveller
 * character" with no separate approval step. This applies each observed
 * choice through the exact same assignRole() command the Storyteller's own
 * manual Traveler override uses (never a second mutation path), and the
 * Storyteller's override remains fully available afterward: applying a
 * choice is just another assignRole() call, not a lock. Independent of
 * which screen is visible, matching useStorytellerSync's own scope.
 *
 * Precedence (Phase 9 Setup finalization B4 revision): a current
 * Storyteller-assigned Traveler character always wins over an older
 * pending player choice. If the seat already carries a Traveler character
 * by the time this request is processed -- whether the Storyteller assigned
 * it before or after the player submitted their choice -- that assignment
 * stands; the stale request is simply cleared, never overwritten back to
 * the player's pick. A choice only ever applies to a Traveler who does not
 * yet have a character.
 *
 * Authority (FINAL SETUP INTEGRATION REVISION, Section 1): the request node
 * lives under the same Storyteller-authoritative collection as every other
 * membership write, and the Firebase rules require the current fenced
 * writer's guard to clear it -- writing through StorytellerSession's own raw
 * connection (available as soon as it connects, before writer authority is
 * ever claimed) can locally apply a character while failing with
 * permission_denied clearing the request. This reads the same
 * useSessionRuntime().backend every other membership command
 * (seatPlayerAndCommit, revokePlayerAndCommit, ...) already uses -- never a
 * second write path -- and simply does not process anything until that
 * fenced writer is actually available; a request left pending while
 * disconnected/reconnecting is retried automatically once it appears, from
 * this same effect re-running on its next value.
 */
export function useApplyTravelerChoices(code: string | undefined) {
  const travelerChoices = useSessionRuntime(s => s.travelerChoices);
  const writer = useSessionRuntime(s => s.backend);
  useEffect(() => {
    if (!writer || !code) return;
    for (const [uid, { playerId, roleId }] of Object.entries(travelerChoices)) {
      if (!playerId) continue; // unresolved for now; retried once the roster resolves it
      applyTravelerChoice(writer, code, uid, roleId, (id, role) => {
        const p = useStorytellerStore.getState().game?.players[id];
        // Re-check eligibility against the freshly-resolved player: only an
        // unassigned Traveler seat ever adopts the pending choice. A seat
        // that already carries a character -- a Storyteller override, or
        // this exact choice already applied -- keeps it; the request is
        // stale/superseded and is cleared without changing the role.
        if (p?.isTraveler && !p.actualRole) useStorytellerStore.getState().assignRole(id, role);
      }).catch(error => reportRuntimeError("traveler-choice", lifecycleMessage(error)));
    }
  }, [writer, code, travelerChoices]);
}
