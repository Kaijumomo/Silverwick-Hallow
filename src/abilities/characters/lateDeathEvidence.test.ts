// SV-2 follow-up (approved 2026-11-20; found by the SV-1 independent check of 93b16ac): a death recorded through the correction path
// (a late record, or an amend to another player) carries no character evidence. The Klutz's choice, the Sweetheart's Day row and the
// Barber's HAIRCUTS TONIGHT token must stay offered for it (the Storyteller decides), never silently hidden; a death recorded as
// another character still never counts.
import { beforeEach, describe, expect, it } from "vitest";
import { klutzLearnedDeath, KLUTZ_TARGET } from "./klutz";
import { sweetheartOpenDayDeath, SWEETHEART_PLAYER } from "./sweetheart";
import { haircutsTonight } from "./barber";
import { mayBeDeathAs } from "@/stores/lifeEvents";
import { bind, openInStore, patchPlayer, pick, plan, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
const lastEvent = () => game().lifeEventWindow.events.at(-1)!;

/** Day 2 open in the store, with the Life window covering Night 2 and Day 2 (the real setPhase path). */
function day2(roles: string[]): StorytellerLobbyRecord {
  openInStore(proofGame(roles, "night", 2));
  store.getState().setPhase("day");
  store.setState({ undoStack: [] });
  expect(game()).toMatchObject({ phase: "day", day: 2 });
  return game();
}
/** A Day execution recorded against the wrong player (p2), then amended to the right one (p0): the amend has no evidence. */
function amendedExecution(roles: string[]) {
  day2(roles);
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p2", outcome: "died" }] }).ok).toBe(true);
  const wrong = lastEvent();
  expect(wrong.actualRoleAtEvent).toBe(roles[2]);
  const amended = store.getState().amendLifeEvent(wrong.id, { kind: "execution", outcome: "died", playerId: "p0" },
    [{ playerId: "p2", target: { alive: true } }, { playerId: "p0", target: { alive: false, ghostVote: true } }]);
  expect(amended, JSON.stringify(amended)).toMatchObject({ ok: true });
  expect(lastEvent()).toMatchObject({ kind: "execution", subject: expect.objectContaining({ playerId: "p0" }) });
  expect(lastEvent().actualRoleAtEvent).toBeUndefined();
  return game();
}

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("mayBeDeathAs", () => {
  it("counts a death as this character or with no evidence, never one recorded as another character", () => {
    expect(mayBeDeathAs({ actualRoleAtEvent: "klutz" } as LifeEvent, "klutz")).toBe(true);
    expect(mayBeDeathAs({} as LifeEvent, "klutz")).toBe(true);
    expect(mayBeDeathAs({ actualRoleAtEvent: "chef" } as LifeEvent, "klutz")).toBe(false);
  });
});

describe("a death recorded late or amended keeps the SV-1 choices offered", () => {
  it("Klutz: a Night death recorded late during the Day still gives the choice, and it resolves", () => {
    day2(["klutz", "imp", "chef", "monk", "empath"]);
    expect(store.getState().lateRecordLifeEvent({ kind: "death", playerId: "p0" }, [{ playerId: "p0", target: { alive: false, ghostVote: true } }]).ok).toBe(true);
    expect(lastEvent()).toMatchObject({ kind: "death", moment: { phase: "night", day: 2 } });
    expect(lastEvent().actualRoleAtEvent).toBeUndefined();
    const g = game();
    expect(klutzLearnedDeath(proofQuery(g), bind(g, "p0"))).toBe(true);
    expect(plan(g, request(g, "p0", "klutz", { [KLUTZ_TARGET]: pick(g, "p2") }, { invocationPath: "dayEntry" }))).toMatchObject({ ok: true, changed: true });
  });

  it("Sweetheart: an execution amended onto her still opens her Day row, and it resolves", () => {
    const g = amendedExecution(["sweetheart", "imp", "chef", "monk", "empath"]);
    expect(sweetheartOpenDayDeath(proofQuery(g), bind(g, "p0"))).not.toBeNull();
    expect(plan(g, request(g, "p0", "sweetheart", { [SWEETHEART_PLAYER]: pick(g, "p2") }, { invocationPath: "dayEntry" }))).toMatchObject({ ok: true, changed: true });
  });

  it("Barber: an execution amended onto the Barber still draws HAIRCUTS TONIGHT", () => {
    const g = amendedExecution(["barber", "imp", "chef", "monk", "empath"]);
    expect(haircutsTonight(proofQuery(g), bind(g, "p0"))).toBe(true);
  });

  it("a death recorded as another character still never counts (a player who became the Klutz, Sweetheart or Barber afterwards)", () => {
    for (const role of ["klutz", "sweetheart", "barber"]) {
      day2(["chef", "imp", "empath", "monk", "soldier"]);
      expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }).ok).toBe(true);
      expect(lastEvent().actualRoleAtEvent).toBe("chef");
      const g = patchPlayer(game(), "p0", { actualRole: role, shownRole: role });
      const q = proofQuery(g), me = bind(g, "p0");
      expect([klutzLearnedDeath(q, me), !!sweetheartOpenDayDeath(q, me), haircutsTonight(q, me)], role).toEqual([false, false, false]);
    }
  });
});
