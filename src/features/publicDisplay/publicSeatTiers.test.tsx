// Phase 10H pre-checkpoint (10H-AC-069): the compact Public Display density
// tiers shed SECONDARY presentation only. Seat number, player name, the public
// Traveler character, dead/alive (the worded shroud) and ghost-vote state
// (the vote token) always remain, and the seat's accessible name still states
// Life in full.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { PublicSeat } from "./PublicSeat";
import type { PlayerPublicRecord } from "@/stores/types";

afterEach(cleanup);

const deadTraveler: PlayerPublicRecord = {
  id: "t", name: "Tess", seat: 15, online: true, joinedAt: 0, isTraveler: true, publicDisplayRole: "thief", alive: false, ghostVote: true,
};
const deadNoVote: PlayerPublicRecord = { id: "d", name: "Dmitri", seat: 3, online: true, joinedAt: 0, isTraveler: false, alive: false, ghostVote: false };

function seat(player: PlayerPublicRecord, tier: { travelerPill: boolean; lifeText: boolean }) {
  const { container } = render(<PublicSeat player={player} size={60} x={0} y={0} width={96} {...tier} />);
  return container.querySelector<HTMLElement>(".public-seat")!;
}

describe("10H-AC-069: compact Public Display tiers keep primary public information", () => {
  it("full detail: name, Traveler character and pill, shroud, vote token, Life line", () => {
    const el = seat(deadTraveler, { travelerPill: true, lifeText: true });
    expect(within(el).getByText("Tess")).toBeInTheDocument();
    expect(within(el).getByText("Thief")).toBeInTheDocument();
    expect(el.querySelector(".public-seat-traveler")).toHaveTextContent("traveler");
    expect(el.querySelector('[data-testid="life-shroud"]')).toHaveTextContent("Dead");
    expect(el.querySelector('[data-testid="vote-token"]')).toHaveClass("available");
    expect(el.querySelector(".public-seat-ghost")).toHaveTextContent("Dead · vote available");
  });

  it("compact: only the Traveler pill goes -- the public Traveler character and the Life line stay", () => {
    const el = seat(deadTraveler, { travelerPill: false, lifeText: true });
    expect(el.querySelector(".public-seat-traveler")).toBeNull();
    expect(within(el).getByText("Thief")).toBeInTheDocument();
    expect(el.querySelector(".public-seat-ghost")).toHaveTextContent("Dead · vote available");
  });

  it("minimal: the Life TEXT line goes too, while the worded shroud, the vote token, name and seat number remain", () => {
    for (const [player, vote] of [[deadTraveler, "available"], [deadNoVote, "used"]] as const) {
      const el = seat(player, { travelerPill: false, lifeText: false });
      expect(el.querySelector(".public-seat-ghost")).toBeNull();
      expect(within(el).getByText(player.name)).toBeInTheDocument();
      expect(el.querySelector(".public-seat-num")).toHaveTextContent(String(player.seat + 1));
      expect(el.querySelector('[data-testid="life-shroud"]')).toHaveTextContent("Dead");
      expect(el.querySelector('[data-testid="vote-token"]')).toHaveClass(vote);
      expect(el.getAttribute("aria-label")).toBe(`${player.name}, seat ${player.seat + 1}, dead, vote ${vote}`);
      cleanup();
    }
  });

  it("a Traveler with no public character still says Traveler once the pill is gone", () => {
    const el = seat({ ...deadTraveler, publicDisplayRole: undefined }, { travelerPill: false, lifeText: false });
    expect(within(el).getByText("Traveler")).toHaveClass("public-seat-role");
  });
});
