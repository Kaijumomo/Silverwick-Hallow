// SV-5 part 1 pair record (docs/ai/SECTS_AND_VIOLETS_SV5A_PAIRS.md): the Clockmaker, the Seamstress, the Dreamer and the Flowergirl
// against the rest of Sects & Violets. Production semantics, the real coordinator. Every expected answer is worked out by hand from
// the seating written beside it. https://wiki.bloodontheclocktower.com/Clockmaker, /Seamstress, /Dreamer, /Flowergirl
import { describe, expect, it } from "vitest";
import { SNAKE_CHARMER_TARGET } from "./snakecharmer";
import { PHILOSOPHER_CHARACTER } from "./philosopher";
import { FANG_GU_TARGET } from "./fanggu";
import { DREAMER_FALSE_EVIL, DREAMER_FALSE_GOOD } from "./dreamer";
import { FLOWERGIRL_DEMON_VOTED } from "./flowergirl";
import { REVIEWED_INTERACTION_ROLES, runsGainedAbility } from "./passiveRules";
import { pick, plan, planned, proofGame, proofScript, request } from "@/test/proofFixtures";
import { computeNightOrder } from "@/rules/night/nightOrder";
import type { AbilityInputs } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";

const step = { withStep: true, completeStep: true } as const;
const TOWNSFOLK = ["clockmaker", "dreamer", "snakecharmer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "philosopher", "artist", "juggler", "sage"];
const OUTSIDERS = ["mutant", "sweetheart", "barber", "klutz"];
const MINIONS = ["eviltwin", "witch", "cerenovus", "pithag"];
const DEMONS = ["fanggu", "vigormortis", "nodashii", "vortox"];
const GOOD = [...TOWNSFOLK, ...OUTSIDERS];
const others = (self: string) => [...GOOD, ...MINIONS, ...DEMONS].filter((role) => role !== self);
const character = (roleId: string) => ({ kind: "character" as const, roleIds: [roleId] });
const valueOf = (g: StorytellerLobbyRecord, roleId: string, inputs: AbilityInputs = {}) => {
  const delivery = planned(plan(g, request(g, "p0", roleId, inputs))).informationDeliveries.at(-1)!;
  return delivery.values!;
};
const rowsOf = (g: StorytellerLobbyRecord) => computeNightOrder(g.players, g.seatOrder, proofScript, g.day === 1, g)
  .flatMap((s) => s.kind === "player" && s.playerId === "p0" ? [s.effectiveRoleId] : []);
const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
function withVotes(g: StorytellerLobbyRecord, day: number, nominee: string, voters: string[]): StorytellerLobbyRecord {
  const at = g.seatOrder.indexOf(nominee);
  const order = [...g.seatOrder.slice(at + 1), ...g.seatOrder.slice(0, at + 1)].map((id) => ref(g, id));
  const round: VotingRound = { id: "r1", mode: "nomination", nominator: ref(g, "p2"), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: voters.includes(voter.playerId) ? "yes" as const : "no" as const, weight: voters.includes(voter.playerId) ? 1 : 0,
      spentGhostVote: false, refundSafe: false, lifeSafe: true })),
    threshold: 20, status: "acknowledged", result: "belowThreshold", tally: voters.length, virginPending: false, contextStamp: "", executionEventIds: [] };
  return { ...g, voting: { day, revision: 1, coverage: "known", rounds: [round], activeRoundId: null, block: null, modifiers: [] } };
}

describe("SV-5a pairs: the reviewed list", () => {
  it("all four were already on it (SV-3), so none of them gates another character's action", () => {
    for (const role of ["clockmaker", "seamstress", "dreamer", "flowergirl"]) expect(REVIEWED_INTERACTION_ROLES.has(role), role).toBe(true);
  });
});

