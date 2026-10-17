import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PlayerSelfEnvelope, PublicLobbyRecord } from "@/stores/types";
import { compositionFor, entryLines, historyRows, latestTeam, momentLabel, wakeLine } from "./gameModel";
import { TownTab } from "./TownTab";

afterEach(cleanup);

const base: PlayerSelfEnvelope = { shownRole: "imp", shownAlignment: "evil" };

describe("history rows", () => {
  it("label the moment, and fall back to the root packet only when the history key is absent", () => {
    expect(momentLabel({ phase: "night", day: 2 })).toBe("Night 2");
    expect(momentLabel({ phase: "day", day: 3 })).toBe("Day 3");
    expect(momentLabel(undefined)).toBe("Earlier");
    expect(historyRows({ ...base, extraText: "Old packet" })).toEqual([{ id: "current", when: "Earlier", lines: ["Old packet"] }]);
    // A present (even empty) history is authoritative: the root packet is never read.
    expect(historyRows({ ...base, extraText: "Old packet", infoHistory: [] })).toEqual([]);
  });

  it("summarise team and bluff entries without naming anyone", () => {
    const lines = entryLines({ id: "a", text: "Hello", demon: { id: "d", name: "Dee", seat: 2 }, minions: [{ id: "m", name: "Max", seat: 4 }], bluffs: ["chef", "empath", "monk"] });
    expect(lines).toEqual(["Hello", "You learnt your Demon, fellow Minions and bluffs"]);
    expect(lines.join(" ")).not.toMatch(/Dee|Max|Chef/);
  });

  it("a Traveller's Demon information stays under From the Storyteller, by name and seat", () => {
    expect(entryLines({ id: "a", demon: { id: "d", name: "Dee", seat: 2 } }, true)).toEqual(["Your Demon: Dee, seat 3"]);
  });

  it("the team is the latest entry that named it; bluffs the latest that showed them", () => {
    const team = latestTeam({
      ...base,
      infoHistory: [
        { id: "a", minions: [{ id: "m1", name: "Old", seat: 1 }], bluffs: ["chef", "empath", "monk"] },
        { id: "b", minions: [{ id: "m2", name: "New", seat: 3 }] },
        { id: "c", text: "no team here" },
      ],
    }, false);
    expect(team.mates).toEqual([{ name: "New", seat: 3, designation: "Minion" }]);
    expect(team.bluffs).toEqual(["chef", "empath", "monk"]);
    expect(latestTeam({ ...base, infoHistory: [{ id: "a", minions: [{ id: "m", name: "X", seat: 1 }] }] }, true)).toEqual({ mates: [], bluffs: [] });
  });
});

describe("wake line", () => {
  it("comes from the role's own night order", () => {
    expect(wakeLine({ firstNight: 5, otherNight: 9 }, false)).toBe("Wakes each night");
    expect(wakeLine({ otherNight: 9 }, false)).toBe("Wakes each night except the first");
    expect(wakeLine({ firstNight: 5 }, false)).toBe("Wakes on the first night only");
    expect(wakeLine({}, false)).toBe("Does not wake at night");
    expect(wakeLine({ otherNight: 4 }, true)).toBe("Wakes at night");
    expect(wakeLine(undefined, true)).toBe("Does not wake at night");
  });
});

describe("composition", () => {
  it("is the official starting mix for 5-15 residents and nothing outside it", () => {
    expect(compositionFor(7)).toEqual({ townsfolk: 5, outsider: 0, minion: 1, demon: 1 });
    expect(compositionFor(12)).toEqual({ townsfolk: 7, outsider: 2, minion: 2, demon: 1 });
    expect(compositionFor(4)).toBeNull();
    expect(compositionFor(16)).toBeNull();
  });
});

function lobby(phase: PublicLobbyRecord["phase"], count: number, over: { travellers?: number; dead?: number[] } = {}): PublicLobbyRecord {
  const players: PublicLobbyRecord["players"] = {};
  const seatOrder: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `p${i}`;
    seatOrder.push(id);
    players[id] = {
      id, name: `Player${i + 1}`, seat: i, online: true, joinedAt: 0, isTraveler: i >= count - (over.travellers ?? 0),
      ...(phase === "night" || phase === "setup" ? {} : { alive: !over.dead?.includes(i), ghostVote: true }),
    };
  }
  return { code: "ABCD2345", scriptId: "tb", phase, day: phase === "setup" ? 0 : 2, seatOrder, fabled: [], lorics: [], players };
}

describe("Town tab", () => {
  it("by day shows alive count, the execution threshold and the standard composition for residents only", () => {
    render(<TownTab lobby={lobby("day", 9, { travellers: 1, dead: [1, 2, 3] })} ownId="p0" />);
    const centre = document.querySelector(".swp-ring-centre")!;
    expect(centre).toHaveTextContent("6");
    expect(centre).toHaveTextContent("alive");
    expect(centre).toHaveTextContent("3 votes to execute");
    const mix = screen.getByRole("region", { name: "Composition" });
    // 8 residents: 5 Townsfolk, 1 Outsider, 1 Minion, 1 Demon; the Traveller is not counted.
    expect(within(mix).getAllByText(/^[0-9]+$/).map((n) => n.textContent)).toEqual(["5", "1", "1", "1"]);
    expect(mix).not.toHaveTextContent(/standard starting mix|travellers/i);
    // Deaths never change it.
    expect(screen.getAllByRole("img", { name: /dead/ })).toHaveLength(3);
  });

  it("at Night hides life, the alive count and the threshold; names and seats stay", () => {
    render(<TownTab lobby={lobby("night", 7)} ownId="p0" />);
    const town = document.querySelector(".swp-town")!;
    expect(town).not.toHaveTextContent(/alive|dead|ghost|votes to execute/i);
    expect(town).toHaveTextContent("The town sleeps");
    expect(screen.getAllByRole("img", { name: /^Seat \d/ })).toHaveLength(7);
    expect(screen.getByRole("img", { name: "Seat 1, Player1, you" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Composition" })).toBeInTheDocument();
  });

  it("shows no composition outside the official 5-15 range, and still seats twenty", () => {
    const { unmount } = render(<TownTab lobby={lobby("day", 4)} ownId="p0" />);
    expect(screen.queryByRole("region", { name: "Composition" })).toBeNull();
    unmount();
    render(<TownTab lobby={lobby("day", 20, { travellers: 5 })} ownId="p0" />);
    expect(screen.getAllByRole("img", { name: /^Seat \d/ })).toHaveLength(20);
    expect(screen.getByRole("region", { name: "Composition" })).toHaveTextContent("Townsfolk");
  });
});
