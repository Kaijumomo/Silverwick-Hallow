import { currentGameMoment } from "./effects";
import { participantRefOf } from "./participants";
import type {
  EffectRecord,
  HistoryCategory,
  HistoryId,
  HistoryRecord,
  PlayerId,
  Provenance,
  ProvenanceInput,
  ReminderRecord,
  StorytellerLobbyRecord,
} from "./types";

const historyId = (): HistoryId =>
  globalThis.crypto?.randomUUID?.() ?? `h-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Phase 9R.1 (Finding B4/B5): the store's ownership boundary for
 * structured command input. Deep-clones a plain-data value so nothing
 * stored afterward still references any part of a caller's own object or
 * array -- a caller mutating what they passed in after the command
 * returns must never silently change Current State, History, Provenance,
 * or Information Delivery. Along the way it also drops every key whose
 * value is explicitly `undefined` (Finding B5): an absent optional field
 * must survive as an absent key, never a literal `undefined` one --
 * Firebase RTDB rejects `undefined` outright, and relying on some OTHER
 * serialization step (JSON.stringify, a projection scrubber) to
 * incidentally strip it would leave the authoritative store itself
 * unsafe to write directly. Real values -- `null`, `0`, `false`, `""` --
 * are never touched.
 *
 * Deliberately scoped to one command's own accepted input -- never used
 * for whole-game snapshots (see storytellerStore's own `clone`, which
 * undo/restore already relies on and which has no reason to strip
 * anything, since state reaching it is already expected to be clean).
 */
export function cloneOwned<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => cloneOwned(v)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = cloneOwned(v);
    }
    return out as T;
  }
  return value;
}

/**
 * The narrowest reusable optional structure an Authoritative Mutation
 * Command can accept alongside its normal arguments, so a caller may
 * supply Provenance through the exact same command that changes Current
 * State -- never a second, separate call. Every field is optional; when a
 * command receives no Mutation Context (or one with no `provenance`), it
 * must not invent any. Deliberately narrow today (Provenance is the only
 * thing a Mutation Context carries) -- this is not a general options bag.
 */
export type MutationContext = {
  /** Phase 9R.2: caller-facing form -- names its source by live PlayerId.
   * Converted to durable Provenance by durableProvenance() before storage;
   * never stored as given. */
  provenance?: ProvenanceInput;
};

/**
 * Phase 9R.2: converts caller-supplied Provenance into its durable, owned
 * stored form. A live `sourcePlayer` becomes `sourceParticipant`, a
 * snapshot of whoever occupies that seat RIGHT NOW (participantRefOf) --
 * never resolved again later. Returns:
 *  - undefined when no Provenance was supplied (none is ever invented);
 *  - null when `sourcePlayer` names no current participant (nonexistent
 *    PlayerId, empty seat, malformed id) -- the caller must refuse the
 *    whole command rather than store a Provenance whose source is
 *    unknowable or silently drop what the Storyteller supplied;
 *  - otherwise the durable Provenance, deep-cloned and undefined-stripped
 *    (Phase 9R.1 Finding B4/B5 ownership boundary).
 */
export function durableProvenance(
  game: Pick<StorytellerLobbyRecord, "players">,
  input: ProvenanceInput | undefined
): Provenance | undefined | null {
  if (!input) return undefined;
  // A caller can never hand in a pre-built snapshot: any
  // `sourceParticipant` smuggled in at runtime is discarded.
  const { sourcePlayer, sourceParticipant: _smuggled, ...rest } =
    cloneOwned(input) as ProvenanceInput & { sourceParticipant?: unknown };
  if (sourcePlayer === undefined) return rest;
  const sourceParticipant = participantRefOf(game, sourcePlayer);
  if (!sourceParticipant) return null;
  return { ...rest, sourceParticipant };
}

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
  /** Live seat address of the affected player. recordIfLive converts it to
   * the durable `participant` snapshot -- a command never builds one. */
  playerId: PlayerId;
  change: HistoryRecord["change"];
  /** Already-durable Provenance -- e.g. mirrored from a stored Effect/
   * Reminder's own `sourceParticipant` (provenanceOf), which must keep
   * naming whoever originally caused it, never be re-resolved. */
  provenance?: Provenance;
  /** Caller-supplied Mutation Context whose live Provenance recordIfLive
   * converts via durableProvenance(). Takes precedence over `provenance`
   * (no command supplies both). */
  context?: MutationContext;
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
 *
 * Phase 9R.2: this is also the single place a History Record's
 * participant identity is captured. `entry.playerId` (a live seat address)
 * is snapshotted into `participant` via participantRefOf() against `game`
 * -- the state the command was issued against, i.e. whoever occupied that
 * seat when the mutation happened -- and any Mutation Context Provenance
 * is converted via durableProvenance(). Returns NULL when the record
 * cannot be made truthfully: the affected seat has no current participant
 * (an empty seat or nonexistent PlayerId during Live Play), or the
 * supplied Provenance names a source that is not a current participant.
 * A caller receiving null must refuse the whole command atomically -- a
 * Live Play mutation is never applied without its History, and History is
 * never recorded against a fabricated or unknowable person. Setup/ended
 * games still pass `updatedGame` straight through (no History is ever
 * recorded there, so there is nothing to resolve).
 */
export function recordIfLive(
  game: StorytellerLobbyRecord,
  updatedGame: StorytellerLobbyRecord,
  build: () => NewHistoryRecord | null
): StorytellerLobbyRecord | null {
  if (!isLiveGamePhase(game.phase)) return updatedGame;
  const entry = build();
  if (!entry) return updatedGame;
  const participant = participantRefOf(game, entry.playerId);
  if (!participant) return null;
  let provenance = entry.provenance;
  if (entry.context?.provenance) {
    const resolved = durableProvenance(game, entry.context.provenance);
    if (resolved === null) return null;
    provenance = resolved;
  }
  const { playerId: _live, context: _context, provenance: _given, ...rest } = entry;
  // Phase 9R.1 (Finding B4): the record (and especially its `provenance`,
  // an object the CALLER supplied through this same command's Mutation
  // Context, and `participant`, which must be an owned snapshot) is
  // deep-cloned here, once, at the single choke point every Authoritative
  // Mutation Command already funnels through -- so a caller mutating their
  // own Provenance/change-item object after the command returns can never
  // reach back into this stored History Record.
  const record: HistoryRecord = cloneOwned({
    id: historyId(),
    moment: currentGameMoment(game),
    ...rest,
    participant,
    ...(provenance ? { provenance } : {}),
  });
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
 * a second, independently-maintained source of truth. Phase 9R.2: the
 * item's `sourceParticipant` is already a durable snapshot (captured when
 * the item was created), so it is carried over as-is -- removing an Effect
 * Alice caused still records Alice as its source even after Bob has since
 * taken her seat. recordIfLive deep-clones it into the History Record. */
export function provenanceOf(
  item: Pick<EffectRecord | ReminderRecord, "sourceCharacter" | "sourceParticipant" | "note">
): Provenance | undefined {
  if (!item.sourceCharacter && !item.sourceParticipant && !item.note) return undefined;
  return {
    ...(item.sourceCharacter ? { sourceCharacter: item.sourceCharacter } : {}),
    ...(item.sourceParticipant ? { sourceParticipant: item.sourceParticipant } : {}),
    ...(item.note ? { note: item.note } : {}),
  };
}
