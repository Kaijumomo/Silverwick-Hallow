// @vitest-environment node
// SV-5d: the Flowergirl (https://wiki.bloodontheclocktower.com/Flowergirl, saved 2026-11-11). Expected answers are the page's examples
// and rules, typed here, never read back from the code under test.
import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, patchPlayer, plan, planned, proofGame, proofQuery, request, reseat, yes } from "@/test/proofFixtures";
import { FLOWERGIRL_DEMON_VOTED, demonVotedOn } from "./flowergirl";
import type { AbilityInputs } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";

const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
/** One recorded vote: `voters` raised their hands (YES); everyone else said no. The order runs clockwise from the nominee's left and
 * ends with the nominee, and the threshold is out of reach, so the record is a valid stored one (who is executed never matters here). */
const round = (g: StorytellerLobbyRecord, nominator: string, nominee: string, voters: string[], options: { mode?: "nomination" | "exile"; status?: VotingRound["status"]; ghost?: string[] } = {}): VotingRound => {
  const at = g.seatOrder.indexOf(nominee);
  const order = [...g.seatOrder.slice(at + 1), ...g.seatOrder.slice(0, at + 1)].map((id) => ref(g, id));
  const mode = options.mode ?? "nomination";
  const status = options.status ?? "acknowledged";
  return { id: `r-${nominator}-${nominee}-${mode}-${voters.join("")}`, mode, nominator: ref(g, nominator), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: voters.includes(voter.playerId) ? "yes" as const : "no" as const, weight: voters.includes(voter.playerId) ? 1 : 0,
      spentGhostVote: voters.includes(voter.playerId) && (options.ghost?.includes(voter.playerId) ?? false), refundSafe: false, lifeSafe: true })),
    threshold: 20, status, result: status === "abandoned" ? null : mode === "exile" ? "exileFailed" : "belowThreshold", tally: voters.length, virginPending: false, contextStamp: "", executionEventIds: [] };
};
const withVoting = (g: StorytellerLobbyRecord, day: number, rounds: VotingRound[], coverage: "known" | "unknown" = "known"): StorytellerLobbyRecord =>
  ({ ...g, voting: { day, revision: 1, coverage, rounds, activeRoundId: null, block: null, modifiers: [] } });

// Seats: p0 flowergirl, p1 fanggu, p2 witch, p3 sage, p4 mutant, p5 clockmaker, p6 dreamer
const ROLES = ["flowergirl", "fanggu", "witch", "sage", "mutant", "clockmaker", "dreamer"];
const night3 = () => proofGame(ROLES, "night", 3);
const learn = (g: StorytellerLobbyRecord, inputs: AbilityInputs = {}) => plan(g, request(g, "p0", "flowergirl", inputs));
const told = (g: StorytellerLobbyRecord, inputs: AbilityInputs = {}) => {
  const delivery = planned(learn(g, inputs)).informationDeliveries.at(-1)!;
  expect(delivery).toMatchObject({ informationActionId: "flowergirl-other-night" });
  return (delivery.values![0] as { value: boolean }).value;
};

describe("SV-5d Flowergirl: the page's examples", () => {
  it("one nomination, lots voted, executed, but not the Demon: NO", () => {
    const base = night3();
    expect(told(withVoting(base, 2, [round(base, "p3", "p4", ["p2", "p3", "p5", "p6"])]))).toBe(false);
  });
  it("three nominations, the Demon voted in the second, nobody executed: YES", () => {
    const base = night3();
    expect(told(withVoting(base, 2, [round(base, "p3", "p4", ["p5"]), round(base, "p5", "p6", ["p1", "p3"]), round(base, "p6", "p3", [])]))).toBe(true);
  });
  it("no nominations, a Traveller exiled with every hand raised: NO (exiles never count)", () => {
    const base = night3();
    expect(told(withVoting(base, 2, [round(base, "p3", "p4", ["p0", "p1", "p2", "p3", "p4", "p5", "p6"], { mode: "exile" })]))).toBe(false);
    expect(told(withVoting(base, 2, []))).toBe(false);
  });
});

