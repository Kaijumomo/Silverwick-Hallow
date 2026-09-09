import { useMemo, useState, type RefObject } from "react";
import { Modal } from "@/components/Modal";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { analyzeSetup } from "./setupAnalyzer";
import { selectSetupContext, type SetupAction } from "./setupContext";
import { SetupFindings, CompositionSummary } from "./SetupFindings";
import { isBagType } from "./setupPolicies";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";

type Props = {
  game: StorytellerLobbyRecord;
  script: Script;
  onClose: () => void;
  foreground?: boolean;
  returnFocusRef?: RefObject<HTMLElement>;
};

export function SetupPanel({ game, script, onClose, foreground = false, returnFocusRef }: Props) {
  const store = useStorytellerStore();
  const hidden = usePrivacyStore(s => s.enabled);
  const [workflow, setWorkflow] = useState<SetupAction>(game.rolePool.length ? "deal" : "manual");
  const [error, setError] = useState<string | null>(null);
  const analysis = useMemo(() => analyzeSetup(selectSetupContext(game, script)), [game, script]);
  if (hidden) return null;
  const p = analysis.population;
  const pool = game.rolePool ?? [];
  const ready = analysis.readiness[workflow];
  const findings = analysis.findings.filter(f =>
    (!f.actions || f.actions.includes(workflow)) &&
    (f.severity === "blocker" || f.source === "shared" || f.source === (workflow === "deal" ? "pool" : "assigned")));
  const selectedFabled = new Set(game.fabled);
  const selectedLorics = new Set(game.lorics ?? []);
  const summary = <span className="setup-panel-summary">
    {p.targetNonTravelerCount ?? "Target unset"}{p.targetNonTravelerCount !== null ? " planned" : ""}
    {" · "}{p.occupiedNonTravelerCount} seated · {p.emptyPlannedSeatCount} empty
    {p.occupiedTravelerCount > 0 && ` · ${p.occupiedTravelerCount} Traveler${p.occupiedTravelerCount === 1 ? "" : "s"}`}
  </span>;
  const run = () => {
    const result = workflow === "deal" ? store.dealRolePool() : store.beginNightOne();
    setError(result.ok ? null : result.message);
  };
  const body = <div className="setup-panel-body">
    <div className="setup-section">
      <label className="setup-target">Intended non-Traveler players
        <input className="input" type="number" min="1" step="1" aria-label="Intended non-Traveler players"
          value={game.plannedPlayerCount || ""}
          onChange={e => { store.setPlannedPlayerCount(Number(e.target.value)); setError(null); }} />
      </label>
      <p className="behavior-help">{p.totalPhysicalSeatCount} physical seats. Offline players remain seated.
        Fill or remove unused seats in the grimoire; edit the target deliberately.</p>
      <label>Assignment workflow
        <select className="select" aria-label="Assignment workflow" value={workflow}
          onChange={e => { setWorkflow(e.target.value as SetupAction); setError(null); }}>
          <option value="deal">Random / app-assisted deal</option>
          <option value="manual">Manual Storyteller assignment</option>
        </select>
      </label>
      <SetupFindings findings={findings} />
      <button className="btn btn-gold setup-deal-btn" disabled={!ready.ok} onClick={run}
        aria-describedby="setup-action-help">
        {workflow === "deal" ? "Deal roles & begin Night 1" : "Begin Night 1 with assigned roles"}
      </button>
      <p id="setup-action-help" className="behavior-help">
        {ready.ok ? "Warnings and Storyteller checks do not prevent starting." : ready.message}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="setup-section">
      <CompositionSummary label="Planned pool" analysis={analysis.pool} />
      <CompositionSummary label="Assigned truth" analysis={analysis.assigned} />
      <details className="setup-pool-editor">
        <summary>Edit role pool ({pool.length})</summary>
        <p className="behavior-help">The pool holds future actual roles. Dealing replaces ordinary assignments.
          Clear it to use manually assigned roles.</p>
        <label>Add a role
          <select className="select" aria-label="Add pooled role" value=""
            onChange={e => { if (e.target.value) store.setRolePool([...pool, e.target.value]); }}>
            <option value="">Choose a character</option>
            {[...new Map(script.characters.filter(r => isBagType(r.type)).map(r => [r.id, r])).values()]
              .map(r => <option value={r.id} key={r.id}>{r.name}</option>)}
          </select>
        </label>
        <ul>{pool.map((id, i) => <li key={i}>
          {script.characters.find(r => r.id === id)?.name ?? id}
          <button className="btn btn-sm" aria-label={`Remove pooled ${script.characters.find(r => r.id === id)?.name ?? id} ${i + 1}`}
            onClick={() => store.setRolePool(pool.filter((_, index) => index !== i))}>Remove</button>
        </li>)}</ul>
        {pool.length > 0 && <button className="btn btn-sm" onClick={() => { store.setRolePool([]); setWorkflow("manual"); setError(null); }}>
          Clear pool — keep assignments
        </button>}
      </details>
    </div>
    {([
      ["Fabled", FABLED, selectedFabled, game.fabled, store.setFabled],
      ["Lorics", LORICS, selectedLorics, game.lorics ?? [], store.setLorics],
    ] as const).map(([label, catalog, selected, current, setter]) => <div className="setup-section" key={label}>
      <div className="setup-section-title">{label}</div>
      <p className="behavior-help">Modifiers, not seated players.</p>
      <div className={label === "Fabled" ? "fabled-chips" : "loric-chips"}>
        {catalog.map(r => <button key={r.id} className={`${label === "Fabled" ? "fabled" : "loric"}-chip${selected.has(r.id) ? " selected" : ""}`}
          aria-pressed={selected.has(r.id)} title={r.ability}
          onClick={() => setter(selected.has(r.id) ? current.filter(id => id !== r.id) : [...current, r.id])}>{r.name}</button>)}
      </div>
      {current.filter(id => !catalog.some(r => r.id === id)).map(id =>
        <button className="btn btn-sm" key={id} onClick={() => setter(current.filter(value => value !== id))}>
          Remove unrecognized modifier {id}
        </button>)}
    </div>)}
  </div>;
  return foreground ? <Modal title="Setup" closeLabel="Close setup panel" onClose={onClose}
    className="setup-workspace" returnFocusRef={returnFocusRef}>
    <div className="setup-workspace-summary">{summary}</div>{body}
  </Modal> : <aside className="setup-panel" aria-label="Setup helper">
    <div className="setup-panel-header"><h2 className="setup-panel-title">Setup</h2>{summary}
      <button className="btn btn-sm" onClick={onClose} aria-label="Close setup panel">✕</button>
    </div>{body}
  </aside>;
}
