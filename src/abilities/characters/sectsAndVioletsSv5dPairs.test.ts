// SV-5 part 4 (the Mastermind): the pairs of docs/ai/SECTS_AND_VIOLETS_SV5D_PAIRS.md that the focused Mastermind tests
// (src/stores/mastermindTrigger.test.ts, src/stores/mastermindFinalDay.test.tsx) do not name.
import { beforeEach, describe, expect, it } from "vitest";
import { patchPlayer, proofEnv, proofGame, proofScript } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { mastermindAdvisory, MASTERMIND_EVIL_EXECUTED_LINE, MASTERMIND_FINAL_DAY_LINE, MASTERMIND_GOOD_EXECUTED_LINE, MASTERMIND_NIGHT_DEATH_LINE, MASTERMIND_NOBODY_EXECUTED_LINE, mastermindNightDeathLine } from "@/stores/mastermindFinalDay";
import { MASTERMIND_FINAL_DAY } from "@/stores/gameRuleFactRegistry";
import { twinAdvisory, klutzAdvisory } from "@/stores/endGameEligibility";
import { goodTwinIntents } from "@/stores/twinPair";
import { applyEffectPlan, planEffectTransaction } from "@/stores/effectResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";

const env = proofEnv();
const state = () => store.getState();
const game = () => state().game!;
const facts = () => game().gameRuleFacts.filter((fact) => fact.type.startsWith("mastermind"));
const open = (g: StorytellerLobbyRecord) => store.setState({ game: g, lobby: null, undoStack: [], localSeq: 5, terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
const advance = () => { expect(state().advancePhase()).toMatchObject({ ok: true }); return game(); };
const execute = (id: string, outcome: "died" | "survived" = "died") => expect(state().recordExecution(id, outcome)).toMatchObject({ ok: true });
/** The Demon (p0) executed on Day 2, then on to the final Day 3, with `between` applied during Night 3. */
function toFinalDay(roles: string[], between: (g: StorytellerLobbyRecord) => StorytellerLobbyRecord = (g) => g) {
  open(proofGame(roles, "day", 2));
  execute("p0");
  expect(facts().map((fact) => fact.type)).toEqual([MASTERMIND_FINAL_DAY]);
  open(between(advance()));
  return advance();
}
function twinned(g: StorytellerLobbyRecord, evil: string, good: string): StorytellerLobbyRecord {
  const built = goodTwinIntents(g, { playerId: evil, participantId: g.players[evil]!.participantId! }, { playerId: good, participantId: g.players[good]!.participantId! });
  if (!built.ok) throw new Error(built.message);
  const result = planEffectTransaction(g, { intents: built.intents }, { historyId: () => `h-${good}`, effectId: () => `fx-${good}` });
  if (!result.ok || !result.changed) throw new Error("not a changing plan");
  return applyEffectPlan(g, result.plan);
}

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null }));

describe("SV-5d pairs: the Mastermind with the Sects & Violets characters", () => {
  it("Pit-Hag: a new Demon made on the Night before the final Day and executed on it is an evil player executed (good wins); no second trigger", () => {
    toFinalDay(["vortox", "mastermind", "pithag", "chef", "empath", "oracle"], (g) => patchPlayer(g, "p3", { actualRole: "nodashii", actualAlignment: "evil" }));
    execute("p3");
    expect(facts()).toHaveLength(1);
    expect(mastermindAdvisory(game(), env)).toBe(MASTERMIND_EVIL_EXECUTED_LINE);
  });

  it("Barber / Snake Charmer: whoever is the Demon at the execution counts; the Mastermind is whoever holds it then", () => {
    // After a swap the old Mastermind seat (p0) holds the Demon, and p1 holds the Mastermind.
    open(patchPlayer(patchPlayer(proofGame(["mastermind", "fanggu", "barber", "chef", "empath"], "day", 2), "p0", { actualRole: "fanggu" }), "p1", { actualRole: "mastermind" }));
    execute("p0");
    expect(facts()).toEqual([expect.objectContaining({ provenance: expect.objectContaining({ sourceParticipant: expect.objectContaining({ playerId: "p1" }) }) })]);
  });

  it("Witch: a cursed player dying on nominating is not an execution; nobody executed by dusk means good wins", () => {
    toFinalDay(["nodashii", "mastermind", "witch", "chef", "empath", "oracle"]);
    expect(state().recordDeath("p3")).toMatchObject({ ok: true });
    expect(mastermindAdvisory(game(), env)).toBe(MASTERMIND_FINAL_DAY_LINE);
    advance();
    expect(mastermindAdvisory(game(), env)).toBe(MASTERMIND_NOBODY_EXECUTED_LINE);
  });

  it("Mutant: executed on the final Day (good): evil wins; a Mutant executed at night is a death, not a trigger", () => {
    toFinalDay(["vigormortis", "mastermind", "mutant", "chef", "empath", "oracle"]);
    execute("p2");
    expect(mastermindAdvisory(game(), env)).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
    open(proofGame(["mutant", "mastermind", "chef", "empath", "vortox"], "night", 3));
    expect(state().recordDeath("p4")).toMatchObject({ ok: true });
    expect(facts()).toEqual([]);
    expect(mastermindNightDeathLine(game(), env)).toBe(MASTERMIND_NIGHT_DEATH_LINE);
  });

  it("Fang Gu: the jump is a night death of the old Fang Gu, never a trigger", () => {
    open(proofGame(["fanggu", "mastermind", "mutant", "chef", "empath"], "night", 3));
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(facts()).toEqual([]);
  });

  it("Evil Twin: both Twins alive and working, the Demon's execution does not end the game (no trigger); no Good Twin chosen yet is a ruling", () => {
    open(twinned(proofGame(["vortox", "mastermind", "eviltwin", "chef", "empath", "oracle"], "day", 2), "p2", "p3"));
    execute("p0");
    expect(facts()).toEqual([]);
    open(proofGame(["vortox", "mastermind", "eviltwin", "chef", "empath", "oracle"], "day", 2));
    execute("p0");
    expect(facts().map((fact) => fact.type)).toEqual(["mastermindFinalDayRuling"]);
    expect(twinAdvisory(game(), env)).toBeNull();
  });

  it("Klutz: a choice on the final Day and an execution each keep their own line", () => {
    toFinalDay(["nodashii", "mastermind", "klutz", "chef", "empath", "oracle"]);
    const day = game();
    open({ ...day, gameRuleFacts: [...day.gameRuleFacts, { type: "klutzGoodTeamLost", recordedAt: { phase: "day", day: 3 } }] });
    expect(klutzAdvisory(game())).toContain("Evil wins");
    expect(mastermindAdvisory(game(), env)).toBe(MASTERMIND_FINAL_DAY_LINE);
  });
});
