import type { RoleRegistry } from "@/data/roleRegistry";
import { lifeStatusOf } from "@/stores/lifeState";
import { effectAccessibleSummary } from "@/stores/effectRegistry";
import { effectsNeedingCheck } from "@/stores/effects";
import { identityNeedsCheck } from "@/stores/projections";
import type { RoleDef, STPlayerRecord } from "@/stores/types";
import { LifeStateText } from "@/features/life/LifeMarks";
import { normalAlignmentOf } from "./AlignmentControls";

/**
 * Phase 10H (contract §§7, 20; H4): the Inspector's TRUTH -- the
 * Storyteller-relevant identity and Life of one participant at a glance, in
 * words. Shown and Actual Role, and Actual and perceived Alignment, are each
 * stated separately (10H-AC-022); a divergence is marked in words, never by
 * colour alone. Storyteller-private: the caller never renders it under
 * Privacy Mode (DOM absence, 10H-AC-023).
 */
const side = (alignment: string | undefined | null) =>
  alignment === "good" ? "Good" : alignment === "evil" ? "Evil" : alignment === "undisclosed" ? "Not told" : "—";

export function TruthStrip({ player, roleById, registry, acting }: {
  player: STPlayerRecord;
  roleById: Map<string, RoleDef>;
  registry: RoleRegistry | null;
  acting: boolean;
}) {
  const life = lifeStatusOf(player);
  const actual = player.actualRole ? roleById.get(player.actualRole) : undefined;
  const shown = player.shownRole ? roleById.get(player.shownRole) : undefined;
  const diverges = !!player.shownRole && !!player.actualRole && player.shownRole !== player.actualRole;
  const perceived = player.shownAlignment === null ? normalAlignmentOf(player, registry) : player.shownAlignment;
  const effects = effectAccessibleSummary(player);
  const needsCheck = [
    // The Life section (Now) names each Life anomaly and its correction.
    ...(life.anomalies.length ? ["the recorded Life state (see Life)"] : []),
    ...(effectsNeedingCheck(player).length ? ["an Effect's end is not recorded"] : []),
    ...(registry && identityNeedsCheck(player, registry) ? ["the shown character is unsafe to send"] : []),
  ];
  return (
    <section className="truth-strip" aria-label="Truth">
      {acting && <p className="truth-acting">Acting now</p>}
      <dl className="truth-grid">
        <div><dt>Life</dt><dd><LifeStateText state={life.state} /></dd></div>
        <div className={diverges ? "truth-diverges" : undefined}>
          <dt>Shown role</dt>
          <dd>{shown ? <span className={`type-${shown.type}`}>{shown.name}</span> : <span className="truth-dim">Not shown yet</span>}</dd>
        </div>
        <div className={diverges ? "truth-diverges" : undefined}>
          <dt>Actual role</dt>
          <dd>
            {actual ? <span className={`type-${actual.type}`}>{actual.name}</span> : <span className="truth-dim">Unassigned</span>}
            {diverges && <span className="truth-marker"> ≠ shown</span>}
          </dd>
        </div>
        <div><dt>Actual alignment</dt><dd>{side(player.actualAlignment)}</dd></div>
        <div><dt>Perceived alignment</dt><dd>{side(perceived)}{player.shownAlignment === null ? " (normal)" : ""}</dd></div>
        <div><dt>Effects</dt><dd>{effects || <span className="truth-dim">None</span>}</dd></div>
        {player.abilityUsed && <div><dt>Ability</dt><dd>Used</dd></div>}
      </dl>
      {needsCheck.length > 0 && <p className="truth-check"><strong>Needs check:</strong> {needsCheck.join("; ")}.</p>}
    </section>
  );
}
