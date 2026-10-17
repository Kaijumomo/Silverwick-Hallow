import { lookupOfficialRole } from "@/data/officialRoles";
import { iconUrlFor } from "@/data/iconUrl";
import { GENERIC_TEAM_ICON } from "@/features/home/art";
import type { PlayerSelfEnvelope, RoleDef } from "@/stores/types";
import { TokenFace, type RevealTone } from "./RevealScreen";
import { historyRows, latestTeam, TYPE_COLOUR, teamKeyOf, wakeLine } from "./gameModel";

const TYPE_LABEL: Record<string, string> = {
  townsfolk: "Townsfolk", outsider: "Outsider", minion: "Minion", demon: "Demon", traveller: "Traveller",
};

/** Long character names step down so they stay on one line beside the token. */
const nameSize = (length: number): number => (length > 11 ? 24 : length > 8 ? 27 : 30);

/** The Character tab (design: banner, ability, From the Storyteller, Your
 * team). Everything here comes from the player's own envelope: the shown role,
 * the shown alignment and the information history the Storyteller delivered. */
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
  const rows = historyRows(self);
  const { mates, bluffs } = latestTeam(self, isTraveller);
  const partial = self.infoHistoryPartial === true;

  return (
    <div className="swp-char">
      <section className="swp-banner" aria-label="Your character">
        <span className={`swp-banner-token swp-tone-${tone}`}>
          <TokenFace art={art} tone={tone} />
          {dead && <span className="swp-token-veil" aria-hidden="true" />}
        </span>
        <div className="swp-banner-text">
          <span className="swp-banner-eyebrow">You are the</span>
          <h1 className="swp-banner-name" style={{ fontSize: nameSize((role?.name ?? self.shownRole).length) }}>{role?.name ?? self.shownRole}</h1>
          <span className="swp-banner-type">
            <span style={{ color: TYPE_COLOUR[typeKey] }}>{TYPE_LABEL[typeKey]}</span>
            {team && (<><span className="swp-reveal-dot">·</span><span className={`swp-team-${team.toLowerCase()}`}>{team}</span></>)}
          </span>
          <span className="swp-banner-wake">{wakeLine(role, isTraveller)}</span>
        </div>
      </section>

      {role?.ability && <p className="swp-char-ability">{role.ability}</p>}

      {(rows.length > 0 || partial) && (
        <section className="swp-box" aria-label="From the Storyteller">
          <span className="swp-box-title">From the Storyteller</span>
          {rows.map((row) => (
            <div key={row.id} className="swp-info-row">
              <span className="swp-info-when">{row.when}</span>
              <span className="swp-info-what">{row.lines.map((line, i) => <span key={i} className="swp-info-line">{line}</span>)}</span>
            </div>
          ))}
          {partial && <p className="swp-info-partial" role="status">Some earlier information could not be loaded.</p>}
        </section>
      )}

      {mates.length > 0 && (
        <section className="swp-box swp-box-evil" aria-label="Your team">
          <span className="swp-box-title swp-box-title-evil">Your team</span>
          {mates.map((m) => (
            <div key={`${m.seat}-${m.name}`} className="swp-mate">
              <span className="swp-mate-token"><span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${GENERIC_TEAM_ICON[m.designation === "Demon" ? "demon" : "minion"]})` }} /></span>
              <span className="swp-mate-name">{m.name}</span>
              <span className="swp-mate-sub">Seat {m.seat + 1} · {m.designation}</span>
            </div>
          ))}
          {bluffs.length > 0 && (
            <div className="swp-bluffrow" role="group" aria-label="Bluffs, not in play">
              {bluffs.map((id) => {
                const r = lookupOfficialRole(id);
                return (
                  <div key={id} className="swp-bluff">
                    <div className="swp-bluff-token swp-bluff-token-lg"><span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${iconUrlFor(r ?? id)})` }} /></div>
                    <span className="swp-bluff-name">{r?.name ?? id}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
