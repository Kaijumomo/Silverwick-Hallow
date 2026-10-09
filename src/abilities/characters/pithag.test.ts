// Phase 10F Slice 7 -- Pit-Hag (matrix Section 12). Production semantics.
import { beforeEach, describe, expect, it } from "vitest";
import { homebrewEnv, homebrewScript, impair, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, request, reseat } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { buildRegistry } from "@/data/roleRegistry";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 pithag, p1 chef, p2 imp, p3 monk, p4 empath, p5 saint, p6 washerwoman
const ROLES = ["pithag", "chef", "imp", "monk", "empath", "saint", "washerwoman"];
const base = () => proofGame(ROLES);
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const hag = (g: StorytellerLobbyRecord, target: string, roleId: string, extra = {}) =>
  plan(g, request(g, "p0", "pithag", { target: pick(g, target), character: character(roleId) }, extra));

describe("Pit-Hag -- ordinary transformation", () => {
  it("a character already in play: nothing happens", () => {
    expect(hag(base(), "p1", "monk")).toEqual({ ok: true, changed: false });
    // In play even while dead.
    expect(hag(patchPlayer(base(), "p3", { alive: false }), "p1", "monk")).toEqual({ ok: true, changed: false });
  });

  it("not in play, not a Demon: the Actual Role changes, the player is told, Actual Alignment is preserved", () => {
    const g = base();
    const result = hag(g, "p1", "slayer");
    const next = planned(result);
    expect(next.players.p1).toMatchObject({ actualRole: "slayer", shownRole: "slayer", actualAlignment: "good", shownAlignment: "good" });
    expect(result).toMatchObject({ plan: { needsConfirmation: true } });
  });

  it("a good player made a Minion stays good, and is told so", () => {
    const g = patchPlayer(base(), "p1", { shownAlignment: null }); // Normal perception
    const next = planned(hag(g, "p1", "poisoner"));
    expect(next.players.p1).toMatchObject({ actualRole: "poisoner", actualAlignment: "good", shownAlignment: "good" });
  });

  it("ability use follows the Role seam: a gameplay Role change resets it", () => {
    const g = patchPlayer(base(), "p1", { abilityUsed: true });
    expect(planned(hag(g, "p1", "slayer")).players.p1!.abilityUsed).toBe(false);
  });

  it("a Baron created mid-game runs no Setup effect: only that one Role changes", () => {
    const g = base();
    const next = planned(hag(g, "p1", "baron"));
    for (const id of Object.keys(g.players).filter((id) => id !== "p1")) expect(next.players[id]).toBe(g.players[id]);
    expect([next.rolePool, next.plannedPlayerCount, next.bluffs]).toEqual([g.rolePool, g.plannedPlayerCount, g.bluffs]);
  });

  it("the Pit-Hag may change themself", () => {
    expect(planned(hag(base(), "p0", "slayer")).players.p0!.actualRole).toBe("slayer");
  });
});

describe("Pit-Hag -- Manual boundaries", () => {
  it("Phase 10G (PHASE10G Section 9, superseding the 10F Manual gate): a Demon destination resolves the Role change AND the arbitrary-deaths fact together", () => {
    const g = base();
    const next = planned(hag(g, "p1", "vortox"));
    expect(next.players.p1).toMatchObject({ actualRole: "vortox", actualAlignment: "good" });
    expect(next.gameRuleFacts).toEqual([expect.objectContaining({ type: "pitHagArbitraryDeaths", expiresAt: { phase: "day", day: 2 } })]);
    expect(hag(g, "p1", "vigormortis")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("Traveller destination or target (optional rule) -> Manual", () => {
    const g = base();
    expect(hag(g, "p1", "beggar")).toMatchObject({ ok: false, code: "unsupported" });
    const traveller = patchPlayer(proofGame([...ROLES, "gunslinger"]), "p7", { isTraveler: true, actualAlignment: "good" });
    expect(hag(traveller, "p7", "slayer")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a concealed identity (Drunk target / Drunk destination) is not guessed -> Manual", () => {
    const drunk = patchPlayer(proofGame([...ROLES.slice(0, 6), "drunk"]), "p6", { shownRole: "chef", behaviorMode: "drunk_fake_role_behavior" });
    expect(hag(drunk, "p6", "slayer")).toMatchObject({ ok: false, code: "unsupported" });
    expect(hag(base(), "p1", "drunk")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a homebrew destination reusing an official id -> Manual (no canonical semantics inherited)", () => {
    const script = homebrewScript("slayer");
    const g = base();
    expect(plan(g, request(g, "p0", "pithag", { target: pick(g, "p1"), character: character("slayer") }), proofEnv({ script, registry: buildRegistry(script) })))
      .toMatchObject({ ok: false, code: "unsupported" });
  });

  it("an impaired Pit-Hag changes nothing; Night 1 is not eligible", () => {
    expect(hag(impair(base(), "p0"), "p1", "slayer")).toEqual({ ok: true, changed: false });
    const n1 = proofGame(ROLES, "night", 1);
    expect(hag(n1, "p1", "slayer")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("stale target after seat reuse is refused", () => {
    const g = base();
    expect(plan(reseat(g, "p1"), request(g, "p0", "pithag", { target: pick(g, "p1"), character: character("slayer") }))).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Pit-Hag reusing the official id inherits no semantics", () => {
    const g = base();
    expect(plan(g, request(g, "p0", "pithag", { target: pick(g, "p1"), character: character("slayer") }), homebrewEnv("pithag"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Pit-Hag -- one commit and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  it("commits once; Undo restores the original character", () => {
    const g = base();
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "pithag", { target: pick(g, "p1"), character: character("slayer") }))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().game!.players.p1!.actualRole).toBe("slayer");
    store.getState().undo();
    expect(store.getState().game!.players.p1!.actualRole).toBe("chef");
  });
});
