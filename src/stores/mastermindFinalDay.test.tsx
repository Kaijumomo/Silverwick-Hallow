// SV-5n: the Mastermind's final day (https://wiki.bloodontheclocktower.com/Mastermind). "Tomorrow, if a good player is executed, declare
// that the game ends and evil wins, but if an evil player or no player is executed, declare that the game ends and good wins." Advisory
// lines on the End control and the End dialog, plus "Mastermind's final day" in the Day card heading (Q13 B). The result shows the moment
// the final day's execution is recorded; "nobody executed" waits for dusk (Q14 A). A Demon's death at night is a ruling (Q15 A).
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { impair, patchPlayer, proofEnv, proofGame, proofScript } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useShellStore } from "./shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import {
  isMastermindFinalDay, mastermindAdvisory, mastermindNightDeathLine, MASTERMIND_EVIL_EXECUTED_LINE, MASTERMIND_EXECUTION_RULING_LINE, MASTERMIND_FINAL_DAY_LINE,
  MASTERMIND_FINAL_DAY_RULING_LINE, MASTERMIND_GOOD_EXECUTED_LINE, MASTERMIND_NIGHT_DEATH_LINE, MASTERMIND_NOBODY_EXECUTED_LINE, MASTERMIND_TRIGGER_LINE,
  MASTERMIND_TRIGGER_RULING_LINE,
} from "./mastermindFinalDay";
import { demonGoneAdvisory } from "./endGameEligibility";
import { projectLobbyToPublic, projectLobbyToSelfEnvelopeMap } from "./projections";
import { endHint } from "@/features/grimoire-v6/vm/chrome";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { useV6Ctx, type V6Ctx } from "@/features/grimoire-v6/ctx";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { buildDayCard } from "@/features/grimoire-v6/day/dayCard";
import type { StorytellerLobbyRecord } from "./types";

const env = proofEnv();
const state = () => store.getState();
const game = () => state().game!;
// p0 Imp, p1 Mastermind, p2 Chef, p3 Empath, p4 Recluse, p5 Poisoner, p6 Monk.
const ROLES = ["imp", "mastermind", "chef", "empath", "recluse", "poisoner", "monk"];
const open = (g: StorytellerLobbyRecord) => store.setState({ game: g, lobby: null, undoStack: [], localSeq: 5, terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
const advance = () => { expect(state().advancePhase()).toMatchObject({ ok: true }); return game(); };
const execute = (id: string, outcome: "died" | "survived" | "alreadyDead" = "died") => { expect(state().recordExecution(id, outcome)).toMatchObject({ ok: true }); return game(); };
const ctx = (g: StorytellerLobbyRecord, privacy = false) => ({ game: g, script: env.script, registry: env.registry, privacy }) as unknown as V6Ctx;
const line = () => mastermindAdvisory(game(), env);
/** Day 2: the Imp executed and dead with a sober and healthy Mastermind; then advanced to the final Day (Day 3). */
function finalDay(g = proofGame(ROLES, "day", 2)) {
  open(g);
  execute("p0");
  advance();
  return advance();
}
const wrapper = ({ children }: { children: ReactNode }) => <VotingProvider>{children}</VotingProvider>;
const heading = (privacy = false) => {
  usePrivacyStore.getState().setEnabled(privacy);
  const m = renderHook(() => useV6Ctx(store((s) => s.game)!), { wrapper });
  return (buildDayCard({ ...m.result.current, cards: { ...m.result.current.cards, day: true } }) as { kicker: string }).kicker;
};

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset();
  useShellStore.getState().resetGameScope();
  useV6Ui.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});

