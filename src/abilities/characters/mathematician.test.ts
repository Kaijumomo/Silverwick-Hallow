// @vitest-environment node
// SV-5g3: the Mathematician's Night step (https://wiki.bloodontheclocktower.com/Mathematician) through the real coordinator and production
// semantics: the count of ABNORMAL marks without himself, every night, the commit that clears them, impairment, a Vortox, a simulated wake.
import { describe, expect, it } from "vitest";
import { impair, num, patchPlayer, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import { MATHEMATICIAN_COMMUNICATED, mathematicianChoices } from "./mathematician";
import { CLOCKMAKER_COMMUNICATED } from "./clockmaker";
import { FALSE_INFORMATION_REFUSED } from "../falseInformation";
import { ABNORMAL_BY_HAND, ABNORMAL_VORTOX, abnormalCount, abnormalMarkIntents, abnormalMarksOf, abnormalReasons } from "@/stores/abnormalMarks";
import { applyEffectPlan, planEffectTransaction } from "@/stores/effectResolution";
import { proofQuery } from "@/test/proofFixtures";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { AbilityInputs } from "../semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const step = { withStep: true, completeStep: true } as const;
const ask = (g: StorytellerLobbyRecord, inputs: AbilityInputs = {}, actor = "p0") => plan(g, request(g, actor, "mathematician", inputs, step));
const after = (g: StorytellerLobbyRecord, inputs: AbilityInputs = {}, actor = "p0") => planned(ask(g, inputs, actor));
const other = (g: StorytellerLobbyRecord, actor: string, roleId: string, inputs: AbilityInputs) => planned(plan(g, request(g, actor, roleId, inputs, step)));
const shown = (g: StorytellerLobbyRecord) => (g.informationDeliveries.at(-1)!.values![0] as { value: number }).value;
function mark(g: StorytellerLobbyRecord, ...ids: string[]): StorytellerLobbyRecord {
  for (const id of ids) {
    const result = planEffectTransaction(g, { intents: abnormalMarkIntents(g.players, { playerId: id, participantId: g.players[id]!.participantId! }, ABNORMAL_BY_HAND) });
    if (!result.ok || !result.changed) throw new Error("mark");
    g = applyEffectPlan(g, result.plan);
  }
  return g;
}
// p0 mathematician, p1 clockmaker, p2 fanggu, p3 witch, p4 sage, p5 savant
const ROLES = ["mathematician", "clockmaker", "fanggu", "witch", "sage", "savant"];

describe("the count", () => {
  it("is the players holding a mark, himself left out, shown with no question; Next records it and clears every mark in one commit", () => {
    const g = mark(proofGame(ROLES, "night", 2), "p0", "p1", "p4");
    const next = after(g);
    expect(next.informationDeliveries.at(-1)).toMatchObject({ informationActionId: "mathematician-other-night", values: [{ requirementId: "abnormal", kind: "number", value: 2 }] });
    expect(abnormalCount(next)).toBe(0);
    expect(next.nightProgress[Object.keys(next.nightProgress)[0]!]).toMatchObject({ status: "done" });
    expect(StorytellerGamePersistedSchema.safeParse(next).success).toBe(true);
  });

  it("the first night too (\"each night\"); nothing marked is a 0", () => {
    const first = after(proofGame(ROLES, "night", 1));
    expect(first.informationDeliveries.at(-1)).toMatchObject({ informationActionId: "mathematician-first-night", values: [{ value: 0 }] });
  });

  it("a mark stays with the player through a change of character", () => {
    const g = patchPlayer(mark(proofGame(ROLES, "night", 2), "p5"), "p5", { actualRole: "artist", shownRole: "artist" });
    expect(shown(after(g))).toBe(1);
  });

  it("a dead Mathematician has no step to resolve", () => {
    expect(ask(patchPlayer(mark(proofGame(ROLES, "night", 2), "p1"), "p0", { alive: false }))).toMatchObject({ ok: false });
  });

  it("the Storyteller is offered 0 to 5, more only when the true count is higher, never more than the other players", () => {
    expect(mathematicianChoices(proofQuery(proofGame(ROLES)), proofGame(ROLES).players.p0!.participantId!)).toEqual([0, 1, 2, 3, 4, 5]);
    const five = proofGame(["mathematician", "clockmaker", "fanggu", "witch", "sage"]);
    expect(mathematicianChoices(proofQuery(five), five.players.p0!.participantId!)).toEqual([0, 1, 2, 3, 4]);
    const big = proofGame([...ROLES, "chef", "empath", "monk", "artist"]);
    const marked = mark(big, "p1", "p2", "p3", "p4", "p5", "p6", "p7");
    expect(mathematicianChoices(proofQuery(marked), big.players.p0!.participantId!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("drunk, poisoned, a Drunk shown the Mathematician", () => {
  it.each(["drunk", "poisoned"])("%s: the Storyteller chooses the number; the marks are still cleared", (type) => {
    const g = impair(mark(proofGame(ROLES, "night", 2), "p1"), "p0", type);
    expect(ask(g)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: MATHEMATICIAN_COMMUNICATED, kind: "number" }] });
    const next = after(g, { [MATHEMATICIAN_COMMUNICATED]: num(3) });
    expect(shown(next)).toBe(3);
    expect(abnormalCount(next)).toBe(0);
    expect(ask(g, { [MATHEMATICIAN_COMMUNICATED]: num(9) })).toMatchObject({ ok: false, code: "illegal" });
  });

  it("a Drunk shown the Mathematician: a simulated delivery that clears nothing (it has no ability)", () => {
    const g = patchPlayer(mark(proofGame(ROLES, "night", 2), "p1"), "p0", { actualRole: "drunk", shownRole: "mathematician", behaviorMode: "drunk_fake_role_behavior" });
    const next = after(g, { [MATHEMATICIAN_COMMUNICATED]: num(0) });
    expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "mathematician" });
    expect(abnormalCount(next)).toBe(1);
  });
});

describe("a Vortox", () => {
  // p0 mathematician, p1 oracle, p2 vortox, p3 witch, p4 towncrier, p5 chef (dead)
  const VORTOX = () => patchPlayer(proofGame(["mathematician", "oracle", "vortox", "witch", "towncrier", "chef"], "night", 3), "p5", { alive: false });

  it("the true count is refused, any other number is given, and the Mathematician's own false number never marks himself", () => {
    const g = mark(VORTOX(), "p4");
    expect(ask(g)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: MATHEMATICIAN_COMMUNICATED, exclude: [1] }] });
    expect(ask(g, { [MATHEMATICIAN_COMMUNICATED]: num(1) })).toMatchObject({ ok: false, code: "illegal", message: FALSE_INFORMATION_REFUSED });
    const next = after(g, { [MATHEMATICIAN_COMMUNICATED]: num(0) });
    expect(shown(next)).toBe(0);
    expect(next.players.p0!.effects).toEqual([]);
    expect(abnormalCount(next)).toBe(0);
  });

  it("the page's Vortox example: each Townsfolk the Vortox made false is counted once; the Mathematician then learns any other number", () => {
    // The Oracle (true: 0 dead evil) learns 1; the Clockmaker-free table keeps it simple. Then a hand mark on the Town Crier too.
    let g = other(VORTOX(), "p1", "oracle", { communicated: num(1) });
    expect(abnormalReasons(abnormalMarksOf(g.players.p1!))).toEqual([ABNORMAL_VORTOX]);
    g = mark(g, "p4");
    expect(ask(g)).toMatchObject({ ok: false, requirements: [{ exclude: [2] }] });
  });
});

