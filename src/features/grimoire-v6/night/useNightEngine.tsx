import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilityInputValue } from "@/abilities/semantics";
import { automationEligibility } from "@/abilities/automationEligibility";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { bureaucratActionEligibility } from "@/stores/voting";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { captureFingerprint, planAbilityResolution, type ParticipantBinding } from "@/stores/abilityResolution";
import { getNightActionCorrection } from "@/stores/nightActionCorrection";
import { travelerArrivalStepKey } from "@/stores/nightProgress";
import type { RoleType, StorytellerLobbyRecord } from "@/stores/types";
import { CERENOVUS_CHARACTER } from "@/abilities/characters/cerenovus";
import type { WorkspaceTarget } from "@/features/abilities/AbilityWorkspace";
import { bindingOf, pathAbility, seatedParticipants, triggerAbility, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import { runsGainedAbility } from "@/abilities/characters/passiveRules";
import { mayorBounceOffered, subjectId } from "@/abilities/characters/shared";
import { MAYOR_BOUNCE } from "@/abilities/characters/imp";
import { participantAllowed } from "@/features/abilities/RequirementInput";
import { pendingMoonchildChoice } from "@/abilities/characters/moonchild";
import { deriveNightWork, stepResolved, unfinishedNightWork, type NightWork, type TriggeredNightWork, type UnfinishedNightWork } from "@/features/nightOrder/nightWork";
import type { NightStep } from "@/rules/night/nightOrder";
import { NIGHT_INFORMATION_ROLES, type NightInformationHandle } from "@/features/nightOrder/NightInformationAction";
import { FIRST_INFORMATION_CHARACTERS } from "@/features/setup/FirstInformationPreparation";
import type { V6Ctx } from "../ctx";
import { flash, showVeil, useV6Ui } from "../v6Store";
import { guardGesture } from "./gestureGuard";
import { roman } from "../ringLayout";
import { activeCheckpoint, useNightPos, type NightCheckpoint } from "./nightPos";
import { dawnFlash, nightDeaths, resolvePosition, type NightPosition } from "./nightSteps";
import { useScoped } from "./useScoped";
import { duskRegurgitation, regurgitate } from "./regurgitate";

const semantics = CANONICAL_ABILITY_SEMANTICS;
/** Characters whose whole action is tapped on the board (T30 design). Others keep the ability workspace. */
const BOARD_ROLES = new Set(["innkeeper", "shabaloth", "gambler", "godfather", "professor", "moonchild", "vigormortis", "cerenovus"]);
/** A player tapped on the board, then a character picked from the board's character picker (the Gambler's guess; SV-4a: the Cerenovus's
 * madness, a Townsfolk or an Outsider, tokens only, no player names). */
const CHARACTER_PICKS: Record<string, { input: string; title: string; kicker: (target: string) => string; types?: RoleType[] }> = {
  gambler: { input: "guess", title: "What does the Gambler guess?", kicker: (target) => `The Gambler · guess ${target}’s character` },
  cerenovus: { input: CERENOVUS_CHARACTER, title: "Choose a character", kicker: () => "The Cerenovus · a Townsfolk or an Outsider", types: ["townsfolk", "outsider"] },
};
/** What the Cerenovus chose tonight, kept for the Night card's reveal row (a drunk or poisoned Cerenovus records no MAD, so the pick is also held here). */
export type CerenovusChoice = { stepKey: string; target: ParticipantBinding; roleId: string };
/**
 * A simple single-player choice is always tapped on the board. The BOARD_ROLES also tap a fixed count of players
 * (Innkeeper, Shabaloth) or a player then a character guess (Gambler). A needsInput the board cannot answer
 * still falls back to the ability workspace in `choose`.
 */
const boardTarget = (descriptor: AbilityDescriptor) => {
  const [first, ...rest] = descriptor.inputs;
  if (!first || first.kind !== "participant" || first.source === "judgment") return false;
  if (descriptor.presentation.complexity === "simple") return descriptor.inputs.length === 1 && (first.count ?? 1) === 1;
  return BOARD_ROLES.has(descriptor.roleId) && rest.length <= 1 && rest.every((input) => input.kind === "character" && input.source !== "judgment");
};
const pickCount = (descriptor: AbilityDescriptor) => descriptor.inputs[0]?.count ?? 1;

export type NightWorkspace = { target: WorkspaceTarget; ability: StepAbility; inputs?: Record<string, AbilityInputValue>; key: number };
/**
 * PO review 2026-11-21 (SV-2c): a tap that needs one Storyteller ruling about the chosen player -- does the Recluse register as a
 * Demon (Snake Charmer), does a Recluse or Spy register as an Outsider (Fang Gu) -- is asked on the Night card itself, in the
 * Barber card's compact style, never in the ability workspace. The tap is held; the answer commits (one Undo).
 */
const TAP_RULINGS = [
  { prefix: "snakecharmer:registersAsDemon:", kind: "demon" as const },
  { prefix: "fanggu:registersAsOutsider:", kind: "outsider" as const },
  // TB: a Demon attack on a certainly working, unprotected Mayor ("another player might die instead"): asked as soon as the Mayor is tapped.
  { prefix: `${MAYOR_BOUNCE}:`, kind: "mayor" as const },
];
export type TapRuling = { game: StorytellerLobbyRecord; stepKey: string; inputs: Record<string, AbilityInputValue>; id: string; kind: "demon" | "outsider" | "mayor"; target: ParticipantBinding };
/** `replacement`: the Mayor's bounce is waiting for the player who dies instead (any living player may be tapped; a protected one is refused with the reason). */
export type SuccessorChoice = { game: StorytellerLobbyRecord; stepKey: string; inputs: Record<string, AbilityInputValue>; id: string; eligible: Set<string>; replacement?: boolean; target?: string };
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
  const [tapRuling, setTapRuling] = useScoped<TapRuling | null>(scope, null);
  // A refused replacement (a protected player) puts the picker back, so the Storyteller chooses again.
  const [pickNonce, setPickNonce] = useState(0);
  // Players tapped so far for a step that takes several (Innkeeper, Shabaloth), and the player the Gambler chose
  // while the guess is being picked.
  const [picks, setPicks] = useScoped<ParticipantBinding[]>(scope, EMPTY_PICKS);
  const [guessFor, setGuessFor] = useScoped<ParticipantBinding | null>(scope, null);
  const [cerenovusChoice, setCerenovusChoice] = useScoped<CerenovusChoice | null>(scope, null);
  // A ruling the Storyteller gives BEFORE any player is tapped (the Godfather's "did an Outsider die today?"), by step.
  const [rulings, setRulings] = useScoped<Record<string, Record<string, AbilityInputValue>>>(scope, EMPTY_RULINGS);
  // A ruling belongs to the Day it was given about: it is keyed by that Day's recorded events, which are new every time the Day is replayed
  // (an Undo back into the Day), so a replayed Day asks again instead of reusing an answer from the undone one.
  const dayEvents = game.lifeEventWindow.events.filter((event) => event.moment.phase === "day" && event.moment.day === game.day - 1).map((event) => event.id).join(",");
  const rulingKey = (stepKey: string) => `${stepKey}|${dayEvents}`;
  const sequence = useRef(0);
  const actionContext = captureCharacterActionContext();

  const abilityOf = (step: NightStep): StepAbility | null => {
    if (step.kind !== "player") return null;
    // SV-3a: an ability the player gained (the Philosopher's chosen character) is run by hand at that character's place, except the
    // ones the app runs exactly as the real character's step (SV-3b: the Snake Charmer, the Town Crier, the Oracle).
    if (step.gainedFrom && !runsGainedAbility(step.effectiveRoleId)) return { kind: "manual", reason: GAINED_BY_HAND };
    const ordinary = pathAbility(step.effectiveRoleId, registry, semantics, "nightOrder", game);
    if (ordinary.kind === "guided") return ordinary;
    const player = game.players[step.playerId];
    return (query && player?.participantId && triggerAbility(step.effectiveRoleId, registry, semantics, query, bindingOf(player))) || ordinary;
  };
  // T30 design, PO-approved for every script on 2026-11-21: a step the rules say does not wake shows why (no Outsider died today, no
  // execution today, ...). Those steps are collapsed: Next and Previous pass over them, Dawn does not count them, and the strip dims
  // them -- but each stays one tap away on the strip, where its reason is shown. Only a step the shared rules planner can judge
  // (a guided, reviewed-list ability) is probed; any other step stays the Storyteller's and is never marked.
  const probed = useMemo(() => {
    const out = new Map<string, string>();
    const questions = new Map<string, NightQuestion>();
    if (!script) return { out, questions };
    for (const step of steps) {
      if (step.kind !== "player" || stepResolved(game, step)) continue;
      const stepAbility = abilityOf(step);
      if (!stepAbility || stepAbility.kind !== "guided" || step.advisory?.includes("Vigormortis")) continue;
      // A step whose trigger has fired (a Ravenkeeper killed tonight) wakes by its trigger, not by the night order the probe tries.
      // A trigger whose state is unknown (the death has no recorded evidence) is the Storyteller's check ("trigger needs your check"), never "does not wake".
      if (stepAbility.trigger) continue;
      const fingerprint = captureFingerprint(game, step.playerId, { day: game.day, stepKey: step.stepKey });
      if (!fingerprint) continue;
      // The rules answer "does not act tonight" before they read any choice, so probe with placeholder choices.
      const stepActor = game.players[step.playerId];
      const actorSeat = stepActor?.participantId ? bindingOf(stepActor) : null;
      const probe: Record<string, AbilityInputValue> = {};
      for (const input of stepAbility.descriptor.inputs) {
        if (input.kind === "participant" && actorSeat) {
          const pool = seatedParticipants(game).filter((p) => participantAllowed(p, input, actorSeat)).slice(0, input.count ?? 1);
          probe[input.id] = { kind: "participant", participants: pool.map(bindingOf) };
        } else if (input.kind === "character") probe[input.id] = { kind: "character", roleIds: [script.characters[0]?.id ?? ""] };
      }
      const plan = planAbilityResolution(game, { mode: "guided", invocationPath: "nightOrder", fingerprint, roleId: step.effectiveRoleId, inputs: { ...probe, ...rulings[rulingKey(step.stepKey)] }, completeStep: true },
        { script, registry, semantics });
      if (!plan.ok && plan.code === "notApplicable") out.set(step.stepKey, plan.message);
      // A yes/no ruling the rules need before anything is chosen (a Spy or Recluse died in the Day: did an Outsider die?) is asked first.
      const requirement = !plan.ok && plan.code === "needsInput" && plan.requirements?.length === 1 ? plan.requirements[0] : undefined;
      if (!plan.ok && requirement && requirement.kind === "boolean" && requirement.source === "storyteller" && requirement.id.startsWith("godfather:outsiderDied"))
        questions.set(step.stepKey, { id: requirement.id, heading: "Did an Outsider die today?", note: plan.message.replace(/\s*Did an Outsider die today\?$/, "") });
    }
    return { out, questions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, steps, script, rulings]);
  const idleReasons: ReadonlyMap<string, string> = probed.out;
  /** Rows that need no wake tonight: revived after their turn, or the rules say they do not act. */
  const settled: ReadonlySet<string> = useMemo(() => new Set([...(work?.late ?? []), ...idleReasons.keys()]), [work, idleReasons]);

  const checkpoint = activeCheckpoint(nightPos, game.day, cursor);
  const pos: NightPosition = resolvePosition({
    game, steps, checkpoint,
    cursorKey: cursor?.day === game.day ? cursor.stepKey : undefined,
    held: success?.game === game ? success.step : undefined,
    late: settled,
  });
  const current = pos.kind === "step" ? pos.step : undefined;
  const currentIndex = current ? steps.findIndex((step) => step.stepKey === current.stepKey) : -1;
  // PO review 2026-11-21: a step that left the list when it resolved (its player changed character on it: a Snake Charmer swap, a
  // Fang Gu jump, an Imp star pass) keeps its place on the strip and in the counter, at the row of the same character. Display only:
  // Next and Previous still use currentIndex. SV-3b: a gained Snake Charmer's row has no row of the same character after the swap
  // (the Demon becomes the Philosopher), so it keeps its place in the order: the last row at or before it.
  const sameCharacter = currentIndex >= 0 || !current || current.kind !== "player" ? currentIndex
    : steps.findIndex((step) => step.kind === "player" && step.effectiveRoleId === current.effectiveRoleId);
  const positionIndex = sameCharacter >= 0 || !current || current.kind !== "player" || !current.gainedFrom ? sameCharacter
    : Math.max(0, steps.filter((step) => step.order <= current.order).length - 1);
  const resolved = current ? stepResolved(game, current) : false;
  const lateReason = "They were brought back after their turn tonight, so they act from tomorrow night";
  const skipReason: string | null = current && !resolved ? work?.late.has(current.stepKey) ? lateReason : idleReasons.get(current.stepKey) ?? null : null;
  const actor = current?.kind === "player" ? game.players[current.playerId]
    : current?.travelerArrivalId ? game.players[current.travelerArrivalId] : undefined;

  const ability = current ? abilityOf(current) : null;
  const eligible = !!(query && ability?.kind === "guided" && actor?.participantId && current?.kind === "player"
    && (!ability.trigger || ability.trigger.kind === "triggered")
    && automationEligibility({ query, descriptor: ability.descriptor, actor: bindingOf(actor),
      roleId: current.effectiveRoleId, simulated: current.isDeceived }).kind === "automated"
    && manualAction !== current.stepKey);
  const manualRavenkeeper = current?.kind === "player" && current.effectiveRoleId === "ravenkeeper" && current.isDeceived;
  const preparedInformation = current?.kind === "player" && !current.gainedFrom && FIRST_INFORMATION_CHARACTERS.has(current.effectiveRoleId);
  const butlerTurn = current?.kind === "player" && !current.gainedFrom && current.effectiveRoleId === "butler";
  const inlineInformation = !!(butlerTurn || preparedInformation || current?.kind === "player" && NIGHT_INFORMATION_ROLES.has(current.effectiveRoleId)
    && ability?.kind === "guided" && (!!eligible || resolved || manualRavenkeeper));
  const direct = !inlineInformation && eligible && ability?.kind === "guided" && !ability.invocationPath && boardTarget(ability.descriptor);
  const needed = ability?.kind === "guided" ? pickCount(ability.descriptor) : 1;
  const correction = current && resolved ? getNightActionCorrection(game, game.day, current.stepKey) : null;
  const question = current && !resolved ? probed.questions.get(current.stepKey) ?? null : null;
  const pendingRuling = tapRuling && tapRuling.game === game && tapRuling.stepKey === current?.stepKey ? tapRuling : null;
  const canTarget = !!direct && !question && !pendingRuling && (!resolved || needed === 1 && !!correction?.canCorrect);
  const answerQuestion = (yes: boolean) => {
    if (!current || !question) return;
    setRulings({ ...rulings, [rulingKey(current.stepKey)]: { ...rulings[rulingKey(current.stepKey)], [question.id]: { kind: "boolean", value: yes } } });
  };
  const role = current?.kind === "player" ? registry.get(current.effectiveRoleId) : actor?.actualRole ? registry.get(actor.actualRole) : undefined;
  const bureaucrat = !!(actor?.actualRole === "bureaucrat" && actor.participantId && script
    && bureaucratActionEligibility(game, bindingOf(actor), { script, registry, semantics }).known
    && current?.participantId === actor.participantId
    && (current.kind === "player" ? current.effectiveRoleId === "bureaucrat"
      : current.stepKey === travelerArrivalStepKey(actor.participantId, "bureaucrat")));
  const manual = !bureaucrat && !eligible;
  // PO review 2026-11-14 (C1): the Barber's verified step is tapped on the board in the Night card (BarberNightAction), not the workspace.
  const barberTurn = !!eligible && current?.kind === "player" && current.effectiveRoleId === "barber" && ability?.kind === "guided";
  // SV-3a (PO 2026-11-21): the Philosopher's choice is made on the Night card (PhilosopherNightAction), never in the workspace.
  const philosopherTurn = !!eligible && current?.kind === "player" && !current.gainedFrom && current.effectiveRoleId === "philosopher" && ability?.kind === "guided";
  // SV-5c: the Dreamer's player and tokens are chosen on the Night card (DreamerNightAction), never in the workspace.
  const dreamerTurn = !!eligible && current?.kind === "player" && !current.gainedFrom && current.effectiveRoleId === "dreamer" && ability?.kind === "guided";
  // SV-4c: the Evil Twin's reveals and Good Twin choice are made on the Night card (EvilTwinNightAction), never in the workspace.
  const twinTurn = !!eligible && current?.kind === "player" && !current.gainedFrom && current.effectiveRoleId === "eviltwin" && ability?.kind === "guided";
  const owner = current ? `night-guide:${game.code}:${game.day}:${current.stepKey}` : "night-guide";
  const live = useRef({ visible, current, game, successorChoice });
  live.current = { visible, current, game, successorChoice };

  const unfinished: UnfinishedNightWork | null = useMemo(() => work ? unfinishedNightWork(game, work, idleReasons) : null, [work, game, idleReasons]);

  // ── navigation ────────────────────────────────────────────────────────────
  const settle = () => {
    setSuccessorChoice(null); setTapRuling(null); setPicks(EMPTY_PICKS); closeGuess(); setGuessFor(null);
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
    const next = steps.slice(currentIndex + 1).find((step) => !stepResolved(game, step, settled));
    if (next) navigate(next);
    else gotoCheckpoint("dawn");
  };
  /** The automatic route stops here; the Storyteller is told why (never a silent no-op). */
  const stopAutomation = (reason?: string) => {
    setSuccessorChoice(null);
    if (current) setManualAction(current.stepKey);
    useTargetPicker.getState().cancel(); setWorkspace(null); setError(reason ?? null); setPaused(true);
  };
  const requireManual = (reason?: string) => stopAutomation(reason);
  const finish = (committed: StorytellerLobbyRecord) => {
    setSuccessorChoice(null); setTapRuling(null);
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
    if (needed > 1 && !successorChoice) {
      const chosen = [...picks, target];
      if (chosen.length < needed) { setPicks(chosen); return; }
      setPicks(EMPTY_PICKS);
      commitPicks(chosen, input.id); return;
    }
    if (CHARACTER_PICKS[current.effectiveRoleId] && !successorChoice) { chooseGuess(target, input.id); return; }
    if (successorChoice && (live.current.successorChoice !== successorChoice || successorChoice.game !== game || successorChoice.stepKey !== current.stepKey)) return;
    const inputs = successorChoice
      ? { ...successorChoice.inputs, [successorChoice.id]: { kind: "participant" as const, participants: [target] } }
      : { ...rulings[rulingKey(current.stepKey)], [input.id]: { kind: "participant" as const, participants: [target] } };
    const fingerprint = captureFingerprint(game, current.playerId, { day: game.day, stepKey: current.stepKey });
    if (!fingerprint) { setError("This player is no longer seated."); return; }
    const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: current.effectiveRoleId, inputs, completeStep: true };
    // The Mayor: the Storyteller's "Mayor dies / another player dies" is asked before anything is planned (a protected Mayor never gets here
    // as a question: the death gate says nobody dies, and the plan below handles it).
    if (current.effectiveRoleId === "imp" && !successorChoice && query && target.participantId !== actor?.participantId && mayorBounceOffered(query, target)) {
      useTargetPicker.getState().cancel(); setError(null);
      setTapRuling({ game, stepKey: current.stepKey, inputs, id: subjectId(MAYOR_BOUNCE, target), kind: "mayor", target });
      return;
    }
    const plan = planAbilityResolution(game, request, { script, registry, semantics });
    if (!plan.ok && plan.code === "unsupported") { stopAutomation(plan.message); return; }
    if (!plan.ok && successorChoice?.replacement && plan.code !== "needsInput") {
      // "Say they survive, pick again": a protected replacement does not die; the reason is shown and the board is tappable again.
      setError(plan.message); setPickNonce((n) => n + 1); return;
    }
    if (!plan.ok && plan.code === "needsInput") {
      if (current.effectiveRoleId === "imp" || current.effectiveRoleId === "vigormortis") {
        const requirement = plan.requirements?.[0];
        // A verified successor choice stays on the board. Rule judgments
        // never become a guided fallback and no partial death is committed.
        if (successorChoice || plan.requirements?.length !== 1 || requirement?.source !== "storyteller" || requirement.kind !== "participant") {
          stopAutomation(plan.message); return;
        }
        const eligibleSuccessors = new Set(seatedParticipants(game).filter((player) => {
          const candidate = planAbilityResolution(game, { ...request, inputs: { ...inputs,
            [requirement.id]: { kind: "participant", participants: [bindingOf(player)] } } }, { script, registry, semantics });
          return candidate.ok;
        }).map((player) => player.participantId!));
        if (!eligibleSuccessors.size) { stopAutomation(plan.message); return; }
        setSuccessorChoice({ game, stepKey: current.stepKey, inputs, id: requirement.id, eligible: eligibleSuccessors });
        setPaused(false); return;
      }
      const ruling = plan.requirements?.length === 1 ? plan.requirements[0] : undefined;
      const tap = ruling && ruling.kind === "boolean" && ruling.source === "storyteller" && !successorChoice
        ? TAP_RULINGS.find((item) => ruling.id.startsWith(item.prefix)) : undefined;
      if (tap && ruling) {
        useTargetPicker.getState().cancel(); setError(null);
        setTapRuling({ game, stepKey: current.stepKey, inputs, id: ruling.id, kind: tap.kind, target });
        return;
      }
      openWorkspace(inputs); return;
    }
    if (!plan.ok) { setError(plan.message); return; }
    const result = useStorytellerStore.getState().resolveAbility(request, semantics, actionContext);
    if (!result.ok) { setError(result.message); return; }
    finish(useStorytellerStore.getState().game!);
  };

  /** The Storyteller's Yes or No on the held tap: the answer commits the step (one Undo); "Choose again" drops the tap. */
  const answerTapRuling = (value: boolean | null) => {
    const held = pendingRuling;
    if (!held || !current || current.kind !== "player" || !script || game !== useStorytellerStore.getState().game
      || !live.current.visible || usePrivacyStore.getState().enabled) return;
    setTapRuling(null); setError(null);
    if (value === null) return;
    const fingerprint = captureFingerprint(game, current.playerId, { day: game.day, stepKey: current.stepKey });
    if (!fingerprint) { setError("This player is no longer seated."); return; }
    const inputs = { ...held.inputs, [held.id]: { kind: "boolean" as const, value } };
    const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: current.effectiveRoleId, inputs, completeStep: true };
    const plan = planAbilityResolution(game, request, { script, registry, semantics });
    if (!plan.ok && plan.code === "unsupported") { stopAutomation(plan.message); return; }
    if (!plan.ok && plan.code === "needsInput") {
      const requirement = plan.requirements?.length === 1 ? plan.requirements[0] : undefined;
      // "Another player dies": the player who dies instead is tapped on the board. Any living player but the Mayor may be tapped.
      if (held.kind === "mayor" && value && requirement?.source === "storyteller" && requirement.kind === "participant") {
        setSuccessorChoice({ game, stepKey: current.stepKey, inputs, id: requirement.id, replacement: true, target: held.target.playerId,
          eligible: new Set(seatedParticipants(game).filter((p) => p.alive && p.participantId !== held.target.participantId).map((p) => p.participantId!)) });
        setPaused(false); return;
      }
      if (held.kind === "mayor") { stopAutomation(plan.message); return; }
      openWorkspace(inputs); return;
    }
    if (!plan.ok) { setError(plan.message); return; }
    const result = useStorytellerStore.getState().resolveAbility(request, semantics, actionContext);
    if (!result.ok) { setError(result.message); return; }
    finish(useStorytellerStore.getState().game!);
  };

  /** Several players tapped: the Innkeeper's drunk player is the first one tapped (T30 design), never asked. */
  const commitPicks = (chosen: ParticipantBinding[], inputId: string) => {
    if (!current || current.kind !== "player" || ability?.kind !== "guided" || !script) return;
    const fingerprint = captureFingerprint(game, current.playerId, { day: game.day, stepKey: current.stepKey });
    if (!fingerprint) { setError("This player is no longer seated."); return; }
    let inputs: Record<string, AbilityInputValue> = { [inputId]: { kind: "participant", participants: chosen } };
    const env = { script, registry, semantics };
    const make = () => ({ mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: current.effectiveRoleId, inputs, completeStep: true });
    let plan = planAbilityResolution(game, make(), env);
    if (!plan.ok && plan.code === "needsInput" && current.effectiveRoleId === "innkeeper") {
      const requirement = plan.requirements?.length === 1 ? plan.requirements[0] : undefined;
      if (requirement?.source === "storyteller" && requirement.kind === "participant") {
        inputs = { ...inputs, [requirement.id]: { kind: "participant", participants: [chosen[0]!] } };
        plan = planAbilityResolution(game, make(), env);
      }
    }
    if (!plan.ok && plan.code === "unsupported") { stopAutomation(plan.message); return; }
    if (!plan.ok && plan.code === "needsInput") { openWorkspace(inputs); return; }
    if (!plan.ok) { setError(plan.message); return; }
    const result = useStorytellerStore.getState().resolveAbility(make(), semantics, actionContext);
    if (!result.ok) { setError(result.message); return; }
    finish(useStorytellerStore.getState().game!);
  };
  /** The Gambler (and, SV-4a, the Cerenovus) taps the player, then the character is picked from the board's character picker. */
  const closeGuess = () => { const picker = useV6Ui.getState().picker; if (picker?.mode === "show" && picker.onPick) useV6Ui.getState().set({ picker: null }); };
  const chooseGuess = (target: ParticipantBinding, inputId: string) => {
    if (!current || current.kind !== "player" || !script) return;
    setGuessFor(target);
    const base = current;
    guardGesture();
    const gambler = game.players[base.playerId];
    const pick = CHARACTER_PICKS[base.effectiveRoleId]!;
    useV6Ui.getState().set({ pickHover: null, picker: { mode: "show", tokensOnly: true, title: pick.title,
      kicker: pick.kicker(game.players[target.playerId]?.name || "the player"), ...(pick.types ? { types: pick.types } : {}),
      onPick: (roleId) => {
        const fingerprint = captureFingerprint(game, base.playerId, { day: game.day, stepKey: base.stepKey });
        if (!fingerprint || !gambler) return "This player is no longer seated.";
        const inputs: Record<string, AbilityInputValue> = { [inputId]: { kind: "participant", participants: [target] }, [pick.input]: { kind: "character", roleIds: [roleId] } };
        const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: base.effectiveRoleId, inputs, completeStep: true };
        const plan = planAbilityResolution(game, request, { script, registry, semantics });
        if (!plan.ok && plan.code === "needsInput") { closeGuess(); setGuessFor(null); openWorkspace(inputs); return undefined; }
        if (!plan.ok) return plan.message;
        const result = useStorytellerStore.getState().resolveAbility(request, semantics, actionContext);
        if (!result.ok) return result.message;
        closeGuess(); setGuessFor(null);
        if (base.effectiveRoleId === "cerenovus") setCerenovusChoice({ stepKey: base.stepKey, target, roleId });
        finish(useStorytellerStore.getState().game!);
        return undefined;
      } } });
    // Closing the picker without a guess returns to tapping a player.
    const stop = useV6Ui.subscribe((state) => {
      if (state.picker?.mode === "show" && state.picker.onPick) return;
      stop(); setGuessFor(null);
    });
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
    if (!visible || paused || workspace || !canTarget || !actor || ability?.kind !== "guided" || guessFor || skipReason) return;
    const input = ability.descriptor.inputs[0]!;
    const eligibleTargets = successorChoice?.eligible ?? new Set(seatedParticipants(game).filter((p) => participantAllowed(p, input, bindingOf(actor))
      && !picks.some((chosen) => chosen.participantId === p.participantId)).map((p) => p.participantId!));
    useTargetPicker.getState().start(successorChoice ? successorChoice.replacement ? "Choose who dies instead" : current?.effectiveRoleId === "vigormortis" ? "Choose the poisoned neighbour" : "Choose the new Imp" : resolved ? "Correct target" : needed > 1 ? `Choose player ${picks.length + 1} of ${needed}` : ability.descriptor.presentation.action, choose, { owner, eligible: eligibleTargets });
    return () => { if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, current?.stepKey, visible, paused, workspace, canTarget, successorChoice, picks, guessFor, skipReason, pickNonce]);
  // The Moonchild chose publicly during the Day: the death is resolved by itself when the wake is reached. An Undo of it while the
  // step stays open leaves it for the Storyteller; the guard lasts only while this step is current, so reaching the step again
  // (an Undo back to the start of the Night and a replay) resolves the choice again.
  const moonchildChoice = current?.kind === "player" && current.effectiveRoleId === "moonchild" && query && actor?.participantId
    ? pendingMoonchildChoice(query, bindingOf(actor)) : null;
  const autoResolved = useRef<{ step: string | undefined; keys: Set<string> }>({ step: undefined, keys: new Set() });
  useEffect(() => {
    if (autoResolved.current.step !== current?.stepKey) autoResolved.current = { step: current?.stepKey, keys: new Set() };
    if (!moonchildChoice || !visible || paused || workspace || !canTarget || resolved || skipReason || !current) return;
    const key = `${current.stepKey}:${moonchildChoice.effectId}`;
    if (autoResolved.current.keys.has(key)) return;
    autoResolved.current.keys.add(key);
    choose(moonchildChoice.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moonchildChoice?.effectId, visible, paused, workspace, canTarget, resolved, skipReason, current?.stepKey]);
  // Dusk: the Shabaloth may regurgitate one of last night's chosen dead players. The Storyteller taps them on the board, or simply
  // goes on; it is settled before the Shabaloth's own step, so a returning player acts tonight like any living player.
  const regurgitation = pos.kind === "dusk" && query ? duskRegurgitation(game, query) : null;
  useEffect(() => {
    if (!visible || !regurgitation || !query) return;
    const duskOwner = `shabaloth-dusk:${game.code}:${game.day}`;
    useTargetPicker.getState().start("Regurgitate a player (optional)", (target) => {
      if (game !== useStorytellerStore.getState().game || usePrivacyStore.getState().enabled) return;
      const result = regurgitate(query, game, target);
      flash(result.ok ? `${game.players[target.playerId]?.name || "The player"} is alive again.` : result.message);
    }, { owner: duskOwner, eligible: new Set(regurgitation.candidates.map((item) => item.target.participantId)) });
    return () => { if (useTargetPicker.getState().active?.owner === duskOwner) useTargetPicker.getState().cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, visible, !!regurgitation]);
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
  // SV-5c: the Dreamer's two tokens are information to show, so like any information step they wait for Next.
  useEffect(() => {
    if (direct || inlineInformation || dreamerTurn || !success || !visible || success.key !== current?.stepKey || success.game !== game) return;
    const timer = window.setTimeout(advance, 2200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, inlineInformation, dreamerTurn, success, visible, current?.stepKey, game]);
  useEffect(() => {
    if (successorChoice && (successorChoice.game !== game || successorChoice.stepKey !== current?.stepKey)) setSuccessorChoice(null);
    if (tapRuling && (tapRuling.game !== game || tapRuling.stepKey !== current?.stepKey)) setTapRuling(null);
    // Undo and external corrections invalidate the displayed result as well as
    // its timer; the restored step must immediately be actionable again.
    if (success && (success.game !== game || success.key !== current?.stepKey)) {
      setSuccess(null); setPaused(false);
    }
    if (workspace && workspace.target.step?.stepKey !== current?.stepKey && !isTriggerWorkspace(workspace, work)) setWorkspace(null);
  }, [game, current?.stepKey, success, workspace, successorChoice, tapRuling]);
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
    if (direct || bureaucrat || inlineInformation || barberTurn || philosopherTurn || dreamerTurn || twinTurn) setPaused(false); else if (!workspace) openWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRequest, visible, active]);

  // ── the Storyteller's moves ───────────────────────────────────────────────
  const goDusk = () => gotoCheckpoint("dusk");
  const prev = () => {
    if (!active) return;
    if (pos.kind === "dusk") return;
    // Collapsed steps (no wake tonight) are passed over; each stays reachable from the strip.
    const waking = (step: NightStep) => !settled.has(step.stepKey);
    if (pos.kind === "dawn") { const last = [...steps].reverse().find(waking); if (last) navigate(last); else goDusk(); return; }
    const before = currentIndex <= 0 ? undefined : steps.slice(0, currentIndex).reverse().find(waking);
    if (!before) { goDusk(); return; }
    navigate(before);
  };
  const next = () => {
    if (!active) return;
    if (pos.kind === "dawn") return;
    if (pos.kind === "dusk") { const first = steps.find((step) => !settled.has(step.stepKey)); if (first) navigate(first); else gotoCheckpoint("dawn"); return; }
    if (!current) return;
    // Calculated information is communicated by Next: the pending answer is recorded first, and a
    // refusal keeps the Storyteller on the step.
    if (inlineInformation && information.current && !information.current.next()) return;
    const liveGame = useStorytellerStore.getState().game;
    if ((manual || inlineInformation) && liveGame && !stepResolved(liveGame, current)) {
      const result = useStorytellerStore.getState().setNightStepStatus(game.day, current.stepKey, "done", actionContext);
      if (!result.ok) { setError(result.message); return; }
    }
    const following = currentIndex < 0 ? steps.find((step) => !stepResolved(game, step, settled)) : steps.slice(currentIndex + 1).find((step) => !settled.has(step.stepKey));
    if (following) navigate(following);
    else gotoCheckpoint("dawn");
  };
  const proceedToDay = () => {
    const deaths = nightDeaths(game);
    const result = useStorytellerStore.getState().advancePhase();
    if (!result.ok) { flash("Setup changed. Open Players to review what needs attention."); return; }
    useNightPos.getState().go(0, null, null);
    showVeil(`Day ${roman(game.day)}`, "Dawn over Silverwick Hollow", true);
    flash(dawnFlash(deaths));
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
    active, visible, work, steps, unfinished, pos, current, currentIndex, positionIndex, resolved, actor, role, ability, query,
    eligible, direct, canTarget, question, answerQuestion, skipReason, settled, moonchildChoice, regurgitation, needed, picks, guessFor, cerenovusChoice, inlineInformation, preparedInformation, butlerTurn, barberTurn, philosopherTurn, dreamerTurn, twinTurn, bureaucrat, manual, manualRavenkeeper, correction,
    workspace, setWorkspace, setPaused, error, setError, success, successorChoice, tapRuling: pendingRuling, answerTapRuling, picker, refused, owner, actionContext,
    navigate, gotoCheckpoint, prev, next, beginDay, openWorkspace, openTrigger, requireManual, finish,
  };
}

export type NightEngine = ReturnType<typeof useNightEngine>;

const EMPTY_STEPS: NightStep[] = [];
/** SV-3a: why a gained ability's row is the Storyteller's. */
export const GAINED_BY_HAND = "An ability the Philosopher gained is run by hand at that character's place.";
const EMPTY_PICKS: ParticipantBinding[] = [];
const EMPTY_RULINGS: Record<string, Record<string, AbilityInputValue>> = {};
/** A yes/no the Storyteller answers before the step asks for any player. */
export type NightQuestion = { id: string; heading: string; note: string };

/** A workspace opened for a trigger that has no Night row keeps its own owner step. */
function isTriggerWorkspace(workspace: NightWorkspace, work: NightWork | null): boolean {
  return !!work?.triggered.some((item) => item.stepKey === workspace.target.step?.stepKey)
    && !work.steps.some((step) => step.stepKey === workspace.target.step?.stepKey);
}
