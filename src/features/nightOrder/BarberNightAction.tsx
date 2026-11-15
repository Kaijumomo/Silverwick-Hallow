import { useEffect, useMemo, useRef, useState } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs } from "@/abilities/semantics";
import { BARBER_DEMON, BARBER_NOBODY, BARBER_PLAYERS, barberDemonsOf } from "@/abilities/characters/barber";
import { activeModifiers } from "@/abilities/modifiers";
import { buildRegistry } from "@/data/roleRegistry";
import { seatedParticipants, useTargetPicker, type StepAbility } from "@/features/abilities/abilityUi";
import { QuestionBlock } from "@/features/grimoire-v6/day/NominationExtras";
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
 * first the Demon who makes the swap); the names sit beside the prompt; the swap waits for "Swap" (or "Choose again"). A drunk or
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
  const chips = (list: ParticipantBinding[]) => list.map((p) => <span key={p.participantId} className="night-pick-chip">{nameOf(p)}</span>);
  const roleName = (binding: ParticipantBinding) => registry.get(game.players[binding.playerId]?.actualRole ?? "")?.name ?? "";
  const nobodyButton = <div className="night-information-choices night-decline" role="group" aria-label="The Demon's choice">
    <button className="btn" type="button" onClick={nobody}>{BARBER_NOBODY}</button></div>;
  return <div className="night-information">
    {blocked && <QuestionBlock heading="No swap happens" note={blocked} actions={[{ label: "Continue without swap", onClick: nobody }]} />}
    {choosingDemon && <>
      <p className="modern-night-pick">Tap the Demon who makes the swap</p>
      {nobodyButton}
    </>}
    {picking && <>
      <p className="modern-night-pick">{current.picks.length ? "Tap one more player on the board" : "Tap two players on the board"}
        {demons.length > 1 && current.demon && <span className="night-pick-chip">{`${nameOf(current.demon)} swaps`}</span>}
        {chips(current.picks)}</p>
      {nobodyButton}
    </>}
    {ruling && (() => {
      const id = ruling.id;
      const who = current.picks.find((p) => id === `${RULING_PREFIX}${JSON.stringify(p.participantId)}`);
      return <QuestionBlock heading={`Does ${who ? nameOf(who) : "this player"} register as a Demon?`} note="The Demon may not choose another Demon."
        actions={[true, false].map((value) => ({ label: value ? "Yes" : "No", onClick: () => {
          setError(null); setDraft({ ...current, game, rulings: { ...current.rulings, [id]: { kind: "boolean", value } } });
        } }))} />;
    })()}
    {plan?.ok && (() => {
      const [a, b] = current.picks as [ParticipantBinding, ParticipantBinding];
      const note = plan.changed ? `${nameOf(a)} becomes the ${roleName(b)}; ${nameOf(b)} becomes the ${roleName(a)}.` : "They have the same character: nothing changes.";
      return <QuestionBlock heading={`Swap ${nameOf(a)} and ${nameOf(b)}?`} note={note}
        actions={[{ label: "Swap", onClick: () => commit(inputs(current.picks)) }, { label: "Choose again", onClick: () => restart(null, null) }]} />;
    })()}
    {error && <p role="alert" className="behavior-help">{error}</p>}
  </div>;
}
