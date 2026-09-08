import { useRef, useState } from "react";
import { computeNightOrder } from "./nightOrder";
import type { NightStep } from "./nightOrder";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { PlayerInformation } from "@/features/players/PlayerInformation";
import { getPrivateInfoApplicability, offersNightInformation, previewPrivatePacket } from "@/stores/privatePackets";
import { buildRegistry } from "@/data/roleRegistry";
import { usePrivacyStore } from "@/stores/privacyStore";
import { evilInformationPolicy } from "./nightRules";
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
        Simulated wake — actually the {step.actualRoleName}. Follow the shown procedure; no real ability effects.
      </p>}
      {step.kind === "global" && step.recipientIds !== undefined && <p className="step-player-name">
        Introduction recipients: {step.recipientIds?.map(id => players?.[id]?.name ?? "Unnamed player").join(", ") || "none — review manually"}.
        Simulated identities are excluded.
      </p>}

      {/* Prompt text */}
      {step.prompt && (
        <p className="step-prompt">{step.prompt}</p>
      )}
      {step.advisory && <p className="step-reminder">{step.advisory}</p>}

      {step.kind === "player" && offersNightInformation(step.prompt + " " + step.reminder) && <details className="information-review">
        <summary>Give information</summary>
        <PlayerInformation playerId={step.playerId} purpose="result" />
      </details>}
      <button className="btn btn-sm" disabled={status === "done"}
        onClick={() => useStorytellerStore.getState().setNightStepStatus(day, step.stepKey, "done")}>Done</button>

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
  const steps = computeNightOrder(game.players, game.seatOrder, script, isFirstNight, game);
  for (const key of Object.keys(game.nightProgress ?? {})) {
    const prefix = `${game.day}:manual:`;
    if (key.startsWith(prefix)) steps.push({
      kind: "global", stepKey: key.slice(String(game.day).length + 1),
      label: "Custom night step", prompt: "Storyteller-defined procedure. Use the notes below; complete or skip manually.",
      reminder: "", order: Number.MAX_SAFE_INTEGER,
    });
  }
  const registry = buildRegistry(script);
  const policy = evilInformationPolicy(game.seatOrder.map(id => game.players[id]!).filter(Boolean), registry, game);
  const setupPlayers = game.seatOrder.filter(id => {
    const p = game.players[id];
    if (!p || p.isEmpty || !getPrivateInfoApplicability(p, registry).bluffs) return false;
    if (!policy.normalStartingInfo || policy.complex.length) return false;
    if (isFirstNight) return true;
    // Later nights only offer changed setup content, never an overdue task.
    if (!p.privateInfo?.bluffs?.length && !p.privateInfo?.fakeMinions?.length) return false;
    try { return JSON.stringify(previewPrivatePacket(p, game, registry).payload) !== JSON.stringify(p.publishedPacket?.payload); }
    catch { return true; }
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
        {steps.length === 0 ? (
          <p style={{ color: "var(--text-faint)", fontSize: "12px", fontStyle: "italic", padding: "8px 4px" }}>
            No night actions — configure shown identities for the intended wake procedures.
          </p>
        ) : (
          steps.map((step) => (
            <div key={step.stepKey}>
              <StepCard step={step} record={progress[`${game.day}:${step.stepKey}`]} day={game.day} />
              {step.kind === "global" && step.setupRecipientIds?.filter(id => setupPlayers.includes(id)).map(id => <details className="information-review" key={id}>
                <summary>Setup information — {game.players[id]!.name}</summary>
                <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().selectPlayer(id)}>Edit setup information</button>
                <PlayerInformation playerId={id} purpose="setup" />
              </details>)}
            </div>
          ))
        )}
        {!isFirstNight && setupPlayers.map(id => <details className="information-review" key={id}>
          <summary>Review changed setup information — {game.players[id]!.name}</summary>
          <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().selectPlayer(id)}>Edit setup information</button>
          <PlayerInformation playerId={id} purpose="setup" />
        </details>)}
        <button className="btn btn-sm" onClick={() => useStorytellerStore.getState().setNightStepNotes(
          game.day, `manual:${crypto.randomUUID()}`, ""
        )}>Add custom night step</button>
        <p className="behavior-help">New or changed characters, gained abilities and past events may need a custom step.
          Verify these conditions manually; this sheet does not reconstruct game history.</p>
      </div>
    </aside>
  );
}
