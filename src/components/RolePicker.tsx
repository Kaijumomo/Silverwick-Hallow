import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RoleDef, RoleType } from "@/stores/types";

/**
 * Phase 10H (contract §§2.2, 7; 10H-AC-014): the searchable visual role
 * picker. Role choice is never a dropdown, and the role list is loaded ON
 * DEMAND -- nothing but the trigger is in the DOM until the picker is opened
 * (the Inspector stays light; Privacy Mode unmounts the whole Inspector).
 *
 * Grouped by character type, filtered by a search over name, type and
 * ability text; each role is a real button (name and type in text, never
 * colour alone). Picking calls `onPick` and closes, returning focus to the
 * trigger. Escape closes without choosing; Enter in the search picks the first
 * match (and never submits an enclosing form).
 */
const TYPE_ORDER: RoleType[] = ["townsfolk", "outsider", "minion", "demon", "traveler", "fabled", "loric"];
const TYPE_LABEL: Record<RoleType, string> = {
  townsfolk: "Townsfolk", outsider: "Outsiders", minion: "Minions", demon: "Demons",
  traveler: "Travelers", fabled: "Fabled", loric: "Lorics",
};

export function RolePicker({ label, roles, value, onPick, filter, triggerText, disabled = false, startOpen = false, onClose, onClear }: {
  /** The choice being made ("Shown role", "Bluff 2") -- the accessible name. */
  label: string;
  roles: readonly RoleDef[];
  /** The currently chosen RoleId, marked pressed in the list. */
  value: string | null;
  onPick: (roleId: string) => void;
  filter?: (role: RoleDef) => boolean;
  /** Visible trigger text; defaults to "label: current" / "Choose label…". */
  triggerText?: string;
  disabled?: boolean;
  startOpen?: boolean;
  onClose?: () => void;
  /** When given, a chosen role can be cleared back to "none" with an adjacent button. */
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  const current = value ? roles.find((role) => role.id === value) : undefined;
  const close = (returnFocus = true) => {
    setOpen(false);
    setQuery("");
    onClose?.();
    if (returnFocus) triggerRef.current?.focus();
  };
  const groups = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    const visible = (filter ? roles.filter(filter) : roles).filter((role) => !q
      || role.name.toLowerCase().includes(q) || role.type.includes(q) || (role.ability ?? "").toLowerCase().includes(q));
    return TYPE_ORDER.map((type) => ({ type, roles: visible.filter((role) => role.type === type) })).filter((g) => g.roles.length);
  }, [open, query, roles, filter]);
  return (
    <div className="role-picker-field" data-role-picker={label} data-chosen-role={value ?? ""}>
      <button ref={triggerRef} type="button" className="btn btn-sm role-picker-trigger" disabled={disabled}
        aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current ? current.name : "none chosen"}. ${open ? "Close" : "Choose"} a character`}
        onClick={() => (open ? close() : setOpen(true))}>
        {triggerText ?? (current ? `${label}: ${current.name}` : `Choose ${label.toLowerCase()}…`)}
      </button>
      {onClear && value && !disabled && (
        <button type="button" className="btn btn-sm role-picker-clear" aria-label={`Clear ${label}`} onClick={onClear}>Clear</button>
      )}
      {open && (
        <div className="role-picker-panel" id={listId} role="group" aria-label={`${label}: choose a character`}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}>
          <input ref={searchRef} type="search" className="input role-picker-search" aria-label={`Search characters for ${label}`}
            placeholder="Search characters" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter picks the first match and never submits an enclosing form.
              if (e.key !== "Enter") return;
              e.preventDefault();
              const first = groups[0]?.roles[0];
              if (first) { onPick(first.id); close(); }
            }} />
          {groups.length === 0 ? <p className="behavior-help">No matching characters.</p> : groups.map((group) => (
            <div key={group.type} className="role-picker-group">
              <div className={`role-picker-group-title type-${group.type}`}>{TYPE_LABEL[group.type]}</div>
              <div className="role-picker-grid">
                {group.roles.map((role) => (
                  <button key={role.id} type="button" className={`role-card${value === role.id ? " selected" : ""}`}
                    aria-pressed={value === role.id} title={role.ability} data-role-id={role.id}
                    onClick={() => { onPick(role.id); close(); }}>
                    <span className={`role-card-name type-${role.type}`}>{role.name}</span>
                    <span className="role-card-type">{role.type}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
