// @vitest-environment node
// SV-5b: the Seamstress (https://wiki.bloodontheclocktower.com/Seamstress, saved 2026-11-11). Expected answers are the page's
// examples and its rules, typed here, never read back from the code under test.
import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, request, yes } from "@/test/proofFixtures";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { proofScript } from "@/test/proofFixtures";
import { SEAMSTRESS_SAME } from "./seamstress";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { AbilityInputs } from "@/abilities/semantics";

// Seats: p0 seamstress, p1 barber, p2 clockmaker, p3 fanggu, p4 sweetheart, p5 witch, p6 mathematician
const ROLES = ["seamstress", "barber", "clockmaker", "fanggu", "sweetheart", "witch", "mathematician"];
const choose = (g: StorytellerLobbyRecord, a: string, b: string, extra: AbilityInputs = {}) => plan(g, request(g, "p0", "seamstress", { targets: pick(g, a, b), ...extra }));
const answer = (g: StorytellerLobbyRecord, a: string, b: string, extra: AbilityInputs = {}) => {
  const next = planned(choose(g, a, b, extra));
  const delivery = next.informationDeliveries.at(-1)!;
  return { next, delivery, value: (delivery.values!.find((v) => v.requirementId === "sameAlignment") as { value: boolean }).value };
};
const wakes = (g: StorytellerLobbyRecord) =>
  computeNightOrder(g.players, g.seatOrder, proofScript, g.day === 1, g).some((step) => step.kind === "player" && step.effectiveRoleId === "seamstress");

describe("SV-5b Seamstress: the page's examples", () => {
  it("the Barber and the Clockmaker are both good: YES", () => {
    expect(answer(proofGame(ROLES, "night", 1), "p1", "p2").value).toBe(true);
  });
  it("the Fang Gu and the Sweetheart: NO", () => {
    expect(answer(proofGame(ROLES, "night", 4), "p3", "p4").value).toBe(false);
  });
  it("a good Witch (made by the Pit-Hag) and a Town Crier are both good: YES", () => {
    const g = patchPlayer(proofGame([...ROLES, "towncrier"], "night", 3), "p5", { actualAlignment: "good" });
    expect(answer(g, "p5", "p7").value).toBe(true);
  });
  it("two evil players are the same alignment: YES", () => {
    expect(answer(proofGame(ROLES, "night", 2), "p3", "p5").value).toBe(true);
  });
});

describe("SV-5b Seamstress: once per game", () => {
  it("the choice uses the ability in the same commit and she stops waking (the NO ABILITY token is placed on commit: seamstressUi test)", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(wakes(g)).toBe(true);
    const { next, delivery } = answer(g, "p1", "p3");
    expect(delivery).toMatchObject({ informationActionId: "seamstress-other-night", actualRole: "seamstress" });
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(wakes({ ...next, day: 3, nightProgress: {} })).toBe(false);
    expect(choose(next, "p1", "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("first night uses the first-night action; the dead and Travellers may be chosen; herself and the same player twice may not", () => {
    let g = proofGame(ROLES, "night", 1);
    expect(answer(g, "p1", "p2").delivery).toMatchObject({ informationActionId: "seamstress-first-night" });
    g = patchPlayer(patchPlayer(g, "p1", { alive: false }), "p6", { isTraveler: true, actualRole: "harlot", shownRole: "harlot", actualAlignment: "evil" });
    expect(answer(g, "p1", "p6").value).toBe(false);
    expect(choose(g, "p0", "p1")).toMatchObject({ ok: false, code: "illegal" });
    expect(choose(g, "p1", "p1")).toMatchObject({ ok: false });
  });

  it("a Marionette is evil and a Drunk is good: actual alignment, never what they believe", () => {
    const g = patchPlayer(patchPlayer(proofGame([...ROLES, "marionette", "drunk"], "night", 2), "p8", { shownRole: "chef" }), "p7", { shownRole: "chef" });
    expect(answer(g, "p7", "p8").value).toBe(false);
    expect(answer(g, "p7", "p3").value).toBe(true);
  });
});

describe("SV-5b Seamstress: Spy and Recluse follow the pages (PO Q2)", () => {
  it("a Recluse beside an evil player could be either: one question, and the Storyteller's ruling is the answer", () => {
    const g = proofGame([...ROLES, "recluse"], "night", 2);
    const asked = choose(g, "p7", "p3");
    expect(asked).toMatchObject({ ok: false, code: "needsInput" });
    const requirement = asked.ok ? undefined : asked.requirements![0]!;
    expect(requirement).toMatchObject({ kind: "boolean", source: "storyteller" });
    expect(requirement!.id.startsWith(SEAMSTRESS_SAME)).toBe(true);
    expect(asked.ok ? "" : asked.message).toMatch(/may register as good or evil to the Seamstress/);
    expect(answer(g, "p7", "p3", { [requirement!.id]: yes(true) }).value).toBe(true);
    expect(answer(g, "p7", "p3", { [requirement!.id]: yes(false) }).value).toBe(false);
  });

  it("a Spy and a Recluse together could be anything: asked; a drunk Spy registers as evil: not asked", () => {
    const g = proofGame([...ROLES, "recluse", "spy"], "night", 2);
    expect(choose(g, "p7", "p8")).toMatchObject({ ok: false, code: "needsInput" });
    expect(answer(impair(g, "p8"), "p8", "p3").value).toBe(true);
  });
});

describe("SV-5b Seamstress: impaired and by hand", () => {
  it.each(["poisoned", "drunk"])("%s: pointing still uses the ability, and the Storyteller chooses the answer", (type) => {
    const g = impair(proofGame(ROLES, "night", 2), "p0", type);
    const asked = choose(g, "p1", "p2");
    expect(asked).toMatchObject({ ok: false, code: "needsInput" });
    const id = asked.ok ? "" : asked.requirements![0]!.id;
    const { next, value } = answer(g, "p1", "p2", { [id]: yes(false) });
    expect(value).toBe(false);
    expect(next.players.p0!.abilityUsed).toBe(true);
  });

  it("a Drunk shown the Seamstress: a simulated answer, and the Drunk stops waking as the Seamstress", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p0", { actualRole: "drunk", shownRole: "seamstress", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
    const asked = choose(g, "p1", "p2");
    const id = asked.ok ? "" : asked.requirements![0]!.id;
    const { next, delivery } = answer(g, "p1", "p2", { [id]: yes(true) });
    expect(delivery).toMatchObject({ actualRole: "drunk", performedRole: "seamstress" });
    expect(wakes({ ...next, day: 3, nightProgress: {} })).toBe(false);
  });

  it("a dead Seamstress, a Vortox in play and a homebrew Seamstress are refused or by hand", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(choose(patchPlayer(g, "p0", { alive: false }), "p1", "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(choose(patchPlayer(g, "p3", { actualRole: "vortox" }), "p1", "p2")).toMatchObject({ ok: false });
    expect(plan(g, request(g, "p0", "seamstress", { targets: pick(g, "p1", "p2") }), homebrewEnv("seamstress"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the delivery is kept as given: a later alignment change never alters it", () => {
    const { next } = answer(proofGame(ROLES, "night", 2), "p1", "p2");
    const changed = patchPlayer(next, "p1", { actualAlignment: "evil" });
    expect(changed.informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "sameAlignment", kind: "boolean", value: true });
  });
});
