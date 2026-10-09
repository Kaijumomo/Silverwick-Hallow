import { useEffect, useState } from "react";
import { captureVotingContext, useStorytellerStore, type LifeCommandResult } from "@/stores/storytellerStore";
import { LIFE_ANOMALY_LABEL, lifeStatusOf, type LifeState } from "@/stores/lifeState";
import type { LifeConfirmationToken } from "@/stores/lifeResolution";
import { usePrivacyStore } from "@/stores/privacyStore";
import type { STPlayerRecord } from "@/stores/types";
import { Segmented } from "@/components/Segmented";
import { DragChoice } from "@/components/DragChoice";
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

/** Every action, including the compact Life switch, submits a semantic
 * command. Selecting Alive means resurrection, not a raw status correction. */
export function LifeControls({ player, compact = false }: { player: STPlayerRecord; compact?: boolean }) {
  const game = useStorytellerStore((s) => s.game);
  const terminalClose = useStorytellerStore((s) => s.terminalClose);
  const store = useStorytellerStore.getState;
  const { attempt, confirmation, errorNode } = useLifeRunner(
    `${player.participantId ?? ""}|${game?.phase ?? ""}|${game?.day ?? ""}`);
  const [correction, setCorrection] = useState<StatusChoice>("keep");
  if (!game) return null;
  const status = lifeStatusOf(player);
  const live = game.phase === "night" || game.phase === "day";
  const locked = !live || terminalClose?.status === "closing" || !!terminalClose?.confirmedRecovery || !!terminalClose?.recoveryPending;
  const day = game.phase === "day";
  const dead = !player.alive;
  const voteAvailable = dead && player.ghostVote;

  const applyCorrection = () => {
    if (correction === "keep") return;
    if (attempt(() => store().correctLifeStatus(player.id, statusTargetOf(correction as LifeState)))) setCorrection("keep");
  };

  // The token popup presents only immediate Life actions. Execution/exile
  // outcomes belong to voting; the existing full editor remains in More settings.
  if (compact) {
    const context = captureVotingContext();
    const act = (run: Runner) => attempt(confirmed => {
      const current = store().game;
      const latest = captureVotingContext();
      if (usePrivacyStore.getState().enabled || current !== game || current.players[player.id]?.participantId !== player.participantId ||
        latest.lobby !== context.lobby || latest.lifecycle !== context.lifecycle || !latest.writerToken || latest.writerToken !== context.writerToken || store().terminalClose?.status === "closing")
        return { ok: false, code: "stale", message: "The player changed. Reopen their details before continuing." };
      return run(confirmed);
    });
    return <section className="life-controls-compact" aria-label="Life">
      <div className="life-compact-row">
        <DragChoice label="Life status" hideLabel className="life-compact-switch" value={dead ? "dead" : "alive"}
          disabled={locked} contextKey={game}
          options={[{ value: "alive", label: "Alive", hint: "Tap or slide left to resurrect this player" }, { value: "dead", label: "Dead", hint: "Tap or slide right to record this player's death" }]}
          onChange={value => act(() => value === "alive" ? store().resurrect(player.id) : store().recordDeath(player.id))} />
        {live && dead && <button type="button" className="life-ghost-switch" aria-pressed={voteAvailable} disabled={locked}
          title={voteAvailable ? "Mark ghost vote used" : "Restore ghost vote"}
          onClick={() => act(() => voteAvailable ? store().spendGhostVote(player.id) : store().restoreGhostVote(player.id))}>
          <span className="life-ghost-dot" aria-hidden="true" />Ghost vote
        </button>}
      </div>
      {status.anomalies.length > 0 && <p className="life-needs-check" role="note">Life status needs review in More settings.</p>}
      {confirmation}{errorNode}
    </section>;
  }

  return (
    <section className="drawer-section life-controls" aria-label="Life">
      <h4 className="drawer-section-title">Life</h4>
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
            <Segmented label="Correct to" value={correction} options={statusChoicesFor()} onChange={setCorrection} />
            <div className="drawer-row">
              <button className="btn btn-sm" disabled={correction === "keep"} onClick={applyCorrection}>Apply correction</button>
              {correction === "keep" && <span className="disabled-reason">Choose the corrected status first.</span>}
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
