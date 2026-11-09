// The Town Crier's official tokens: derived from the Day's nomination record, never stored.
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
import { freshVotingDay } from "@/stores/voting";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";
import { useV6Ctx } from "../ctx";
import { playerMarks } from "./marks";

// p0 towncrier, p1 chef, p2 empath, p3 imp, p4 monk, p5 saint, p6 baron (the Minion), p7 recluse
const ROLES = ["towncrier", "chef", "empath", "imp", "monk", "saint", "baron", "recluse"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: id });
const round = (g: StorytellerLobbyRecord, nominator: string, nominee: string): VotingRound => {
  const order = [ref(g, nominator), ref(g, nominee)];
  return { id: `r-${nominator}-${nominee}`, mode: "nomination", nominator: ref(g, nominator), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: "no" as const, weight: 0, spentGhostVote: false, refundSafe: false, lifeSafe: true })),
    threshold: 3, status: "acknowledged", result: "belowThreshold", tally: 0, virginPending: false, contextStamp: "", executionEventIds: [] };
};

function setup(phase: "day" | "night", day: number, nominations: [string, string][], over: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord = (g) => g, coverage: "known" | "unknown" = "known") {
  const base = over(proofGame(ROLES, phase, day));
  const votingDay = phase === "day" ? day : day - 1;
  const voting = { ...freshVotingDay(votingDay, coverage), rounds: nominations.map(([from, to]) => round(base, from, to)) };
  store.setState({ game: { ...base, voting }, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}
const labels = (id: string) => renderHook(() => {
  const g = store((s) => s.game)!;
  const ctx = useV6Ctx(g);
  const query = createRulesQuery(g, { script: ctx.script!, registry: ctx.registry });
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query }, g.players[id]!).map((m) => m.label);
}, { wrapper }).result.current;

beforeEach(() => { usePrivacyStore.setState({ enabled: false }); });

describe("Town Crier nomination tokens", () => {
  it("shows Minions Not Nominated from dawn, and Minion Nominated once a Minion has nominated", () => {
    setup("day", 2, []);
    expect(labels("p0")).toContain("Minions Not Nominated");
    setup("day", 2, [["p1", "p2"]]);
    expect(labels("p0")).toContain("Minions Not Nominated");
    setup("day", 2, [["p1", "p2"], ["p6", "p1"]]);
    expect(labels("p0")).toContain("Minion Nominated");
    expect(labels("p0")).not.toContain("Minions Not Nominated");
  });

  it("stays through the Night that follows the Day and is gone by the next Day", () => {
    setup("night", 3, [["p6", "p1"]]);
    expect(labels("p0")).toContain("Minion Nominated");
    const day3 = { ...store.getState().game!, phase: "day" as const, day: 3 };
    store.setState({ game: day3 });
    expect(labels("p0")).not.toContain("Minion Nominated");
  });

  it("draws nothing for a dead or non-Town Crier, an unverifiable record, or a Recluse nominator the Storyteller must judge", () => {
    setup("day", 2, [], (g) => patchPlayer(g, "p0", { alive: false }));
    expect(labels("p0")).not.toContain("Minions Not Nominated");
    setup("day", 2, []);
    expect(labels("p1")).toEqual(expect.not.arrayContaining(["Minions Not Nominated", "Minion Nominated"]));
    setup("day", 2, [], (g) => g, "unknown");
    expect(labels("p0")).not.toContain("Minions Not Nominated");
    setup("day", 2, [["p7", "p1"]]);
    expect(labels("p0")).not.toContain("Minions Not Nominated");
    expect(labels("p0")).not.toContain("Minion Nominated");
  });

  it("is a presentation only: nothing is written to the game", () => {
    setup("day", 2, [["p6", "p1"]]);
    const before = store.getState().game;
    labels("p0");
    expect(store.getState().game).toBe(before);
    expect(before!.players.p0!.reminders).toHaveLength(0);
  });
});
