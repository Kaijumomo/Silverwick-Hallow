import { describe, expect, it } from "vitest";
import { initialRevealReadiness } from "./revealReadiness";
import { selectSetupContext } from "./setupContext";
import { setupScript } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

function contextFor(players: StorytellerLobbyRecord["players"]) {
  const ids = Object.keys(players);
  const game: StorytellerLobbyRecord = {
    code: "", storytellerUid: "local", scriptId: setupScript.id, phase: "setup", day: 0,
    players, seatOrder: ids, plannedPlayerCount: ids.length, plannedTravelerCount: 0, rolePool: [], fabled: [], lorics: [],
    bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {}, history: [], informationDeliveries: [],
  };
  return selectSetupContext(game, setupScript);
}

describe("initialRevealReadiness", () => {
  it("D. a normal role (Chef) is ready the moment Deal assigns it", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "chef", shownRole: "chef", shownAlignment: "good", behaviorMode: "normal" }),
    });
    expect(initialRevealReadiness(ctx)).toMatchObject({ ready: true, readyCount: 1, totalCount: 1, pendingIds: [] });
  });

  it("D. Drunk with actualRole set but shownRole unresolved blocks reveal", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "drunk", shownRole: null, shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" }),
    });
    const rr = initialRevealReadiness(ctx);
    expect(rr.ready).toBe(false);
    expect(rr.pendingIds).toEqual(["p1"]);
  });

  it("E. Drunk configured with a valid Townsfolk shown role becomes ready", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "drunk", shownRole: "chef", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" }),
    });
    expect(initialRevealReadiness(ctx)).toMatchObject({ ready: true, pendingIds: [] });
  });

  it("F. Lunatic must satisfy the fake-Demon policy: an Outsider shown role is rejected", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "lunatic", shownRole: "saint", shownAlignment: null, behaviorMode: "fake_demon_behavior" }),
    });
    expect(initialRevealReadiness(ctx).ready).toBe(false);
  });

  it("F. Lunatic shown a Demon character satisfies the fake-Demon policy", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "lunatic", shownRole: "imp", shownAlignment: null, behaviorMode: "fake_demon_behavior" }),
    });
    expect(initialRevealReadiness(ctx).ready).toBe(true);
  });

  it("G. Marionette must satisfy the fake-good policy: a Demon shown role is rejected", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "marionette", shownRole: "imp", shownAlignment: null, behaviorMode: "marionette_fake_good_behavior" }),
    });
    expect(initialRevealReadiness(ctx).ready).toBe(false);
  });

  it("G. Marionette shown a Townsfolk or Outsider satisfies the fake-good policy", () => {
    const townsfolk = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "marionette", shownRole: "washerwoman", shownAlignment: null, behaviorMode: "marionette_fake_good_behavior" }),
    });
    expect(initialRevealReadiness(townsfolk).ready).toBe(true);
    const outsider = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "marionette", shownRole: "saint", shownAlignment: null, behaviorMode: "marionette_fake_good_behavior" }),
    });
    expect(initialRevealReadiness(outsider).ready).toBe(true);
  });

  it("H. reports an accurate ready/total count across multiple unresolved players", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", seat: 0, actualRole: "chef", shownRole: "chef", shownAlignment: "good", behaviorMode: "normal" }),
      p2: makeSTPlayer({ id: "p2", seat: 1, actualRole: "drunk", shownRole: null, shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" }),
      p3: makeSTPlayer({ id: "p3", seat: 2, actualRole: "lunatic", shownRole: null, shownAlignment: null, behaviorMode: "fake_demon_behavior" }),
    });
    const rr = initialRevealReadiness(ctx);
    expect(rr).toMatchObject({ ready: false, readyCount: 1, totalCount: 3 });
    expect(rr.pendingIds.sort()).toEqual(["p2", "p3"]);
  });

  it("no actual role at all never counts as ready, even with a shown role somehow present", () => {
    const ctx = contextFor({
      p1: makeSTPlayer({ id: "p1", actualRole: "", shownRole: "chef", shownAlignment: "good", behaviorMode: "normal" }),
    });
    expect(initialRevealReadiness(ctx).ready).toBe(false);
  });
});
