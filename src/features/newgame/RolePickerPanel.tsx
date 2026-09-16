import { useMemo, useState } from "react";
import { iconUrlFor } from "@/data/iconUrl";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { analyzeRolePool } from "./newGameAnalyzer";
import { fillRolePool } from "./fillRolePool";
import type { BagCounts } from "@/data/setupCounts";
import type { RoleDef, RoleId } from "@/stores/types";
import { SetupFindings, CompositionSummary } from "@/features/setup/SetupFindings";

type Props = {
  scriptCharacters: RoleDef[];
  rolePool: RoleId[];
  generatedRoleIds: RoleId[];
  plannedFabled: RoleId[];
  plannedLorics: RoleId[];
  plannedPlayerCount: number;
  onToggleRole: (id: RoleId) => void;
  onToggleFabled: (id: RoleId) => void;
  onToggleLoric: (id: RoleId) => void;
  onFillResult: (pool: RoleId[], generated: RoleId[]) => void;
};

const BAG_TYPES = ["townsfolk", "outsider", "minion", "demon"] as const;
const TYPE_LABEL: Record<string, string> = {
  townsfolk: "Townsfolk",
  outsider: "Outsiders",
  minion: "Minions",
  demon: "Demons",
};
const TYPE_COLOR: Record<string, string> = {
  townsfolk: "type-townsfolk",
  outsider: "type-outsider",
  minion: "type-minion",
  demon: "type-demon",
};

type RoleTileProps = {
  role: RoleDef;
  selected: boolean;
  onToggle: () => void;
};

function RoleTile({ role, selected, onToggle }: RoleTileProps) {
  return (
    <button
      className={`ng-role-tile${selected ? " selected" : ""} ${TYPE_COLOR[role.type] ?? ""}`}
      onClick={onToggle}
      aria-pressed={selected}
      title={role.ability ?? role.name}
    >
      <img
        className="ng-role-art"
        src={iconUrlFor(role)}
        alt=""
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="ng-role-name">{role.name}</span>
    </button>
  );
}

export function RolePickerPanel({
  scriptCharacters,
  rolePool,
  generatedRoleIds,
  plannedFabled,
  plannedLorics,
  plannedPlayerCount,
  onToggleRole,
  onToggleFabled,
  onToggleLoric,
  onFillResult,
}: Props) {
  const roleById = useMemo(
    () => new Map(scriptCharacters.map((r) => [r.id, r])),
    [scriptCharacters]
  );

  const analysis = useMemo(
    () => analyzeRolePool(rolePool, plannedPlayerCount, roleById, plannedFabled, plannedLorics),
    [rolePool, plannedPlayerCount, roleById, plannedFabled, plannedLorics]
  );

  const poolSet = new Set(rolePool);
  const fabSet = new Set(plannedFabled);
  const loricSet = new Set(plannedLorics);

  const pinnedIds = useMemo(
    () => rolePool.filter((id) => !generatedRoleIds.includes(id)),
    [rolePool, generatedRoleIds]
  );

  // Once the Storyteller resolves a multi-candidate composition, Fill/Re-roll
  // keeps using it — fillRolePool re-validates it against freshly computed
  // candidates every call, so a stale choice safely falls back to asking again.
  const [chosenComposition, setChosenComposition] = useState<BagCounts | null>(null);

  const target = plannedPlayerCount || null;

  // Randomness-independent dry run: whether Fill/Re-roll would succeed right
  // now, and why not if not. Every failure path in fillRolePool is decided
  // before any random draw, so a fixed dummy generator previews it safely.
  const assessment = useMemo(
    () => fillRolePool({
      pinnedIds, targetPlayerCount: target, scriptCharacters,
      fabledIds: plannedFabled, loricIds: plannedLorics,
      chosenComposition: chosenComposition ?? undefined, random: () => 0,
    }),
    [pinnedIds, target, scriptCharacters, plannedFabled, plannedLorics, chosenComposition]
  );

  const fillLabel = generatedRoleIds.length > 0 ? "Re-roll Bag" : "Fill the Bag";

  const handleFillClick = () => {
    const result = fillRolePool({
      pinnedIds, targetPlayerCount: target, scriptCharacters,
      fabledIds: plannedFabled, loricIds: plannedLorics,
      chosenComposition: chosenComposition ?? undefined,
    });
    if (result.ok) onFillResult(result.pool, result.generated);
  };

  const byType = useMemo(() => {
    const map = new Map<string, RoleDef[]>();
    for (const t of BAG_TYPES) map.set(t, []);
    for (const r of scriptCharacters) {
      if (BAG_TYPES.includes(r.type as typeof BAG_TYPES[number])) {
        map.get(r.type)!.push(r);
      }
    }
    return map;
  }, [scriptCharacters]);

  return (
    <div className="ng-picker">
      <CompositionSummary target={plannedPlayerCount || null} analysis={analysis.pool} />
      <p className="setup-selection-count">{rolePool.length} / {plannedPlayerCount || "—"} roles selected</p>

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

      <SetupFindings findings={analysis.findings.filter(f =>
        f.severity !== "blocker" && f.source !== "assigned" && f.code !== "planning-empty")} />

      {/* Role grids by type */}
      {BAG_TYPES.map((t) => {
        const roles = byType.get(t) ?? [];
        if (roles.length === 0) return null;
        return (
          <div key={t} className="ng-type-section">
            <div className={`ng-type-heading ${TYPE_COLOR[t]}`}>
              {TYPE_LABEL[t]}
            </div>
            <div className="ng-role-grid">
              {roles.map((r) => (
                <RoleTile
                  key={r.id}
                  role={r}
                  selected={poolSet.has(r.id)}
                  onToggle={() => onToggleRole(r.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Fabled strip */}
      <details className="ng-type-section setup-modifiers"><summary>Fabled &amp; Lorics</summary>
      <div>
        <div className="ng-type-heading type-fabled">Fabled</div>
        <div className="ng-role-grid">
          {FABLED.map((f) => (
            <button
              key={f.id}
              className={`fabled-chip${fabSet.has(f.id) ? " selected" : ""}`}
              aria-pressed={fabSet.has(f.id)}
              title={f.ability}
              onClick={() => onToggleFabled(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {/* Lorics strip */}
      <div className="ng-type-section">
        <div className="ng-type-heading type-loric">Lorics</div>
        <div className="ng-role-grid">
          {LORICS.map((l) => (
            <button
              key={l.id}
              className={`loric-chip${loricSet.has(l.id) ? " selected" : ""}`}
              aria-pressed={loricSet.has(l.id)}
              title={l.ability}
              onClick={() => onToggleLoric(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>
      </details>
    </div>
  );
}
