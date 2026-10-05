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

/**
 * Phase 10E test helper: exactly what the v22 -> v23 migration step does to
 * one v22 game-shaped entry (see migrateEntryV22ToV23 in
 * src/stores/gameMigration.ts): every TRAVELER carrying `shownAlignment` good
 * or evil is normalized to `null`; nothing else changes (ordinary
 * participants, Actual Alignment, History untouched); stamped
 * `gameSchemaVersion: 23`. Returns a deep copy.
 */
export function withV23Alignment<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  const players = copy.players as Record<string, { isTraveler?: boolean; shownAlignment?: unknown }> | undefined;
  for (const player of Object.values(players ?? {})) {
    if (player.isTraveler === true && (player.shownAlignment === "good" || player.shownAlignment === "evil")) player.shownAlignment = null;
  }
  copy.gameSchemaVersion = 23;
  return copy as unknown as T;
}

/**
 * Phase 10F test helper: exactly what the v23 -> v24 migration step does to
 * one v23 game-shaped entry (see migrateEntryV23ToV24 in
 * src/stores/gameMigration.ts): every participant-scoped Night-progress key
 * (`p:`, `travelerArrival:`, `lunaticInfo:`, ... -- seat-addressed in v23) is
 * DROPPED, never re-keyed; global and `manual:*` steps are kept; Information
 * Delivery, History and Current State are untouched; stamped
 * `gameSchemaVersion: 24`. Returns a deep copy.
 */
export function withV24Guided<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  const progress = copy.nightProgress as Record<string, unknown> | undefined;
  if (progress && typeof progress === "object") {
    copy.nightProgress = Object.fromEntries(Object.entries(progress).filter(([key]) => {
      const stepKey = key.slice(key.indexOf(":") + 1);
      return !/^(p|travelerArrival|lunaticInfo|lunaticTargets|admin|missingOrder|invalid|orderConflict):/.test(stepKey);
    }));
  }
  copy.gameSchemaVersion = 24;
  return copy as unknown as T;
}

/**
 * Phase 10G test helper: exactly what the v24 -> v25 migration step does to
 * one v24 game-shaped entry (see migrateEntryV24ToV25 in
 * src/stores/gameMigration.ts): an EMPTY `gameRuleFacts` collection is added
 * (no fact is invented); History, every structured Information Delivery and
 * all Current State are untouched; stamped `gameSchemaVersion: 25`. Returns a
 * deep copy.
 */
export function withV25RuleFacts<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  if (copy.gameRuleFacts === undefined) copy.gameRuleFacts = [];
  copy.gameSchemaVersion = 25;
  return copy as unknown as T;
}

/**
 * Phase 10H test helper: exactly what the v25 -> v26 migration step does to
 * one v25 game-shaped entry (see migrateEntryV25ToV26 in
 * src/stores/gameMigration.ts): a stamp -- no reveal token and no Game Result
 * is invented. Returns a deep copy.
 */
export function withV26Stamp<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  copy.gameSchemaVersion = 26;
  return copy as unknown as T;
}

/** A v24 entry's expected CURRENT result: v24 -> v25, then v25 -> v26. */
export function withV25ToCurrent<T>(entry: T): T {
  return withV26Stamp(withV25RuleFacts(entry));
}

/** A v23-step result's expected CURRENT result: v23 -> v24, then v24 -> v25
 * and v25 -> v26. */
export function withV24ToCurrent<T>(entry: T): T {
  return withV25ToCurrent(withV24Guided(entry));
}

/** A legacy (pre-v20) entry's expected CURRENT result: the v19 -> v20 step,
 * then v20 -> v21, v21 -> v22, v22 -> v23, v23 -> v24, v24 -> v25 and
 * v25 -> v26. */
export function withCurrentMigration<T>(entry: T): T {
  return withV25ToCurrent(withV24Guided(withV23Alignment(withV22Roles(withV21Reminders(withV20Lifecycle(entry))))));
}

/**
 * Phase 10H: the inverse used to build a v25 fixture from a current game --
 * what a v25 writer stored: no reveal tokens and no Game Result (both
 * v26-only), marker 25.
 */
export function asV25<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
  delete copy.result;
  for (const player of Object.values((copy.players ?? {}) as Record<string, Record<string, unknown>>)) delete player.revealToken;
  copy.gameSchemaVersion = 25;
  return copy as unknown as T;
}

/**
 * Phase 10G: the inverse used to build a v24 fixture from a current game --
 * what a v24 writer stored: no `gameRuleFacts` collection, no game-scoped
 * (`gameRuleFact`) History and no Manual Information Delivery (all v25-only),
 * marker 24.
 */
export function asV24<T>(entry: T): T {
  const copy = structuredClone(asV25(entry)) as unknown as Record<string, unknown>;
  delete copy.gameRuleFacts;
  const history = copy.history as Record<string, unknown>[] | undefined;
  if (history) copy.history = history.filter((record) => record.category !== "gameRuleFact");
  const deliveries = copy.informationDeliveries as Record<string, unknown>[] | undefined;
  if (deliveries) copy.informationDeliveries = deliveries.filter((delivery) => delivery.kind === undefined);
  copy.gameSchemaVersion = 24;
  return copy as unknown as T;
}

/**
 * Phase 10F: the inverse used to build a v23 fixture from a current game --
 * what a v23 writer stored: no Information Delivery `performedRole` /
 * `resolutionId` (v24-only), marker 23. (A v24 participant-keyed Night step is
 * structurally indistinguishable from a v23 seat-keyed one; tests that need a
 * genuine v23 seat key build it explicitly.) Phase 10G: built on asV24.
 */
export function asV23<T>(entry: T): T {
  const copy = structuredClone(asV24(entry)) as unknown as Record<string, unknown>;
  const deliveries = copy.informationDeliveries as Record<string, unknown>[] | undefined;
  for (const delivery of deliveries ?? []) {
    delete delivery.performedRole;
    delete delivery.resolutionId;
  }
  copy.gameSchemaVersion = 23;
  return copy as unknown as T;
}

/**
 * Phase 10E: the inverse used to build a v22 fixture from a current game --
 * what a v22 writer stored: no Alignment correction and no correlated
 * Alignment record (v23-only History metadata), no `undisclosed` perception
 * (stored as Normal instead), marker 22.
 */
export function asV22<T>(entry: T): T {
  const copy = structuredClone(asV23(entry)) as unknown as Record<string, unknown>;
  const history = copy.history as Record<string, unknown>[] | undefined;
  if (history) {
    copy.history = history.filter((record) =>
      !(record.category === "alignment" && (record.correction !== undefined || record.resolutionId !== undefined)));
  }
  const players = copy.players as Record<string, { shownAlignment?: unknown }> | undefined;
  for (const player of Object.values(players ?? {})) {
    if (player.shownAlignment === "undisclosed") player.shownAlignment = null;
  }
  copy.gameSchemaVersion = 22;
  return copy as unknown as T;
}

/**
 * Phase 10D: the inverse used to build a v21 fixture from a current game --
 * what a v21 writer stored: no Role correction and no correlated Role record
 * (v22-only History metadata), marker 21. Every other v22 datum is
 * indistinguishable from v21 by design (v22 is a stamp).
 */
export function asV21<T>(entry: T): T {
  const copy = structuredClone(asV22(entry)) as unknown as Record<string, unknown>;
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
