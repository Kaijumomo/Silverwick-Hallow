import { useRef, useState, type ReactNode, type RefObject } from "react";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { AbilityWorkspace } from "@/features/abilities/AbilityWorkspace";
import { MAX_NIGHT_STEP_NOTES } from "@/stores/schemas";
import { TextLimit } from "@/components/TextLimit";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { BureaucratAction } from "@/features/voting/BureaucratAction";
import { ButlerNightAction } from "@/features/nightOrder/ButlerNightAction";
import { NightInformationAction, type NightInformationHandle, type RevealHost } from "@/features/nightOrder/NightInformationAction";
import { PreparedInformationAction } from "@/features/nightOrder/PreparedInformationAction";
import { SetupInformationAction } from "@/features/nightOrder/SetupInformationAction";
import { CUSTOM_STEP_PREFIX, nightStepName } from "@/features/nightOrder/nightWork";
import { iconUrlFor } from "@/data/iconUrl";
import type { V6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { presentCharacter, report } from "../info/actions";
import { INFO_TOKENS } from "../info/tokens";
import type { NightEngine } from "./useNightEngine";
import "./night-custom.css";

const SEMANTICS = CANONICAL_ABILITY_SEMANTICS;

/** Storyteller notes for a custom Night step, the only place a custom step is described. */
function StepNotes({ day, stepKey, notes }: { day: number; stepKey: string; notes: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [length, setLength] = useState(notes.length);
  return <div>
    <textarea ref={ref} className="step-notes" defaultValue={notes} key={`${day}:${stepKey}:${notes}`} placeholder="ST notes…"
      aria-label="Night step notes" rows={2} maxLength={MAX_NIGHT_STEP_NOTES}
      onBlur={() => useStorytellerStore.getState().setNightStepNotes(day, stepKey, ref.current?.value ?? "")}
      onInput={(event) => setLength(event.currentTarget.value.length)} />
    <TextLimit length={length} max={MAX_NIGHT_STEP_NOTES} />
  </div>;
}

const REVEAL = INFO_TOKENS.find((t) => t.label === "Reveal a Token")!;

/**
 * The board chooses a target on pointerup, and the picker can open under the same finger. The browser's
 * following compatibility click must not pick the token that appeared there: until a new pointer gesture
 * starts, pointer clicks are swallowed. Keyboard activation (detail 0) is always deliberate.
 */
function guardGesture() {
  let armed = false;
  const arm = () => { armed = true; };
  const swallow = (event: MouseEvent) => { if (!armed && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } };
  window.addEventListener("pointerdown", arm, true);
  window.addEventListener("click", swallow, true);
  const stop = useV6Ui.subscribe((state) => {
    if (state.picker?.mode === "show" && state.picker.onPick) return;
    window.removeEventListener("pointerdown", arm, true);
    window.removeEventListener("click", swallow, true);
    stop();
  });
}

/** PO review (C06/C12): a Night card reveals a token exactly as the Information panel does: the same
 * Reveal a Token button, the board's character picker and the same player view. */
function revealHost(abilityName: string): RevealHost {
  const title = REVEAL.title ?? REVEAL.label;
  const cancel = () => { const picker = useV6Ui.getState().picker; if (picker?.mode === "show" && picker.onPick) useV6Ui.getState().set({ picker: null }); };
  return {
    button: ({ role, onClick }) => <div className="gvn-reveal">
      {role && <span className="gvn-reveal-role"><span className="gvn-reveal-disc"><img src={iconUrlFor(role)} alt="" draggable={false} /></span>{role.name}</span>}
      <button type="button" className="gvn-info-token" onClick={onClick}>
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ stroke: REVEAL.color }}><path d={REVEAL.icon} /></svg>
        <span>{REVEAL.label}</span>
      </button>
    </div>,
    show: (roleId) => report(presentCharacter(title, roleId)),
    choose: (pick, types) => {
      guardGesture();
      useV6Ui.getState().set({ pickHover: null, picker: { mode: "show", title, kicker: `${abilityName} · choose a character to show`, ...(types ? { types } : {}),
        // The picker closes once the token is accepted, whether or not a player view follows.
        onPick: (roleId) => { const refusal = pick(roleId); if (!refusal) cancel(); return refusal; } } });
    },
    cancel,
  };
}

/**
 * What the V2 card cannot express with its own slots: the existing, unchanged Night action components
 * (information, Butler, Bureaucrat, setup information, the ability workspace) and the Dawn exceptions.
 * Everything here is reused as it was; only where it sits is new.
 */
