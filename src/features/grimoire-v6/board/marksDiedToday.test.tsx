// The Godfather's official DIED TODAY token: derived from the Life Event Window for a dead Outsider, never stored.
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";
import { useV6Ctx } from "../ctx";
import { playerMarks } from "./marks";

// p0 godfather, p1 saint (outsider), p2 chef, p3 imp, p4 empath, p5 monk, p6 baron
const ROLES = ["godfather", "saint", "chef", "imp", "empath", "monk", "baron"];
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const died = (g: StorytellerLobbyRecord, id: string, phase: "day" | "night", day: number): LifeEvent =>
  ({ id: `d-${id}-${phase}${day}`, kind: "death", moment: { phase, day }, subject: { kind: "participant", playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: id }, actualRoleAtEvent: g.players[id]!.actualRole }) as LifeEvent;

function setup(phase: "day" | "night", day: number, events: (g: StorytellerLobbyRecord) => LifeEvent[], dead: string[] = ["p1"], godfatherAlive = true) {
  let g = proofGame(ROLES, phase, day);
  for (const id of dead) g = patchPlayer(g, id, { alive: false });
  if (!godfatherAlive) g = patchPlayer(g, "p0", { alive: false });
  g = { ...g, lifeEventWindow: { ...g.lifeEventWindow, events: events(g) } };
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}
const label = (id: string) => renderHook(() => {
  const g = store((s) => s.game)!;
  const ctx = useV6Ctx(g);
  const query = createRulesQuery(g, { script: ctx.script!, registry: ctx.registry });
  return playerMarks({ game: g, script: ctx.script, registry: ctx.registry, query }, g.players[id]!).map((m) => m.label);
}, { wrapper }).result.current;

beforeEach(() => { usePrivacyStore.setState({ enabled: false }); });

describe("Godfather DIED TODAY token", () => {
  it("marks an Outsider who died during the Day, on that Day and through the Night that follows", () => {
    setup("day", 2, (g) => [died(g, "p1", "day", 2)]);
    expect(label("p1")).toContain("Died Today");
    setup("night", 3, (g) => [died(g, "p1", "day", 2)]);
    expect(label("p1")).toContain("Died Today");
  });

  it("is gone by the next Day", () => {
    setup("day", 3, (g) => [died(g, "p1", "day", 2)]);
    expect(label("p1")).not.toContain("Died Today");
  });

  it("does not mark an Outsider who died at night, a non-Outsider, a living Outsider, or any game without a living Godfather", () => {
    setup("day", 2, (g) => [died(g, "p1", "night", 2)]);
    expect(label("p1")).not.toContain("Died Today");
    setup("day", 2, (g) => [died(g, "p2", "day", 2)], ["p2"]);
    expect(label("p2")).not.toContain("Died Today");
    setup("day", 2, () => [], []);
    expect(label("p1")).not.toContain("Died Today");
    setup("day", 2, (g) => [died(g, "p1", "day", 2)], ["p1"], false);
    expect(label("p1")).not.toContain("Died Today");
  });
});
