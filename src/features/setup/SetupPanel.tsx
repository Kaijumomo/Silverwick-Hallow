import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Modal } from "@/components/Modal";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { analyzeSetup } from "./setupAnalyzer";
import { selectSetupContext } from "./setupContext";
import { SetupFindings, CompositionSummary } from "./SetupFindings";
import { setupPresentation, findingSummary } from "./setupPresentation";
import { BagEditor } from "./BagEditor";
import { EditBagPanel } from "./EditBagPanel";
import { currentDealtBag } from "./setupRefinement";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import type { RoleId, Script, StorytellerLobbyRecord } from "@/stores/types";

type Props = { game: StorytellerLobbyRecord; script: Script; onClose: () => void;
  foreground?: boolean; returnFocusRef?: RefObject<HTMLElement>;
  /** Which roles in game.rolePool Silverwick most recently auto-filled (Fill/
   * Re-roll Bag), lifted above this panel so the distinction survives closing
   * and reopening Setup within the same Grimoire session. Absent/lost state
   * (a fresh mount, a hard reload) safely falls back to treating the whole
   * pool as Storyteller-intentional, never silently replacing roles. */
  generatedRoleIds?: RoleId[];
  onGeneratedRoleIdsChange?: (ids: RoleId[]) => void;
};

export function SetupPanel({ game, script, onClose, foreground = false, returnFocusRef,
  generatedRoleIds = [], onGeneratedRoleIdsChange = () => {} }: Props) {
  const store = useStorytellerStore();
  const hidden = usePrivacyStore(s => s.enabled);
  const [editing, setEditing] = useState(false);
  const [editingBag, setEditingBag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const countInput = useRef<HTMLInputElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  const context = useMemo(() => selectSetupContext(game, script), [game, script]);
  const analysis = useMemo(() => analyzeSetup(context), [context]);
  const view = setupPresentation(game, analysis, context);
  useEffect(() => {
    if (editing) heading.current?.focus();
    else if (wasEditing.current) primary.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  if (hidden) return null;
  const p = analysis.population;
  const pool = game.rolePool;
  const openReview = () => {
    const disclosure = details.current?.querySelector("details");
    if (disclosure) { disclosure.open = true; disclosure.querySelector("summary")?.focus(); }
  };
  const run = () => {
    setError(null);
    if (editing) { setEditing(false); return; }
    if (view.next === "count") { countInput.current?.focus(); return; }
    if (view.next === "seats") { onClose(); return; }
    if (view.next === "roles") { setEditing(true); return; }
    if (view.next === "review") { openReview(); return; }
    if (view.next === "reveal") {
      const result = store.revealRoles();
      setError(result.ok ? null : result.message ?? "Setup changed. Review the next step before continuing.");
      return;
    }
    const result = view.next === "deal" ? store.dealRolePool() : store.beginNightOne();
    setError(result.ok ? null : "Setup changed. Review the next step before continuing.");
  };
  const shuffleRoles = () => {
    setEditingBag(false);
    const result = store.shuffleSetupRoles();
    setError(result.ok ? null : result.message ?? "Could not shuffle roles.");
  };
  const applyBagEdit = (staged: RoleId[]) => {
    const result = store.applyEditedBag(staged);
    if (result.ok) { setEditingBag(false); setError(null); }
    else setError(result.message ?? "Could not apply bag changes.");
  };
  const actionLabel = editing ? "Done choosing" : {
    count: "Choose player count", seats: "Go to seating", roles: "Choose roles", review: "Review setup",
    deal: "Deal roles", reveal: "Reveal Roles", begin: "Begin Night 1",
  }[view.next];
  const primaryDisabled = view.next === "reveal" && !view.revealReadiness?.ready;
  const messageReady = view.next === "reveal" ? !!view.revealReadiness?.ready : view.ready.ok;
  const body = <div className={`setup-panel-body setup-refined${editing ? " setup-editing" : ""}`}>
    <div className="setup-overview">
      <div className="setup-player-heading">
        <label><input ref={countInput} type="number" min="1" step="1" aria-label="Players" value={game.plannedPlayerCount || ""}
          onChange={e => { store.setPlannedPlayerCount(Number(e.target.value)); setError(null); }} /><span>Planned</span></label>
        <span className="setup-seated-count">Seated: {p.occupiedNonTravelerCount}</span>
        {p.occupiedTravelerCount > 0 && <span className="setup-travelers">+ {p.occupiedTravelerCount} Traveler{p.occupiedTravelerCount === 1 ? "" : "s"}</span>}
      </div>
      <CompositionSummary analysis={view.composition} target={p.targetNonTravelerCount} />
      <div className="setup-selection-status">
        <p className="setup-eyebrow">{view.dealt ? "Grimoire" : "Role pool"}</p>
        <p className="setup-selection-count">{view.dealt ? `${p.occupiedNonTravelerCount} players seated` : <><strong>{pool.length}</strong> / {p.targetNonTravelerCount ?? "—"} selected</>}</p>
        {view.dealt ? <p className="setup-caption">Review or change individual roles in the grimoire.</p> :
          !editing && view.next !== "roles" && <button className="setup-text-button" onClick={() => setEditing(true)}>Edit roles</button>}
      </div>
    </div>
    <div className="setup-next">
      <p id="setup-next-step" className={`setup-next-message${messageReady && (view.dealt || pool.length > 0) ? " ready" : ""}`}>
        {!editing && (view.message === "Ready to deal" || view.message === "Roles revealed") ? <span aria-hidden="true">✓ </span> : null}
        {editing ? `${pool.length} / ${p.targetNonTravelerCount ?? "—"} roles selected` : view.message}
      </p>
      {!editing && view.checks.length > 0 && <button className="setup-check-preview" onClick={openReview}>
        <span>{view.checks.some(f => f.severity === "check") ? "Storyteller check" : "Review roles"}</span>
        {findingSummary(view.checks[0]!)}
      </button>}
      <button ref={primary} className="btn btn-gold setup-primary" aria-describedby="setup-next-step"
        disabled={primaryDisabled} onClick={run}>{actionLabel}</button>
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
    {view.next === "reveal" && !editingBag && (
      <div className="setup-refine-toolbar">
        <button className="btn btn-sm" onClick={shuffleRoles}>Shuffle Roles</button>
        <button className="btn btn-sm" onClick={() => setEditingBag(true)}>Edit Bag</button>
      </div>
    )}
    {view.next === "reveal" && editingBag && (
      <EditBagPanel script={script} initialBag={currentDealtBag(context)} ordinaryCount={p.occupiedNonTravelerCount}
        onApply={applyBagEdit} onCancel={() => setEditingBag(false)} />
    )}
    {editing && !view.dealt && <div>
      <h3 className="setup-editor-heading" ref={heading} tabIndex={-1}>Choose roles</h3>
      <BagEditor script={script} pool={pool} generatedRoleIds={generatedRoleIds}
        fabledIds={game.fabled} loricIds={game.lorics} plannedPlayerCount={p.targetNonTravelerCount}
        onPoolChange={(roles, generated) => {
          store.setRolePool(roles);
          onGeneratedRoleIdsChange(generated);
          setError(null);
        }} />
    </div>}
    <div ref={details} className="setup-details"><SetupFindings findings={view.findings} /></div>
    <details className="setup-modifiers"><summary>Fabled &amp; Lorics{game.fabled.length + game.lorics.length > 0 && ` · ${game.fabled.length + game.lorics.length} selected`}</summary>
      {([
        ["Fabled", FABLED, game.fabled, store.setFabled],
        ["Lorics", LORICS, game.lorics, store.setLorics],
      ] as const).map(([label, catalog, current, setter]) => <section key={label}>
        <h3 className="setup-eyebrow">{label}</h3>
        <div className="setup-modifier-choices">{catalog.map(r => <button key={r.id} className="btn btn-sm" aria-pressed={current.includes(r.id)} title={r.ability}
          onClick={() => setter(current.includes(r.id) ? current.filter(id => id !== r.id) : [...current, r.id])}>{r.name}</button>)}</div>
        {current.filter(id => !catalog.some(r => r.id === id)).map(id => <button className="btn btn-sm" key={id}
          onClick={() => setter(current.filter(value => value !== id))}>Remove unavailable modifier: {id}</button>)}
      </section>)}
    </details>
  </div>;
  return foreground ? <Modal title="Setup" closeLabel="Close setup panel" onClose={onClose}
    className="setup-workspace" returnFocusRef={returnFocusRef}>{body}</Modal> : <aside className="setup-panel" aria-label="Setup helper">
    <div className="setup-panel-header"><h2 className="setup-panel-title">Setup</h2>
      <button className="btn btn-sm" onClick={onClose} aria-label="Close setup panel">✕</button>
    </div>{body}
  </aside>;
}
