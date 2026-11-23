// @vitest-environment node
// SV-5i: false numbers and Yes / No answers under a Vortox (https://wiki.bloodontheclocktower.com/Vortox): the Clockmaker, the
// Seamstress, the Flowergirl, the Town Crier and the Oracle. Production semantics and the real coordinator. Every expected answer is
// worked out by hand from the seating beside it: first the TRUE answer, then what the Vortox makes the player learn.
import { describe, expect, it } from "vitest";
import { impair, num, patchPlayer, pick, plan, planned, proofGame, request, yes } from "@/test/proofFixtures";
import { PHILOSOPHER_CHARACTER } from "./philosopher";
import { SEAMSTRESS_SAME } from "./seamstress";
import { FALSE_INFORMATION_REFUSED } from "../falseInformation";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { AbilityInputs } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";

const step = { withStep: true, completeStep: true } as const;
const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
/** Day `day`'s record: `nominator` nominated `nominee`; `voters` raised their hands. */
function withDay(g: StorytellerLobbyRecord, day: number, rounds: { nominator: string; nominee: string; voters: string[] }[]): StorytellerLobbyRecord {
  const built: VotingRound[] = rounds.map(({ nominator, nominee, voters }) => {
    const at = g.seatOrder.indexOf(nominee);
    const order = [...g.seatOrder.slice(at + 1), ...g.seatOrder.slice(0, at + 1)].map((id) => ref(g, id));
    return { id: `r-${nominator}-${nominee}`, mode: "nomination", nominator: ref(g, nominator), nominee: ref(g, nominee), order,
      responses: order.map((voter) => ({ voter, choice: voters.includes(voter.playerId) ? "yes" as const : "no" as const, weight: voters.includes(voter.playerId) ? 1 : 0,
        spentGhostVote: false, refundSafe: false, lifeSafe: true })),
      threshold: 20, status: "acknowledged", result: "belowThreshold", tally: voters.length, virginPending: false, contextStamp: "", executionEventIds: [] };
  });
  return { ...g, voting: { day, revision: 1, coverage: "known", rounds: built, activeRoundId: null, block: null, modifiers: [] } };
}
const result = (g: StorytellerLobbyRecord, roleId: string, inputs: AbilityInputs = {}) => plan(g, request(g, "p0", roleId, inputs, step));
const told = (g: StorytellerLobbyRecord, roleId: string, inputs: AbilityInputs = {}) => {
  const next = planned(result(g, roleId, inputs));
  const delivery = next.informationDeliveries.at(-1)!;
  return { next, delivery, value: (delivery.values!.find((v) => v.kind === "boolean" || v.kind === "number") as { value: number | boolean }).value };
};
const question = (g: StorytellerLobbyRecord, roleId: string, inputs: AbilityInputs = {}) => {
  const asked = result(g, roleId, inputs);
  expect(asked, JSON.stringify(asked)).toMatchObject({ ok: false, code: "needsInput" });
  return asked.ok ? undefined : asked.requirements![0]!;
};

