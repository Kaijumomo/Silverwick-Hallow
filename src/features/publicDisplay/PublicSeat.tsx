import { lookupOfficialRole } from "@/data/officialRoles";
import { iconUrlFor } from "@/data/iconUrl";
import { hasVoteAvailable, isDeadState, lifeAccessibleLabel, publicLifeStateOf } from "@/stores/lifeState";
import type { PlayerPublicRecord } from "@/stores/types";

// Package 4G: a Town Square seat. Residents show the initial of the player's
// name; Travellers show their public character art with the role name on an
// arc. Dead players (Day only) are covered by the torn-away shroud and greyed;
// at Night the public life state is withheld, so a seat implies nothing about
// Life (10F-AC-29) -- no class, label, shroud or marker is rendered for it.

type SeatProps = {
  /** The DISC centre in stage pixels. */
  x: number;
  y: number;
  /** Disc diameter and the name's type size, from seatSizeFor(). */
  size: number;
  nameSize?: number;
  /** The widest the name plate may grow before the name ellipsises. */
  plateMax?: number;
  showSeatNumber?: boolean;
};

type Props = SeatProps & { player: PlayerPublicRecord };

export function PublicSeat({ player, size, x, y, nameSize = 24, plateMax, showSeatNumber = true }: Props) {
  const role = player.publicDisplayRole ? lookupOfficialRole(player.publicDisplayRole) : null;
  const traveller = player.isTraveler || !!role;
  // Phase 10F: null while Life State is withheld (Night).
  const life = publicLifeStateOf(player);
  const dead = life !== null && isDeadState(life);
  const seatNumber = player.seat + 1;
  const arcId = `tsArc${player.seat}`;
  const arcLabel = role?.name ?? (player.isTraveler ? "Traveler" : null);
  const lifeClass = life === null ? "life-withheld" : `${dead ? "dead" : "alive"} life-${life}`;

  return (
    <div
      className={`ts-seat public-seat ${lifeClass}${player.online ? "" : " offline"}`}
      data-kind={traveller ? "traveller" : "resident"}
      data-dead={dead ? "true" : "false"}
      style={{ left: x, top: y }}
      role="group"
      aria-label={lifeAccessibleLabel(player.name, seatNumber, life)}
    >
      <div className="ts-seat-anchor" style={{ left: -size / 2, top: -size / 2, width: size, height: size }}>
        <div className="ts-disc">
          <div className="ts-disc-ring" />
          {!role && (
            <div className="ts-disc-mark" style={{ fontSize: Math.round(size * 0.36) }}>
              {(player.name.trim()[0] ?? "").toUpperCase()}
            </div>
          )}
          {role && (
            <div
              className="ts-art-img"
              role="img"
              aria-label={role.name}
              style={{ backgroundImage: `url(${iconUrlFor(role)})` }}
            />
          )}
          {arcLabel && (
            <svg className="ts-arc" viewBox="0 0 100 100" aria-hidden="true">
              <defs><path id={arcId} d="M 10 54 A 40 40 0 0 0 90 54" fill="none" /></defs>
              <text textAnchor="middle"><textPath href={`#${arcId}`} startOffset="50%">{arcLabel}</textPath></text>
            </svg>
          )}
          {dead && life && <TornShroud />}
        </div>
        {dead && life && hasVoteAvailable(life) && <span className="ts-ghost" data-testid="ghost-vote" title="Ghost vote available" aria-hidden="true" />}
        <div className="ts-plate" style={plateMax ? { maxWidth: plateMax } : undefined}>
          {showSeatNumber && <span className="ts-plate-seat" style={{ fontSize: Math.round(nameSize * 0.78) }}>{seatNumber}</span>}
          <span className="ts-plate-name" style={{ fontSize: nameSize }}>{player.name}</span>
        </div>
        {!player.online && <span className="ts-sr">offline</span>}
      </div>
    </div>
  );
}

/** A seat nobody has taken yet (the waiting scene): a dashed disc with the
 * seat's Roman numeral and a "Seat N" plate. */
export function EmptySeat({ index, roman, size, x, y, nameSize = 24, plateMax }: SeatProps & { index: number; roman: string }) {
  return (
    <div className="ts-seat public-seat-empty" data-kind="empty" data-dead="false" style={{ left: x, top: y }} role="group" aria-label={`Seat ${index + 1}, empty`}>
      <div className="ts-seat-anchor" style={{ left: -size / 2, top: -size / 2, width: size, height: size }}>
        <div className="ts-empty-disc" style={{ fontSize: Math.round(size * 0.36) }}>{roman}</div>
        <div className="ts-plate" style={plateMax ? { maxWidth: plateMax } : undefined}>
          <span className="ts-plate-name" style={{ fontSize: nameSize }}>{`Seat ${index + 1}`}</span>
        </div>
      </div>
    </div>
  );
}

const SHROUD_EDGE = "M0 55L5 59L10 56L14 62L19 58L23 65L28 61L32 68L37 63L41 70L46 65L51 71L55 64L60 69L64 62L69 67L74 60L78 64L83 57L87 61L92 54L95 58L100 55";
const SHROUD_SHADOW = "M0 57L5 61L10 58L14 64L19 60L23 67L28 63L32 70L37 65L41 72L46 67L51 73L55 66L60 71L64 64L69 69L74 62L78 66L83 59L87 63L92 56L95 60L100 57";

/** The torn-away shroud: the lower part of the token stays visible, the rest is
 * covered. Shared gradient `tsVoid` is defined once by the stage; the fallback
 * colour keeps a lone seat covered too. */
function TornShroud() {
  return (
    <svg className="ts-shroud" viewBox="0 0 100 100" aria-hidden="true" data-testid="life-shroud">
      <path d={`M0 0H100V55L95 58L92 54L87 61L83 57L78 64L74 60L69 67L64 62L60 69L55 64L51 71L46 65L41 70L37 63L32 68L28 61L23 65L19 58L14 62L10 56L5 59L0 55Z`} fill="url(#tsVoid) #0b080e" />
      <path d={SHROUD_EDGE} fill="none" stroke="#fff6e0" strokeOpacity=".75" strokeWidth="2.2" strokeLinejoin="round" />
      <path d={SHROUD_SHADOW} fill="none" stroke="#5a3e1e" strokeOpacity=".35" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="30" cy="30" r=".6" fill="#e8dcc0" opacity=".5" />
      <circle cx="72" cy="24" r=".8" fill="#e8dcc0" opacity=".6" />
      <circle cx="56" cy="38" r=".5" fill="#e8dcc0" opacity=".45" />
      <circle cx="14" cy="40" r=".5" fill="#e8dcc0" opacity=".4" />
    </svg>
  );
}
