import { useId, useState } from "react";
import { iconUrlFor } from "@/data/iconUrl";
import { buildRegistry } from "@/data/roleRegistry";
import { captureVotingContext, selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import { currentVotingState } from "@/stores/voting";
import type { ReminderIntent } from "@/stores/reminderResolution";
import type { RoleDef, STPlayerRecord } from "@/stores/types";
import { useReminderRemoval } from "@/features/reminders/useReminderRemoval";
import { createRulesQuery } from "@/stores/rulesQuery";

/** The palette is notation only. Its source character controls artwork and
 * ownership, never inferred mechanics. The full editor retains ability actions. */
export function PopoverReminders({ player }: { player: STPlayerRecord }) {
  const game = useStorytellerStore(s => s.game);
  const privacy = usePrivacyStore(s => s.enabled);
  const removal = useReminderRemoval(game, privacy);
  const script = useStorytellerStore(s => game ? selectScriptById(s, game.scriptId) : undefined);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notationHelpId = useId();
  if (!game || !script || !player.participantId || player.isEmpty || privacy) return null;
  const registry = buildRegistry(script);
  const inPlay = new Set(Object.values(game.players).filter(p => !p.isEmpty).map(p => p.actualRole));
  // All means this script plus the Travelers actually seated at this table,
  // never the entire publisher catalogue. Registry ownership wins collisions.
  const ids = new Set([...script.characters.map(r => r.id), ...(script.fabled ?? []).map(r => r.id),
    ...Object.values(game.players).filter(p => !p.isEmpty && p.isTraveler).map(p => p.actualRole)]);
  const palette = [...ids].flatMap(id => {
    const role = registry.get(id);
    return role ? [...new Set([...(role.reminders ?? []), ...(role.remindersGlobal ?? [])])].map(label => ({ role, label })) : [];
  });
  const visible = all ? palette : palette.filter(token => inPlay.has(token.role.id) || game.fabled.includes(token.role.id));
  const target = { playerId: player.id, participantId: player.participantId };
  const ended = game.phase === "ended";
  const context = captureVotingContext();
  const effects = officialEffectPresentation(player, { query: createRulesQuery(game, { script, registry }), target });
  const linkedModifier = (reminderId: string) => currentVotingState(game).modifiers.some(m =>
    m.target.playerId === player.id && m.target.participantId === player.participantId && `voting-${m.id}` === reminderId);
  const resolve = (intent: ReminderIntent) => {
    const current = useStorytellerStore.getState();
    const latest = captureVotingContext();
    if (usePrivacyStore.getState().enabled || current.game !== game || current.lobby !== context.lobby ||
      !latest.writerToken || latest.writerToken !== context.writerToken || latest.lifecycle !== context.lifecycle || current.terminalClose?.status === "closing" ||
      selectScriptById(current, game.scriptId) !== script || current.game.players[player.id] !== player) {
      setError("The player changed. Reopen their details before continuing.");
      return;
    }
    const modifier = intent.kind === "remove" ? currentVotingState(game).modifiers.find(m =>
      m.target.participantId === target.participantId && `voting-${m.id}` === intent.reminderId) : undefined;
    const result = modifier
      ? current.resolveVoting({ kind: "removeModifier", modifierId: modifier.id, code: game.code, day: game.day,
        expectedRevision: currentVotingState(game).revision }, context)
      : current.resolveReminders({ intents: [intent] }, context);
    setError(result.ok ? null : result.message);
  };
  return <section className="player-popover-markers popover-token-reminders" aria-label="On this player">
    <h4>On this player</h4>
    {effects.fallback.length > 0 && <p className="player-popover-effects">{effects.fallback.map(effect => `${effect.indicator.label}${effect.suppressedCount ? " (suppressed)" : ""}`).join(" · ")}</p>}
    {(player.reminders.length > 0 || effects.tokens.length > 0) ? <div className="popover-reminder-grid" aria-label="Placed reminders">
      {effects.tokens.map(token => <div key={token.key} className="popover-reminder-choice" data-reminder-kind="effect" title={token.detail}>
        <ReminderDisc role={token.role} /><span>{token.label}{token.instances.length > 1 ? ` ×${token.instances.length}` : ""}</span>
        <span className="sr-only">{token.detail}</span>
      </div>)}
      {player.reminders.map(reminder => <button type="button" key={reminder.id} className="popover-reminder-choice popover-placed-reminder"
        data-removal-armed={removal.armedId === reminder.id || undefined}
        data-reminder-kind={linkedModifier(reminder.id) ? "effect" : "notation"}
        aria-describedby={`${notationHelpId}-${reminder.id}${linkedModifier(reminder.id) ? "" : ` ${notationHelpId}`}`}
        disabled={ended} aria-label={`Remove ${reminder.label} reminder`} title={`Remove ${reminder.label} reminder`}
        onClick={() => removal.tap(reminder.id, () => resolve({ kind: "remove", target, reminderId: reminder.id }))}>
        <ReminderDisc role={reminder.sourceCharacter ? registry.get(reminder.sourceCharacter) : undefined} />
        {!ended && <span className="popover-reminder-remove" aria-hidden="true">×</span>}<span>{removal.armedId === reminder.id ? "Tap to remove" : reminder.label}</span>
        <span id={`${notationHelpId}-${reminder.id}`} className="sr-only">{linkedModifier(reminder.id) ? "Effect" : "Note"}</span>
      </button>)}
    </div> : <p className="player-popover-empty">No reminders yet. Tap a token below to place it.</p>}
    <span id={notationHelpId} className="sr-only">Notes do not apply effects.</span>
    {!ended && <>
      <div className="popover-reminder-heading"><h4>Add reminder</h4>
        <div className="popover-segmented popover-reminder-filter" role="group" aria-label="Reminder catalog">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>In play</button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)}>All {palette.length}</button>
        </div>
      </div>
      <div className="popover-reminder-grid popover-reminder-palette" aria-label="Available reminders">
        {visible.map(({ role, label }) => <button type="button" key={`${role.id}:${label}`} className="popover-reminder-choice"
          aria-describedby={notationHelpId}
          aria-label={`Add ${label} reminder from ${role.name}`} title={`${role.name}: ${label} (reminder notation)`}
          onClick={() => resolve({ kind: "place", target, reminder: { label, sourceCharacter: role.id } })}>
          <ReminderDisc role={role} /><span>{label}</span>
        </button>)}
      </div>
      {visible.length === 0 && <p className="player-popover-empty">No reminder tokens for these characters.</p>}
    </>}
    {error && <p className="life-error" role="alert">{error}</p>}
  </section>;
}

function ReminderDisc({ role }: { role?: RoleDef }) {
  return <span className="popover-reminder-disc" aria-hidden="true">{role
    ? <img src={iconUrlFor(role)} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
    : <span>✎</span>}</span>;
}
