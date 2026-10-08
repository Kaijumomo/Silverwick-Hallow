import { useId, useMemo, useState } from "react";
import type { RoleDef, RoleType } from "@/stores/types";
import { iconUrlFor } from "@/data/iconUrl";
import { isCanonicalRole, roleAuthority } from "@/data/canonical";
import { wikiUrlFor } from "./wikiUrl";

const GROUPS: { type: RoleType; label: string }[] = [
  { type: "townsfolk", label: "Townsfolk" }, { type: "outsider", label: "Outsiders" },
  { type: "minion", label: "Minions" }, { type: "demon", label: "Demons" },
  { type: "traveler", label: "Travelers" }, { type: "fabled", label: "Fabled" },
  { type: "loric", label: "Loric" },
];

/** Definition-only reference: no player assignments, effects or private game state. */
export function ReferenceBody({ roles, search, onSearch }: {
  roles: RoleDef[]; search: string; onSearch: (search: string) => void;
}) {
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return roles.filter(role => `${role.name} ${role.id} ${role.ability ?? ""}`.toLowerCase().includes(query));
  }, [roles, search]);
  return <>
    <div className="reference-search-area">
      <div className="reference-search-row">
        <input type="search" className="input" name="reference-search" aria-label="Search characters"
          placeholder="Search characters or abilities…" autoComplete="off" spellCheck={false}
          value={search} onChange={event => onSearch(event.target.value)} />
        {search && <button type="button" className="reference-icon-button" aria-label="Clear search"
          onClick={() => onSearch("")}>×</button>}
      </div>
      <p className={search ? "reference-count" : "sr-only"} role="status" aria-live="polite">{filtered.length} characters</p>
    </div>
    <div className="reference-scroll">
      {!roles.length ? <p>No script loaded — character reference unavailable.</p>
        : !filtered.length ? <p>No characters match. Try a character name or a word from its ability.</p>
        : GROUPS.map(({ type, label }) => {
          const group = filtered.filter(role => role.type === type);
          if (!group.length) return null;
          return <section className="reference-group" key={type} aria-label={label}>
            <h3 className={`type-${type}`}>{label}</h3>
            <ul>
              {group.map(role => <ReferenceCharacter role={role} key={role.id} />)}
            </ul>
          </section>;
        })}
    </div>
  </>;
}

function ReferenceCharacter({ role }: { role: RoleDef }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const abilityId = useId();
  return <li className="reference-character">
    <button type="button" className="reference-character-main" aria-label={role.name}
      aria-expanded={expanded} aria-controls={detailId} aria-describedby={abilityId}
      onClick={() => setExpanded(value => !value)}>
      <span className="reference-art">
        <img src={iconUrlFor(role)} alt="" width={32} height={32} loading="lazy"
          onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
      </span>
      <span className="reference-character-copy">
        <span className="reference-character-name">{role.name}<span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></span>
        <span className="reference-ability" id={abilityId}>{role.ability || "No ability text provided."}</span>
      </span>
    </button>
    {isCanonicalRole(role) && <a href={wikiUrlFor(role.name)} target="_blank" rel="noopener noreferrer"
      className="reference-wiki" aria-label={`${role.name} wiki (opens in a new tab)`}>Wiki ↗</a>}
    <div id={detailId} className="reference-details" hidden={!expanded}>
      <p>{roleAuthority(role)}</p>
      {role.flavor && <p className="reference-flavor">{role.flavor}</p>}
    </div>
  </li>;
}
