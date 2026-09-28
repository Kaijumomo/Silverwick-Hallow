/**
 * Phase 10B test helper: exactly what the v19 -> v20 migration step does to
 * one legacy game-shaped entry (see migrateEntryV19ToV20 in
 * src/stores/gameMigration.ts), so legacy-migration tests can state their
 * expected CURRENT result truthfully:
 *
 *  - every Current State Effect gains `state: "active"` and an `expiry` of
 *    `none` (manual lifetime) or `unresolved` (any finite lifetime);
 *  - the entry is stamped `gameSchemaVersion: 20`;
 *  - History (including old Effect snapshots) is untouched.
 *
 * Returns a deep copy; never mutates its input.
 */
export function withV20Lifecycle<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  const players = copy.players as Record<string, { effects?: Record<string, unknown>[] }> | undefined;
  for (const player of Object.values(players ?? {})) {
    for (const effect of player.effects ?? []) {
      if (effect.state === undefined) effect.state = "active";
      if (effect.expiry === undefined) {
        effect.expiry = (effect.lifetime as { kind?: string } | undefined)?.kind === "manual"
          ? { kind: "none" } : { kind: "unresolved" };
      }
    }
  }
  copy.gameSchemaVersion = 20;
  return copy as unknown as T;
}

/**
 * Phase 10C test helper: exactly what the v20 -> v21 migration step does to
 * one v20 game-shaped entry (see migrateEntryV20ToV21 in
 * src/stores/gameMigration.ts):
 *
 *  - Reminders on an EMPTY seat are dropped;
 *  - every other Reminder loses its `lifetime`; a finite one gains
 *    `cleanupCue: { kind: "unresolved" }`, a manual one no cue;
 *  - the entry is stamped `gameSchemaVersion: 21`;
 *  - History (including old Reminder snapshots) is untouched.
 *
 * (Omission of a temporally incoherent legacy createdAt is covered by the
 * dedicated migration tests, not modelled here.) Returns a deep copy.
 */
export function withV21Reminders<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  const players = copy.players as Record<string, { isEmpty?: boolean; reminders?: Record<string, unknown>[] }> | undefined;
  for (const player of Object.values(players ?? {})) {
    if (!player.reminders) continue;
    if (player.isEmpty === true) { player.reminders = []; continue; }
    for (const reminder of player.reminders) {
      const lifetime = reminder.lifetime as { kind?: string } | undefined;
      if (!lifetime) continue;
      delete reminder.lifetime;
      if (lifetime.kind !== "manual") reminder.cleanupCue = { kind: "unresolved" };
    }
  }
  copy.gameSchemaVersion = 21;
  return copy as unknown as T;
}

/**
 * Phase 10D test helper: exactly what the v21 -> v22 migration step does to
 * one v21 game-shaped entry (see migrateEntryV21ToV22 in
 * src/stores/gameMigration.ts): a STAMP ONLY -- `gameSchemaVersion: 22`. No
 * Role is inferred, no History is rewritten, no perception is repaired.
 * Returns a deep copy.
 */
export function withV22Roles<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  copy.gameSchemaVersion = 22;
  return copy as unknown as T;
}

/** A legacy (pre-v20) entry's expected CURRENT result: the v19 -> v20 step,
 * then v20 -> v21, then v21 -> v22. */
export function withCurrentMigration<T>(entry: T): T {
  return withV22Roles(withV21Reminders(withV20Lifecycle(entry)));
}

/**
 * Phase 10D: the inverse used to build a v21 fixture from a current game --
 * what a v21 writer stored: no Role correction and no correlated Role record
 * (v22-only History metadata), marker 21. Every other v22 datum is
 * indistinguishable from v21 by design (v22 is a stamp).
 */
export function asV21<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  const history = copy.history as Record<string, unknown>[] | undefined;
  if (history) {
    copy.history = history.filter((record) =>
      !(record.category === "role" && (record.correction !== undefined || record.resolutionId !== undefined)));
  }
  copy.gameSchemaVersion = 21;
  return copy as unknown as T;
}

/**
 * Phase 10C: the inverse used to build a v20 fixture from a current game --
 * what a v20 writer stored: every Reminder carries a `lifetime` (manual, or a
 * finite one where a cleanup cue was set) and no cleanup cue; Reminder
 * History has no v21 operation metadata (a v20 writer only recorded
 * add/remove, each snapshot carrying its lifetime); marker 20.
 */
export function asV20<T>(entry: T): T {
  const copy = structuredClone(asV21(entry)) as unknown as Record<string, unknown>;
  const players = copy.players as Record<string, { reminders?: Record<string, unknown>[] }> | undefined;
  for (const player of Object.values(players ?? {})) {
    for (const reminder of player.reminders ?? []) {
      reminder.lifetime = reminder.cleanupCue ? { kind: "untilDawn" } : { kind: "manual" };
      delete reminder.cleanupCue;
    }
  }
  const history = copy.history as Record<string, unknown>[] | undefined;
  if (history) {
    copy.history = history.filter((record) => {
      if (record.category !== "reminder" || record.reminderOperation === undefined) return true;
      const change = record.change as { kind?: string; item?: Record<string, unknown> } | undefined;
      if (change?.kind === "value" || record.correction !== undefined) return false;
      delete record.reminderOperation;
      delete record.resolutionId;
      if (change?.item) {
        change.item.lifetime = change.item.cleanupCue ? { kind: "untilDawn" } : { kind: "manual" };
        delete change.item.cleanupCue;
      }
      return true;
    });
  }
  copy.gameSchemaVersion = 20;
  return copy as unknown as T;
}

/** The inverse used to build a pre-v20 fixture from a current game: strips
 * the v21 Reminder shape (asV20), the Effect lifecycle and the version
 * marker (what a v19 writer stored). */
export function asV19<T>(entry: T): T {
  const copy = asV20(entry) as unknown as Record<string, unknown>;
  delete copy.gameSchemaVersion;
  const players = copy.players as Record<string, { effects?: Record<string, unknown>[] }> | undefined;
  for (const player of Object.values(players ?? {})) {
    for (const effect of player.effects ?? []) {
      delete effect.state;
      delete effect.expiry;
      delete effect.parameters;
    }
  }
  // A v19 writer only ever recorded Effect add/remove (never a value
  // change, correction or lifecycle metadata), with snapshots of v19-shaped
  // Effects.
  const history = copy.history as Record<string, unknown>[] | undefined;
  if (history) {
    copy.history = history.filter((record) => {
      if (record.category !== "effect") return true;
      const change = record.change as { kind?: string; item?: Record<string, unknown> } | undefined;
      if (change?.kind === "value" || record.correction !== undefined) return false;
      delete record.effectOperation;
      delete record.resolutionId;
      if (change?.item) {
        delete change.item.state;
        delete change.item.expiry;
        delete change.item.parameters;
      }
      return true;
    });
  }
  return copy as unknown as T;
}
