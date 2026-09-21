import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { buildRegistry, deriveAlignment, type RoleRegistry } from "@/data/roleRegistry";
import type { STPlayerRecord, Script } from "./types";

/**
 * Phase 9R.1 (Finding B1): the single game-shaped-entry migration boundary
 * shared by BOTH the local persisted Zustand store (migrateStoreState in
 * storytellerStore.ts, applied to `game` and every `undoStack` entry) and
 * remote checkpoint recovery (readCheckpoint in storytellerSync.ts,
 * applied to the checkpoint's own embedded `game`). Extracted here so the
 * v13->v14->v15->v16 structured-state evolution is expressed exactly once
 * -- never two divergent copies of the same rules -- while each caller
 * keeps deciding for itself what "the state to migrate" even is (the
 * whole persisted Zustand blob vs. a bare remote game/roster pair).
 *
 * Deliberately narrow: this only ever mutates ONE game-shaped object, and
 * only ever performs the exact v13/v14/v15/v16 transitions Phase 9
 * intentionally supports. It never touches store-level concerns (lobby,
 * sync/localSeq, customScripts storage, undo-stack membership) -- those
 * remain migrateStoreState's own responsibility, and remote checkpoints
 * never carried them to begin with (see readCheckpoint's own doc comment
 * for why the checkpoint shape stays { game, roster } only).
 */
/**
 * Phase 9R.1 Astra remediation (Finding A2): explicit, reviewable evidence
 * policy for resolving a legacy game's script/Role data during migration.
 *
 * "trusted" -- used ONLY by local persisted-state migration
 * (migrateStoreState). The persisted Zustand blob carries its own
 * `customScripts`, saved alongside that exact state -- the SAME device's
 * own prior definition, genuine evidence of what the game actually used.
 *
 * "canonical-only" -- used ONLY by remote checkpoint recovery
 * (readCheckpoint). A remote checkpoint carries no durable script/Role
 * data of its own (see readCheckpoint's own doc comment), so the
 * RECOVERING device's current, unrelated custom/homebrew scripts must
 * never stand in for it: a script id that happens to collide with a
 * DIFFERENT local homebrew definition (same id, different Role
 * type/alignment) would let migration derive an Actual Alignment the
 * checkpoint itself never proved -- fabrication. Only built-in scripts
 * (objectively identifiable, never locally redefined) may still resolve;
 * every other script id resolves to an empty registry, so an ordinary
 * player's Role never being found leaves their alignment unresolved
 * exactly like an already-unresolved Traveler.
 */
export type MigrationScriptEvidence =
  | { kind: "trusted"; customScripts: Record<string, Script> }
  | { kind: "canonical-only" };

function registryForScript(scriptId: string | undefined, evidence: MigrationScriptEvidence): RoleRegistry {
  const id = scriptId ?? "";
  const custom = evidence.kind === "trusted" ? evidence.customScripts[id] : undefined;
  const script = BUILTIN_SCRIPTS[id] ?? custom ?? { id, name: id, characters: [] };
  return buildRegistry(script);
}

/**
 * Migrates one game-shaped entry from `fromVersion` up through v16,
 * in place, mirroring migrateStoreState's own mutate-then-validate style
 * (the caller is responsible for the final schema validation gate). A
 * no-op for `fromVersion >= 16` or a non-object entry.
 *
 * v13 -> v14 (Phase 9D.1): ordinary Actual Alignment is derived only from
 * an assigned, currently-resolvable Role -- never invented, never
 * overwritten, and never touched for a Traveler (whose alignment, once
 * explicitly chosen, is preserved verbatim; unresolved stays unresolved).
 * Legacy Drunk/Poisoned/Protected `statuses` booleans become their own
 * deterministic manual Effect and are cleared, never duplicated on a
 * re-run. Legacy plain-string reminders become structured manual/legacy
 * records with deterministic ids, never randomly generated, so two
 * independent migrations of the same legacy snapshot stay identical.
 * `scriptEvidence` (Finding A2) decides which script/Role data may be
 * trusted for alignment derivation -- see MigrationScriptEvidence.
 *
 * v14 -> v15 (Phase 9D.2) / v15 -> v16 (Phase 9D.3): `history` and
 * `informationDeliveries` are deliberately NOT touched here for the
 * "genuinely absent" case -- StorytellerGamePersistedSchema already
 * declares both `.default([])` (schemas.ts), so the caller's own final
 * schema-validation pass supplies the empty collection for a field that
 * is truly missing, with no event/delivery ever fabricated for existing
 * state. This function must never itself force either collection to `[]`
 * when the field is PRESENT but malformed (Finding A3): doing so would
 * silently conceal corrupt legacy data behind a validly-shaped empty
 * array instead of letting the final schema gate reject it. The one
 * schema-required-with-no-default field this function still helps with
 * is a player's `effects` (STPlayerRecordSchema declares no default for
 * it) -- see the `effects === undefined` guard below, which applies the
 * exact same absent-vs-malformed distinction by hand.
 *
 * Phase 9R.1 Astra remediation (Finding A3): migration transforms a
 * VALID legacy representation -- it does not repair arbitrary malformed
 * data. A field that is genuinely absent may be initialized as the
 * schema intends; a field that is PRESENT but malformed is left
 * completely untouched, so it (and therefore the whole checkpoint/state)
 * fails the final schema-validation gate rather than silently passing.
 * This also guards every player-shaped entry against a value that is not
 * actually an object (null, a string, a number, ...) before touching any
 * of its fields -- a malformed player must make the checkpoint fail
 * through the ordinary invalid-checkpoint outcome, never crash migration
 * with an uncaught runtime exception.
 */
