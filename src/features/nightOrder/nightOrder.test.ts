import { describe, it, expect } from "vitest";
import { computeNightOrder } from "./nightOrder";
import type { NightStep } from "./nightOrder";
import { makeSTPlayer } from "@/test/fixtures";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { canonicalOrder } from "@/data/canonical";
import type { STPlayerRecord } from "@/stores/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayers(defs: { id: string; role: string; seat: number; over?: Partial<STPlayerRecord> }[]) {
  const players: Record<string, STPlayerRecord> = {};
  const seatOrder: string[] = [];
  for (const { id, role, seat, over } of defs) {
    players[id] = makeSTPlayer({ id, name: id, seat, actualRole: role, shownRole: role || null, ...over });
    seatOrder.push(id);
  }
  return { players, seatOrder };
}

const playerSteps = (steps: NightStep[]) =>
  steps.filter((s): s is Extract<NightStep, { kind: "player" }> => s.kind === "player");

const globalSteps = (steps: NightStep[]) =>
  steps.filter((s): s is Extract<NightStep, { kind: "global" }> => s.kind === "global");

// ---------------------------------------------------------------------------
// Test 1: TB first-night ordered sequence
// ---------------------------------------------------------------------------

describe("computeNightOrder — first night", () => {
  // Players: poisoner(17), chef(36), empath(37), fortuneteller(38), spy(49), imp(no firstNight)
  const { players, seatOrder } = makePlayers([
    { id: "p-poisoner", role: "poisoner", seat: 0 },
    { id: "p-spy",      role: "spy",      seat: 1 },
    { id: "p-imp",      role: "imp",      seat: 2 },
    { id: "p-empath",   role: "empath",   seat: 3 },
    { id: "p-chef",     role: "chef",     seat: 4 },
    { id: "p-ft",       role: "fortuneteller", seat: 5 },
    { id: "p-soldier",  role: "soldier", seat: 6 },
  ]);

  it("starts with Minion information before Demon information", () => {
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    expect(steps[0]?.stepKey).toBe("minionInfo");
    expect(steps[1]?.stepKey).toBe("demonInfo");
  });

  it("produces the correct player sequence: poisoner → chef → empath → fortuneteller → spy (imp absent)", () => {
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    const ps = playerSteps(steps);
    expect(ps.map((s) => s.effectiveRoleId)).toEqual([
      "poisoner", "chef", "empath", "fortuneteller", "spy",
    ]);
  });

  it("total step count is 7 (2 globals + 5 players; imp has no firstNight)", () => {
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    expect(steps).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Test 2: TB other-night ordered sequence
// ---------------------------------------------------------------------------

describe("computeNightOrder — other nights", () => {
  const { players, seatOrder } = makePlayers([
    { id: "p-poisoner", role: "poisoner", seat: 0 },
    { id: "p-spy",      role: "spy",      seat: 1 },
    { id: "p-imp",      role: "imp",      seat: 2 },
    { id: "p-empath",   role: "empath",   seat: 3 },
    { id: "p-chef",     role: "chef",     seat: 4 },
    { id: "p-ft",       role: "fortuneteller", seat: 5 },
  ]);

  it("contains no global steps on other nights", () => {
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, false);
    expect(globalSteps(steps)).toHaveLength(0);
  });

  it("produces correct other-night sequence: poisoner → imp → empath → fortuneteller → spy (chef absent)", () => {
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, false);
    expect(playerSteps(steps).map((s) => s.effectiveRoleId)).toEqual([
      "poisoner", "imp", "empath", "fortuneteller", "spy",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Drunk uses shownRole's night slot
// ---------------------------------------------------------------------------

describe("Drunk uses shownRole's night slot", () => {
  it("Drunk with shownRole=chef appears in chef's night slot", () => {
    const { players, seatOrder } = makePlayers([
      {
        id: "p-drunk", role: "drunk", seat: 0,
        over: { behaviorMode: "drunk_fake_role_behavior", shownRole: "chef" },
      },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    const ps = playerSteps(steps);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.effectiveRoleId).toBe("chef");
    expect(ps[0]!.isDeceived).toBe(true);
    // order should match chef's firstNight value
    const chefDef = troubleBrewing.characters.find((r) => r.id === "chef")!;
    expect(ps[0]!.order).toBe(chefDef.firstNight);
  });

  it("Drunk with no shownRole has no inferred wake identity", () => {
    const { players, seatOrder } = makePlayers([
      {
        id: "p-drunk", role: "drunk", seat: 0,
        over: { behaviorMode: "drunk_fake_role_behavior", shownRole: null },
      },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    // drunk has no firstNight → no player step
    expect(playerSteps(steps)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Lunatic uses demon slot (other nights)
// ---------------------------------------------------------------------------

describe("Lunatic uses shownRole (demon) night slot", () => {
  it("Lunatic performs the shown Imp procedure before the real Demon", () => {
    const { players, seatOrder } = makePlayers([
      {
        id: "p-lunatic", role: "lunatic", seat: 0,
        over: { behaviorMode: "fake_demon_behavior", shownRole: "imp" },
      },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, false);
    const ps = playerSteps(steps);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.effectiveRoleId).toBe("imp");
    expect(ps[0]!.isDeceived).toBe(true);
    expect(ps[0]!.order).toBe(canonicalOrder("lunatic", false));
    expect(ps[0]!.prompt).toBe(troubleBrewing.characters.find(r => r.id === "imp")!.otherNightPrompt);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Marionette produces no player step
// ---------------------------------------------------------------------------

describe("Marionette simulated wake", () => {
  it("Marionette follows the shown Fortune Teller procedure", () => {
    const { players, seatOrder } = makePlayers([
      {
        id: "p-mar", role: "marionette", seat: 0,
        over: { behaviorMode: "marionette_fake_good_behavior", shownRole: "fortuneteller" },
      },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, false);
    expect(playerSteps(steps)).toEqual([expect.objectContaining({
      playerId: "p-mar", effectiveRoleId: "fortuneteller", actualRoleId: "marionette", isDeceived: true,
    })]);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Unassigned player is skipped
// ---------------------------------------------------------------------------

describe("Unassigned player skipped", () => {
  it("player with actualRole='' produces no step", () => {
    const { players, seatOrder } = makePlayers([
      { id: "p-empty", role: "", seat: 0 },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    expect(playerSteps(steps)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Dead player is still included
// ---------------------------------------------------------------------------

describe("Dead player eligibility", () => {
  it("dead Spy has no ordinary wake absent a retained-ability exception", () => {
    const { players, seatOrder } = makePlayers([
      { id: "p-dead-spy", role: "spy", seat: 0, over: { alive: false } },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    const ps = playerSteps(steps);
    expect(ps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Same-order tiebreaker — sort by seat
// ---------------------------------------------------------------------------

describe("Tiebreaker: same order → sorted by seat", () => {
  it("two players with the same night-order value sort by seat ascending", () => {
    // Give two players the same role (empath) — custom script allows this.
    const script = {
      ...troubleBrewing,
      characters: troubleBrewing.characters,
    };
    const { players, seatOrder } = makePlayers([
      { id: "p-a", role: "empath", seat: 3 },
      { id: "p-b", role: "empath", seat: 1 },
    ]);
    const steps = computeNightOrder(players, seatOrder, script, true);
    const ps = playerSteps(steps);
    expect(ps[0]!.seat).toBe(1);
    expect(ps[1]!.seat).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 9: Marionette in play annotates demonInfo prompt
// ---------------------------------------------------------------------------

describe("Marionette setup is separate from team introductions", () => {
  it("the actual Marionette has a Demon-information procedure even in a small game", () => {
    const { players, seatOrder } = makePlayers([
      { id: "p-imp", role: "imp", seat: 0 },
      {
        id: "p-mar", role: "marionette", seat: 1,
        over: { behaviorMode: "marionette_fake_good_behavior", shownRole: "fortuneteller" },
      },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    expect(steps.find(s => s.stepKey === "demonInfo")).toBeUndefined();
    expect(steps.find(s => s.stepKey === "admin:p-mar:marionette")?.prompt).toContain("Marionette");
  });

  it("demonInfo prompt does NOT mention Marionette when none are in play", () => {
    const { players, seatOrder } = makePlayers([
      { id: "p-imp", role: "imp", seat: 0 },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    expect(steps.some(s => s.stepKey.includes("marionette"))).toBe(false);
  });
});

describe("Traveler night-order integration", () => {
  it("Bureaucrat (isTraveler, firstNight=1) appears first in the night order", () => {
    // Poisoner has firstNight=10, Bureaucrat=1 → Bureaucrat goes first.
    const { players, seatOrder } = makePlayers([
      { id: "p-poisoner", role: "poisoner", seat: 0 },
      {
        id: "p-bureau",
        role: "bureaucrat",
        seat: 1,
        over: { isTraveler: true },
      },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, true);
    const ps = playerSteps(steps);
    // Bureaucrat (order=1) should appear before Poisoner (order=10).
    const bureauIdx = ps.findIndex((s) => s.effectiveRoleId === "bureaucrat");
    const poisonerIdx = ps.findIndex((s) => s.effectiveRoleId === "poisoner");
    expect(bureauIdx).toBeGreaterThanOrEqual(0);
    expect(bureauIdx).toBeLessThan(poisonerIdx);
  });

  it("Traveler without night slot does not appear in night order", () => {
    const { players, seatOrder } = makePlayers([
      {
        id: "p-scapegoat",
        role: "scapegoat",
        seat: 0,
        over: { isTraveler: true },
      },
      { id: "p-imp", role: "imp", seat: 1 },
    ]);
    const steps = computeNightOrder(players, seatOrder, troubleBrewing, false);
    const hasScapegoat = playerSteps(steps).some(
      (s) => s.effectiveRoleId === "scapegoat"
    );
    expect(hasScapegoat).toBe(false);
  });
});
