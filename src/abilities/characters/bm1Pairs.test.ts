// @vitest-environment node
// BM-1d: the scenarios behind docs/ai/BAD_MOON_RISING_BM1_PAIRS.md. Each test is tagged T1, T2 ... so a row of the pair record can name the
// scenario that proves it. Production semantics through the proof fixtures; no seeded outcomes.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { executionAdvice, executionChoiceFor, executionSurvivalKnown } from "@/stores/executionAdvice";
import { exorcisedDemonReason, exorcistRegistersAsDemonId } from "./exorcist";
import { sailorDrunkId } from "./sailor";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, yes } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const env = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] };
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, env);
const functions = (g: StorytellerLobbyRecord, id: string) => query(g).abilityFunctions(bind(g, id));
const sailorPick = (g: StorytellerLobbyRecord, target: string, chosenDrunk = true, actor = "p0") =>
  planned(plan(g, request(g, actor, "sailor", { target: pick(g, target), [sailorDrunkId(g.players[target]!.participantId!)]: yes(chosenDrunk) })));
const exorcistPick = (g: StorytellerLobbyRecord, target: string, actor = "p0", registers?: boolean) =>
  planned(plan(g, request(g, actor, "exorcist", { target: pick(g, target), ...(registers === undefined ? {} : { [exorcistRegistersAsDemonId(g.players[target]!.participantId!)]: yes(registers) }) })));
const told = (g: StorytellerLobbyRecord, id: string) => { const f = g.players[id]!.effects.find((e) => e.type === "exorcistChosen")?.parameters?.exorcised; return f?.kind === "boolean" ? f.value : undefined; };
const attack = (g: StorytellerLobbyRecord, demon: string, target: string, role = "imp") => plan(g, request(g, demon, role, { target: pick(g, target) }));

