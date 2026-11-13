import { Fragment, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { TokenInformationAction } from "@/features/info/TokenInformationAction";
import type { V6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { presentCharacter, presentCharacters, presentSetup, report } from "../info/actions";
import { INFO_TOKENS } from "../info/tokens";
import { guardGesture } from "./gestureGuard";
import { newImpToWake } from "./newImp";
import type { NightEngine } from "./useNightEngine";
import { isCanonicalRole } from "@/data/canonical";
import type { NightStep } from "@/rules/night/nightOrder";
import { isDeathEvent } from "@/stores/lifeEvents";
import { createRulesQuery } from "@/stores/rulesQuery";
import { passiveRegistrationOptions } from "@/abilities/characters/passiveRules";
import type { RoleDef, Script, StorytellerLobbyRecord } from "@/stores/types";
import type { RoleRegistry } from "@/data/roleRegistry";
import { QuestionBlock } from "../day/NominationExtras";
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

/** PO review (C06/C12): a Night card reveals a token with the Information panel's character picker
 * (the board picker, as Distribute roles) and the same player view. */
function revealHost(abilityName: string): RevealHost {
  const title = REVEAL.title ?? REVEAL.label;
  const cancel = () => { const picker = useV6Ui.getState().picker; if (picker?.mode === "show" && picker.onPick) useV6Ui.getState().set({ picker: null }); };
  return {
    // PO review C05: the Night card keeps its own Reveal a Token row; only the picker and player view are shared.
    button: ({ role, onClick }) => <TokenInformationAction role={role} label={REVEAL.label} onClick={onClick} />,
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

/** Manual Night (a character in play or a Spy/Recluse keeps the action by hand): the Undertaker and Ravenkeeper still get the
 * Night card's own Reveal a Token row, with the shared board picker and player view. The Undertaker's row previews the executed
 * character only when exactly one died by execution the previous Day, the Undertaker is working, and the registration is certain;
 * otherwise the Storyteller picks the token on the board. Nothing is recorded. */
function manualReveal(game: StorytellerLobbyRecord, script: Script, registry: RoleRegistry, step: Extract<NightStep, { kind: "player" }>): ReactNode {
  const roleId = step.effectiveRoleId;
  const host = revealHost(registry.get(roleId)?.name ?? "This character");
  const query = createRulesQuery(game, { script, registry, semantics: SEMANTICS });
  let known: RoleDef | undefined;
  if (roleId === "undertaker") {
    // First Night, or nobody died by execution the previous Day: the Undertaker learns nothing, so no row.
    if (game.day <= 1) return null;
    const deaths = query.lifeEvents({ phase: "day", day: game.day - 1 }, (event) => event.kind === "execution" && event.outcome === "died");
    if (deaths.status === "known" && !deaths.events.length) return null;
    const event = deaths.status === "known" && deaths.events.length === 1 ? deaths.events[0]! : undefined;
    const actor = game.players[step.playerId];
    const working = !step.isDeceived && actor?.participantId ? query.abilityFunctions({ playerId: actor.id, participantId: actor.participantId }) : undefined;
    if (event?.actualRoleAtEvent && working?.known && working.value && !passiveRegistrationOptions(event.actualRoleAtEvent)) {
      const registered = query.registration({ playerId: event.subject.playerId, participantId: event.subject.participantId }, "undertaker").character;
      const shown = registered.known ? registry.get(registered.value) : undefined;
      if (shown && isCanonicalRole(shown) && shown.id === event.actualRoleAtEvent) known = shown;
    }
  }
  if (roleId === "ravenkeeper" && !step.isDeceived) {
    // Only a Ravenkeeper who died tonight wakes to learn something.
    const died = query.lifeEvents({ phase: "night", day: game.day },
      (event) => isDeathEvent(event) && event.subject.participantId === step.participantId && event.actualRoleAtEvent === "ravenkeeper");
    if (died.status === "known" && !died.events.length) return null;
  }
  return host.button({ role: known, onClick: () => known ? host.show(known.id) : host.choose((id) => presentCharacter(REVEAL.title ?? REVEAL.label, id)) });
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
    // A ruling the rules need before any player is tapped, in the Grimoire's prompt style (the heading above, the answers on one row).
    if (engine.question) rows.push(<QuestionBlock key="question" heading={engine.question.heading} note={engine.question.note}
      actions={[{ label: "Yes", onClick: () => engine.answerQuestion(true) }, { label: "No", onClick: () => engine.answerQuestion(false) }]} />);
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
      } else if (!done && !engine.skipReason && (current.effectiveRoleId === "undertaker" || current.effectiveRoleId === "ravenkeeper")) {
        const row = manualReveal(game, script, registry, current);
        if (row) rows.push(<Fragment key="manual-reveal">{row}</Fragment>);
      } else if (!done && engine.bureaucrat && engine.actor?.participantId) {
        rows.push(<BureaucratAction key={`${engine.actor.participantId}:${current.stepKey}`} source={{ playerId: engine.actor.id, participantId: engine.actor.participantId }}
          visible={engine.visible} completeStep={{ day: game.day, stepKey: current.stepKey }} onResolved={engine.finish} />);
      } else if (!done && !engine.manual && !engine.canTarget) {
        rows.push(<button key="continue" type="button" className="btn btn-gold" onClick={() => engine.openWorkspace()}>Continue action</button>);
      }
      // T30: the Godfather's first night shows the Outsiders in play on ONE screen, like the Demon's bluffs.
      if (current.effectiveRoleId === "godfather" && game.day === 1 && !current.isDeceived && !engine.settled.has(current.stepKey)) {
        const outsiders = [...new Set(Object.values(game.players).filter((p) => !p.isEmpty && !p.isTraveler && p.actualRole && registry.get(p.actualRole)?.type === "outsider").map((p) => p.actualRole!))];
        const first = registry.get(outsiders[0] ?? "");
        if (first) rows.push(<TokenInformationAction key="in-play" role={outsiders.length === 1 ? first : undefined} label={outsiders.length === 1 ? "Show this token" : "Show these tokens"}
          onClick={() => report(presentCharacters("Godfather Information", outsiders))} />);
      }
      // The new Imp (the Imp's own death tonight, or a Scarlet Woman who took over): wake them, show YOU ARE, then the Imp token.
      if (current.effectiveRoleId === "imp" && !current.isDeceived) {
        const heir = newImpToWake(game, game.players[current.playerId], done || engine.settled.has(current.stepKey));
        const imp = registry.get("imp");
        if (heir && imp) rows.push(<TokenInformationAction key={`new-imp:${heir.id}`} role={imp} label={`Wake ${heir.name || `Seat ${heir.seat + 1}`}: You Are`}
          onClick={() => report(presentCharacter("You Are", "imp"))} />);
      }
      // PO review C15: no "Give information" form in the Night card; the Storyteller tells the player in person.
    } else if (!done && engine.bureaucrat && engine.actor?.participantId) {
      rows.push(<BureaucratAction key={`${engine.actor.participantId}:${current.stepKey}`} source={{ playerId: engine.actor.id, participantId: engine.actor.participantId }}
        visible={engine.visible} completeStep={{ day: game.day, stepKey: current.stepKey }} onResolved={engine.finish} />);
    } else if (current.participantId && current.label.endsWith("wakes the Demon") && game.players[Object.keys(game.players).find((id) => game.players[id]!.participantId === current.participantId) ?? ""]?.actualRole === "marionette") {
      // T30: the Demon is woken and shown THIS PLAYER IS and the Marionette token (the design's show button).
      const marionette = registry.get("marionette");
      if (marionette) rows.push(<TokenInformationAction key="marionette-reveal" role={marionette} label="This Player Is" onClick={() => report(presentCharacter("This Player Is", "marionette"))} />);
    } else if (["minionInfo", "demonInfo"].includes(current.stepKey)) {
      // PO 2026-10-28: Minion and Demon information open the same V2 Reveal as the Information panel.
      rows.push(<SetupInformationAction key={current.stepKey} game={game} script={script} step={current} visible={engine.visible} resolved={done}
        present={presentSetup} />);
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