describe("SV-5i Town Crier", () => {
  // p0 town crier, p1 vortox, p2 witch, p3 chef, p4 sage, p5 mutant
  const ROLES = ["towncrier", "vortox", "witch", "chef", "sage", "mutant"];
  it("the page: nobody nominated (true: NO), so the Town Crier learns YES", () => {
    expect(told(withDay(proofGame(ROLES, "night", 2), 1, []), "towncrier").value).toBe(true);
  });
  it("the Witch nominated (true: YES): NO", () => {
    expect(told(withDay(proofGame(ROLES, "night", 2), 1, [{ nominator: "p2", nominee: "p3", voters: [] }]), "towncrier").value).toBe(false);
  });
  it("a drunk or poisoned Town Crier still learns the false answer (no free choice)", () => {
    const g = impair(withDay(proofGame(ROLES, "night", 2), 1, []), "p0");
    expect(told(g, "towncrier").value).toBe(true);
  });
  it("a Drunk shown the Town Crier has no Townsfolk ability: the Storyteller's free choice, YES or NO", () => {
    const g = patchPlayer(withDay(proofGame(ROLES, "night", 2), 1, []), "p0", { actualRole: "drunk", shownRole: "towncrier", behaviorMode: "drunk_fake_role_behavior" });
    expect(question(g, "towncrier")).toMatchObject({ id: "communicated", kind: "boolean" });
    expect(told(g, "towncrier", { communicated: yes(false) }).value).toBe(false);
  });
  it("a Recluse nominated: the Storyteller rules whether a Minion did, and the Town Crier learns the opposite", () => {
    const g = withDay(proofGame(["towncrier", "vortox", "recluse", "chef", "sage", "mutant"], "night", 2), 1, [{ nominator: "p2", nominee: "p3", voters: [] }]);
    const id = question(g, "towncrier")!.id;
    expect(id.startsWith("towncrier:minionNominated")).toBe(true);
    expect(told(g, "towncrier", { [id]: yes(true) }).value).toBe(false);
    expect(told(g, "towncrier", { [id]: yes(false) }).value).toBe(true);
  });
  it("the Vortox dead (killed earlier, or executed), drunk or poisoned: true information again", () => {
    const g = withDay(proofGame(ROLES, "night", 2), 1, []);
    for (const next of [patchPlayer(g, "p1", { alive: false }), impair(g, "p1"), impair(g, "p1", "drunk")]) expect(told(next, "towncrier").value).toBe(false);
  });
  it("an incomplete record stays by hand", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(result(g, "towncrier")).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("SV-5i Oracle", () => {
  // p0 oracle, p1 vortox, p2 witch (dead), p3 chef (dead), p4 sage, p5 mutant: true count 1.
  const base = () => patchPlayer(patchPlayer(proofGame(["oracle", "vortox", "witch", "chef", "sage", "mutant"], "night", 3), "p2", { alive: false }), "p3", { alive: false });
  it("the Storyteller chooses any number but the true 1", () => {
    expect(question(base(), "oracle")).toMatchObject({ id: "communicated", kind: "number", source: "storyteller", exclude: [1] });
    expect(result(base(), "oracle", { communicated: num(1) })).toMatchObject({ ok: false, code: "illegal", message: FALSE_INFORMATION_REFUSED });
    expect(told(base(), "oracle", { communicated: num(0) }).value).toBe(0);
    expect(told(base(), "oracle", { communicated: num(2) }).value).toBe(2);
  });
  it("a poisoned Oracle: still never the true number", () => {
    expect(question(impair(base(), "p0"), "oracle")).toMatchObject({ exclude: [1] });
  });
  it("a dead Recluse whose registration is the Storyteller's call stays by hand, as before", () => {
    const g = patchPlayer(base(), "p3", { actualRole: "recluse" });
    expect(result(g, "oracle")).toMatchObject({ ok: false, code: "unsupported" });
  });
  it("a Philosopher who chose the Oracle performs a Townsfolk ability: false too", () => {
    const g = proofGame(["philosopher", "vortox", "witch", "chef", "sage", "mutant"], "night", 2);
    const chosen = planned(plan(g, request(g, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: { kind: "character", roleIds: ["oracle"] } }, step)));
    const night3 = patchPlayer({ ...chosen, day: 3 }, "p2", { alive: false });
    expect(question(night3, "oracle")).toMatchObject({ exclude: [1] });
    const { delivery } = told(night3, "oracle", { communicated: num(0) });
    expect(delivery).toMatchObject({ actualRole: "philosopher", performedRole: "oracle", values: [{ value: 0 }] });
  });
});

describe("SV-5i Clockmaker (Night 1)", () => {
  // p0 clockmaker, p1 vortox, p2 chef, p3 witch, p4 sage, p5 mutant, p6 dreamer, p7 seamstress: Vortox to Witch is 2. Ring of 8 allows 1-4.
  const ROLES = ["clockmaker", "vortox", "chef", "witch", "sage", "mutant", "dreamer", "seamstress"];
  it("the Storyteller chooses any number of steps the table allows but the true 2", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(question(g, "clockmaker")).toMatchObject({ id: "communicated", kind: "number", exclude: [2] });
    expect(result(g, "clockmaker", { communicated: num(2) })).toMatchObject({ ok: false, code: "illegal" });
    expect(told(g, "clockmaker", { communicated: num(4) }).value).toBe(4);
  });
  it("a Spy who may not register as a Minion makes two numbers possible: each is false under one registration, so none is excluded", () => {
    // p2 spy (1 step), p3 witch (2 steps).
    const g = proofGame(["clockmaker", "vortox", "spy", "witch", "sage", "mutant", "dreamer", "seamstress"], "night", 1);
    expect(question(g, "clockmaker")).toMatchObject({ id: "communicated", exclude: [] });
  });
  it("independent check at 4208516: a lone Spy ruled not a Minion leaves the Clockmaker nothing to count, so the true 2 is still refused", () => {
    // p0 clockmaker, p1 vortox, p2 chef, p3 spy (2 steps), p4 sage ... : the true-information path gives 2 without asking.
    const g = proofGame(["clockmaker", "vortox", "chef", "spy", "sage", "mutant", "dreamer", "seamstress"], "night", 1);
    expect(question(g, "clockmaker")).toMatchObject({ id: "communicated", exclude: [2] });
    expect(result(g, "clockmaker", { communicated: num(2) })).toMatchObject({ ok: false, code: "illegal" });
    expect(told(g, "clockmaker", { communicated: num(3) }).value).toBe(3);
  });
  it("independent check: a Recluse who may register as a second Demon adds 1 under one ruling, but 2 is true under every ruling: refused", () => {
    // p4 recluse: as a Demon it is 1 step from the Witch; as a Minion or an Outsider, the Vortox is still 2 from its nearest Minion.
    const g = proofGame(["clockmaker", "vortox", "chef", "witch", "recluse", "sage", "dreamer", "seamstress"], "night", 1);
    expect(question(g, "clockmaker")).toMatchObject({ id: "communicated", exclude: [2] });
    expect(result(g, "clockmaker", { communicated: num(2) })).toMatchObject({ ok: false, code: "illegal" });
    expect(told(g, "clockmaker", { communicated: num(1) }).value).toBe(1);
  });
  it("a Drunk shown the Clockmaker: free choice", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 1), "p0", { actualRole: "drunk", shownRole: "clockmaker", behaviorMode: "drunk_fake_role_behavior" });
    expect(told(g, "clockmaker", { communicated: num(2) }).value).toBe(2);
  });
});