describe("Sailor pairs", () => {
  it("T1 an information character the Sailor makes drunk has no ability (the shared impairment query), and the Sailor's own pick is never told apart", () => {
    const g = proofGame(["sailor", "chef", "imp", "monk", "saint"]);
    const next = sailorPick(g, "p1");
    expect(functions(next, "p1")).toEqual({ known: true, value: false });
    expect(functions(next, "p0")).toEqual({ known: true, value: true });
  });
  it("T2 the Poisoner poisons a sober Sailor after the Sailor chose: the Sailor can die, and the Sailor's drunkenness on another player ends", () => {
    const g = proofGame(["sailor", "poisoner", "imp", "monk", "chef"]);
    const chosen = sailorPick(g, "p4");
    const poisoned = planned(plan(chosen, request(chosen, "p1", "poisoner", { target: pick(chosen, "p0") })));
    expect(query(poisoned).deathOutcome(bind(poisoned, "p0"), "demon")).toEqual({ known: true, value: { kind: "dies" } });
    expect(functions(poisoned, "p4")).toEqual({ known: true, value: true });
  });
  it("T3 a Sailor-drunk Monk protects nobody; a sober Monk's protection of a sober Sailor changes nothing (the Sailor already cannot die)", () => {
    const g = proofGame(["sailor", "monk", "imp", "chef", "saint"]);
    const drunkMonk = sailorPick(g, "p1");
    expect(plan(drunkMonk, request(drunkMonk, "p1", "monk", { target: pick(drunkMonk, "p3") }))).toEqual({ ok: true, changed: false });
    expect(attack(g, "p2", "p0")).toEqual({ ok: true, changed: false });
  });
  it("T4 a Sailor-drunk Imp kills nobody; a sober Imp's attack on a sober Sailor changes nothing", () => {
    const g = proofGame(["sailor", "chef", "imp", "monk", "saint"]);
    const next = sailorPick(g, "p2");
    expect(attack(next, "p2", "p1")).toEqual({ ok: true, changed: false });
    expect(attack(g, "p2", "p0")).toEqual({ ok: true, changed: false });
  });
  it("T5 a Sailor the Innkeeper chose and made drunk is protected from the Demon tonight (the Innkeeper protects both), but the drunkenness outlasts the protection (dawn against dusk)", () => {
    const g = proofGame(["sailor", "innkeeper", "imp", "monk", "chef"], "night", 2);
    const key = `innkeeper:drunk:${JSON.stringify([g.players.p0!.participantId, g.players.p4!.participantId])}`;
    const next = planned(plan(g, request(g, "p1", "innkeeper", { targets: pick(g, "p0", "p4"), [key]: pick(g, "p0") })));
    expect(functions(next, "p0")).toEqual({ known: true, value: false });
    expect(query(next).deathOutcome(bind(next, "p0"), "demon")).toEqual({ known: true, value: { kind: "survives", spends: false } });
    // The protection ends at dawn; the drunkenness lasts through the day (until dusk), so the drunk Sailor has no ability to be unkillable then.
    const effects = next.players.p0!.effects;
    expect(effects.find((e) => e.type === "cannotDie")?.expiry).toEqual({ kind: "at", moment: { phase: "day", day: 2 } });
    expect(effects.find((e) => e.type === "drunk")?.expiry).toEqual({ kind: "at", moment: { phase: "night", day: 3 } });
  });
  it("T6 a sober Sailor is executed and lives, with no question asked; a Sailor who made themself drunk is executed and dies", () => {
    const g = proofGame(["sailor", "chef", "imp", "monk", "saint"], "day", 2);
    expect(executionSurvivalKnown(g, "p0", env)).toBe(true);
    expect(executionAdvice(g, "p0", env)).toMatchObject({ kind: "survives", spends: false });
    const selfDrunk = planned(plan({ ...g, phase: "night" }, request({ ...g, phase: "night" }, "p0", "sailor", { target: pick(g, "p0") })));
    expect(executionSurvivalKnown({ ...selfDrunk, phase: "day" }, "p0", env)).toBe(false);
  });
  it("T7 a Sailor's survival of an execution does not need the Pacifist: with a Pacifist alive the Sailor still survives by themself", () => {
    const g = proofGame(["sailor", "chef", "imp", "pacifist", "saint"], "day", 2);
    expect(executionSurvivalKnown(g, "p0", env)).toBe(true);
  });
  it("T8 a Sailor who is the Demon's target while the Exorcist chose the Demon: the Demon does not wake, so the Sailor is not attacked", () => {
    const g = proofGame(["sailor", "exorcist", "imp", "monk", "chef"]);
    const next = exorcistPick(g, "p2", "p1");
    expect(plan(next, request(next, "p2", "imp", { target: pick(next, "p0") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });
  it("T9 two Sailors (a Pit-Hag made one): each choice is one ruling about the other player; a Sailor chosen by the other can be made the drunk one", () => {
    const g = proofGame(["sailor", "sailor", "imp", "monk", "chef"]);
    const next = sailorPick(g, "p1", true, "p0");
    expect(functions(next, "p1")).toEqual({ known: true, value: false });
    expect(query(next).deathOutcome(bind(next, "p1"), "demon")).toEqual({ known: true, value: { kind: "dies" } });
  });
});

describe("More Sailor pairs", () => {
  it("T28 a Sailor who made themself drunk but is protected by the Devil's Advocate survives the execution", () => {
    const night = proofGame(["sailor", "devilsadvocate", "chef", "imp", "saint"], "night", 2);
    const protectedGame = planned(plan(night, request(night, "p1", "devilsadvocate", { target: pick(night, "p0") })));
    const drunk = planned(plan(protectedGame, request(protectedGame, "p0", "sailor", { target: pick(protectedGame, "p0") })));
    expect(functions(drunk, "p0")).toEqual({ known: true, value: false });
    expect(executionSurvivalKnown({ ...drunk, phase: "day" }, "p0", env)).toBe(true);
  });
  it.each(["imp", "shabaloth", "nodashii", "vigormortis", "fanggu", "vortox"])("T29 a sober Sailor attacked by the %s is still alive afterwards", demon => {
    const g = proofGame(["sailor", "chef", demon, "monk", "saint"]);
    const result = plan(g, request(g, "p2", demon, { target: pick(g, "p0"), targets: pick(g, "p0", "p4") }));
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.changed) expect(result.plan.game.players.p0!.alive).toBe(true);
    if (demon === "shabaloth") expect(result).toMatchObject({ ok: true, changed: true });
  });
});

describe("Exorcist pairs", () => {
  it("T10 a Sailor-drunk Exorcist chooses and CHOSEN is placed, but the Demon is not told and still wakes (page example)", () => {
    const g = proofGame(["sailor", "exorcist", "imp", "monk", "chef"]);
    const drunk = sailorPick(g, "p1");
    const next = exorcistPick(drunk, "p2", "p1");
    expect(told(next, "p2")).toBe(false);
    expect(attack(next, "p2", "p4")).toMatchObject({ ok: true });
  });
  it("T11 the Exorcist chooses a Scarlet Woman or another Minion: not the Demon, so nothing is told", () => {
    const g = proofGame(["exorcist", "scarletwoman", "imp", "monk", "chef"]);
    expect(told(exorcistPick(g, "p1"), "p1")).toBe(false);
  });
  it("T12 a Recluse the Exorcist chooses is the Storyteller's one ruling (Yes tells them, No does not) and the real Demon still wakes; a Spy cannot register as the Demon, so nothing is asked", () => {
    const g = proofGame(["exorcist", "spy", "imp", "recluse", "chef"]);
    expect(told(exorcistPick(g, "p3", "p0", true), "p3")).toBe(true);
    expect(told(exorcistPick(g, "p3", "p0", false), "p3")).toBe(false);
    expect(attack(exorcistPick(g, "p3", "p0", true), "p2", "p4")).toMatchObject({ ok: true });
    expect(told(exorcistPick(g, "p1"), "p1")).toBe(false);
  });
  it("T13 an exorcised Imp does not wake, so it cannot pass the star or kill itself; a second night the same Imp wakes again", () => {
    const g = proofGame(["exorcist", "scarletwoman", "imp", "monk", "chef"]);
    const next = exorcistPick(g, "p2");
    expect(attack(next, "p2", "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(attack({ ...next, day: 3 }, "p2", "p4")).toMatchObject({ ok: true });
  });
  it("T14 a Poisoner who poisoned the Exorcist earlier tonight: the pick is recorded, the Demon is not told and wakes", () => {
    const g = proofGame(["exorcist", "poisoner", "imp", "monk", "chef"]);
    const poisoned = planned(plan(g, request(g, "p1", "poisoner", { target: pick(g, "p0") })));
    const next = exorcistPick(poisoned, "p2");
    expect(told(next, "p2")).toBe(false);
    expect(attack(next, "p2", "p4")).toMatchObject({ ok: true });
  });
  it("T15 the Exorcist chooses the Monk's protected player or the Monk: nothing is protected or removed; the Monk's own step is untouched", () => {
    const g = proofGame(["exorcist", "monk", "imp", "chef", "saint"]);
    const next = exorcistPick(g, "p1");
    expect(plan(next, request(next, "p1", "monk", { target: pick(next, "p3") }))).toMatchObject({ ok: true, changed: true });
  });
  it("T16 the Exorcist's CHOSEN does not touch a Demon's other powers: an exorcised Vigormortis loses only its ordinary wake and stays alive", () => {
    const g = proofGame(["exorcist", "chef", "vigormortis", "poisoner", "monk"]);
    const next = exorcistPick(g, "p2");
    expect(exorcisedDemonReason(query(next), bind(next, "p2"))).not.toBeNull();
    expect(next.players.p2!.alive).toBe(true);
  });
  it("T17 the Exorcist dies after choosing (a Demon kill earlier in the night is not possible: the Demon was told): CHOSEN stays, so the next Exorcist pick is still refused for last night's player", () => {
    const g = proofGame(["exorcist", "chef", "imp", "monk", "saint"]);
    const first = exorcistPick(g, "p1");
    const next = { ...patchPlayer(first, "p0", { alive: false }), day: 3 };
    expect(next.players.p1!.effects.some((e) => e.type === "exorcistChosen")).toBe(true);
    // A new Exorcist (a Pit-Hag's) is a different participant: last night's pick was another Exorcist's, so it is not refused for them.
    const alive = { ...first, day: 3 };
    expect(plan(alive, request(alive, "p0", "exorcist", { target: pick(alive, "p1") }))).toMatchObject({ ok: false, code: "illegal" });
  });
  it("T18 the Exorcist chooses a dead former Demon: the Storyteller rules whether they are woken (nothing pre-selected); No leaves only CHOSEN", () => {
    const g = patchPlayer(proofGame(["exorcist", "chef", "imp", "monk", "saint"]), "p2", { alive: false });
    expect(plan(g, request(g, "p0", "exorcist", { target: pick(g, "p2") }))).toMatchObject({ ok: false, code: "needsInput" });
    expect(told(exorcistPick(g, "p2", "p0", false), "p2")).toBe(false);
    expect(told(exorcistPick(g, "p2", "p0", true), "p2")).toBe(true);
  });
  it("T19 a Snake Charmer swap tonight: the Exorcist reads the CURRENT actual characters, so the new Demon can be exorcised and the old one is not", () => {
    const g = proofGame(["exorcist", "snakecharmer", "imp", "monk", "chef"]);
    const swapped = planned(plan(g, request(g, "p1", "snakecharmer", { target: pick(g, "p2") })));
    expect(told(exorcistPick(swapped, "p1"), "p1")).toBe(true);
    expect(told(exorcistPick(swapped, "p2"), "p2")).toBe(false);
  });
  it("T20 a Pit-Hag-made Demon tonight is a Demon for the Exorcist from then on", () => {
    const g = proofGame(["exorcist", "chef", "empath", "pithag", "imp", "monk", "saint"]);
    const made = planned(plan(g, request(g, "p3", "pithag", { target: pick(g, "p2"), character: { kind: "character", roleIds: ["nodashii"] } })));
    expect(told(exorcistPick(made, "p2"), "p2")).toBe(true);
  });
});

describe("Pacifist pairs", () => {
  const day = (roles: string[]) => proofGame(roles, "day", 2);
  it("T21 the question is asked for every kind of good executed player (Townsfolk, Outsider) while a sober Pacifist lives", () => {
    const g = day(["imp", "chef", "pacifist", "saint", "recluse"]);
    for (const id of ["p1", "p3", "p4"]) expect(executionChoiceFor(g, id, env), id).toEqual(["Pacifist"]);
  });
  it("T22 an evil executed player (Imp, Minion) is never asked", () => {
    const g = day(["imp", "poisoner", "pacifist", "chef", "baron"]);
    for (const id of ["p0", "p1", "p4"]) expect(executionChoiceFor(g, id, env), id).toEqual([]);
  });
  it("T23 a Pacifist the Poisoner poisoned, or a Sailor made drunk, saves nobody and is not asked about", () => {
    const g = day(["sailor", "poisoner", "pacifist", "chef", "imp"]);
    expect(executionChoiceFor(impair(g, "p2", "poisoned"), "p3", env)).toEqual([]);
    const next = sailorPick({ ...g, phase: "night" }, "p2");
    expect(executionChoiceFor({ ...next, phase: "day" }, "p3", env)).toEqual([]);
  });
  it("T24 a Fool executed while a Pacifist is alive: the rules cannot say which of the two saved them, so the Storyteller decides and nothing is spent automatically", () => {
    const g = day(["fool", "chef", "pacifist", "imp", "saint"]);
    expect(executionAdvice(g, "p0", env)).toMatchObject({ kind: "ambiguous" });
    expect(executionSurvivalKnown(g, "p0", env)).toBe(false);
    expect(executionChoiceFor(g, "p0", env)).toEqual(["Pacifist"]);
  });
  it("T25 the Pacifist and the Devil's Advocate: the protected player survives by the rules, the Pacifist adds nothing", () => {
    const night = proofGame(["chef", "devilsadvocate", "pacifist", "imp", "saint"], "night", 2);
    const protectedGame = planned(plan(night, request(night, "p1", "devilsadvocate", { target: pick(night, "p0") })));
    expect(executionSurvivalKnown({ ...protectedGame, phase: "day" }, "p0", env)).toBe(true);
  });
  it("T26 a Pacifist who is executed themself (a good player) is asked about", () => {
    expect(executionChoiceFor(day(["imp", "chef", "pacifist", "monk", "saint"]), "p2", env)).toEqual(["Pacifist"]);
  });
  it("T30 a Spy executed with a Pacifist alive: the Spy might register as good, so the question is asked and the Storyteller decides", () => {
    const answer = executionChoiceFor(day(["imp", "spy", "pacifist", "chef", "saint"]), "p1", env);
    expect(answer).toEqual(["Pacifist"]);
  });
  it("T31 a Fool executed while the only Pacifist is drunk: the Pacifist saves nobody, so the Fool's own ability did it and is spent at once (no second survival)", () => {
    const g = impair(day(["fool", "chef", "pacifist", "imp", "saint"]), "p2", "drunk");
    expect(executionAdvice(g, "p0", env)).toMatchObject({ kind: "survives", spends: true });
  });
  it("T27 two Pacifists (a Pit-Hag made one): either one can save, and the prompt names the Pacifist once", () => {
    expect(executionChoiceFor(day(["imp", "chef", "pacifist", "pacifist", "saint"]), "p1", env)).toEqual(["Pacifist"]);
  });
});
