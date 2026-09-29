import { useEffect, useMemo, useState } from "react";
import { selectScriptById, useStorytellerStore, type ReminderCommandResult } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { resolvedCharacters } from "@/data/roleRegistry";
import { momentLabel } from "@/stores/lifeEvents";
import {
  MAX_REMINDER_LABEL_LENGTH,
  MAX_REMINDER_NOTE_LENGTH,
  nextPhaseCleanupMoment,
  reminderCleanupStatus,
  type ReminderIntent,
  type ReminderParticipantBinding,
  type ReminderSpec,
} from "@/stores/reminderResolution";
import { REMINDER_PRESETS, authoritativeLabelHint, cleanupStatusText } from "./reminderPresentation";
import type { ParticipantRef, ReminderRecord, RoleDef, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10C: the Player Drawer's Reminder section -- progressive disclosure:
 *
 *  1. Fast path: type (or tap a safe quick preset) -> placed. Nothing else is
 *     asked for.
 *  2. Current reminders: one row per instance, one-tap remove; selecting a
 *     row reveals its origin, created moment, cleanup hint, note and the
 *     amend / correction actions.
 *  3. "More options": source, character, a cleanup hint and a note -- never
 *     required.
 *
 * Every intent binds the participant this drawer rendered (PlayerId +
 * ParticipantId, captured automatically), so a seat replaced in between is
 * refused as stale. The caller keys this component by ParticipantId, so no
 * draft or disclosure state carries into a replacement occupant.
 *
 * Reminders are notation: nothing here (or anywhere) makes them mechanics.
 * Under Privacy Mode this renders nothing and drops all disclosure state, so
 * turning Privacy Mode off never reopens a private detail.
 */
export function ReminderControls({ player }: { player: STPlayerRecord }) {
  const game = useStorytellerStore((s) => s.game);
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [source, setSource] = useState<ReminderParticipantBinding | null>(null);
  const [sourceCharacter, setSourceCharacter] = useState("");
  const [cleanupNextPhase, setCleanupNextPhase] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!privacyMode) return;
    setExpanded(null);
    setAdvanced(false);
    setError(null);
  }, [privacyMode]);

  if (!game || privacyMode || player.isEmpty || !player.participantId) return null;
  const target: ReminderParticipantBinding = { playerId: player.id, participantId: player.participantId };
  const ended = game.phase === "ended";
  const run = (result: ReminderCommandResult): boolean => {
    setError(result.ok ? null : result.message);
    return result.ok;
  };
  const resolve = (intents: ReminderIntent[]) => run(useStorytellerStore.getState().resolveReminders({ intents }));
  const resetAdvanced = () => {
    setSource(null);
    setSourceCharacter("");
    setCleanupNextPhase(false);
    setNote("");
  };
  const place = (label: string, withOptions: boolean) => {
    const text = label.trim();
    if (!text) return;
    const reminder: ReminderSpec = {
      label: text,
      ...(withOptions && source ? { source } : {}),
      ...(withOptions && sourceCharacter ? { sourceCharacter } : {}),
      ...(withOptions && cleanupNextPhase ? { cleanup: { kind: "nextPhase" as const } } : {}),
      ...(withOptions && note.trim() ? { note: note.trim() } : {}),
    };
    if (resolve([{ kind: "place", target, reminder }])) {
      setDraft("");
      if (withOptions) { resetAdvanced(); setAdvanced(false); }
    }
  };
  const hint = draft.trim() ? authoritativeLabelHint(draft) : null;

  return (
    <section className="drawer-section reminder-controls" aria-label="Reminders">
      <h3 className="drawer-section-title">Reminders</h3>
      <p className="behavior-help reminder-help">Storyteller notation only -- never a rule.</p>
      {player.reminders.length > 0 ? (
        <ul className="reminder-list" aria-label="Current reminders">
          {player.reminders.map((reminder) => {
            const open = expanded === reminder.id;
            const status = cleanupStatusText(reminderCleanupStatus(reminder, game));
            return (
              <li key={reminder.id} className="reminder-row">
                <span className={`reminder-tag ${status ? "reminder-attention" : ""}`}>
                  <button
                    type="button"
                    className="reminder-tag-label"
                    aria-expanded={open}
                    aria-label={`${reminder.label}${status ? `, ${status}` : ""}. ${open ? "Hide" : "Show"} details`}
                    onClick={() => setExpanded(open ? null : reminder.id)}
                  >
                    <span className="reminder-glyph" aria-hidden="true">✎</span>
                    {reminder.label}
                    {status && <span className="reminder-status"> · {status}</span>}
                  </button>
                  <button
                    type="button"
                    className="reminder-tag-remove"
                    aria-label={`Remove ${reminder.label} reminder`}
                    disabled={ended}
                    onClick={() => { if (resolve([{ kind: "remove", target, reminderId: reminder.id }]) && open) setExpanded(null); }}
                  >
                    ×
                  </button>
                </span>
                {open && (
                  <ReminderDetail game={game} reminder={reminder} ended={ended}
                    onIntent={(intent) => resolve([{ ...intent, target } as ReminderIntent])} />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="behavior-help">No reminders.</p>
      )}

      {ended ? (
        <p className="behavior-help">The game has ended; its Reminders are frozen.</p>
      ) : (
        <>
          <form className="reminder-add" aria-label="Add reminder"
            onSubmit={(e) => { e.preventDefault(); place(draft, advanced); }}>
            <input
              className="input"
              aria-label="Reminder text"
              placeholder="Add reminder…"
              maxLength={MAX_REMINDER_LABEL_LENGTH}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn btn-sm" disabled={!draft.trim()}>Add</button>
          </form>
          {hint && <p className="behavior-help reminder-hint" role="note">{hint}</p>}
          <div className="reminder-presets" role="group" aria-label="Quick reminders">
            {REMINDER_PRESETS.map((preset) => (
              <button key={preset} type="button" className="reminder-preset" onClick={() => place(preset, false)}>
                + {preset}
              </button>
            ))}
          </div>
          <div className="drawer-row">
            <button type="button" className="btn btn-sm" aria-expanded={advanced}
              onClick={() => { if (advanced) resetAdvanced(); setAdvanced(!advanced); }}>
              {advanced ? "Fewer options" : "More options"}
            </button>
          </div>
          {advanced && (
            <ReminderOptions game={game} source={source} onSource={(binding, roleId) => { setSource(binding); setSourceCharacter(roleId); }}
              sourceCharacter={sourceCharacter} onSourceCharacter={setSourceCharacter}
              cleanupNextPhase={cleanupNextPhase} onCleanupNextPhase={setCleanupNextPhase}
              note={note} onNote={setNote} />
          )}
        </>
      )}
      {error && <p className="life-error" role="alert">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** CLOSURE-03: named by the ONE definition the registry resolves for the id. */
function roleLabel(roleId: string | undefined, game: StorytellerLobbyRecord): string | undefined {
  if (!roleId) return undefined;
  const script = selectScriptById(useStorytellerStore.getState(), game.scriptId);
  const role = resolvedCharacters(script).find((r) => r.id === roleId);
  return role?.name ?? roleId;
}

/** A stored origin participant, named from its durable snapshot. Whether
 * they are still here is decided by their ParticipantId anywhere in the
 * roster -- never by whoever now occupies `ref.playerId`. */
export function reminderSourceLabel(ref: ParticipantRef, game: StorytellerLobbyRecord): string {
  if (ref.kind === "legacy") return "an earlier player (unknown)";
  const present = Object.values(game.players).some((p) => !p.isEmpty && p.participantId === ref.participantId);
  const name = ref.nameAtTime || "Unnamed player";
  return present ? name : `${name} (left)`;
}

function cleanupText(reminder: ReminderRecord, game: StorytellerLobbyRecord): string {
  const cue = reminder.cleanupCue;
  if (!cue) return "No cleanup reminder";
  if (cue.kind === "unresolved") return "Cleanup point was not recorded -- needs check";
  const due = reminderCleanupStatus(reminder, game) === "due";
  return `Clean up as ${momentLabel(cue.moment)} begins${due ? " -- needs cleanup now" : ""}`;
}

type DetailIntent =
  | { kind: "remove" | "correctRemove"; reminderId: string }
  | { kind: "amend"; reminderId: string; changes: { note?: string | null; cleanup?: { kind: "nextPhase" } | null } }
  | { kind: "correctAmend"; reminderId: string; amendment: { cleanup: { kind: "nextPhase" } | null } };

function ReminderDetail({ game, reminder, ended, onIntent }: {
  game: StorytellerLobbyRecord;
  reminder: ReminderRecord;
  ended: boolean;
  onIntent: (intent: DetailIntent) => boolean;
}) {
  const [noteDraft, setNoteDraft] = useState(reminder.note ?? "");
  const origin = [
    reminder.sourceParticipant ? reminderSourceLabel(reminder.sourceParticipant, game) : undefined,
    roleLabel(reminder.sourceCharacter, game),
  ].filter(Boolean).join(" · ");
  const next = nextPhaseCleanupMoment(game);
  const unresolved = reminder.cleanupCue?.kind === "unresolved";
  return (
    <div className="reminder-detail">
      <dl className="effect-instance-details">
        {origin && <><dt>Origin</dt><dd>{origin}</dd></>}
        {reminder.createdAt && <><dt>Placed</dt><dd>{momentLabel(reminder.createdAt)}</dd></>}
        <dt>Cleanup</dt><dd>{cleanupText(reminder, game)}</dd>
        {reminder.note && <><dt>Note</dt><dd>{reminder.note}</dd></>}
      </dl>
      {!ended && (
        <>
          {unresolved ? (
            <div className="drawer-row" role="group" aria-label={`Resolve ${reminder.label} cleanup`}>
              <button type="button" className="btn btn-sm"
                onClick={() => onIntent({ kind: "correctAmend", reminderId: reminder.id, amendment: { cleanup: null } })}>
                Keep (no cleanup)
              </button>
              {next && <button type="button" className="btn btn-sm"
                onClick={() => onIntent({ kind: "correctAmend", reminderId: reminder.id, amendment: { cleanup: { kind: "nextPhase" } } })}>
                Clean up as {momentLabel(next)} begins
              </button>}
            </div>
          ) : (
            <div className="drawer-row">
              {next && <button type="button" className="btn btn-sm"
                onClick={() => onIntent({ kind: "amend", reminderId: reminder.id, changes: { cleanup: { kind: "nextPhase" } } })}>
                Clean up as {momentLabel(next)} begins
              </button>}
              {reminder.cleanupCue && <button type="button" className="btn btn-sm"
                onClick={() => onIntent({ kind: "amend", reminderId: reminder.id, changes: { cleanup: null } })}>
                No cleanup reminder
              </button>}
            </div>
          )}
          <form className="reminder-note-form" aria-label={`${reminder.label} note`}
            onSubmit={(e) => { e.preventDefault(); onIntent({ kind: "amend", reminderId: reminder.id, changes: { note: noteDraft.trim() ? noteDraft : null } }); }}>
            <input className="input" aria-label="Note" maxLength={MAX_REMINDER_NOTE_LENGTH} value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)} />
            <button type="submit" className="btn btn-sm" disabled={noteDraft.trim() === (reminder.note ?? "")}>Save note</button>
          </form>
          <div className="drawer-row">
            <button type="button" className="btn btn-sm" onClick={() => onIntent({ kind: "remove", reminderId: reminder.id })}>Remove</button>
            <button type="button" className="btn btn-sm" onClick={() => onIntent({ kind: "correctRemove", reminderId: reminder.id })}>Recorded in error</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// More options (progressive disclosure; never required)
// ---------------------------------------------------------------------------

function ReminderOptions({ game, source, onSource, sourceCharacter, onSourceCharacter, cleanupNextPhase, onCleanupNextPhase, note, onNote }: {
  game: StorytellerLobbyRecord;
  source: ReminderParticipantBinding | null;
  onSource: (binding: ReminderParticipantBinding | null, roleId: string) => void;
  sourceCharacter: string;
  onSourceCharacter: (roleId: string) => void;
  cleanupNextPhase: boolean;
  onCleanupNextPhase: (on: boolean) => void;
  note: string;
  onNote: (note: string) => void;
}) {
  const script = useStorytellerStore((s) => selectScriptById(s, game.scriptId));
  // CLOSURE-03: one choice per RoleId, the definition the registry resolves.
  const roles = useMemo<RoleDef[]>(() => resolvedCharacters(script), [script]);
  const seated = game.seatOrder
    .map((id) => game.players[id])
    .filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId);
  const next = nextPhaseCleanupMoment(game);
  return (
    <fieldset className="effect-add-form reminder-options">
      <legend className="sr-only">Reminder options</legend>
      <label>From player
        <select value={source?.playerId ?? ""} onChange={(e) => {
          // Bound to the participation instance at the moment it is chosen;
          // a seat replaced before "Add" is refused as stale.
          const player = seated.find((p) => p.id === e.target.value);
          onSource(player ? { playerId: player.id, participantId: player.participantId! } : null, player?.actualRole ?? "");
        }}>
          <option value="">None</option>
          {seated.map((p) => <option key={p.id} value={p.id}>{p.name || `Seat ${p.seat + 1}`} (seat {p.seat + 1})</option>)}
        </select>
      </label>
      <label>Character
        <select value={sourceCharacter} onChange={(e) => onSourceCharacter(e.target.value)}>
          <option value="">None</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      {next && (
        <label className="reminder-option-check">
          <input type="checkbox" checked={cleanupNextPhase} onChange={(e) => onCleanupNextPhase(e.target.checked)} />
          Remind me to clean up as {momentLabel(next)} begins
        </label>
      )}
      <label>Note
        <input value={note} maxLength={MAX_REMINDER_NOTE_LENGTH} onChange={(e) => onNote(e.target.value)} />
      </label>
    </fieldset>
  );
}
