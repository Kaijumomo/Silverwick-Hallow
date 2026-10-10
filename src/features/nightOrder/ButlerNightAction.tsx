import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildRegistry } from "@/data/roleRegistry";
import { seatedParticipants, useTargetPicker } from "@/features/abilities/abilityUi";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { butlerReminderOrigin, butlerSelectionAvailability, butlerSelectionContext } from "@/stores/butlerSelection";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";

/** A direct board choice composes existing private notation and Night progress.
 * Unsupported or impaired turns retain only the parent's instructions and Next. */
export function ButlerNightAction({ game, script, source, visible, resolved, onResolved }: {
  game: StorytellerLobbyRecord; script: Script; source: ParticipantBinding;
  visible: boolean; resolved: boolean; onResolved: (game: StorytellerLobbyRecord) => void;
}) {
  const owner = useId();
  const registry = useMemo(() => buildRegistry(script), [script]);
  const privacy = usePrivacyStore(s => s.enabled);
  const authority = captureCharacterActionContext();
  const available = butlerSelectionAvailability(game, source, { script, registry }).ok;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const live = useRef({ game, visible, privacy });
  live.current = { game, visible, privacy };
  useEffect(() => {
    if (!visible || privacy || !available || resolved) return;
    let active = true;
    useTargetPicker.getState().start("Butler: choose a Master", target => {
      if (!active || live.current.game !== game || !live.current.visible || live.current.privacy
        || usePrivacyStore.getState().enabled || useStorytellerStore.getState().game !== game) return;
      const result = useStorytellerStore.getState().selectButlerMaster({ source, target, expected: butlerSelectionContext(game, script, source) }, authority);
      if (!result.ok) { setError(result.message); setAttempt(value => value + 1); return; }
      setError(null); onResolved(useStorytellerStore.getState().game!);
    }, { owner, eligible: new Set(seatedParticipants(game).filter(p => p.participantId !== source.participantId).map(p => p.participantId!)) });
    return () => { active = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
  }, [game, script, source.playerId, source.participantId, owner, visible, privacy, available, resolved, attempt, authority.writerToken, authority.lifecycle, authority.lobby]);
  if (!visible || privacy || !available) return null;
  const master = resolved ? seatedParticipants(game).find(player => player.reminders.some(reminder =>
    butlerReminderOrigin(reminder)?.participantId === source.participantId && reminder.sourceParticipant?.playerId === source.playerId)) : undefined;
  return <div className="night-information">
    <p className={resolved ? "modern-night-result" : "modern-night-pick"}>{resolved ? master ? `Master: ${master.name || `Seat ${master.seat + 1}`}` : "Completed" : "Tap another player to choose a Master."}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
