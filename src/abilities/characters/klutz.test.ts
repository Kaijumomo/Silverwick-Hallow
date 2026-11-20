// SV-1c -- Klutz: "When you learn that you died, publicly choose 1 alive player: if they are evil, your team loses."
// https://wiki.bloodontheclocktower.com/Klutz -- production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { KLUTZ_TARGET, klutzVerdict } from "./klutz";
import { bind, impair, openInStore, patchPlayer, plan, planned, proofGame, proofQuery, proofRegistry, request } from "@/test/proofFixtures";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { KLUTZ_CHOICE_RULING, KLUTZ_EVIL_TEAM_LOST, KLUTZ_GOOD_TEAM_LOST } from "@/stores/gameRuleFactRegistry";
import { klutzAdvisory } from "@/stores/endGameEligibility";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// p0 klutz, p1 imp, p2 chef, p3 recluse, p4 spy, p5 monk
const ROLES = ["klutz", "imp", "chef", "recluse", "spy", "monk"];
const game = () => store.getState().game!;
const death = (g: StorytellerLobbyRecord, phase: "night" | "day", day: number): LifeEvent => ({ id: `d-${phase}${day}`, kind: "death", moment: { phase, day },
  actualRoleAtEvent: g.players.p0!.actualRole, subject: { kind: "participant", playerId: "p0", participantId: g.players.p0!.participantId!, nameAtTime: g.players.p0!.name } }) as LifeEvent;
/** Day `day`: the Klutz died during `phase` of that day (or of an earlier one). */
function dead(over: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord = (g) => g, phase: "night" | "day" = "night", diedOn = 2, day = 2): StorytellerLobbyRecord {
  const base = over(proofGame(ROLES, "day", day));
  return { ...patchPlayer(base, "p0", { alive: false }), lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [death(base, phase, diedOn)] } };
}
const choose = (g: StorytellerLobbyRecord, id: string) => plan(g, request(g, "p0", "klutz", { [KLUTZ_TARGET]: { kind: "participant", participants: [bind(g, id)] } },
  { invocationPath: "dayEntry", context: { provenance: { sourcePlayer: "p0", sourceCharacter: "klutz" } } }));
