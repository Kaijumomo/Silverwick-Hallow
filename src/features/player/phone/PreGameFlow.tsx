import { useEffect, useMemo, useRef, useState } from "react";
import { lookupOfficialRole } from "@/data/officialRoles";
import { publicScriptOf } from "@/data/publicScript";
import { iconUrlFor } from "@/data/iconUrl";
import { travellerArt } from "@/data/localArt";
import { GENERIC_TEAM_ICON } from "@/features/home/art";
import type { PlayerSelfEnvelope, PublicLobbyRecord } from "@/stores/types";
import { SeatedChart, type ChartSeat } from "./SeatedChart";
import { RevealScreen, type RevealCharacter, type RevealTone } from "./RevealScreen";
import { EvilTeamScreen, type TeamBluff, type TeamMate } from "./EvilTeamScreen";
import { latestTeam } from "./gameModel";

type Stage = "chart" | "reveal" | "team";

const TYPE_LABEL: Record<string, string> = {
  townsfolk: "Townsfolk", outsider: "Outsider", minion: "Minion", demon: "Demon", traveler: "Traveller", traveller: "Traveller",
};

/** Whether the sealed ceremony applies: whenever the player holds a character
 * they have not turned over on this load, in any phase. Reloading always
 * re-seals the token: in Setup the player passes through the circle again,
 * during Day and Night they land on the sealed token. */
export function showsPreGame(phase: PublicLobbyRecord["phase"], hasSelf: boolean, _mode: "first" | "updated" | "seen", needsTravellerChoice: boolean): boolean {
  return phase === "setup" || needsTravellerChoice || hasSelf;
}

/** In Day or Night an already-acknowledged identity re-seals straight to the
 * token (the circle is a Setup scene). A new or updated identity keeps the
 * circle, which carries the neutral "updated your character" notice. */
const sealsAtToken = (phase: PublicLobbyRecord["phase"], mode: "first" | "updated" | "seen", hasSelf: boolean): boolean =>
  hasSelf && phase !== "setup" && mode === "seen";

/** The team the Storyteller told this player about (names, seats and Minion /
 * Demon designation only; never a teammate's character), from the player's
 * information history. Travellers never get the team screen: their Demon
 * information is no longer shown on the phone. */
export function teamOf(self: PlayerSelfEnvelope, isTraveller: boolean): { mates: TeamMate[]; bluffs: TeamBluff[] } {
  const { mates, bluffs } = latestTeam(self, isTraveller);
  return {
    mates: mates.map((m) => ({ ...m, icon: m.designation === "Demon" ? GENERIC_TEAM_ICON.demon : GENERIC_TEAM_ICON.minion })),
    bluffs: bluffs.map((id) => {
      const r = lookupOfficialRole(id);
      return { id, name: r?.name ?? id, art: iconUrlFor(r ?? id) };
    }),
  };
}

