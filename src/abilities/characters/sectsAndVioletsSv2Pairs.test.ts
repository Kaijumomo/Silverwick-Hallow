// SV-2 pair record (docs/ai/SECTS_AND_VIOLETS_SV2_PAIRS.md): the Snake Charmer and the Fang Gu against the rest of Sects & Violets.
// Production semantics, the real coordinator.
import { describe, expect, it } from "vitest";
import { SNAKE_CHARMER_TARGET } from "./snakecharmer";
import { FANG_GU_TARGET } from "./fanggu";
import { BARBER } from "./barber";
import { klutzLearnedDeath } from "./klutz";
import { nightTriggerStatus } from "@/abilities/invocation";
import { bind, pick, plan, planned, proofGame, proofQuery, request, requirementIds } from "@/test/proofFixtures";
import { FANG_GU_ONCE } from "@/stores/gameRuleFactRegistry";
import type { StorytellerLobbyRecord } from "@/stores/types";

const step = { withStep: true, completeStep: true } as const;
const charm = (g: StorytellerLobbyRecord, actor: string, target: string) => plan(g, request(g, actor, "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, target) }, step));
const attack = (g: StorytellerLobbyRecord, actor: string, target: string) => plan(g, request(g, actor, "fanggu", { [FANG_GU_TARGET]: pick(g, target) }, step));
const withOnce = (g: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...g, gameRuleFacts: [{ type: FANG_GU_ONCE, recordedAt: { phase: "night", day: 1 } } as never] });

describe("SV-2 pairs: the reviewed-list gate", () => {
  it("with the Philosopher, Evil Twin or Cerenovus in play, both steps are the Storyteller's (Manual)", () => {
    for (const other of ["philosopher", "eviltwin", "cerenovus"]) {
      const sc = proofGame(["snakecharmer", "imp", "clockmaker", "dreamer", other]);
      expect(charm(sc, "p0", "p1"), `snakecharmer + ${other}`).toMatchObject({ ok: false, code: "unsupported" });
      const fg = proofGame(["fanggu", "mutant", "clockmaker", "dreamer", other]);
      expect(attack(fg, "p0", "p2"), `fanggu + ${other}`).toMatchObject({ ok: false, code: "unsupported" });
    }
  });

  it("with any other character of the script in play, both steps are guided", () => {
    for (const other of ["clockmaker", "dreamer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "artist", "juggler",
      "sage", "mutant", "sweetheart", "barber", "klutz", "witch", "pithag"]) {
      const sc = proofGame(["snakecharmer", "imp", "chef", "monk", other]);
      expect(charm(sc, "p0", "p1"), `snakecharmer + ${other}`).toMatchObject({ ok: true, changed: true });
      const fg = proofGame(["fanggu", "chef", "empath", "monk", other]);
      expect(attack(fg, "p0", "p1"), `fanggu + ${other}`).toMatchObject({ ok: true, changed: true });
    }
  });

  it("the other Demons: the Snake Charmer swaps with whichever it chose; a Fang Gu with a second living Demon is the Storyteller's", () => {
    for (const demon of ["vortox", "nodashii", "vigormortis"]) {
      // The Demon sits away from the Snake Charmer, so a No Dashii's poison falls on the Chef and the Monk, not on the Snake Charmer.
      const sc = proofGame(["snakecharmer", "chef", demon, "monk", "empath"]);
      expect(planned(charm(sc, "p0", "p2")).players.p0!.actualRole, demon).toBe(demon);
      const fg = proofGame(["fanggu", demon, "chef", "monk", "empath"]);
      expect(attack(fg, "p0", "p2"), `fanggu + ${demon}`).toMatchObject({ ok: false, code: "unsupported" });
    }
  });
});

describe("SV-2 pairs: the No Dashii's poison", () => {
  it("a Snake Charmer who is the No Dashii's nearest Townsfolk is poisoned: choosing the No Dashii changes nothing", () => {
    const g = proofGame(["snakecharmer", "nodashii", "chef", "monk", "empath"]);
    const result = charm(g, "p0", "p1");
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.changed) expect(result.plan.game.players).toEqual(g.players);
  });
});

describe("SV-2 pairs: the Fang Gu and the SV-1 Outsiders", () => {
  it("Klutz: becoming the Fang Gu is not a death, so no choice; killed after ONCE, the Klutz learns they died", () => {
    const g = proofGame(["fanggu", "klutz", "chef", "monk", "empath"]);
    const jumped = planned(attack(g, "p0", "p1"));
    expect(jumped.players.p1!.actualRole).toBe("fanggu");
    const day = { ...jumped, phase: "day" as const };
    expect(klutzLearnedDeath(proofQuery(day), bind(day, "p1"))).toBe(false);
    const later = planned(attack(withOnce(g), "p0", "p1"));
    expect(later.players.p1).toMatchObject({ alive: false, actualRole: "klutz" });
    const laterDay = { ...later, phase: "day" as const };
    expect(klutzLearnedDeath(proofQuery(laterDay), bind(laterDay, "p1"))).toBe(true);
  });

  it("Barber: becoming the Fang Gu is not a death, so no swap; killed after ONCE, the Barber's step opens", () => {
    const g = proofGame(["fanggu", "barber", "chef", "monk", "empath"]);
    const jumped = planned(attack(g, "p0", "p1"));
    expect(nightTriggerStatus(BARBER, bind(jumped, "p1"), proofQuery(jumped)).kind).toBe("notTriggered");
    const later = planned(attack(withOnce(g), "p0", "p1"));
    expect(nightTriggerStatus(BARBER, bind(later, "p1"), proofQuery(later)).kind).toBe("triggered");
  });

  it("Mutant: an Outsider like any other -- the first one the Fang Gu kills becomes the Fang Gu", () => {
    const g = proofGame(["fanggu", "mutant", "chef", "monk", "empath"]);
    expect(planned(attack(g, "p0", "p1")).players.p1).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
  });
});

describe("SV-2 pairs: the Snake Charmer and the Minions", () => {
  it("Witch, Pit-Hag: a Minion chosen is not the Demon, so nothing happens", () => {
    for (const minion of ["witch", "pithag"]) {
      const g = proofGame(["snakecharmer", "imp", "chef", minion, "empath"]);
      expect(planned(charm(g, "p0", "p3")).players, minion).toEqual(g.players);
    }
  });

  it("Vigormortis: the swapped-out Vigormortis loses its ability, so its kept-ability Minion and poison end", () => {
    const g0 = proofGame(["snakecharmer", "vigormortis", "witch", "chef", "empath", "monk"]);
    // Night 2: the Vigormortis kills the Witch (a Minion keeps its ability; the Chef, its Townsfolk neighbour, is poisoned).
    const kill = { target: pick(g0, "p2") };
    const [neighbour] = requirementIds(plan(g0, request(g0, "p1", "vigormortis", kill)));
    const g = planned(plan(g0, request(g0, "p1", "vigormortis", { ...kill, [neighbour!]: pick(g0, "p3") })));
    expect(proofQuery(g).abilityFunctions(bind(g, "p3"))).toEqual({ known: true, value: false });
    const next = planned(charm(g, "p0", "p1"));
    expect(next.players.p0!.actualRole).toBe("vigormortis");
    expect(proofQuery(next).abilityFunctions(bind(next, "p3"))).toEqual({ known: true, value: true });
  });
});