export function migrateGameEntry(
  entry: unknown,
  fromVersion: number,
  scriptEvidence: MigrationScriptEvidence
): void {
  if (!entry || typeof entry !== "object") return;
  const e = entry as {
    scriptId?: string;
    players?: Record<string, unknown>;
  };

  if (fromVersion < 14) {
    const players = e.players;
    if (players && typeof players === "object") {
      const registry = registryForScript(e.scriptId, scriptEvidence);
      for (const raw of Object.values(players)) {
        // Finding A3: a malformed player entry (not an object at all) is
        // left completely untouched -- never migrated, never crashed on.
        // players: z.record(z.string(), STPlayerRecordPersistedSchema)
        // rejects it during final schema validation regardless.
        if (!raw || typeof raw !== "object") continue;
        const p = raw as STPlayerRecord;
        // 1. Actual alignment: derive for an ordinary player with an
        // assigned, still-resolvable role. Never invent one for a
        // Traveler, and never overwrite an alignment already present.
        if (p.actualAlignment === undefined && !p.isTraveler && p.actualRole) {
          const role = registry.get(p.actualRole);
          if (role) p.actualAlignment = deriveAlignment(role);
        }
        // 2. Effects: a genuinely absent `effects` (the v13 shape never
        // had this field) becomes an empty array -- STPlayerRecordSchema
        // declares no default for it, so unlike history/informationDeliveries
        // above, migration itself must supply this one. A PRESENT but
        // malformed `effects` (Finding A3) is left untouched and the
        // status->Effect conversion below is skipped for it entirely
        // (rather than risk calling .some()/.push() on non-array data) --
        // the malformed value still fails final schema validation.
        if (p.effects === undefined) p.effects = [];
        if (Array.isArray(p.effects)) {
          for (const type of ["drunk", "poisoned", "protected"]) {
            // Finding A3: only the LITERAL boolean `true` activates a
            // migrated legacy status. `p.statuses?.[type]` alone was a
            // JavaScript truthiness check -- the malformed string "false"
            // (or any other non-boolean truthy value) is truthy in JS and
            // would have silently become an active Effect. Literal `false`
            // must not activate it, and neither may anything else; a
            // non-boolean status value is simply left in `statuses`,
            // where StatusesSchema's `z.boolean()` requirement rejects it
            // at final validation instead of migration inventing an Effect
            // for it.
            if (p.statuses?.[type] === true) {
              const id = `manual:${type}`;
              if (!p.effects.some((eff) => eff.id === id)) {
                p.effects.push({ id, type, lifetime: { kind: "manual" } });
              }
              delete p.statuses[type];
            }
          }
        }
        // 3. Reminders: a plain string array (every entry still a string)
        // becomes manual/legacy records with no invented source or moment.
        // Already Finding-A3-safe as originally written: a malformed
        // (non-array, or mixed-content) `reminders` simply never matches
        // this condition and is left untouched for final validation to
        // reject -- it is never reset to a default.
        if (Array.isArray(p.reminders) && p.reminders.every((r) => typeof r === "string")) {
          p.reminders = (p.reminders as unknown as string[]).map((label, index) => ({
            id: `legacy-${p.id}-${index}`,
            label,
            lifetime: { kind: "manual" as const },
          }));
        }
      }
    }
  }
}

/**
 * Phase 9R.1 (Finding B1): structurally infers which of the legacy game
 * shapes `migrateGameEntry` supports (v13-v16) a remote checkpoint's raw
 * `game` blob represents. Remote checkpoints never carried an explicit
 * schema version (see readCheckpoint in storytellerSync.ts) -- but v14,
 * v15, and v16 each introduced a field the live app's own runtime type
 * now requires as non-optional (STPlayerRecord.effects,
 * StorytellerLobbyRecord.history, StorytellerLobbyRecord.
 * informationDeliveries, respectively -- see types.ts), so every
 * checkpoint actually WRITTEN by an app version at or above that field's
 * introduction always carries it (writeProjections always checkpoints the
 * live, already-current-shaped in-memory game -- see sync.ts). That makes
 * presence/absence of these exact fields an unambiguous, reliable version
 * signal across exactly this bounded legacy range, without introducing a
 * new persisted checkpoint schema/version marker (narrower, and avoids
 * touching the production write path or Firebase rules at all).
 *
 * Returns null for a shape too old to be within the supported
 * remote-recovery floor (pre-v13, i.e. missing plannedTravelerCount too)
 * -- the caller must fail that checkpoint safely rather than guess a
 * version and risk silently mis-migrating it.
 */
export function detectLegacyGameVersion(game: Record<string, unknown>): number | null {
  if (Array.isArray(game.informationDeliveries)) return 16;
  if (Array.isArray(game.history)) return 15;
  const players =
    game.players && typeof game.players === "object" && !Array.isArray(game.players)
      ? Object.values(game.players as Record<string, unknown>)
      : [];
  const hasStructuredEffects = players.some(
    (p) => p !== null && typeof p === "object" && Array.isArray((p as Record<string, unknown>).effects)
  );
  if (hasStructuredEffects) return 14;
  if (typeof game.plannedTravelerCount === "number") return 13;
  return null;
}
