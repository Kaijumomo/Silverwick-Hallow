import { useState } from "react";
import { groupByTeam } from "@/features/home/reference/referenceData";
import type { RoleDef } from "@/stores/types";
import { DiamondRule } from "./PhoneParts";
import { roleArt } from "./roleArt";

/** Script (design: Reference list): every character on the script plus the
 * Fabled, Lorics and Travellers in play, searchable, with the discreet
 * "Request to leave" link at the very end. Tapping a row opens its card. */
export function ScriptTab({ roles, scriptName, ownRoleId, onOpen, onLeave, leaving }: {
  roles: readonly RoleDef[];
  scriptName: string;
  ownRoleId: string | undefined;
  onOpen: (role: RoleDef) => void;
  onLeave: () => void;
  leaving: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? roles.filter((r) => r.name.toLowerCase().includes(q) || (r.ability ?? "").toLowerCase().includes(q)) : [...roles];
  const groups = groupByTeam(shown);
  return (
    <div className="swp-script">
      <div className="swp-script-head">
        <h1 className="swp-script-title">Reference</h1>
        <span className="swp-script-sub">{scriptName} · {roles.filter((r) => r.type !== "fabled" && r.type !== "loric" && r.type !== "traveler").length} characters</span>
      </div>
      <input
        className="swp-search"
        type="search"
        placeholder="Search characters"
        aria-label="Search characters"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.length === 0 && (
        <div className="swp-script-empty" role="status">
          <span>No characters match “{query.trim()}”.</span>
          <button type="button" className="swp-textlink" onClick={() => setQuery("")}>Clear search</button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.type} className="swp-script-group" aria-label={g.label}>
          <span className="swp-script-eyebrow" style={{ color: g.color }}>{g.label}</span>
          {g.roles.map((r) => (
            <button key={r.id} type="button" className="swp-script-row" onClick={() => onOpen(r)}>
              <span className="swp-script-token"><span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${roleArt(r)})` }} /></span>
              <span className="swp-script-text">
                <span className="swp-script-name">{r.name}{r.id === ownRoleId && <span className="swp-own-dot" role="img" aria-label="Your character" />}</span>
                {r.ability && <span className="swp-script-ability">{r.ability}</span>}
              </span>
            </button>
          ))}
        </section>
      ))}
      <div className="swp-leave-end">
        <DiamondRule className="swp-leave-rule" />
        <div className="swp-linkrow">
          <button type="button" className="swp-textlink" onClick={onLeave} disabled={leaving}>Request to leave</button>
        </div>
      </div>
    </div>
  );
}
