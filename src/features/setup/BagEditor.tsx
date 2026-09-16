import { useMemo, useState } from "react";
import { fillRolePool } from "./fillRolePool";
import { RolePoolEditor } from "./RolePoolEditor";
import type { BagCounts } from "@/data/setupCounts";
import type { RoleId, Script } from "@/stores/types";

type Props = {
  script: Script;
  pool: RoleId[];
  /** Roles Silverwick most recently auto-filled into pool (Fill/Re-roll Bag).
   * Everything else in pool is Storyteller-pinned and survives a re-roll. */
  generatedRoleIds: RoleId[];
  fabledIds: RoleId[];
  loricIds: RoleId[];
  plannedPlayerCount: number | null;
  /** Fires for both a Fill/Re-roll result and a manual grid edit -- the
   * caller owns committing the pool and persisting which ids are generated. */
  onPoolChange: (pool: RoleId[], generatedRoleIds: RoleId[]) => void;
};

/**
 * The Grimoire Setup "Bag" workspace: Fill/Re-roll controls layered over the
 * existing role grid. Reuses fillRolePool()/compositionCandidates() as the
 * single source of truth -- this never re-derives count-changing or
 * uncertain-setup rules itself.
 */
export function BagEditor({
  script, pool, generatedRoleIds, fabledIds, loricIds, plannedPlayerCount, onPoolChange,
}: Props) {
  const pinnedIds = useMemo(
    () => pool.filter((id) => !generatedRoleIds.includes(id)),
    [pool, generatedRoleIds]
  );

  // Once the Storyteller resolves a multi-candidate composition, Fill/Re-roll
  // keeps using it -- fillRolePool re-validates it against freshly computed
  // candidates every call, so a stale choice safely falls back to asking again.
  const [chosenComposition, setChosenComposition] = useState<BagCounts | null>(null);

  // Randomness-independent dry run: whether Fill/Re-roll would succeed right
  // now, and why not if not. Every failure path in fillRolePool is decided
  // before any random draw, so a fixed dummy generator previews it safely.
  const assessment = useMemo(
    () => fillRolePool({
      pinnedIds, targetPlayerCount: plannedPlayerCount, scriptCharacters: script.characters,
      fabledIds, loricIds, chosenComposition: chosenComposition ?? undefined, random: () => 0,
    }),
    [pinnedIds, plannedPlayerCount, script.characters, fabledIds, loricIds, chosenComposition]
  );

  const fillLabel = generatedRoleIds.length > 0 ? "Re-roll Bag" : "Fill the Bag";

  const handleFillClick = () => {
    const result = fillRolePool({
      pinnedIds, targetPlayerCount: plannedPlayerCount, scriptCharacters: script.characters,
      fabledIds, loricIds, chosenComposition: chosenComposition ?? undefined,
    });
    if (result.ok) onPoolChange(result.pool, result.generated);
  };

  // A deliberate grid edit always means "intentional": any id whose presence
  // changed loses its generated-status, whether it's being added fresh (so
  // it becomes pinned) or removed (so it stops being tracked at all).
  const handleGridChange = (nextPool: RoleId[]) => {
    const prevSet = new Set(pool);
    const nextSet = new Set(nextPool);
    const changed = new Set(
      [...prevSet, ...nextSet].filter((id) => prevSet.has(id) !== nextSet.has(id))
    );
    onPoolChange(nextPool, changed.size > 0
      ? generatedRoleIds.filter((id) => !changed.has(id))
      : generatedRoleIds);
  };

  return (
    <div className="setup-bag-editor">
      <div className="ng-fill-bag">
        {assessment.ok ? (
          <button className="btn btn-gold ng-fill-btn" onClick={handleFillClick}>{fillLabel}</button>
        ) : assessment.failure.reason === "multiple-candidates" ? (
          <div className="ng-fill-candidates">
            <p className="ng-fill-candidates-label">Fill using:</p>
            <div className="ng-fill-candidates-options">
              {assessment.failure.candidates.map((c, i) => (
                <button
                  key={i}
                  className="btn btn-sm"
                  onClick={() => setChosenComposition(c)}
                >
                  {c.townsfolk}T / {c.outsider}O / {c.minion}M / {c.demon}D
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ng-fill-blocked">
            <button className="btn ng-fill-btn" disabled>{fillLabel}</button>
            <p className="ng-fill-message">{assessment.failure.message}</p>
          </div>
        )}
      </div>
      <RolePoolEditor script={script} pool={pool} onChange={handleGridChange} />
    </div>
  );
}
