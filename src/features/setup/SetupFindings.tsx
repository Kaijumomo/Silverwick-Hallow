import type { CompositionAnalysis } from "./setupAnalyzer";
import type { SetupFinding } from "./setupContext";
import { formatCounts } from "./setupPolicies";

const LABELS = { blocker: "Before starting", check: "Storyteller check", warning: "Warning", info: "Info" };
export function SetupFindings({ findings }: { findings: SetupFinding[] }) {
  const attention = findings.filter(f => f.severity !== "info");
  const info = findings.filter(f => f.severity === "info");
  return <div className="setup-findings">
    <p>{attention.length ? `${attention.length} ${attention.length === 1 ? "item needs" : "items need"} attention` : "No issues in supported checks"}
      <span className="behavior-help"> · Storyteller judgment remains final.</span></p>
    {attention.length > 0 && <details open={attention.some(f => f.severity === "blocker")}>
      <summary>Review setup findings</summary>
      <ul>{attention.map(f => <li key={f.code} data-severity={f.severity}>
        <strong>{LABELS[f.severity]}: </strong>{f.message}
      </li>)}</ul>
    </details>}
    {info.length > 0 && <details><summary>Planning information</summary>
      <ul>{info.map(f => <li key={f.code}>{f.message}</li>)}</ul>
    </details>}
  </div>;
}
export function CompositionSummary({ label, analysis }: { label: string; analysis: CompositionAnalysis }) {
  return <div className="setup-composition">
    <strong>{label}: {analysis.roleCount} roles</strong>
    <div>{formatCounts(analysis.actual)}</div>
    <small>{analysis.candidates
      ? `Supported composition: ${analysis.candidates.map(formatCounts).join(" or ")}`
      : "Composition requires manual review."}</small>
  </div>;
}