describe("since dawn (PO Q18 A)", () => {
  it("a mark made in the Day is counted at the next Night", () => {
    const day = mark(proofGame(ROLES, "day", 2), "p3");
    expect(abnormalMarksOf(day.players.p3!)[0]).toMatchObject({ expiry: { kind: "at", moment: { phase: "day", day: 3 } } });
    const night = { ...day, phase: "night" as const, day: 3 };
    expect(shown(after(night))).toBe(1);
  });

  it("a Clockmaker woken before the Mathematician on the first night is counted the same night", () => {
    const g = proofGame(["clockmaker", "mathematician", "vortox", "witch", "chef"], "night", 1);
    const told = other(g, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) });
    expect(ask(told, {}, "p1")).toMatchObject({ ok: false, requirements: [{ exclude: [1] }] });
  });
});

describe("the four jinxes stay the Storyteller's", () => {
  it.each([["drunk"], ["lunatic"], ["chambermaid"]])("with the %s in play the Mathematician's step goes to the Storyteller, by hand", (other) => {
    const g = proofGame(["mathematician", other, "empath", "imp", "chef"], "night", 2);
    expect(ask(g)).toMatchObject({ ok: false, code: "unsupported" });
  });
});

it("the Seamstress's use, a mark and the delivery commit together when she is poisoned (one plan, declared order)", () => {
  const g0 = impair(proofGame(["seamstress", "barber", "clockmaker", "fanggu", "mathematician"], "night", 2), "p0");
  const asked = plan(g0, request(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2") }, step));
  const id = asked.ok ? "" : asked.requirements![0]!.id;
  const result = plan(g0, request(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2"), [id]: { kind: "boolean", value: false } }, step));
  expect(result.ok && result.changed && result.plan.outcome.operations.map((op) => op.domain)).toEqual(["life", "effect", "information"]);
  expect(result.ok && result.changed && result.plan.outcome.mechanicalOrder).toBe("declared");
});
