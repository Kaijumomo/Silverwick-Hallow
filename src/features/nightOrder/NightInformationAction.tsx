import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs } from "@/abilities/semantics";
import { captureFingerprint, planAbilityResolution, type GuidedAbilityRequest, type ParticipantBinding } from "@/stores/abilityResolution";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { buildRegistry } from "@/data/roleRegistry";
import { bindingOf, seatedParticipants, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import type { NightStep } from "./nightOrder";
import { chefMaximumPairs } from "@/abilities/characters/chef";
import { createRulesQuery } from "@/stores/rulesQuery";

export const CALCULATED_INFORMATION_ROLES = new Set(["chef", "empath", "fortuneteller"]);
const EMPTY_INPUTS: AbilityInputs = {};
export type NightInformationHandle = { next: () => boolean };
type Props = {
  game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "player" }>;
  ability: Extract<StepAbility, { kind: "guided" }>; visible: boolean; resolved: boolean;
  onResolved: (game: StorytellerLobbyRecord) => void; onManual: () => void;
};

/** In-panel presentation of the existing coordinator's result. No rules or
 * persisted draft live here. A preview alone is never a delivery. */
export const NightInformationAction = forwardRef<NightInformationHandle, Props>(function NightInformationAction(
  { game, script, step, ability, visible, resolved, onResolved, onManual }, ref,
) {
  const registry = useMemo(() => buildRegistry(script), [script]);
  const environment = useMemo(() => ({ script, registry, semantics: CANONICAL_ABILITY_SEMANTICS }), [script, registry]);
  const [draft, setDraft] = useState<{ game: StorytellerLobbyRecord; inputs: AbilityInputs }>({ game, inputs: {} });
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ game, visible, resolved });
  live.current = { game, visible, resolved };
  const submitted = useRef<StorytellerLobbyRecord | null>(null);
  const inputs = draft.game === game ? draft.inputs : EMPTY_INPUTS;
  const owner = `night-information:${game.day}:${step.stepKey}`;
  const actionContext = captureCharacterActionContext();
  const fingerprint = captureFingerprint(game, step.playerId, { day: game.day, stepKey: step.stepKey });
  const request = (answers: AbilityInputs): GuidedAbilityRequest => ({ mode: "guided", invocationPath: "nightOrder",
    fingerprint: fingerprint!, roleId: step.effectiveRoleId, inputs: answers, completeStep: true });
  const hasTargets = step.effectiveRoleId !== "fortuneteller" || inputs.targets?.kind === "participant" && inputs.targets.participants.length === 2;
  const preview = useMemo(() => !resolved && fingerprint && hasTargets ? planAbilityResolution(game, request(inputs), environment) : null,
    [game, inputs, resolved, step.stepKey, environment]);
  const requirement = preview && !preview.ok && preview.code === "needsInput" && preview.requirements?.length === 1
    ? preview.requirements[0] : undefined;
  const safe = () => live.current.game === game && live.current.visible && !live.current.resolved
    && useStorytellerStore.getState().game === game && !usePrivacyStore.getState().enabled && submitted.current !== game;
  const commit = (answers: AbilityInputs) => {
    if (!safe() || !fingerprint) return false;
    const result = useStorytellerStore.getState().resolveAbility(request(answers), CANONICAL_ABILITY_SEMANTICS, actionContext);
    if (!result.ok) { setError(result.message); return false; }
    submitted.current = game;
    useTargetPicker.getState().cancel();
    onResolved(useStorytellerStore.getState().game!);
    return true;
  };
  useImperativeHandle(ref, () => ({ next: () => {
    if (resolved) return true;
    // Next means the displayed calculated answer was communicated. An
    // unanswered picker/target is a manual continuation, with no delivery.
    return preview?.ok && preview.changed ? commit(inputs) : true;
  } }));
  useEffect(() => {
    if (preview && !preview.ok && preview.code !== "needsInput") onManual();
    else if (requirement?.source === "judgment") onManual();
  }, [preview?.ok, preview && !preview.ok ? preview.code : undefined, requirement?.source]);
  const targets = inputs.targets?.kind === "participant" ? inputs.targets.participants : [];
  const needsTargets = !resolved && step.effectiveRoleId === "fortuneteller" && targets.length < 2;
  const choose = (target: ParticipantBinding) => {
    if (!safe() || targets.some(other => other.participantId === target.participantId)) return;
    const next = { targets: { kind: "participant" as const, participants: [...targets, target] } };
    setDraft({ game, inputs: next });
    if (next.targets.participants.length < 2) return;
    useTargetPicker.getState().cancel();
    const plan = planAbilityResolution(game, request(next), environment);
    if (plan.ok) commit(next);
    else if (plan.code !== "needsInput" || plan.requirements?.some(item => item.source === "judgment")) onManual();
  };
  useEffect(() => {
    if (!visible || paused || !needsTargets) return;
    let active = true;
    const eligible = new Set(seatedParticipants(game).filter(player => !targets.some(target => target.participantId === player.participantId)).map(player => player.participantId!));
    useTargetPicker.getState().start(`Choose player ${targets.length + 1} of 2`, target => { if (active) choose(target); }, { owner, eligible });
    return () => { active = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
  }, [visible, paused, needsTargets, game, inputs]);
  useEffect(() => () => { live.current.visible = false; }, []);
  useEffect(() => { if (draft.game !== game) { setDraft({ game, inputs: {} }); setPaused(false); setError(null); } }, [game]);

  const delivery = resolved ? [...game.informationDeliveries].reverse().find(item => item.kind !== "manual"
    && item.recipient.kind === "participant" && item.recipient.participantId === step.participantId
    && item.moment?.phase === "night" && item.moment.day === game.day
    && ability.descriptor.informationActions?.includes(item.informationActionId)) : undefined;
  const operation = preview?.ok && preview.changed ? preview.plan.outcome.operations.find(item => item.domain === "information") : undefined;
  const values = delivery?.values ?? (operation?.domain === "information" ? operation.values : []);
  const value = values?.find(item => item.kind === "number" || item.kind === "boolean");
  const numberChoices = step.effectiveRoleId === "chef" ? Array.from({ length: chefMaximumPairs(createRulesQuery(game, environment)) + 1 }, (_, index) => index) : [0, 1, 2];
  const choices = requirement?.kind === "boolean" ? [false, true] : numberChoices;
  return <div className="night-information">
    {value && <div className="night-information-answer" role="status" aria-label="Information to communicate">
      {value.kind === "boolean" ? value.value ? "YES" : "NO" : value.kind === "number" ? value.value : ""}
    </div>}
    {!resolved && requirement?.source === "storyteller" && ["number", "boolean"].includes(requirement.kind) && <>
      <p className="behavior-help">Choose the information to communicate.</p>
      <div className="night-information-choices" role="group" aria-label="Information to communicate">{choices.map(choice =>
        <button className="btn" key={String(choice)} type="button" onClick={() => commit({ ...inputs,
          [requirement.id]: typeof choice === "boolean" ? { kind: "boolean", value: choice } : { kind: "number", value: choice } })}>
          {typeof choice === "boolean" ? choice ? "YES" : "NO" : choice}</button>)}</div>
    </>}
    {needsTargets && <>
      <p className="modern-night-pick">Choose player {targets.length + 1} of 2 on the board.</p>
      {!!targets.length && <p className="behavior-help">Selected: {targets.map(target => game.players[target.playerId]?.name).join(", ")}</p>}
      <button className="btn btn-sm" onClick={() => { setPaused(!paused); if (!paused) useTargetPicker.getState().cancel(); }}>{paused ? "Choose on board" : "Cancel selection"}</button>
      <details className="modern-night-guidance"><summary>More options</summary><div className="modern-night-roster">{seatedParticipants(game).filter(player => !targets.some(target => target.participantId === player.participantId)).map(player =>
        <button className="btn btn-sm" key={player.id} onClick={() => choose(bindingOf(player))}>{player.name || `Seat ${player.seat + 1}`}</button>)}</div></details>
    </>}
    {resolved && <p className="modern-night-result">Completed</p>}
    {error && <p role="alert" className="behavior-help">{error}</p>}
  </div>;
});