describe("SV-5d Flowergirl: what counts", () => {
  it("a dead Demon's ghost vote counts; a Demon's NO does not; two Demons: either one voting is YES", () => {
    const base = patchPlayer(night3(), "p1", { alive: false });
    expect(told(withVoting(base, 2, [round(base, "p3", "p4", ["p1"], { ghost: ["p1"] })]))).toBe(true);
    expect(told(withVoting(base, 2, [round(base, "p3", "p4", ["p3"])]))).toBe(false);
    const two = patchPlayer(night3(), "p6", { actualRole: "vigormortis", actualAlignment: "evil" });
    expect(told(withVoting(two, 2, [round(two, "p3", "p4", ["p6"])]))).toBe(true);
  });

  it("the Demon who voted is detected even after the Demon moved to another player tonight; the app asks when it cannot tell", () => {
    // Snake Charmer-style swap tonight: p3 is now the Fang Gu, p1 the Sage. p1 voted as the Demon during Day 2.
    let g = night3();
    g = patchPlayer(patchPlayer(g, "p1", { actualRole: "sage", actualAlignment: "good", characterSince: { phase: "night", day: 3 } }),
      "p3", { actualRole: "fanggu", actualAlignment: "evil", characterSince: { phase: "night", day: 3 } });
    const voted = withVoting(g, 2, [round(g, "p4", "p5", ["p1"])]);
    const asked = learn(voted);
    expect(asked).toMatchObject({ ok: false, code: "needsInput" });
    const requirement = asked.ok ? undefined : asked.requirements![0]!;
    expect(requirement).toMatchObject({ kind: "boolean", source: "storyteller" });
    expect(requirement!.id.startsWith(FLOWERGIRL_DEMON_VOTED)).toBe(true);
    expect(asked.ok ? "" : asked.message).toMatch(/changed character since, so may have been a Demon then\. Did a Demon vote today\?$/);
    expect(told(voted, { [requirement!.id]: yes(true) })).toBe(true);
    // Only the new Demon (who was the Sage then) voted: still asked, never "the current Demon voted".
    expect(learn(withVoting(g, 2, [round(g, "p4", "p5", ["p3"])]))).toMatchObject({ ok: false, code: "needsInput" });
  });

  it("a character held since before the Day is known at the vote: no question", () => {
    const g = patchPlayer(night3(), "p1", { characterSince: { phase: "night", day: 2 } });
    expect(told(withVoting(g, 2, [round(g, "p4", "p5", ["p1"])]))).toBe(true);
  });

  it("a Recluse who voted may register as a Demon: one question, unless a Demon certainly voted", () => {
    const base = patchPlayer(night3(), "p4", { actualRole: "recluse" });
    const asked = learn(withVoting(base, 2, [round(base, "p3", "p5", ["p4"])]));
    expect(asked).toMatchObject({ ok: false, code: "needsInput" });
    expect(asked.ok ? "" : asked.message).toMatch(/may register as a Demon/);
    expect(told(withVoting(base, 2, [round(base, "p3", "p5", ["p4", "p1"])]))).toBe(true);
    // A poisoned Recluse registers as itself.
    expect(told(impair(withVoting(base, 2, [round(base, "p3", "p5", ["p4"])]), "p4"))).toBe(false);
  });

  it("a Spy who voted never registers as a Demon: no question", () => {
    const base = patchPlayer(night3(), "p2", { actualRole: "spy" });
    expect(told(withVoting(base, 2, [round(base, "p3", "p5", ["p2"])]))).toBe(false);
  });

  it("a Demon's YES in a vote that was abandoned is the Storyteller's question; a non-Demon's is ignored", () => {
    const base = night3();
    expect(learn(withVoting(base, 2, [round(base, "p3", "p5", ["p1"], { status: "abandoned" })]))).toMatchObject({ ok: false, code: "needsInput" });
    expect(told(withVoting(base, 2, [round(base, "p3", "p5", ["p2", "p3"], { status: "abandoned" })]))).toBe(false);
  });

  it("one certain Demon vote anywhere in the Day is YES, even after a vote the app cannot read", () => {
    // Round 1: p2 voted, and p2's seat has since been taken by a new participant. Round 2: the Fang Gu (p1) voted.
    const base = night3();
    const record = withVoting(base, 2, [round(base, "p3", "p4", ["p2"]), round(base, "p5", "p3", ["p1"])]);
    expect(told(reseat(record, "p2"))).toBe(true);
    // Without the Demon's vote, the unreadable one sends the step by hand.
    expect(learn(reseat(withVoting(base, 2, [round(base, "p3", "p4", ["p2"])]), "p2"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a Demon's hand raised in a vote still open counts at once", () => {
    const base = night3();
    // Nominee p4: the order runs p5, p6, p0, p1, ...; four hands are in, the Fang Gu's (p1) last.
    const open = round(base, "p3", "p4", ["p1"], { status: "voting" });
    const live = { ...open, responses: open.responses.slice(0, 4), result: null, tally: open.responses.slice(0, 4).reduce((n, r) => n + r.weight, 0) };
    expect(demonVotedOn(proofQuery({ ...withVoting(base, 2, [live]), voting: { ...withVoting(base, 2, [live]).voting!, activeRoundId: live.id } }), 2))
      .toEqual({ kind: "known", voted: true });
  });

  it("the record is read, not stored: correcting a vote changes the answer", () => {
    const base = night3();
    expect(demonVotedOn(proofQuery(withVoting(base, 2, [round(base, "p3", "p5", ["p1"])])), 2)).toEqual({ kind: "known", voted: true });
    expect(demonVotedOn(proofQuery(withVoting(base, 2, [round(base, "p3", "p5", [])])), 2)).toEqual({ kind: "known", voted: false });
  });
});

describe("SV-5d Flowergirl: impaired, the first night and by hand", () => {
  it.each(["poisoned", "drunk"])("%s: the Storyteller chooses YES or NO", (type) => {
    const base = night3();
    const g = impair(withVoting(base, 2, [round(base, "p3", "p5", ["p1"])]), "p0", type);
    expect(learn(g)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "communicated", kind: "boolean", source: "storyteller" }] });
    expect(told(g, { communicated: yes(false) })).toBe(false);
  });

  it("a Drunk shown the Flowergirl: a simulated answer the Storyteller chooses, recorded for the Drunk", () => {
    const base = night3();
    const g = patchPlayer(withVoting(base, 2, [round(base, "p3", "p5", ["p1"])]), "p0",
      { actualRole: "drunk", shownRole: "flowergirl", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" });
    expect(learn(g)).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "communicated" }] });
    const next = planned(learn(g, { communicated: yes(false) }));
    expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "flowergirl" });
    expect(next.players).toBe(g.players);
  });

  it("no answer on the first night; by hand when the record is missing, from another Day or incomplete, or homebrew; a Vortox makes it false (SV-5i)", () => {
    expect(learn(proofGame(ROLES, "night", 1))).toMatchObject({ ok: false });
    const base = night3();
    expect(learn(base)).toMatchObject({ ok: false, code: "unsupported" });
    expect(learn(withVoting(base, 1, []))).toMatchObject({ ok: false, code: "unsupported" });
    expect(learn(withVoting(base, 2, [], "unknown"))).toMatchObject({ ok: false, code: "unsupported" });
    const vortox = patchPlayer(withVoting(base, 2, []), "p1", { actualRole: "vortox" });
    // The page: "the Flowergirl ... learns 'yes'" on a day nobody voted.
    expect(told(vortox)).toBe(true);
    expect(plan(base, request(base, "p0", "flowergirl"), homebrewEnv("flowergirl"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
