import { useEffect, useMemo, useRef, useState } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs } from "@/abilities/semantics";
import { BARBER_DEMON, BARBER_NOBODY, BARBER_PLAYERS, barberDemonsOf } from "@/abilities/characters/barber";
import { activeModifiers } from "@/abilities/modifiers";
import { buildRegistry } from "@/data/roleRegistry";
import { seatedParticipants, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import { ChoicePrompt, ChoiceSlot, ChoiceSwapIcon } from "@/features/grimoire-v6/choice/ChoiceParts";
import { iconUrlFor } from "@/data/iconUrl";
import { captureFingerprint, planAbilityResolution, type AbilityResolutionRequest, type ParticipantBinding } from "@/stores/abilityResolution";
import { usePrivacyStore } from "@/stores/privacyStore";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import type { NightStep } from "@/rules/night/nightOrder";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";

type Props = {
  game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "player" }>;
  ability: Extract<StepAbility, { kind: "guided" }>; visible: boolean;
  onResolved: (game: StorytellerLobbyRecord) => void; onManual: (reason?: string) => void;
};
type Draft = { game: StorytellerLobbyRecord; demon: ParticipantBinding | null; picks: ParticipantBinding[]; rulings: AbilityInputs };
const RULING_PREFIX = "barber:registersAsDemon:";

/**
 * PO review 2026-11-14 (C1): the Barber's Night step on the grimoire, in the Night card's own language. The wiki's How to Run: the
 * Demon either shakes their head or points at two players. The Storyteller taps the two players on the board (with two living Demons,
 * first the Demon who makes the swap); each chosen player fills a slot (PO design direction 2026-11-19); the swap waits for "Swap" (or "Choose again"). A drunk or
 * poisoned Barber, or no living Demon, says so up front and offers only "Continue without swap". The rules, the one commit and Undo
 * are the Barber's ability (barber.ts) through the coordinator, unchanged; a case the rules leave to the Storyteller goes by hand.
 * Hidden in Privacy Mode, like every Night step.
 */
