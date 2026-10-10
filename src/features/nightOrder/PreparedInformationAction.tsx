import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { buildRegistry, resolvedCharacters } from "@/data/roleRegistry";
import { bindingOf, seatedParticipants, useTargetPicker } from "@/features/abilities/abilityUi";
import { InfoPresentationBoundary, useInfoPresentation } from "@/features/info/InfoPresentationBoundary";
import { captureInfoContext, infoContextCurrent } from "@/features/info/infoCommands";
import { characterCard } from "@/features/info/infoModel";
import { RoleChooser } from "@/features/players/RoleChooser";
import { informationCategory } from "@/features/setup/FirstInformationPreparation";
import { preparationAvailability, preparedInformationContext, validatePreparedInformation, type PrepareInformationRequest } from "@/stores/preparedInformation";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import type { PreparedInformationCharacter, Script, StorytellerLobbyRecord } from "@/stores/types";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { NightStep } from "./nightOrder";
import type { NightInformationHandle } from "./NightInformationAction";

type Props = { game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "player" }>;
  visible: boolean; resolved: boolean; onResolved: (game: StorytellerLobbyRecord) => void };

export const PreparedInformationAction = forwardRef<NightInformationHandle, Props>(function PreparedInformationAction(props, ref) {
  return <InfoPresentationBoundary><PreparedAction {...props} ref={ref} /></InfoPresentationBoundary>;
});

const PreparedAction = forwardRef<NightInformationHandle, Props>(function PreparedAction({ game, script, step, visible, resolved, onResolved }, ref) {
  const registry = useMemo(() => buildRegistry(script), [script]);
  const environment = useMemo(() => ({ registry, script }), [registry, script]);
  const actor = game.players[step.playerId]!;
  const character = step.effectiveRoleId as PreparedInformationCharacter;
  const source = bindingOf(actor);
  const record = game.preparedInformation.find(item => item.source.participantId === step.participantId && item.character === character);
  const validation = record && !resolved ? validatePreparedInformation(game, record, environment) : null;
  const availability = record && !resolved ? preparationAvailability(game, source, character, environment) : null;
  const choosing = availability?.ok && availability.mode === "storyteller";
  const [chooser, setChooser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presented, setPresented] = useState<StorytellerLobbyRecord | null>(null);
  const present = useInfoPresentation();
  const live = useRef({ game, visible });
  live.current = { game, visible };
  const owner = `prepared-information:${step.stepKey}`;
  const authority = captureCharacterActionContext();
  const safe = () => live.current.visible && live.current.game === game && useStorytellerStore.getState().game === game
    && !usePrivacyStore.getState().enabled;
  useEffect(() => {
    live.current.visible = visible;
    return () => { live.current.visible = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
  }, [visible, game, owner]);
  useEffect(() => { setChooser(false); setError(null); }, [game]);

  const show = (roleId: string, expectedGame = game) => {
    const context = captureInfoContext();
    const role = registry.get(roleId);
    if (!role || !live.current.visible || context.game !== expectedGame || !infoContextCurrent(context)) return;
    setPresented(expectedGame);
    present({ context, payload: { kind: "character", heading: "This Character", character: characterCard(role) } });
  };
  const replace = (clue: PrepareInformationRequest["clue"], reveal?: string) => {
    if (!safe()) return;
    const result = useStorytellerStore.getState().prepareInformation({ source, character, clue,
      expected: preparedInformationContext(game, script) }, authority);
    if (!result.ok) { setError(result.message); return; }
    setChooser(false);
    if (reveal) show(reveal, useStorytellerStore.getState().game!);
  };
  const chooseCharacter = (shownCharacter: string) => {
    if (!safe() || !record) return;
    if (record.clue.kind === "pair") {
      replace({ kind: "pair", candidates: record.clue.candidates.map(candidate => ({ playerId: candidate.participant.playerId, participantId: candidate.participant.participantId })) as [ParticipantBinding, ParticipantBinding],
        qualifyingParticipantId: record.clue.qualifyingParticipantId, shownCharacter }, shownCharacter);
      return;
    }
    setChooser(false);
    const players = seatedParticipants(game);
    useTargetPicker.getState().start("Choose the first player", first => {
      if (!safe()) return;
      useTargetPicker.getState().start("Choose the other player", second => {
        if (safe()) replace({ kind: "pair", candidates: [first, second], qualifyingParticipantId: first.participantId, shownCharacter }, shownCharacter);
      }, { owner, eligible: new Set(players.filter(player => player.participantId !== first.participantId).map(player => player.participantId!)) });
    }, { owner, eligible: new Set(players.map(player => player.participantId!)) });
  };
  useImperativeHandle(ref, () => ({ next: () => {
    if (resolved || !record || !validation?.ok) return true;
    if (record.clue.kind === "pair" && presented !== game) return true;
    if (!safe()) return false;
    const result = useStorytellerStore.getState().deliverPreparedInformation({ source, preparationId: record.id,
      expected: preparedInformationContext(game, script) }, authority);
    if (!result.ok) { setError(result.message); return false; }
    onResolved(useStorytellerStore.getState().game!);
    return true;
  } }));

  const delivered = resolved ? game.informationDeliveries.filter(item => item.kind !== "manual"
    && item.recipient.kind === "participant" && item.recipient.participantId === step.participantId
    && item.actualRole === step.actualRoleId && (item.performedRole ?? item.actualRole) === character
    && [ `${character}-first-night`, ...(character === "librarian" ? ["librarian-first-night-zero"] : []) ].includes(item.informationActionId)
    && item.moment?.phase === "night" && item.moment.day === 1) : [];
  const values = delivered.length === 1 ? delivered[0]!.values : [];
  const token = values?.find(value => value.kind === "role");
  const pair = values?.find(value => value.kind === "player");
  const zero = values?.some(value => value.kind === "number" && value.value === 0);
  const clue = validation?.ok ? record?.clue : undefined;
  const names = clue?.kind === "pair" ? clue.candidates.map(candidate => game.players[candidate.participant.playerId]?.name || candidate.participant.nameAtTime)
    : pair?.kind === "player" ? pair.participants.map(participant => participant.kind === "participant" ? participant.nameAtTime : "Player") : [];
  const roleId = clue?.kind === "pair" ? clue.shownCharacter : token?.kind === "role" ? token.roleId : undefined;
  return <div className="night-information">
    {!!names.length && <p className="behavior-help">{names.join(" or ")} · {roleId ? registry.get(roleId)?.name : ""}</p>}
    {(clue?.kind === "zero-outsiders" || zero) && <div className="night-information-answer" role="status" aria-label="Information to communicate">0</div>}
    {(roleId || choosing) && <button className="btn btn-gold" onClick={() => {
      if (!safe()) return;
      if (choosing) setChooser(true);
      else if (roleId) show(roleId);
    }}>Reveal a Token</button>}
    {choosing && character === "librarian" && <button className="btn" onClick={() => replace({ kind: "zero-outsiders" })}>Show 0 Outsiders</button>}
    {resolved && <p className="modern-night-result">Completed</p>}
    {error && <p role="alert">{error}</p>}
    {chooser && visible && <RoleChooser mode="select" roles={resolvedCharacters(script).filter(role => role.type === informationCategory(character))}
      scriptName={script.name} title="This Character" instruction="Choose the character token to reveal."
      onChoose={chooseCharacter} onClose={() => setChooser(false)} error={error ?? undefined} />}
  </div>;
});
