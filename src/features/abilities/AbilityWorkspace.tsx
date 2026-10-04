import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { KNOWN_EFFECT_TYPES } from "@/stores/effectRegistry";
import { changeRoleIntent, ordinaryRoleChoices } from "@/stores/roleResolution";
import { changeAlignmentIntent } from "@/stores/alignmentResolution";
import { useStorytellerStore } from "@/stores/storytellerStore";
import {
  captureFingerprint,
  planAbilityResolution,
  type AbilityOperation,
  type AbilityOutcome,
  type AbilityResolutionRequest,
  type ParticipantBinding,
} from "@/stores/abilityResolution";
import type { InvocationPath } from "@/abilities/invocation";
import type { AbilityDescriptor, AbilityInputRequirement, AbilityInputValue, AbilitySemanticsRegistry } from "@/abilities/semantics";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { Alignment, Script, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import { describeOutcome, seatedParticipants } from "./abilityUi";
import { MAX_MANUAL_DELIVERY_TEXT } from "@/stores/schemas";
import { wakeIdentity } from "@/stores/wakeIdentity";
import { TextLimit } from "@/components/TextLimit";
import { OriginTag, ParticipantSelect, RequirementInput } from "./RequirementInput";

/**
 * Phase 10F: the ability workspace (PHASE10F Section 15.2) -- progressive
 * disclosure for complex / judgment-heavy resolutions and the explicit
 * "Resolve manually / unmodeled interaction" path (Section 15.5).
 *
 *  choices -> judgment (only when asked) -> concise consequence preview ->
 *  Confirm -> one resolveAbility commit (Undo / correction afterwards).
 *
 * Workflow state is UI memory only: it is captured (fingerprint) when the
 * workspace opens and is never persisted; a changed game makes it stale and it
 * is never silently resumed (10F-AC-26). Rendered only outside Privacy Mode
 * (the Night dashboard unmounts it, discarding every draft, when Privacy Mode
 * turns on). Narrow screens: a bottom sheet; wider screens: a side panel.
 */

export type WorkspaceTarget = {
  actorId: string;
  roleId: string;
  roleName: string;
  /** SOL-10F-L3-R1: the entry point that opened the workspace; a guided
   * request carries it and the coordinator enforces its eligibility. */
  invocationPath: InvocationPath;
  step?: { day: number; stepKey: string };
  /** SOL-10F-A10: the exact trigger event a Night-trigger workflow resolves. */
  trigger?: { eventId: string | null };
};

type Props = {
  game: StorytellerLobbyRecord;
  script: Script;
  registry: RoleRegistry;
  semantics: AbilitySemanticsRegistry;
  target: WorkspaceTarget;
  descriptor: AbilityDescriptor | null;
  manualReason: string;
  /** Choices already made inline before escalating to the workspace. */
  initialInputs?: Record<string, AbilityInputValue>;
  onClose: () => void;
  onResolved: (resolution: { resolutionId: string; game: StorytellerLobbyRecord; delivered: boolean }) => void;
};

/** SOL-10F-A2: a Manual step's player is the bound participation instance
 * captured WHEN it was chosen, with the record observed at that moment (the
 * Role / Alignment seams' expected-state fields come from it) -- never a seat
 * re-bound at Resolve time. */
type PickedParticipant = { binding: ParticipantBinding; observed: STPlayerRecord } | null;

type ManualDraft =
  | { kind: "death" | "resurrection" | "useAbility"; target: PickedParticipant }
  | { kind: "effect"; target: PickedParticipant; type: string }
  | { kind: "reminder"; target: PickedParticipant; label: string }
  | { kind: "role"; target: PickedParticipant; roleId: string }
  | { kind: "alignment"; target: PickedParticipant; alignment: Alignment }
  /** Phase 10G: "Information told" -- what was actually communicated, as
   * bounded text (a Manual Information Delivery). */
  | { kind: "information"; target: PickedParticipant; text: string };

const MANUAL_KINDS: { kind: ManualDraft["kind"]; label: string }[] = [
  { kind: "death", label: "Death" },
  { kind: "resurrection", label: "Resurrection" },
  { kind: "useAbility", label: "Ability used" },
  { kind: "effect", label: "Effect" },
  { kind: "role", label: "Character change" },
  { kind: "alignment", label: "Alignment change" },
  { kind: "reminder", label: "Reminder" },
  { kind: "information", label: "Information told" },
];


export function AbilityWorkspace({ game, script, registry, semantics, target, descriptor, manualReason, initialInputs, onClose, onResolved }: Props) {
  // Captured ONCE, at open: the state the Storyteller is resolving against.
  const [fingerprint] = useState(() => captureFingerprint(game, target.actorId, target.step, target.trigger));
  const [mode, setMode] = useState<"guided" | "manual">(descriptor ? "guided" : "manual");
  const [inputs, setInputs] = useState<Record<string, AbilityInputValue>>(initialInputs ?? {});
  const [judgments, setJudgments] = useState<Record<string, AbilityInputValue>>({});
  const [drafts, setDrafts] = useState<ManualDraft[]>([]);
  const [reason, setReason] = useState(descriptor ? "" : manualReason);
  const [completeStep, setCompleteStep] = useState(!!target.step);
  const [commitError, setCommitError] = useState<string | null>(null);
  const participants = seatedParticipants(game);
  const env = useMemo(() => ({ script, registry, semantics }), [script, registry, semantics]);

  /** The binding captured by the slot, with the record observed at that moment. */
  const pickParticipant = (binding: ParticipantBinding | null): PickedParticipant =>
    binding ? { binding, observed: game.players[binding.playerId]! } : null;

  /** The simulated wake performed when `who` is this workflow's actor shown a
   * Role other than their Actual Role (e.g. a Drunk shown as the Empath). */
  function performedRoleFor(who: ParticipantBinding, observed: STPlayerRecord): string | undefined {
    if (!fingerprint || who.participantId !== fingerprint.actor.participantId || target.roleId === observed.actualRole) return undefined;
    const wake = wakeIdentity(observed, registry);
    return wake?.simulated && wake.shownRoleId === target.roleId ? target.roleId : undefined;
  }

  /** The Manual outcome, or null while any step still has no player (a step
   * is never silently dropped). A stale picked player stays in the outcome so
   * the coordinator refuses it as `stale` -- never retargeted. */
  const manualOutcome = (): AbilityOutcome | null => {
    const operations: AbilityOperation[] = [];
    for (const draft of drafts) {
      if (!draft.target) return null;
      const { binding: who, observed } = draft.target;
      switch (draft.kind) {
        case "death": case "resurrection": case "useAbility":
          operations.push({ domain: "life", intents: [{ kind: draft.kind, target: who }] }); break;
        case "effect":
          operations.push({ domain: "effect", intents: [{ kind: "apply", target: who, effect: { type: draft.type, lifetime: { kind: "manual" } } }] }); break;
        case "reminder":
          operations.push({ domain: "reminder", intents: [{ kind: "place", target: who, reminder: { label: draft.label } }] }); break;
        // Built by the seams' own intent builders from the record OBSERVED when
        // the player was chosen (bound participant + observed state).
        case "role":
          operations.push({ domain: "role", intents: [changeRoleIntent(observed, draft.roleId)] }); break;
        case "alignment":
          operations.push({ domain: "alignment", intents: [changeAlignmentIntent(observed, draft.alignment)] }); break;
        case "information": {
          // Section 12.3: the performed Role is this workflow's own simulated
          // wake for its own actor -- never chosen freely (the coordinator
          // re-authorizes it).
          const performed = performedRoleFor(who, observed);
          operations.push({ domain: "manualInformation", recipient: who, text: draft.text, ...(performed ? { performedRole: performed } : {}) });
          break;
        }
      }
    }
    // The Storyteller's list order IS the declared order of this manual outcome.
    return { operations, mechanicalOrder: "declared" };
  };
  const manual = mode === "manual" ? manualOutcome() : null;

  const request: AbilityResolutionRequest | null = !fingerprint ? null : mode === "guided"
    ? { mode: "guided", invocationPath: target.invocationPath, fingerprint, roleId: target.roleId, inputs, judgments, completeStep }
    : manual ? { mode: "manual", fingerprint, roleId: target.roleId, outcome: manual, reason, completeStep } : null;
  const planned = request ? planAbilityResolution(game, request, env) : null;
  const stale = !fingerprint || (planned && !planned.ok && planned.code === "stale");
  // SOL-10F-L2: every follow-up the coordinator asks for is rendered by its own
  // kind / cardinality / constraints, and stays visible once asked. Slice 7: an
  // evaluator may ask a further PLAYER or STORYTELLER choice (e.g. a consent, a
  // successor) as well as a judgment -- each keeps its own origin; judgments
  // answer `judgments`, choices answer `inputs`.
  const asked: AbilityInputRequirement[] = planned && !planned.ok && planned.code === "needsInput"
    ? (planned.requirements ?? []).filter((requirement) => !descriptor?.inputs.some((input) => input.id === requirement.id))
    : [];
  const [judgmentFields, setJudgmentFields] = useState<AbilityInputRequirement[]>([]);
  const newlyAsked = asked.filter((requirement) => !judgmentFields.some((known) => known.id === requirement.id));
  useEffect(() => {
    if (newlyAsked.length) setJudgmentFields((known) => [...known, ...newlyAsked.filter((r) => !known.some((k) => k.id === r.id))]);
  });

  // SOL-10F-A1: a follow-up answer belongs to the prerequisites it was asked
  // under. Changing a DECLARED input discards every follow-up field and answer;
  // changing a follow-up discards every later one in the asked chain. (The
  // evaluator's subject-bound requirement ids remain the authority.)
  const declaredIds = new Set(descriptor?.inputs.map((input) => input.id) ?? []);
  const setAnswer = (record: Record<string, AbilityInputValue>, id: string, value: AbilityInputValue | undefined) => {
    const next = { ...record };
    if (value) next[id] = value;
    else delete next[id];
    return next;
  };
  const changeBase = (id: string, value: AbilityInputValue | undefined) => {
    setInputs((prev) => setAnswer(Object.fromEntries(Object.entries(prev).filter(([key]) => declaredIds.has(key))), id, value));
    setJudgments({});
    setJudgmentFields([]);
  };
  const changeFollowUp = (requirement: AbilityInputRequirement, value: AbilityInputValue | undefined) => {
    const position = judgmentFields.findIndex((field) => field.id === requirement.id);
    const later = new Set(position < 0 ? [] : judgmentFields.slice(position + 1).map((field) => field.id));
    const prune = (record: Record<string, AbilityInputValue>) => Object.fromEntries(Object.entries(record).filter(([key]) => !later.has(key)));
    if (requirement.source === "judgment") {
      setJudgments((prev) => setAnswer(prune(prev), requirement.id, value));
      setInputs(prune);
    } else {
      setInputs((prev) => setAnswer(prune(prev), requirement.id, value));
      setJudgments(prune);
    }
    if (later.size) setJudgmentFields((fields) => fields.filter((field) => !later.has(field.id)));
  };
  const preview = planned?.ok && planned.changed ? describeOutcome(game, planned.plan.outcome, registry) : [];

  const confirm = () => {
    if (!request) return;
    const result = useStorytellerStore.getState().resolveAbility(request, semantics);
    if (!result.ok) { setCommitError(result.message); return; }
    if (!result.changed) { onClose(); return; }
    const committed = useStorytellerStore.getState().game!;
    onResolved({ resolutionId: result.resolutionId, game: committed, delivered: committed.informationDeliveries.length > game.informationDeliveries.length });
  };

  const participantSelect = (value: ParticipantBinding | null, onChange: (binding: ParticipantBinding | null) => void, label: string) => (
    <ParticipantSelect game={game} value={value} candidates={participants} label={label} onChange={onChange} />
  );

  return (
    <Modal title={`${target.roleName} — ${mode === "guided" ? "guided resolution" : "Resolve manually / unmodeled interaction"}`}
      onClose={onClose} className="ability-workspace">
      <div className="ability-workspace-body">
        {stale ? (
          <div className="ability-stale" role="alert">
            <p>This workflow is out of date — the game changed since it opened. Nothing was recorded.</p>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          </div>
        ) : mode === "guided" && descriptor ? (
          <>
            <section aria-label="Choices" className="ability-section">
              <h3 className="drawer-section-title">{descriptor.presentation.action}</h3>
              {descriptor.inputs.map((input) => (
                <RequirementInput key={input.id} requirement={input} game={game} script={script} actor={fingerprint?.actor ?? null}
                  {...(initialInputs?.[input.id] ? { initial: initialInputs[input.id] } : {})}
                  onChange={(value) => changeBase(input.id, value)} />
              ))}
            </section>
            {judgmentFields.some((requirement) => requirement.source !== "judgment") && (
              <section aria-label="Further choices" className="ability-section">
                <h3 className="drawer-section-title">Further choices</h3>
                {judgmentFields.filter((requirement) => requirement.source !== "judgment").map((requirement) => (
                  <RequirementInput key={requirement.id} requirement={requirement} game={game} script={script} actor={fingerprint?.actor ?? null}
                    onChange={(value) => changeFollowUp(requirement, value)} />
                ))}
              </section>
            )}
            {judgmentFields.some((requirement) => requirement.source === "judgment") && (
              <section aria-label="Storyteller judgment" className="ability-section">
                <h3 className="drawer-section-title">Storyteller judgment</h3>
                {judgmentFields.filter((requirement) => requirement.source === "judgment").map((requirement) => (
                  <RequirementInput key={requirement.id} requirement={requirement} game={game} script={script} actor={fingerprint?.actor ?? null}
                    onChange={(value) => changeFollowUp(requirement, value)} />
                ))}
              </section>
            )}
          </>
        ) : (
          <section aria-label="Manual resolution" className="ability-section">
            <p className="behavior-help">Use this when you know an interaction Silverwick does not model. Build the already-resolved
              result from the same primitives; it is recorded as a manual resolution, not as a computed rule.</p>
            <label className="ability-field">
              <span>Why is this resolved manually? <OriginTag origin="manual" /></span>
              <textarea aria-label="Reason for manual resolution" value={reason} rows={2} onChange={(e) => setReason(e.target.value)} />
            </label>
            <ol className="manual-ops" aria-label="Resolution steps, in order">
              {drafts.map((draft, index) => (
                <li key={index} className="manual-op">
                  <span className="manual-op-kind">{MANUAL_KINDS.find((k) => k.kind === draft.kind)!.label}</span>
                  {participantSelect(draft.target?.binding ?? null, (binding) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, target: pickParticipant(binding) } : d))), `Step ${index + 1} player`)}
                  {draft.kind === "effect" && (
                    <select aria-label={`Step ${index + 1} effect`} value={draft.type} onChange={(e) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, type: e.target.value } as ManualDraft : d)))}>
                      {KNOWN_EFFECT_TYPES.map((definition) => <option key={definition.type} value={definition.type}>{definition.label}</option>)}
                    </select>
                  )}
                  {draft.kind === "reminder" && (
                    <input aria-label={`Step ${index + 1} reminder label`} value={draft.label} onChange={(e) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, label: e.target.value } as ManualDraft : d)))} />
                  )}
                  {draft.kind === "role" && (
                    <select aria-label={`Step ${index + 1} character`} value={draft.roleId} onChange={(e) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, roleId: e.target.value } as ManualDraft : d)))}>
                      <option value="">Choose a character…</option>
                      {ordinaryRoleChoices(script).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                  )}
                  {draft.kind === "information" && (
                    <span className="manual-op-text">
                      <textarea aria-label={`Step ${index + 1} information told`} rows={2} maxLength={MAX_MANUAL_DELIVERY_TEXT} value={draft.text}
                        placeholder="What was communicated…"
                        onChange={(e) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, text: e.target.value } as ManualDraft : d)))} />
                      <TextLimit length={draft.text.length} max={MAX_MANUAL_DELIVERY_TEXT} />
                      {draft.target && performedRoleFor(draft.target.binding, draft.target.observed) && (
                        <span className="behavior-help">Recorded as the {target.roleName} procedure performed (simulated wake).</span>
                      )}
                    </span>
                  )}
                  {draft.kind === "alignment" && (
                    <select aria-label={`Step ${index + 1} alignment`} value={draft.alignment} onChange={(e) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, alignment: e.target.value as Alignment } as ManualDraft : d)))}>
                      <option value="good">Good</option>
                      <option value="evil">Evil</option>
                    </select>
                  )}
                  <button className="btn btn-sm" aria-label={`Move step ${index + 1} up`} disabled={index === 0}
                    onClick={() => setDrafts((prev) => { const next = [...prev]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>↑</button>
                  <button className="btn btn-sm" aria-label={`Remove step ${index + 1}`} onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== index))}>✕</button>
                </li>
              ))}
            </ol>
            <div className="manual-add" role="group" aria-label="Add a step">
              {MANUAL_KINDS.map(({ kind, label }) => (
                <button key={kind} className="btn btn-sm" onClick={() => setDrafts((prev) => [...prev,
                  kind === "effect" ? { kind, target: null, type: "poisoned" }
                    : kind === "reminder" ? { kind, target: null, label: "" }
                      : kind === "role" ? { kind, target: null, roleId: "" }
                        : kind === "alignment" ? { kind, target: null, alignment: "evil" }
                          : kind === "information" ? { kind, target: fingerprint ? pickParticipant(fingerprint.actor) : null, text: "" }
                            : { kind, target: null }])}>+ {label}</button>
              ))}
            </div>
          </section>
        )}

        {!stale && (
          <section aria-label="Result" className="ability-section ability-preview">
            <h3 className="drawer-section-title">Result <OriginTag origin={mode === "guided" ? "computed" : "manual"} /></h3>
            {preview.length > 0
              ? <ul>{preview.map((line, i) => <li key={i}>{line}</li>)}</ul>
              : <p className="behavior-help">{planned && !planned.ok ? planned.message
                : mode === "manual" && drafts.length > 0 && !manual ? "Choose a player for every step." : "Nothing to record yet."}</p>}
            {target.step && target.invocationPath !== "nightTrigger" && (
              <label className="ability-field ability-judgment">
                <input type="checkbox" checked={completeStep} onChange={(e) => setCompleteStep(e.target.checked)} />
                <span>Mark this Night step done</span>
              </label>
            )}
            {commitError && <p className="behavior-help" role="alert">{commitError}</p>}
            <div className="ability-actions">
              <button className="btn btn-gold" disabled={!(planned?.ok && planned.changed)} onClick={confirm}>
                {planned?.ok && planned.changed && planned.plan.needsConfirmation ? "Confirm and record" : "Resolve"}
              </button>
              {mode === "guided" && <button className="btn btn-sm" onClick={() => setMode("manual")}>Resolve manually / unmodeled interaction</button>}
              {mode === "manual" && descriptor && <button className="btn btn-sm" onClick={() => setMode("guided")}>Back to guided resolution</button>}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
