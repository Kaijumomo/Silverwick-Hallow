// @vitest-environment node
// LS-2c: the Devil's Advocate. https://wiki.bloodontheclocktower.com/Devil%27s_Advocate
// "Each night, choose a living player (different to last night): if executed tomorrow, they don't die." "cannot choose the same player two
// nights in a row, whether or not that player was saved from execution today". "Mark the chosen player with the SURVIVES EXECUTION
// reminder." "declare that the player was executed but remains alive. (Do not say why.)"
import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { executionAdvice } from "@/stores/executionAdvice";
import { planVoting } from "@/stores/voting";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import { effectExpiresAt } from "@/stores/effectResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { DEVILS_ADVOCATE_CHOICE, SURVIVES_EXECUTION } from "./devilsadvocate";

const environment = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
// p0 devil's advocate, p1 imp, p2 chef, p3 empath, p4 fool, p5 monk
const ROLES = ["devilsadvocate", "imp", "chef", "empath", "fool", "monk"];
const choose = (g: StorytellerLobbyRecord, id: string) => plan(g, request(g, "p0", "devilsadvocate", { target: pick(g, id) }));
const effects = (g: StorytellerLobbyRecord, id: string, type: string) => g.players[id]!.effects.filter((e) => e.type === type && e.state === "active");
/** The game moved to another moment, with the Effects that expire there removed exactly as the phase change removes them. */
const advance = (g: StorytellerLobbyRecord, phase: "day" | "night", n: number): StorytellerLobbyRecord => ({ ...g, phase, day: n,
  players: Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, { ...p, effects: p.effects.filter((e) => !effectExpiresAt(e, { phase, day: n })) }])) });
const day = (g: StorytellerLobbyRecord, n = g.day) => advance(g, "day", n);
const night = (g: StorytellerLobbyRecord, n: number) => advance(g, "night", n);
const advice = (g: StorytellerLobbyRecord, id: string) => executionAdvice(g, id, environment);
const SAVED = { known: true, value: { kind: "survives", spends: false } };
const DIES = { known: true, value: { kind: "dies" } };

describe("Devil's Advocate: a functioning one", () => {
  it("marks the chosen player SURVIVES EXECUTION until dusk and remembers the choice", () => {
    const next = planned(choose(proofGame(ROLES, "night", 2), "p2"));
    expect(effects(next, "p2", SURVIVES_EXECUTION)).toEqual([expect.objectContaining({ sourceCharacter: "devilsadvocate", lifetime: { kind: "throughFollowingDay" },
      expiry: { kind: "at", moment: { phase: "night", day: 3 } } })]);
    expect(effects(next, "p2", DEVILS_ADVOCATE_CHOICE)).toHaveLength(1);
    expect(effects(next, "p2", DEVILS_ADVOCATE_CHOICE)[0]!.sourceParticipant).toBeUndefined();
  });

  it("protects from an execution only, and the execution prompt advises it with its existing words", () => {
    const g = day(planned(choose(proofGame(ROLES, "night", 2), "p2")));
    expect(proofQuery(g).deathOutcome(bind(g, "p2"), "execution")).toEqual(SAVED);
    expect(proofQuery(g).deathOutcome(bind(g, "p2"), "demon")).toEqual(DIES);
    expect(proofQuery(g).deathOutcome(bind(g, "p2"), "any")).toEqual(DIES);
    expect(advice(g, "p2")).toEqual({ kind: "survives", spends: false, note: "Player 2 is protected from this death: they survive the execution." });
    expect(advice(g, "p3")).toBeNull();
  });

  it("may choose themself, and works on the first night", () => {
    const g = proofGame(ROLES, "night", 1);
    const next = planned(choose(g, "p0"));
    expect(proofQuery(day(next, 1)).deathOutcome(bind(next, "p0"), "execution")).toEqual(SAVED);
  });

  it("the protection ends when the Devil's Advocate dies or changes character", () => {
    const g = day(planned(choose(proofGame(ROLES, "night", 2), "p2")));
    expect(proofQuery(patchPlayer(g, "p0", { alive: false })).deathOutcome(bind(g, "p2"), "execution")).toEqual(DIES);
    expect(proofQuery(patchPlayer(g, "p0", { actualRole: "baron" })).deathOutcome(bind(g, "p2"), "execution")).toEqual(DIES);
    expect(proofQuery(impair(g, "p0")).deathOutcome(bind(g, "p2"), "execution")).toEqual(DIES);
  });

  it("an executed Fool it protects survives and spends nothing", () => {
    const g = day(planned(choose(proofGame(ROLES, "night", 2), "p4")));
    expect(proofQuery(g).deathOutcome(bind(g, "p4"), "execution")).toEqual(SAVED);
    expect(advice(g, "p4")).toMatchObject({ kind: "survives", spends: false });
    const next = planVoting(g, { code: g.code, day: g.day, expectedRevision: 0, kind: "execution", target: bind(g, "p4"), outcome: "survived" }, environment);
    expect(next.ok && next.game.players.p4).toMatchObject({ alive: true, abilityUsed: false });
  });
});

