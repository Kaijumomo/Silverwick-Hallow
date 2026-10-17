import type { RoleDef } from "@/stores/types";
import { iconUrlFor } from "@/data/iconUrl";
import { travellerArt } from "@/data/localArt";

const art = (r: RoleDef) => travellerArt(r.id) ?? iconUrlFor(r);

/** Choose your Traveler (design screens 37-40), the content of the in-game
 * frame's Character tab: the grid, the sending pill,
 * the error box, and the pending token. One tap sends the choice straight
 * away (no confirm step); a pending request is immutable until the
 * Storyteller clears it. */
export function TravellerChoicePanel({ travellers, busyId, error, pendingId, onChoose }: {
  travellers: readonly RoleDef[];
  /** The Traveller whose choice is being sent right now. */
  busyId: string | null;
  error: string | null;
  /** The submitted request still waiting for the Storyteller. */
  pendingId: string | null;
  onChoose: (id: string) => void;
}) {
  const sending = busyId !== null;
  const pending = pendingId ? travellers.find((r) => r.id === pendingId) : undefined;
  return (
    <div className="swp-trav" role="region" aria-label="Choose your Traveler">
      {pendingId ? (
        <div className="swp-trav-pending">
          <span className="swp-trav-eyebrow">Your Traveler</span>
          <div className="swp-trav-big">
            <span className="swp-trav-ring" />
            {pending && <span role="img" aria-label={pending.name} className="swp-token-art" style={{ backgroundImage: `url(${art(pending)})` }} />}
          </div>
          <span className="swp-trav-pname">{pending?.name ?? pendingId}</span>
          {pending?.ability && <span className="swp-trav-pability">{pending.ability}</span>}
          <div role="status" className="swp-trav-pill swp-trav-pill-violet">
            <span className="swp-trav-pilldot" />{pending?.name ?? pendingId} selected · waiting for Storyteller
          </div>
        </div>
      ) : (
        <>
          <div className="swp-trav-head">
            <span className="swp-trav-eyebrow">Traveller</span>
            <h1 className="swp-trav-title">Choose your Traveler</h1>
            <p className="swp-trav-help">The Storyteller has marked you as a Traveler. Pick your character below — it can’t be changed while it waits for the Storyteller.</p>
          </div>
          {sending && (
            <div role="status" className="swp-trav-pill swp-trav-pill-gold">
              <span className="swp-trav-pilldot swp-trav-pilldot-gold" />Sending your choice…
            </div>
          )}
          {error && <div role="alert" className="swp-trav-error">{error}</div>}
          <div className="swp-trav-grid">
            {travellers.map((r) => {
              const on = busyId === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`swp-trav-cell${on ? " swp-trav-cell-on" : ""}${sending && !on ? " swp-trav-cell-dim" : ""}`}
                  aria-disabled={sending}
                  onClick={() => { if (!sending) onChoose(r.id); }}
                >
                  <span className="swp-trav-token">
                    <span className="swp-trav-token-ring" />
                    <span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${art(r)})` }} />
                  </span>
                  <span className="swp-trav-name">{r.name}</span>
                  <span className="swp-trav-ability">{r.ability}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
