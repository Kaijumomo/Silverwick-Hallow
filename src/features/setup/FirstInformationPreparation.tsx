import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildRegistry, resolvedCharacters } from "@/data/roleRegistry";
import { bindingOf, seatedParticipants, useTargetPicker } from "@/features/abilities/abilityUi";
import { RoleChooser } from "@/features/players/RoleChooser";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { preparationAvailability, preparedInformationContext } from "@/stores/preparedInformation";
import { wakeIdentity } from "@/stores/wakeIdentity";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { PreparedInformationCharacter, Script, StorytellerLobbyRecord } from "@/stores/types";
import { TokenInformationAction } from "@/features/info/TokenInformationAction";

export const FIRST_INFORMATION_CHARACTERS = new Set<string>(["washerwoman", "librarian", "investigator"]);
export const informationCategory = (character: PreparedInformationCharacter) => character === "washerwoman" ? "townsfolk" : character === "librarian" ? "outsider" : "minion";
const tokenLabel = (character: PreparedInformationCharacter) => character === "washerwoman" ? "Townsfolk" : character === "librarian" ? "Outsider" : "Minion";

/** Presentation drafts stay above dismissible Setup panels. Only the completed
 * character and pair selection invokes the authoritative preparation command. */
export function useFirstInformationPreparation(game?: StorytellerLobbyRecord, script?: Script) {
  const owner = useId();
  const privacy = usePrivacyStore(state => state.enabled);
  const authority = captureCharacterActionContext();
  const generation = useRef(0);
  const [chooser, setChooser] = useState<{ source: ParticipantBinding; character: PreparedInformationCharacter } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const registry = useMemo(() => script ? buildRegistry(script) : null, [script]);
  useEffect(() => {
    generation.current++;
    setChooser(null);
    if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel();
    return () => {
      generation.current++;
      if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel();
    };
  }, [game, script, privacy, owner, authority.lobby, authority.writerToken, authority.lifecycle]);

  const safe = () => !!game && !!script && game.phase === "setup" && !usePrivacyStore.getState().enabled
    && useStorytellerStore.getState().game === game;
  const begin = (source: ParticipantBinding, character: PreparedInformationCharacter) => {
    if (!safe()) return;
    generation.current++;
    useTargetPicker.getState().cancel();
    setError(null); setChooser({ source, character });
  };
  const zero = (source: ParticipantBinding) => {
    if (!safe()) return;
    const result = useStorytellerStore.getState().prepareInformation({ source, character: "librarian",
      clue: { kind: "zero-outsiders" }, expected: preparedInformationContext(game!, script!) }, authority);
    setError(result.ok ? null : result.message);
  };
  const chooseCharacter = (shownCharacter: string) => {
    if (!safe() || !chooser) return;
    const selected = chooser;
    const captured = captureCharacterActionContext();
    const sequence = ++generation.current;
    setChooser(null);
    const current = () => safe() && sequence === generation.current;
    const participants = seatedParticipants(game!);
    useTargetPicker.getState().start(`Choose the player for ${tokenLabel(selected.character)}`, qualifying => {
      if (!current()) return;
      useTargetPicker.getState().start("Choose the other player for Wrong", wrong => {
        if (!current()) return;
        const result = useStorytellerStore.getState().prepareInformation({ ...selected,
          clue: { kind: "pair", candidates: [qualifying, wrong], shownCharacter, qualifyingParticipantId: qualifying.participantId },
          expected: preparedInformationContext(game!, script!) }, captured);
        setError(result.ok ? null : result.message);
      }, { owner, eligible: new Set(participants.filter(player => player.participantId !== qualifying.participantId).map(player => player.participantId!)) });
    }, { owner, eligible: new Set(participants.map(player => player.participantId!)) });
  };
  const entries = game && registry && game.phase === "setup" ? seatedParticipants(game).flatMap(player => {
    const wake = wakeIdentity(player, registry);
    return wake && FIRST_INFORMATION_CHARACTERS.has(wake.role.id) && script
      && preparationAvailability(game, bindingOf(player), wake.role.id as PreparedInformationCharacter, { script, registry }).ok
      ? [{ source: bindingOf(player), character: wake.role.id as PreparedInformationCharacter, name: player.name || `Seat ${player.seat + 1}`, roleName: wake.role.name,
        prepared: game.preparedInformation.find(item => item.source.participantId === player.participantId && item.character === wake.role.id) }]
      : [];
  }) : [];
  const dialog = chooser && script && !privacy && game?.phase === "setup" ? <RoleChooser mode="select"
    roles={resolvedCharacters(script).filter(role => role.type === informationCategory(chooser.character))} scriptName={script.name}
    title="Choose the character clue" instruction="Choose the character, then its player and the other player on the board."
    onClose={() => setChooser(null)} onChoose={chooseCharacter} /> : null;
  return { begin, zero, entries, dialog, error, registry, clearError: () => setError(null) };
}

export type FirstInformationSelection = ReturnType<typeof useFirstInformationPreparation>;
export function FirstInformationPreparation({ selection, onChoose }: { selection: FirstInformationSelection; onChoose?: () => void }) {
  const privacy = usePrivacyStore(state => state.enabled);
  if (privacy || !selection.entries.length) return null;
  return <div aria-label="First-night information preparation">{selection.entries.map(entry => <div className="setup-prep-row" key={entry.source.participantId}>
    <span className="setup-prep-name">{entry.roleName} · {entry.name}</span>
    <TokenInformationAction compact role={entry.prepared?.clue.kind === "pair" ? selection.registry?.get(entry.prepared.clue.shownCharacter) : undefined}
      label={`${entry.prepared ? "Change" : "Prepare"} ${entry.roleName}`} onClick={() => { selection.begin(entry.source, entry.character); onChoose?.(); }} />
    {entry.character === "librarian" && <button className="btn btn-sm" onClick={() => selection.zero(entry.source)}>Show 0 Outsiders</button>}
  </div>)}</div>;
}
