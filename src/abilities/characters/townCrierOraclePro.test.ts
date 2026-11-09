// Treacherous 30th slice 2D -- Town Crier, Oracle and Professor. Production semantics.
import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";

const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
const round = (g: StorytellerLobbyRecord, nominator: string, nominee: string, mode: "nomination" | "exile" = "nomination"): VotingRound => {
  const order = [ref(g, nominator), ref(g, nominee)];
  return { id: `r-${nominator}-${nominee}-${mode}`, mode, nominator: ref(g, nominator), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: "no" as const, weight: 0, spentGhostVote: false, refundSafe: false, lifeSafe: true })),
    threshold: 3, status: "acknowledged", result: mode === "exile" ? "exileFailed" : "belowThreshold", tally: 0, virginPending: false, contextStamp: "", executionEventIds: [] };
};
const withVoting = (g: StorytellerLobbyRecord, day: number, rounds: VotingRound[], coverage: "known" | "unknown" = "known"): StorytellerLobbyRecord =>
  ({ ...g, voting: { day, revision: 1, coverage, rounds, activeRoundId: null, block: null, modifiers: [] } });
const yes = { kind: "boolean" as const, value: true };

// Seats: p0 towncrier, p1 chef, p2 empath, p3 monk, p4 imp, p5 saint, p6 baron
const TC = ["towncrier", "chef", "empath", "monk", "imp", "saint", "baron"];
const crier = (g: StorytellerLobbyRecord) => plan(g, request(g, "p0", "towncrier"));

