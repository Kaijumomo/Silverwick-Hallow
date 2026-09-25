import { lookupOfficialRole } from "@/data/officialRoles";
import { iconUrlFor } from "@/data/iconUrl";
import { lifeAccessibleLabel, publicLifeStateOf } from "@/stores/lifeState";
import { LifeShroud, LifeStateText, VoteToken } from "@/features/life/LifeMarks";
import type { PlayerPublicRecord } from "@/stores/types";

type Props = {
  player: PlayerPublicRecord;
  size: number;
  x: number;
  y: number;
};

export function PublicSeat({ player, size, x, y }: Props) {
  const role = player.publicDisplayRole
    ? lookupOfficialRole(player.publicDisplayRole)
    : null;
  // Phase 10A: one public life grammar. The shroud and vote token overlay
  // the seat whether or not Traveler role art is shown -- a dead Traveler
  // stays visibly dead (previously the art replaced the death marker).
  const life = publicLifeStateOf(player);

  const tokenSrc = !player.alive && player.ghostVote
    ? "/tokens/PublicDeadVote.png"
    : !player.alive
    ? "/tokens/PublicDead.png"
    : "/tokens/PublicAlive.png";

  const stateIcon = (
    <img
      className={`public-seat-state-png ${player.alive ? "token-alive" : "token-dead"}`}
      src={tokenSrc}
      alt=""
      draggable={false}
    />
  );

  return (
    <div
      className={`public-seat ${player.alive ? "alive" : "dead"} life-${life} ${player.online ? "" : "offline"}`}
      style={{
        left: `calc(50% + ${x}px)`,
        top: `calc(50% + ${y}px)`,
      }}
      role="group"
      aria-label={lifeAccessibleLabel(player.name, player.seat + 1, life)}
    >
      <div className="public-seat-disc-frame" style={{ width: size, height: size }}>
        <div className={`public-seat-disc${role ? "" : " empty"}`} style={{ width: size, height: size }}>
          {role ? (
            <img
              className="public-seat-art"
              src={iconUrlFor(role)}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : stateIcon}
          <span className="public-seat-num">{player.seat + 1}</span>
          {!player.online && (
            <span
              className="public-seat-offline"
              title="Offline"
              aria-label="Offline"
            />
          )}
          <LifeShroud state={life} />
        </div>
        <VoteToken state={life} />
      </div>
      <div className="public-seat-name">{player.name}</div>
      {!player.alive && <LifeStateText state={life} className="public-seat-ghost" />}
      {role && <div className="public-seat-role">{role.name}</div>}
      {player.isTraveler && <div className="public-seat-traveler">traveler</div>}
    </div>
  );
}
