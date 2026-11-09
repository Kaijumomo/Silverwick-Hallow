import { StorytellerStateSchema, type SeatSwapUndo } from "./schemas";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import { expandUndoStack, SHARED_UNDO_KEY } from "./undoPersistence";
import { publicTravelerRole } from "./travelers";
import type {
  PlayerId,
  Script,
  STPlayerRecord,
  StorytellerLobbyRecord,
  TokenPosition,
} from "./types";

/**
 * Loading a saved Storyteller state (streamlining review F-05: moved out of storytellerStore.ts unchanged).
 * migrateStoreState upgrades every older save shape to the current one and validates it; a save that cannot be
 * trusted resets to a clean state and raises the one-shot migration-reset flag the app shows a banner for.
 */
let _migrationResetFlag = false;

/** Returns true (once) when migrate() discarded incompatible persisted state. */
export function takeMigrationResetFlag(): boolean {
  const v = _migrationResetFlag;
  _migrationResetFlag = false;
  return v;
}

/** Only explicit, correctly bound local swap metadata can restore coordinates.
 * An ordinary two-seat reorder is not evidence that coordinates were swapped. */
export const seatSwapLayout = (
  entry: SeatSwapUndo[number] | undefined,
  previous: StorytellerLobbyRecord,
): Record<PlayerId, TokenPosition> | undefined => {
  if (!entry || entry[0].playerId === entry[1].playerId) return;
  for (const saved of entry) {
    const player = Object.hasOwn(previous.players, saved.playerId) ? previous.players[saved.playerId] : undefined;
    if (!player || player.isEmpty || player.participantId !== saved.participantId || player.seat !== saved.seat ||
      previous.seatOrder[saved.seat] !== saved.playerId || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return;
  }
  return Object.fromEntries(entry.map(({ playerId, x, y }) => [playerId, { x, y }]));
};

const CLEAN_STATE = { game: null, view: "home" as const, undoStack: [] as never[], customScripts: {}, lobby: null };

/** Phase 9R.1 Astra remediation (Finding M2): `undoStack` is untrusted
 * persisted-state data -- it may be genuinely absent (`undefined`), a
 * valid array, or a malformed PRESENT non-array value (e.g. `{}`, a
 * string, a number). Every migration step below that maps or spreads
 * `s.undoStack` previously assumed any truthy value was already an array;
 * `s.undoStack.map(...)` throws "is not a function" and a bare
 * `[...s.undoStack]` throws "is not iterable" for a malformed non-array
 * value instead of failing safely (`??` alone only substitutes for
 * `null`/`undefined`, never for a truthy non-array). A malformed
 * undoStack must never be silently normalized into `[]` here -- every
 * site below leaves it completely untouched when this guard fails, so the
 * final StorytellerStateSchema validation gate (which requires undoStack
 * to be an array or absent -- schemas.ts's
 * `z.array(StorytellerGamePersistedSchema).optional()`) rejects it and
 * triggers the existing reset path below, exactly the established
 * absent-vs-malformed distinction already applied to remote checkpoint
 * migration (see gameMigration.ts's own Finding A3 doc comment). */
function isMigratableUndoStack(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function migrateStoreState(state: unknown, fromVersion: number): unknown {
  const s = state as { game?: Record<string, unknown>; undoStack?: unknown; lobby?: unknown; finishedGameUndo?: unknown; [SHARED_UNDO_KEY]?: unknown };
  // F-01: Undo snapshots are saved with their History shared with their base
  // game (undoPersistence.ts). Restore the complete snapshots first, so every
  // step below sees exactly the games that were saved.
  if (s && typeof s === "object") {
    // A save holds one of the two keys; a full `undoStack` (an older writer) is never overridden.
    if (SHARED_UNDO_KEY in s) {
      if (!("undoStack" in s)) s.undoStack = expandUndoStack(s[SHARED_UNDO_KEY], s.game);
      delete s[SHARED_UNDO_KEY];
    }
    const recovery = s.finishedGameUndo;
    if (recovery && typeof recovery === "object" && !Array.isArray(recovery) && "undoStack" in recovery) {
      const envelope = recovery as { undoStack?: unknown; live?: unknown };
      s.finishedGameUndo = { ...envelope, undoStack: expandUndoStack(envelope.undoStack, envelope.live) };
    }
  }
  // Phase 10C (ASTRA-10C-003): per-entry routing BEFORE any old step. A
  // game-shaped entry's OWN version/evidence -- not the outer persisted
  // envelope's -- decides which game-content migrations may touch it. Each
  // entry (Current State and every Undo snapshot, independently) is
  // classified once, from its untouched content, by the one canonical
  // detector (detectLegacyGameVersion: explicit marker first, then v21/v20/
  // v19/v17 evidence, then bounded structure). A game-content step targeting
  // version N runs on an entry only when BOTH the envelope and the entry
  // itself are older than N, so an old envelope can never "repair" a marked
  // current game (e.g. default a malformed `fabled: null`) or delete its
  // evidence (e.g. `startingNonTravelerCount`) before the entry's own marker
  // is honoured. A shape too old to detect keeps the envelope's version, so
  // genuine legacy saves migrate exactly as before. Envelope-only metadata
  // (lobby, localSeq/sync) is still migrated by the envelope version.
  const undoEntries: unknown[] = isMigratableUndoStack(s.undoStack) ? s.undoStack : [];
  const entryVersion = new Map<object, number>();
  for (const entry of [s.game, ...undoEntries]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const detected = detectLegacyGameVersion(entry as Record<string, unknown>);
    entryVersion.set(entry, detected === null ? fromVersion : Math.max(fromVersion, detected));
  }
  const olderThan = (entry: unknown, version: number): entry is Record<string, unknown> =>
    !!entry && typeof entry === "object" && (entryVersion.get(entry) ?? Number.POSITIVE_INFINITY) < version;
  /** The game entry, when it is itself older than `version`. */
  const gameOlderThan = (version: number) => (olderThan(s.game, version) ? s.game : undefined);
  /** Every Undo entry that is itself older than `version`. */
  const undoOlderThan = (version: number) => undoEntries.filter((entry) => olderThan(entry, version)) as Record<string, unknown>[];

  if (fromVersion < 2) {
    const game = gameOlderThan(2);
    if (game && !game.nightProgress) game.nightProgress = {};
    for (const e of undoOlderThan(2)) {
      if (!e.nightProgress) e.nightProgress = {};
    }
  }
  if (fromVersion < 3) {
    const game = gameOlderThan(3);
    if (game) {
      if (!game.fabled) game.fabled = [];
      if (!game.bluffs) game.bluffs = [];
    }
    for (const e of undoOlderThan(3)) {
      if (!e.fabled) e.fabled = [];
      if (!e.bluffs) e.bluffs = [];
    }
  }
  if (fromVersion < 4) {
    const game = gameOlderThan(4);
    if (game && !game.lorics) game.lorics = [];
    for (const e of undoOlderThan(4)) {
      if (!e.lorics) e.lorics = [];
    }
  }
  if (fromVersion < 5) {
    const game = gameOlderThan(5);
    if (game) {
      if (!game.rolePool) game.rolePool = [];
      if (game.plannedPlayerCount === undefined) game.plannedPlayerCount = 0;
    }
    for (const e of undoOlderThan(5)) {
      if (!e.rolePool) e.rolePool = [];
      if (e.plannedPlayerCount === undefined) e.plannedPlayerCount = 0;
    }
  }
  // v6: grimoireMode and tokenPositions added — both are top-level optional
  // fields with Zod defaults, so no data migration is needed; old persisted
  // states pass validation and receive undefined → initial state provides "ring"/{}.

  if (fromVersion < 7) {
    const game = gameOlderThan(7);
    if (game) {
      if (!game.pendingPlayers) game.pendingPlayers = {};
      const players = game.players as Record<string, Record<string, unknown>> | undefined;
      if (players) {
        for (const p of Object.values(players)) {
          if (p.isEmpty === undefined) p.isEmpty = false;
        }
      }
    }
    for (const e of undoOlderThan(7)) {
      if (!e.pendingPlayers) e.pendingPlayers = {};
    }
  }

  if (fromVersion < 8 && s?.lobby) {
    // Envelope (lobby) + game content (Undo dropped, game code/uid reset).
    // ASTRA-10C-003: this step cannot run without altering or discarding
    // game entries, so if any entry is itself v8 or newer the envelope is an
    // impossible hybrid -- fail closed rather than rewrite current state.
    const entries = [s.game, ...undoEntries].filter((entry) => !!entry && typeof entry === "object");
    if (entries.some((entry) => !olderThan(entry, 8))) {
      // eslint-disable-next-line no-console
      console.warn("[migrate] a pre-v8 envelope holds a newer game entry; resetting rather than rewriting it");
      _migrationResetFlag = true;
      return CLEAN_STATE;
    }
    s.lobby = null;
    s.undoStack = [];
    if (s.game) { s.game.code = ""; s.game.storytellerUid = "local"; }
  }
  // v10 adds an optional starting population. Earlier snapshots cannot prove
  // this history; never derive it from their current attendance or roles.
  if (fromVersion < 10) {
    for (const entry of [gameOlderThan(10), ...undoOlderThan(10)]) {
      if (entry) delete entry.startingNonTravelerCount;
    }
  }
  // v11 introduces optional current Traveler facts. Leave legacy alignment,
  // completion and exile unknown. Public character can be recovered from truth.
  if (fromVersion < 11) {
    for (const entry of [gameOlderThan(11), ...undoOlderThan(11)]) {
      const players = (entry as { players?: Record<string, STPlayerRecord> } | undefined)?.players;
      for (const p of Object.values(players ?? {})) {
        if (p.isTraveler) p.publicDisplayRole = publicTravelerRole(p)?.id ?? null;
      }
    }
  }
  // v12 (Phase 9C.2A, OPUS-001) introduces localSeq/sync reconnect
  // watermarks. A legacy v11 store never tracked them: initialize localSeq
  // safely at 0 and leave sync null. Never invent acknowledgement evidence
  // from a legacy game's prior content, timestamps, or size — a valid
  // remote checkpoint outranks unevidenced legacy local state (see
  // reconnectDecision's "no sync metadata" rule). Envelope-only.
  if (fromVersion < 12) {
    const withSync = s as { localSeq?: number; sync?: unknown };
    withSync.localSeq = 0;
    withSync.sync = null;
  }
  // v13 (Phase 9 Setup finalization B4) introduces plannedTravelerCount, the
  // intended Traveler count out of plannedPlayerCount. A legacy game never
  // planned any Travelers explicitly -- default to 0, mirroring
  // plannedPlayerCount's own v5 migration default.
  if (fromVersion < 13) {
    for (const entry of [gameOlderThan(13), ...undoOlderThan(13)]) {
      if (entry && entry.plannedTravelerCount === undefined) entry.plannedTravelerCount = 0;
    }
  }
  // v14 (Phase 9D.1) -> v16 (Phase 9D.3): the structured Current State
  // (Actual Alignment, Effects, Reminders), History, and Information
  // Delivery evolution. Phase 9R.1 (Finding B1) extracted the actual
  // per-entry transformation into migrateGameEntry (gameMigration.ts) so
  // remote checkpoint recovery (readCheckpoint in storytellerSync.ts) can
  // apply the exact same rules to a bare remote game -- never a second,
  // divergent copy of them. See that function's own doc comment for what
  // each version step does and does not invent.
  //
  // v17 (Phase 9R.2): historical participant identity -- the same shared
  // per-entry migration, applied identically to Current State and every
  // Undo snapshot (deterministic legacy-current ParticipantIds, never
  // random; every v16 historical PlayerId reference becomes an unresolved
  // legacy ParticipantRef, never the current occupant's identity).
  //
  // v18 (terminology audit): the History category for an Actual Role change
  // is renamed from "identity" to "role" -- the same shared per-entry
  // migration, so Current State and every Undo snapshot canonicalize
  // identically. Only that one category value changes. A store already
  // labeled v18 never reaches this block (fromVersion is not < 18), so a
  // stale "identity" in it fails the schema gate below and resets rather
  // than being treated as v17 data.
  //
  // v19 (Phase 10A): the Life Event Window -- the same shared per-entry
  // migration adds it to Current State and to every Undo snapshot, each with
  // coverage from ITS OWN phase (never backfilled from History). A store
  // already labeled v19 never reaches this block, so a v19 game missing or
  // carrying a malformed window fails the schema gate below and resets
  // rather than being treated as v18 data. Within this block, any entry that
  // already carries v19 evidence is likewise left for the gate to judge.
  //
  // v20 (Phase 10B): the authoritative Effect lifecycle and explicit game
  // schema version evidence -- the same shared per-entry migration, applied
  // identically to Current State and every Undo snapshot (never consulting
  // History). An entry that already carries v20 evidence is left for the
  // schema gate below to judge, never "repaired".
  //
  // v21 (Phase 10C): non-authoritative Reminder notation -- the same shared
  // per-entry migration. An entry marked 20 receives v20 -> v21.
  //
  // v22 (Phase 10D): authoritative Role transitions -- the same shared
  // per-entry migration, a stamp on top of v21.
  //
  // v23 (Phase 10E): Alignment transitions -- the same shared per-entry
  // migration: a Traveler's inert explicit Shown Alignment is normalized to
  // Normal (null). Routing is per entry (Current State and every Undo snapshot
  // independently, exactly like remote checkpoint recovery): marker 20 -> v20
  // -> v21 -> v22 -> v23; marker 21 -> v21 -> v22 -> v23; marker 22 -> v22 ->
  // v23; marker 23 -> nothing; an older marker carrying newer evidence, a
  // marker-less entry carrying v20+ evidence, or any malformed marker receives
  // nothing and is rejected by the schema gate below. A marker-less genuine
  // legacy entry runs the whole chain through v23.
  //
  // v24 (Phase 10F): guided ability resolution -- the same shared per-entry
  // migration: marker 23 -> v24 drops ambiguous seat-addressed participant
  // Night progress (never re-keyed onto the current occupant) and stamps 24;
  // Information Delivery is preserved exactly (no performedRole/resolutionId
  // is invented). Every older marker continues the chain through v24; an
  // older marker carrying v24 evidence receives nothing and is rejected.
  //
  // v25 (Phase 10G): game-scoped Rule Facts -- the same shared per-entry
  // migration: marker 24 -> v25 initializes an EMPTY `gameRuleFacts`
  // collection and stamps 25 (no fact, History, delivery or participant state
  // is invented or rewritten). Every older marker continues the chain through
  // v25; an older marker carrying v25 evidence receives nothing and is
  // rejected.
  //
  // v26 (Phase 10H): reveal tokens and the declared Game Result -- the same
  // shared per-entry migration: marker 25 -> v26 is a stamp (no reveal token,
  // Game Result or winner is invented). Every older marker continues the chain
  // through v26; an older marker carrying v26 evidence receives nothing and is
  // rejected.
  if (fromVersion < 29) {
    const customScripts = (s as { customScripts?: Record<string, Script> }).customScripts ?? {};
    // Phase 9R.1 Astra remediation (Finding A2): local persisted migration
    // uses "trusted" evidence -- this state's OWN saved customScripts,
    // genuine evidence of what the game actually used (unlike remote
    // checkpoint recovery, which never has this and uses "canonical-only"
    // -- see readCheckpoint in storytellerSync.ts and MigrationScriptEvidence's
    // own doc comment).
    // ASTRA-10C-003: each entry migrates from its OWN routed version (see
    // above) -- the same answer checkpoint recovery reaches directly.
    const migrateOne = (entry: unknown, snapshot: boolean) => {
      const version = entry && typeof entry === "object" ? entryVersion.get(entry) ?? fromVersion : fromVersion;
      migrateGameEntry(entry, version, { kind: "trusted", customScripts }, { snapshot });
    };
    migrateOne(s.game, false);
    for (const entry of isMigratableUndoStack(s.undoStack) ? s.undoStack : []) migrateOne(entry, true);
    // Package 3 (C7): the finished-game recovery envelope is migrated like the
    // game it was taken from. Its own undo stack holds snapshots (no log).
    const recovery = (s as { finishedGameUndo?: unknown }).finishedGameUndo;
    if (recovery && typeof recovery === "object") {
      const r = recovery as Record<string, unknown>;
      const migrateLoose = (entry: unknown, snapshot: boolean) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
        const detected = detectLegacyGameVersion(entry as Record<string, unknown>);
        migrateGameEntry(entry, detected === null ? fromVersion : Math.max(fromVersion, detected), { kind: "trusted", customScripts }, { snapshot });
      };
      migrateLoose(r.ended, false);
      migrateLoose(r.live, false);
      if (Array.isArray(r.undoStack)) for (const entry of r.undoStack) migrateLoose(entry, true);
    }
  }
  const check = StorytellerStateSchema.safeParse(state);
  if (!check.success) {
    // eslint-disable-next-line no-console
    console.warn("[migrate] persisted state failed validation, resetting:", check.error.flatten());
    _migrationResetFlag = true;
    return CLEAN_STATE;
  }
  // v9 drops obsolete saved previews through the schema allowlist, including
  // undo snapshots. Drafts, sent information and the active session survive.
  Object.assign(s, check.data);
  // Preserve absent metadata in old saves: migration must not change an
  // otherwise current valid save. The store merge supplies the runtime default.
  // Present entries must bind to their corresponding validated snapshot.
  const layoutEntries = check.data.seatSwapUndo;
  if (layoutEntries !== undefined) Object.assign(s, { seatSwapUndo: (check.data.undoStack ?? []).map((snapshot, index) => {
    const entry = layoutEntries[index];
    return seatSwapLayout(entry, snapshot) ? entry : null;
  }) });
  return state;
}
