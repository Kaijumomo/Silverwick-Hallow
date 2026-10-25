import { getBuiltinScript } from "@/data/scripts";
import { formatCode } from "@/firebase/lobby";
import { iconUrlFor } from "@/data/iconUrl";
import { lookupOfficialRole } from "@/data/officialRoles";
import { isDeadState, publicLifeStateOf } from "@/stores/lifeState";
import type { PlayerPublicRecord, PublicLobbyRecord } from "@/stores/types";

// Package 4G: the Town Square Display's view model. Everything the stage shows
// is derived here from the PUBLIC lobby record alone -- no new field, no
// private data -- and the copy is the Town Square Display v5 prototype's.

export type DisplayStatus = "live" | "reconnecting" | "notLinked" | "ended";
/** `none` ("No result was recorded") is a presentation the public record
 * cannot currently carry; it is reachable only through the explicit prop. */
export type EndedWinner = "good" | "evil" | "none" | null;

export type SeatView =
  | { kind: "empty"; index: number; roman: string }
  | { kind: "player"; index: number; player: PlayerPublicRecord };

export type GlowItem = { id: string; kind: "fabled" | "loric"; name: string; src: string };

export type TownSquareView = {
  tone: "night" | "day";
  /** Selects the scene's lighting and title treatment. */
  mode: "live" | "waiting" | "good" | "evil" | "none" | "ended" | "notLinked";
  scriptName: string | null;
  eyebrow: string;
  title: string;
  sub: string;
  /** The waiting scene sets its code smaller than the other titles. */
  compactTitle: boolean;
  seatCount: number;
  /** The seat count the stage geometry is laid out for: the real count, or the
   * prototype's default table (15) when no seats are drawn. */
  layoutCount: number;
  seats: SeatView[];
  glow: GlowItem[];
  /** Waiting only: the join link and the code shown beneath the QR. */
  join: { url: string; code: string } | null;
  reconnecting: boolean;
};

export type TownSquareInput = {
  lobby: PublicLobbyRecord | null;
  status: DisplayStatus;
  /** Ended scene only. Defaults to the lobby's own `winner`. */
  winner?: EndedWinner;
  joinUrl?: string;
};

const ROMAN_PAIRS: Array<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1) return String(Math.max(0, Math.trunc(n) || 0));
  let rest = n;
  let out = "";
  for (const [value, glyph] of ROMAN_PAIRS) while (rest >= value) { out += glyph; rest -= value; }
  return out;
}

function glowItems(lobby: PublicLobbyRecord): GlowItem[] {
  const resolve = (ids: string[] | undefined, kind: GlowItem["kind"]): GlowItem[] =>
    (ids ?? []).flatMap((id) => {
      const role = lookupOfficialRole(id);
      return role ? [{ id: role.id, kind, name: role.name, src: iconUrlFor(role) }] : [];
    });
  return [...resolve(lobby.fabled, "fabled"), ...resolve(lobby.lorics, "loric")];
}

const DEFAULT_LAYOUT_COUNT = 15;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function seatViews(lobby: PublicLobbyRecord, total: number): SeatView[] {
  return Array.from({ length: total }, (_, index): SeatView => {
    const id = lobby.seatOrder[index];
    const player = id ? lobby.players[id] : undefined;
    return player ? { kind: "player", index, player } : { kind: "empty", index, roman: roman(index + 1) };
  });
}

export function buildTownSquareView(input: TownSquareInput): TownSquareView {
  const { lobby, status } = input;
  const base = {
    scriptName: lobby ? getBuiltinScript(lobby.scriptId)?.name ?? null : null,
    compactTitle: false,
    seatCount: 0,
    layoutCount: DEFAULT_LAYOUT_COUNT,
    seats: [] as SeatView[],
    glow: [] as GlowItem[],
    join: null as TownSquareView["join"],
    reconnecting: status === "reconnecting",
  };

  if (status === "notLinked" || (!lobby && status !== "ended")) {
    return {
      ...base, tone: "night", mode: "notLinked", scriptName: null,
      eyebrow: "Town Square", title: "Not Linked", sub: "Open Invite in the Grimoire to link this screen",
    };
  }

  const ended = status === "ended" || lobby?.phase === "ended";
  if (ended) {
    const winner: EndedWinner = input.winner !== undefined ? input.winner : lobby?.winner ?? null;
    // The final record's presence flags froze when the game ended: no seat is drawn as offline.
    const final = lobby ? { ...lobby, players: Object.fromEntries(Object.entries(lobby.players).map(([id, p]) => [id, { ...p, online: true }])) } : null;
    const seatCount = final ? final.seatOrder.length : 0;
    return {
      ...base,
      tone: winner === "good" || winner === "none" ? "day" : "night",
      mode: winner ?? "ended",
      eyebrow: "Game over",
      title: winner === "good" ? "Good Wins" : winner === "evil" ? "Evil Wins" : "Game Ended",
      sub: winner === "none" ? "No result was recorded" : "Thank you for playing",
      seatCount,
      layoutCount: seatCount || DEFAULT_LAYOUT_COUNT,
      seats: final ? seatViews(final, seatCount) : [],
      glow: final ? glowItems(final) : [],
    };
  }

  // Beyond this point `lobby` is present.
  const live = lobby!;
  if (live.phase === "setup") {
    const total = Math.max(live.plannedPlayers ?? 0, live.seatOrder.length);
    const joined = live.arrivals?.length ?? live.seatOrder.length;
    return {
      ...base, tone: "night", mode: "waiting",
      eyebrow: "Join the town",
      title: formatCode(live.code).replace("-", "·"),
      sub: live.plannedPlayers ? `${joined} of ${live.plannedPlayers} have joined` : plural(joined, "has joined", "have joined"),
      compactTitle: true,
      seatCount: total,
      layoutCount: total || DEFAULT_LAYOUT_COUNT,
      seats: seatViews(live, total),
      join: input.joinUrl ? { url: input.joinUrl, code: live.code } : null,
    };
  }

  const night = live.phase === "night";
  const numeral = roman(Math.max(1, live.day));
  const seatCount = live.seatOrder.length;
  const seats = seatViews(live, seatCount);
  const players = seats.flatMap((s) => (s.kind === "player" ? [s.player] : []));
  // Decision 9: at Night nothing about Life is shown -- no totals either.
  const dead = night ? 0 : players.filter((p) => { const life = publicLifeStateOf(p); return life !== null && isDeadState(life); }).length;
  const travellers = players.filter((p) => p.isTraveler).length;
  return {
    ...base, tone: night ? "night" : "day", mode: "live",
    eyebrow: `${night ? "Night" : "Day"} ${numeral}`,
    title: night ? "Nightfall" : `${players.length - dead} Alive`,
    sub: night
      ? "Deaths are revealed at dawn"
      : [`${dead} dead`, travellers ? plural(travellers, "traveller", "travellers") : ""].filter(Boolean).join(" · "),
    seatCount, layoutCount: seatCount || DEFAULT_LAYOUT_COUNT, seats, glow: glowItems(live),
  };
}