const facts = (g: StorytellerLobbyRecord) => (g.gameRuleFacts ?? []).map((fact) => fact.type);

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("Klutz -- the public choice", () => {
  it("only a death as the Klutz counts: a player who died as another character and became the Klutz since has no choice (pairs 059, 090)", () => {
    const g = dead();
    expect(choose(g, "p1")).toMatchObject({ ok: true, changed: true });
    const asChef = { ...g, lifeEventWindow: { ...g.lifeEventWindow, events: [{ ...g.lifeEventWindow.events[0]!, actualRoleAtEvent: "chef" }] } };
    expect(choose(asChef, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    // A life record that does not reach the death is still the Storyteller's call.
    const uncovered = { ...asChef, lifeEventWindow: { coverageFrom: { phase: "day" as const, day: 3 }, events: [] } };
    expect(choose(uncovered, "p1")).toMatchObject({ ok: true, changed: true });
  });

  it("a sober good Klutz chooses an evil player: the ability is used, the good team's loss is recorded with the Klutz as its source, and End is flagged", () => {
    const g = dead();
    const next = planned(choose(g, "p1"));
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(next.gameRuleFacts).toEqual([expect.objectContaining({ type: KLUTZ_GOOD_TEAM_LOST, recordedAt: { phase: "day", day: 2 },
      provenance: expect.objectContaining({ sourceCharacter: "klutz", sourceParticipant: expect.objectContaining({ playerId: "p0", participantId: g.players.p0!.participantId }) }) })]);
    expect(next.gameRuleFacts![0]!.expiresAt).toBeUndefined();
    expect(klutzAdvisory(next)).toBe("The Klutz chose an evil player. Evil wins. Check before ending the game");
    // Nothing ends by itself.
    expect(next.phase).toBe("day");
  });

  it("a good player: the choice is used and nothing is flagged", () => {
    const next = planned(choose(dead(), "p2"));
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(facts(next)).toEqual([]);
    expect(klutzAdvisory(next)).toBeNull();
  });

  it("an evil Klutz who chooses an evil player: good wins; an evil Klutz who chooses a good player: nothing", () => {
    const evil = (g: StorytellerLobbyRecord) => patchPlayer(g, "p0", { actualAlignment: "evil" });
    const next = planned(choose(dead(evil), "p1"));
    expect(facts(next)).toEqual([KLUTZ_EVIL_TEAM_LOST]);
    expect(klutzAdvisory(next)).toBe("The Klutz chose an evil player. Good wins. Check before ending the game");
    expect(facts(planned(choose(dead(evil), "p2")))).toEqual([]);
  });

  it("a player who may register either way (Recluse, Spy): the Storyteller's ruling, nothing pre-selected", () => {
    for (const id of ["p3", "p4"]) {
      const next = planned(choose(dead(), id));
      expect(facts(next)).toEqual([KLUTZ_CHOICE_RULING]);
      expect(klutzAdvisory(next)).toBe("The Klutz chose a player who may register as evil. Your ruling");
    }
  });

  it("a drunk or poisoned Klutz: the choice is recorded (used) and nothing is flagged", () => {
    for (const type of ["drunk", "poisoned"]) {
      const next = planned(choose(dead((g) => impair(g, "p0", type)), "p1"));
      expect(next.players.p0!.abilityUsed).toBe(true);
      expect(facts(next)).toEqual([]);
    }
  });

  it("living players only; one choice; only on the Day the Klutz learned they died", () => {
    const g = dead((base) => patchPlayer(base, "p2", { alive: false }));
    expect(choose(g, "p2")).toMatchObject({ ok: false });
    const used = planned(choose(dead(), "p5"));
    expect(choose(used, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    // Died in the Day: at once. Died last night: from dawn. Died on an earlier Day or Night: the ability is lost.
    expect(choose(dead((x) => x, "day", 2), "p1")).toMatchObject({ ok: true });
    expect(choose(dead((x) => x, "day", 1, 2), "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(choose(dead((x) => x, "night", 1, 2), "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(choose(proofGame(ROLES, "day", 2), "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    const night = { ...dead(), phase: "night" as const };
    expect(plan(night, request(night, "p0", "klutz", { [KLUTZ_TARGET]: { kind: "participant", participants: [bind(night, "p1")] } }, { invocationPath: "dayEntry" })))
      .toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("one commit; Undo removes the use and the fact together", () => {
    const g = dead();
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "klutz", { [KLUTZ_TARGET]: { kind: "participant", participants: [bind(g, "p1")] } },
      { invocationPath: "dayEntry", context: { provenance: { sourcePlayer: "p0", sourceCharacter: "klutz" } } }))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(game().players.p0!.abilityUsed).toBe(false);
    expect(game().gameRuleFacts ?? []).toEqual(g.gameRuleFacts ?? []);
  });

  it("the End line shows only on the Day of the choice: once play goes on into the night it goes, and the fact stays", () => {
    const next = planned(choose(dead(), "p1"));
    expect(klutzAdvisory(next)).not.toBeNull();
    expect(klutzAdvisory({ ...next, phase: "night", day: 3 })).toBeNull();
    expect(klutzAdvisory({ ...next, day: 3 })).toBeNull();
    expect(facts({ ...next, phase: "night", day: 3 })).toEqual([KLUTZ_GOOD_TEAM_LOST]);
  });

  it("a good pick is nothing even when the Klutz's own alignment is not set; an evil pick then is the Storyteller's ruling", () => {
    const unset = (g: StorytellerLobbyRecord) => patchPlayer(g, "p0", { actualAlignment: null as never });
    const g = dead(unset);
    expect(klutzVerdict(proofQuery(g), bind(g, "p0"), bind(g, "p2"), true)).toEqual({ verdict: "nothing" });
    expect(klutzVerdict(proofQuery(g), bind(g, "p0"), bind(g, "p1"), true)).toEqual({ verdict: "ruling", fact: KLUTZ_CHOICE_RULING });
  });

  it("privacy: the recorded choice reaches no player view and not the public view", () => {
    const g = dead();
    const next = planned(choose(g, "p1"));
    expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
    const before = projectLobbyToSelfMap(g, proofRegistry), after = projectLobbyToSelfMap(next, proofRegistry);
    for (const id of g.seatOrder) expect(after[id]).toEqual(before[id]);
  });
});
