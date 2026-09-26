import { useEffect, useMemo, useState } from "react";
import { selectScriptById, useStorytellerStore, type EffectCommandResult } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { TRAVELERS } from "@/data/travelers";
import { effectNeedsCheck, manualEffectId, manualEffectState } from "@/stores/effects";
import {
  KNOWN_EFFECT_TYPES,
  QUICK_EFFECT_TYPES,
  effectDefinitionOf,
  effectGroups,
  effectIndicatorLabel,
  effectIndicatorOf,
} from "@/stores/effectRegistry";
import { resolveEffectExpiry, type EffectParticipantBinding, type EffectIntent } from "@/stores/effectResolution";
import { currentLiveMoment, momentAtOrdinal, momentLabel, momentOrdinal } from "@/stores/lifeEvents";
import type { EffectExpiry, EffectLifetime, EffectParameterValue, EffectRecord, ParticipantRef, RoleDef, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10B: the Player Drawer's Effect section -- progressive disclosure:
 *
 *  1. Quick effects: one tap each for Drunk / Poisoned / Protected, managing
 *     ONLY the Storyteller's own manual Effect (`manual:<type>`). An
 *     ability-created Effect of the same type never presses (or blocks) it.
 *  2. Active effects: compact, aggregated ("Poisoned ×2"); selecting a row
 *     reveals the individual instances and their actions.
 *  3. Advanced: "+ Add effect" -- the only place deeper configuration lives.
 *
 * Every command binds the participant this drawer rendered (PlayerId +
 * ParticipantId, captured automatically), so a seat replaced in between is
 * refused as stale rather than changing the new occupant.
 *
 * All disclosure state lives here. Under Privacy Mode this component renders
 * nothing and drops that state, so turning Privacy Mode off never reopens a
 * private detail -- the Storyteller must open it again.
 */
export function EffectControls({ player }: { player: STPlayerRecord }) {
  const game = useStorytellerStore((s) => s.game);
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!privacyMode) return;
    setExpanded(null);
    setAdding(false);
    setError(null);
  }, [privacyMode]);

  if (!game || privacyMode || player.isEmpty || !player.participantId) return null;
  const target: EffectParticipantBinding = { playerId: player.id, participantId: player.participantId };
  const run = (result: EffectCommandResult): boolean => {
    setError(result.ok ? null : result.message);
    return result.ok;
  };
  const resolve = (intents: EffectIntent[]) => run(useStorytellerStore.getState().resolveEffects({ intents }));
  const groups = effectGroups(player);

  return (
    <section className="drawer-section effect-controls" aria-label="Effects">
      <h3 className="drawer-section-title">Effects</h3>
      <div className="drawer-row" role="group" aria-label="Quick effects">
        {QUICK_EFFECT_TYPES.map((type) => {
          const state = manualEffectState(player, type);
          const label = effectDefinitionOf(type).label;
          return (
            <button
              key={type}
              type="button"
              className="toggle-pill"
              data-kind={type}
              aria-pressed={state === "active" ? "true" : state === "suppressed" ? "mixed" : "false"}
              aria-label={state === "suppressed" ? `${label} (manual, suppressed)` : label}
              onClick={() => run(useStorytellerStore.getState().setManualEffect(target, type, state === "absent"))}
            >
              {label}
            </button>
          );
        })}
      </div>

      {groups.length > 0 && (
        <ul className="effect-groups" aria-label="Active effects">
          {groups.map((group) => {
            const key = group.indicator.key;
            const open = expanded === key;
            const needsCheck = group.instances.some(effectNeedsCheck);
            const count = group.instances.length;
            return (
              <li key={key} className="effect-group">
                <button
                  type="button"
                  className="effect-group-toggle"
                  aria-expanded={open}
                  aria-label={`${effectIndicatorLabel(group)}${needsCheck ? ", needs check" : ""}. ${open ? "Hide" : "Show"} details`}
                  onClick={() => setExpanded(open ? null : key)}
                >
                  <span className={`effect-group-name effect-family-${group.indicator.family}`}>
                    {group.indicator.label}{count > 1 ? ` ×${count}` : ""}
                  </span>
                  {group.suppressedCount > 0 && <span className="effect-group-note">{group.suppressedCount} suppressed</span>}
                  {needsCheck && <span className="effect-group-note effect-needs-check">Needs check</span>}
                </button>
                {open && (
                  <ul className="effect-instances">
                    {group.instances.map((effect) => (
                      <EffectInstance key={effect.id} game={game} effect={effect}
                        onIntent={(intent) => resolve([{ ...intent, target } as EffectIntent])} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <AddEffectForm game={game} target={target} onDone={() => setAdding(false)} onError={setError} />
      ) : (
        <div className="drawer-row">
          <button type="button" className="btn btn-sm" onClick={() => { setError(null); setAdding(true); }}>+ Add effect</button>
        </div>
      )}
      {error && <p className="life-error" role="alert">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One instance's details and actions
// ---------------------------------------------------------------------------

type InstanceIntent =
  | { kind: "suppress" | "resume" | "remove" | "correctRemove"; effectId: string }
  | { kind: "update"; effectId: string; changes: { expiry: { kind: "at"; moment: { phase: "night" | "day"; day: number } } } };

function roleLabel(roleId: string | undefined, game: StorytellerLobbyRecord): string | undefined {
  if (!roleId) return undefined;
  const script = selectScriptById(useStorytellerStore.getState(), game.scriptId);
  const role = script?.characters.find((r) => r.id === roleId) ?? TRAVELERS.find((r) => r.id === roleId);
  return role?.name ?? roleId;
}

/** A stored participant, named as recorded -- "(left)" when that
 * participation instance no longer occupies its seat. Never re-derived from
 * the seat's current occupant. */
function participantLabel(ref: ParticipantRef, game: StorytellerLobbyRecord): string {
  if (ref.kind === "legacy") return "an earlier player (unknown)";
  const occupant = Object.prototype.hasOwnProperty.call(game.players, ref.playerId) ? game.players[ref.playerId] : undefined;
  const name = ref.nameAtTime || "Unnamed player";
  return occupant?.participantId === ref.participantId ? name : `${name} (left)`;
}

export function expiryLabel(expiry: EffectExpiry): string {
  switch (expiry.kind) {
    case "none": return "Until removed";
    case "at": return `Ends as ${momentLabel(expiry.moment)} begins`;
    case "unresolved": return "Lifetime unknown (recorded before timed Effects) -- needs check";
  }
}

function parameterText(value: EffectParameterValue, game: StorytellerLobbyRecord): string {
  switch (value.kind) {
    case "participant": return value.participants.map((ref) => participantLabel(ref, game)).join(", ");
    case "role": return value.roleIds.map((id) => roleLabel(id, game)).join(", ");
    case "alignment": return value.alignment === "good" ? "Good" : "Evil";
    case "boolean": return value.value ? "Yes" : "No";
    default: return String(value.value);
  }
}

function EffectInstance({ game, effect, onIntent }: {
  game: StorytellerLobbyRecord;
  effect: EffectRecord;
  onIntent: (intent: InstanceIntent) => void;
}) {
  const definition = effectDefinitionOf(effect.type);
  const manual = effect.id === manualEffectId(effect.type);
  const origin = [
    effect.sourceParticipant ? participantLabel(effect.sourceParticipant, game) : undefined,
    roleLabel(effect.sourceCharacter, game),
  ].filter(Boolean).join(" · ");
  const now = currentLiveMoment(game);
  const nextOf = (phase: "night" | "day") => {
    if (!now) return null;
    let ordinal = momentOrdinal(now) + 1;
    if (momentAtOrdinal(ordinal).phase !== phase) ordinal++;
    return momentAtOrdinal(ordinal);
  };
  const dawn = nextOf("day");
  const dusk = nextOf("night");
  return (
    <li className={`effect-instance ${effect.state === "suppressed" ? "suppressed" : ""}`}>
      <div className="effect-instance-title">
        {definition.label}{manual ? " (manual)" : ""}
        {effect.state === "suppressed" && <span className="effect-group-note"> — suppressed, not currently applying</span>}
      </div>
      <dl className="effect-instance-details">
        {origin && <><dt>Origin</dt><dd>{origin}</dd></>}
        {effect.appliedAt && <><dt>Applied</dt><dd>{momentLabel(effect.appliedAt)}</dd></>}
        <dt>Lasts</dt><dd>{expiryLabel(effect.expiry)}</dd>
        {effect.note && <><dt>Note</dt><dd>{effect.note}</dd></>}
        {effect.parameters && Object.entries(effect.parameters).map(([key, value]) => (
          <div key={key} className="effect-parameter"><dt>{key}</dt><dd>{parameterText(value, game)}</dd></div>
        ))}
      </dl>
      <div className="drawer-row">
        {effect.state === "active"
          ? <button type="button" className="btn btn-sm" onClick={() => onIntent({ kind: "suppress", effectId: effect.id })}>Suppress</button>
          : <button type="button" className="btn btn-sm" onClick={() => onIntent({ kind: "resume", effectId: effect.id })}>Resume</button>}
        <button type="button" className="btn btn-sm" onClick={() => onIntent({ kind: "remove", effectId: effect.id })}>Remove</button>
        <button type="button" className="btn btn-sm" onClick={() => onIntent({ kind: "correctRemove", effectId: effect.id })}>Recorded in error</button>
      </div>
      {effectNeedsCheck(effect) && dawn && dusk && (
        <div className="drawer-row" role="group" aria-label={`Resolve ${definition.label} lifetime`}>
          <button type="button" className="btn btn-sm"
            onClick={() => onIntent({ kind: "update", effectId: effect.id, changes: { expiry: { kind: "at", moment: dawn } } })}>
            Ends as {momentLabel(dawn)} begins
          </button>
          <button type="button" className="btn btn-sm"
            onClick={() => onIntent({ kind: "update", effectId: effect.id, changes: { expiry: { kind: "at", moment: dusk } } })}>
            Ends as {momentLabel(dusk)} begins
          </button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Advanced: + Add effect
// ---------------------------------------------------------------------------

type LifetimeChoice = EffectLifetime["kind"];
const LIFETIME_CHOICES: { value: LifetimeChoice; label: string }[] = [
  { value: "manual", label: "Until removed" },
  { value: "untilDawn", label: "Until dawn" },
  { value: "throughFollowingDay", label: "Through the following day" },
  { value: "untilNextNight", label: "Until next night" },
  { value: "nights", label: "A number of nights" },
  { value: "days", label: "A number of days" },
];
const CUSTOM = "__custom__";

function AddEffectForm({ game, target, onDone, onError }: {
  game: StorytellerLobbyRecord;
  target: EffectParticipantBinding;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const script = useStorytellerStore((s) => selectScriptById(s, game.scriptId));
  const roles = useMemo<RoleDef[]>(() => [...(script?.characters ?? []), ...TRAVELERS], [script]);
  const [type, setType] = useState<string>(KNOWN_EFFECT_TYPES[0]!.type);
  const [customType, setCustomType] = useState("");
  // The source is bound to the participation instance at the moment it is
  // chosen; a seat replaced before "Add" is refused as stale.
  const [source, setSource] = useState<EffectParticipantBinding | null>(null);
  const [sourceCharacter, setSourceCharacter] = useState("");
  const [lifetimeKind, setLifetimeKind] = useState<LifetimeChoice>("manual");
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const live = currentLiveMoment(game);
  const seated = game.seatOrder
    .map((id) => game.players[id])
    .filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId);

  const lifetime: EffectLifetime = lifetimeKind === "nights" || lifetimeKind === "days"
    ? { kind: lifetimeKind, count }
    : { kind: lifetimeKind } as EffectLifetime;
  const preview = resolveEffectExpiry(lifetime, live ?? undefined);
  const chosenType = type === CUSTOM ? customType.trim() : type;

  const chooseSource = (playerId: string) => {
    const player = seated.find((p) => p.id === playerId);
    setSource(player ? { playerId: player.id, participantId: player.participantId! } : null);
    // Smart default: the source's current Actual Role, visible and editable.
    setSourceCharacter(player?.actualRole ?? "");
  };

  const submit = () => {
    const result = useStorytellerStore.getState().resolveEffects({ intents: [{
      kind: "apply", target, effect: {
        type: chosenType,
        lifetime,
        ...(source ? { source } : {}),
        ...(sourceCharacter ? { sourceCharacter } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    }] });
    onError(result.ok ? null : result.message);
    if (result.ok) onDone();
  };

  return (
    <form className="effect-add-form" aria-label="Add effect" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label>Effect
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {KNOWN_EFFECT_TYPES.map((d) => <option key={d.type} value={d.type}>{d.label} ({effectIndicatorOf(d.type).label})</option>)}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {type === CUSTOM && (
        <label>Custom effect name
          <input value={customType} maxLength={64} onChange={(e) => setCustomType(e.target.value)} />
        </label>
      )}
      <label>Caused by
        <select value={source?.playerId ?? ""} onChange={(e) => chooseSource(e.target.value)}>
          <option value="">No player (Storyteller)</option>
          {seated.map((p) => <option key={p.id} value={p.id}>{p.name || `Seat ${p.seat + 1}`} (seat {p.seat + 1})</option>)}
        </select>
      </label>
      <label>Character
        <select value={sourceCharacter} onChange={(e) => setSourceCharacter(e.target.value)}>
          <option value="">None</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label>Lasts
        <select value={lifetimeKind} onChange={(e) => setLifetimeKind(e.target.value as LifetimeChoice)}>
          {LIFETIME_CHOICES.map((c) => (
            <option key={c.value} value={c.value} disabled={!live && c.value !== "manual"}>{c.label}</option>
          ))}
        </select>
      </label>
      {(lifetimeKind === "nights" || lifetimeKind === "days") && (
        <label>How many
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
        </label>
      )}
      <p className="behavior-help">
        {!live ? "Timed effects start once live play begins." : preview ? expiryLabel(preview) : ""}
      </p>
      <label>Note
        <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="drawer-row">
        <button type="submit" className="btn btn-sm btn-gold" disabled={!chosenType}>Add</button>
        <button type="button" className="btn btn-sm" onClick={() => { onError(null); onDone(); }}>Cancel</button>
      </div>
    </form>
  );
}
