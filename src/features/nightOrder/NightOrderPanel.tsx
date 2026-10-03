import { useEffect, useMemo, useRef, useState } from "react";
import { computeNightOrder } from "./nightOrder";
import type { NightStep } from "./nightOrder";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { PlayerInformation } from "@/features/players/PlayerInformation";
import { TravelerArrival } from "@/features/players/TravelerArrival";
import { travelerGuidance } from "@/stores/travelers";
import { getPrivateInfoApplicability, offersNightInformation, previewPrivatePacket } from "@/stores/privatePackets";
import { buildRegistry } from "@/data/roleRegistry";
import { usePrivacyStore } from "@/stores/privacyStore";
import { evilInformationPolicy } from "./nightRules";
import type { NightStepRecord, NightStepStatus, Script, StorytellerLobbyRecord } from "@/stores/types";
import type { RoleRegistry } from "@/data/roleRegistry";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilityInputValue, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { captureFingerprint, planAbilityResolution, type ParticipantBinding } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import { lifeEventsForParticipantAt } from "@/stores/lifeEvents";
import { AbilityWorkspace, type WorkspaceTarget } from "@/features/abilities/AbilityWorkspace";
import { participantAllowed } from "@/features/abilities/RequirementInput";
import { bindingOf, pathAbility, seatedParticipants, triggerAbility, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import { wakeIdentity } from "@/stores/wakeIdentity";
import { participantStepKey } from "@/stores/nightProgress";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEXT_STATUS: Record<NightStepStatus, NightStepStatus> = {
  pending: "done",
  done: "skipped",
  skipped: "pending",
};

const STATUS_ICON: Record<NightStepStatus, string> = {
  pending: "○",
  done: "✓",
  skipped: "⊘",
};

const ROLE_TYPE_COLOR: Record<string, string> = {
  townsfolk: "var(--type-townsfolk)",
  outsider:  "var(--type-outsider)",
  minion:    "var(--type-minion)",
  demon:     "var(--type-demon)",
  traveler:  "var(--type-traveler)",
  fabled:    "var(--type-fabled)",
};

// ---------------------------------------------------------------------------
// StepCard
// ---------------------------------------------------------------------------

type LastResolution = { stepKey: string; game: StorytellerLobbyRecord; delivered: boolean };

type StepCardProps = {
  step: NightStep;
  record: NightStepRecord | undefined;
  day: number;
  /** Phase 10F: how this row's ability resolves (player steps only). */
  ability?: StepAbility | null;
  chips?: string[];
  guided?: GuidedContext;
  lastResolution?: LastResolution | null;
  onOpenWorkspace?: (initialInputs?: Record<string, AbilityInputValue>, manual?: boolean) => void;
};

type GuidedContext = {
  game: StorytellerLobbyRecord;
  script: Script;
  registry: RoleRegistry;
  semantics: AbilitySemanticsRegistry;
  onResolved: (resolution: LastResolution) => void;
};

/** The simple target-and-Effect class (10F-AC-31): one participant chosen by
 * the player/Storyteller, no judgment -- Target -> Resolve inline. */
const isSimple = (descriptor: AbilityDescriptor) => descriptor.presentation.complexity === "simple" &&
  descriptor.inputs.length === 1 && descriptor.inputs[0]!.kind === "participant" && (descriptor.inputs[0]!.count ?? 1) === 1 &&
  descriptor.inputs[0]!.source !== "judgment";

function InlineSimpleAbility({ step, day, descriptor, guided, onEscalate }: {
  step: Extract<NightStep, { kind: "player" }>; day: number; descriptor: AbilityDescriptor; guided: GuidedContext;
  onEscalate: (initialInputs?: Record<string, AbilityInputValue>) => void;
}) {
  // SOL-10F-A2: the target is the bound participation instance captured WHEN it
  // was selected -- never a seat id re-bound to whoever sits there at Resolve.
  const [target, setTarget] = useState<ParticipantBinding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picking = useTargetPicker((s) => s.active);
  const input = descriptor.inputs[0]!;
  const { game } = guided;
  const actor = game.players[step.playerId];
  const actorBinding = actor?.participantId ? bindingOf(actor) : null;
  const select = (playerId: string) => {
    const chosen = Object.prototype.hasOwnProperty.call(game.players, playerId) ? game.players[playerId] : undefined;
    setTarget(chosen && !chosen.isEmpty && chosen.participantId ? bindingOf(chosen) : null);
    setError(null);
  };
  const resolve = () => {
    if (!target) return;
    const inputs = { [input.id]: { kind: "participant" as const, participants: [target] } };
    const fingerprint = captureFingerprint(game, step.playerId, { day, stepKey: step.stepKey });
    if (!fingerprint) { setError("This player is no longer seated."); return; }
    const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: step.effectiveRoleId, inputs, completeStep: true };
    const planned = planAbilityResolution(game, request, { script: guided.script, registry: guided.registry, semantics: guided.semantics });
    // Anything beyond the simple class escalates to the workspace (choices
    // kept): a judgment, or a consequence that needs a preview.
    if ((!planned.ok && planned.code === "needsInput") || (planned.ok && planned.changed && planned.plan.needsConfirmation)) { onEscalate(inputs); return; }
    if (!planned.ok) { setError(planned.message); return; }
    const result = useStorytellerStore.getState().resolveAbility(request, guided.semantics);
    if (!result.ok) { setError(result.message); return; }
    const committed = useStorytellerStore.getState().game!;
    guided.onResolved({ stepKey: step.stepKey, game: committed, delivered: committed.informationDeliveries.length > game.informationDeliveries.length });
  };
  return (
    <div className="ability-inline" role="group" aria-label={`${descriptor.presentation.action} (inline)`}>
      <select aria-label={input.label} value={target?.playerId ?? ""} onChange={(e) => select(e.target.value)}>
        <option value="">{input.label}…</option>
        {seatedParticipants(game).filter((p) => participantAllowed(p, input, actorBinding)).map((p) =>
          <option key={p.id} value={p.id}>{p.name || `Seat ${p.seat + 1}`} · seat {p.seat + 1}</option>)}
      </select>
      <button className="btn btn-sm" aria-pressed={!!picking} onClick={() => picking ? useTargetPicker.getState().cancel()
        : useTargetPicker.getState().start(input.label, (binding) => { setTarget(binding); setError(null); })}>
        {picking ? "Cancel pick" : "Pick on Grimoire"}
      </button>
      <button className="btn btn-sm btn-gold" disabled={!target} onClick={resolve}>Resolve</button>
      {error && <p className="behavior-help" role="alert">{error}</p>}
    </div>
  );
}