describe("SV-5a pairs: the Clockmaker against every other character of the script (Night 1)", () => {
  it("a good character in play is only a seat: Imp p1 to Poisoner p4 stays 3", () => {
    // p0 clockmaker, p1 imp, p2 chef, p3 <other>, p4 poisoner, p5 empath
    for (const other of others("clockmaker").filter((r) => GOOD.includes(r))) {
      expect(valueOf(proofGame(["clockmaker", "imp", "chef", other, "poisoner", "empath"], "night", 1), "clockmaker")[0], other).toMatchObject({ value: 3 });
    }
  });
  it("every Minion of the script is a Minion to count: 2 steps to p3", () => {
    for (const other of MINIONS) {
      expect(valueOf(proofGame(["clockmaker", "imp", "chef", other, "monk", "empath"], "night", 1), "clockmaker")[0], other).toMatchObject({ value: 2 });
    }
  });
  it("every Demon of the script is the Demon to count from; a No Dashii poisons its Clockmaker neighbour; a Vortox makes it false (SV-5i)", () => {
    // p0 clockmaker, p1 <demon>, p2 chef, p3 monk, p4 poisoner, p5 empath: 3 steps either way.
    for (const demon of ["fanggu", "vigormortis"]) {
      expect(valueOf(proofGame(["clockmaker", demon, "chef", "monk", "poisoner", "empath"], "night", 1), "clockmaker")[0], demon).toMatchObject({ value: 3 });
    }
    const noDashii = proofGame(["clockmaker", "nodashii", "chef", "monk", "poisoner", "empath"], "night", 1);
    expect(plan(noDashii, request(noDashii, "p0", "clockmaker"))).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "communicated" }] });
    // SV-5i: the Vortox counts as the Demon (3 steps), and the Storyteller chooses 1 or 2 (a ring of 6 allows up to 3).
    const vortox = proofGame(["clockmaker", "vortox", "chef", "monk", "poisoner", "empath"], "night", 1);
    expect(plan(vortox, request(vortox, "p0", "clockmaker"))).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "communicated", exclude: [3] }] });
    expect(valueOf(vortox, "clockmaker", { communicated: { kind: "number", value: 1 } })[0]).toMatchObject({ value: 1 });
  });
  it("Snake Charmer: a first-night swap with the Demon moves the Demon, and the count follows it", () => {
    // p0 clockmaker, p1 snakecharmer, p2 imp, p3 chef, p4 monk, p5 poisoner. Before: Imp p2 to Poisoner p5 = 3.
    const g = proofGame(["clockmaker", "snakecharmer", "imp", "chef", "monk", "poisoner"], "night", 1);
    const order = computeNightOrder(g.players, g.seatOrder, proofScript, true, g).flatMap((s) => s.kind === "player" ? [s.effectiveRoleId] : []);
    expect(order.indexOf("snakecharmer")).toBeLessThan(order.indexOf("clockmaker"));
    expect(valueOf(g, "clockmaker")[0]).toMatchObject({ value: 3 });
    const swapped = planned(plan(g, request(g, "p1", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, "p2") }, step)));
    expect(swapped.players.p1!.actualRole).toBe("imp");
    // The Demon is now p1: p0 and p5 = 2 steps counterclockwise.
    expect(valueOf(swapped, "clockmaker")[0]).toMatchObject({ value: 2 });
  });
  it("Philosopher: choosing the Clockmaker makes the real Clockmaker drunk, so the Storyteller chooses", () => {
    const g = proofGame(["clockmaker", "imp", "philosopher", "monk", "poisoner", "empath"], "night", 1);
    const chose = planned(plan(g, request(g, "p2", "philosopher", { [PHILOSOPHER_CHARACTER]: character("clockmaker") }, step)));
    expect(plan(chose, request(chose, "p0", "clockmaker"))).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "communicated" }] });
  });
  it("wakes on the first night only, beside every other character", () => {
    for (const other of others("clockmaker")) {
      const g = proofGame(["clockmaker", "imp", "chef", other, "poisoner"], "night", 1);
      expect(rowsOf(g), other).toContain("clockmaker");
      expect(rowsOf({ ...g, day: 2 }), other).not.toContain("clockmaker");
    }
  });
});

