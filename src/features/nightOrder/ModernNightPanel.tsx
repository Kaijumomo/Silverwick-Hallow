import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilityInputValue } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";
import { iconUrlFor } from "@/data/iconUrl";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { automationEligibility } from "@/abilities/automationEligibility";
import { bureaucratActionEligibility } from "@/stores/voting";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { captureFingerprint, planAbilityResolution, type ParticipantBinding } from "@/stores/abilityResolution";
import { getNightActionCorrection } from "@/stores/nightActionCorrection";
import { travelerArrivalStepKey } from "@/stores/nightProgress";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { AbilityWorkspace, type WorkspaceTarget } from "@/features/abilities/AbilityWorkspace";
import { ACTION_CARD_DOCK_HOST } from "@/components/ActionCard";
import { bindingOf, pathAbility, seatedParticipants, triggerAbility, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import { participantAllowed } from "@/features/abilities/RequirementInput";
import { NightOrderPanel, StepCard } from "./NightOrderPanel";
import { deriveNightWork, stepResolved } from "./nightWork";
import type { NightStep } from "./nightOrder";
import "@/styles/modern-night.css";
import { BureaucratAction } from "@/features/voting/BureaucratAction";

type Props = { game: StorytellerLobbyRecord; script: Script; visible: boolean; onClose: () => void; showClose?: boolean };
type Workspace = { target: WorkspaceTarget; ability: StepAbility; inputs?: Record<string, AbilityInputValue>; key: number };
const semantics = CANONICAL_ABILITY_SEMANTICS;
const simpleTarget = (descriptor: AbilityDescriptor) => descriptor.presentation.complexity === "simple"
  && descriptor.inputs.length === 1 && descriptor.inputs[0]!.kind === "participant"
  && (descriptor.inputs[0]!.count ?? 1) === 1 && descriptor.inputs[0]!.source !== "judgment";
const label = (step: NightStep) => step.kind === "player" ? step.effectiveRoleName : step.label;
const nightTitle = (day: number) => day === 1 ? "The First Night" : day === 2 ? "The Second Night" : `Night ${day}`;

/** Layout and navigation only: canonical planners still decide every consequence. */
export function ModernNightPanel(props: Props) {
  const privacy = usePrivacyStore(s => s.enabled);
  return privacy ? null : <NightGuide key={`${props.game.code}:${props.game.storytellerUid}:${props.game.day}`} {...props} />;
}

function NightGuide({ game, script, visible, onClose, showClose = false }: Props) {
  const registry = useMemo(() => buildRegistry(script), [script]);
  const work = useMemo(() => deriveNightWork(game, { script, registry, semantics }), [game, script, registry]);
  const { steps, query } = work;
  const cursor = useShellStore(s => s.nightCursor);
  const actionRequest = useShellStore(s => s.actionRequest);
  const picker = useTargetPicker(s => s.active);
  const refused = useTargetPicker(s => s.refused);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [details, setDetails] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ key: string; game: StorytellerLobbyRecord } | null>(null);
  const [manualAction, setManualAction] = useState<string | null>(null);
  const actionContext = captureCharacterActionContext();
  const sequence = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const current = (cursor?.day === game.day ? steps.find(s => s.stepKey === cursor.stepKey) : undefined)
    ?? steps.find(s => !stepResolved(game, s)) ?? steps.at(-1);
  const currentIndex = current ? steps.indexOf(current) : -1;
  const resolved = current ? stepResolved(game, current) : false;
  const actor = current?.kind === "player" ? game.players[current.playerId]
    : current?.travelerArrivalId ? game.players[current.travelerArrivalId] : undefined;
  const abilityOf = (step: NightStep): StepAbility | null => {
    if (step.kind !== "player") return null;
    const ordinary = pathAbility(step.effectiveRoleId, registry, semantics, "nightOrder", game);
    if (ordinary.kind === "guided") return ordinary;
    const player = game.players[step.playerId];
    return (player?.participantId && triggerAbility(step.effectiveRoleId, registry, semantics, query, bindingOf(player))) || ordinary;
  };
  const ability = current ? abilityOf(current) : null;
  const eligible = ability?.kind === "guided" && actor?.participantId && current?.kind === "player"
    && automationEligibility({ query, descriptor: ability.descriptor, actor: bindingOf(actor),
      roleId: current.effectiveRoleId, simulated: current.isDeceived }).kind === "automated"
    && manualAction !== current.stepKey;
  const direct = eligible && ability?.kind === "guided" && !ability.invocationPath && simpleTarget(ability.descriptor);
  const correction = current && resolved ? getNightActionCorrection(game, game.day, current.stepKey) : null;
  const canTarget = direct && (!resolved || !!correction?.canCorrect);
  const role = current?.kind === "player" ? registry.get(current.effectiveRoleId) : actor?.actualRole ? registry.get(actor.actualRole) : undefined;
  const bureaucrat = actor?.actualRole === "bureaucrat" && !!actor.participantId
    && bureaucratActionEligibility(game, bindingOf(actor), { script, registry, semantics }).known
    && current?.participantId === actor.participantId
    && (current.kind === "player" ? current.effectiveRoleId === "bureaucrat"
      : current.stepKey === travelerArrivalStepKey(actor.participantId, "bureaucrat"));
  const manual = !bureaucrat && !eligible;
  const requireManual = () => {
    if (current) setManualAction(current.stepKey);
    useTargetPicker.getState().cancel(); setWorkspace(null); setError(null); setPaused(true);
  };
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [current?.stepKey, workspace?.key]);
  const owner = current ? `night-guide:${game.code}:${game.day}:${current.stepKey}` : "night-guide";
  const live = useRef({ visible, current, game, details });
  live.current = { visible, current, game, details };

  const navigate = (step: NightStep) => {
    useTargetPicker.getState().cancel();
    setWorkspace(null); setSuccess(null); setError(null); setPaused(false);
    setManualAction(null);
    useShellStore.getState().setNightCursor({ day: game.day, stepKey: step.stepKey });
  };
  const advance = () => {
    const next = steps.slice(currentIndex + 1).find(s => !stepResolved(game, s));
    if (next) navigate(next);
    else { setSuccess(null); setPaused(false); }
  };
  const finish = (committed: StorytellerLobbyRecord) => {
    if (!current || !stepResolved(committed, current)) return;
    useShellStore.getState().setNightCursor({ day: game.day, stepKey: current.stepKey });
    setWorkspace(null); setError(null); setPaused(true);
    setSuccess({ key: current.stepKey, game: committed });
  };
  const openWorkspace = (inputs?: Record<string, AbilityInputValue>) => {
    if (!current || current.kind !== "player" || !ability || !eligible) return;
    useTargetPicker.getState().cancel();
    setPaused(true);
    setWorkspace({ key: ++sequence.current, ability, inputs, target: {
      actorId: current.playerId, roleId: current.effectiveRoleId, roleName: current.effectiveRoleName,
      invocationPath: ability.kind === "guided" ? ability.invocationPath ?? "nightOrder" : "nightOrder",
      step: { day: game.day, stepKey: current.stepKey },
      ...(ability.kind === "guided" && ability.trigger && ability.trigger.kind !== "notTriggered" ? { trigger: { eventId: ability.trigger.eventId } } : {}),
    } });
  };
  const choose = (target: ParticipantBinding) => {
    // A hidden or superseded callback never resolves against a different game.
    if (!visible || usePrivacyStore.getState().enabled || live.current.current?.stepKey !== current?.stepKey || !live.current.visible
      || game !== useStorytellerStore.getState().game || !current || current.kind !== "player" || ability?.kind !== "guided") return;
    setPaused(true);
    if (resolved) {
      const result = useStorytellerStore.getState().correctNightActionTarget({ day: game.day, stepKey: current.stepKey, target }, actionContext);
      if (!result.ok) { setError(result.message); return; }
      finish(useStorytellerStore.getState().game!);
      return;
    }
    const input = ability.descriptor.inputs[0]!;
    const inputs = { [input.id]: { kind: "participant" as const, participants: [target] } };
    const fingerprint = captureFingerprint(game, current.playerId, { day: game.day, stepKey: current.stepKey });
    if (!fingerprint) { setError("This player is no longer seated."); return; }
    const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: current.effectiveRoleId, inputs, completeStep: true };
    const plan = planAbilityResolution(game, request, { script, registry, semantics });
    if (!plan.ok && plan.code === "unsupported") { requireManual(); return; }
    if (!plan.ok && plan.code === "needsInput") {
      openWorkspace(inputs); return;
    }
    if (!plan.ok) { setError(plan.message); return; }
    const result = useStorytellerStore.getState().resolveAbility(request, semantics, actionContext);
    if (!result.ok) { setError(result.message); return; }
    finish(useStorytellerStore.getState().game!);
  };

  useEffect(() => {
    if (!current || cursor?.day === game.day && cursor.stepKey === current.stepKey) return;
    useShellStore.getState().setNightCursor({ day: game.day, stepKey: current.stepKey });
  }, [current?.stepKey, cursor?.stepKey, cursor?.day, game.day]);
  useEffect(() => {
    if (details) return;
    useShellStore.getState().setLitActor(actor?.participantId && current
      ? { playerId: actor.id, participantId: actor.participantId, stepKey: current.stepKey } : null);
  }, [visible, details, actor?.id, actor?.participantId, current?.stepKey]);
  useEffect(() => {
    if (!visible || details || paused || workspace || success || !canTarget || !actor || ability?.kind !== "guided") return;
    const input = ability.descriptor.inputs[0]!;
    const eligible = new Set(seatedParticipants(game).filter(p => participantAllowed(p, input, bindingOf(actor))).map(p => p.participantId!));
    useTargetPicker.getState().start(resolved ? "Correct target" : ability.descriptor.presentation.action, choose, { owner, eligible });
    return () => { if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
  }, [game, current?.stepKey, visible, details, paused, workspace, success, canTarget]);
  useEffect(() => { if (!visible) { useTargetPicker.getState().cancel(); setSuccess(null); } else setPaused(false); }, [visible]);
  useEffect(() => {
    live.current.visible = visible;
    return () => {
      live.current.visible = false;
      useTargetPicker.getState().cancel(); useShellStore.getState().setLitActor(null); useShellStore.getState().setActionOpen(false);
    };
  }, []);
  useEffect(() => {
    if (!success || !visible || details || success.key !== current?.stepKey || success.game !== game) return;
    const timer = window.setTimeout(advance, 2200);
    return () => window.clearTimeout(timer);
  }, [success, visible, details, current?.stepKey, game]);
  useEffect(() => {
    // Undo and external corrections invalidate the displayed result as well as
    // its timer; the restored step must immediately be actionable again.
    if (success && (success.game !== game || success.key !== current?.stepKey)) {
      setSuccess(null); setPaused(false);
    }
    if (workspace && workspace.target.step?.stepKey !== current?.stepKey) setWorkspace(null);
  }, [game, current?.stepKey, success, workspace]);
  // Manual procedures retain their original controls, but a completed procedure
  // participates in the same delayed advance as a guided ability.
  const previousStatus = useRef({ key: current?.stepKey, resolved });
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = { key: current?.stepKey, resolved };
    if (visible && !details && previous.key === current?.stepKey && !previous.resolved && resolved && !success) finish(game);
  }, [current?.stepKey, resolved, game, visible, details]);
  const lastRequest = useRef(actionRequest);
  useEffect(() => {
    if (lastRequest.current === actionRequest) return;
    lastRequest.current = actionRequest;
    if (!visible || details || resolved) return;
    if (direct || bureaucrat) setPaused(false); else if (!workspace) openWorkspace();
  }, [actionRequest]);

  if (details) return <div className="modern-night-extra"><button className="btn" onClick={() => setDetails(false)}>Back to guided night</button>
    {visible && <NightOrderPanel game={game} script={script} onClose={() => setDetails(false)} />}</div>;
  const pending = steps.filter(s => s.stepKey !== current?.stepKey && !stepResolved(game, s));
  const completed = steps.filter(s => s.stepKey !== current?.stepKey && stepResolved(game, s));
  const stepRow = (step: NightStep) => {
    const definition = step.kind === "player" ? registry.get(step.effectiveRoleId) : null;
    return <button className="modern-night-row" key={step.stepKey} onClick={() => navigate(step)}>
      <span className="modern-night-mini">{definition ? <img src={iconUrlFor(definition)} alt="" /> : stepResolved(game, step) ? "✓" : "·"}</span>
      <span><strong>{label(step)}</strong><small>{step.kind === "player" ? `${step.playerName} · Seat ${step.seat + 1}${!step.alive ? " · Dead" : ""}` : stepResolved(game, step) ? "Completed" : "Storyteller procedure"}</small></span>
    </button>;
  };
  return <section className="modern-night" aria-label={`Night ${game.day} guide`}>
    <header className="modern-night-heading"><span className="modern-night-kicker">Night {game.day}</span><h2>{nightTitle(game.day)}</h2>
      {showClose && <button className="btn btn-sm" aria-label="Close night panel" onClick={onClose}>×</button>}
      <div className="modern-night-progress" aria-label={`${steps.filter(s => stepResolved(game, s)).length} of ${steps.length} steps completed`}>
        {steps.map(s => <span key={s.stepKey} data-done={stepResolved(game, s)} data-current={s.stepKey === current?.stepKey} />)}
      </div>
    </header>
    <div className="modern-night-scroll" ref={scroll}>
      <div id={ACTION_CARD_DOCK_HOST} />
      {current && !workspace && <article className="modern-night-current" aria-label={`Current action: ${label(current)}`}>
        <div className="modern-night-actor">{role && <span className="modern-night-disc"><img src={iconUrlFor(role)} alt="" /></span>}
          <div><h3>{label(current)}</h3>{current.kind === "player" && <small>{current.playerName} · Seat {current.seat + 1}</small>}</div></div>
        {current.kind === "player" ? <>
          <p className="modern-night-instruction">{manual ? role?.ability : ability?.kind === "guided" ? ability.descriptor.presentation.action : current.prompt}</p>
          {manual && <p className="behavior-help">{current.prompt}</p>}
          {current.isDeceived && <p className="behavior-help">Follow the shown character’s procedure. This player is actually the {current.actualRoleName}.</p>}
          {success?.key === current.stepKey && success.game === game ? <p className="modern-night-result" role="status">{steps.slice(currentIndex + 1).some(s => !stepResolved(game, s)) ? "Resolved. Continuing…" : "Resolved."}</p>
            : resolved ? <><p className="modern-night-result">Completed{correction?.target ? ` · ${game.players[correction.target.playerId]?.name ?? "Chosen player"}` : ""}</p>
              {canTarget ? <p className="behavior-help">Tap another player to correct this action.</p> : <p className="behavior-help">{correction?.message ?? "This action cannot be safely retargeted here. Open the player’s settings to correct its result."}</p>}</>
            : bureaucrat ? <BureaucratAction key={`${actor!.participantId}:${current.stepKey}`} source={{ playerId: actor!.id, participantId: actor!.participantId! }}
                visible={visible} completeStep={{ day: game.day, stepKey: current.stepKey }} onResolved={finish} />
            : canTarget ? null
            : manual ? null : <button className="btn btn-gold" onClick={() => openWorkspace()}>Continue action</button>}
          {canTarget && !success && <div className="modern-night-pick-controls"><p className="modern-night-pick">Tap a player on the board</p><button onClick={() => { if (picker?.owner === owner) { useTargetPicker.getState().cancel(); setPaused(true); } else setPaused(false); }}>
            {picker?.owner === owner ? "Cancel selection" : "Choose on board"}</button></div>}
          {(!resolved || canTarget && !success) && <details className="modern-night-guidance"><summary>More options</summary>
            {canTarget && !success && actor && ability?.kind === "guided" && <><p className="behavior-help">Choose from roster</p><div className="modern-night-roster">
              {seatedParticipants(game).filter(p => participantAllowed(p, ability.descriptor.inputs[0]!, bindingOf(actor))).map(p =>
                <button key={p.id} className="btn btn-sm" onClick={() => { useTargetPicker.getState().cancel(); choose(bindingOf(p)); }}>
                  {p.name || `Seat ${p.seat + 1}`}</button>)}
            </div></>}
            {!resolved && <p className="behavior-help">Use the player’s settings for any reminders or changes you need to make.</p>}</details>}
        </> : bureaucrat ? <>
          <p className="modern-night-instruction">{current.prompt}</p>
          {current.advisory && <p className="behavior-help">{current.advisory}</p>}
          {resolved ? <p className="modern-night-result" role="status">{success?.game === game ? "Resolved. Continuing…" : "Completed"}</p>
            : <BureaucratAction key={`${actor!.participantId}:${current.stepKey}`} source={{ playerId: actor!.id, participantId: actor!.participantId! }}
              visible={visible} completeStep={{ day: game.day, stepKey: current.stepKey }} onResolved={finish} />}
          {!resolved && <details className="modern-night-guidance"><summary>More options</summary>
            <StepCard step={current} record={game.nightProgress?.[`${game.day}:${current.stepKey}`]} day={game.day} /></details>}
        </> : <StepCard step={current} record={game.nightProgress?.[`${game.day}:${current.stepKey}`]} day={game.day} />}
        {error && <p role="alert" className="behavior-help">{error}</p>}{refused && <p role="alert" className="behavior-help">{refused}</p>}
      </article>}
      {!current && <p>No night actions are currently required.</p>}
      {work.triggered.length > 0 && <button className="btn modern-night-checks" onClick={() => setDetails(true)}>Review {work.triggered.length} triggered action{work.triggered.length === 1 ? "" : "s"}</button>}
      {pending.length > 0 && <section className="modern-night-list" aria-label="Up next"><h3>Up next</h3>{pending.map(stepRow)}</section>}
      {completed.length > 0 && <section className="modern-night-list modern-night-completed" aria-label="Completed"><h3>Completed</h3>{completed.map(stepRow)}</section>}
      {steps.length > 0 && steps.every(s => stepResolved(game, s)) && <p className="modern-night-result">Night actions complete. Use Begin Day to review dawn.</p>}
      <button className="modern-night-more" onClick={() => { useTargetPicker.getState().cancel(); setDetails(true); }}>Additional night controls</button>
    </div>
    <footer className="modern-night-footer"><button disabled={currentIndex <= 0} onClick={() => navigate(steps[currentIndex - 1]!)}>‹ Previous</button>
      <button disabled={currentIndex < 0 || currentIndex >= steps.length - 1 && (!manual || resolved)} onClick={() => {
        if (!current) return;
        if (manual && !resolved) {
          const result = useStorytellerStore.getState().setNightStepStatus(game.day, current.stepKey, "done", actionContext);
          if (!result.ok) { setError(result.message); return; }
        }
        if (steps[currentIndex + 1]) navigate(steps[currentIndex + 1]!);
      }}>Next ›</button></footer>
    {workspace && <AbilityWorkspace key={workspace.key} game={game} script={script} registry={registry} semantics={semantics}
      target={workspace.target} descriptor={workspace.ability.kind === "guided" ? workspace.ability.descriptor : null}
      manualReason={workspace.ability.kind === "manual" ? workspace.ability.reason : ""} initialInputs={workspace.inputs}
      dockHostId={ACTION_CARD_DOCK_HOST} hidden={!visible} onHide={onClose} onClose={() => { setWorkspace(null); setPaused(false); }}
      strictGameplay onManualRequired={requireManual}
      onRefresh={() => { setWorkspace(null); openWorkspace(); }} guidance={{ ability: role?.ability, prompt: current?.prompt, reminder: current?.reminder }}
      onResolved={({ game: committed }) => finish(committed)} />}
  </section>;
}
