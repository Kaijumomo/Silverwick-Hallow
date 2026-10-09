import { useId, useState, type ReactNode } from "react";
import { Modal } from "@/components/Modal";
import { iconUrlFor } from "@/data/iconUrl";
import { isCanonicalRole } from "@/data/canonical";
import { wikiUrlFor } from "@/features/almanac/wikiUrl";
import type { RoleDef, RoleId, RoleType } from "@/stores/types";

const GROUPS = [
  { type: "townsfolk", label: "Townsfolk" }, { type: "outsider", label: "Outsiders" },
  { type: "minion", label: "Minions" }, { type: "demon", label: "Demons" },
  { type: "traveler", label: "Travelers" },
] as const;

type Common = {
  roles: RoleDef[];
  scriptName: string;
  onClose: () => void;
  footerExtra?: ReactNode;
  pending?: boolean;
  error?: string;
};
export type RoleChooserProps = Common & ({
  mode: "distribute";
  selected: RoleId[];
  residents: number;
  travelers: number;
  required: Partial<Record<RoleType, number>>;
  canDistribute: boolean;
  /** The caller supplies the actual scope when only residents are dealt. */
  distributionLabel?: string;
  status?: string;
  onToggle: (id: RoleId) => void;
  onClear: () => void;
  onRandom: () => void;
  onDistribute: () => void;
} | {
  mode: "select";
  title: string;
  instruction: string;
  selected?: RoleId[];
  holders?: Record<RoleId, string[]>;
  onChoose: (id: RoleId) => void;
  onClear?: () => void;
} | {
  mode: "choose";
  player: { id: string; name: string; seat: number; roleId?: RoleId };
  holders?: Record<RoleId, string[]>;
  allowSwap: boolean;
  onChoose: (id: RoleId) => void;
});

