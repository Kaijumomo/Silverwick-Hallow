import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvilTeamScreen, type TeamMate } from "./EvilTeamScreen";

const mate = (i: number, designation: TeamMate["designation"]): TeamMate => ({ name: `Mate${i}`, seat: i, designation, icon: "/x.png" });
const bluffs = [{ id: "chef", name: "Chef", art: "/c.png" }, { id: "monk", name: "Monk", art: "/m.png" }, { id: "saint", name: "Saint", art: "/s.png" }];
const me = (over: Partial<{ type: "Demon" | "Minion"; lilMonsta: boolean }> = {}) => ({ name: "Bram", seat: 1, type: "Minion" as const, art: "/b.png", lilMonsta: false, ...over });

function paths(container: HTMLElement) { return [...container.querySelectorAll("svg path")].map((p) => p.getAttribute("d") ?? ""); }
function screenOf(m: readonly TeamMate[], opts: { me?: ReturnType<typeof me>; bluffs?: typeof bluffs; evilOf?: number } = {}) {
  return render(<EvilTeamScreen me={opts.me ?? me()} mates={m} bluffs={opts.bluffs ?? []} evilOf={opts.evilOf ?? 13} onContinue={() => undefined} />);
}

describe("EvilTeamScreen draws only what the Storyteller supplied", () => {
  it("never names Lil' Monsta for a Minion just because no Demon was supplied, and keeps the supplied bluffs", () => {
    const { container } = screenOf([mate(2, "Minion"), mate(3, "Minion")], { bluffs });
    expect(screen.queryByText(/Lil' Monsta/)).toBeNull();
    expect(screen.queryByText("Demon")).toBeNull();
    expect(screen.getByText(/Only your team sees this\. 3 of 13 players are evil\./)).toBeInTheDocument();
    for (const b of bluffs) expect(screen.getByText(b.name)).toBeInTheDocument();
    expect(paths(container).join(" ")).not.toMatch(/NaN|undefined/);
  });

  it("a team of five names no character in the caption", () => {
    screenOf([mate(2, "Demon"), mate(3, "Minion"), mate(4, "Minion"), mate(5, "Minion")]);
    expect(screen.queryByText(/Typhon/)).toBeNull();
    expect(screen.getByText(/5 of 13 players are evil/)).toBeInTheDocument();
  });

  it("a Lil' Monsta holder is told about their own character, and still sees supplied bluffs", () => {
    screenOf([mate(2, "Minion")], { me: me({ type: "Demon", lilMonsta: true }), bluffs });
    expect(screen.getByText(/choose who babysits Lil' Monsta/)).toBeInTheDocument();
    expect(screen.getByText("Chef")).toBeInTheDocument();
  });
});

describe("larger evil teams", () => {
  for (const minions of [4, 5, 6, 7, 8, 9]) {
    it(`Demon + ${minions} Minions: every player once, valid lines, no overlapping tokens`, () => {
      const m = [mate(2, "Demon"), ...Array.from({ length: minions - 1 }, (_, i) => mate(i + 3, "Minion"))];
      const { container } = screenOf(m, { evilOf: 15 });
      for (const x of m) expect(screen.getAllByText(x.name)).toHaveLength(1);
      expect(screen.getByText("Bram")).toBeInTheDocument();
      const d = paths(container);
      expect(d).toHaveLength(minions);
      for (const p of d) expect(p).toMatch(/^M-?[\d.]+ -?[\d.]+( C-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+)$/);
      const boxes = [...container.querySelectorAll<HTMLElement>(".swp-evt-node")].map((n) => ({ l: parseFloat(n.style.left), t: parseFloat(n.style.top) }));
      const tokens = [...container.querySelectorAll<HTMLElement>(".swp-evt-token")].map((n, i) => ({ ...boxes[i]!, w: parseFloat(n.style.width) }));
      for (let i = 0; i < tokens.length; i++) for (let j = i + 1; j < tokens.length; j++) {
        const a = tokens[i]!, b = tokens[j]!;
        const apart = Math.abs(a.l - b.l) >= 70 || Math.abs(a.t - b.t) >= 100;
        expect(apart).toBe(true);
      }
    });
  }
});
