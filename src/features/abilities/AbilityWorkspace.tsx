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
import type { Alignment, Script, StorytellerLobbyRecord } from "@/stores/types";
import { bindingOf, describeOutcome, seatedParticipants } from "./abilityUi";
import { OriginTag, RequirementInput } from "./RequirementInput";

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

type ManualDraft =
  | { kind: "death" | "resurrection" | "useAbility"; target: string }
  | { kind: "effect"; target: string; type: string }
  | { kind: "reminder"; target: string; label: string }
  | { kind: "role"; target: string; roleId: string }
  | { kind: "alignment"; target: string; alignment: Alignment };

const MANUAL_KINDS: { kind: ManualDraft["kind"]; label: string }[] = [
  { kind: "death", label: "Death" },
  { kind: "resurrection", label: "Resurrection" },
  { kind: "useAbility", label: "Ability used" },
  { kind: "effect", label: "Effect" },
  { kind: "role", label: "Character change" },
  { kind: "alignment", label: "Alignment change" },
  { kind: "reminder", label: "Reminder" },
];


export function AbilityWorkspace({ game, script, registry, semantics, target, descriptor, manualReason, initialInputs, onClose, onResolved }: Props) {
  // Captured ONCE, at open: the state the Storyteller is resolving against.
  const [fingerprint] = useState(() => captureFingerprint(game, target.actorId, target.step));
  const [mode, setMode] = useState<"guided" | "manual">(descriptor ? "guided" : "manual");
  const [inputs, setInputs] = useState<Record<string, AbilityInputValue>>(initialInputs ?? {});
  const [judgments, setJudgments] = useState<Record<string, AbilityInputValue>>({});
  const [drafts, setDrafts] = useState<ManualDraft[]>([]);
  const [reason, setReason] = useState(descriptor ? "" : manualReason);
  const [completeStep, setCompleteStep] = useState(!!target.step);
  const [commitError, setCommitError] = useState<string | null>(null);
  const participants = seatedParticipants(game);
  const env = useMemo(() => ({ script, registry, semantics }), [script, registry, semantics]);

  const binding = (playerId: string): ParticipantBinding | null => {
    const player = game.players[playerId];
    return player && !player.isEmpty && player.participantId ? bindingOf(player) : null;
  };

  const manualOutcome = (): AbilityOutcome => {
    const operations: AbilityOperation[] = [];
    for (const draft of drafts) {
      const who = binding(draft.target);
      if (!who) continue;
      const current = game.players[draft.target]!;
      switch (draft.kind) {
        case "death": case "resurrection": case "useAbility":
          operations.push({ domain: "life", intents: [{ kind: draft.kind, target: who }] }); break;
        case "effect":
          operations.push({ domain: "effect", intents: [{ kind: "apply", target: who, effect: { type: draft.type, lifetime: { kind: "manual" } } }] }); break;
        case "reminder":
          operations.push({ domain: "reminder", intents: [{ kind: "place", target: who, reminder: { label: draft.label } }] }); break;
        // Built by the seams' own intent builders from the record the
        // Storyteller sees (bound participant + observed state).
        case "role":
          operations.push({ domain: "role", intents: [changeRoleIntent(current, draft.roleId)] }); break;
        case "alignment":
          operations.push({ domain: "alignment", intents: [changeAlignmentIntent(current, draft.alignment)] }); break;
      }
    }
    // The Storyteller's list order IS the declared order of this manual outcome.
    return { operations, mechanicalOrder: "declared" };
  };

  const request: AbilityResolutionRequest | null = !fingerprint ? null : mode === "guided"
    ? { mode: "guided", invocationPath: target.invocationPath, fingerprint, roleId: target.roleId, inputs, judgments, completeStep }
    : { mode: "manual", fingerprint, roleId: target.roleId, outcome: manualOutcome(), reason, completeStep };
  const planned = request ? planAbilityResolution(game, request, env) : null;
  const stale = !fingerprint || (planned && !planned.ok && planned.code === "stale");
  // SOL-10F-L2: every judgment the coordinator asks for is rendered by its own
  // kind / cardinality / constraints, and stays visible once asked.
  const asked: AbilityInputRequirement[] = planned && !planned.ok && planned.code === "needsInput"
    ? (planned.requirements ?? []).filter((requirement) => requirement.source === "judgment" && !descriptor?.inputs.some((input) => input.id === requirement.id))
    : [];
  const [judgmentFields, setJudgmentFields] = useState<AbilityInputRequirement[]>([]);
  const newlyAsked = asked.filter((requirement) => !judgmentFields.some((known) => known.id === requirement.id));
  useEffect(() => {
    if (newlyAsked.length) setJudgmentFields((known) => [...known, ...newlyAsked.filter((r) => !known.some((k) => k.id === r.id))]);
  });
  const preview = planned?.ok && planned.changed ? describeOutcome(game, planned.plan.outcome, registry) : [];

  const confirm = () => {
    if (!request) return;
    const result = useStorytellerStore.getState().resolveAbility(request, semantics);
    if (!result.ok) { setCommitError(result.message); return; }
    if (!result.changed) { onClose(); return; }
    const committed = useStorytellerStore.getState().game!;
    onResolved({ resolutionId: result.resolutionId, game: committed, delivered: committed.informationDeliveries.length > game.informationDeliveries.length });
  };

  const participantSelect = (value: string, onChange: (id: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a player…</option>
      {participants.map((p) => <option key={p.id} value={p.id}>{p.name || `Seat ${p.seat + 1}`} · seat {p.seat + 1}</option>)}
    </select>
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
                  onChange={(value) => setInputs((prev) => {
                    const next = { ...prev };
                    if (value) next[input.id] = value;
                    else delete next[input.id];
                    return next;
                  })} />
              ))}
            </section>
            {judgmentFields.length > 0 && (
              <section aria-label="Storyteller judgment" className="ability-section">
                <h3 className="drawer-section-title">Storyteller judgment</h3>
                {judgmentFields.map((requirement) => (
                  <RequirementInput key={requirement.id} requirement={requirement} game={game} script={script} actor={fingerprint?.actor ?? null}
                    onChange={(value) => setJudgments((prev) => {
                      const next = { ...prev };
                      if (value) next[requirement.id] = value;
                      else delete next[requirement.id];
                      return next;
                    })} />
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
                  {participantSelect(draft.target, (id) => setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, target: id } : d))), `Step ${index + 1} player`)}
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
                  kind === "effect" ? { kind, target: "", type: "poisoned" }
                    : kind === "reminder" ? { kind, target: "", label: "" }
                      : kind === "role" ? { kind, target: "", roleId: "" }
                        : kind === "alignment" ? { kind, target: "", alignment: "evil" }
                          : { kind, target: "" }])}>+ {label}</button>
              ))}
            </div>
          </section>
        )}

        {!stale && (
          <section aria-label="Result" className="ability-section ability-preview">
            <h3 className="drawer-section-title">Result <OriginTag origin={mode === "guided" ? "computed" : "manual"} /></h3>
            {preview.length > 0
              ? <ul>{preview.map((line, i) => <li key={i}>{line}</li>)}</ul>
              : <p className="behavior-help">{planned && !planned.ok ? planned.message : "Nothing to record yet."}</p>}
            {target.step && (
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
