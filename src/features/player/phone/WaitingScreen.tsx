import { BackButton, DiamondRule, PhoneFrame } from "./PhoneParts";

export type Arrival = { name: string; you: boolean };

/** Lists the arrivals with the player's own row marked. `arrivals` is the
 * public, names-only list (A1); the player's own row is matched by the name
 * they asked to join with, and always shown even if the list has not caught up. */
export function arrivalRows(arrivals: readonly string[] | undefined, ownName: string): Arrival[] {
  const rows: Arrival[] = [];
  let marked = false;
  for (const name of arrivals ?? []) {
    const you = !marked && name === ownName;
    if (you) marked = true;
    rows.push({ name, you });
  }
  if (!marked) rows.push({ name: ownName, you: true });
  return rows;
}

export function arrivalCountText(rows: readonly Arrival[], planned: number | undefined): string {
  return planned && planned >= rows.length ? `${rows.length} of ${planned} arrived` : `${rows.length} arrived`;
}

/** "Roll call": the waiting lobby (design screen 04). */
export function WaitingScreen({ ownName, arrivals, planned, leaving, onLeave }: {
  ownName: string;
  arrivals: readonly string[] | undefined;
  planned: number | undefined;
  leaving: boolean;
  onLeave: () => void;
}) {
  const rows = arrivalRows(arrivals, ownName);
  return (
    <PhoneFrame glow="join" label="waiting">
      <div className="swp-page">
        <BackButton label="Leave town" onClick={() => { if (!leaving) onLeave(); }} />
        <div className="swp-wait-body">
          <DiamondRule />
          <div className="swp-wait-head">
            <div className="swp-fell" style={{ fontSize: 16 }}>You have entered the town</div>
            <h1 className="swp-title swp-wait-welcome">Welcome, {ownName}</h1>
          </div>
          <div className="swp-wait-list">
            <div className="swp-wait-listhead">
              <span className="swp-eyebrow">In the town</span>
              <span className="swp-wait-count" role="status">{arrivalCountText(rows, planned)}</span>
            </div>
            <div className="swp-wait-rows" role="list" aria-label="In the town">
              {rows.map((row, i) => (
                <div key={i} role="listitem" className={`swp-wait-row${row.you ? " swp-wait-row-you" : ""}`}>
                  <span className="swp-wait-name">{row.name}</span>
                  {row.you && <span className="swp-wait-tag">You</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="swp-wait-foot">
          <span className="swp-dot" aria-hidden="true" />
          <div className="swp-title swp-wait-foot-title">Waiting for the Storyteller</div>
          <p className="swp-fell swp-wait-foot-line">You’ll be given a seat once the town is gathered.</p>
        </div>
      </div>
    </PhoneFrame>
  );
}
