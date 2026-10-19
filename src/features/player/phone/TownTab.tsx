import type { CSSProperties } from "react";
import type { PublicLobbyRecord } from "@/stores/types";
import { ringPoint } from "./PhoneParts";
import { compositionFor, TYPE_COLOUR, townSeats, votesToExecute } from "./gameModel";

const RING = 330;
const RADIUS = 136;

/** Seat names live inside the disc: short names at full size, longer ones step
 * down, the longest are cut with an ellipsis (the full name is the label). */
const nameSize = (name: string, disc: number): number => {
  const base = name.trim().length <= 5 ? 14 : name.trim().length <= 7 ? 12 : 10;
  return Math.round(base * Math.min(1, disc / 54) * 10) / 10;
};

/** The Town tab (design: the circle, its centre and legend) with the standard
 * Composition below it.
 *
 * Privacy (D7): public life status, the alive count and the execution
 * threshold are shown only while the public projection carries life, which it
 * does not at Night. Names and seats are always shown. The Composition is the
 * official starting mix for the resident count; it never reveals the actual
 * bag, special setup or what deaths have changed. */
export function TownTab({ lobby, ownId }: { lobby: PublicLobbyRecord; ownId: string | null }) {
  const seats = townSeats(lobby, ownId);
  const total = seats.length;
  const lifeShown = total > 0 && seats.every((s) => s.dead !== null);
  const alive = seats.filter((s) => s.dead === false).length;
  const disc = Math.max(30, Math.min(54, Math.floor((2 * Math.PI * RADIUS) / Math.max(total, 1)) - 4));
  const residents = seats.filter((s) => !s.traveller).length;
  const mix = compositionFor(residents);
  const hasTraveller = seats.some((s) => s.traveller);

  return (
    <div className="swp-town">
      <div className="swp-ring" style={{ width: RING, height: RING }}>
        <div className="swp-ring-disc" />
        <div className="swp-ring-centre">
          {lifeShown ? (
            <>
              <span className="swp-ring-count">{alive}</span>
              <span className="swp-ring-label">alive</span>
              <span className="swp-ring-sub">{votesToExecute(alive)} votes to execute</span>
            </>
          ) : (
            <>
              <span className="swp-ring-count">{total}</span>
              <span className="swp-ring-label">seated</span>
              {lobby.phase === "night" && <span className="swp-ring-sub">The town sleeps</span>}
            </>
          )}
        </div>
        {seats.map((s, rank) => {
          const p = ringPoint(rank, total, RING, RADIUS);
          const sub = s.you ? "You" : s.dead ? "Ghost" : "";
          const cls = ["swp-seat", s.dead ? "swp-seat-dead" : "", s.you ? "swp-seat-you" : "", s.traveller ? "swp-seat-trav" : ""].filter(Boolean).join(" ");
          const label = `Seat ${s.seat}, ${s.name}${s.you ? ", you" : ""}${s.traveller ? ", Traveller" : ""}${s.dead ? ", dead" : ""}`;
          return (
            <span
              key={s.id}
              className={cls}
              role="img"
              aria-label={label}
              style={{ left: p.x, top: p.y, width: disc, height: disc, marginLeft: -disc / 2, marginTop: -disc / 2 } as CSSProperties}
            >
              <span className="swp-seat-name" style={{ fontSize: nameSize(s.name, disc) }}>{s.name}</span>
              {sub && <span className="swp-seat-sub">{sub}</span>}
            </span>
          );
        })}
      </div>

      <div className="swp-legend" aria-label="Legend">
        {lifeShown && <span className="swp-legend-item"><span className="swp-legend-swatch swp-legend-alive" />Alive</span>}
        {lifeShown && <span className="swp-legend-item"><span className="swp-legend-swatch swp-legend-dead" />Dead</span>}
        {hasTraveller && <span className="swp-legend-item"><span className="swp-legend-swatch swp-legend-trav" />Traveler</span>}
      </div>

      {mix && (
        <section className="swp-comp" aria-label="Composition">
          <span className="swp-comp-title">Composition</span>
          <div className="swp-comp-grid">
            {([["townsfolk", "Townsfolk", mix.townsfolk], ["outsider", mix.outsider === 1 ? "Outsider" : "Outsiders", mix.outsider], ["minion", mix.minion === 1 ? "Minion" : "Minions", mix.minion], ["demon", "Demon", mix.demon]] as const).map(([key, label, n]) => (
              <div key={key} className="swp-comp-cell">
                <span className="swp-comp-num" style={{ color: TYPE_COLOUR[key] }}>{n}</span>
                <span className="swp-comp-label">{label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
