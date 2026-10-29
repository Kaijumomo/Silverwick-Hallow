import { useEffect, useMemo, useRef, type RefObject } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilityInputValue } from "@/abilities/semantics";
import { automationEligibility } from "@/abilities/automationEligibility";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { bureaucratActionEligibility } from "@/stores/voting";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { captureFingerprint, planAbilityResolution, type ParticipantBinding } from "@/stores/abilityResolution";
import { getNightActionCorrection } from "@/stores/nightActionCorrection";
import { travelerArrivalStepKey } from "@/stores/nightProgress";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { WorkspaceTarget } from "@/features/abilities/AbilityWorkspace";
import { bindingOf, pathAbility, seatedParticipants, triggerAbility, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import { participantAllowed } from "@/features/abilities/RequirementInput";
import { deriveNightWork, stepResolved, unfinishedNightWork, type NightWork, type TriggeredNightWork, type UnfinishedNightWork } from "@/features/nightOrder/nightWork";
import type { NightStep } from "@/features/nightOrder/nightOrder";
import { NIGHT_INFORMATION_ROLES, type NightInformationHandle } from "@/features/nightOrder/NightInformationAction";
import { FIRST_INFORMATION_CHARACTERS } from "@/features/setup/FirstInformationPreparation";
import type { V6Ctx } from "../ctx";
import { flash, veilChange } from "../v6Store";
import { roman } from "../ringLayout";
import { activeCheckpoint, useNightPos, type NightCheckpoint } from "./nightPos";
import { dawnFlash, nightDeaths, resolvePosition, type NightPosition } from "./nightSteps";
import { useScoped } from "./useScoped";

const semantics = CANONICAL_ABILITY_SEMANTICS;
const simpleTarget = (descriptor: AbilityDescriptor) => descriptor.presentation.complexity === "simple"
  && descriptor.inputs.length === 1 && descriptor.inputs[0]!.kind === "participant"
  && (descriptor.inputs[0]!.count ?? 1) === 1 && descriptor.inputs[0]!.source !== "judgment";

export type NightWorkspace = { target: WorkspaceTarget; ability: StepAbility; inputs?: Record<string, AbilityInputValue>; key: number };
export type SuccessorChoice = { game: StorytellerLobbyRecord; stepKey: string; inputs: Record<string, AbilityInputValue>; id: string; eligible: Set<string> };
type Success = { key: string; game: StorytellerLobbyRecord; step: NightStep };

/**
 * The Night engine behind the V2 Night strip.
 *
 * It is the guided-night logic of ModernNightPanel (which decides every consequence through the canonical
 * planners and commands) re-hosted as a hook, with the V2 navigation around it: Dusk, tonight's steps and
 * Dawn are the three kinds of place the strip can rest. No rule lives here. Every game change is still a
 * store command; this file only decides what the Storyteller is looking at and when it moves on.
 */
export function useNightEngine(ctx: V6Ctx, information: RefObject<NightInformationHandle>) {
  const { game, script, registry, ui, privacy } = ctx;
  const active = game.phase === "night" && !privacy && !!script;
  const visible = active && ctx.cards.strip;
  const scope = `${game.code}:${game.storytellerUid}:${game.day}:${active}`;
  const work: NightWork | null = useMemo(
    () => active && script ? deriveNightWork(game, { script, registry, semantics }) : null,
    [active, game, script, registry]);
  const steps = work?.steps ?? EMPTY_STEPS;
  const query = work?.query;
  const cursor = useShellStore((s) => s.nightCursor);
  const actionRequest = useShellStore((s) => s.actionRequest);
  const picker = useTargetPicker((s) => s.active);
  const refused = useTargetPicker((s) => s.refused);
  const nightPos = useNightPos();

  const [workspace, setWorkspace] = useScoped<NightWorkspace | null>(scope, null);
  const [paused, setPaused] = useScoped(scope, false);
  const [error, setError] = useScoped<string | null>(scope, null);
  const [success, setSuccess] = useScoped<Success | null>(scope, null);
  const [manualAction, setManualAction] = useScoped<string | null>(scope, null);
  const [successorChoice, setSuccessorChoice] = useScoped<SuccessorChoice | null>(scope, null);
  const sequence = useRef(0);
  const actionContext = captureCharacterActionContext();

  const checkpoint = activeCheckpoint(nightPos, game.day, cursor);
  const pos: NightPosition = resolvePosition({
    game, steps, checkpoint,
    cursorKey: cursor?.day === game.day ? cursor.stepKey : undefined,
    held: success?.game === game ? success.step : undefined,
  });
  const current = pos.kind === "step" ? pos.step : undefined;
  const currentIndex = current ? steps.findIndex((step) => step.stepKey === current.stepKey) : -1;
  const resolved = current ? stepResolved(game, current) : false;
  const actor = current?.kind === "player" ? game.players[current.playerId]
    : current?.travelerArrivalId ? game.players[current.travelerArrivalId] : undefined;

  const abilityOf = (step: NightStep): StepAbility | null => {
    if (step.kind !== "player") return null;
    const ordinary = pathAbility(step.effectiveRoleId, registry, semantics, "nightOrder", game);
    if (ordinary.kind === "guided") return ordinary;
    const player = game.players[step.playerId];
    return (query && player?.participantId && triggerAbility(step.effectiveRoleId, registry, semantics, query, bindingOf(player))) || ordinary;
  };
  const ability = current ? abilityOf(current) : null;
  const eligible = !!(query && ability?.kind === "guided" && actor?.participantId && current?.kind === "player"
    && (!current.isDeceived || NIGHT_INFORMATION_ROLES.has(current.effectiveRoleId))
    && (!ability.trigger || ability.trigger.kind === "triggered")
    && automationEligibility({ query, descriptor: ability.descriptor, actor: bindingOf(actor),
      roleId: current.effectiveRoleId, simulated: current.isDeceived }).kind === "automated"
    && manualAction !== current.stepKey);
  const manualRavenkeeper = current?.kind === "player" && current.effectiveRoleId === "ravenkeeper" && current.isDeceived;
  const preparedInformation = current?.kind === "player" && FIRST_INFORMATION_CHARACTERS.has(current.effectiveRoleId);
  const butlerTurn = current?.kind === "player" && current.effectiveRoleId === "butler";
  const inlineInformation = !!(butlerTurn || preparedInformation || current?.kind === "player" && NIGHT_INFORMATION_ROLES.has(current.effectiveRoleId)
    && ability?.kind === "guided" && (!!eligible || resolved || manualRavenkeeper));
  const direct = !inlineInformation && eligible && ability?.kind === "guided" && !ability.invocationPath && simpleTarget(ability.descriptor);
  const correction = current && resolved ? getNightActionCorrection(game, game.day, current.stepKey) : null;
  const canTarget = !!direct && (!resolved || !!correction?.canCorrect);
  const role = current?.kind === "player" ? registry.get(current.effectiveRoleId) : actor?.actualRole ? registry.get(actor.actualRole) : undefined;
  const bureaucrat = !!(actor?.actualRole === "bureaucrat" && actor.participantId && script
    && bureaucratActionEligibility(game, bindingOf(actor), { script, registry, semantics }).known
    && current?.participantId === actor.participantId
    && (current.kind === "player" ? current.effectiveRoleId === "bureaucrat"
      : current.stepKey === travelerArrivalStepKey(actor.participantId, "bureaucrat")));
  const manual = !bureaucrat && !eligible;
  const owner = current ? `night-guide:${game.code}:${game.day}:${current.stepKey}` : "night-guide";
  const live = useRef({ visible, current, game, successorChoice });
  live.current = { visible, current, game, successorChoice };

  const unfinished: UnfinishedNightWork | null = useMemo(() => work ? unfinishedNightWork(game, work) : null, [work, game]);

  // ── navigation ────────────────────────────────────────────────────────────
  const settle = () => {
    setSuccessorChoice(null);
    useTargetPicker.getState().cancel();
    setWorkspace(null); setSuccess(null); setError(null); setPaused(false);
    setManualAction(null);
  };
  const navigate = (step: NightStep) => {
    settle();
    useShellStore.getState().setNightCursor({ day: game.day, stepKey: step.stepKey });
    useNightPos.getState().go(game.day, null, null);
  };
  const gotoCheckpoint = (at: NightCheckpoint) => {
    settle();
    useNightPos.getState().go(game.day, at, useShellStore.getState().nightCursor);
  };
  const advance = () => {
    const next = steps.slice(currentIndex + 1).find((step) => !stepResolved(game, step));
    if (next) navigate(next);
    else gotoCheckpoint("dawn");
  };
  const requireManual = () => {
    setSuccessorChoice(null);
    if (current) setManualAction(current.stepKey);
    useTargetPicker.getState().cancel(); setWorkspace(null); setError(null); setPaused(true);
  };
  const finish = (committed: StorytellerLobbyRecord) => {
    setSuccessorChoice(null);
    if (!current || !stepResolved(committed, current)) return;
    useShellStore.getState().setNightCursor({ day: game.day, stepKey: current.stepKey });
    useNightPos.getState().go(game.day, null, null);
    setWorkspace(null); setError(null); setPaused(!direct);
    setSuccess({ key: current.stepKey, game: committed, step: current });
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
  /** A verified trigger that has no Night row of its own (Dawn lists it among the unfinished work). */
  const openTrigger = (item: TriggeredNightWork) => {
    useTargetPicker.getState().cancel();
    setPaused(true);
    setWorkspace({ key: ++sequence.current, ability: item.ability, target: {
      actorId: item.player.id, roleId: item.roleId, roleName: item.roleName, invocationPath: "nightTrigger",
      step: { day: game.day, stepKey: item.stepKey }, trigger: { eventId: item.eventId ?? "" },
    } });
  };

  const choose = (target: ParticipantBinding) => {
    // A hidden or superseded callback never resolves against a different game.
    if (!live.current.visible || usePrivacyStore.getState().enabled || live.current.current?.stepKey !== current?.stepKey
      || game !== useStorytellerStore.getState().game || !current || current.kind !== "player" || ability?.kind !== "guided" || !script) return;
    if (resolved) {
      const result = useStorytellerStore.getState().correctNightActionTarget({ day: game.day, stepKey: current.stepKey, target }, actionContext);
      if (!result.ok) { setError(result.message); return; }
      finish(useStorytellerStore.getState().game!);
      return;
    }
    const input = ability.descriptor.inputs[0]!;
    if (successorChoice && (live.current.successorChoice !== successorChoice || successorChoice.game !== game || successorChoice.stepKey !== current.stepKey)) return;
    const inputs = successorChoice
      ? { ...successorChoice.inputs, [successorChoice.id]: { kind: "participant" as const, participants: [target] } }
      : { [input.id]: { kind: "participant" as const, participants: [target] } };
    const fingerprint = captureFingerprint(game, current.playerId, { day: game.day, stepKey: current.stepKey });
    if (!fingerprint) { setError("This player is no longer seated."); return; }
    const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: current.effectiveRoleId, inputs, completeStep: true };
    const plan = planAbilityResolution(game, request, { script, registry, semantics });
    if (!plan.ok && plan.code === "unsupported") { requireManual(); return; }
    if (!plan.ok && plan.code === "needsInput") {
      if (current.effectiveRoleId === "imp") {
        const requirement = plan.requirements?.[0];
        // A verified successor choice stays on the board. Rule judgments
        // never become a guided fallback and no partial death is committed.
        if (successorChoice || plan.requirements?.length !== 1 || requirement?.source !== "storyteller" || requirement.kind !== "participant") {
          requireManual(); return;
        }
        const eligibleSuccessors = new Set(seatedParticipants(game).filter((player) => {
          const candidate = planAbilityResolution(game, { ...request, inputs: { ...inputs,
            [requirement.id]: { kind: "participant", participants: [bindingOf(player)] } } }, { script, registry, semantics });
          return candidate.ok;
        }).map((player) => player.participantId!));
        if (!eligibleSuccessors.size) { requireManual(); return; }
        setSuccessorChoice({ game, stepKey: current.stepKey, inputs, id: requirement.id, eligible: eligibleSuccessors });
        setPaused(false); return;
      }
      openWorkspace(inputs); return;
    }
    if (!plan.ok) { setError(plan.message); return; }
    const result = useStorytellerStore.getState().resolveAbility(request, semantics, actionContext);
    if (!result.ok) { setError(result.message); return; }
    finish(useStorytellerStore.getState().game!);
  };

  // ── effects (ported from the guided Night panel) ──────────────────────────
  useEffect(() => {
    if (!current || cursor?.day === game.day && cursor.stepKey === current.stepKey) return;
    useShellStore.getState().setNightCursor({ day: game.day, stepKey: current.stepKey });
  }, [current?.stepKey, cursor?.stepKey, cursor?.day, game.day]);
  useEffect(() => {
    useShellStore.getState().setLitActor(active && actor?.participantId && current
      ? { playerId: actor.id, participantId: actor.participantId, stepKey: current.stepKey } : null);
  }, [active, actor?.id, actor?.participantId, current?.stepKey]);
  useEffect(() => {
    if (!visible || paused || workspace || !canTarget || !actor || ability?.kind !== "guided") return;
    const input = ability.descriptor.inputs[0]!;
    const eligibleTargets = successorChoice?.eligible ?? new Set(seatedParticipants(game).filter((p) => participantAllowed(p, input, bindingOf(actor))).map((p) => p.participantId!));
    useTargetPicker.getState().start(successorChoice ? "Choose the new Imp" : resolved ? "Correct target" : ability.descriptor.presentation.action, choose, { owner, eligible: eligibleTargets });
    return () => { if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, current?.stepKey, visible, paused, workspace, canTarget, successorChoice]);
  useEffect(() => { if (!visible) { useTargetPicker.getState().cancel(); setSuccess(null); } else setPaused(false); }, [visible]);
  useEffect(() => {
    if (!active) {
      useTargetPicker.getState().cancel();
      useShellStore.getState().setLitActor(null); useShellStore.getState().setActionOpen(false);
    }
  }, [active]);
  useEffect(() => () => {
    live.current.visible = false;
    useTargetPicker.getState().cancel(); useShellStore.getState().setLitActor(null); useShellStore.getState().setActionOpen(false);
  }, []);
  // A guided success that is not a direct board pick (or an information action) moves on by itself.
  // A direct pick waits for Next: its target stays correctable without a timer racing the Storyteller.
  useEffect(() => {
    if (direct || inlineInformation || !success || !visible || success.key !== current?.stepKey || success.game !== game) return;
    const timer = window.setTimeout(advance, 2200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, inlineInformation, success, visible, current?.stepKey, game]);
  useEffect(() => {
    if (successorChoice && (successorChoice.game !== game || successorChoice.stepKey !== current?.stepKey)) setSuccessorChoice(null);
    // Undo and external corrections invalidate the displayed result as well as
    // its timer; the restored step must immediately be actionable again.
    if (success && (success.game !== game || success.key !== current?.stepKey)) {
      setSuccess(null); setPaused(false);
    }
    if (workspace && workspace.target.step?.stepKey !== current?.stepKey && !isTriggerWorkspace(workspace, work)) setWorkspace(null);
  }, [game, current?.stepKey, success, workspace, successorChoice]);
  // Manual procedures retain their original controls, but a completed procedure
  // participates in the same delayed advance as a guided ability.
  const previousStatus = useRef({ key: current?.stepKey, resolved });
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = { key: current?.stepKey, resolved };
    if (visible && previous.key === current?.stepKey && !previous.resolved && resolved && !success) finish(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.stepKey, resolved, game, visible]);
  const lastRequest = useRef(actionRequest);
  useEffect(() => {
    if (lastRequest.current === actionRequest) return;
    if (!active) { lastRequest.current = actionRequest; return; }
    // The actor tap first opens the enclosing card. Consume the request only
    // once that card is visible, so a hidden draft can actually resume.
    if (!visible) { ui.set({ panel: "night" }); return; }
    lastRequest.current = actionRequest;
    if (resolved) return;
    if (direct || bureaucrat || inlineInformation) setPaused(false); else if (!workspace) openWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest, visible, active]);

  // ── the Storyteller's moves ───────────────────────────────────────────────
  const goDusk = () => gotoCheckpoint("dusk");
  const prev = () => {
    if (!active) return;
    if (pos.kind === "dusk") return;
    if (pos.kind === "dawn") { const last = steps.at(-1); if (last) navigate(last); else goDusk(); return; }
    if (currentIndex <= 0) { goDusk(); return; }
    navigate(steps[currentIndex - 1]!);
  };
  const next = () => {
    if (!active) return;
    if (pos.kind === "dawn") return;
    if (pos.kind === "dusk") { const first = steps[0]; if (first) navigate(first); else gotoCheckpoint("dawn"); return; }
    if (!current) return;
    // Calculated information is communicated by Next: the pending answer is recorded first, and a
    // refusal keeps the Storyteller on the step.
    if (inlineInformation && information.current && !information.current.next()) return;
    const liveGame = useStorytellerStore.getState().game;
    if ((manual || inlineInformation) && liveGame && !stepResolved(liveGame, current)) {
      const result = useStorytellerStore.getState().setNightStepStatus(game.day, current.stepKey, "done", actionContext);
      if (!result.ok) { setError(result.message); return; }
    }
    const following = currentIndex < 0 ? steps.find((step) => !stepResolved(game, step)) : steps[currentIndex + 1];
    if (following) navigate(following);
    else gotoCheckpoint("dawn");
  };
  const proceedToDay = () => {
    const deaths = nightDeaths(game);
    veilChange(`Day ${roman(game.day)}`, "Dawn over Silverwick Hollow", true, () => {
      const result = useStorytellerStore.getState().advancePhase();
      if (!result.ok) { flash("Setup changed. Open Players to review what needs attention."); return false; }
      useNightPos.getState().go(0, null, null);
      flash(dawnFlash(deaths));
      return true;
    });
  };
  /** Begin Day. Unfinished work sends the Storyteller to Dawn first; there, continuing is explicit. */
  const beginDay = () => {
    if (!active) { if (privacy && game.phase === "night") flash("Turn off Privacy Mode first."); return; }
    if (ctx.mutationLocked) return;
    if ((unfinished?.total ?? 0) > 0 && pos.kind !== "dawn") {
      gotoCheckpoint("dawn");
      ui.set({ panel: "night" });
      return;
    }
    useTargetPicker.getState().cancel();
    proceedToDay();
  };

  return {
    active, visible, work, steps, unfinished, pos, current, currentIndex, resolved, actor, role, ability, query,
    eligible, direct, canTarget, inlineInformation, preparedInformation, butlerTurn, bureaucrat, manual, manualRavenkeeper, correction,
    workspace, setWorkspace, setPaused, error, setError, success, successorChoice, picker, refused, owner, actionContext,
    navigate, gotoCheckpoint, prev, next, beginDay, openWorkspace, openTrigger, requireManual, finish,
  };
}

export type NightEngine = ReturnType<typeof useNightEngine>;

const EMPTY_STEPS: NightStep[] = [];

/** A workspace opened for a trigger that has no Night row keeps its own owner step. */
function isTriggerWorkspace(workspace: NightWorkspace, work: NightWork | null): boolean {
  return !!work?.triggered.some((item) => item.stepKey === workspace.target.step?.stepKey)
    && !work.steps.some((step) => step.stepKey === workspace.target.step?.stepKey);
}
