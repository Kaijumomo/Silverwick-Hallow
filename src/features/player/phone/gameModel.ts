import { hasVoteAvailable, isDeadState, publicLifeStateOf } from "@/stores/lifeState";
import { SETUP_COUNTS, type BagCounts } from "@/data/setupCounts";
import type { PlayerInfoView, PlayerSelfEnvelope, PublicLobbyRecord, RoleDef } from "@/stores/types";

/** Package 3 (3C): the pure model behind the in-game phone screens. */

export type TeamKey = "townsfolk" | "outsider" | "minion" | "demon" | "traveller";

export const TYPE_COLOUR: Record<TeamKey, string> = {
  townsfolk: "#86b7d4", outsider: "#94c29a", minion: "#d97a6c", demon: "#e3894c", traveller: "#b994d4",
};

export const teamKeyOf = (type: string | undefined): TeamKey => {
  const key = (type ?? "townsfolk").replace("traveler", "traveller");
  return (key in TYPE_COLOUR ? key : "townsfolk") as TeamKey;
};

/** "Night 2" / "Day 3". Entries delivered in Setup have no moment. */
export function momentLabel(moment: PlayerInfoView["moment"]): string {
  if (!moment) return "Earlier";
  return `${moment.phase === "night" ? "Night" : "Day"} ${moment.day}`;
}


const joinList = (items: string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** What one history entry says, as the lines shown in "From the Storyteller".
 * Text is shown verbatim. Team and bluff entries are summarised in one line
 * ("You learnt your Minions and bluffs"): who they are lives in "Your team". */
export function entryLines(entry: PlayerInfoView): string[] {
  const lines: string[] = [];
  if (entry.text) lines.push(entry.text);
  const minions = entry.minions?.length ?? 0;
  const learnt: string[] = [];
  if (entry.demon) learnt.push("Demon");
  if (minions) learnt.push(entry.demon ? "fellow Minions" : minions === 1 ? "Minion" : "Minions");
  if (entry.bluffs?.length) learnt.push(entry.bluffs.length === 1 ? "bluff" : "bluffs");
  if (learnt.length) lines.push(`You learnt your ${joinList(learnt)}`);
  return lines;
}

export type HistoryRow = { id: string; when: string; lines: string[] };

/** The player's complete history, oldest first. When the Storyteller device
 * predates the history (no `infoHistory` at all), the current packet stands in
 * as one undated entry so nothing the player was told disappears. */
export function historyOf(self: PlayerSelfEnvelope): PlayerInfoView[] {
  if (self.infoHistory) return self.infoHistory;
  const entry: PlayerInfoView = { id: "current" };
  if (self.extraText) entry.text = self.extraText;
  if (self.demon) entry.demon = { id: self.demon.id, name: self.demon.name, seat: self.demon.seat };
  if (self.minions?.length) entry.minions = self.minions.map((m) => ({ id: m.id, name: m.name, seat: m.seat }));
  if (self.bluffs?.length) entry.bluffs = [...self.bluffs];
  return entry.text || entry.demon || entry.minions || entry.bluffs ? [entry] : [];
}

export function historyRows(self: PlayerSelfEnvelope): HistoryRow[] {
  return historyOf(self)
    .map((e) => ({ id: e.id, when: momentLabel(e.moment), lines: entryLines(e) }))
    .filter((row) => row.lines.length > 0);
}

export type TeamMate = { name: string; seat: number; designation: "Minion" | "Demon" };

/** The team the player was told about: the latest entry that named a Demon or
 * Minions, and the latest that named bluffs. Names, seats and designations
 * only; never a teammate's character. Travellers never get a team box. */
export function latestTeam(self: PlayerSelfEnvelope, isTraveller: boolean): { mates: TeamMate[]; bluffs: string[] } {
  if (isTraveller) return { mates: [], bluffs: [] };
  const history = historyOf(self);
  const teamEntry = [...history].reverse().find((e) => e.demon || e.minions?.length);
  const bluffEntry = [...history].reverse().find((e) => e.bluffs?.length);
  const mates: TeamMate[] = [];
  if (teamEntry?.demon) mates.push({ name: teamEntry.demon.name, seat: teamEntry.demon.seat, designation: "Demon" });
  for (const m of teamEntry?.minions ?? []) mates.push({ name: m.name, seat: m.seat, designation: "Minion" });
  return { mates, bluffs: bluffEntry?.bluffs ?? [] };
}

/** The role's own wake pattern, from its night order. */
export function wakeLine(role: Pick<RoleDef, "firstNight" | "otherNight"> | undefined, isTraveller: boolean): string {
  const first = !!role?.firstNight;
  const other = !!role?.otherNight;
  if (isTraveller) return first || other ? "Wakes at night" : "Does not wake at night";
  if (first && other) return "Wakes each night";
  if (other) return "Wakes each night except the first";
  if (first) return "Wakes on the first night only";
  return "Does not wake at night";
}

/** Official starting composition for the resident count (Travellers excluded);
 * null outside the official 5-15 range. Never the real bag. */
export function compositionFor(residents: number): BagCounts | null {
  return SETUP_COUNTS[residents] ?? null;
}

export type TownSeat = {
  id: string;
  seat: number;
  name: string;
  you: boolean;
  traveller: boolean;
  /** null while public life is withheld (Night, Setup). */
  dead: boolean | null;
  ghostVote: boolean;
};

/** Seat-ordered public roster for the circle. Life comes only from the public
 * projection, which already withholds it at Night (dead stays null there). */
export function townSeats(lobby: PublicLobbyRecord, ownId: string | null): TownSeat[] {
  return lobby.seatOrder
    .map((id) => lobby.players[id])
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => {
      const life = publicLifeStateOf(p);
      return {
        id: p.id, seat: p.seat + 1, name: p.name, you: p.id === ownId, traveller: p.isTraveler,
        dead: life === null ? null : isDeadState(life),
        ghostVote: life !== null && hasVoteAvailable(life),
      };
    })
    .sort((a, b) => a.seat - b.seat);
}

/** Votes needed to execute: half the living, rounded up (Day only). */
export const votesToExecute = (alive: number): number => Math.ceil(alive / 2);
