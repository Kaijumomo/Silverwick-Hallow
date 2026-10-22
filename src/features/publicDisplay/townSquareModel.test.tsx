import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { buildTownSquareView, roman } from "./townSquareModel";
import { TownSquare } from "./TownSquare";
import { PublicSeat } from "./PublicSeat";
import type { PlayerPublicRecord, PublicLobbyRecord } from "@/stores/types";

afterEach(cleanup);

function lobby(over: Partial<PublicLobbyRecord> & { count?: number; dead?: number[]; travellers?: number[] } = {}): PublicLobbyRecord {
  const { count = 10, dead = [], travellers = [], ...rest } = over;
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  const night = rest.phase === "night";
  return {
    code: "ABCD2345", scriptId: "tb", phase: "day", day: 2, fabled: [], lorics: [], seatOrder: ids,
    players: Object.fromEntries(ids.map((id, i): [string, PlayerPublicRecord] => [id, {
      id, name: `Player ${i + 1}`, seat: i, online: true, joinedAt: 0, isTraveler: travellers.includes(i),
      ...(travellers.includes(i) ? { publicDisplayRole: "thief" } : {}),
      ...(night ? {} : { alive: !dead.includes(i), ghostVote: dead.includes(i) }),
    }])),
    ...rest,
  };
}

describe("Town Square view model (Package 4G)", () => {
  it("writes Roman numerals", () => {
    expect([1, 2, 4, 9, 14, 20].map(roman)).toEqual(["I", "II", "IV", "IX", "XIV", "XX"]);
  });

  it("Day: counts the living and the dead, travellers included, and names the travellers", () => {
    const v = buildTownSquareView({ lobby: lobby({ dead: [1, 4], travellers: [8, 9] }), status: "live" });
    expect(v).toMatchObject({ tone: "day", mode: "live", eyebrow: "Day II", title: "8 Alive", sub: "2 dead · 2 travellers" });
    expect(buildTownSquareView({ lobby: lobby({ travellers: [9] }), status: "live" }).sub).toBe("0 dead · 1 traveller");
    expect(buildTownSquareView({ lobby: lobby(), status: "live" }).sub).toBe("0 dead");
  });

  it("Night (Decision 9): Nightfall, with no alive or dead totals anywhere", () => {
    const v = buildTownSquareView({ lobby: lobby({ phase: "night", day: 1, dead: [2], travellers: [9] }), status: "live" });
    expect(v).toMatchObject({ tone: "night", eyebrow: "Night I", title: "Nightfall", sub: "Deaths are revealed at dawn" });
    expect(JSON.stringify([v.eyebrow, v.title, v.sub])).not.toMatch(/alive|dead/i);
  });

  it("Setup: the waiting scene, seats left open, joined count from arrivals", () => {
    const v = buildTownSquareView({
      lobby: lobby({ phase: "setup", day: 0, count: 2, plannedPlayers: 7, arrivals: ["A", "B", "C"] }),
      status: "live", joinUrl: "https://x.test/?join=ABCD2345",
    });
    expect(v).toMatchObject({ mode: "waiting", eyebrow: "Join the town", title: "ABCD·2345", sub: "3 of 7 have joined", seatCount: 7 });
    expect(v.seats.map((s) => s.kind)).toEqual(["player", "player", "empty", "empty", "empty", "empty", "empty"]);
    expect(v.join).toEqual({ url: "https://x.test/?join=ABCD2345", code: "ABCD2345" });
  });

  it("Not linked and ended scenes use the prototype copy", () => {
    expect(buildTownSquareView({ lobby: null, status: "notLinked" })).toMatchObject({
      eyebrow: "Town Square", title: "Not Linked", sub: "Open Invite in the Grimoire to link this screen", seats: [], glow: [],
    });
    const wins = (winner: "good" | "evil" | "none" | null) => buildTownSquareView({ lobby: null, status: "ended", winner });
    expect(wins("good")).toMatchObject({ eyebrow: "Game over", title: "Good Wins", sub: "Thank you for playing", tone: "day" });
    expect(wins("evil")).toMatchObject({ title: "Evil Wins", tone: "night", mode: "evil" });
    expect(wins("none")).toMatchObject({ title: "Game Ended", sub: "No result was recorded", mode: "none" });
    // No winner on record: neutral, never a claim about the result.
    expect(wins(null)).toMatchObject({ title: "Game Ended", sub: "Thank you for playing" });
  });

  it("takes the winner from the public record when it carries one", () => {
    const v = buildTownSquareView({ lobby: lobby({ phase: "ended", winner: "evil", dead: [1] }), status: "live" });
    expect(v).toMatchObject({ title: "Evil Wins", seatCount: 10 });
  });

  it("lists active Fabled then Loric with their art, and nothing for unknown ids", () => {
    const v = buildTownSquareView({ lobby: lobby({ fabled: ["spiritofivory", "nope"], lorics: ["bootlegger"] }), status: "live" });
    expect(v.glow.map((g) => [g.kind, g.name])).toEqual([["fabled", "Spirit of Ivory"], ["loric", "Bootlegger"]]);
    expect(v.glow.every((g) => g.src.length > 0)).toBe(true);
  });

  it("names the script from the built-in list and omits a custom one", () => {
    expect(buildTownSquareView({ lobby: lobby(), status: "live" }).scriptName).toBe("Trouble Brewing");
    expect(buildTownSquareView({ lobby: lobby({ scriptId: "custom-xyz" }), status: "live" }).scriptName).toBeNull();
  });
});

