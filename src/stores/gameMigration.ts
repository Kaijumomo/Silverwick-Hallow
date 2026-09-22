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

/** Own-property-safe lookup -- `obj[key]` alone resolves an inherited
 * Object.prototype member (e.g. key "__proto__"/"constructor"/"toString")
 * instead of correctly finding nothing, and BUILTIN_SCRIPTS/customScripts
 * are plain object maps keyed by untrusted persisted/checkpoint strings
 * (Phase 9R.1 Astra remediation, Finding M1). */
function ownProperty<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function hasStringId(value: unknown): value is { id: string } {
  return value !== null && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

/** Finding M1: a Script candidate (built-in OR persisted custom) is
 * untrusted structurally until checked -- buildRegistry() iterates
 * `.characters` (and `.fabled`, if present) with a bare `for...of` and
 * dereferences each entry's `.id`; a non-array `.characters` throws
 * "is not iterable", and a malformed element throws reading `.id`. This
 * is the minimum shape buildRegistry can safely consume. */
function isUsableScript(value: unknown): value is Script {
  if (!value || typeof value !== "object") return false;
  const { characters, fabled } = value as { characters?: unknown; fabled?: unknown };
  if (!Array.isArray(characters) || !characters.every(hasStringId)) return false;
  if (fabled !== undefined && (!Array.isArray(fabled) || !fabled.every(hasStringId))) return false;
  return true;
}

/** Finding M1: `scriptId` is untrusted persisted/checkpoint data -- it may
 * not even be a string (e.g. a hostile `{ toString: 0 }`), and coercing
 * it via `??` alone (then using it as a property key) can throw
 * "Cannot convert object to primitive value" during the implicit
 * ToPrimitive/ToString conversion. Never resolved except by an actual
 * own-property, structurally-usable Script -- an unresolvable or
 * malformed one leaves alignment derivation unresolved, exactly like an
 * unrecognized script id already does; it never crashes migration. */
function registryForScript(scriptId: unknown, evidence: MigrationScriptEvidence): RoleRegistry {
  const id = typeof scriptId === "string" ? scriptId : "";
  const builtin = ownProperty(BUILTIN_SCRIPTS, id);
  if (isUsableScript(builtin)) return buildRegistry(builtin);
  if (evidence.kind === "trusted") {
    // Finding M1 (A2 follow-up): a persisted custom Script object is
    // itself untrusted data -- never assumed structurally valid before
    // use. An unusable one simply cannot serve as migration evidence.
    const custom = ownProperty(evidence.customScripts, id);
    if (isUsableScript(custom)) return buildRegistry(custom);
  }
  return buildRegistry({ id, name: id, characters: [] });
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
/**
 * Migrates exactly one player entry's v13-shaped fields, in place.
 * Assumes the caller has already confirmed `raw` is a non-null object --
 * everything past that point is still untrusted persisted/checkpoint
 * data, so every dereference below is guarded rather than assumed to
 * match STPlayerRecord's declared shape.
 */
function migratePlayerV13ToV14(raw: object, registry: RoleRegistry): void {
  const p = raw as STPlayerRecord;
  // 1. Actual alignment: derive for an ordinary player with an assigned,
  // still-resolvable role. Never invent one for a Traveler, and never
  // overwrite an alignment already present. registry.get() is a Map
  // lookup -- safe for any key type, including a malformed p.actualRole.
  if (p.actualAlignment === undefined && !p.isTraveler && p.actualRole) {
    const role = registry.get(p.actualRole);
    if (role) p.actualAlignment = deriveAlignment(role);
  }
  // 2. Effects: a genuinely absent `effects` (the v13 shape never had
  // this field) becomes an empty array -- STPlayerRecordSchema declares
  // no default for it, so unlike history/informationDeliveries above,
  // migration itself must supply this one. A PRESENT but malformed
  // `effects` (Finding A3), OR one whose elements aren't even
  // object-shaped with a string id (Finding M1 -- `[null]` must never
  // reach `eff.id`), is left untouched and the status->Effect conversion
  // below is skipped for it entirely -- the malformed value still fails
  // final schema validation.
  if (p.effects === undefined) p.effects = [];
  if (Array.isArray(p.effects) && p.effects.every(hasStringId)) {
    for (const type of ["drunk", "poisoned", "protected"]) {
      // Finding A3: only the LITERAL boolean `true` activates a migrated
      // legacy status. `p.statuses?.[type]` alone was a JavaScript
      // truthiness check -- the malformed string "false" (or any other
      // non-boolean truthy value) is truthy in JS and would have
      // silently become an active Effect. Literal `false` must not
      // activate it, and neither may anything else; a non-boolean status
      // value is simply left in `statuses`, where StatusesSchema's
      // `z.boolean()` requirement rejects it at final validation instead
      // of migration inventing an Effect for it.
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
  // Finding M1: the deterministic id is interpolated from `p.id` via a
  // template literal, which triggers JS's implicit ToString/ToPrimitive
  // conversion -- for a hostile object id (e.g. `{ toString: 0 }`) that
  // throws "Cannot convert object to primitive value" instead of
  // producing a string. Only ever interpolated once `p.id` is confirmed
  // to already BE a string; otherwise this step is skipped and
  // `reminders` is left untouched (STPlayerRecordSchema's own
  // `id: z.string().min(1)` independently rejects the malformed id at
  // final validation regardless).
  if (
    typeof p.id === "string" &&
    Array.isArray(p.reminders) &&
    p.reminders.every((r) => typeof r === "string")
  ) {
    p.reminders = (p.reminders as unknown as string[]).map((label, index) => ({
      id: `legacy-${p.id}-${index}`,
      label,
      lifetime: { kind: "manual" as const },
    }));
  }
}

export function migrateGameEntry(
  entry: unknown,
  fromVersion: number,
  scriptEvidence: MigrationScriptEvidence
): void {
  if (!entry || typeof entry !== "object") return;
  const e = entry as {
    scriptId?: unknown;
    players?: Record<string, unknown>;
  };

  if (fromVersion < 14) {
    const players = e.players;
    if (players && typeof players === "object" && !Array.isArray(players)) {
      // Finding M1: resolving the script registry is itself untrusted-data
      // dependent (scriptId, and for local migration a persisted custom
      // Script object). registryForScript/isUsableScript already guard
      // every identified failure mode; this try/catch is a last-resort
      // backstop so a genuinely unforeseen shape still falls back to an
      // empty (fully unresolved) registry rather than aborting migration
      // for every player in this entry.
      let registry: RoleRegistry;
      try {
        registry = registryForScript(e.scriptId, scriptEvidence);
      } catch {
        registry = buildRegistry({ id: "", name: "", characters: [] });
      }
      for (const raw of Object.values(players)) {
        // Finding A3: a malformed player entry (not an object at all) is
        // left completely untouched -- never migrated, never crashed on.
        // players: z.record(z.string(), STPlayerRecordPersistedSchema)
        // rejects it during final schema validation regardless.
        if (!raw || typeof raw !== "object") continue;
        try {
          migratePlayerV13ToV14(raw, registry);
        } catch {
          // Finding M1: every identified crash site is guarded inside
          // migratePlayerV13ToV14 itself; this is a last-resort backstop
          // against an unforeseen malformed shape. Never let an
          // exception from ONE malformed player abort migration for the
          // REST of this entry's players -- that player is simply left
          // un-migrated, exactly like the shape guards above already
          // leave a malformed field untouched, and final schema
          // validation rejects it the same way.
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