describe("SV-5i Seamstress", () => {
  // p0 seamstress, p1 vortox, p2 witch, p3 chef, p4 sage, p5 mutant
  const ROLES = ["seamstress", "vortox", "witch", "chef", "sage", "mutant"];
  it("two good players (true: YES): NO; a good and an evil one (true: NO): YES; the ability is used either way", () => {
    const g = proofGame(ROLES, "night", 2);
    const same = told(g, "seamstress", { targets: pick(g, "p3", "p4") });
    expect(same.value).toBe(false);
    expect(same.next.players.p0!.abilityUsed).toBe(true);
    expect(told(g, "seamstress", { targets: pick(g, "p2", "p3") }).value).toBe(true);
  });
  it("a poisoned Seamstress: the false answer, no free choice", () => {
    const g = impair(proofGame(ROLES, "night", 2), "p0");
    expect(told(g, "seamstress", { targets: pick(g, "p1", "p2") }).value).toBe(false);
  });
  it("a Recluse chosen: the Storyteller rules the registration, and the Seamstress learns the opposite", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p5", { actualRole: "recluse" });
    const id = question(g, "seamstress", { targets: pick(g, "p3", "p5") })!.id;
    expect(id.startsWith(SEAMSTRESS_SAME)).toBe(true);
    expect(told(g, "seamstress", { targets: pick(g, "p3", "p5"), [id]: yes(true) }).value).toBe(false);
  });
});

describe("SV-5i Flowergirl", () => {
  // p0 flowergirl, p1 vortox, p2 witch, p3 chef, p4 sage, p5 mutant
  const ROLES = ["flowergirl", "vortox", "witch", "chef", "sage", "mutant"];
  it("the page: nobody voted (true: NO), so the Flowergirl learns YES", () => {
    expect(told(withDay(proofGame(ROLES, "night", 2), 1, []), "flowergirl").value).toBe(true);
  });
  it("the Vortox voted (true: YES): NO", () => {
    expect(told(withDay(proofGame(ROLES, "night", 2), 1, [{ nominator: "p3", nominee: "p4", voters: ["p1"] }]), "flowergirl").value).toBe(false);
  });
});

describe("SV-5i the answer given is the answer recorded", () => {
  it("the delivery keeps the false answer and a reload keeps it (Undo: vortoxInformationUi.v6.test.tsx); the step is not recomputed", () => {
    const g = withDay(proofGame(["towncrier", "vortox", "witch", "chef", "sage", "mutant"], "night", 2), 1, []);
    const { next, delivery } = told(g, "towncrier");
    expect(delivery.values).toEqual([{ requirementId: "minionNominated", kind: "boolean", value: true }]);
    const reloaded = JSON.parse(JSON.stringify(next));
    expect(StorytellerGamePersistedSchema.safeParse(reloaded).success).toBe(true);
    expect(reloaded.informationDeliveries.at(-1).values).toEqual([{ requirementId: "minionNominated", kind: "boolean", value: true }]);
    // The step is complete: asking again is refused rather than recomputed.
    expect(plan(next, request(next, "p0", "towncrier", {}, step))).toMatchObject({ ok: false, code: "notApplicable" });
  });
});