export function PreGameFlow({
  publicLobby, playerId, ownName, self, mode, acknowledged, needsTravellerChoice, startAtReveal,
  onOpenTravellerChoice, onAcknowledge, onEnter,
}: {
  publicLobby: PublicLobbyRecord;
  playerId: string | null;
  ownName: string;
  self: PlayerSelfEnvelope | null;
  mode: "first" | "updated" | "seen";
  acknowledged: boolean;
  needsTravellerChoice: boolean;
  /** The Traveller just had their character applied: go straight to the token. */
  startAtReveal: boolean;
  /** Opens the in-game Character tab with the Traveller choice. */
  onOpenTravellerChoice: () => void;
  /** Records that this player has seen their identity (advisory). */
  onAcknowledge: () => void;
  /** Leaves the ceremony for the game. */
  onEnter: () => void;
}) {
  const [stage, setStage] = useState<Stage>((startAtReveal || sealsAtToken(publicLobby.phase, mode, !!self)) && self ? "reveal" : "chart");
  const token = self?.revealToken;
  const mine = playerId ? publicLobby.players[playerId] : undefined;
  const isTraveller = !!mine?.isTraveler;

  // A new identity re-seals: back to the circle, never mid-ceremony.
  const lastToken = useRef(token);
  useEffect(() => {
    if (lastToken.current === token) return;
    lastToken.current = token;
    setStage((s) => (s === "reveal" || s === "team" ? "chart" : s));
  }, [token]);
  // The Storyteller applied the Traveller choice: straight to the reveal, as
  // soon as the character itself has arrived.
  const jumped = useRef((startAtReveal || sealsAtToken(publicLobby.phase, mode, !!self)) && !!self);
  const wantsToken = startAtReveal || sealsAtToken(publicLobby.phase, mode, !!self);
  useEffect(() => {
    if (!wantsToken || !self || jumped.current) return;
    jumped.current = true;
    setStage((s) => (s === "chart" ? "reveal" : s));
  }, [wantsToken, self]);

  const seats: ChartSeat[] = useMemo(
    () => publicLobby.seatOrder
      .map((id) => publicLobby.players[id])
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ seat: p.seat + 1, name: p.name }))
      .sort((a, b) => a.seat - b.seat),
    [publicLobby],
  );
  const scriptName = publicScriptOf(publicLobby).name;
  const ownSeat = mine ? mine.seat + 1 : 0;

  const role = self ? lookupOfficialRole(self.shownRole) : undefined;
  const team = self ? teamOf(self, isTraveller) : { mates: [], bluffs: [] };
  const hasTeam = team.mates.length > 0 || team.bluffs.length > 0;

  if (stage === "reveal" && self) {
    const tone: RevealTone = isTraveller || role?.type === "traveler" ? "traveller" : self.shownAlignment === "evil" ? "evil" : self.shownAlignment === "good" ? "good" : "plain";
    const typeKey = (role?.type ?? "townsfolk").replace("traveler", "traveller");
    const character: RevealCharacter = {
      name: role?.name ?? self.shownRole,
      typeLabel: TYPE_LABEL[role?.type ?? "townsfolk"] ?? "",
      typeKey,
      ...(self.shownAlignment === "good" ? { team: "Good" as const } : self.shownAlignment === "evil" ? { team: "Evil" as const } : {}),
      ...(role?.ability ? { ability: role.ability } : {}),
      art: (tone === "traveller" ? travellerArt(self.shownRole) : undefined) ?? iconUrlFor(role ?? self.shownRole),
      tone,
    };
    return (
      <RevealScreen
        key={token ?? "role"}
        character={character}
        continueLabel={hasTeam ? "Meet your team" : "Enter the town"}
        onTurned={() => { if (!acknowledged) onAcknowledge(); }}
        onContinue={() => { if (hasTeam) setStage("team"); else onEnter(); }}
      />
    );
  }

  if (stage === "team" && self) {
    return (
      <EvilTeamScreen
        me={{
          name: ownName,
          seat: mine?.seat ?? 0,
          type: role?.type === "demon" ? "Demon" : "Minion",
          art: iconUrlFor(role ?? self.shownRole),
          lilMonsta: self.shownRole === "lilmonsta",
        }}
        mates={team.mates}
        bluffs={team.bluffs}
        evilOf={seats.length - publicLobby.seatOrder.filter((id) => publicLobby.players[id]?.isTraveler).length}
        onContinue={onEnter}
      />
    );
  }

  const line = needsTravellerChoice || (isTraveller && !self)
    ? "The Storyteller has marked you as a Traveler. Choose who you will be."
    : !self
      ? `${ownName}, the Storyteller is setting up the game.`
      : mode === "updated"
        ? `${ownName}, the Storyteller has updated your character.`
        : `${ownName}, the night is coming. Your character has been sealed.`;
  const action = needsTravellerChoice
    ? { label: "Choose your Traveler", onClick: onOpenTravellerChoice }
    : self
      ? { label: "Receive your character", onClick: () => setStage("reveal") }
      : undefined;

  return (
    <SeatedChart
      {...(scriptName ? { scriptName } : {})}
      seats={seats}
      ownSeat={ownSeat}
      line={line}
      {...(action ? { action } : {})}
    />
  );
}
