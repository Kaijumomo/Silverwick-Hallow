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
function registryForScript(scriptId: string | undefined, customScripts: Record<string, Script>): RoleRegistry {
  const id = scriptId ?? "";
  const script = BUILTIN_SCRIPTS[id] ?? customScripts[id] ?? { id, name: id, characters: [] };
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
 *
 * v14 -> v15 (Phase 9D.2): adds an empty `history` collection where none
 * existed -- a prior snapshot proves nothing about why/when its current
 * values changed, so no event is ever fabricated for existing state.
 *
 * v15 -> v16 (Phase 9D.3): adds an empty `informationDeliveries`
 * collection where none existed, for the same reason -- Role
 * assignments, night progress, and notes never prove what the
 * Storyteller actually communicated.
 *
 * `customScripts` is the best-available source of script/Role data for
 * alignment derivation: the local store's own persisted blob carries its
 * own `customScripts` (the exact scripts saved alongside that state); a
 * remote checkpoint carries none, so its caller passes the current local
 * customScripts as the closest available evidence. Either way, a Role
 * that fails to resolve leaves that player's alignment unresolved rather
 * than guessing -- this function never fabricates one from an unknown
 * script.
 */
export function migrateGameEntry(
  entry: unknown,
  fromVersion: number,
  customScripts: Record<string, Script>
): void {
  if (!entry || typeof entry !== "object") return;
  const e = entry as {
    scriptId?: string;
    players?: Record<string, STPlayerRecord>;
    history?: unknown;
    informationDeliveries?: unknown;
  };

  if (fromVersion < 14) {
    const players = e.players;
    if (players) {
      const registry = registryForScript(e.scriptId, customScripts);
      for (const p of Object.values(players)) {
        // 1. Actual alignment: derive for an ordinary player with an
        // assigned, still-resolvable role. Never invent one for a
        // Traveler, and never overwrite an alignment already present.
        if (p.actualAlignment === undefined && !p.isTraveler && p.actualRole) {
          const role = registry.get(p.actualRole);
          if (role) p.actualAlignment = deriveAlignment(role);
        }
        // 2. Effects: convert each active legacy status boolean into its
        // own deterministic manual effect, then clear the boolean so
        // `statuses` is never read as truth again.
        if (!Array.isArray(p.effects)) p.effects = [];
        for (const type of ["drunk", "poisoned", "protected"]) {
          if (p.statuses?.[type]) {
            const id = `manual:${type}`;
            if (!p.effects.some((eff) => eff.id === id)) {
              p.effects.push({ id, type, lifetime: { kind: "manual" } });
            }
            delete p.statuses[type];
          }
        }
        // 3. Reminders: a plain string array (every entry still a string)
        // becomes manual/legacy records with no invented source or moment.
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
  if (fromVersion < 15) {
    if (!Array.isArray(e.history)) (e as Record<string, unknown>).history = [];
  }
  if (fromVersion < 16) {
    if (!Array.isArray(e.informationDeliveries)) (e as Record<string, unknown>).informationDeliveries = [];
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
