import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs } from "@/abilities/semantics";
import { captureFingerprint, planAbilityResolution, type AbilityResolutionRequest, type ParticipantBinding } from "@/stores/abilityResolution";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { buildRegistry } from "@/data/roleRegistry";
import { seatedParticipants, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import type { RoleDef, RoleType, Script, StorytellerLobbyRecord } from "@/stores/types";
import type { NightStep } from "@/rules/night/nightOrder";
import { chefMaximumPairs } from "@/abilities/characters/chef";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureInfoContext, infoContextCurrent } from "@/features/info/infoCommands";
import { isDeathEvent } from "@/stores/lifeEvents";
import { QuestionBlock } from "@/features/grimoire-v6/day/NominationExtras";

export const CALCULATED_INFORMATION_ROLES = new Set(["chef", "empath", "fortuneteller", "towncrier", "oracle"]);
export const NIGHT_INFORMATION_ROLES = new Set([...CALCULATED_INFORMATION_ROLES, "undertaker", "ravenkeeper"]);
const EMPTY_INPUTS: AbilityInputs = {};
export type NightInformationHandle = { next: () => boolean };
/** How a host screen reveals a character token: its own button, character picker and player view.
 * The action still owns the ability: it plans, commits and decides which token is shown. */
export type RevealHost = {
  button: (props: { role?: RoleDef; onClick: () => void }) => ReactNode;
  show: (roleId: string) => void;
  /** `pick` answers with a refusal message, or undefined once the token was accepted. */
  choose: (pick: (roleId: string) => string | undefined, types?: RoleType[]) => void;
  cancel: () => void;
};
type Props = {
  game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "player" }>;
  ability: Extract<StepAbility, { kind: "guided" }>; visible: boolean; resolved: boolean;
  onResolved: (game: StorytellerLobbyRecord) => void; onManual: () => void; reveal: RevealHost;
};

/** In-panel presentation of the existing coordinator's result. No rules or
 * persisted draft live here. A preview alone is never a delivery. The host (the Grimoire's Night card) owns the
 * token button, the character picker and the player view; there is no second, built-in presentation path. */