describe("Devil's Advocate: choosing", () => {
  it("the protection ends at dusk (the next Night)", () => {
    const first = planned(choose(proofGame(ROLES, "night", 2), "p2"));
    expect(effects(day(first), "p2", SURVIVES_EXECUTION)).toHaveLength(1);
    expect(effects(night(day(first), 3), "p2", SURVIVES_EXECUTION)).toEqual([]);
    expect(effects(night(day(first), 3), "p2", DEVILS_ADVOCATE_CHOICE)).toHaveLength(1);
  });

  it("cannot choose last night's player; a different player is fine; the night after, the first is allowed again", () => {
    const first = planned(choose(proofGame(ROLES, "night", 2), "p2"));
    const second = night(day(first), 3);
    expect(choose(second, "p2")).toMatchObject({ ok: false, code: "illegal", message: "Player 2 was chosen last night. Choose a different player." });
    const third = planned(choose(second, "p3"));
    expect(effects(third, "p3", SURVIVES_EXECUTION)).toHaveLength(1);
    expect(planned(choose(night(day(third, 3), 4), "p2")).players.p2!.effects.some((e) => e.type === SURVIVES_EXECUTION && e.state === "active")).toBe(true);
  });

  it("only last night's choice is kept: older ones are tidied up by a functioning Devil's Advocate", () => {
    let g = planned(choose(proofGame(ROLES, "night", 2), "p2"));
    g = planned(choose(night(day(g), 3), "p3"));
    g = planned(choose(night(day(g, 3), 4), "p5"));
    const choices = ["p2", "p3", "p5"].map((id) => effects(g, id, DEVILS_ADVOCATE_CHOICE).length);
    expect(choices).toEqual([0, 1, 1]);
  });

  it("cannot choose a dead player", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p2", { alive: false });
    expect(choose(g, "p2")).toMatchObject({ ok: false, code: "illegal" });
  });

  it.each(["poisoned", "drunk"])("a %s Devil's Advocate chooses but protects nobody, and still cannot repeat the pick the next night", (type) => {
    const g = impair(proofGame(ROLES, "night", 2), "p0", type);
    const next = planned(choose(g, "p2"));
    expect(effects(next, "p2", SURVIVES_EXECUTION)).toEqual([]);
    expect(effects(next, "p2", DEVILS_ADVOCATE_CHOICE)).toHaveLength(1);
    expect(proofQuery(day(next)).deathOutcome(bind(next, "p2"), "execution")).toEqual(DIES);
    const sober = patchPlayer(night(day(next), 3), "p0", { effects: [] });
    expect(choose(sober, "p2")).toMatchObject({ ok: false, code: "illegal" });
  });

  it("is drawn with its official SURVIVES EXECUTION token; the remembered choice draws nothing", () => {
    const next = planned(choose(proofGame(ROLES, "night", 2), "p2"));
    const shown = officialEffectPresentation(next.players.p2!, { query: proofQuery(next), target: bind(next, "p2") });
    expect(shown.tokens.map((t) => [t.role.id, t.label])).toEqual([["devilsadvocate", "Survives Execution"]]);
  });
});
