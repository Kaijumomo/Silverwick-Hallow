// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request, yes } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { choiceId } from "@/abilities/characters/alhadikhia";
import { CONSENT, DEATH_CONSEQUENCE } from "@/abilities/characters/harlot";
import { subjectId } from "@/abilities/characters/shared";
import { DRUNK_ONE } from "@/abilities/characters/innkeeper";
import { executionAdvice } from "@/stores/executionAdvice";
import { planVoting } from "@/stores/voting";
import { applyLifePlan, planLifeTransaction } from "@/stores/lifeResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";

// LS-1 (life rules): the shared death gate for the Fool and the Sailor.
// Fool:   https://wiki.bloodontheclocktower.com/Fool    -- "The first time the Fool dies for any reason, the Fool remains alive."
//         "If another character's ability protects the Fool from death, the Fool does not use their ability."
//         "(But they die if they are drunk or poisoned.)" then the Fool is marked NO ABILITY.
// Sailor: https://wiki.bloodontheclocktower.com/Sailor -- "While sober, the Sailor cannot die".
// Monk:   https://wiki.bloodontheclocktower.com/Monk   -- SAFE from the Demon tonight.
const environment = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
// p0 imp, p1 the character under test, p2 monk, p3 chef
const roles = (role: string) => ["imp", role, "monk", "chef"];
const attack = (game: StorytellerLobbyRecord) => plan(game, request(game, "p0", "imp", { target: pick(game, "p1") }));
const scope = (game: StorytellerLobbyRecord) => ({ code: game.code, day: game.day, expectedRevision: 0 });
const dayGame = (role: string) => proofGame(roles(role), "day", 2);

describe("Fool: survives its first death at a cost", () => {
  it("the Imp's attack on a functioning Fool leaves it alive and spends the ability", () => {
    const game = proofGame(roles("fool"));
    const next = planned(attack(game));
    expect(next.players.p1!.alive).toBe(true);
    expect(next.players.p1!.abilityUsed).toBe(true);
    expect(next.lifeEventWindow.events).toEqual([]); // nobody died
  });

  it("a Fool that already used its ability dies", () => {
    const game = patchPlayer(proofGame(roles("fool")), "p1", { abilityUsed: true });
    expect(planned(attack(game)).players.p1!.alive).toBe(false);
  });

  it.each(["poisoned", "drunk"])("a %s Fool dies for real and keeps its unused marker", type => {
    const game = impair(proofGame(roles("fool")), "p1", type);
    const next = planned(attack(game));
    expect(next.players.p1!.alive).toBe(false);
    expect(next.players.p1!.abilityUsed).toBe(false);
  });

  it("another character's protection comes first and spends nothing", () => {
    const base = proofGame(roles("fool"));
    const monk = planned(plan(base, request(base, "p2", "monk", { target: pick(base, "p1") })));
    expect(proofQuery(monk).deathOutcome(bind(monk, "p1"), "demon")).toEqual({ known: true, value: { kind: "survives", spends: false } });
    // The Imp's attack changes nothing at all: the Fool keeps its ability.
    expect(attack(monk)).toEqual({ ok: true, changed: false });
    expect(monk.players.p1!.abilityUsed).toBe(false);
  });

  it("an unknown sobriety stays a Storyteller question, never a guess", () => {
    const game = impair(proofGame(roles("fool")), "p1", "soberHealthy");
    expect(proofQuery(game).deathOutcome(bind(game, "p1"), "demon")).toMatchObject({ known: false });
  });

  it("direct protection questions that cannot spend the ability still go to the Storyteller", () => {
    const game = proofGame(roles("fool"));
    expect(proofQuery(game).protectedFrom(bind(game, "p1"), "any")).toMatchObject({ known: false });
    const spent = patchPlayer(game, "p1", { abilityUsed: true });
    expect(proofQuery(spent).protectedFrom(bind(spent, "p1"), "any")).toEqual({ known: true, value: false });
  });
});

describe("Sailor: cannot die while sober (the gate rule; a Sailor in play still keeps automation Manual)", () => {
  const outcome = (game: StorytellerLobbyRecord) => proofQuery(game).deathOutcome(bind(game, "p1"), "demon");

  it("a sober Sailor survives every cause and spends nothing", () => {
    const game = proofGame(roles("sailor"));
    expect(proofQuery(game).protectedFrom(bind(game, "p1"), "any")).toEqual({ known: true, value: true });
    expect(outcome(game)).toEqual({ known: true, value: { kind: "survives", spends: false } });
  });

  it.each(["poisoned", "drunk"])("a %s Sailor dies", type => {
    expect(outcome(impair(proofGame(roles("sailor")), "p1", type))).toEqual({ known: true, value: { kind: "dies" } });
  });

  it("the Sailor's nightly drunk choice is not modelled, so the whole attack stays Manual", () => {
    expect(attack(proofGame(roles("sailor")))).toMatchObject({ ok: false, code: "unsupported" });
    expect(executionAdvice(dayGame("sailor"), "p1", environment)).toBeNull();
  });
});

