import { useRef } from "react";
import type { RoleRegistry } from "@/data/roleRegistry";
import { usePrivacyStore } from "@/stores/privacyStore";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { goodTwinIntents, twinPairOf } from "@/stores/twinPair";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import type { NightStep } from "@/rules/night/nightOrder";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";
import { flash } from "../v6Store";
import { presentCharacter, report } from "../info/actions";
import { WakeTokensRow } from "./WakeTokensRow";

type Props = {
  game: StorytellerLobbyRecord; registry: RoleRegistry; step: Extract<NightStep, { kind: "player" }>;
  visible: boolean; resolved: boolean; onResolved: (game: StorytellerLobbyRecord) => void;
};

/**
 * SV-4c: the Evil Twin's Night card (https://wiki.bloodontheclocktower.com/Evil_Twin), in the Philosopher card's language. "During the
 * first night, wake both Twins. Let them make eye contact. Point at the Evil Twin, then show the Evil Twin token to the Good Twin. Point at
 * the Good Twin, then show the Good Twin's character token to the Evil Twin."
 *
 * While the pair stands the card is the "Wake" rows, one per Twin, each with its one reveal token (the Evil Twin's character for the Good
 * Twin; the Good Twin's TRUE character for the Evil Twin: PO 2026-11-21), and Done, which completes the step. Showing a token is
 * presentation only (the existing player-safe reveal) and records nothing. When the pair broke (both the same alignment, a Pit-Hag made
 * a new Evil Twin) the Storyteller chooses the new Good Twin by tapping the grimoire: that moves the TWIN token in one commit (one Undo),
 * and the reveals appear. Hidden in Privacy Mode, like every Night step.
 */
export function EvilTwinNightAction({ game, registry, step, visible, resolved, onResolved }: Props) {
  const privacy = usePrivacyStore((s) => s.enabled);
  const live = useRef({ game, visible });
  live.current = { game, visible };
  if (!visible || privacy || step.isDeceived) return null;
  const pair = twinPairOf(game.players);
  if (pair.kind === "many") return <div className="gv-choice"><hr className="gv-choice-divider" />
    <p className="gv-choice-note">More than one Evil Twin is in play: introduce the Twins by hand.</p></div>;
  if (pair.kind !== "single" || pair.evil.participantId !== step.participantId) return null;
  const nameOf = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;
  const actionContext = captureCharacterActionContext();
  const safe = () => live.current.visible && !usePrivacyStore.getState().enabled && useStorytellerStore.getState().game === live.current.game;

  if (!pair.valid) {
    if (resolved) return null;
    const evil = pair.evil;
    const choose = () => {
      if (!safe() || !evil.participantId) return;
      const eligible = new Set(Object.values(game.players).filter((p) => !p.isEmpty && !!p.participantId && !p.isTraveler && p.id !== evil.id
        && !!p.actualAlignment && !!evil.actualAlignment && p.actualAlignment !== evil.actualAlignment).map((p) => p.participantId!));
      flash("Tap the new Good Twin.");
      useTargetPicker.getState().start("the new Good Twin", (target) => {
        const current = useStorytellerStore.getState().game;
        if (!current || current !== live.current.game || !live.current.visible || usePrivacyStore.getState().enabled) { flash("The game changed. Choose again."); return; }
        const intents = goodTwinIntents(current, { playerId: evil.id, participantId: evil.participantId! }, target);
        if (!intents.ok) { flash(intents.message); return; }
        const result = useStorytellerStore.getState().resolveEffects({ intents: intents.intents }, captureCharacterActionContext());
        if (!result.ok) { flash(result.message); return; }
        flash(`${nameOf(current.players[target.playerId]!)} is the Good Twin.`);
      }, { owner: `eviltwin:${step.stepKey}`, eligible });
    };
    return <div className="gv-choice">
      <hr className="gv-choice-divider" />
      <p className="gv-choice-note">{`${pair.reason} Choose the new Good Twin.`}</p>
      <div className="gv-choice-actions" role="group" aria-label="The Evil Twin's Good Twin">
        <button className="gv-choice-confirm" type="button" onClick={choose}>Choose Good Twin</button>
      </div>
    </div>;
  }

  const evilRole = registry.get("eviltwin");
  const other = pair.other!;
  const otherRole = registry.get(other.actualRole ?? "");
  const done = () => {
    if (!safe()) return;
    const result = useStorytellerStore.getState().setNightStepStatus(game.day, step.stepKey, "done", actionContext);
    if (!result.ok) { flash(result.message); return; }
    onResolved(useStorytellerStore.getState().game!);
  };
  return <div className="gv-choice">
    <hr className="gv-choice-divider" />
    {evilRole && <WakeTokensRow name={nameOf(other)}
      first={{ heading: "This Character", role: evilRole, onOpen: () => report(presentCharacter("This Character", evilRole.id)) }} />}
    {otherRole && <WakeTokensRow name={nameOf(pair.evil)}
      first={{ heading: "This Character", role: otherRole, onOpen: () => report(presentCharacter("This Character", otherRole.id)) }} />}
    {!resolved && <div className="gv-choice-actions" role="group" aria-label="The Twins">
      <button className="gv-choice-confirm" type="button" onClick={done}>Done</button>
    </div>}
  </div>;
}