function StepCard({ step, record, day, ability, chips = [], guided, lastResolution, onOpenWorkspace }: StepCardProps) {
  const players = useStorytellerStore(s => s.game?.players);
  const status = record?.status ?? "pending";
  const notes = record?.notes ?? "";
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  const handleCycle = () => {
    useStorytellerStore.getState().setNightStepStatus(day, step.stepKey, NEXT_STATUS[status]);
  };

  const handleNoteBlur = () => {
    const val = notesRef.current?.value ?? "";
    useStorytellerStore.getState().setNightStepNotes(day, step.stepKey, val);
  };

  const roleColor =
    step.kind === "player"
      ? (ROLE_TYPE_COLOR[step.roleType] ?? "var(--text)")
      : "#a5b4dc";

  return (
    <div className="step-card" data-status={status}>
      {/* Header row: status toggle + role name + badges */}
      <div className="step-card-header">
        <button
          className="step-status-btn"
          onClick={handleCycle}
          title={`Mark ${NEXT_STATUS[status]}`}
          aria-label={`Step status: ${status}. Click to mark ${NEXT_STATUS[status]}`}
        >
          {STATUS_ICON[status]}
        </button>

        <span className="step-role-name" style={{ color: roleColor }}>
          {step.kind === "global" ? step.label : step.effectiveRoleName}
        </span>

        {step.kind === "player" && (
          <span className="step-badges">
            {!step.alive     && <span className="step-badge step-badge-dead">dead</span>}
            {step.abilityUsed && <span className="step-badge step-badge-used">used</span>}
          </span>
        )}
      </div>

      {/* Player name + seat — player steps only */}
      {step.kind === "player" && (
        <div className="step-player-name">
          {step.playerName} · seat {step.seat + 1}
        </div>
      )}
      {chips.length > 0 && <span className="step-badges step-chips">{chips.map((chip) => <span key={chip} className="step-badge">{chip}</span>)}</span>}

      {/* Phase 10F: next required action, or the completed result. */}
      {step.kind === "player" && ability && (
        <div className="step-next" data-step-next={status}>
          {status === "done" ? (
            <>
              <span className="step-result">Resolved</span>
              {lastResolution?.stepKey === step.stepKey && (lastResolution.game === guided?.game ? (
                <span className="step-undo">
                  <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().undo()}>Undo</button>
                  {lastResolution.delivered && <span className="behavior-help"> Undo removes the stored record of what was told — it cannot unsay it.</span>}
                </span>
              ) : (
                <details className="step-correct">
                  <summary>Correct…</summary>
                  <p className="behavior-help">Undo is no longer the latest action. Correct the result from Current State with the player's Life,
                    Effect, Character and Alignment corrections.</p>
                  <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().selectPlayer(step.playerId)}>Open {step.playerName}</button>
                </details>
              ))}
            </>
          ) : status === "skipped" ? (
            <span className="step-result">Skipped</span>
          ) : ability.kind === "guided" && ability.trigger?.kind === "notTriggered" ? (
            <>
              <span className="step-action">Not triggered: {ability.trigger.reason}</span>
              <button className="btn btn-sm" onClick={() => onOpenWorkspace?.(undefined, true)}>Resolve manually / unmodeled interaction</button>
            </>
          ) : ability.kind === "guided" ? (
            <>
              {ability.trigger && <span className="step-badge" data-trigger={ability.trigger.kind}>
                {ability.trigger.kind === "triggered" ? "Triggered tonight" : "Trigger needs a check"}</span>}
              <span className="step-action">{ability.descriptor.presentation.action}</span>
              {guided && isSimple(ability.descriptor) && !ability.invocationPath
                ? <InlineSimpleAbility step={step} day={day} descriptor={ability.descriptor} guided={guided} onEscalate={(inputs) => onOpenWorkspace?.(inputs)} />
                : <button className="btn btn-sm btn-gold" onClick={() => onOpenWorkspace?.()}>Guide</button>}
            </>
          ) : (
            <>
              <span className="step-action">{ability.reason}</span>
              <button className="btn btn-sm" onClick={() => onOpenWorkspace?.()}>Resolve manually / unmodeled interaction</button>
            </>
          )}
        </div>
      )}

      {step.kind === "player" && step.isDeceived && <p className="step-reminder">
        Simulated wake — actually the {step.actualRoleName}. Follow the shown procedure; no real ability effects.
      </p>}
      {step.kind === "global" && step.recipientIds !== undefined && <p className="step-player-name">
        Introduction recipients: {step.recipientIds?.map(id => players?.[id]?.name ?? "Unnamed player").join(", ") || "none — review manually"}.
        Simulated identities are excluded.
      </p>}

      {/* Prompt text */}
      {step.prompt && (
        <p className="step-prompt">{step.prompt}</p>
      )}
      {step.advisory && <p className="step-reminder">{step.advisory}</p>}
      {step.kind === "global" && step.travelerArrivalId && !players?.[step.travelerArrivalId]?.travelerArrival &&
        <p className="step-reminder">Prior arrival completion is unknown. Verify before repeating.</p>}

      {step.kind === "player" && offersNightInformation(step.prompt + " " + step.reminder) && <details className="information-review">
        <summary>Give information</summary>
        <PlayerInformation playerId={step.playerId} purpose="result" />
      </details>}
      <button className="btn btn-sm" disabled={status === "done"}
        onClick={() => useStorytellerStore.getState().setNightStepStatus(day, step.stepKey, "done")}>Done</button>

      {/* Expandable reminder */}
      {step.reminder && (
        <>
          <button
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "11px", color: "var(--text-faint)", textAlign: "left",
              padding: "0 0 0 24px", fontFamily: "var(--font-body)",
            }}
            onClick={() => setReminderOpen((o) => !o)}
            aria-expanded={reminderOpen}
          >
            {reminderOpen ? "▾ reminder" : "▸ reminder"}
          </button>
          {reminderOpen && (
            <p className="step-reminder">{step.reminder}</p>
          )}
        </>
      )}

      {/* ST notes */}
      <textarea
        ref={notesRef}
        className="step-notes"
        defaultValue={notes}
        key={`${day}:${step.stepKey}:${notes}`}
        placeholder="ST notes…"
        rows={1}
        onBlur={handleNoteBlur}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NightOrderPanel
