import { useMemo } from "react";
import { iconUrlFor } from "@/data/iconUrl";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { analyzeRolePool } from "./newGameAnalyzer";
import type { RoleDef, RoleId } from "@/stores/types";
import { SetupFindings, CompositionSummary } from "@/features/setup/SetupFindings";

type Props = {
  scriptCharacters: RoleDef[];
  rolePool: RoleId[];
  plannedFabled: RoleId[];
  plannedLorics: RoleId[];
  plannedPlayerCount: number;
  onToggleRole: (id: RoleId) => void;
  onToggleFabled: (id: RoleId) => void;
  onToggleLoric: (id: RoleId) => void;
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
  plannedFabled,
  plannedLorics,
  plannedPlayerCount,
  onToggleRole,
  onToggleFabled,
  onToggleLoric,
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
      <CompositionSummary label="Planned pool" analysis={analysis.pool} />
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
      <div className="ng-type-section">
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
    </div>
  );
}
