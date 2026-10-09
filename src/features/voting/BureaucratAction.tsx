import { useEffect, useId, useRef, useState } from "react";
import { captureVotingContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { secureUuid } from "@/stores/secureUuid";
import { currentVotingState } from "@/stores/voting";
import { boundParticipant } from "@/stores/rulesQuery";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import type { VotingBinding } from "@/stores/votingTypes";
import type { StorytellerLobbyRecord } from "@/stores/types";

type Props = {
  source: VotingBinding;
  target?: VotingBinding;
  visible?: boolean;
  completeStep?: { day: number; stepKey: string };
  onResolved?: (game: StorytellerLobbyRecord) => void;
};

/** Explicit official ability action. Free-form Reminder text never invokes it. */
export function BureaucratAction({ source, target, visible = true, completeStep, onResolved }: Props) {
  const game = useStorytellerStore(s => s.game);
  const privacy = usePrivacyStore(s => s.enabled);
  const owner = useId();
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ name: string; game: StorytellerLobbyRecord } | null>(null);
  const mounted = useRef(true);
  const active = useTargetPicker(s => s.active);
  const context = captureVotingContext();
  const live = useRef({ game, visible, privacy });
  live.current = { game, visible, privacy };
  const actor = game ? boundParticipant(game, source) : null;
  const allowed = !!game && (game.phase === "night" || game.phase === "day") && actor?.actualRole === "bureaucrat" && actor.alive && !privacy && visible;
  const candidates = game ? game.seatOrder.flatMap(id => {
    const p = game.players[id];
    return p && !p.isEmpty && p.participantId && p.participantId !== source.participantId ? [p] : [];
  }) : [];
  const choose = (chosen: VotingBinding) => {
    if (!game || !allowed || !mounted.current || !live.current.visible || live.current.privacy || live.current.game !== game
      || usePrivacyStore.getState().enabled || useStorytellerStore.getState().game !== game) return;
    const result = useStorytellerStore.getState().resolveVoting({ kind: "bureaucrat", modifierId: secureUuid(), source, target: chosen,
      code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision, ...(completeStep ? { completeStep } : {}) }, context);
    if (!result.ok) { setError(result.message); return; }
    const committed = useStorytellerStore.getState().game!;
    setError(null); setPaused(true); setSuccess({ name: game.players[chosen.playerId]?.name || "Chosen player", game: committed });
    if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel();
    onResolved?.(committed);
  };
  useEffect(() => {
    if (success && success.game !== game) { setSuccess(null); setPaused(false); }
  }, [game, success]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
  }, [owner]);
  useEffect(() => {
    if (!allowed || target || paused || success) return;
    useTargetPicker.getState().start("Bureaucrat: 3 Votes", choose, { owner, eligible: new Set(candidates.map(p => p.participantId!)) });
    return () => { if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
  }, [game, allowed, target, paused, success, source.playerId, source.participantId]);
  if (!allowed) return null;
  return <div className="bureaucrat-action" aria-label="Bureaucrat voting ability">
    {success ? <p className="modern-night-result" role="status">3 Votes recorded for {success.name}.</p> : target ?
      <button type="button" className="btn btn-sm" onClick={() => choose(target)}>Apply 3 Votes from {actor!.name || "Bureaucrat"}</button> : <>
        <p className="modern-night-pick">Choose another player for 3 Votes on Day {game!.day}.</p>
        <div className="modern-night-pick-controls"><button type="button" className="btn btn-sm" onClick={() => {
          if (active?.owner === owner) { useTargetPicker.getState().cancel(); setPaused(true); } else setPaused(false);
        }}>{active?.owner === owner ? "Cancel selection" : "Choose on board"}</button></div>
        <details className="modern-night-guidance"><summary>Choose from roster</summary><div className="modern-night-roster">
          {candidates.map(p => <button type="button" className="btn btn-sm" key={p.participantId}
            onClick={() => choose({ playerId: p.id, participantId: p.participantId! })}>{p.name || `Seat ${p.seat + 1}`}</button>)}
        </div></details>
      </>}
    {error && <p role="alert" className="life-error">{error}</p>}
  </div>;
}
