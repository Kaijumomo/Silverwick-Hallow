import { useEffect, useState, type ReactNode } from "react";
import { lookupOfficialRole } from "@/data/officialRoles";
import { iconUrlFor } from "@/data/iconUrl";
import { travellerArt } from "@/data/localArt";
import type { PlayerSelfEnvelope, PublicLobbyRecord } from "@/stores/types";
import { CharacterTab } from "./CharacterTab";
import { DeathVeil } from "./DeathVeil";
import { GameFrame, type GameTab } from "./GameFrame";
import { TownTab } from "./TownTab";

const veilKey = (code: string, playerId: string | null) => `swp-veil:${code}:${playerId ?? ""}`;
const readSeen = (key: string): boolean => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const writeSeen = (key: string, seen: boolean) => {
  try { if (seen) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch { /* the veil simply shows again after a reload */ }
};

/** The player's in-game phone: header, four tabs and the death veil.
 *
 * `character` replaces the Character tab's content (the Traveller choice);
 * `notes` and `script` are the Notes and Script tabs' content. */
export function GameScreen({ publicLobby, self, playerId, code, name, phaseLabel, character, notes, script }: {
  publicLobby: PublicLobbyRecord;
  self: PlayerSelfEnvelope | null;
  playerId: string | null;
  code: string;
  name: string;
  /** "Day 2", "Night 2" or "Setting up". */
  phaseLabel: string;
  character?: ReactNode;
  notes: ReactNode;
  script: ReactNode;
}) {
  const [tab, setTab] = useState<GameTab>("character");
  const key = veilKey(code, playerId);
  const [veilSeen, setVeilSeen] = useState(() => readSeen(key));
  const mine = playerId ? publicLobby.players[playerId] : undefined;
  const isTraveller = !!mine?.isTraveler;
  const role = self ? lookupOfficialRole(self.shownRole) : undefined;
  const dead = !!self?.life && !self.life.alive;
  const vote = !!self?.life?.ghostVote;
  const exiled = !!self?.life?.exiled;

  // Alive again: the next death shows the veil again.
  useEffect(() => {
    if (self?.life?.alive) { writeSeen(key, false); setVeilSeen(false); }
  }, [self?.life?.alive, key]);

  const art = self
    ? (isTraveller || role?.type === "traveler" ? travellerArt(self.shownRole) : undefined) ?? iconUrlFor(role ?? self.shownRole)
    : "";
  const veilTone = isTraveller || role?.type === "traveler" ? "traveller" : self?.shownAlignment === "evil" ? "evil" : self?.shownAlignment === "good" ? "good" : "plain";
  const seat = mine ? `Seat ${mine.seat + 1}` : null;
  const eyebrow = [phaseLabel, seat].filter(Boolean).join(" · ");

  const body = tab === "character"
    ? character ?? (self
      ? <CharacterTab self={self} role={role} isTraveller={isTraveller} art={art} dead={dead} />
      : <p className="swp-char-ability" role="status">Your role isn't ready yet.</p>)
    : tab === "notes" ? notes
    : tab === "town" ? <TownTab lobby={publicLobby} ownId={playerId} />
    : script;

  return (
    <GameFrame
      eyebrow={eyebrow}
      name={name}
      code={code}
      tab={tab}
      onTab={setTab}
      {...(dead ? { ghost: { label: `${exiled ? "Exiled" : "Ghost"} · ${vote ? "1 vote" : "vote used"}` } } : {})}
      overlay={dead && !veilSeen && self && !character
        ? <DeathVeil art={art} tone={veilTone} vote={vote} onContinue={() => { writeSeen(key, true); setVeilSeen(true); }} />
        : undefined}
    >
      {body}
    </GameFrame>
  );
}
