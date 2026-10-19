import { useEffect, useState } from "react";
import { lookupOfficialRole } from "@/data/officialRoles";
import { iconUrlFor } from "@/data/iconUrl";
import { GENERIC_TEAM_ICON } from "@/features/home/art";
import type { PlayerSelfEnvelope, RoleDef } from "@/stores/types";
import { MoonBack, type RevealTone } from "./RevealScreen";
import { latestTeam, TYPE_COLOUR, teamKeyOf, wakeLine } from "./gameModel";

const TYPE_LABEL: Record<string, string> = {
  townsfolk: "Townsfolk", outsider: "Outsider", minion: "Minion", demon: "Demon", traveller: "Traveller",
};

/** Time the hide transition and token turn need before the face is unmounted. */
const CONCEAL_MS = 850;

/** The Character tab (design 09/10): the token, the name, the ability, and
 * for evil players the team panel. Tapping the token turns it face-down; the
 * face and everything under it then leave the page so nothing readable stays
 * behind a face-down token. No information history is shown here. */
export function CharacterTab({ self, role, isTraveller, art, dead }: {
  self: PlayerSelfEnvelope;
  role: RoleDef | undefined;
  isTraveller: boolean;
  art: string;
  dead: boolean;
}) {
  const typeKey = isTraveller ? "traveller" : teamKeyOf(role?.type);
  const tone: RevealTone = isTraveller ? "traveller" : self.shownAlignment === "evil" ? "evil" : self.shownAlignment === "good" ? "good" : "plain";
  const team = self.shownAlignment === "good" ? "Good" : self.shownAlignment === "evil" ? "Evil" : null;
  const { mates, bluffs } = latestTeam(self, isTraveller);
  const evil = self.shownAlignment === "evil" && mates.length > 0;
  const [flipped, setFlipped] = useState(false);
  const [concealed, setConcealed] = useState(false);

  useEffect(() => {
    if (!flipped) { setConcealed(false); return undefined; }
    const t = window.setTimeout(() => setConcealed(true), CONCEAL_MS);
    return () => window.clearTimeout(t);
  }, [flipped]);

  const name = role?.name ?? self.shownRole;
  const hide = flipped ? " swp-ctl-hidden" : "";

  return (
    <div className={`swp-ctl${evil ? " swp-ctl-evil" : ""}`}>
      <section className="swp-ctl-head" aria-label="Your character">
        <div className={`swp-ctok swp-tone-${tone}`}>
          <button type="button" className="swp-ctok-btn" aria-label="Flip token" aria-pressed={flipped} onClick={() => setFlipped((f) => !f)}>
            <span className={`swp-ctok-flip${flipped ? " swp-ctok-flipped" : ""}`}>
              <span className="swp-ctok-side swp-ctok-front">
                {!concealed && (
                  <>
                    <span className="swp-ctok-ring" />
                    <span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${art})` }} />
                    {dead && <span className="swp-token-veil" aria-hidden="true" />}
                  </>
                )}
              </span>
              <span className="swp-ctok-side swp-ctok-back" role="img" aria-label="Face-down token"><MoonBack /></span>
            </span>
          </button>
        </div>
        {!concealed && (
          <>
            <div className={`swp-ctl-text${hide}`} aria-hidden={flipped} >
              <span className="swp-ctl-eyebrow">You are the</span>
              <h1 className="swp-ctl-name">{name}</h1>
              <span className="swp-ctl-type">
                <span style={{ color: TYPE_COLOUR[typeKey] }}>{TYPE_LABEL[typeKey]}</span>
                {team && (<><span className="swp-reveal-dot">·</span><span className={`swp-team-${team.toLowerCase()}`}>{team}</span></>)}
              </span>
              <span className="swp-ctl-wake">{wakeLine(role, isTraveller)}</span>
            </div>
            {role?.ability && <p className={`swp-ctl-ability${hide}`} aria-hidden={flipped}>{role.ability}</p>}
          </>
        )}
      </section>

      {evil && !concealed && (
        <section className={`swp-ctl-team${hide}`} aria-label="Your team" aria-hidden={flipped}>
          <span className="swp-ctl-team-title">Your team</span>
          <div className="swp-ctl-mates">
            {mates.map((m) => (
              <div key={`${m.seat}-${m.name}`} className="swp-ctl-mate">
                <span className="swp-ctl-mate-token"><span role="img" aria-label="" className="swp-ctl-mate-art" style={{ backgroundImage: `url(${GENERIC_TEAM_ICON[m.designation === "Demon" ? "demon" : "minion"]})` }} /></span>
                <span className="swp-ctl-mate-name">{m.name}</span>
                <span className="swp-ctl-mate-sub">Seat {m.seat + 1} · {m.designation}</span>
              </div>
            ))}
          </div>
          {bluffs.length > 0 && (
            <div className="swp-ctl-bluffs" role="group" aria-label="Bluffs, not in play">
              <span className="swp-ctl-bluffs-title">Bluffs</span>
              <div className="swp-ctl-bluffs-row">
                {bluffs.map((id) => {
                  const r = lookupOfficialRole(id);
                  return (
                    <div key={id} className="swp-ctl-bluff">
                      <span className="swp-ctl-bluff-token"><span role="img" aria-label="" className="swp-ctl-mate-art" style={{ backgroundImage: `url(${iconUrlFor(r ?? id)})` }} /></span>
                      <span className="swp-ctl-bluff-name">{r?.name ?? id}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
