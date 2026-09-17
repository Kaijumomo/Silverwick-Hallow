import { currentGameMoment } from "./effects";
import type {
  EffectRecord,
  HistoryCategory,
  HistoryId,
  HistoryRecord,
  PlayerId,
  Provenance,
  ReminderRecord,
  StorytellerLobbyRecord,
} from "./types";

const historyId = (): HistoryId =>
  globalThis.crypto?.randomUUID?.() ?? `h-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The single live/Setup boundary for Phase 9D.2 history. Setup
 * construction (an initial deal, a pre-Reveal refinement, identity
 * preparation) is never gameplay and must never populate history; once
 * the game has actually entered Night or Day, eligible mutations do.
 * Centralized here so no individual mutation command has to decide this
 * for itself (see recordIfLive).
 */
export function isLiveGamePhase(phase: StorytellerLobbyRecord["phase"]): boolean {
  return phase === "night" || phase === "day";
}

type NewHistoryRecord = {
  category: HistoryCategory;
  playerId: PlayerId;
  change: HistoryRecord["change"];
  provenance?: Provenance;
  note?: string;
};

/**
 * The one path every authoritative mutation command uses to append
 * history, so a future command gets correct bookkeeping just by calling
 * this instead of reimplementing it. `build` is only invoked once the
 * game is confirmed to be live (Setup and ended games are skipped before
 * it ever runs), and it may itself return null to represent "no real
 * change happened" (an idempotent re-add, a no-op toggle) -- in either
 * case `updatedGame` passes through completely unchanged, so history is
 * never fabricated for something that didn't actually happen.
 */
export function recordIfLive(
  game: StorytellerLobbyRecord,
  updatedGame: StorytellerLobbyRecord,
  build: () => NewHistoryRecord | null
): StorytellerLobbyRecord {
  if (!isLiveGamePhase(game.phase)) return updatedGame;
  const entry = build();
  if (!entry) return updatedGame;
  const record: HistoryRecord = { id: historyId(), moment: currentGameMoment(game), ...entry };
  return { ...updatedGame, history: [...updatedGame.history, record] };
}

/** Structured-equality check for the small, plain-JSON item snapshots
 * history stores (an effect, a reminder). Good enough for these shapes;
 * mirrors the codebase's existing JSON-based clone fallback. */
export function sameSnapshot(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compares only the named fields between `before`/`after`, returning
 * from/to snapshots restricted to the fields that actually changed, or
 * null when none did. Lets one semantic command that touches several
 * fields at once (e.g. reviving a player also resets their ghost vote)
 * produce exactly one history record covering everything it genuinely
 * changed -- never one record per field, and never a record for a field
 * that happened to be listed but didn't actually change.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: readonly (keyof T & string)[]
): { from: Record<string, unknown>; to: Record<string, unknown> } | null {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  let changed = false;
  for (const key of keys) {
    if (!Object.is(before[key], after[key])) {
      changed = true;
      from[key] = before[key];
      to[key] = after[key];
    }
  }
  return changed ? { from, to } : null;
}

/** Derives Provenance from a structured effect/reminder's own optional
 * source fields -- never invents one when nothing is known, and mirrors
 * whatever the live item itself already carries rather than duplicating
 * a second, independently-maintained source of truth. */
export function provenanceOf(
  item: Pick<EffectRecord | ReminderRecord, "sourceCharacter" | "sourcePlayer" | "note">
): Provenance | undefined {
  if (!item.sourceCharacter && !item.sourcePlayer && !item.note) return undefined;
  return {
    ...(item.sourceCharacter ? { sourceCharacter: item.sourceCharacter } : {}),
    ...(item.sourcePlayer ? { sourcePlayer: item.sourcePlayer } : {}),
    ...(item.note ? { note: item.note } : {}),
  };
}
