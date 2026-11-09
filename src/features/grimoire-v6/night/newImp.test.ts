// @vitest-environment node
import { describe, expect, it } from "vitest";
import { patchPlayer, proofGame } from "@/test/proofFixtures";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";
import { newImpToWake } from "./newImp";

// p0 imp, p1 scarletwoman, p2 chef, p3 empath, p4 monk, p5 saint, p6 poisoner
const ROLES = ["imp", "scarletwoman", "chef", "empath", "monk", "saint", "poisoner"];
const event = (g: StorytellerLobbyRecord, kind: "death" | "execution", phase: "day" | "night"): LifeEvent => ({
  id: `e-${kind}`, kind, moment: { phase, day: 2 }, actualRoleAtEvent: "imp", ...(kind === "execution" ? { outcome: "died" } : {}),
  subject: { kind: "participant", playerId: "p0", participantId: g.players.p0!.participantId!, nameAtTime: "Player 0" },
}) as LifeEvent;
const withEvents = (g: StorytellerLobbyRecord, events: LifeEvent[]): StorytellerLobbyRecord => ({ ...g, lifeEventWindow: { ...g.lifeEventWindow, events } });
/** The Imp (p0) is dead and the Scarlet Woman (p1) is now the Imp. */
const succeeded = (kind: "death" | "execution", phase: "day" | "night") => {
  const base = proofGame(ROLES, "night", 2);
  const g = patchPlayer(patchPlayer(base, "p0", { alive: false }), "p1", { actualRole: "imp", shownRole: "imp" });
  return withEvents(g, [event(base, kind, phase)]);
};

describe("the new Imp to wake", () => {
  it("self-kill tonight: shown on the dead Imp's card once that step is done, not before", () => {
    const g = succeeded("death", "night");
    expect(newImpToWake(g, g.players.p0, false)).toBeNull();
    expect(newImpToWake(g, g.players.p0, true)?.id).toBe("p1");
  });

  it("Scarlet Woman after a Day execution: shown on her own Imp card tonight, and nobody else's", () => {
    const g = succeeded("execution", "day");
    expect(newImpToWake(g, g.players.p1, false)?.id).toBe("p1");
    expect(newImpToWake(g, g.players.p0, true)).toBeNull();
  });

  it("an ordinary Imp with no Imp death in the window, or at Day, has nobody to wake", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(newImpToWake(g, g.players.p0, true)).toBeNull();
    const day = { ...succeeded("death", "night"), phase: "day" as const };
    expect(newImpToWake(day, day.players.p1, true)).toBeNull();
  });
});
