// @vitest-environment node
// SV-5a: the Clockmaker (https://wiki.bloodontheclocktower.com/Clockmaker, saved 2026-11-11). Every expected number below is worked
// out by hand from the page's counting rule ("starting from the player next to the Demon and ending at the nearest Minion, either
// clockwise or counterclockwise"), never read back from the code under test.
import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, num, patchPlayer, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { automationEligibility } from "@/abilities/automationEligibility";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { CLOCKMAKER_POSSIBLE, clockmakerAnswers } from "./clockmaker";
import type { StorytellerLobbyRecord } from "@/stores/types";

const night1 = (roles: string[]) => proofGame(roles, "night", 1);
const evaluate = (g: StorytellerLobbyRecord, inputs: Record<string, ReturnType<typeof num>> = {}) => plan(g, request(g, "p0", "clockmaker", inputs));
const told = (g: StorytellerLobbyRecord, inputs: Record<string, ReturnType<typeof num>> = {}) => {
  const result = evaluate(g, inputs);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, changed: true });
  const delivery = planned(result).informationDeliveries.at(-1)!;
  expect(delivery).toMatchObject({ informationActionId: "clockmaker-first-night" });
  return delivery.values![0];
};
const asked = (g: StorytellerLobbyRecord) => {
  const result = evaluate(g);
  expect(result).toMatchObject({ ok: false, code: "needsInput" });
  return result.ok ? undefined : result.requirements![0]!;
};
const traveller = (g: StorytellerLobbyRecord, id: string, alignment: "good" | "evil") =>
  patchPlayer(g, id, { actualRole: "harlot", shownRole: "harlot", isTraveler: true, actualAlignment: alignment });

describe("SV-5a Clockmaker: the page's examples", () => {
  it("a Fang Gu sitting next to the Pit-Hag: 1", () => {
    expect(told(night1(["clockmaker", "chef", "fanggu", "pithag", "monk", "empath"]))).toMatchObject({ kind: "number", value: 1 });
  });

  it("the Evil Twin three steps one way and the Witch five the other way: 3", () => {
    // Clockwise from the No Dashii: Dreamer, Snake Charmer, Evil Twin. Counterclockwise: Mutant, Sweetheart, Philosopher, Sage, Witch.
    // (The Clockmaker sits between the Evil Twin and the Witch.)
    const g = night1(["clockmaker", "witch", "sage", "philosopher", "sweetheart", "mutant", "nodashii", "dreamer", "snakecharmer", "eviltwin"]);
    expect(told(g)).toMatchObject({ value: 3 });
  });

  it("two Travellers beside the Fang Gu count as seats, and an evil Traveller is not a Minion: 2", () => {
    let g = night1(["clockmaker", "chef", "harlot", "fanggu", "harlot", "cerenovus", "empath"]);
    g = traveller(traveller(g, "p2", "good"), "p4", "evil");
    expect(told(g)).toMatchObject({ value: 2 });
  });
});

