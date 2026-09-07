import { useRef, useState } from "react";
import { computeNightOrder } from "./nightOrder";
import type { NightStep } from "./nightOrder";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { PrivatePacketPanel } from "@/features/players/PrivatePacketPanel";
import { getPrivateInfoApplicability } from "@/stores/privatePackets";
import { buildRegistry } from "@/data/roleRegistry";
import { usePrivacyStore } from "@/stores/privacyStore";
import type { NightStepRecord, NightStepStatus, Script, StorytellerLobbyRecord } from "@/stores/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEXT_STATUS: Record<NightStepStatus, NightStepStatus> = {
  pending: "done",
  done: "skipped",
  skipped: "pending",
};

const STATUS_ICON: Record<NightStepStatus, string> = {
  pending: "○",
  done: "✓",
  skipped: "⊘",
};

const ROLE_TYPE_COLOR: Record<string, string> = {
  townsfolk: "var(--type-townsfolk)",
  outsider:  "var(--type-outsider)",
  minion:    "var(--type-minion)",
  demon:     "var(--type-demon)",
  traveler:  "var(--type-traveler)",
  fabled:    "var(--type-fabled)",
};

// ---------------------------------------------------------------------------
// StepCard
// ---------------------------------------------------------------------------

type StepCardProps = {
  step: NightStep;
  record: NightStepRecord | undefined;
  day: number;
};

function StepCard({ step, record, day }: StepCardProps) {
  const players = useStorytellerStore(s => s.game?.players);
  const status = record?.status ?? "pending";
  const notes = record?.notes ?? "";
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  const handleCycle = () => {
    useStorytellerStore.getState().setNightStepStatus(day, step.stepKey, NEXT_STATUS[status]);
  };

  const handleNoteBlur = () => {
    const val = notesRef.current?.value ?? "";
    useStorytellerStore.getState().setNightStepNotes(day, step.stepKey, val);
  };

  const roleColor =
    step.kind === "player"
      ? (ROLE_TYPE_COLOR[step.roleType] ?? "var(--text)")
      : "#a5b4dc";

  return (
    <div className="step-card" data-status={status}>
      {/* Header row: status toggle + role name + badges */}
      <div className="step-card-header">
        <button
          className="step-status-btn"
          onClick={handleCycle}
          title={`Mark ${NEXT_STATUS[status]}`}
          aria-label={`Step status: ${status}. Click to mark ${NEXT_STATUS[status]}`}
        >
          {STATUS_ICON[status]}
        </button>

        <span className="step-role-name" style={{ color: roleColor }}>
          {step.kind === "global" ? step.label : step.effectiveRoleName}
        </span>

        {step.kind === "player" && (
          <span className="step-badges">
            {!step.alive     && <span className="step-badge step-badge-dead">dead</span>}
            {step.abilityUsed && <span className="step-badge step-badge-used">used</span>}
            {step.isDeceived  && <span className="step-badge step-badge-deceived">fake</span>}
          </span>
        )}
      </div>

      {/* Player name + seat — player steps only */}
      {step.kind === "player" && (
        <div className="step-player-name">
          {step.playerName} · seat {step.seat + 1}
        </div>
      )}

      {step.kind === "player" && step.isDeceived && <p className="step-reminder">
        Simulated wake — actual role: {step.actualRoleName}. Perform the shown procedure
        with Storyteller-controlled information; this does not grant its ability or effects.
      </p>}
      {step.kind === "player" && step.isDeceived && <p className="behavior-help">
        Review this player's private information task at the top before completing the wake.
      </p>}
      {step.kind === "global" && <p className="step-player-name">
        Introduction recipients: {step.recipientIds?.map(id => players?.[id]?.name ?? "Unnamed player").join(", ") || "none — review manually"}.
        Simulated identities are excluded.
      </p>}

      {/* Prompt text */}
      {step.prompt && (
        <p className="step-prompt">{step.prompt}</p>
      )}

      {/* Expandable reminder */}
      {step.reminder && (
        <>
          <button
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "11px", color: "var(--text-faint)", textAlign: "left",
              padding: "0 0 0 24px", fontFamily: "var(--font-body)",
            }}
            onClick={() => setReminderOpen((o) => !o)}
            aria-expanded={reminderOpen}
          >
            {reminderOpen ? "▾ reminder" : "▸ reminder"}
          </button>
          {reminderOpen && (
            <p className="step-reminder">{step.reminder}</p>
          )}
        </>
      )}

      {/* ST notes */}
      <textarea
        ref={notesRef}
        className="step-notes"
        defaultValue={notes}
        key={`${day}:${step.stepKey}:${notes}`}
        placeholder="ST notes…"
        rows={1}
        onBlur={handleNoteBlur}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NightOrderPanel
// ---------------------------------------------------------------------------

type Props = {
  game: StorytellerLobbyRecord;
  script: Script;
  onClose: () => void;
};

export function NightOrderPanel({ game, script, onClose }: Props) {
  const privacyMode = usePrivacyStore((s) => s.enabled);
  if (privacyMode) {
    return (
      <aside className="night-panel privacy-safe-night" aria-label={`Night ${game.day} order`}>
        <div className="night-panel-header">
          <h2 className="night-panel-title">Night {game.day}</h2>
          <span className="privacy-safe-label" role="status">Privacy Mode On</span>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close night panel">✕</button>
        </div>
        <div className="night-panel-body">
          <p className="behavior-help">Night details are hidden while Privacy Mode is on.</p>
        </div>
      </aside>
    );
  }
  const isFirstNight = game.day === 1;
  const steps = computeNightOrder(game.players, game.seatOrder, script, isFirstNight);
  const registry = buildRegistry(script);
  const packetPlayers = game.seatOrder.filter(id => {
    const p = game.players[id];
    return p && !p.isEmpty && getPrivateInfoApplicability(p, registry).genericPacket;
  });

  const progress = game.nightProgress ?? {};
  const resolvedCount = steps.filter((s) => {
    const rec = progress[`${game.day}:${s.stepKey}`];
    return rec?.status === "done" || rec?.status === "skipped";
  }).length;

  const handleReset = () => {
    if (window.confirm(`Reset all night ${game.day} progress?`)) {
      useStorytellerStore.getState().clearNightProgress(game.day);
    }
  };

  return (
    <aside className="night-panel" aria-label={`Night ${game.day} order`}>
      <div className="night-panel-header">
        <h2 className="night-panel-title">Night {game.day}</h2>
        <span className="night-panel-progress">
          {resolvedCount}&thinsp;/&thinsp;{steps.length}
        </span>
        <button className="btn btn-sm" onClick={handleReset} title="Reset night progress">
          reset
        </button>
        <button className="btn btn-sm" onClick={onClose} aria-label="Close night panel">
          ✕
        </button>
      </div>

      <div className="night-panel-body">
        {!!packetPlayers.length && <div aria-label="Private information tasks">
          <p className="behavior-help">Private information tasks — preview and publish when appropriate tonight. These tasks are separate from ability order.</p>
          {packetPlayers.map(id => <PrivatePacketPanel key={id} playerId={id} />)}
        </div>}
        {steps.length === 0 ? (
          <p style={{ color: "var(--text-faint)", fontSize: "12px", fontStyle: "italic", padding: "8px 4px" }}>
            No night actions — configure shown identities for the intended wake procedures.
          </p>
        ) : (
          steps.map((step) => (
            <StepCard
              key={step.stepKey}
              step={step}
              record={progress[`${game.day}:${step.stepKey}`]}
              day={game.day}
            />
          ))
        )}
      </div>
    </aside>
  );
}