describe("Town Square stage rendering (Package 4G)", () => {
  it("Day: shrouds and dims the dead, marks the ghost vote, and shows travellers' art with an arc label", () => {
    const view = buildTownSquareView({ lobby: lobby({ dead: [1], travellers: [9] }), status: "live" });
    const { container } = render(<TownSquare view={view} scale={1} motion={false} />);
    expect(container.querySelectorAll('[data-testid="life-shroud"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="ghost-vote"]')).toHaveLength(1);
    const dead = screen.getByRole("group", { name: /^Player 2, seat 2, dead/i });
    expect(dead).toHaveAttribute("data-dead", "true");
    const traveller = screen.getByRole("group", { name: /^Player 10, seat 10/ });
    expect(traveller).toHaveAttribute("data-kind", "traveller");
    expect(within(traveller).getByText("Thief")).toBeInTheDocument();
    expect(container.querySelector(".ts-stage")).toHaveAttribute("data-motion", "paused");
  });

  it("Night: no shroud, ghost marker, label or total reveals Life", () => {
    const view = buildTownSquareView({ lobby: lobby({ phase: "night", day: 1, dead: [1, 2] }), status: "live" });
    const { container } = render(<TownSquare view={view} scale={1} />);
    expect(container.querySelectorAll('[data-testid="life-shroud"], [data-testid="ghost-vote"]')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/\b(alive|dead)\b/i);
    expect(screen.getByText("Nightfall")).toBeInTheDocument();
  });

  it("shows the Fabled / Loric glow ring and the reconnecting pill", () => {
    const view = buildTownSquareView({ lobby: lobby({ fabled: ["spiritofivory"], lorics: ["bootlegger"] }), status: "reconnecting" });
    render(<TownSquare view={view} scale={1} />);
    expect(screen.getByText("Fabled")).toBeInTheDocument();
    expect(screen.getByText("Loric")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Spirit of Ivory" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting to the Storyteller…");
  });

  it("an offline player keeps an accessible mention but no visual indicator", () => {
    const pub = lobby({ count: 5 });
    render(<PublicSeat player={{ ...pub.players.p0!, online: false }} size={100} x={0} y={0} />);
    expect(screen.getByRole("group")).toHaveTextContent("offline");
    expect(document.querySelector(".public-seat-offline")).toBeNull();
  });
});
