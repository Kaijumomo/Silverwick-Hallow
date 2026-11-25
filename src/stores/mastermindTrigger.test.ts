// SV-5m: the Mastermind's trigger (https://wiki.bloodontheclocktower.com/Mastermind). "If the Demon dies by execution (ending the game),
// play for 1 more day." A captured fact, tied to the execution that caused it: recorded only inside the accepted execution of the last
// living Demon, and taken away by Undo, a retraction or an amendment of that execution. Nothing ends the game and nothing is announced.
import { beforeEach, describe, expect, it } from "vitest";
import { homebrewEnv, impair, openInStore, patchPlayer, proofEnv, proofGame } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { captureMastermindFinalDay, reconcileMastermindFinalDay } from "./mastermindFinalDay";
import { planRecordedLifeOutcome } from "./deathResolution";
import { goodTwinIntents } from "./twinPair";
import { applyEffectPlan, planEffectTransaction } from "./effectResolution";
import { GAME_RULE_FACT_REGISTRY, MASTERMIND_FINAL_DAY, MASTERMIND_FINAL_DAY_RULING } from "./gameRuleFactRegistry";
import { planGameRuleFactTransaction } from "./gameRuleFacts";
import { StorytellerGamePersistedSchema } from "./schemas";
import type { StorytellerLobbyRecord } from "./types";

const env = proofEnv();
const state = () => store.getState();
const game = () => state().game!;
// The Mastermind's facts only (a Trouble Brewing-only table can also record the verified Demon-death evidence).
const facts = () => game().gameRuleFacts.map((fact) => fact.type).filter((type) => type.startsWith("mastermind"));
// p0 Imp, p1 Mastermind, p2 Chef, p3 Empath, p4 Saint, p5 Monk.
const ROLES = ["imp", "mastermind", "chef", "empath", "saint", "monk"];
const day = (roles = ROLES) => proofGame(roles, "day", 2);
const advance = () => { expect(state().advancePhase()).toMatchObject({ ok: true }); return game(); };
const execute = (id: string, outcome: "died" | "survived" | "alreadyDead" = "died") => { expect(state().recordExecution(id, outcome)).toMatchObject({ ok: true }); return game(); };
const dead = (g: StorytellerLobbyRecord, ...ids: string[]) => ids.reduce((acc, id) => patchPlayer(acc, id, { alive: false }), g);
function twinned(g: StorytellerLobbyRecord, evil: string, good: string): StorytellerLobbyRecord {
  const built = goodTwinIntents(g, { playerId: evil, participantId: g.players[evil]!.participantId! }, { playerId: good, participantId: g.players[good]!.participantId! });
  if (!built.ok) throw new Error(built.message);
  const result = planEffectTransaction(g, { intents: built.intents }, { historyId: () => `h-${good}`, effectId: () => `fx-${good}` });
  if (!result.ok || !result.changed) throw new Error("not a changing plan");
  return applyEffectPlan(g, result.plan);
}
const retains = (g: StorytellerLobbyRecord, id: string): StorytellerLobbyRecord => patchPlayer(g, id, { effects: [...g.players[id]!.effects, { id: "fx-keeps", type: "retainsAbility", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 } } as never] });

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});

