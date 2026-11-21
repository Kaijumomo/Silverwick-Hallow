import { useMemo, useRef } from "react";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { PHILOSOPHER_CHARACTER } from "@/abilities/characters/philosopher";
import type { StepAbility } from "@/features/abilities/abilityUi";
import { buildRegistry } from "@/data/roleRegistry";
import { iconUrlFor } from "@/data/iconUrl";
import { captureFingerprint, planAbilityResolution, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { gainedRecordOf, gainedRoleOf, GAINED_SHOWN } from "@/stores/gainedAbility";
import { usePrivacyStore } from "@/stores/privacyStore";
import { createRulesQuery } from "@/stores/rulesQuery";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import type { NightStep } from "@/rules/night/nightOrder";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { ChoiceSlot } from "../choice/ChoiceParts";
import { useV6Ui } from "../v6Store";
import { guardGesture } from "./gestureGuard";

type Props = {
  game: StorytellerLobbyRecord; script: Script; step: Extract<NightStep, { kind: "player" }>;
  ability: Extract<StepAbility, { kind: "guided" }>; visible: boolean; resolved: boolean;
  onResolved: (game: StorytellerLobbyRecord) => void; onManual: (reason?: string) => void;
};

const PICKER_TITLE = "Choose a good character";
const PICKER_KICKER = "The Philosopher · a Townsfolk or an Outsider";

/**
 * SV-3a (PO 2026-11-21): the Philosopher's Night card in the Barber card's language. "Not Tonight" (the Philosopher shakes their
 * head) closes tonight's step and uses nothing; "Choose Character" opens the board's character picker on the script's Townsfolk and
 * Outsiders, and picking one commits at once (one Undo, no confirm tap: PO decision Q3). The rules, the one commit and Undo are the
 * Philosopher's ability (philosopher.ts) through the coordinator; a case the rules leave to the Storyteller goes by hand. After the
 * choice the card shows what was gained. Hidden in Privacy Mode, like every Night step.
 */
export function PhilosopherNightAction({ game, script, step, ability, visible, resolved, onResolved, onManual }: Props) {
  const registry = useMemo(() => buildRegistry(script), [script]);
  const environment = useMemo(() => ({ script, registry, semantics: CANONICAL_ABILITY_SEMANTICS }), [script, registry]);
  const privacy = usePrivacyStore((s) => s.enabled);
  const actionContext = captureCharacterActionContext();
  const live = useRef({ game, visible });
  live.current = { game, visible };
  const query = useMemo(() => createRulesQuery(game, environment), [game, environment]);
  const actor = game.players[step.playerId];
  const nameOf = (playerId: string) => { const p = game.players[playerId]; return p ? p.name || `Seat ${p.seat + 1}` : "This player"; };
  const safe = () => live.current.visible && !usePrivacyStore.getState().enabled && useStorytellerStore.getState().game === live.current.game;

  if (!visible || privacy || !actor) return null;

  if (resolved) {
    // What the choice did: the character gained tonight, and who it makes drunk (derived) or that the token was swapped.
    const record = gainedRecordOf(actor);
    const gained = gainedRoleOf(actor);
    const role = gained ? registry.get(gained) : undefined;
    const tonight = record?.appliedAt?.phase === "night" && record.appliedAt.day === game.day;
    if (!role || !tonight) {
      return actor.abilityUsed && !gained ? <div className="gv-choice"><hr className="gv-choice-divider" />
        <p className="gv-choice-note">The ability is used. Nothing is gained.</p></div> : null;
    }
    const drunk = Object.values(game.players).filter((p) => !p.isEmpty && !!p.participantId && p.actualRole === role.id && (() => {
      const answer = query.gainedAbilityDrunk({ playerId: p.id, participantId: p.participantId! });
      return answer.known && answer.value;
    })());
    const shown = record.parameters?.[GAINED_SHOWN];
    const sub = shown?.kind === "boolean" && shown.value ? "Not in play: the token is swapped"
      : drunk.length ? `${drunk.map((p) => nameOf(p.id)).join(" and ")} ${drunk.length === 1 ? "is" : "are"} drunk` : "Gained";
    return <div className="gv-choice">
      <hr className="gv-choice-divider" />
      <div className="gv-choice-slots"><ChoiceSlot filled label={role.name} img={iconUrlFor(role)} sub={sub} /></div>
    </div>;
  }

  const fingerprintOf = (current: StorytellerLobbyRecord) => captureFingerprint(current, step.playerId, { day: current.day, stepKey: step.stepKey });
  const requestOf = (current: StorytellerLobbyRecord, roleId: string): AbilityResolutionRequest | null => {
    const fingerprint = fingerprintOf(current);
    return fingerprint ? { mode: "guided", invocationPath: "nightOrder", fingerprint, roleId: step.effectiveRoleId,
      inputs: { [PHILOSOPHER_CHARACTER]: { kind: "character", roleIds: [roleId] } }, completeStep: true } : null;
  };
  const closePicker = () => { const picker = useV6Ui.getState().picker; if (picker?.mode === "show" && picker.onPick) useV6Ui.getState().set({ picker: null }); };

  // "They either shake their head no": tonight's step is done, nothing is used.
  const notTonight = () => {
    if (!safe()) return;
    const result = useStorytellerStore.getState().setNightStepStatus(game.day, step.stepKey, "done", actionContext);
    if (!result.ok) { onManual(result.message); return; }
    onResolved(useStorytellerStore.getState().game!);
  };

  // "...or point at any Townsfolk icon or any Outsider icon on their character sheet": the board's own character picker.
  const choose = () => {
    if (!safe()) return;
    guardGesture();
    useV6Ui.getState().set({ pickHover: null, picker: { mode: "show", title: PICKER_TITLE, kicker: PICKER_KICKER, types: ["townsfolk", "outsider"],
      onPick: (roleId) => {
        const current = useStorytellerStore.getState().game;
        if (!current || current !== live.current.game || !live.current.visible || usePrivacyStore.getState().enabled) return "The game changed. Close this and choose again.";
        const request = requestOf(current, roleId);
        if (!request) return "This player is no longer seated.";
        const plan = planAbilityResolution(current, request, environment);
        if (!plan.ok && plan.code === "illegal") return plan.message;
        if (!plan.ok) { closePicker(); onManual(plan.message); return undefined; }
        const result = useStorytellerStore.getState().resolveAbility(request, CANONICAL_ABILITY_SEMANTICS, actionContext);
        if (!result.ok) return result.message;
        closePicker();
        onResolved(useStorytellerStore.getState().game!);
        return undefined;
      } } });
  };

  // Drunk or poisoned (or only shown the Philosopher): the choice still uses the ability, and gains nothing.
  const functions = step.isDeceived ? { known: true as const, value: false } : query.abilityFunctions({ playerId: actor.id, participantId: actor.participantId! });
  void ability;
  return <div className="gv-choice">
    <hr className="gv-choice-divider" />
    {functions.known && !functions.value && <p className="gv-choice-note">{`${nameOf(actor.id)} is drunk or poisoned: a choice uses the ability and gains nothing.`}</p>}
    <div className="gv-choice-actions" role="group" aria-label="The Philosopher's choice">
      <button className="gv-choice-pill" type="button" onClick={notTonight}>Not Tonight</button>
      <button className="gv-choice-confirm" type="button" onClick={choose}>Choose Character</button>
    </div>
  </div>;
}