export function renderNightCustom(engine: NightEngine, ctx: V6Ctx, information: RefObject<NightInformationHandle>): ReactNode {
  const { game, script, registry, ui } = ctx;
  if (!engine.active || !script) return null;
  const { current, workspace, error, refused, pos } = engine;
  const rows: ReactNode[] = [];

  if (pos.kind === "dawn" && engine.unfinished && engine.unfinished.total > 0) {
    const { rows: open, customSteps, triggers, triggerChecks } = engine.unfinished;
    const jumpTo = (stepKey: string) => { const step = engine.steps.find((item) => item.stepKey === stepKey); if (step) engine.navigate(step); };
    const trigger = (item: (typeof triggers)[number], hint: string) => {
      const hasRow = engine.steps.some((step) => step.stepKey === item.stepKey);
      return <button key={`t:${item.stepKey}`} type="button" className="gvn-chip" onClick={() => hasRow ? jumpTo(item.stepKey) : engine.openTrigger(item)}>
        {item.roleName} — {item.player.name || `Seat ${item.player.seat + 1}`} · {hint}</button>;
    };
    const short = (step: (typeof open)[number]) => step.stepKey === "minionInfo" ? "Minion info" : step.stepKey === "demonInfo" ? "Demon info" : nightStepName(step);
    rows.push(<div key="dawn-open" role="group" aria-label="Night work not finished" className="gvn-dawn">
      <span className="gvn-dawn-label">Not finished:</span>
      {open.map((step) => <button key={step.stepKey} type="button" className="gvn-chip" onClick={() => engine.navigate(step)}>{short(step)}</button>)}
      {triggers.map((item) => trigger(item, "triggered tonight"))}
      {triggerChecks.map((item) => trigger(item, "trigger needs your check"))}
      {customSteps.map((step) => <button key={step.stepKey} type="button" className="gvn-chip" onClick={() => engine.navigate(step)}>
        {game.nightProgress[`${game.day}:${step.stepKey}`]?.notes?.trim() || "Custom night step"}</button>)}
    </div>);
  }

  if (current && !workspace) {
    const done = engine.resolved;
    const source = current.kind === "player" ? { playerId: current.playerId, participantId: current.participantId } : null;
    if (current.kind === "player") {
      if (engine.butlerTurn && source) {
        rows.push(<ButlerNightAction key={current.stepKey} game={game} script={script} source={source} visible={engine.visible} resolved={done} onResolved={engine.finish} />);
      } else if (engine.preparedInformation) {
        rows.push(<PreparedInformationAction key={current.stepKey} ref={information} game={game} script={script} step={current}
          visible={engine.visible} resolved={done} onResolved={engine.finish} reveal={revealHost(registry.get(current.effectiveRoleId)?.name ?? "This character")} />);
      } else if (engine.inlineInformation && engine.ability?.kind === "guided") {
        rows.push(<NightInformationAction key={current.stepKey} ref={information} game={game} script={script} step={current}
          ability={engine.ability} visible={engine.visible} resolved={done} onResolved={engine.finish} onManual={engine.requireManual}
          reveal={revealHost(registry.get(current.effectiveRoleId)?.name ?? "This character")} />);
      } else if (!done && engine.bureaucrat && engine.actor?.participantId) {
        rows.push(<BureaucratAction key={`${engine.actor.participantId}:${current.stepKey}`} source={{ playerId: engine.actor.id, participantId: engine.actor.participantId }}
          visible={engine.visible} completeStep={{ day: game.day, stepKey: current.stepKey }} onResolved={engine.finish} />);
      } else if (!done && !engine.manual && !engine.canTarget) {
        rows.push(<button key="continue" type="button" className="btn btn-gold" onClick={() => engine.openWorkspace()}>Continue action</button>);
      }
      // PO review C15: no "Give information" form in the Night card; the Storyteller tells the player in person.
    } else if (!done && engine.bureaucrat && engine.actor?.participantId) {
      rows.push(<BureaucratAction key={`${engine.actor.participantId}:${current.stepKey}`} source={{ playerId: engine.actor.id, participantId: engine.actor.participantId }}
        visible={engine.visible} completeStep={{ day: game.day, stepKey: current.stepKey }} onResolved={engine.finish} />);
    } else if (["minionInfo", "demonInfo"].includes(current.stepKey)) {
      rows.push(<SetupInformationAction key={current.stepKey} game={game} script={script} step={current} visible={engine.visible} resolved={done} />);
    }
    if (current.stepKey.startsWith(CUSTOM_STEP_PREFIX)) {
      rows.push(<StepNotes key="notes" day={game.day} stepKey={current.stepKey} notes={game.nightProgress?.[`${game.day}:${current.stepKey}`]?.notes ?? ""} />);
    }
  }

  if (workspace) {
    const stepOf = engine.steps.find((step) => step.stepKey === workspace.target.step?.stepKey);
    rows.push(<AbilityWorkspace key={workspace.key} game={game} script={script} registry={registry} semantics={SEMANTICS}
      target={workspace.target} descriptor={workspace.ability.kind === "guided" ? workspace.ability.descriptor : null}
      manualReason={workspace.ability.kind === "manual" ? workspace.ability.reason : ""} initialInputs={workspace.inputs}
      hidden={!engine.visible} onHide={() => ui.set({ panel: null })} onClose={() => { engine.setWorkspace(null); engine.setPaused(false); }}
      strictGameplay onManualRequired={engine.requireManual}
      onRefresh={() => { engine.setWorkspace(null); engine.openWorkspace(); }}
      guidance={{ ability: registry.get(workspace.target.roleId)?.ability, prompt: stepOf?.prompt, reminder: stepOf?.reminder }}
      onResolved={({ game: committed }) => engine.finish(committed)} />);
  }

  if (error) rows.push(<p key="error" role="alert">{error}</p>);
  if (refused) rows.push(<p key="refused" role="alert">{refused}</p>);
  if (!rows.length) return null;
  return <div className="gv-night-custom">{rows}</div>;
}