// ---------------------------------------------------------------------------

type Props = {
  game: StorytellerLobbyRecord;
  script: Script;
  onClose: () => void;
  /** Phase 10F: verified ability semantics (defaults to the canonical
   * registry; tests may supply rules-neutral fixtures). */
  semantics?: AbilitySemanticsRegistry;
};

export function NightOrderPanel({ game, script, onClose, semantics = CANONICAL_ABILITY_SEMANTICS }: Props) {
  const privacyMode = usePrivacyStore((s) => s.enabled);
  // Phase 10F (10F-AC-28): under Privacy Mode the dashboard -- and with it
  // every guided workflow draft, workspace and target pick -- is UNMOUNTED,
  // so nothing private renders and nothing stale reopens when it turns off.
  if (privacyMode) {
    return (
      <aside className="night-panel privacy-safe-night" aria-label={`Night ${game.day} order`}>
        <div className="night-panel-header">
          <h2 className="night-panel-title">Night {game.day}</h2>
          <span className="privacy-safe-label" role="status">Privacy Mode On</span>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close night panel">✕</button>
        </div>
        <div className="night-panel-body">
          <p className="behavior-help">Night details are hidden while Privacy Mode is on.</p>
        </div>
      </aside>
    );
  }
  return <NightDashboard game={game} script={script} onClose={onClose} semantics={semantics} />;
}

