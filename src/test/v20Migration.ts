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

/** The inverse used to build a pre-v20 fixture from a current game: strips
 * the Effect lifecycle and the version marker (what a v19 writer stored). */
export function asV19<T>(entry: T): T {
  const copy = structuredClone(entry) as unknown as Record<string, unknown>;
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
