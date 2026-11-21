import { iconUrlFor } from "@/data/iconUrl";
import type { RoleDef } from "@/stores/types";
import { ICON } from "../icons";

/**
 * PO review 2026-11-21 (SV-2c, "side by side on one row"): one row per player who changed character -- their name, then the
 * YOU ARE character token and the YOU ARE GOOD/EVIL token side by side. Each token opens the existing player-safe reveal
 * unchanged (the caller's onCharacter / onAlignment); this row is presentation only.
 */
export function YouAreRow({ name, role, alignment, onCharacter, onAlignment }: {
  name: string; role: RoleDef; alignment: "good" | "evil"; onCharacter: () => void; onAlignment: () => void;
}) {
  const told = alignment === "evil" ? "You Are Evil" : "You Are Good";
  return <div className="gv-you-are" role="group" aria-label={`Wake ${name}`}>
    <span className="gv-you-are-name"><small>Wake</small>{name}</span>
    <button type="button" className="gv-you-are-token" aria-label={`Wake ${name}: You Are`} onClick={onCharacter}>
      <span className="gv-you-are-disc" aria-hidden="true"><img src={iconUrlFor(role)} alt="" draggable={false} /></span>
      <span className="gv-you-are-text"><strong>You Are</strong><small>{role.name}</small></span>
    </button>
    <button type="button" className={`gv-you-are-token is-${alignment}`} aria-label={`Wake ${name}: ${told}`} onClick={onAlignment}>
      <span className="gv-you-are-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d={ICON[alignment]} /></svg>
      </span>
      <span className="gv-you-are-text"><strong>{told}</strong></span>
    </button>
  </div>;
}