export function BarberNightAction({ game, script, step, ability, visible, onResolved, onManual }: Props) {
  const registry = useMemo(() => buildRegistry(script), [script]);
  const environment = useMemo(() => ({ script, registry, semantics: CANONICAL_ABILITY_SEMANTICS }), [script, registry]);
  const privacy = usePrivacyStore((s) => s.enabled);
  const actionContext = captureCharacterActionContext();
  const [draft, setDraft] = useState<Draft>({ game, demon: null, picks: [], rulings: {} });
  const [error, setError] = useState<string | null>(null);
  const current: Draft = draft.game === game ? draft : { game, demon: null, picks: [], rulings: {} };
  const live = useRef({ game, visible });
  live.current = { game, visible };
  const owner = `night-barber:${game.day}:${step.stepKey}`;
  const barber = { playerId: step.playerId, participantId: step.participantId };
  const trigger = ability.trigger && ability.trigger.kind !== "notTriggered" ? { eventId: ability.trigger.eventId } : undefined;
  const fingerprint = captureFingerprint(game, step.playerId, { day: game.day, stepKey: step.stepKey }, trigger);
  const query = useMemo(() => createRulesQuery(game, { ...environment, modifiers: activeModifiers(game, registry) }), [game, environment, registry]);
  const nameOf = (binding: ParticipantBinding) => { const p = game.players[binding.playerId]; return p ? p.name || `Seat ${p.seat + 1}` : "This player"; };

  // Up front: no swap can happen (the Barber drunk, poisoned or only shown the Barber; or no living Demon).
  const functions = step.isDeceived ? { known: true as const, value: false } : query.abilityFunctions(barber);
  const demons = barberDemonsOf(query);
  const blocked = functions.known && !functions.value ? `${nameOf(barber)} is drunk or poisoned.` : !demons.length ? "There is no living Demon." : null;
  const swapper = demons.length === 1 ? demons[0]! : current.demon;
  const choosingDemon = !blocked && demons.length > 1 && !current.demon;

  const inputs = (picks: ParticipantBinding[], rulings = current.rulings): AbilityInputs => ({
    [BARBER_PLAYERS]: { kind: "participant", participants: picks },
    ...(demons.length > 1 && current.demon ? { [BARBER_DEMON]: { kind: "participant", participants: [current.demon] } } : {}),
    ...rulings,
  });
  const request = (answers: AbilityInputs): AbilityResolutionRequest => ({ mode: "guided", invocationPath: ability.invocationPath ?? "nightTrigger",
    fingerprint: fingerprint!, roleId: step.effectiveRoleId, inputs: answers, completeStep: true });
  const safe = () => live.current.game === game && live.current.visible && useStorytellerStore.getState().game === game && !usePrivacyStore.getState().enabled;
  const commit = (answers: AbilityInputs) => {
    if (!safe() || !fingerprint) return;
    const result = useStorytellerStore.getState().resolveAbility(request(answers), CANONICAL_ABILITY_SEMANTICS, actionContext);
    if (!result.ok) { setError(result.message); return; }
    useTargetPicker.getState().cancel();
    onResolved(useStorytellerStore.getState().game!);
  };
  const nobody = () => commit(inputs([], {}));
  /** A refused pair keeps the Demon already chosen; "Choose again" starts over, the Demon included (two living Demons). */
  const restart = (message: string | null, demon = current.demon) => { setError(message); setDraft({ game, demon, picks: [], rulings: {} }); };

  // Two players chosen: what the rules say before anything changes.
  const plan = current.picks.length === 2 && fingerprint ? planAbilityResolution(game, request(inputs(current.picks)), environment) : null;
  const ruling = plan && !plan.ok && plan.code === "needsInput" && plan.requirements?.length === 1 && plan.requirements[0]!.kind === "boolean"
    && plan.requirements[0]!.id.startsWith(RULING_PREFIX) ? plan.requirements[0]! : null;
  useEffect(() => {
    if (!plan || plan.ok || ruling) return;
    if (plan.code === "illegal") restart(plan.message);
    else onManual(plan.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.ok, plan && !plan.ok ? plan.code : null, ruling?.id]);

  const picking = !blocked && !choosingDemon && current.picks.length < 2;
  useEffect(() => {
    if (!visible || privacy || (!picking && !choosingDemon)) return;
    let active = true;
    const eligible = choosingDemon
      ? new Set(demons.map((d) => d.participantId))
      : new Set(seatedParticipants(game).filter((p) => !current.picks.some((pick) => pick.participantId === p.participantId)
        && (p.participantId === swapper?.participantId || registry.get(p.actualRole)?.type !== "demon")).map((p) => p.participantId!));
    const label = choosingDemon ? "Choose the Demon who makes the swap" : `Choose player ${current.picks.length + 1} of 2`;
    useTargetPicker.getState().start(label, (target) => {
      if (!active || !safe()) return;
      setError(null);
      if (choosingDemon) setDraft({ game, demon: target, picks: [], rulings: {} });
      else setDraft({ ...current, game, picks: [...current.picks, target] });
    }, { owner, eligible });
    return () => { active = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, privacy, picking, choosingDemon, game, current.picks.length, current.demon?.participantId]);

  if (!visible || privacy) return null;
  // PO design direction 2026-11-19: the prompt, a slot per player tapped, then Swap. Storyteller-only (hidden in Privacy Mode).
  const roleOf = (binding: ParticipantBinding) => registry.get(game.players[binding.playerId]?.actualRole ?? "");
  const roleName = (binding: ParticipantBinding) => roleOf(binding)?.name ?? "";
  const imgOf = (binding: ParticipantBinding) => { const role = roleOf(binding); return role ? iconUrlFor(role) : undefined; };
  const swap = plan?.ok ? plan : null;
  const [a, b] = current.picks;
  const slot = (pick: ParticipantBinding | undefined, n: number, other: ParticipantBinding | undefined) => pick
    ? <ChoiceSlot filled label={nameOf(pick)} img={imgOf(pick)} sub={swap?.changed && other ? `becomes the ${roleName(other)}` : roleName(pick)} />
    : <ChoiceSlot filled={false} label={`Player ${n}`} sub="Tap on the board" />;
  const slots = <div className="gv-choice-slots">{slot(a, 1, b)}<ChoiceSwapIcon />{slot(b, 2, a)}</div>;
  const nobodyPill = <button className="gv-choice-pill" type="button" onClick={nobody}>{BARBER_NOBODY}</button>;
  const demonNote = demons.length > 1 && current.demon ? <p className="gv-choice-note">{`${nameOf(current.demon)} makes the swap.`}</p> : null;
  const ruled = ruling ? current.picks.find((p) => ruling.id === `${RULING_PREFIX}${JSON.stringify(p.participantId)}`) : undefined;
  const answer = (value: boolean) => { if (!ruling) return; setError(null);
    setDraft({ ...current, game, rulings: { ...current.rulings, [ruling.id]: { kind: "boolean", value } } }); };
  return <div className="gv-choice">
    <hr className="gv-choice-divider" />
    {blocked ? <>
      <ChoicePrompt text="No swap happens" action={<button className="gv-choice-pill" type="button" onClick={nobody}>Continue without swap</button>} />
      <p className="gv-choice-note">{blocked}</p>
    </> : choosingDemon ? <>
      <ChoicePrompt text="Tap the Demon who makes the swap" action={nobodyPill} />
      <div className="gv-choice-slots"><ChoiceSlot filled={false} label="Demon" sub="Tap on the board" /></div>
    </> : ruling ? <>
      <ChoicePrompt text={`Does ${ruled ? nameOf(ruled) : "this player"} register as a Demon?`} />
      <p className="gv-choice-note">The Demon may not choose another Demon.</p>
      {slots}
      <div className="gv-choice-actions" role="group" aria-label="Your ruling">
        <button className="gv-choice-answer" type="button" onClick={() => answer(true)}>Yes</button>
        <button className="gv-choice-answer" type="button" onClick={() => answer(false)}>No</button>
      </div>
    </> : swap && a && b ? <>
      <ChoicePrompt text={`Swap ${nameOf(a)} and ${nameOf(b)}?`} />
      {slots}
      {!swap.changed && <p className="gv-choice-note">They have the same character: nothing changes.</p>}
      {demonNote}
      <div className="gv-choice-actions">
        <button className="gv-choice-pill" type="button" onClick={() => restart(null, null)}>Choose again</button>
        <button className="gv-choice-confirm" type="button" onClick={() => commit(inputs(current.picks))}>Swap</button>
      </div>
    </> : <>
      <ChoicePrompt text="Tap two players on the board" action={nobodyPill} />
      {slots}
      {demonNote}
    </>}
    {error && <p role="alert" className="behavior-help">{error}</p>}
  </div>;
}