/** Controlled view: composition, eligibility and mutations belong to the caller. */
export function RoleChooser(props: RoleChooserProps) {
  const [previewId, setPreviewId] = useState<RoleId>();
  const [query, setQuery] = useState("");
  const hintId = useId();
  const detail = props.roles.find(role => role.id === previewId)
    ?? props.roles.find(role => role.id === (props.mode === "choose" ? props.player.roleId : props.selected?.[0]))
    ?? props.roles[0];
  const normalizedQuery = query.trim().toLowerCase();
  const visible = props.roles.filter(role => `${role.name} ${role.ability ?? ""}`.toLowerCase().includes(normalizedQuery));
  const title = props.mode === "select" ? props.title : props.mode === "distribute" ? "Distribute Roles" : `Choose a character for ${props.player.name}`;
  const count = (type: RoleType) => props.mode === "distribute"
    ? props.selected.filter(id => props.roles.some(role => role.id === id && role.type === type)).length : 0;

  return <Modal title={title} onClose={props.onClose} className="role-chooser" closeLabel="Close character chooser">
    <div className="role-chooser-intro">
      <p>{props.mode === "select" ? props.instruction : props.mode === "distribute"
        ? `${props.scriptName} · ${props.residents} residents · ${props.travelers} travelers`
        : `Seat ${props.player.seat} · ${props.roles.find(role => role.id === props.player.roleId)?.name ?? "Unassigned"}`}</p>
      <input className="input" type="search" aria-label="Search chooser characters" placeholder="Search characters or abilities…"
        value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />
    </div>
    <div className="role-chooser-scroll">
      <div className="role-chooser-groups">
        {GROUPS.map(({ type, label }) => {
          const group = visible.filter(role => role.type === type);
          if (!group.length) return null;
          return <section className="role-chooser-group" key={type} data-team={type} aria-label={label}>
            <header><h3>{label}</h3>{props.mode === "distribute" &&
              <span aria-label={`${label}: ${count(type)} selected, ${props.required[type] ?? 0} required`}>{count(type)} / {props.required[type] ?? 0}</span>}</header>
            {props.mode === "distribute" && type === "traveler" && props.travelers === 0 &&
              <p className="role-chooser-note">Add a Traveler seat to select Traveler characters.</p>}
            <div className="role-chooser-grid">{group.map(role => {
              const current = props.mode === "choose" && props.player.roleId === role.id;
              const selected = props.mode !== "choose" && !!props.selected?.includes(role.id);
              const holders = props.mode !== "distribute" ? props.holders?.[role.id] ?? [] : [];
              const unavailable = !!props.pending || (props.mode === "distribute" && type === "traveler" && props.travelers === 0);
              const annotation = current ? "Current" : holders.join(", ") || (props.mode === "select" && selected ? "Bluff" : "");
              return <button key={role.id} type="button" className="role-chooser-tile"
                data-state={current ? "current" : selected ? "selected" : props.mode === "distribute" ? "unselected" : holders.length ? "used" : "available"}
                aria-pressed={current || selected} aria-describedby={props.mode !== "distribute" ? hintId : undefined}
                aria-label={`${role.name}${current ? ", current" : holders.length ? `, in use by ${holders.join(", ")}` : ""}`}
                disabled={unavailable} onMouseEnter={() => setPreviewId(role.id)} onFocus={() => setPreviewId(role.id)}
                onClick={() => { setPreviewId(role.id); if (props.mode === "distribute") props.onToggle(role.id); else props.onChoose(role.id); }}>
                <span className="role-chooser-disc"><img src={iconUrlFor(role)} alt="" loading="lazy"
                  onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
                  {annotation && <span className="role-chooser-holder" title={annotation}>{annotation}</span>}</span>
                <span className="role-chooser-name" title={role.name}>{role.name}</span>
              </button>;
            })}</div>
          </section>;
        })}
        {!visible.some(role => GROUPS.some(group => group.type === role.type)) && <p role="status">No characters match this search.</p>}
      </div>
      {props.footerExtra && <div className="role-chooser-findings">{props.footerExtra}</div>}
    </div>
      <footer className="role-chooser-footer">
        {detail && <section className="role-chooser-detail" aria-label="Character details" data-team={detail.type}>
          <span className="role-chooser-detail-disc"><img src={iconUrlFor(detail)} alt="" /></span>
          <div className="role-chooser-detail-copy" tabIndex={0} aria-label={`${detail.name} ability and Wiki`}><h3>{detail.name} <small>{detail.type}</small></h3>
            <p>{detail.ability || "No ability text provided."}</p>
            {isCanonicalRole(detail) && <a href={wikiUrlFor(detail.name)} target="_blank" rel="noopener noreferrer"
              aria-label={`${detail.name} wiki (opens in a new tab)`}>Character Wiki ↗</a>}</div>
          {!!detail.reminders?.length && <div className="role-chooser-reminders"><h4>Reminders</h4>
            <ul>{detail.reminders.map((reminder, index) => <li key={`${reminder}-${index}`}><img src={iconUrlFor(detail)} alt="" />{reminder}</li>)}</ul></div>}
        </section>}
        {props.mode === "distribute" ? <div className="role-chooser-actions">
          <div className="role-chooser-status"><p role="status">{props.status ?? `${props.selected.length} of ${props.residents + props.travelers} characters selected`}</p>
            {props.error && <p role="alert" className="role-chooser-error">{props.error}</p>}</div>
          <button type="button" className="btn" disabled={props.pending} onClick={props.onClear}>Clear</button>
          <button type="button" className="btn" disabled={props.pending} onClick={props.onRandom}>Random setup</button>
          <button type="button" className="btn btn-gold" disabled={props.pending || !props.canDistribute} onClick={props.onDistribute}>
            {props.pending ? "Distributing…" : props.distributionLabel ?? `Distribute to ${props.residents + props.travelers} players`}</button>
        </div> : props.mode === "select" ? <div className="role-chooser-choice-status"><p id={hintId}>{props.instruction}</p>
          {props.error && <p role="alert">{props.error}</p>}
          {props.onClear && <button type="button" className="btn" disabled={props.pending} onClick={props.onClear}>Clear slot</button>}
        </div> : <div className="role-chooser-choice-status"><p id={hintId} className="role-chooser-hint">{props.allowSwap
          ? "Private setup: choosing an occupied character exchanges characters with that player. Seats stay unchanged."
          : `Only ${props.player.name}’s character will change. Other players keep their characters and seats.`}</p>
          {props.error && <p role="alert" className="role-chooser-error">{props.error}</p>}</div>}
      </footer>
  </Modal>;
}
