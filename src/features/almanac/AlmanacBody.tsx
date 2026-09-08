import { useMemo, useState } from "react";
import type { RoleDef, RoleType } from "@/stores/types";
import { iconUrlFor } from "@/data/iconUrl";
import { isCanonicalRole, roleAuthority } from "@/data/canonical";

const TYPES: RoleType[] = [
  "townsfolk",
  "outsider",
  "minion",
  "demon",
  "traveler",
  "fabled",
  "loric",
];

const TYPE_ORDER: Partial<Record<RoleType, number>> = {
  townsfolk: 0,
  outsider: 1,
  minion: 2,
  demon: 3,
  traveler: 4,
  fabled: 5,
  loric: 6,
};

const VISIBLE_EDITIONS = new Set(["tb", "snv", "bmr"]);

function wikiUrlFor(name: string): string {
  const slug = name
    .trim()
    .replace(/['']/g, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join("_");
  return `https://wiki.bloodontheclocktower.com/${slug}`;
}

type AlmanacBodyProps = {
  roles: RoleDef[];
  autoFocusSearch?: boolean;
};

export function AlmanacBody({ roles, autoFocusSearch = false }: AlmanacBodyProps) {
  const [search, setSearch] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<RoleType>>(new Set());
  const [activeEditions, setActiveEditions] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const editions = useMemo(() => {
    const set = new Set<string>();
    for (const r of roles) if (r.edition && VISIBLE_EDITIONS.has(r.edition)) set.add(r.edition);
    return Array.from(set).sort();
  }, [roles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roles
      .filter((r) => {
        if (activeTypes.size > 0 && !activeTypes.has(r.type)) return false;
        if (activeEditions.size > 0) {
          if (!r.edition || !activeEditions.has(r.edition)) return false;
        }
        if (q) {
          const hay = `${r.name} ${r.id} ${r.ability ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99));
  }, [roles, search, activeTypes, activeEditions]);

  const toggleType = (t: RoleType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleEdition = (e: string) => {
    setActiveEditions((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  };

  if (roles.length === 0) {
    return (
      <p className="behavior-help" style={{ padding: "16px 18px" }}>
        No script loaded — character reference unavailable.
      </p>
    );
  }

  return (
    <>
      <div className="dialog-toolbar">
        <input
          className="input almanac-search"
          placeholder="Search by name, id, or ability…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus={autoFocusSearch}
        />
        <div className="filter-chips" role="group" aria-label="Type filters">
          {TYPES.map((t) => (
            <button
              key={t}
              className="chip"
              data-kind={t}
              aria-pressed={activeTypes.has(t)}
              onClick={() => toggleType(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {editions.length > 1 && (
          <div className="filter-chips" role="group" aria-label="Edition filters">
            {editions.map((e) => (
              <button
                key={e}
                className="chip chip-edition"
                aria-pressed={activeEditions.has(e)}
                onClick={() => toggleEdition(e)}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <span className="label almanac-count">{filtered.length} characters</span>
      </div>
      <div className="dialog-body">
        {filtered.length === 0 ? (
          <p className="behavior-help">No characters match.</p>
        ) : (
          <ul className="almanac-list">
            {filtered.map((r) => (
              <AlmanacCard
                key={`${r.edition ?? "x"}-${r.id}`}
                role={r}
                expanded={expandedId === r.id}
                onToggle={() =>
                  setExpandedId((cur) => (cur === r.id ? null : r.id))
                }
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function AlmanacCard({
  role,
  expanded,
  onToggle,
}: {
  role: RoleDef;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`almanac-card ${expanded ? "expanded" : ""}`}>
      <button className="almanac-summary" onClick={onToggle}>
        <span className="almanac-summary-left">
          <img
            className="almanac-art"
            src={iconUrlFor(role)}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
          <span className={`almanac-name type-${role.type}`}>{role.name}</span>
        </span>
        <span className="almanac-meta">
          <span className="label">{role.type}</span>
        </span>
      </button>
      {expanded && (
        <div className="almanac-detail">
          <p className="behavior-help">{roleAuthority(role)}</p>
          {role.ability && <p className="almanac-ability">{role.ability}</p>}
          {role.flavor && <p className="almanac-flavor">{role.flavor}</p>}
          {isCanonicalRole(role) && <a
            className="almanac-wiki"
            href={wikiUrlFor(role.name)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Wiki ↗
          </a>}
        </div>
      )}
    </li>
  );
}
