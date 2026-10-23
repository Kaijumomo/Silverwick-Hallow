import { useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { AbilityWorkspace } from "@/features/abilities/AbilityWorkspace";
import { MAX_NIGHT_STEP_NOTES } from "@/stores/schemas";
import { TextLimit } from "@/components/TextLimit";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { offersNightInformation } from "@/stores/privatePackets";
import { PlayerInformation } from "@/features/players/PlayerInformation";
import { BureaucratAction } from "@/features/voting/BureaucratAction";
import { ButlerNightAction } from "@/features/nightOrder/ButlerNightAction";
import { NightInformationAction, type NightInformationHandle } from "@/features/nightOrder/NightInformationAction";
import { PreparedInformationAction } from "@/features/nightOrder/PreparedInformationAction";
import { SetupInformationAction } from "@/features/nightOrder/SetupInformationAction";
import { CUSTOM_STEP_PREFIX, nightStepName } from "@/features/nightOrder/nightWork";
import type { V6Ctx } from "../ctx";
import type { NightEngine } from "./useNightEngine";

const SEMANTICS = CANONICAL_ABILITY_SEMANTICS;

const CHIP: CSSProperties = {
  minHeight: 36, padding: "0 12px", borderRadius: 10, border: "1px solid rgba(232,88,74,.45)", background: "rgba(232,88,74,.08)",
  color: "#ffb4a6", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left",
};
const ALERT: CSSProperties = { margin: 0, fontSize: 13, color: "#f4a595" };

/** Storyteller notes for a custom Night step, the only place a custom step is described. */
function StepNotes({ day, stepKey, notes }: { day: number; stepKey: string; notes: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [length, setLength] = useState(notes.length);
  return <div>
    <textarea ref={ref} className="step-notes" defaultValue={notes} key={`${day}:${stepKey}:${notes}`} placeholder="ST notes…"
      aria-label="Night step notes" rows={2} maxLength={MAX_NIGHT_STEP_NOTES}
      onBlur={() => useStorytellerStore.getState().setNightStepNotes(day, stepKey, ref.current?.value ?? "")}
      onInput={(event) => setLength(event.currentTarget.value.length)} style={{ width: "100%" }} />
    <TextLimit length={length} max={MAX_NIGHT_STEP_NOTES} />
  </div>;
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
      return <button key={`t:${item.stepKey}`} type="button" style={CHIP} onClick={() => hasRow ? jumpTo(item.stepKey) : engine.openTrigger(item)}>
        {item.roleName} — {item.player.name || `Seat ${item.player.seat + 1}`} · {hint}</button>;
    };
    rows.push(<div key="dawn-open" role="group" aria-label="Night work not finished" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase", fontWeight: 700, color: "#e7a35b" }}>
        Not finished: review it, or begin the Day anyway</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {open.map((step) => <button key={step.stepKey} type="button" style={CHIP} onClick={() => engine.navigate(step)}>{nightStepName(step)}</button>)}
        {triggers.map((item) => trigger(item, "triggered tonight"))}
        {triggerChecks.map((item) => trigger(item, "trigger needs your check"))}
        {customSteps.map((step) => <button key={step.stepKey} type="button" style={CHIP} onClick={() => engine.navigate(step)}>
          {game.nightProgress[`${game.day}:${step.stepKey}`]?.notes?.trim() || "Custom night step"}</button>)}
      </div>
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
          visible={engine.visible} resolved={done} onResolved={engine.finish} />);
      } else if (engine.inlineInformation && engine.ability?.kind === "guided") {
        rows.push(<NightInformationAction key={current.stepKey} ref={information} game={game} script={script} step={current}
          ability={engine.ability} visible={engine.visible} resolved={done} onResolved={engine.finish} onManual={engine.requireManual} />);
      } else if (!done && engine.bureaucrat && engine.actor?.participantId) {
        rows.push(<BureaucratAction key={`${engine.actor.participantId}:${current.stepKey}`} source={{ playerId: engine.actor.id, participantId: engine.actor.participantId }}
          visible={engine.visible} completeStep={{ day: game.day, stepKey: current.stepKey }} onResolved={engine.finish} />);
      } else if (!done && !engine.manual && !engine.canTarget) {
        rows.push(<button key="continue" type="button" className="btn btn-gold" onClick={() => engine.openWorkspace()}>Continue action</button>);
      }
      if (engine.manual && offersNightInformation(`${current.prompt} ${current.reminder}`)) {
        rows.push(<details key="give" className="information-review"><summary>Give information</summary>
          <PlayerInformation playerId={current.playerId} purpose="result" /></details>);
      }
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

  if (error) rows.push(<p key="error" role="alert" style={ALERT}>{error}</p>);
  if (refused) rows.push(<p key="refused" role="alert" style={ALERT}>{refused}</p>);
  if (!rows.length) return null;
  return <div className="gv-night-custom" style={{ display: "flex", flexDirection: "column", gap: 10 }}>{rows}</div>;
}
