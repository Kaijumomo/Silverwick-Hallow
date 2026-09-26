import type {
  Alignment,
  EffectId,
  EffectRecord,
  GameMoment,
  ReminderId,
  ReminderRecord,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/** The explicit tri-state view of a player's current actual alignment.
 * Storage stays a plain optional `Alignment` (see STPlayerRecord); absence
 * is never invented into a stored value -- this accessor is the single
 * place that names the third state. */
export type ActualAlignment = Alignment | "unresolved";

export function actualAlignmentOf(
  player: Pick<STPlayerRecord, "actualAlignment">
): ActualAlignment {
  return player.actualAlignment ?? "unresolved";
}

/** The current game moment for a fresh effect/reminder, or undefined when
 * the game has ended (never invented). Never wall-clock. */
export function currentGameMoment(
  game: Pick<StorytellerLobbyRecord, "phase" | "day">
): GameMoment | undefined {
  if (game.phase === "ended") return undefined;
  return { phase: game.phase, day: game.day };
}

/** Deterministic id for the one manual (Storyteller-toggled) effect of a
 * given type on a player. Scoped to the player's own `effects` array, so
 * distinct players never collide. A differently-sourced effect of the same
 * `type` (e.g. a future Poisoner-created "poisoned") always gets its own
 * id and is never touched by the manual toggle. */
export function manualEffectId(type: string): EffectId {
  return `manual:${type}`;
}

// ---------------------------------------------------------------------------
// Phase 10B: the centralized Effect query API. Consumers never re-derive
// these distinctions themselves. All pure; none ever mutates, expires or
// "cleans up" anything -- expiry happens only inside the phase transition.
// ---------------------------------------------------------------------------

type EffectsHolder = Pick<STPlayerRecord, "effects">;

/** Whether this Effect currently applies (not suppressed). */
export const isEffectActive = (effect: Pick<EffectRecord, "state">): boolean => effect.state === "active";

/** EFFECTIVE Effect: true when an Effect of `type` currently APPLIES to the
 * player (active, any source). This is the query for current mechanical
 * state (night-order advisories, future rules); suppressed Effects never
 * count. It carries no rules meaning of its own -- in particular a
 * "protected" Effect implies nothing about death. */
export function hasEffect(player: EffectsHolder, type: string): boolean {
  return player.effects.some((e) => e.type === type && isEffectActive(e));
}

/** STORED Effect existence: true when an Effect of `type` exists at all,
 * even suppressed -- for inspection/audit, never for mechanics. */
export function hasStoredEffect(player: EffectsHolder, type: string): boolean {
  return player.effects.some((e) => e.type === type);
}

/** Effect instances matching `filter` (every stored instance by default,
 * suppressed included), in stored order -- for advanced UI and future
 * rules logic that must reason about individual causal instances. */
export function effectInstances(player: EffectsHolder, filter: (effect: EffectRecord) => boolean = () => true): EffectRecord[] {
  return player.effects.filter(filter);
}

/** The instances that currently apply, optionally of one `type`. */
export function effectiveEffects(player: EffectsHolder, type?: string): EffectRecord[] {
  return player.effects.filter((e) => isEffectActive(e) && (type === undefined || e.type === type));
}

/** MANUAL Effect: the exact Storyteller quick-control Effect
 * (`manual:<type>`), or undefined. Never an ability-created Effect of the
 * same type. */
export function manualEffectOf(player: EffectsHolder, type: string): EffectRecord | undefined {
  return findEffect(player, manualEffectId(type));
}

/** The quick control's own state -- never the aggregate of every Effect of
 * that type (a Poisoner's "poisoned" does not press the manual toggle). */
export function manualEffectState(player: EffectsHolder, type: string): "absent" | "active" | "suppressed" {
  const effect = manualEffectOf(player, type);
  return !effect ? "absent" : effect.state;
}

/** True when the exact manual Effect of `type` is present AND applying. */
export function hasManualEffect(player: EffectsHolder, type: string): boolean {
  return manualEffectState(player, type) === "active";
}

/** A legacy (pre-v20) finite Effect whose exact expiry was never recorded:
 * recoverable Storyteller state that needs a check, never corruption. */
export const effectNeedsCheck = (effect: Pick<EffectRecord, "expiry">): boolean => effect.expiry.kind === "unresolved";

/** The player's Effects that need a Storyteller check (Storyteller-only). */
export function effectsNeedingCheck(player: EffectsHolder): EffectRecord[] {
  return player.effects.filter(effectNeedsCheck);
}

/** One Effect instance by id (identity is participant + id). */
export function findEffect(
  player: Pick<STPlayerRecord, "effects">,
  id: EffectId
): EffectRecord | undefined {
  return player.effects.find((e) => e.id === id);
}

export function findReminder(
  player: Pick<STPlayerRecord, "reminders">,
  id: ReminderId
): ReminderRecord | undefined {
  return player.reminders.find((r) => r.id === id);
}
