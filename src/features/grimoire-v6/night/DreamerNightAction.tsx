import { useEffect, useMemo, useRef, useState } from "react";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs } from "@/abilities/semantics";
import { DREAMER_TARGET, dreamerPickTypes, GOOD_TYPES } from "@/abilities/characters/dreamer";
import { seatedParticipants, useTargetPicker } from "@/features/abilities/abilityUi";
import { buildRegistry } from "@/data/roleRegistry";
import { captureFingerprint, planAbilityResolution, type AbilityResolutionRequest, type ParticipantBinding } from "@/stores/abilityResolution";
import { usePrivacyStore } from "@/stores/privacyStore";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import type { NightStep } from "@/rules/night/nightOrder";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { presentCharacters, report } from "../info/actions";
import { useV6Ui } from "../v6Store";
import { guardGesture } from "./gestureGuard";
import { WakeTokensRow } from "./WakeTokensRow";

type Props = {
  game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "player" }>;
  visible: boolean; resolved: boolean;
  onResolved: (game: StorytellerLobbyRecord) => void; onManual: (reason?: string) => void;
};

/** The player-safe screen's heading for the two tokens (the ability's own words: "1 of which is correct"). */
export const DREAMER_REVEAL_HEADING = "One of These Is Correct";
const PICKER_TITLE: Record<string, string> = {
  falseGood: "Choose a false good character", falseEvil: "Choose a false evil character",
  good: "Choose the good character to show", evil: "Choose the evil character to show",
};

/**
 * SV-5c: the Dreamer's Night card, in the Philosopher card's language. The Storyteller taps the player the Dreamer points at on the
 * board (never the Dreamer, never a Traveller), then picks the false token from the board's character picker, which offers only the
 * other team's characters, tokens only, no player names; the pick commits at once (one Undo). When the Storyteller picks both tokens
 * (a drunk or poisoned Dreamer, a Drunk shown the Dreamer, a Spy or Recluse chosen) the picker opens twice: good, then evil. After
 * the commit the card shows the Wake row with the two tokens, good first and evil second (PO Q4); either token opens ONE player-safe
 * screen with both, so the Dreamer is never told which is correct. The rules, the commit and Undo are the Dreamer's ability
 * (dreamer.ts) through the coordinator. Hidden in Privacy Mode, like every Night step.
 */