describe("SV-5b pairs: the Seamstress against every other character of the script", () => {
  it("YES with the Chef for every good character, NO for every evil one; a Vortox makes it false (SV-5i)", () => {
    // p0 seamstress, p1 imp, p2 chef, p3 <other>, p4 poisoner, p5 empath. The Seamstress's neighbours are the Imp and the Empath.
    for (const other of others("seamstress").filter((r) => r !== "vortox")) {
      const g = proofGame(["seamstress", "imp", "chef", other, "poisoner", "empath"], "night", 2);
      const values = valueOf(g, "seamstress", { targets: pick(g, "p2", "p3") });
      expect(values.find((v) => v.kind === "boolean"), other).toMatchObject({ value: GOOD.includes(other) });
    }
    // SV-5i: the Chef and the Vortox are not the same alignment (true: NO), so the Seamstress learns YES.
    const vortox = proofGame(["seamstress", "imp", "chef", "vortox", "poisoner", "empath"], "night", 2);
    expect(valueOf(vortox, "seamstress", { targets: pick(vortox, "p2", "p3") }).find((v) => v.kind === "boolean")).toMatchObject({ value: true });
  });
  it("Evil Twin: choosing both Twins gives NO (opposing alignments)", () => {
    const g = proofGame(["seamstress", "imp", "chef", "eviltwin", "poisoner", "empath"], "night", 2);
    expect(valueOf(g, "seamstress", { targets: pick(g, "p2", "p3") }).find((v) => v.kind === "boolean")).toMatchObject({ value: false });
  });
  it("Witch: a cursed Seamstress keeps her ability", () => {
    let g = proofGame(["seamstress", "imp", "chef", "witch", "poisoner", "empath"], "night", 2);
    g = planned(plan(g, request(g, "p3", "witch", { target: pick(g, "p0") }, step)));
    expect(g.players.p0!.effects.some((e) => e.type === "witchCurse")).toBe(true);
    expect(valueOf(g, "seamstress", { targets: pick(g, "p2", "p5") }).find((v) => v.kind === "boolean")).toMatchObject({ value: true });
  });
  it("Fang Gu: a jumped Outsider is read as the evil player they are now", () => {
    // p0 seamstress, p1 fanggu, p2 chef, p3 mutant, p4 poisoner, p5 empath. The Fang Gu kills the Mutant: they become the evil Fang Gu.
    const g = proofGame(["seamstress", "fanggu", "chef", "mutant", "poisoner", "empath"], "night", 2);
    expect(valueOf(g, "seamstress", { targets: pick(g, "p2", "p3") }).find((v) => v.kind === "boolean")).toMatchObject({ value: true });
    const jumped = planned(plan(g, request(g, "p1", "fanggu", { [FANG_GU_TARGET]: pick(g, "p3") }, step)));
    expect(jumped.players.p3).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
    expect(valueOf(jumped, "seamstress", { targets: pick(jumped, "p2", "p3") }).find((v) => v.kind === "boolean")).toMatchObject({ value: false });
  });
  it("wakes each night until used, beside every other character", () => {
    for (const other of others("seamstress")) {
      const g = proofGame(["seamstress", "imp", "chef", other, "poisoner"], "night", 2);
      expect(rowsOf(g), other).toContain("seamstress");
    }
  });
});

describe("SV-5c pairs: the Dreamer against every other character of the script", () => {
  it("the true token is the chosen character itself; the false one is asked from the other team; a Vortox makes both false (SV-5j)", () => {
    // p0 dreamer, p1 imp, p2 chef, p3 <other>, p4 poisoner, p5 empath. The Dreamer's neighbours are the Imp and the Empath.
    for (const other of others("dreamer").filter((r) => r !== "vortox")) {
      const g = proofGame(["dreamer", "imp", "chef", other, "poisoner", "empath"], "night", 2);
      const target = pick(g, "p3");
      const asked = plan(g, request(g, "p0", "dreamer", { target }));
      expect(asked, other).toMatchObject({ ok: false, code: "needsInput" });
      const id = asked.ok ? "" : asked.requirements![0]!.id;
      const good = GOOD.includes(other);
      expect(id.startsWith(good ? DREAMER_FALSE_EVIL : DREAMER_FALSE_GOOD), other).toBe(true);
      const values = valueOf(g, "dreamer", { target, [id]: character(good ? "witch" : "savant") });
      expect(values.filter((v) => v.kind === "role").map((v) => v.kind === "role" ? v.roleId : ""), other).toEqual(good ? [other, "witch"] : ["savant", other]);
    }
    // SV-5j: the Vortox chosen: the Storyteller picks both tokens, and neither may be the Vortox.
    const vortox = proofGame(["dreamer", "imp", "chef", "vortox", "poisoner", "empath"], "night", 2);
    const asked = plan(vortox, request(vortox, "p0", "dreamer", { target: pick(vortox, "p3") }));
    expect(asked).toMatchObject({ ok: false, code: "needsInput", requirements: [{ exclude: ["vortox"] }] });
    const goodId = asked.ok ? "" : asked.requirements![0]!.id;
    const second = plan(vortox, request(vortox, "p0", "dreamer", { target: pick(vortox, "p3"), [goodId]: character("savant") }));
    const evilId = second.ok ? "" : second.requirements![0]!.id;
    expect(valueOf(vortox, "dreamer", { target: pick(vortox, "p3"), [goodId]: character("savant"), [evilId]: character("nodashii") })
      .filter((v) => v.kind === "role").map((v) => v.kind === "role" ? v.roleId : "")).toEqual(["savant", "nodashii"]);
  });
  it("wakes every night, beside every other character", () => {
    for (const other of others("dreamer")) {
      const g = proofGame(["dreamer", "imp", "chef", other, "poisoner"], "night", 1);
      expect(rowsOf(g), other).toContain("dreamer");
      expect(rowsOf({ ...g, day: 2 }), other).toContain("dreamer");
    }
  });
});