describe("SV-5a Clockmaker: counting", () => {
  it("counts the dead and skips empty seats", () => {
    const g = night1(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"]);
    expect(told(g)).toMatchObject({ value: 3 });
    expect(told(patchPlayer(g, "p2", { alive: false }))).toMatchObject({ value: 3 });
    expect(told(patchPlayer(g, "p2", { isEmpty: true, participantId: undefined }))).toMatchObject({ value: 2 });
  });

  it("two Minions at different distances: the nearer one, whichever way round", () => {
    // Ring of 9: Demon p1, Poisoner p3 (2 clockwise), Baron p7 (3 counterclockwise: p0, p8, p7).
    const g = night1(["clockmaker", "imp", "chef", "poisoner", "monk", "empath", "saint", "baron", "slayer"]);
    expect(told(g)).toMatchObject({ value: 2 });
    expect(told(patchPlayer(g, "p3", { actualRole: "washerwoman", actualAlignment: "good" }))).toMatchObject({ value: 3 });
  });

  it("the Clockmaker's own seat is an ordinary seat between them", () => {
    expect(told(night1(["clockmaker", "imp", "chef", "monk", "empath", "poisoner"]))).toMatchObject({ value: 2 });
  });
});

describe("SV-5a Clockmaker: Spy and Recluse follow the pages (PO Q2)", () => {
  it("a Spy who is the only Minion: the only countable answer is automatic", () => {
    expect(told(night1(["clockmaker", "imp", "chef", "spy", "monk", "empath"]))).toMatchObject({ value: 2 });
  });

  it("a Spy beside another Minion: one question offering only the possible numbers", () => {
    // Demon p1; Spy p2 (1 step); Witch p4 (3 steps). If the Spy registers as a Townsfolk or Outsider, the Witch's 3 counts.
    const g = night1(["clockmaker", "imp", "spy", "chef", "witch", "monk", "empath", "saint"]);
    const requirement = asked(g)!;
    expect(requirement).toMatchObject({ kind: "number", source: "storyteller" });
    expect(requirement.id.startsWith(CLOCKMAKER_POSSIBLE)).toBe(true);
    expect(clockmakerAnswers(proofQuery(g))).toMatchObject({ kind: "answers", steps: [1, 3] });
    expect(told(g, { [requirement.id]: num(3) })).toMatchObject({ value: 3 });
    expect(evaluate(g, { [requirement.id]: num(2) })).toMatchObject({ ok: false, code: "illegal" });
    // A guided question (not a judgment): the step stays on the Night card.
    expect(automationEligibility({ query: proofQuery(g), descriptor: CANONICAL_ABILITY_SEMANTICS.get("clockmaker")!, actor: { playerId: "p0", participantId: g.players.p0!.participantId! }, roleId: "clockmaker" })).toEqual({ kind: "automated" });
  });

  it("a Recluse may register as a Minion (or a Demon): every possible number is offered, and the Storyteller picks", () => {
    // Demon p1; Recluse p2; Poisoner p4. As a Minion the Recluse gives 1; as itself 3; as a second Demon (2 steps to the Poisoner) 2.
    const g = night1(["clockmaker", "imp", "recluse", "chef", "poisoner", "monk", "empath", "saint"]);
    expect(clockmakerAnswers(proofQuery(g))).toMatchObject({ kind: "answers", steps: [1, 2, 3] });
    const requirement = asked(g)!;
    expect(told(g, { [requirement.id]: num(1) })).toMatchObject({ value: 1 });
  });

  it("no question when every registration gives the same number", () => {
    // Recluse p1, Poisoner p2, Imp p3: as itself, as a Minion or as a second Demon, every count is 1.
    const g = night1(["clockmaker", "recluse", "poisoner", "imp", "chef", "monk"]);
    expect(clockmakerAnswers(proofQuery(g))).toMatchObject({ kind: "answers", steps: [1] });
    expect(told(g)).toMatchObject({ value: 1 });
  });

  it("a drunk or poisoned Spy registers as itself: no question", () => {
    const g = impair(night1(["clockmaker", "imp", "spy", "chef", "witch", "monk", "empath", "saint"]), "p2");
    expect(told(g)).toMatchObject({ value: 1 });
  });
});

describe("SV-5a Clockmaker: when the Storyteller chooses, and when it goes by hand", () => {
  it.each(["poisoned", "drunk"])("%s Clockmaker: the Storyteller chooses any number of steps this table can have", (type) => {
    const g = impair(night1(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"]), "p0", type);
    expect(asked(g)).toMatchObject({ id: "communicated", kind: "number", source: "storyteller" });
    expect(told(g, { communicated: num(2) })).toMatchObject({ value: 2 });
    for (const value of [0, 4, 1.5, -1]) expect(evaluate(g, { communicated: num(value) }).ok, String(value)).toBe(false);
  });

  it("a Drunk shown the Clockmaker records a simulated number only", () => {
    const g = patchPlayer(night1(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"]), "p0",
      { actualRole: "drunk", shownRole: "clockmaker", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
    const result = evaluate(g, { communicated: num(1) });
    const next = planned(result);
    expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "clockmaker" });
    expect(next.players).toBe(g.players);
  });

  it("goes by hand: a later night, two Demons, no Minion, a dead Clockmaker, a Vortox, a homebrew Clockmaker", () => {
    const base = night1(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"]);
    // A first-night ability is refused on a later night before the rules are read (the Night list has no row then either).
    expect(evaluate({ ...base, day: 2 })).toMatchObject({ ok: false, code: "notApplicable" });
    expect(evaluate(patchPlayer(base, "p2", { actualRole: "vigormortis", actualAlignment: "evil" }))).toMatchObject({ ok: false, code: "unsupported" });
    expect(evaluate(patchPlayer(base, "p4", { actualRole: "washerwoman", actualAlignment: "good" }))).toMatchObject({ ok: false, code: "unsupported" });
    expect(evaluate(patchPlayer(base, "p0", { alive: false }))).toMatchObject({ ok: false, code: "notApplicable" });
    expect(evaluate(patchPlayer(base, "p1", { actualRole: "vortox" }))).toMatchObject({ ok: false });
    expect(plan(base, request(base, "p0", "clockmaker"), homebrewEnv("clockmaker"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the delivery keeps the number as given: a later change at the table never alters it", () => {
    const g = night1(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"]);
    const next = planned(evaluate(g));
    const moved = patchPlayer(next, "p4", { actualRole: "chef", actualAlignment: "good" });
    expect(moved.informationDeliveries.at(-1)!.values![0]).toMatchObject({ value: 3 });
  });
});
