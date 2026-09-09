import type { PlayerSelfRecord } from "@/stores/types";
import { lookupOfficialRole } from "@/data/officialRoles";

/** Shared sanitized content view: no ST state, role truth, or team inference. */
export function PrivateInformation({ payload, showIdentity = false, showBluffs = false }: {
  payload: PlayerSelfRecord; showIdentity?: boolean; showBluffs?: boolean;
}) {
  return <div className="sealed-card-extras">
    {showIdentity && <p>{lookupOfficialRole(payload.shownRole)?.name ?? payload.shownRole}{payload.shownAlignment && ` · ${payload.shownAlignment}`}</p>}
    {payload.demon && <p>Demon: {payload.demon.name} · seat {payload.demon.seat + 1}</p>}
    {showBluffs && !!payload.bluffs?.length && <p>Bluffs: {payload.bluffs.map(id => lookupOfficialRole(id)?.name ?? id).join(", ")}</p>}
    {!!payload.minions?.length && <div>
      <span className="label">Your Minions</span>
      <ul>{payload.minions.map(p => <li key={p.id}>{p.name} · seat {p.seat + 1}</li>)}</ul>
    </div>}
    {payload.extraText && <p style={{ whiteSpace: "pre-wrap" }}>{payload.extraText}</p>}
  </div>;
}
