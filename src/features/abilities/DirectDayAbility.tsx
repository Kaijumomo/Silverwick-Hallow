import { useEffect, useRef, useState } from "react";
import type { AbilityDescriptor, AbilitySemanticsRegistry } from "@/abilities/semantics";
import type { RoleRegistry } from "@/data/roleRegistry";
import { captureFingerprint, planAbilityResolution, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { registersAsDemonJudgment } from "@/abilities/characters/slayer";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { seatedParticipants, useTargetPicker } from "./abilityUi";

/** A Day choice uses the same planner and command as Night. The captured
 * draft is disposable UI state; nothing is committed before the board tap. */
export function DirectDayAbility({ game, script, registry, semantics, actorId, descriptor, onClose, onManualRequired }: {
  game: StorytellerLobbyRecord; script: Script; registry: RoleRegistry; semantics: AbilitySemanticsRegistry;
  actorId: string; descriptor: AbilityDescriptor; onClose: () => void; onManualRequired: () => void;
}) {
  const [captured] = useState(() => ({ game, fingerprint: captureFingerprint(game, actorId), context: captureCharacterActionContext() }));
  const [error, setError] = useState<string | null>(null);
  const [registration, setRegistration] = useState<{ request: Extract<AbilityResolutionRequest, { mode: "guided" }>; id: string; name: string } | null>(null);
  const choiceHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (registration) choiceHeading.current?.focus(); }, [registration]);
  const [invoker] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const active = useRef(false);
  const picker = useTargetPicker(state => state.active);
  const previousPicker = useRef(picker);
  useEffect(() => {
    const previous = previousPicker.current;
    previousPicker.current = picker;
    if (active.current && previous?.owner === `day-ability:${captured.fingerprint?.actor.participantId}` && picker !== previous) {
      active.current = false; onClose();
    }
    if (active.current && picker?.owner === `day-ability:${captured.fingerprint?.actor.participantId}`) {
      document.querySelector<HTMLButtonElement>(".grimoire-picking button")?.focus();
    }
  }, [picker]);
  useEffect(() => {
    if (game !== captured.game || !captured.fingerprint) { onClose(); return; }
    active.current = true;
    const owner = `day-ability:${captured.fingerprint.actor.participantId}`;
    useTargetPicker.getState().start(descriptor.presentation.action, target => {
      if (!active.current || usePrivacyStore.getState().enabled || useStorytellerStore.getState().game !== captured.game) return;
      active.current = false;
      const request = { mode: "guided" as const, invocationPath: "dayEntry" as const, fingerprint: captured.fingerprint!,
        roleId: descriptor.roleId, inputs: { [descriptor.inputs[0]!.id]: { kind: "participant" as const, participants: [target] } } };
      const plan = planAbilityResolution(captured.game, request, { script, registry, semantics });
      if (!plan.ok) {
        const id = registersAsDemonJudgment(target.participantId);
        if (descriptor.roleId === "slayer" && plan.code === "needsInput" && plan.requirements?.length === 1 &&
          plan.requirements[0]?.id === id && plan.requirements[0].source === "storyteller" && plan.requirements[0].kind === "boolean") {
          setRegistration({ request, id, name: captured.game.players[target.playerId]!.name }); return;
        }
        if (plan.code === "unsupported" || plan.code === "needsInput") { onManualRequired(); return; }
        setError(plan.message); return;
      }
      const result = useStorytellerStore.getState().resolveAbility(request, semantics, captured.context);
      if (!result.ok) { setError(result.message); return; }
      onClose();
    }, { owner, eligible: new Set(seatedParticipants(game).map(player => player.participantId!)) });
    return () => {
      active.current = false;
      if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel();
      if (!usePrivacyStore.getState().enabled && invoker?.isConnected && !invoker.closest("[hidden]")) invoker.focus();
    };
  }, [game]);
  const resolveRegistration = (value: boolean) => {
    if (!registration || usePrivacyStore.getState().enabled || useStorytellerStore.getState().game !== captured.game) return;
    const request = { ...registration.request, inputs: { ...registration.request.inputs, [registration.id]: { kind: "boolean" as const, value } } };
    const result = useStorytellerStore.getState().resolveAbility(request, semantics, captured.context);
    if (!result.ok) { setError(result.message); return; }
    setRegistration(null); onClose();
  };
  if (registration) return <section className="ability-section" aria-label="Resolve Slayer shot">
    <h4 className="drawer-section-title" ref={choiceHeading} tabIndex={-1}>Resolve Slayer shot</h4>
    <p className="behavior-help">{registration.name} is the Recluse. Either outcome uses the Slayer's once-per-game ability.</p>
    {error && <p role="alert">{error}</p>}
    <button className="btn" onClick={() => resolveRegistration(false)}>No death — does not register as Demon</button>
    <button className="btn btn-gold" onClick={() => resolveRegistration(true)}>Registers as Demon — resolve death</button>
    <button className="btn" onClick={onClose}>Cancel shot</button>
  </section>;
  return <div><p className="behavior-help">Tap the publicly chosen player on the board.</p>
    {error && <p role="alert">{error}</p>}
    <button className="btn btn-sm" onClick={onClose}>Cancel selection</button></div>;
}
