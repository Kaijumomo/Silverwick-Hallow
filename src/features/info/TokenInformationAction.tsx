import type { RoleDef } from "@/stores/types";
import { iconUrlFor } from "@/data/iconUrl";
import "./token-information.css";

/** Shared Storyteller preview only. The owner retains preparation, delivery,
 * privacy and stale-context checks; player-safe reveal uses PlayerPresentation. */
export function TokenInformationAction({ role, label, onClick, compact = false }: { role?: RoleDef; label: string; onClick: () => void; compact?: boolean }) {
  return <div className={`token-information-action${compact ? " token-information-action-compact" : ""}`}>
    {role && <div className="token-information-preview">
      <span className="token-information-disc"><img src={iconUrlFor(role)} alt="" draggable={false} /></span>
      <strong>{role.name}</strong>
    </div>}
    <button type="button" className="btn btn-gold" onClick={onClick}>{label}</button>
  </div>;
}
