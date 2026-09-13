import type { CompositionAnalysis } from "./setupAnalyzer";
import type { SetupFinding } from "./setupContext";
import { BAG_TYPES } from "./setupPolicies";
import { SETUP_COUNTS } from "@/data/setupCounts";
import { findingSummary } from "./setupPresentation";

export const TYPE_LABEL = { townsfolk: "Townsfolk", outsider: "Outsiders", minion: "Minions", demon: "Demons" };
const LABELS = { blocker: "Before continuing", check: "Storyteller check", warning: "Review", info: "Note" };
export function SetupFindings({ findings }: { findings: SetupFinding[] }) {
  if (!findings.length) return null;
  return <details className="setup-findings">
    <summary>Review setup details</summary>
    <ul>{findings.map(f => <li key={f.code} data-severity={f.severity}>
      <strong>{LABELS[f.severity]}: </strong>
      {f.code === "pool-and-assigned" ? findingSummary(f) : f.code === "modifier:gardener"
        ? "Gardener: review the intended placement, then adjust individual roles in the grimoire after dealing."
        : f.message}
    </li>)}</ul>
  </details>;
}
export function CompositionSummary({ analysis, target }: { analysis: CompositionAnalysis; target: number | null }) {
  const baseline = target === null ? undefined : SETUP_COUNTS[target];
  const candidates = analysis.candidates;
  const rows = candidates ?? (baseline ? [baseline] : []);
  if (target === null) return <p className="setup-caption">Choose a player count to see the expected roles.</p>;
  return <div className="setup-composition">
    <p className="setup-eyebrow">{candidates ? "Expected roles" : "Standard roles · before special setup"}</p>
    {rows.length > 0 && <dl className="setup-composition-counts" aria-label={candidates ? "Expected composition" : "Standard composition"}>
      {BAG_TYPES.map(type => {
        const values = rows.map(r => r[type]); const min = Math.min(...values), max = Math.max(...values);
        return <div key={type} className={`type-${type}`}><dt>{TYPE_LABEL[type]}</dt><dd>{min === max ? min : `${min}–${max}`}</dd></div>;
      })}
    </dl>}
    {!candidates && <p className="setup-composition-note">Storyteller check: confirm the composition for this setup.</p>}
    {candidates && candidates.length > 1 && <details className="setup-composition-options"><summary>Allowed combinations</summary>
      <ul>{candidates.map((c, i) => <li key={i}>{BAG_TYPES.map(t => `${c[t]} ${TYPE_LABEL[t]}`).join(" · ")}</li>)}</ul>
    </details>}
  </div>;
}
