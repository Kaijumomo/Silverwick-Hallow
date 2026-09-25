import { useEffect, useState } from "react";
import { useStorytellerStore, type LifeCommandResult } from "@/stores/storytellerStore";
import { LIFE_ANOMALY_LABEL, lifeStatusOf, type LifeState } from "@/stores/lifeState";
import type { LifeConfirmationToken } from "@/stores/lifeResolution";
import { usePrivacyStore } from "@/stores/privacyStore";
import type { STPlayerRecord } from "@/stores/types";
import { LifeStateText } from "./LifeMarks";
import { statusChoicesFor, statusTargetOf, type StatusChoice } from "./lifeEventText";

type Runner = (confirmed: LifeConfirmationToken[]) => LifeCommandResult;

/**
 * A small helper for any Life command that may need an explicit
 * confirmation (an additional execution, a Traveler executee). The
 * confirmation is shown inline -- touch and keyboard friendly -- and each
 * exceptional case is confirmed separately, never implied by another.
 *
 * Phase 10A (10A-ASTRA-002): the planner's confirmation tokens are bound to
 * the participation instance and Game Moment it evaluated, and the store
 * refuses a stale one -- that is the authority. As defense in depth, a
 * pending confirmation is also dropped whenever `contextKey` (the selected
 * participant / moment) changes or Privacy Mode turns on.
 */
export function useLifeRunner(contextKey = "") {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ message: string; run: Runner; confirmed: LifeConfirmationToken[] } | null>(null);
  const privacyMode = usePrivacyStore((s) => s.enabled);
  useEffect(() => { setPending(null); }, [contextKey, privacyMode]);
  const attempt = (run: Runner, confirmed: LifeConfirmationToken[] = []): boolean => {
    const result = run(confirmed);
    if (!result.ok && result.code === "needsConfirmation") {
      setError(null);
      setPending({ message: result.message, run, confirmed: [...confirmed, result.confirmation] });
      return false;
    }
    setPending(null);
    setError(result.ok ? null : result.message);
    return result.ok;
  };
  const confirmation = pending && (
    <div className="life-confirm" role="alertdialog" aria-label="Confirm life change">
      <p>{pending.message}</p>
      <div className="drawer-row">
        <button className="btn btn-sm btn-gold" onClick={() => attempt(pending.run, pending.confirmed)}>Record anyway</button>
        <button className="btn btn-sm" onClick={() => setPending(null)}>Cancel</button>
      </div>
    </div>
  );
  const errorNode = error && <p className="life-error" role="alert">{error}</p>;
  return { attempt, confirmation, errorNode, clear: () => { setError(null); setPending(null); } };
}

/** Phase 10A: the drawer's Life section. Every action is a labelled
 * semantic command -- there is no one-click alive/dead toggle. */
export function LifeControls({ player }: { player: STPlayerRecord }) {
  const game = useStorytellerStore((s) => s.game);
  const store = useStorytellerStore.getState;
  const { attempt, confirmation, errorNode } = useLifeRunner(
    `${player.participantId ?? ""}|${game?.phase ?? ""}|${game?.day ?? ""}`);
  const [correction, setCorrection] = useState<StatusChoice>("keep");
  if (!game) return null;
  const status = lifeStatusOf(player);
  const live = game.phase === "night" || game.phase === "day";
  const day = game.phase === "day";
  const dead = !player.alive;
  const voteAvailable = dead && player.ghostVote;

  const applyCorrection = () => {
    if (correction === "keep") return;
    if (attempt(() => store().correctLifeStatus(player.id, statusTargetOf(correction as LifeState)))) setCorrection("keep");
  };

  return (
    <section className="drawer-section life-controls" aria-label="Life">
      <h3 className="drawer-section-title">Life</h3>
      <div className="drawer-row">
        <LifeStateText state={status.state} className="life-headline" />
      </div>
      {status.anomalies.length > 0 && (
        <div className="life-needs-check" role="note">
          <strong>Needs check:</strong> {status.anomalies.map((a) => LIFE_ANOMALY_LABEL[a]).join("; ")}.
          {" "}Use Correct status below.
        </div>
      )}
      {!live ? (
        <p className="behavior-help">
          {game.phase === "setup" ? "Life changes are recorded once Night 1 begins." : "This game has ended."}
        </p>
      ) : (
        <>
          <div className="drawer-row life-actions">
            {!dead && (
              <button className="btn btn-sm" onClick={() => attempt(() => store().recordDeath(player.id))}>Record death</button>
            )}
            {day && !dead && <>
              <button className="btn btn-sm" onClick={() => attempt((c) => store().recordExecution(player.id, "died", executionOptions(c)))}>
                Executed — died
              </button>
              <button className="btn btn-sm" onClick={() => attempt((c) => store().recordExecution(player.id, "survived", executionOptions(c)))}>
                Executed — survived
              </button>
            </>}
            {day && dead && (
              <button className="btn btn-sm" onClick={() => attempt((c) => store().recordExecution(player.id, "alreadyDead", executionOptions(c)))}>
                Executed — already dead
              </button>
            )}
            {day && !dead && player.isTraveler && <>
              <button className="btn btn-sm" onClick={() => attempt(() => store().recordExile(player.id, "died"))}>Exiled — died</button>
              <button className="btn btn-sm" onClick={() => attempt(() => store().recordExile(player.id, "survived"))}>Exiled — survived</button>
            </>}
            {dead && (voteAvailable ? (
              <button className="btn btn-sm" onClick={() => attempt(() => store().spendGhostVote(player.id))}>Mark vote used</button>
            ) : (
              <button className="btn btn-sm" onClick={() => attempt(() => store().restoreGhostVote(player.id))}>Restore vote</button>
            ))}
            {dead && (
              <button className="btn btn-sm" onClick={() => attempt(() => store().resurrect(player.id))}>Resurrect</button>
            )}
          </div>
          {confirmation}
          {errorNode}
          <details className="life-correction">
            <summary>Correct status…</summary>
            <p className="behavior-help">
              A correction fixes Current State without recording a death or resurrection, and never restores a used ability.
            </p>
            <div className="drawer-row">
              <label className="label" htmlFor={`life-correct-${player.id}`}>Correct to</label>
              <select id={`life-correct-${player.id}`} value={correction}
                onChange={(e) => setCorrection(e.target.value as StatusChoice)}>
                {statusChoicesFor(player).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button className="btn btn-sm" disabled={correction === "keep"} onClick={applyCorrection}>Apply correction</button>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

/** Execution options carrying the (bound) confirmations given so far. */
export const executionOptions = (confirmed: LifeConfirmationToken[]) =>
  (confirmed.length ? { confirmations: confirmed } : {});
