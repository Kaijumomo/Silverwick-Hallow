import { iconUrlFor } from "@/data/iconUrl";
import type { RoleDef } from "@/stores/types";

/**
 * SV-4a (the Cerenovus, then the Evil Twin): the YouAreRow's layout for two CHARACTER tokens -- the woken player's name, then each
 * token's disc with its heading and character side by side ("Selected You · Cerenovus", "This Character · Sage"). Each token opens the
 * existing player-safe reveal unchanged (the caller's onFirst / onSecond); this row is presentation only and records nothing.
 */
export type WakeToken = { heading: string; role: RoleDef; onOpen: () => void };

export function WakeTokensRow({ name, first, second }: { name: string; first: WakeToken; second: WakeToken }) {
  return <div className="gv-you-are" role="group" aria-label={`Wake ${name}`}>
    <span className="gv-you-are-name"><small>Wake</small>{name}</span>
    {[first, second].map((token, index) => <button key={index} type="button" className="gv-you-are-token" aria-label={`Wake ${name}: ${token.heading}`} onClick={token.onOpen}>
      <span className="gv-you-are-disc" aria-hidden="true"><img src={iconUrlFor(token.role)} alt="" draggable={false} /></span>
      <span className="gv-you-are-text"><strong>{token.heading}</strong><small>{token.role.name}</small></span>
    </button>)}
  </div>;
}
