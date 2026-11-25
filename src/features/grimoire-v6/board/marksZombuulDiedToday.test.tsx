// BM-2c: the Zombuul's official DIED TODAY token (https://wiki.bloodontheclocktower.com/Zombuul): every player who died during the Day,
// the Zombuul's own apparent death included. Derived from the Life Event Window, never stored (planning/BM2_BUILD_PROPOSAL.md 2.3).
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
import { HIDDEN_LIFE } from "@/stores/lifeState";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";
import { useV6Ctx } from "../ctx";
import { useV6Ui } from "../v6Store";
import { playerMarks } from "./marks";

// p0 zombuul, p1 saint, p2 chef, p3 empath, p4 poisoner, p5 monk, p6 undertaker
const ROLES = ["zombuul", "saint", "chef", "empath", "poisoner", "monk", "undertaker"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const subject = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: id });
const died = (g: StorytellerLobbyRecord, id: string, phase: "day" | "night", day: number): LifeEvent =>
  ({ id: `d-${id}-${phase}${day}`, kind: "death", moment: { phase, day }, subject: subject(g, id), actualRoleAtEvent: g.players[id]!.actualRole }) as LifeEvent;
const executed = (g: StorytellerLobbyRecord, id: string, day: number, outcome: "died" | "survived" | "alreadyDead" = "died"): LifeEvent =>
  ({ id: `x-${id}-${day}`, kind: "execution", outcome, moment: { phase: "day", day }, subject: subject(g, id), actualRoleAtEvent: g.players[id]!.actualRole }) as LifeEvent;
const LIVES_ON = { id: "fx-life", type: HIDDEN_LIFE, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 } } as never;

function setup(phase: "day" | "night", day: number, events: (g: StorytellerLobbyRecord) => LifeEvent[], dead: string[] = [], roles: string[] = ROLES, patch?: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord) {
  let g = proofGame(roles, phase, day);
  for (const id of dead) g = patchPlayer(g, id, { alive: false });
  g = { ...g, lifeEventWindow: { ...g.lifeEventWindow, events: events(g) } };
  if (patch) g = patch(g);
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}
const titles = (id: string) => renderHook(() => {
  const g = store((s) => s.game)!;
  const ctx = useV6Ctx(g);
  const query = createRulesQuery(g, { script: ctx.script!, registry: ctx.registry });
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query }, g.players[id]!).map((m) => m.title);
}, { wrapper }).result.current;
const zombuulMark = (id: string) => titles(id).filter((title) => title === "Zombuul: Died Today");

beforeEach(() => { usePrivacyStore.setState({ enabled: false }); useV6Ui.getState().reset(); store.getState().selectPlayer(null); });

describe("BM-2c: the Zombuul's DIED TODAY", () => {
  it("marks every player who died during the Day, on that Day and through the Night that follows, and is gone by the next Day", () => {
    setup("day", 2, (g) => [died(g, "p2", "day", 2)], ["p2"]);
    expect(zombuulMark("p2")).toHaveLength(1);
    setup("night", 3, (g) => [died(g, "p2", "day", 2)], ["p2"]);
    expect(zombuulMark("p2")).toHaveLength(1);
    setup("day", 3, (g) => [died(g, "p2", "day", 2)], ["p2"]);
    expect(zombuulMark("p2")).toEqual([]);
  });

  it("marks the Zombuul's own apparent death: his seat (registered dead, secretly alive) carries the token", () => {
    setup("day", 2, (g) => [executed(g, "p0", 2)], ["p0"], ROLES, (g) => patchPlayer(g, "p0", { effects: [LIVES_ON] }));
    expect(zombuulMark("p0")).toHaveLength(1);
  });

  it("does not count night deaths, a survived execution, or an execution of a player already dead", () => {
    setup("day", 2, (g) => [died(g, "p2", "night", 2)], ["p2"]);
    expect(zombuulMark("p2")).toEqual([]);
    setup("day", 2, (g) => [executed(g, "p2", 2, "survived")]);
    expect(zombuulMark("p2")).toEqual([]);
    setup("day", 2, (g) => [executed(g, "p2", 2, "alreadyDead")], ["p2"]);
    expect(zombuulMark("p2")).toEqual([]);
  });

  it("needs a real Zombuul who is truly alive: none, or a Zombuul really dead, draws nothing; a poisoned one still does", () => {
    setup("day", 2, (g) => [died(g, "p2", "day", 2)], ["p2"], ["imp", "saint", "chef", "empath", "poisoner", "monk", "undertaker"]);
    expect(zombuulMark("p2")).toEqual([]);
    setup("day", 2, (g) => [died(g, "p2", "day", 2)], ["p2", "p0"]);
    expect(zombuulMark("p2")).toEqual([]);
    setup("day", 2, (g) => [died(g, "p2", "day", 2)], ["p2"], ROLES, (g) => patchPlayer(g, "p0", { effects: [{ ...(LIVES_ON as object), id: "poison", type: "poisoned" } as never] }));
    expect(zombuulMark("p2")).toHaveLength(1);
  });

  it("stacks with the Undertaker's own DIED TODAY, each with its own art (PO Q5)", () => {
    setup("day", 2, (g) => [executed(g, "p2", 2)], ["p2"]);
    expect(titles("p2")).toEqual(["Undertaker: Died Today", "Zombuul: Died Today"]);
  });
});
