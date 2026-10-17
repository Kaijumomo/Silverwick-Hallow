import { useEffect, useMemo, useState } from "react";
import { lookupOfficialRole } from "@/data/officialRoles";
import { getBuiltinScript } from "@/data/scripts";
import { iconUrlFor } from "@/data/iconUrl";
import { travellerArt } from "@/data/localArt";
import { GENERIC_TEAM_ICON } from "@/features/home/art";
import { TRAVELERS } from "@/data/travelers";
import type { PlayerSelfEnvelope, PublicLobbyRecord } from "@/stores/types";
import { SeatedChart, type ChartSeat } from "./SeatedChart";
import { RevealScreen, type RevealCharacter, type RevealTone } from "./RevealScreen";
import { EvilTeamScreen, type TeamBluff, type TeamMate } from "./EvilTeamScreen";
import { TravellerChoice } from "./TravellerChoice";

type Stage = "chart" | "reveal" | "team" | "traveller";

const TYPE_LABEL: Record<string, string> = {
  townsfolk: "Townsfolk", outsider: "Outsider", minion: "Minion", demon: "Demon", traveler: "Traveller", traveller: "Traveller",
};

/** Whether the pre-game ceremony applies: before the game begins, until the
 * player has acknowledged the current identity, or while a Traveller still has
 * to choose. Reloading re-seals the token, so a returning player in Setup
 * passes through the circle again. */
export function showsPreGame(phase: PublicLobbyRecord["phase"], hasSelf: boolean, mode: "first" | "updated" | "seen", needsTravellerChoice: boolean): boolean {
  return phase === "setup" || needsTravellerChoice || (hasSelf && mode !== "seen");
}

/** The team the Storyteller told this player about (names, seats and Minion /
 * Demon designation only; never a teammate's character). Travellers never
 * get the team screen: their Demon information stays in From the Storyteller. */
export function teamOf(self: PlayerSelfEnvelope, isTraveller: boolean): { mates: TeamMate[]; bluffs: TeamBluff[] } {
  if (isTraveller) return { mates: [], bluffs: [] };
  const mates: TeamMate[] = [];
  if (self.demon) mates.push({ name: self.demon.name, seat: self.demon.seat, designation: "Demon", icon: GENERIC_TEAM_ICON.demon });
  for (const m of self.minions ?? []) mates.push({ name: m.name, seat: m.seat, designation: "Minion", icon: GENERIC_TEAM_ICON.minion });
  const bluffs: TeamBluff[] = [];
  for (const id of self.bluffs ?? []) {
    const r = lookupOfficialRole(id);
    bluffs.push({ id, name: r?.name ?? id, art: iconUrlFor(r ?? id) });
  }
  return { mates, bluffs };
}

export function PreGameFlow({
  publicLobby, playerId, ownName, self, mode, acknowledged, needsTravellerChoice, pendingTravellerId, busyTravellerId, travellerError,
  onChooseTraveller, onAcknowledge, onEnter,
}: {
  publicLobby: PublicLobbyRecord;
  playerId: string | null;
  ownName: string;
  self: PlayerSelfEnvelope | null;
  mode: "first" | "updated" | "seen";
  acknowledged: boolean;
  needsTravellerChoice: boolean;
  pendingTravellerId: string | null;
  busyTravellerId: string | null;
  travellerError: string | null;
  onChooseTraveller: (id: string) => void;
  /** Records that this player has seen their identity (advisory). */
  onAcknowledge: () => void;
  /** Leaves the ceremony for the game. */
  onEnter: () => void;
}) {
  const [stage, setStage] = useState<Stage>("chart");
  const token = self?.revealToken;
  const mine = playerId ? publicLobby.players[playerId] : undefined;
  const isTraveller = !!mine?.isTraveler;

  // A new identity re-seals: back to the circle, never mid-ceremony.
  useEffect(() => { setStage((s) => (s === "reveal" || s === "team" ? "chart" : s)); }, [token]);
  // The Storyteller applied the Traveller choice: straight to the reveal.
  useEffect(() => {
    if (stage === "traveller" && !needsTravellerChoice) setStage(self ? "reveal" : "chart");
  }, [stage, needsTravellerChoice, self]);

  const seats: ChartSeat[] = useMemo(
    () => publicLobby.seatOrder
      .map((id) => publicLobby.players[id])
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ seat: p.seat + 1, name: p.name }))
      .sort((a, b) => a.seat - b.seat),
    [publicLobby],
  );
  const scriptName = getBuiltinScript(publicLobby.scriptId)?.name;
  const ownSeat = mine ? mine.seat + 1 : 0;

  const role = self ? lookupOfficialRole(self.shownRole) : undefined;
  const team = self ? teamOf(self, isTraveller) : { mates: [], bluffs: [] };
  const hasTeam = team.mates.length > 0 || team.bluffs.length > 0;

  if (stage === "traveller") {
    return (
      <TravellerChoice
        travellers={TRAVELERS}
        busyId={busyTravellerId}
        error={travellerError}
        pendingId={pendingTravellerId}
        onChoose={onChooseTraveller}
      />
    );
  }

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
        me={{ name: ownName, roleName: role?.name ?? self.shownRole, art: iconUrlFor(role ?? self.shownRole) }}
        mates={team.mates}
        bluffs={team.bluffs}
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
    ? { label: "Choose your Traveler", onClick: () => setStage("traveller") }
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