describe("SV-5n: the lines through the final day", () => {
  it("the Day of the trigger and the Night after it: the game goes on (no winner named)", () => {
    open(proofGame(ROLES, "day", 2));
    execute("p0");
    expect(line()).toBe(MASTERMIND_TRIGGER_LINE);
    expect(endHint(ctx(game()))).toBe(MASTERMIND_TRIGGER_LINE);
    expect(isMastermindFinalDay(game())).toBe(false);
    advance();
    expect(line()).toBe(MASTERMIND_TRIGGER_LINE);
  });

  it("the final Day before any execution: the rule, and the Day card heading names it", () => {
    const g = finalDay();
    expect(g).toMatchObject({ phase: "day", day: 3 });
    expect(line()).toBe(MASTERMIND_FINAL_DAY_LINE);
    expect(endHint(ctx(g))).toBe(MASTERMIND_FINAL_DAY_LINE);
    expect(isMastermindFinalDay(g)).toBe(true);
    expect(heading()).toBe("Day III · Mastermind’s final day");
  });

  it.each(["died", "survived"] as const)("a good player executed (%s): evil wins, at once", (outcome) => {
    finalDay();
    execute("p2", outcome);
    expect(line()).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
    expect(endHint(ctx(game()))).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
    // Nothing ends by itself.
    expect(game().phase).toBe("day");
    expect(game().result).toBeUndefined();
    // Kept through the Night after the final Day.
    advance();
    expect(line()).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
  });

  it("a dead good player executed counts too (\"whether or not they die\")", () => {
    finalDay(patchPlayer(proofGame(ROLES, "day", 2), "p3", { alive: false }));
    execute("p3", "alreadyDead");
    expect(line()).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
  });

  it.each(["died", "survived"] as const)("an evil player executed (%s, the protected-Godfather example): good wins", (outcome) => {
    finalDay();
    execute("p5", outcome);
    expect(line()).toBe(MASTERMIND_EVIL_EXECUTED_LINE);
  });

  it("the Mastermind executed: good wins", () => {
    finalDay();
    execute("p1");
    expect(line()).toBe(MASTERMIND_EVIL_EXECUTED_LINE);
  });

  it("a Recluse, who may register as evil: the Storyteller's ruling; a drunk Recluse registers as good", () => {
    finalDay();
    execute("p4");
    expect(line()).toBe(MASTERMIND_EXECUTION_RULING_LINE);
    finalDay(impair(proofGame(ROLES, "day", 2), "p4", "drunk"));
    execute("p4");
    expect(line()).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
  });

  it("nobody executed: nothing until dusk, then good wins through that Night; gone the Day after", () => {
    finalDay();
    expect(line()).toBe(MASTERMIND_FINAL_DAY_LINE);
    const dusk = advance();
    expect(dusk).toMatchObject({ phase: "night", day: 4 });
    expect(line()).toBe(MASTERMIND_NOBODY_EXECUTED_LINE);
    advance();
    expect(line()).toBeNull();
    expect(game().gameRuleFacts.filter((fact) => fact.type.startsWith("mastermind"))).toEqual([]);
  });

  it("Undo of the final day's execution takes its line away; a reload keeps the line", () => {
    finalDay();
    execute("p2");
    expect(line()).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
    open(JSON.parse(JSON.stringify(game())) as StorytellerLobbyRecord);
    expect(line()).toBe(MASTERMIND_GOOD_EXECUTED_LINE);
    finalDay();
    execute("p2");
    state().undo();
    expect(line()).toBe(MASTERMIND_FINAL_DAY_LINE);
  });

  it("the old \"check\" line is replaced while the fact stands, and stays when the Mastermind does not work", () => {
    finalDay();
    expect(endHint(ctx(game()))).not.toContain("Check before ending");
    open(impair(proofGame(ROLES, "day", 2), "p1"));
    execute("p0");
    expect(line()).toBeNull();
    expect(endHint(ctx(game()))).toBe("The Demon is dead, but the Mastermind is alive. Check before ending the game");
  });

  it("the ruling fact: ruling lines throughout, and no heading", () => {
    open(impair(proofGame(ROLES, "day", 2), "p1", "soberHealthy"));
    execute("p0");
    expect(line()).toBe(MASTERMIND_TRIGGER_RULING_LINE);
    advance(); advance();
    expect(line()).toBe(MASTERMIND_FINAL_DAY_RULING_LINE);
    expect(isMastermindFinalDay(game())).toBe(false);
    expect(heading()).toBe("Day III");
    execute("p2");
    expect(line()).toBe("A good player was executed on the Mastermind’s final day. Evil wins. Your ruling");
  });
});

describe("SV-5n: Privacy Mode and what players see", () => {
  it("Privacy Mode hides the lines and the heading", () => {
    finalDay();
    expect(endHint(ctx(game(), true))).not.toContain("final day");
    expect(heading(true)).toBe("Day III");
  });

  it("the Public Display and the phones show nothing new: only the Demon's shroud", () => {
    finalDay();
    const text = JSON.stringify([projectLobbyToPublic(game(), {}, [], proofScript), projectLobbyToSelfEnvelopeMap(game(), env.registry)]);
    expect(text).not.toMatch(/mastermindFinalDay|final day/i);
  });
});

describe("SV-5n (Q15 A): a Demon's death at night", () => {
  it("with a Mastermind alive and no trigger: the Storyteller's ruling; no final day starts", () => {
    open(proofGame(ROLES, "night", 3));
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(mastermindNightDeathLine(game(), env)).toBe(MASTERMIND_NIGHT_DEATH_LINE);
    expect(endHint(ctx(game()))).toBe(MASTERMIND_NIGHT_DEATH_LINE);
    expect(game().gameRuleFacts).toEqual([]);
    // Still a ruling at the next Day (the Night's record is held), never a final day.
    advance();
    expect(endHint(ctx(game()))).toBe(MASTERMIND_NIGHT_DEATH_LINE);
    expect(isMastermindFinalDay(game())).toBe(false);
  });

  it("a Day death that is not an execution (the Slayer's shot): the old check line", () => {
    open(proofGame(ROLES, "day", 2));
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(mastermindNightDeathLine(game(), env)).toBeNull();
    expect(demonGoneAdvisory(game(), env)).toBe("The Demon is dead, but the Mastermind is alive. Check before ending the game");
  });
});