describe("SV-5d pairs: the Flowergirl against every other character of the script (Night 3, after Day 2)", () => {
  it("only a Demon's vote is YES: every Demon of the script voting is YES, every other character NO; a Vortox makes it false (SV-5i)", () => {
    // p0 flowergirl, p1 imp, p2 chef, p3 <other>, p4 poisoner, p5 empath. Only p3 voted, on the Empath.
    for (const other of others("flowergirl").filter((r) => r !== "vortox")) {
      const g = withVotes(proofGame(["flowergirl", "imp", "chef", other, "poisoner", "empath"], "night", 3), 2, "p5", ["p3"]);
      expect(valueOf(g, "flowergirl")[0], other).toMatchObject({ kind: "boolean", value: DEMONS.includes(other) });
    }
    // SV-5i: the Vortox itself voted (true: YES), so the Flowergirl learns NO.
    const vortox = withVotes(proofGame(["flowergirl", "imp", "chef", "vortox", "poisoner", "empath"], "night", 3), 2, "p5", ["p3"]);
    expect(valueOf(vortox, "flowergirl")[0]).toMatchObject({ kind: "boolean", value: false });
  });
  it("Snake Charmer: the Demon who voted swaps tonight; the app cannot tell who was the Demon then, so the Storyteller rules", () => {
    // p0 flowergirl, p1 snakecharmer, p2 imp, p3 chef, p4 monk, p5 poisoner. The Imp voted during Day 2; tonight the Snake Charmer charms it.
    const g = withVotes(proofGame(["flowergirl", "snakecharmer", "imp", "chef", "monk", "poisoner"], "night", 3), 2, "p4", ["p2"]);
    const order = computeNightOrder(g.players, g.seatOrder, proofScript, false, g).flatMap((s) => s.kind === "player" ? [s.effectiveRoleId] : []);
    expect(order.indexOf("snakecharmer")).toBeLessThan(order.indexOf("flowergirl"));
    expect(valueOf(g, "flowergirl")[0]).toMatchObject({ value: true });
    const swapped = planned(plan(g, request(g, "p1", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, "p2") }, step)));
    expect(swapped.players.p2!.actualRole).toBe("snakecharmer");
    const asked = plan(swapped, request(swapped, "p0", "flowergirl"));
    expect(asked).toMatchObject({ ok: false, code: "needsInput", requirements: [{ kind: "boolean", source: "storyteller" }] });
    const id = asked.ok ? "" : asked.requirements![0]!.id;
    expect(id.startsWith(FLOWERGIRL_DEMON_VOTED)).toBe(true);
    expect(valueOf(swapped, "flowergirl", { [id]: { kind: "boolean", value: true } })[0]).toMatchObject({ value: true });
  });
  it("Philosopher: a Philosopher who gained the Flowergirl's ability wakes at her place, and that wake is the Storyteller's to run", () => {
    const g = proofGame(["philosopher", "imp", "chef", "monk", "poisoner", "empath"], "night", 2);
    const chose = planned(plan(g, request(g, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: character("flowergirl") }, step)));
    const later = { ...chose, day: 3, nightProgress: {} };
    const gained = computeNightOrder(later.players, later.seatOrder, proofScript, false, later)
      .filter((s) => s.kind === "player" && s.playerId === "p0" && s.effectiveRoleId === "flowergirl");
    expect(gained).toEqual([expect.objectContaining({ gainedFrom: "philosopher" })]);
    // The Night card runs a gained row only for the abilities on this list (SV-3b); every other gained wake is by hand.
    expect(runsGainedAbility("flowergirl")).toBe(false);
  });
  it("wakes every night but the first, beside every other character", () => {
    for (const other of others("flowergirl")) {
      const g = proofGame(["flowergirl", "imp", "chef", other, "poisoner"], "night", 1);
      expect(rowsOf(g), other).not.toContain("flowergirl");
      expect(rowsOf({ ...g, day: 2 }), other).toContain("flowergirl");
    }
  });
});