function NightDashboard({ game, script, onClose, semantics }: Required<Props>) {
  const [workspace, setWorkspace] = useState<{ target: WorkspaceTarget; ability: StepAbility; initialInputs?: Record<string, AbilityInputValue> } | null>(null);
  const [lastResolution, setLastResolution] = useState<LastResolution | null>(null);
  // A pending Grimoire pick never outlives the dashboard (Privacy Mode, close).
  useEffect(() => () => useTargetPicker.getState().cancel(), []);
  const isFirstNight = game.day === 1;
  const steps = computeNightOrder(game.players, game.seatOrder, script, isFirstNight, game);
  for (const key of Object.keys(game.nightProgress ?? {})) {
    const prefix = `${game.day}:manual:`;
    if (key.startsWith(prefix)) steps.push({
      kind: "global", stepKey: key.slice(String(game.day).length + 1),
      label: "Custom night step", prompt: "Storyteller-defined procedure. Use the notes below; complete or skip manually.",
      reminder: "", order: Number.MAX_SAFE_INTEGER,
    });
  }
  const registry = useMemo(() => buildRegistry(script), [script]);
  const progress = game.nightProgress ?? {};
  const query = createRulesQuery(game, { registry, script, semantics, modifiers: [] });
  const guided: GuidedContext = { game, script, registry, semantics, onResolved: setLastResolution };
  /** Storyteller-private state chips for a wake (derived; never stored). */
  const chipsFor = (step: NightStep): string[] => {
    if (step.kind !== "player") return [];
    const player = game.players[step.playerId];
    if (!player?.participantId) return [];
    const chips: string[] = [];
    if (step.isDeceived) chips.push("simulated wake");
    const functioning = query.abilityFunctions(bindingOf(player));
    if (functioning.known && !functioning.value) chips.push("impaired");
    else if (!functioning.known) chips.push("check impairment");
    const tonight = lifeEventsForParticipantAt(game, player.participantId, { phase: "night", day: game.day });
    if (tonight.status === "known" && tonight.events.some((e) => e.kind === "death")) chips.push("died tonight");
    return chips;
  };
  // SOL-10F-L3-R1: guided only when the shared invocation-eligibility contract
  // admits the descriptor on the ordinary Night Order tonight -- or (Slice 7)
  // through the explicit VERIFIED Night-trigger path when the descriptor
  // declares one (never for "triggered" timing alone).
  const abilityOf = (step: NightStep): StepAbility | null => {
    if (step.kind !== "player") return null;
    const ordinary = pathAbility(step.effectiveRoleId, registry, semantics, "nightOrder", game);
    if (ordinary.kind === "guided") return ordinary;
    const player = game.players[step.playerId];
    return (player?.participantId && triggerAbility(step.effectiveRoleId, registry, semantics, query, bindingOf(player))) || ordinary;
  };
  /** Slice 7: verified triggers that fired (or need a check) tonight and are
   * still open -- surfaced at the top of the dashboard immediately, not at
   * an arbitrary scheduled row. */
  const triggered = seatedParticipants(game).flatMap((player) => {
    const wake = wakeIdentity(player, registry);
    if (!wake || !player.participantId) return [];
    const ability = triggerAbility(wake.shownRoleId, registry, semantics, query, bindingOf(player));
    if (!ability || ability.kind !== "guided" || ability.trigger?.kind === "notTriggered") return [];
    const stepKey = participantStepKey(player.participantId, wake.shownRoleId);
    const status = progress[`${game.day}:${stepKey}`]?.status;
    if (status === "done" || status === "skipped") return [];
    return [{ player, roleId: wake.shownRoleId, roleName: wake.role.name, stepKey, ability }];
  });
  const policy = evilInformationPolicy(game.seatOrder.map(id => game.players[id]!).filter(Boolean), registry, game);
  const setupPlayers = game.seatOrder.filter(id => {
    const p = game.players[id];
    if (!p || p.isEmpty || !getPrivateInfoApplicability(p, registry).bluffs) return false;
    if (!policy.normalStartingInfo || policy.complex.length) return false;
    if (isFirstNight) return true;
    // Later nights only offer changed setup content, never an overdue task.
    if (!p.privateInfo?.bluffs?.length && !p.privateInfo?.fakeMinions?.length) return false;
    try { return JSON.stringify(previewPrivatePacket(p, game, registry).payload) !== JSON.stringify(p.publishedPacket?.payload); }
    catch { return true; }
  });

  const resolvedCount = steps.filter((s) => {
    const rec = progress[`${game.day}:${s.stepKey}`];
    return rec?.status === "done" || rec?.status === "skipped";
  }).length;

  const handleReset = () => {
    if (window.confirm(`Reset all night ${game.day} progress?`)) {
      useStorytellerStore.getState().clearNightProgress(game.day);
    }
  };

  return (
    <aside className="night-panel" aria-label={`Night ${game.day} order`}>
      <div className="night-panel-header">
        <h2 className="night-panel-title">Night {game.day}</h2>
        <span className="night-panel-progress">
          {resolvedCount}&thinsp;/&thinsp;{steps.length}
        </span>
        <button className="btn btn-sm" onClick={handleReset} title="Reset night progress">
          reset
        </button>
        <button className="btn btn-sm" onClick={onClose} aria-label="Close night panel">
          ✕
        </button>
      </div>

      <div className="night-panel-body">
        {triggered.length > 0 && (
          <section className="triggered-now" aria-label="Triggered now">
            <h3 className="drawer-section-title">Triggered now</h3>
            {triggered.map(({ player, roleId, roleName, stepKey, ability }) => (
              <div key={stepKey} className="step-card" data-status="pending">
                <span className="step-role-name">{roleName}</span>
                <span className="step-player-name">{player.name || `Seat ${player.seat + 1}`} · {ability.kind === "guided" && ability.trigger?.kind === "unknown" ? "trigger needs a check" : "died tonight"}</span>
                <button className="btn btn-sm btn-gold" onClick={() => setWorkspace({
                  target: { actorId: player.id, roleId, roleName, invocationPath: "nightTrigger", step: { day: game.day, stepKey } }, ability })}>Guide</button>
              </div>
            ))}
          </section>
        )}
        {game.seatOrder.filter(id => {
          const p = game.players[id];
          return p?.isTraveler && p.alive && !p.exiled && travelerGuidance(p).length > 0;
        }).map(id => <TravelerArrival key={id} playerId={id} compact />)}
        {steps.length === 0 ? (
          <p style={{ color: "var(--text-faint)", fontSize: "12px", fontStyle: "italic", padding: "8px 4px" }}>
            No night actions — configure shown identities for the intended wake procedures.
          </p>
        ) : (
          steps.map((step) => (
            <div key={step.stepKey}>
              <StepCard step={step} record={progress[`${game.day}:${step.stepKey}`]} day={game.day}
                ability={abilityOf(step)} chips={chipsFor(step)} guided={guided} lastResolution={lastResolution}
                onOpenWorkspace={step.kind === "player" ? (initialInputs, manual) => {
                  const ability = abilityOf(step)!;
                  const path = ability.kind === "guided" ? ability.invocationPath ?? "nightOrder" : "nightOrder";
                  setWorkspace({
                    target: { actorId: step.playerId, roleId: step.effectiveRoleId, roleName: step.effectiveRoleName, invocationPath: path, step: { day: game.day, stepKey: step.stepKey } },
                    ability: manual && ability.kind === "guided" && ability.trigger?.kind === "notTriggered" ? { kind: "manual", reason: ability.trigger.reason } : ability,
                    ...(initialInputs ? { initialInputs } : {}),
                  });
                } : undefined} />
              {step.kind === "global" && step.setupRecipientIds?.filter(id => setupPlayers.includes(id)).map(id => <details className="information-review" key={id}>
                <summary>Setup information — {game.players[id]!.name}</summary>
                <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().selectPlayer(id)}>Edit setup information</button>
                <PlayerInformation playerId={id} purpose="setup" />
              </details>)}
            </div>
          ))
        )}
        {!isFirstNight && setupPlayers.map(id => <details className="information-review" key={id}>
          <summary>Review changed setup information — {game.players[id]!.name}</summary>
          <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().selectPlayer(id)}>Edit setup information</button>
          <PlayerInformation playerId={id} purpose="setup" />
        </details>)}
        <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().setNightStepNotes(
          game.day, `manual:${crypto.randomUUID()}`, ""
        )}>Add custom night step</button>
        <p className="behavior-help">New or changed characters, gained abilities and past events may need a custom step.
          Verify these conditions manually; this sheet does not reconstruct game history.</p>
      </div>
      {workspace && (
        <AbilityWorkspace game={game} script={script} registry={registry} semantics={semantics} target={workspace.target}
          descriptor={workspace.ability.kind === "guided" ? workspace.ability.descriptor : null}
          manualReason={workspace.ability.kind === "manual" ? workspace.ability.reason : ""}
          {...(workspace.initialInputs ? { initialInputs: workspace.initialInputs } : {})}
          onClose={() => setWorkspace(null)}
          onResolved={({ game: committed, delivered }) => {
            setLastResolution({ stepKey: workspace.target.step?.stepKey ?? "", game: committed, delivered });
            setWorkspace(null);
          }} />
      )}
    </aside>
  );
}