export function DreamerNightAction({ game, script, step, visible, resolved, onResolved, onManual }: Props) {
  const registry = useMemo(() => buildRegistry(script), [script]);
  const environment = useMemo(() => ({ script, registry, semantics: CANONICAL_ABILITY_SEMANTICS }), [script, registry]);
  const privacy = usePrivacyStore((s) => s.enabled);
  const actionContext = captureCharacterActionContext();
  const [draft, setDraft] = useState<{ game: StorytellerLobbyRecord; inputs: AbilityInputs } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ game, visible });
  live.current = { game, visible };
  const inputs = draft?.game === game ? draft.inputs : null;
  const owner = `dreamer:${game.day}:${step.stepKey}`;
  const nameOf = (playerId: string) => { const p = game.players[playerId]; return p ? p.name || `Seat ${p.seat + 1}` : "This player"; };
  const safe = () => live.current.visible && !usePrivacyStore.getState().enabled && useStorytellerStore.getState().game === live.current.game;
  const requestOf = (current: StorytellerLobbyRecord, answers: AbilityInputs): AbilityResolutionRequest | null => {
    const fingerprint = captureFingerprint(current, step.playerId, { day: current.day, stepKey: step.stepKey });
    return fingerprint ? { mode: "guided", invocationPath: "nightOrder", fingerprint, roleId: step.effectiveRoleId, inputs: answers, completeStep: true } : null;
  };
  const closePicker = () => { const picker = useV6Ui.getState().picker; if (picker?.mode === "show" && picker.onPick) useV6Ui.getState().set({ picker: null }); };
  const target = inputs?.[DREAMER_TARGET]?.kind === "participant" ? inputs[DREAMER_TARGET].participants[0] : undefined;
  const plan = useMemo(() => {
    if (resolved || !inputs) return null;
    const request = requestOf(game, inputs);
    return request ? planAbilityResolution(game, request, environment) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, inputs, resolved, environment]);
  const requirement = plan && !plan.ok && plan.code === "needsInput" && plan.requirements?.length === 1 ? plan.requirements[0] : undefined;
  const types = requirement ? dreamerPickTypes(requirement.id) : undefined;

  /** Opens the board's character picker for one token question; a pick either asks the next one (good, then evil) or commits. */
  const openPicker = (answers: AbilityInputs, id: string, exclude?: readonly (string | number)[]) => {
    if (!safe()) return;
    const group = dreamerPickTypes(id);
    if (!group) return;
    const key = id.startsWith("dreamer:falseGood") ? "falseGood" : id.startsWith("dreamer:falseEvil") ? "falseEvil" : group === GOOD_TYPES ? "good" : "evil";
    guardGesture();
    useV6Ui.getState().set({ pickHover: null, picker: { mode: "show", tokensOnly: true, title: PICKER_TITLE[key]!,
      kicker: `The Dreamer · ${group === GOOD_TYPES ? "a Townsfolk or an Outsider" : "a Minion or a Demon"}`, types: [...group],
      // SV-5j: under a Vortox the true character is not offered.
      ...(exclude?.length ? { exclude: exclude.filter((item): item is string => typeof item === "string") } : {}),
      onPick: (roleId) => {
        const current = useStorytellerStore.getState().game;
        if (!current || current !== live.current.game || !live.current.visible || usePrivacyStore.getState().enabled) return "The game changed. Close this and choose again.";
        const next: AbilityInputs = { ...answers, [id]: { kind: "character", roleIds: [roleId] } };
        const request = requestOf(current, next);
        if (!request) return "This player is no longer seated.";
        const planned = planAbilityResolution(current, request, environment);
        if (!planned.ok && planned.code === "illegal") return planned.message;
        if (!planned.ok && planned.code === "needsInput" && planned.requirements?.length === 1 && dreamerPickTypes(planned.requirements[0]!.id)) {
          setDraft({ game: current, inputs: next });
          openPicker(next, planned.requirements[0]!.id, planned.requirements[0]!.exclude);
          return undefined;
        }
        if (!planned.ok) { closePicker(); onManual(planned.message); return undefined; }
        const result = useStorytellerStore.getState().resolveAbility(request, CANONICAL_ABILITY_SEMANTICS, actionContext);
        if (!result.ok) return result.message;
        closePicker();
        useTargetPicker.getState().cancel();
        setDraft(null);
        onResolved(useStorytellerStore.getState().game!);
        return undefined;
      } } });
  };

  const choose = (chosen: ParticipantBinding) => {
    if (!safe()) return;
    setError(null);
    const next: AbilityInputs = { [DREAMER_TARGET]: { kind: "participant", participants: [chosen] } };
    const request = requestOf(game, next);
    if (!request) return;
    const planned = planAbilityResolution(game, request, environment);
    if (!planned.ok && planned.code === "illegal") { setError(planned.message); return; }
    if (!planned.ok && planned.code === "needsInput" && planned.requirements?.length === 1 && dreamerPickTypes(planned.requirements[0]!.id)) {
      setDraft({ game, inputs: next });
      openPicker(next, planned.requirements[0]!.id, planned.requirements[0]!.exclude);
      return;
    }
    if (!planned.ok) onManual(planned.message);
  };

  // While no player is chosen (or to choose another one), the board picker takes a tap: any seat but the Dreamer's and Travellers'.
  useEffect(() => {
    if (!visible || privacy || resolved) return;
    let active = true;
    const eligible = new Set(seatedParticipants(game).filter((p) => p.participantId !== step.participantId && !p.isTraveler).map((p) => p.participantId!));
    useTargetPicker.getState().start("Choose the player the Dreamer points at", (chosen) => { if (active) choose(chosen); }, { owner, eligible });
    return () => { active = false; if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, privacy, resolved, game]);
  useEffect(() => () => closePicker(), [game, step.stepKey]);

  if (!visible || privacy) return null;

  if (resolved) {
    // What was shown tonight: the delivery, good token first and evil second.
    const delivery = game.informationDeliveries.filter((item) => item.kind !== "manual" && item.recipient.kind === "participant"
      && item.recipient.participantId === step.participantId && item.moment?.phase === "night" && item.moment.day === game.day
      && (item.informationActionId === "dreamer-first-night" || item.informationActionId === "dreamer-other-night")).at(-1);
    const roleOf = (requirementId: string) => {
      const value = delivery?.values?.find((item) => item.requirementId === requirementId);
      return value?.kind === "role" ? registry.get(value.roleId) : undefined;
    };
    const good = roleOf("goodCharacter"), evil = roleOf("evilCharacter");
    if (!good || !evil) return null;
    const show = () => report(presentCharacters("Dreamer Information", [good.id, evil.id], undefined, DREAMER_REVEAL_HEADING));
    return <div className="gv-choice">
      <hr className="gv-choice-divider" />
      <WakeTokensRow name={nameOf(step.playerId)} first={{ heading: "Good", role: good, onOpen: show }} second={{ heading: "Evil", role: evil, onOpen: show }} />
    </div>;
  }

  // SV-5j: the Vortox line is the card's own note line (vm/night.tsx), so it is not repeated here.
  const note = requirement && plan && !plan.ok ? plan.message.replace(/\s*Choose (a false|the) (good|evil) character( to show)?( with it)?\.$/, "").replace(/^A Vortox is in play[:.]\s*(\w)/, (_, first: string) => first.toUpperCase()) : null;
  return <div className="gv-choice">
    <hr className="gv-choice-divider" />
    <p className="modern-night-pick">{target ? "Chosen" : "Choose a player on the board"}
      {target && <span className="night-pick-chip">{nameOf(target.playerId)}</span>}</p>
    {note && <p className="gv-choice-note">{note}</p>}
    {requirement && types && inputs && <div className="gv-choice-actions" role="group" aria-label="The Dreamer's tokens">
      <button className="gv-choice-confirm" type="button" onClick={() => openPicker(inputs, requirement.id, requirement.exclude)}>
        {types === GOOD_TYPES ? "Choose Good Character" : "Choose Evil Character"}</button>
    </div>}
    {error && <p role="alert" className="behavior-help">{error}</p>}
  </div>;
}
