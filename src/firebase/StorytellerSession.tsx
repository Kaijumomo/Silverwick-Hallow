import { useEffect, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { connectFirebase } from "./session";
import type { RoomBackend } from "./backend";
import { lifecycleMessage } from "./lifecycle";
import { applyTravelerChoice } from "./membershipCommands";
import { reportRuntimeError, retryStorytellerSession, useSessionRuntime, useStorytellerSync } from "./storytellerSync";

export function StorytellerSession() {
  const lobby = useStorytellerStore(s => s.lobby);
  const { error, retry } = useSessionRuntime();
  const [backend, setBackend] = useState<RoomBackend | null>(null);
  useEffect(() => {
    let active = true;
    setBackend(null);
    if (!lobby) return;
    void connectFirebase().then(connection => {
      if (!active) return;
      if (connection.uid !== lobby.uid) throw new Error("Session authorization changed.");
      setBackend(connection.backend);
    }).catch(error => { if (active) reportRuntimeError("connect", lifecycleMessage(error)); });
    return () => { active = false; };
  }, [lobby?.code, retry]);
  useStorytellerSync(backend);
  useApplyTravelerChoices(backend, lobby?.code);
  return lobby && error ? <div className="error-list lobby-error" role="alert">
    <strong>Lobby connection</strong><p>{error}</p>
    <button className="btn btn-sm" onClick={retryStorytellerSession}>Reconnect / reclaim expired writer</button>
  </div> : null;
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
 */
export function useApplyTravelerChoices(backend: RoomBackend | null, code: string | undefined) {
  const travelerChoices = useSessionRuntime(s => s.travelerChoices);
  useEffect(() => {
    if (!backend || !code) return;
    for (const [uid, { playerId, roleId }] of Object.entries(travelerChoices)) {
      if (!playerId) continue; // unresolved for now; retried once the roster resolves it
      void applyTravelerChoice(backend, code, uid, roleId, (id, role) => {
        const p = useStorytellerStore.getState().game?.players[id];
        // Re-check eligibility against the freshly-resolved player: only an
        // unassigned Traveler seat ever adopts the pending choice. A seat
        // that already carries a character -- a Storyteller override, or
        // this exact choice already applied -- keeps it; the request is
        // stale/superseded and is cleared without changing the role.
        if (p?.isTraveler && !p.actualRole) useStorytellerStore.getState().assignRole(id, role);
      });
    }
  }, [backend, code, travelerChoices]);
}