describe("execution advice and the Fool's spend", () => {
  const advice = (game: StorytellerLobbyRecord) => executionAdvice(game, "p1", environment);

  it("advises survival and spend for an unspent Fool, nothing for others (a Sailor gets none: its drunk choice is not modelled)", () => {
    expect(advice(dayGame("fool"))).toMatchObject({ kind: "survives", spends: true });
    expect(advice(dayGame("chef"))).toBeNull();
    expect(advice(patchPlayer(dayGame("fool"), "p1", { abilityUsed: true }))).toBeNull();
    expect(advice(impair(dayGame("fool"), "p1", "poisoned"))).toBeNull();
  });

  it("a Pacifist in play makes the Fool ambiguous: nothing is spent automatically", () => {
    const game = proofGame(["imp", "fool", "pacifist", "chef"], "day", 2);
    expect(advice(game)).toMatchObject({ kind: "ambiguous" });
    const next = planVoting(game, { ...scope(game), kind: "execution", target: bind(game, "p1"), outcome: "survived" }, environment);
    expect(next.ok && next.game.players.p1!.abilityUsed).toBe(false);
  });

  it("recording 'survived' for an unspent Fool also spends the ability, in the same step", () => {
    const game = dayGame("fool");
    const next = planVoting(game, { ...scope(game), kind: "execution", target: bind(game, "p1"), outcome: "survived" }, environment);
    expect(next).toMatchObject({ ok: true, changed: true });
    if (!next.ok) throw new Error("refused");
    expect(next.game.players.p1!.alive).toBe(true);
    expect(next.game.players.p1!.abilityUsed).toBe(true);
    expect(next.game.lifeEventWindow.events).toHaveLength(1);
    expect(next.game.lifeEventWindow.events[0]).toMatchObject({ kind: "execution", outcome: "survived" });
  });

  it("'survived' for a spent Fool or an ordinary player spends nothing; 'died' never spends", () => {
    for (const [game, outcome] of [
      [patchPlayer(dayGame("fool"), "p1", { abilityUsed: true }), "survived"],
      [dayGame("chef"), "survived"], [dayGame("fool"), "died"],
    ] as const) {
      const next = planVoting(game, { ...scope(game), kind: "execution", target: bind(game, "p1"), outcome }, environment);
      expect(next).toMatchObject({ ok: true, changed: true });
      if (next.ok) expect(next.game.players.p1!.abilityUsed).toBe(game.players.p1!.abilityUsed);
    }
  });

  it("the existing Life planner still refuses a second use, so a Fool cannot be spent twice", () => {
    const game = patchPlayer(dayGame("fool"), "p1", { abilityUsed: true });
    expect(planLifeTransaction(game, { intents: [{ kind: "useAbility", playerId: "p1" }] }, undefined, environment)).toMatchObject({ ok: false });
    void applyLifePlan;
  });
});

describe("review fixes", () => {
  it("an Innkeeper-protected Fool survives and spends nothing", () => {
    const base = proofGame(["imp", "fool", "innkeeper", "chef"]);
    const kept = planned(plan(base, request(base, "p2", "innkeeper", { targets: pick(base, "p1", "p3"), [subjectId(DRUNK_ONE, bind(base, "p1"), bind(base, "p3"))]: pick(base, "p3") })));
    expect(proofQuery(kept).deathOutcome(bind(kept, "p1"), "demon")).toEqual({ known: true, value: { kind: "survives", spends: false } });
  });

  it("a dead Pacifist is not 'in play': the Fool's survival is spent as usual", () => {
    const game = patchPlayer(proofGame(["imp", "fool", "pacifist", "chef"], "day", 2), "p2", { alive: false });
    expect(executionAdvice(game, "p1", environment)).toMatchObject({ kind: "survives", spends: true });
  });

  it("Al-Hadikhia and the Harlot stay Manual when a Fool would be spent (their later steps do not track it)", () => {
    const g = proofGame(["alhadikhia", "fool", "chef", "empath", "monk"]);
    const ids = ["p1", "p2", "p3"];
    const inputs = { chosen: pick(g, ...ids), ...Object.fromEntries([false, true, true].map((v, i) => [choiceId(i, bind(g, ids[i]!)), yes(v)])) };
    expect(plan(g, request(g, "p0", "alhadikhia", inputs))).toMatchObject({ ok: false, code: "unsupported" });
    let h = proofGame(["harlot", "fool", "imp", "chef"]);
    h = patchPlayer(h, "p0", { isTraveler: true, actualAlignment: "good", shownRole: "harlot", publicDisplayRole: "harlot",
      travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 } } as never);
    const t = bind(h, "p1");
    expect(plan(h, request(h, "p0", "harlot", { target: pick(h, "p1"), [subjectId(CONSENT, t)]: yes(), [subjectId(DEATH_CONSEQUENCE, t)]: yes() })))
      .toMatchObject({ ok: false, code: "unsupported" });
  });
});