export const NightInformationAction = forwardRef<NightInformationHandle, Props>(function NightInformationAction(
  { game, script, step, ability, visible, resolved, onResolved, onManual, reveal }, ref,
) {
  const registry = useMemo(() => buildRegistry(script), [script]);
  const environment = useMemo(() => ({ script, registry, semantics: CANONICAL_ABILITY_SEMANTICS }), [script, registry]);
  const [draft, setDraft] = useState<{ game: StorytellerLobbyRecord; inputs: AbilityInputs }>({ game, inputs: {} });
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualWake, setManualWake] = useState(false);
  const [acceptedToken, setAcceptedToken] = useState<{ game: StorytellerLobbyRecord; stepKey: string; roleId: string } | null>(null);
  const characterInformation = step.effectiveRoleId === "undertaker" || step.effectiveRoleId === "ravenkeeper";
  const simulatedRavenkeeper = step.effectiveRoleId === "ravenkeeper" && step.isDeceived;
  const live = useRef({ game, visible, resolved });
  live.current = { game, visible, resolved };
  const submitted = useRef<StorytellerLobbyRecord | null>(null);
  const inputs = draft.game === game ? draft.inputs : EMPTY_INPUTS;
  const owner = `night-information:${game.day}:${step.stepKey}`;
  const actionContext = captureCharacterActionContext();
  const trigger = !simulatedRavenkeeper && ability.trigger && ability.trigger.kind !== "notTriggered" ? { eventId: ability.trigger.eventId } : undefined;
  const fingerprint = captureFingerprint(game, step.playerId, { day: game.day, stepKey: step.stepKey }, trigger);
  const request = (answers: AbilityInputs): AbilityResolutionRequest => {
    if (simulatedRavenkeeper) return { mode: "manual", fingerprint: fingerprint!, roleId: "ravenkeeper", completeStep: true,
      reason: "Storyteller-initiated simulated Ravenkeeper information",
      outcome: { operations: [{ domain: "information", recipient: fingerprint!.actor, performedRole: "ravenkeeper",
        informationActionId: "ravenkeeper-triggered", values: [
          { requirementId: "chosenPlayer", kind: "player", participants: answers.target?.kind === "participant" ? answers.target.participants : [] },
          { requirementId: "role", kind: "role", roleId: answers.shown?.kind === "character" ? answers.shown.roleIds[0]! : "" },
        ] }] } };
    return { mode: "guided", invocationPath: ability.invocationPath ?? "nightOrder",
      fingerprint: fingerprint!, roleId: step.effectiveRoleId, inputs: answers, completeStep: true };
  };
  const targetId = step.effectiveRoleId === "ravenkeeper" ? "target" : "targets";
  const targetCount = step.effectiveRoleId === "ravenkeeper" ? 1 : 2;
  const hasTargets = !["fortuneteller", "ravenkeeper"].includes(step.effectiveRoleId)
    || inputs[targetId]?.kind === "participant" && inputs[targetId].participants.length === targetCount;
  const preview = useMemo(() => !resolved && !simulatedRavenkeeper && fingerprint && hasTargets ? planAbilityResolution(game, request(inputs), environment) : null,
    [game, inputs, resolved, step.stepKey, environment]);
  const requirement = preview && !preview.ok && preview.code === "needsInput" && preview.requirements?.length === 1
    ? preview.requirements[0] : undefined;
  const choosing = useRef(false);
  const openChooser = (answers: AbilityInputs, id: string) => {
    choosing.current = true;
    reveal.choose(roleId => {
      if (!safe()) return "The game changed. Review this step again.";
      return commit({ ...answers, [id]: { kind: "character", roleIds: [roleId] } }, roleId) ? undefined : "That token could not be shown. Review this step.";
    });
  };
  useEffect(() => () => { if (choosing.current) reveal.cancel(); }, [game, step.stepKey]);
  const safe = () => live.current.game === game && live.current.visible && !live.current.resolved
    && useStorytellerStore.getState().game === game && !usePrivacyStore.getState().enabled && submitted.current !== game;
  const showCharacter = (roleId: string, expectedGame = game) => {
    if (!live.current.visible || useStorytellerStore.getState().game !== expectedGame || usePrivacyStore.getState().enabled) return;
    const context = captureInfoContext(), role = registry.get(roleId);
    if (!role || !infoContextCurrent(context)) return;
    reveal.show(roleId);
  };
  const commit = (answers: AbilityInputs, revealRole?: string) => {
    if (!safe() || !fingerprint) return false;
    const result = useStorytellerStore.getState().resolveAbility(request(answers), CANONICAL_ABILITY_SEMANTICS, actionContext);
    if (!result.ok) { setError(result.message); return false; }
    submitted.current = game;
    useTargetPicker.getState().cancel();
    choosing.current = false;
    const committed = useStorytellerStore.getState().game!;
    if (revealRole) setAcceptedToken({ game: committed, stepKey: step.stepKey, roleId: revealRole });
    onResolved(committed);
    if (revealRole) showCharacter(revealRole, committed);
    return true;
  };
  useImperativeHandle(ref, () => ({ next: () => {
    if (resolved || characterInformation) return true;
    // Next means the displayed calculated answer was communicated. An
    // unanswered picker/target is a manual continuation, with no delivery.
    return preview?.ok && preview.changed ? commit(inputs) : true;
  } }));
  useEffect(() => {
    if (preview && !preview.ok && preview.code !== "needsInput") onManual();
    else if (requirement?.source === "judgment") onManual();
  }, [preview?.ok, preview && !preview.ok ? preview.code : undefined, requirement?.source]);
  const targetInput = inputs[targetId];
  const targets = targetInput?.kind === "participant" ? targetInput.participants : [];
  const needsTargets = !resolved && ["fortuneteller", "ravenkeeper"].includes(step.effectiveRoleId) && targets.length < targetCount
    && (!simulatedRavenkeeper || manualWake);
  const choose = (target: ParticipantBinding) => {
    if (!safe() || targets.some(other => other.participantId === target.participantId)) return;
    const next: AbilityInputs = { [targetId]: { kind: "participant", participants: [...targets, target] } };
    setDraft({ game, inputs: next });
    if (targets.length + 1 < targetCount) return;
    useTargetPicker.getState().cancel();
    if (simulatedRavenkeeper) { openChooser(next, "shown"); return; }
    const plan = planAbilityResolution(game, request(next), environment);
    if (plan.ok) {
      const operation = plan.changed ? plan.plan.outcome.operations.find(item => item.domain === "information") : undefined;
      const token = operation?.domain === "information" ? operation.values.find(value => value.kind === "role") : undefined;
      commit(next, token?.kind === "role" ? token.roleId : undefined);
    }
    else if (plan.code === "needsInput" && plan.requirements?.length === 1 && plan.requirements[0]?.source === "storyteller" && plan.requirements[0].kind === "character") {
      openChooser(next, plan.requirements[0].id);
    }
    else if (plan.code !== "needsInput" || plan.requirements?.some(item => item.source === "judgment")) onManual();
  };
  useEffect(() => {
    if (!visible || paused || !needsTargets) return;
    let active = true;
    const eligible = new Set(seatedParticipants(game).filter(player => !targets.some(target => target.participantId === player.participantId)).map(player => player.participantId!));
    useTargetPicker.getState().start(targetCount === 1 ? "Choose a player" : `Choose player ${targets.length + 1} of 2`, target => { if (active) choose(target); }, { owner, eligible });
    return () => { active = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
  }, [visible, paused, needsTargets, game, inputs]);
  useEffect(() => {
    live.current.visible = visible;
    return () => { live.current.visible = false; };
  }, [visible]);
  useEffect(() => { if (draft.game !== game) { setDraft({ game, inputs: {} }); setPaused(false); setError(null); setManualWake(false); } }, [game]);

  const deaths = step.effectiveRoleId === "ravenkeeper" && !simulatedRavenkeeper
    ? createRulesQuery(game, environment).lifeEvents({ phase: "night", day: game.day }, event => isDeathEvent(event)
      && event.subject.participantId === step.participantId && event.actualRoleAtEvent === "ravenkeeper") : null;
  // Existing delivery records deliberately have no trigger-event binding.
  // Do not attach an earlier reveal to a later manual wake after reload. The
  // just-accepted local presentation remains exact without adding persistence.
  const canReplay = !deaths || deaths.status === "known" && deaths.events.length === 1;
  const deliveries = resolved && canReplay ? game.informationDeliveries.filter(item => item.kind !== "manual"
    && item.recipient.kind === "participant" && item.recipient.participantId === step.participantId
    && item.actualRole === step.actualRoleId && (item.performedRole ?? item.actualRole) === step.effectiveRoleId
    && item.moment?.phase === "night" && item.moment.day === game.day
    && ability.descriptor.informationActions?.includes(item.informationActionId)) : [];
  const delivery = deliveries.length === 1 ? deliveries[0] : undefined;
  const operation = preview?.ok && preview.changed ? preview.plan.outcome.operations.find(item => item.domain === "information") : undefined;
  const values = delivery?.values ?? (operation?.domain === "information" ? operation.values : []);
  const value = values?.find(item => item.kind === "number" || item.kind === "boolean");
  const token = acceptedToken?.game === game && acceptedToken.stepKey === step.stepKey
    ? { kind: "role" as const, roleId: acceptedToken.roleId } : values?.find(item => item.kind === "role");
  // PO review C03: the Chef offers at most 0-4.
  const numberChoices = step.effectiveRoleId === "chef" ? Array.from({ length: Math.min(4, chefMaximumPairs(createRulesQuery(game, environment))) + 1 }, (_, index) => index) : [0, 1, 2];
  const choices = requirement?.kind === "boolean" ? [false, true] : numberChoices;
  return <div className="night-information">
    {characterInformation && (token?.kind === "role" || requirement?.kind === "character" || simulatedRavenkeeper && !resolved && !manualWake) &&
      (() => {
        const role = token?.kind === "role" ? registry.get(token.roleId) : undefined;
        const onClick = () => {
          if (simulatedRavenkeeper && !resolved && !manualWake) { setManualWake(true); return; }
          if (token?.kind === "role") { if (resolved) showCharacter(token.roleId); else commit(inputs, token.roleId); }
          else if (requirement?.kind === "character") openChooser(inputs, requirement.id);
        };
        return reveal.button({ role, onClick });
      })()}
    {value && <div className="night-information-answer" role="status" aria-label="Information to communicate">
      {value.kind === "boolean" ? value.value ? "YES" : "NO" : value.kind === "number" ? value.value : ""}
    </div>}
    {step.effectiveRoleId === "fortuneteller" && value?.kind === "boolean" && (() => {
      // Say why: a Demon, the Red Herring, or neither. The Storyteller is never left to guess where a YES came from.
      const chosen = values?.find(item => item.kind === "player");
      const people = chosen?.kind === "player" ? chosen.participants.map(item => game.players[item.playerId]).filter(Boolean) : [];
      if (!people.length) return null;
      const demons = people.filter(p => registry.get(p!.actualRole ?? "")?.type === "demon").map(p => p!.name || "Seat " + (p!.seat + 1));
      const herrings = people.filter(p => p!.effects.some(effect => effect.type === "fortuneTellerRedHerring" && effect.state === "active")).map(p => p!.name || "Seat " + (p!.seat + 1));
      const why = [...demons.map(name => `${name} is the Demon`), ...herrings.map(name => `${name} is the Red Herring`)];
      const text = value.value ? (why.length ? `Why YES: ${why.join("; ")}.` : "Why YES: the Storyteller chose this answer (this Fortune Teller is drunk, poisoned or only shown as one).")
        : why.length ? "The Storyteller chose NO although a chosen player registers as a Demon or Red Herring." : "Why NO: neither chosen player is the Demon or the Red Herring.";
      return <p className="night-information-why" style={{ margin: "4px 0 0", opacity: 0.85, fontSize: 13 }}>{text}</p>;
    })()}
    {/* A Spy or Recluse nominated: whether they count as a Minion is the Storyteller's ruling, asked in the Godfather's prompt style. */}
    {!resolved && requirement?.source === "storyteller" && requirement.kind === "boolean" && requirement.id.startsWith("towncrier:minionNominated") && preview && !preview.ok &&
      <QuestionBlock heading="Did a Minion nominate today?" note={preview.message.replace(/\s*Did a Minion nominate today\?$/, "")}
        actions={[true, false].map((choice) => ({ label: choice ? "Yes" : "No", onClick: () => { commit({ ...inputs, [requirement.id]: { kind: "boolean", value: choice } }); } }))} />}
    {!resolved && requirement?.source === "storyteller" && ["number", "boolean"].includes(requirement.kind) && !requirement.id.startsWith("towncrier:minionNominated") && <>
      <div className="night-information-choices" role="group" aria-label="Information to communicate">{choices.map(choice =>
        <button className="btn" key={String(choice)} type="button" onClick={() => commit({ ...inputs,
          [requirement.id]: typeof choice === "boolean" ? { kind: "boolean", value: choice } : { kind: "number", value: choice } })}>
          {typeof choice === "boolean" ? choice ? "YES" : "NO" : choice}</button>)}</div>
    </>}
    {needsTargets && <>
      {/* PO review C04/C12: chosen players sit inline beside the prompt, as in V2; no cancel control. */}
      <p className="modern-night-pick">{targetCount === 1 ? "Choose a player on the board" : targets.length ? "Choose one more player on the board" : "Choose two players on the board"}
        {targets.map(target => <span key={target.participantId} className="night-pick-chip">{game.players[target.playerId]?.name}</span>)}</p>
    </>}
    {resolved && <p className="modern-night-result">Completed</p>}
    {error && <p role="alert" className="behavior-help">{error}</p>}
  </div>;
});
