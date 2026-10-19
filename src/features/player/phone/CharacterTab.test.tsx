import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { lookupOfficialRole } from "@/data/officialRoles";
import type { PlayerSelfEnvelope } from "@/stores/types";
import { CharacterTab } from "./CharacterTab";

const imp = lookupOfficialRole("imp");
const tab = (self: PlayerSelfEnvelope) =>
  render(<CharacterTab self={self} role={imp} isTraveller={false} art="/imp.png" dead={false} />);

describe("Character tab bluffs", () => {
  it("a Demon sent bluffs but no teammates (small game, Poppy Grower) still sees the bluffs", () => {
    tab({ shownRole: "imp", shownAlignment: "evil", infoHistory: [{ id: "e1", bluffs: ["chef", "monk", "saint"] }] } as PlayerSelfEnvelope);
    const group = screen.getByRole("group", { name: "Bluffs, not in play" });
    for (const n of ["Chef", "Monk", "Saint"]) expect(within(group).getByText(n)).toBeInTheDocument();
    expect(screen.queryByText("Your team")).toBeNull();
  });

  it("bluffs from the current packet alone (no history yet) also show", () => {
    tab({ shownRole: "imp", shownAlignment: "evil", bluffs: ["chef"] } as PlayerSelfEnvelope);
    expect(within(screen.getByRole("group", { name: "Bluffs, not in play" })).getByText("Chef")).toBeInTheDocument();
  });

  it("with teammates the team panel keeps its title and the bluffs", () => {
    tab({ shownRole: "imp", shownAlignment: "evil", infoHistory: [{ id: "e1", minions: [{ id: "p-g", name: "Greta", seat: 4 }], bluffs: ["chef"] }] } as PlayerSelfEnvelope);
    expect(screen.getByText("Your team")).toBeInTheDocument();
    expect(screen.getByText("Greta")).toBeInTheDocument();
    expect(screen.getByText("Chef")).toBeInTheDocument();
  });

  it("an evil player sent nothing sees no team or bluffs panel", () => {
    tab({ shownRole: "imp", shownAlignment: "evil" } as PlayerSelfEnvelope);
    expect(screen.queryByRole("group", { name: "Bluffs, not in play" })).toBeNull();
    expect(screen.queryByText("Your team")).toBeNull();
  });
});