describe("SV-5m: the trigger", () => {
  it("the only Demon executed and dead, a sober and healthy Mastermind alive: the fact names the Mastermind, the execution and the Day", () => {
    openInStore(day());
    const after = execute("p0");
    const execution = after.lifeEventWindow.events.find((event) => event.kind === "execution")!;
    expect(after.gameRuleFacts).toEqual([expect.objectContaining({ type: MASTERMIND_FINAL_DAY, recordedAt: { phase: "day", day: 2 }, expiresAt: { phase: "day", day: 4 },
      resolutionId: execution.id, provenance: expect.objectContaining({ sourceCharacter: "mastermind", sourceParticipant: expect.objectContaining({ playerId: "p1" }) }) })]);
    // The game goes on: no winner, nothing ended. The Demon gets the shroud as for any death.
    expect(after.phase).toBe("day");
    expect(after.result).toBeUndefined();
    expect(after.players.p0!.alive).toBe(false);
    expect(StorytellerGamePersistedSchema.safeParse(after).success).toBe(true);
  });

  it("is capture-only: nothing records it by hand", () => {
    openInStore(day());
    const result = planGameRuleFactTransaction(game(), { intents: [{ kind: "apply", type: MASTERMIND_FINAL_DAY }] });
    expect(result).toMatchObject({ ok: false });
    expect(GAME_RULE_FACT_REGISTRY.get(MASTERMIND_FINAL_DAY)).toMatchObject({ captureOnly: true, applicablePhases: ["day"], expiry: "finalDay" });
    expect(GAME_RULE_FACT_REGISTRY.get(MASTERMIND_FINAL_DAY_RULING)).toMatchObject({ captureOnly: true, applicablePhases: ["day"], expiry: "finalDay" });
  });

  it.each(["survived", "alreadyDead"] as const)("a Demon whose execution %s: nothing triggers", (outcome) => {
    openInStore(outcome === "alreadyDead" ? dead(day(), "p0") : day());
    execute("p0", outcome);
    expect(facts()).toEqual([]);
  });

  it("a Demon killed by a Day death that is not an execution (the Slayer's shot): nothing triggers", () => {
    openInStore(day());
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(facts()).toEqual([]);
  });

  it("a Demon dying at night: nothing triggers (the line is the Storyteller's ruling, SV-5n)", () => {
    openInStore(proofGame(ROLES, "night", 3));
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(facts()).toEqual([]);
  });

  it("a non-Demon executed: nothing triggers", () => {
    openInStore(day());
    execute("p2");
    expect(facts()).toEqual([]);
  });

  it.each(["fanggu", "nodashii", "vigormortis", "vortox", "shabaloth", "po", "pukka"])("any Demon type triggers it (%s)", (demon) => {
    openInStore(day([demon, ...ROLES.slice(1)]));
    execute("p0");
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
  });

  it("two players left alive after the Demon dies: still a trigger (\"play for 1 more day\")", () => {
    openInStore(dead(day(), "p3", "p4", "p5"));
    execute("p0");
    expect(game().players.p0!.alive).toBe(false);
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
  });

  it.each([
    ["drunk", (g: StorytellerLobbyRecord) => impair(g, "p1", "drunk")],
    ["poisoned", (g: StorytellerLobbyRecord) => impair(g, "p1")],
    ["dead", (g: StorytellerLobbyRecord) => dead(g, "p1")],
    ["not in play", () => day(["imp", "poisoner", "chef", "empath", "saint", "monk"])],
  ])("a %s Mastermind: nothing triggers (the game ends normally)", (_name, change) => {
    openInStore(change(day()));
    execute("p0");
    expect(facts()).toEqual([]);
  });

  it("a Mastermind made sober by the Poisoner's expiry at dawn works again from then on", () => {
    const poisoned = impair(proofGame(ROLES, "night", 2), "p1");
    const effect = poisoned.players.p1!.effects[0]!;
    openInStore(patchPlayer(poisoned, "p1", { effects: [{ ...effect, expiry: { kind: "at", moment: { phase: "day", day: 2 } } } as never] }));
    const dawn = advance();
    expect(dawn).toMatchObject({ phase: "day", day: 2 });
    expect(dawn.players.p1!.effects).toEqual([]);
    execute("p0");
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
  });

  it("a Mastermind whose ability is in doubt: the ruling fact", () => {
    openInStore(impair(day(), "p1", "soberHealthy"));
    execute("p0");
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY_RULING]);
  });

  it("a second living Demon: the game would not end, nothing triggers", () => {
    openInStore(day(["imp", "mastermind", "chef", "empath", "nodashii", "monk"]));
    execute("p0");
    expect(facts()).toEqual([]);
  });

  describe("the Scarlet Woman", () => {
    it("five or more alive with a sober and healthy Scarlet Woman: she becomes the Demon, nothing triggers", () => {
      openInStore(day(["imp", "mastermind", "scarletwoman", "empath", "saint", "monk"]));
      execute("p0");
      expect(facts()).toEqual([]);
    });
    it("four alive: she does not become the Demon, it triggers", () => {
      openInStore(dead(day(["imp", "mastermind", "scarletwoman", "empath", "saint", "monk"]), "p4", "p5"));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
    });
    it("five or more alive but she is poisoned: it triggers", () => {
      openInStore(impair(day(["imp", "mastermind", "scarletwoman", "empath", "saint", "monk"]), "p2"));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
    });
    it("five or more alive and her ability is in doubt: the ruling fact", () => {
      openInStore(impair(day(["imp", "mastermind", "scarletwoman", "empath", "saint", "monk"]), "p2", "soberHealthy"));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY_RULING]);
    });
  });

  describe("the Evil Twin", () => {
    const base = () => twinned(day(["imp", "mastermind", "eviltwin", "chef", "saint", "monk"]), "p2", "p3");
    it("both Twins alive and the Evil Twin working: good cannot win, so the game would not end and nothing triggers", () => {
      openInStore(base());
      execute("p0");
      expect(facts()).toEqual([]);
    });
    it("the Good Twin dead: it triggers", () => {
      openInStore(dead(base(), "p3"));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
    });
    it("the Evil Twin's ability in doubt: the ruling fact", () => {
      openInStore(impair(base(), "p2", "soberHealthy"));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY_RULING]);
    });
  });

  describe("the jinxes and the Zombuul are the Storyteller's ruling", () => {
    it.each(["alhadikhia", "lleech"])("%s executed and dead", (demon) => {
      openInStore(day([demon, ...ROLES.slice(1)]));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY_RULING]);
    });
    // BM-2a: the Zombuul's first execution is not a death of the Demon (he registers as dead but lives on), so nothing triggers;
    // his second (real) death is the Storyteller's ruling, as before.
    it("zombuul: the first execution triggers nothing; the second, real death is the ruling", () => {
      openInStore(day(["zombuul", ...ROLES.slice(1)]));
      const first = execute("p0");
      expect(facts()).toEqual([]);
      expect(first.players.p0!.alive).toBe(false);
      expect(first.players.p0!.effects.map((effect) => effect.type)).toEqual(["livesOn"]);
      advance(); advance();
      expect(game()).toMatchObject({ phase: "day", day: 3 });
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY_RULING]);
      expect(game().players.p0!.effects.filter((effect) => effect.state === "active")).toEqual([]);
    });
    it("an Alchemist in play", () => {
      openInStore(day(["imp", "mastermind", "alchemist", "empath", "saint", "monk"]));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY_RULING]);
    });
    it("the Vigormortis executed while a dead Mastermind keeps its ability", () => {
      openInStore(retains(dead(day(["vigormortis", ...ROLES.slice(1)]), "p1"), "p1"));
      execute("p0");
      expect(facts()).toEqual([MASTERMIND_FINAL_DAY_RULING]);
    });
  });

  it("a homebrew character reusing the Mastermind id brings no rule", () => {
    const g = day();
    const henv = homebrewEnv("mastermind");
    const result = planRecordedLifeOutcome(g, { intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }, henv);
    expect(result.ok && result.game.gameRuleFacts).toEqual([]);
  });

  it("the raw Life command's execution captures it too", () => {
    openInStore(day());
    expect(state().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] })).toMatchObject({ ok: true });
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
  });

  it("a Demon's execution recorded late, through the correction path, never triggers", () => {
    openInStore(dead(proofGame(ROLES, "night", 3), "p0"));
    const g = game();
    expect(captureMastermindFinalDay(g, { ...g }, "nope", env)).toEqual({ ok: true, game: g });
    const late = state().lateRecordLifeEvent({ kind: "execution", playerId: "p0", outcome: "died", moment: { phase: "day", day: 2 } } as never, [] as never);
    expect(late).toMatchObject({ ok: true });
    expect(game().lifeEventWindow.events.some((event) => event.kind === "execution")).toBe(true);
    expect(facts()).toEqual([]);
  });
});

