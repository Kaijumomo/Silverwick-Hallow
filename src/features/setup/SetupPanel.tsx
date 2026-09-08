import { useMemo, type RefObject } from "react";
import { Modal } from "@/components/Modal";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { analyzeBag, analyzeBagCore, type SetupWarning } from "./setupAnalyzer";
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

const TYPE_LABELS: Record<string, string> = {
  townsfolk: "T",
  outsider: "O",
  minion: "M",
  demon: "D",
};

function warningText(w: SetupWarning): string {
  switch (w.kind) {
    case "count-out-of-range":
      return `${w.count} players is outside the supported range (5–15).`;
    case "no-demon":
      return "No Demon is assigned.";
    case "multiple-demons":
      return `${w.count} Demons are assigned (expected 1).`;
    case "type-mismatch": {
      const base = `${w.type}: ${w.actual} assigned, ${w.expected} expected`;
      return w.reason ? `${base} (${w.reason})` : base;
    }
    case "setup-role-in-play":
      return `${w.roleName}: ${w.effectText}`;
  }
}

export function SetupPanel({ game, script, onClose, foreground = false, returnFocusRef }: Props) {
  const setFabled = useStorytellerStore((s) => s.setFabled);
  const setLorics = useStorytellerStore((s) => s.setLorics);
  const dealRolePool = useStorytellerStore((s) => s.dealRolePool);

  const roleById = useMemo(
    () => new Map(script.characters.map((r) => [r.id, r])),
    [script.characters]
  );

  const pool = game.rolePool ?? [];
  const hasPool = pool.length > 0;

  const nonTravelerSeats = game.seatOrder.filter((id) => {
    const p = game.players[id];
    return p && !p.isTraveler;
  });
  const seatCount = nonTravelerSeats.length;
  const poolReady = hasPool && pool.length === seatCount;
  const poolMismatch = hasPool && pool.length !== seatCount;

  // If there's a pool, analyse it. Otherwise fall back to the per-player analysis.
  const analysis = useMemo(() => {
    if (hasPool) {
      return analyzeBagCore({
        nonTravelerCount: seatCount,
        travelerCount: game.seatOrder.filter((id) => game.players[id]?.isTraveler).length,
        assignedRoleIds: pool,
        unassignedCount: Math.max(0, seatCount - pool.length),
        roleById,
      });
    }
    return analyzeBag(game.players, roleById);
  }, [hasPool, pool, seatCount, game.players, game.seatOrder, roleById]);

  const selectedFabled = new Set(game.fabled);
  const selectedLorics = new Set(game.lorics ?? []);

  const toggleFabled = (id: string) => {
    if (selectedFabled.has(id)) {
      setFabled(game.fabled.filter((f) => f !== id));
    } else {
      setFabled([...game.fabled, id]);
    }
  };

  const toggleLoric = (id: string) => {
    const current = game.lorics ?? [];
    if (selectedLorics.has(id)) {
      setLorics(current.filter((l) => l !== id));
    } else {
      setLorics([...current, id]);
    }
  };

  const bagTypes = ["townsfolk", "outsider", "minion", "demon"] as const;

  const setupNotes = analysis.warnings.filter(
    (w): w is Extract<SetupWarning, { kind: "setup-role-in-play" }> =>
      w.kind === "setup-role-in-play"
  );
  const otherWarnings = analysis.warnings.filter(
    (w) => w.kind !== "setup-role-in-play"
  );

  const summary = (
    <span className="setup-panel-summary">
      {analysis.nonTravelerCount} players
      {analysis.travelerCount > 0 && ` · ${analysis.travelerCount} traveler${analysis.travelerCount !== 1 ? "s" : ""}`}
      {analysis.unassignedCount > 0 && ` · ${analysis.unassignedCount} unassigned`}
    </span>
  );
  const header = (
      <div className="setup-panel-header">
        <h2 className="setup-panel-title">Setup</h2>
        {summary}
        <button className="btn btn-sm" onClick={onClose} aria-label="Close setup panel">
          ✕
        </button>
      </div>
  );
  const body = (
      <div className="setup-panel-body">
        {/* Role pool summary — shown when a pre-picked pool exists */}
        {hasPool && (
          <div className="setup-section setup-pool-section">
            <div className="setup-section-title">Role pool</div>
            <div className="setup-pool-meta">
              {pool.length} roles · {seatCount} seats
            </div>
            {poolMismatch && (
              <div className="setup-warning">
                <span className="setup-warning-icon">⚠</span>
                <span>
                  Pool has {pool.length} role{pool.length !== 1 ? "s" : ""} but{" "}
                  {seatCount} seat{seatCount !== 1 ? "s" : ""} are filled.
                  {pool.length > seatCount
                    ? " Remove some roles or add more players."
                    : " Add more roles or remove a player."}
                </span>
              </div>
            )}
            <button
              className="btn btn-gold setup-deal-btn"
              disabled={!poolReady}
              onClick={dealRolePool}
              title={
                poolReady
                  ? "Shuffle the pool and deal one role to each seated player"
                  : `Pool (${pool.length}) must match seated players (${seatCount})`
              }
            >
              Start Game — Deal Roles
            </button>
          </div>
        )}

        {/* Bag composition chips */}
        <div className="setup-bag-chips">
          {bagTypes.map((t) => {
            const actual = analysis.actual[t];
            const expected = analysis.expected?.[t] ?? null;
            const mismatch = expected !== null && actual !== expected;
            return (
              <div
                key={t}
                className={`setup-chip setup-chip-${t}${mismatch ? " mismatch" : ""}`}
                title={`${t}: ${actual} assigned${expected !== null ? `, ${expected} expected` : ""}`}
              >
                <span className="setup-chip-label">{TYPE_LABELS[t]}</span>
                <span className="setup-chip-count">
                  {actual}
                  {expected !== null && <span className="setup-chip-expected">/{expected}</span>}
                </span>
              </div>
            );
          })}
        </div>

        {/* Setup-role notes */}
        {setupNotes.length > 0 && (
          <div className="setup-section">
            <div className="setup-section-title">Setup roles in play</div>
            {setupNotes.map((w, i) => (
              <div key={i} className="setup-note">
                <span className="setup-note-name">{w.roleName}</span>
                <span className="setup-note-effect">{w.effectText}</span>
              </div>
            ))}
          </div>
        )}

        {/* Warnings */}
        {otherWarnings.length > 0 && (
          <div className="setup-section">
            <div className="setup-section-title">Warnings</div>
            {otherWarnings.map((w, i) => (
              <div key={i} className="setup-warning">
                <span className="setup-warning-icon">⚠</span>
                <span>{warningText(w)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Fabled picker */}
        <div className="setup-section">
          <div className="setup-section-title">Fabled</div>
          <div className="fabled-chips">
            {FABLED.map((f) => (
              <button
                key={f.id}
                className={`fabled-chip${selectedFabled.has(f.id) ? " selected" : ""}`}
                aria-pressed={selectedFabled.has(f.id)}
                title={f.ability}
                onClick={() => toggleFabled(f.id)}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>

        {/* Loric picker */}
        <div className="setup-section">
          <div className="setup-section-title">Lorics</div>
          <p className="behavior-help" style={{ margin: "0 0 6px" }}>
            Storyteller-controlled. Not seated, never die.
          </p>
          <div className="loric-chips">
            {LORICS.map((l) => (
              <button
                key={l.id}
                className={`loric-chip${selectedLorics.has(l.id) ? " selected" : ""}`}
                aria-pressed={selectedLorics.has(l.id)}
                title={l.ability}
                onClick={() => toggleLoric(l.id)}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>
      </div>
  );
  return foreground ? (
    <Modal title="Setup" closeLabel="Close setup panel" onClose={onClose} className="setup-workspace" returnFocusRef={returnFocusRef}>
      <div className="setup-workspace-summary">{summary}</div>
      {body}
    </Modal>
  ) : (
    <aside className="setup-panel" aria-label="Setup helper">
      {header}
      {body}
    </aside>
  );
}