describe("Town Crier", () => {
  it("learns YES when a Minion nominated during the Day that just ended", () => {
    const base = proofGame(TC, "night", 3);
    const g = withVoting(base, 2, [round(base, "p6", "p1")]);
    const next = planned(crier(g));
    expect(JSON.stringify(next.informationDeliveries)).toContain('"value":true');
  });

  it("learns NO when only non-Minions nominated, or nobody nominated, and exiles do not count", () => {
    const base = proofGame(TC, "night", 3);
    for (const rounds of [[round(base, "p1", "p2")], [], [round(base, "p6", "p1", "exile")]]) {
      expect(JSON.stringify(planned(crier(withVoting(base, 2, rounds))).informationDeliveries)).toContain('"value":false');
    }
  });

  it("is Manual when the nomination record is missing, from another day, or incomplete", () => {
    const base = proofGame(TC, "night", 3);
    expect(crier(base)).toMatchObject({ ok: false, code: "unsupported" });
    expect(crier(withVoting(base, 1, []))).toMatchObject({ ok: false, code: "unsupported" });
    expect(crier(withVoting(base, 2, [], "unknown"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("asks the Storyteller ONE question when a Spy nominated, like the Godfather, and tells the Town Crier that answer", () => {
    const base = proofGame(TC, "night", 3);
    const spy = patchPlayer(withVoting(base, 2, [round(base, "p6", "p1")]), "p6", { actualRole: "spy" });
    const asked = crier(spy);
    expect(asked).toMatchObject({ ok: false, code: "needsInput" });
    expect(asked.ok ? "" : asked.message).toMatch(/may register as a Minion\. Did a Minion nominate today\?/);
    const id = asked.ok ? "" : asked.requirements![0]!.id;
    expect(asked.ok ? 0 : asked.requirements).toHaveLength(1);
    for (const [answer, value] of [[true, "true"], [false, "false"]] as const) {
      const told = plan(spy, request(spy, "p0", "towncrier", { [id]: { kind: "boolean", value: answer } }));
      expect(JSON.stringify(planned(told).informationDeliveries)).toContain(`"value":${value}`);
    }
  });

  it("a certain Minion nomination answers YES without asking, even beside a Spy's", () => {
    const base = proofGame(TC, "night", 3);
    const g = patchPlayer(withVoting(base, 2, [round(base, "p1", "p2"), round(base, "p6", "p1")]), "p1", { actualRole: "spy" });
    expect(JSON.stringify(planned(crier(g)).informationDeliveries)).toContain('"value":true');
  });

  it("an impaired Town Crier is told what the Storyteller chooses; Night 1 and homebrew are refused", () => {
    const base = proofGame(TC, "night", 3);
    const g = impair(withVoting(base, 2, []), "p0");
    expect(crier(g)).toMatchObject({ ok: false, code: "needsInput" });
    const told = plan(g, request(g, "p0", "towncrier", { communicated: yes }));
    expect(JSON.stringify(planned(told).informationDeliveries)).toContain('"value":true');
    const first = proofGame(TC, "night", 1);
    expect(crier(first)).toMatchObject({ ok: false, code: "notApplicable" });
    expect(plan(base, request(base, "p0", "towncrier"), homebrewEnv("towncrier"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

// Seats: p0 oracle, p1 chef, p2 empath, p3 monk, p4 imp, p5 saint, p6 baron
const OR = ["oracle", "chef", "empath", "monk", "imp", "saint", "baron"];
const oracle = (g: StorytellerLobbyRecord) => plan(g, request(g, "p0", "oracle"));
const shown = (g: StorytellerLobbyRecord) => JSON.stringify(planned(oracle(g)).informationDeliveries);

describe("Oracle", () => {
  it("counts the dead evil players", () => {
    const g = proofGame(OR, "night", 3);
    expect(shown(g)).toContain('"value":0');
    expect(shown(patchPlayer(g, "p1", { alive: false }))).toContain('"value":0');
    expect(shown(patchPlayer(patchPlayer(g, "p4", { alive: false }), "p6", { alive: false }))).toContain('"value":2');
    expect(shown(patchPlayer(patchPlayer(g, "p4", { alive: false }), "p1", { alive: false }))).toContain('"value":1');
  });

  it("a dead Spy or Recluse is the Storyteller's call (Manual)", () => {
    const g = patchPlayer(patchPlayer(proofGame(OR, "night", 3), "p6", { actualRole: "spy" }), "p6", { alive: false });
    expect(oracle(g)).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("an impaired Oracle is told the Storyteller's number; Night 1 and homebrew are refused", () => {
    const g = impair(proofGame(OR, "night", 3), "p0");
    expect(oracle(g)).toMatchObject({ ok: false, code: "needsInput" });
    const told = plan(g, request(g, "p0", "oracle", { communicated: { kind: "number", value: 2 } }));
    expect(JSON.stringify(planned(told).informationDeliveries)).toContain('"value":2');
    const first = proofGame(OR, "night", 1);
    expect(oracle(first)).toMatchObject({ ok: false, code: "notApplicable" });
    const base = proofGame(OR, "night", 3);
    expect(plan(base, request(base, "p0", "oracle"), homebrewEnv("oracle"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

// Seats: p0 professor, p1 chef, p2 empath, p3 monk, p4 imp, p5 saint, p6 baron
const PR = ["professor", "chef", "empath", "monk", "imp", "saint", "baron"];
const prof = (g: StorytellerLobbyRecord, target: string) => plan(g, request(g, "p0", "professor", { target: pick(g, target) }));

describe("Professor", () => {
  it("resurrects a dead Townsfolk and uses the ability for the game", () => {
    const g = patchPlayer(proofGame(PR, "night", 3), "p1", { alive: false });
    const next = planned(prof(g, "p1"));
    expect(next.players.p1!.alive).toBe(true);
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(prof(next, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a dead non-Townsfolk stays dead but the ability is still used", () => {
    const g = patchPlayer(proofGame(PR, "night", 3), "p5", { alive: false });
    const next = planned(prof(g, "p5"));
    expect(next.players.p5!.alive).toBe(false);
    expect(next.players.p0!.abilityUsed).toBe(true);
  });

  it("a living target is refused, a dead Spy is Manual, an impaired Professor revives no one", () => {
    const g = patchPlayer(proofGame(PR, "night", 3), "p1", { alive: false });
    expect(prof(g, "p2")).toMatchObject({ ok: false, code: "illegal" });
    const spy = patchPlayer(patchPlayer(g, "p6", { actualRole: "spy" }), "p6", { alive: false });
    expect(prof(spy, "p6")).toMatchObject({ ok: false, code: "unsupported" });
    const hurt = impair(g, "p0");
    const next = plan(hurt, request(hurt, "p0", "professor", { target: pick(hurt, "p1") }));
    expect(next.ok && next.changed ? next.plan.game.players.p1!.alive : null).toBe(false);
  });

  it("does not act on Night 1, and a homebrew copy inherits nothing", () => {
    const first = patchPlayer(proofGame(PR, "night", 1), "p1", { alive: false });
    expect(prof(first, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    const g = patchPlayer(proofGame(PR, "night", 3), "p1", { alive: false });
    expect(plan(g, request(g, "p0", "professor", { target: pick(g, "p1") }), homebrewEnv("professor"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