describe("SV-5m: tied to its execution", () => {
  it("Undo of the Demon's execution takes the fact away", () => {
    openInStore(day());
    execute("p0");
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
    state().undo();
    expect(facts()).toEqual([]);
    expect(game().players.p0!.alive).toBe(true);
  });

  it("retracting the execution takes the fact away, with a correction record", () => {
    openInStore(day());
    const after = execute("p0");
    const id = after.lifeEventWindow.events.find((event) => event.kind === "execution")!.id;
    expect(state().retractLifeEvent(id, [{ playerId: "p0", target: { alive: true } }] as never)).toMatchObject({ ok: true });
    expect(facts()).toEqual([]);
    expect(game().history.at(-1)).toMatchObject({ category: "gameRuleFact", ruleFactOperation: "remove", ruleFactType: MASTERMIND_FINAL_DAY, correction: true });
  });

  it("amending the execution to \"survived\" takes the fact away", () => {
    openInStore(day());
    const after = execute("p0");
    const event = after.lifeEventWindow.events.find((event) => event.kind === "execution")!;
    const result = state().amendLifeEvent(event.id, { kind: "execution", playerId: "p0", outcome: "survived" } as never, [{ playerId: "p0", target: { alive: true } }] as never);
    expect(result).toMatchObject({ ok: true });
    expect(facts()).toEqual([]);
  });

  it("the reconcile keeps the fact once the execution's record has rolled away (the trigger stands)", () => {
    openInStore(day());
    execute("p0");
    advance(); // Night 3: Day 2 is still held.
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
    const final = advance(); // Day 3: the final day; Day 2's record is gone.
    expect(final.lifeEventWindow.events.some((event) => event.moment.day === 2 && event.moment.phase === "day")).toBe(false);
    expect(reconcileMastermindFinalDay(final)).toEqual({ ok: true, game: final });
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
  });

  it("the Mastermind dying, becoming drunk or poisoned later does not cancel the final day", () => {
    openInStore(day());
    execute("p1"); // not this: the Mastermind's execution is an ordinary one
    expect(facts()).toEqual([]);
    openInStore(day());
    execute("p0");
    advance();
    openInStore(impair(dead(game(), "p1"), "p1"));
    expect(state().recordDeath("p2")).toMatchObject({ ok: true });
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
  });

  it("lasts through the Night after the final Day and expires entering the Day after it; a reload keeps it", () => {
    openInStore(day());
    execute("p0");
    advance(); advance(); advance();
    expect(game()).toMatchObject({ phase: "night", day: 4 });
    expect(facts()).toEqual([MASTERMIND_FINAL_DAY]);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    const reloaded = JSON.parse(JSON.stringify(game())) as StorytellerLobbyRecord;
    expect(StorytellerGamePersistedSchema.parse(reloaded).gameRuleFacts).toEqual(game().gameRuleFacts);
    advance();
    expect(game()).toMatchObject({ phase: "day", day: 4 });
    expect(facts()).toEqual([]);
  });

  it("a stored fact whose lifetime is not exactly two Days is rejected on load", () => {
    openInStore(day());
    execute("p0");
    const g = game();
    const bad = { ...g, gameRuleFacts: g.gameRuleFacts.map((fact) => ({ ...fact, expiresAt: { phase: "day" as const, day: 3 } })) };
    expect(StorytellerGamePersistedSchema.safeParse(bad).success).toBe(false);
  });
});
