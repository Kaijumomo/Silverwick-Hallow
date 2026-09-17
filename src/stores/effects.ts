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

/** True when any current effect of `type` exists on the player, regardless
 * of source -- the single derivation point for status indicators (Drunk/
 * Poisoned/Protected chips, night-order advisories, ...). No expiry logic
 * yet: presence in `effects` is the whole test. */
export function hasEffect(
  player: Pick<STPlayerRecord, "effects">,
  type: string
): boolean {
  return player.effects.some((e) => e.type === type);
}

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
