// SV-5d: the Flowergirl's official tokens (DEMON VOTED / DEMON NOT VOTED), derived from the Day's voting record, never stored (PO Q3).
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
import { freshVotingDay } from "@/stores/voting";
import { patchPlayer, plan, planned, proofGame, proofScript, request } from "@/test/proofFixtures";
import { PHILOSOPHER_CHARACTER } from "@/abilities/characters/philosopher";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";
import { useV6Ctx } from "../ctx";
import { playerMarks } from "./marks";

// p0 flowergirl, p1 fanggu (the Demon), p2 witch, p3 sage, p4 mutant, p5 clockmaker, p6 recluse
const ROLES = ["flowergirl", "fanggu", "witch", "sage", "mutant", "clockmaker", "recluse"];
const TOKENS = ["Demon Voted", "Demon Not Voted"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: id });
/** A finished vote on `nominee` in which `voters` raised their hands (order clockwise from the nominee's left, nominee last). */
const round = (g: StorytellerLobbyRecord, nominator: string, nominee: string, voters: string[]): VotingRound => {
  const at = g.seatOrder.indexOf(nominee);
  const order = [...g.seatOrder.slice(at + 1), ...g.seatOrder.slice(0, at + 1)].map((id) => ref(g, id));
  return { id: `r-${nominator}-${nominee}`, mode: "nomination", nominator: ref(g, nominator), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: voters.includes(voter.playerId) ? "yes" as const : "no" as const, weight: voters.includes(voter.playerId) ? 1 : 0,
      spentGhostVote: false, refundSafe: false, lifeSafe: true })),
    threshold: 20, status: "acknowledged", result: "belowThreshold", tally: voters.length, virginPending: false, contextStamp: "", executionEventIds: [] };
};

function setup(phase: "day" | "night", day: number, votes: [string, string, string[]][], over: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord = (g) => g, coverage: "known" | "unknown" = "known") {
  const base = over(proofGame(ROLES, phase, day));
  const votingDay = phase === "day" ? day : day - 1;
  const voting = { ...freshVotingDay(votingDay, coverage), rounds: votes.map(([from, to, voters]) => round(base, from, to, voters)) };
  store.setState({ game: { ...base, voting }, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}
const labels = (id: string) => renderHook(() => {
  const g = store((s) => s.game)!;
  const ctx = useV6Ctx(g);
  const query = createRulesQuery(g, { script: ctx.script!, registry: ctx.registry });
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query }, g.players[id]!).map((m) => m.label);
}, { wrapper }).result.current;

beforeEach(() => { usePrivacyStore.setState({ enabled: false }); });

describe("SV-5d Flowergirl vote tokens", () => {
  it("shows Demon Not Voted from dawn, and Demon Voted once the Demon has voted", () => {
    setup("day", 2, []);
    expect(labels("p0")).toContain("Demon Not Voted");
    setup("day", 2, [["p3", "p4", ["p2", "p3", "p5"]]]);
    expect(labels("p0")).toContain("Demon Not Voted");
    setup("day", 2, [["p3", "p4", ["p2"]], ["p5", "p3", ["p1"]]]);
    expect(labels("p0")).toContain("Demon Voted");
    expect(labels("p0")).not.toContain("Demon Not Voted");
  });

  it("stays through the Night that follows the Day; nothing on the first night", () => {
    setup("night", 3, [["p5", "p3", ["p1"]]]);
    expect(labels("p0")).toContain("Demon Voted");
    setup("night", 1, []);
    expect(labels("p0")).toEqual(expect.not.arrayContaining(TOKENS));
  });

  it("draws nothing for a dead or non-Flowergirl, an unverifiable record, or a Recluse's vote the Storyteller must rule", () => {
    setup("day", 2, [], (g) => patchPlayer(g, "p0", { alive: false }));
    expect(labels("p0")).toEqual(expect.not.arrayContaining(TOKENS));
    setup("day", 2, []);
    expect(labels("p3")).toEqual(expect.not.arrayContaining(TOKENS));
    setup("day", 2, [], (g) => g, "unknown");
    expect(labels("p0")).toEqual(expect.not.arrayContaining(TOKENS));
    setup("day", 2, [["p3", "p4", ["p6"]]]);
    expect(labels("p0")).toEqual(expect.not.arrayContaining(TOKENS));
    // ... unless a Demon certainly voted as well.
    setup("day", 2, [["p3", "p4", ["p6", "p1"]]]);
    expect(labels("p0")).toContain("Demon Voted");
  });

  it("a Philosopher who gained the Flowergirl's ability gets her tokens too, as the Town Crier's", () => {
    const night = proofGame([...ROLES.slice(0, 6), "philosopher"], "night", 1);
    const chose = planned(plan(night, request(night, "p6", "philosopher", { [PHILOSOPHER_CHARACTER]: { kind: "character", roleIds: ["flowergirl"] } }, { withStep: true, completeStep: true })));
    const day = { ...chose, phase: "day" as const, day: 2 };
    store.setState({ game: { ...day, voting: { ...freshVotingDay(2, "known"), rounds: [round(day, "p5", "p3", ["p1"])] } }, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
    expect(labels("p6")).toContain("Demon Voted");
  });

  it("is a presentation only: nothing is written to the game", () => {
    setup("day", 2, [["p5", "p3", ["p1"]]]);
    const before = store.getState().game;
    labels("p0");
    expect(store.getState().game).toBe(before);
    expect(before!.players.p0!.reminders).toHaveLength(0);
  });
});
