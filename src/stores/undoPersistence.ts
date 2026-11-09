import { sameSnapshot } from "./history";
import type { StorytellerLobbyRecord } from "./types";

/**
 * Compact browser persistence of Undo snapshots (streamlining review F-01).
 *
 * Every Undo snapshot is a complete game, and History only ever grows, so the
 * History of an older snapshot is almost always exactly the first N records of
 * the History of the game it is saved beside. Saving those records again for
 * each of the 20 snapshots made the saved state about twenty times the size of
 * the game, and a long game ran out of browser storage.
 *
 * Only the SAVED form changes. In memory every snapshot stays a complete game,
 * so Undo, its limit, its validation and its restore are unchanged:
 *  - compactUndoStack (persist): a snapshot whose History is proven equal,
 *    record by record, to the first N records of its base game's History is
 *    saved with `history: { sharedHistoryPrefix: N }`. Any snapshot that cannot
 *    be proven so is saved in full, exactly as before.
 *  - expandUndoStack (load): the marker is replaced by a copy of the base
 *    game's first N records BEFORE migration and schema validation, so a
 *    restored snapshot is the complete game that was saved. A marker that
 *    does not fit its base is left in place and fails validation like any
 *    other corrupt snapshot.
 * The bases are never compacted: `game` for the Undo stack and the recovery
 * envelope's `live` game for its Undo stack.
 *
 * The compact stack is saved under SHARED_UNDO_KEY, never `undoStack`. A build
 * from before this change ignores that key, so it keeps the saved game and
 * simply has no Undo; it can never misread a marker or reset the save.
 */
export const SHARED_HISTORY_PREFIX = "sharedHistoryPrefix";
/** The saved key of the compact Undo stack. */
export const SHARED_UNDO_KEY = "undoStackShared";

type HistoryRecords = StorytellerLobbyRecord["history"];

/** Snapshot record -> base record already proven equal (records are never
 * edited in place, so a proven pair stays equal; a new record is re-proven). */
const proven = new WeakMap<object, object>();

function sharedPrefixLength(history: HistoryRecords, base: HistoryRecords): number | null {
  if (!Array.isArray(history) || !Array.isArray(base) || history.length > base.length) return null;
  for (let index = 0; index < history.length; index++) {
    const record = history[index] as unknown, baseRecord = base[index] as unknown;
    if (record === baseRecord) continue;
    if (!record || typeof record !== "object" || !baseRecord || typeof baseRecord !== "object") return null;
    if (proven.get(record) === baseRecord) continue;
    if (!sameSnapshot(record, baseRecord)) return null;
    proven.set(record, baseRecord);
  }
  return history.length;
}

/** The saved form of an Undo stack beside its base game. Never mutates its input. */
export function compactUndoStack(stack: readonly StorytellerLobbyRecord[], base: StorytellerLobbyRecord | null | undefined): unknown[] {
  if (!base || !Array.isArray(stack)) return stack as unknown[];
  return stack.map((snapshot) => {
    const shared = snapshot && typeof snapshot === "object" ? sharedPrefixLength(snapshot.history, base.history) : null;
    return shared === null ? snapshot : { ...snapshot, history: { [SHARED_HISTORY_PREFIX]: shared } };
  });
}

function sharedMarker(history: unknown): number | null {
  if (!history || typeof history !== "object" || Array.isArray(history)) return null;
  const keys = Object.keys(history);
  if (keys.length !== 1 || keys[0] !== SHARED_HISTORY_PREFIX) return null;
  const value = (history as Record<string, unknown>)[SHARED_HISTORY_PREFIX];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The loaded form of a saved Undo stack: every valid marker is replaced by an
 * independent copy of the base's first N History records. Anything else is
 * returned unchanged for the existing migration and validation to judge. */
export function expandUndoStack(stack: unknown, base: unknown): unknown {
  if (!Array.isArray(stack)) return stack;
  const baseHistory = base && typeof base === "object" && !Array.isArray(base) ? (base as { history?: unknown }).history : undefined;
  return stack.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const shared = sharedMarker((entry as { history?: unknown }).history);
    if (shared === null || !Array.isArray(baseHistory) || shared > baseHistory.length) return entry;
    return { ...entry, history: JSON.parse(JSON.stringify(baseHistory.slice(0, shared))) };
  });
}
