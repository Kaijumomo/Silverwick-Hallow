// Phase 10F (10F-AC-29): during Night the public projection carries no Life
// State, and NO public surface implies one -- not through text, accessible
// names, CSS state classes, token art, shroud or vote token. Day resumes the
// normal grammar from Current State.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PublicSeat } from "./PublicSeat";
import { TownView } from "@/features/player/PlayerScreen";
import { projectLobbyToPublic } from "@/stores/projections";
import { setupGame } from "@/test/setupFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

afterEach(cleanup);

function table(phase: StorytellerLobbyRecord["phase"]) {
  const g = setupGame(["washerwoman", "chef", "empath", "fortuneteller", "monk", "poisoner", "imp"], { phase, day: 2, code: "NITE" });
  g.players.p1 = { ...g.players.p1!, alive: false, ghostVote: false }; // died earlier (or tonight)
  g.players.p2 = { ...g.players.p2!, alive: false, ghostVote: true };
  return projectLobbyToPublic(g, { p0: true });
}

const LIFE_WORDS = /\b(dead|alive|exiled|vote available|vote used)\b/i;

describe("10F-AC-29: Night public-Life withholding in the DOM", () => {
  it("Public Display seats render no Life text, label, class, shroud or vote token at Night", () => {
    const pub = table("night");
    const { container } = render(<div>{pub.seatOrder.map((id, i) => <PublicSeat key={id} player={pub.players[id]!} size={60} x={i} y={i} />)}</div>);
    const html = container.innerHTML;
    expect(container.querySelectorAll('[data-testid="life-shroud"], [data-testid="vote-token"], .public-seat-ghost, .token-dead, .token-alive')).toHaveLength(0);
    for (const seat of container.querySelectorAll(".public-seat")) {
      expect(seat.className).toContain("life-withheld");
      expect(seat.className).not.toMatch(/\b(alive|dead)\b|life-(alive|dead|exiled)/);
      expect(seat.getAttribute("aria-label")).toMatch(/life not shown during the night$/);
      expect(seat.getAttribute("aria-label")).not.toMatch(LIFE_WORDS);
    }
    expect(container.textContent).not.toMatch(LIFE_WORDS);
    // Dead and living seats are indistinguishable.
    const seats = [...container.querySelectorAll(".public-seat")];
    expect(new Set(seats.map((s) => s.className.replace(/offline/, "").trim())).size).toBe(1);
    expect(html).not.toContain("PublicDead");
  });

  it("the player town list renders no Life text, count, label or class at Night; Day shows them again", () => {
    const night = render(<TownView publicLobby={table("night")} ownPlayerId="p0" code="NITE" scriptCharacters={[]} />);
    expect(night.container.textContent).not.toMatch(LIFE_WORDS);
    expect(night.container.querySelectorAll(".town-row.dead, .life-state-text")).toHaveLength(0);
    for (const row of night.container.querySelectorAll(".town-row")) expect(row.className).toContain("life-withheld");
    for (const button of night.container.querySelectorAll(".town-row-main")) expect(button.getAttribute("aria-label")).not.toMatch(LIFE_WORDS);
    night.unmount();

    const day = render(<TownView publicLobby={table("day")} ownPlayerId="p0" code="NITE" scriptCharacters={[]} />);
    expect(day.container.textContent).toMatch(/5\/7 alive/);
    expect(day.container.querySelectorAll(".town-row.dead")).toHaveLength(2);
    expect(day.container.textContent).toMatch(/Dead · vote used/);
  });
});
