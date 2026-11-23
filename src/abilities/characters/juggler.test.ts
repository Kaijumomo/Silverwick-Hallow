// @vitest-environment node
// SV-5f: the Juggler (https://wiki.bloodontheclocktower.com/Juggler, saved 2026-11-11). Every expected count below is worked out by hand
// from the guesses each test records, never read back from the code under test.
import { describe, expect, it } from "vitest";
import { bind, impair, num, patchPlayer, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { automationEligibility } from "@/abilities/automationEligibility";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { effectSemanticsOf } from "@/stores/rulesQuery";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { victoryCoverageEligibility } from "@/stores/victoryEvidence";
import { proofRegistry, proofScript } from "@/test/proofFixtures";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import { JUGGLER_COMMUNICATED, JUGGLER_DONE, JUGGLER_GUESS, JUGGLER_UNRECORDED, jugglerGuessVerdict, jugglerTally } from "./juggler";
import { withGuesses, type Guess } from "@/test/jugglerFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 juggler, p1 fanggu, p2 clockmaker, p3 cerenovus, p4 savant, p5 artist, p6 mutant
const ROLES = ["juggler", "fanggu", "clockmaker", "cerenovus", "savant", "artist", "mutant"];
const night2 = (roles = ROLES) => proofGame(roles, "night", 2);
const evaluate = (g: StorytellerLobbyRecord, inputs: Record<string, ReturnType<typeof num>> = {}) => plan(g, request(g, "p0", "juggler", inputs));
const told = (g: StorytellerLobbyRecord, inputs: Record<string, ReturnType<typeof num>> = {}) => {
  const result = evaluate(g, inputs);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, changed: true });
  const after = planned(result);
  expect(after.informationDeliveries.at(-1)).toMatchObject({ informationActionId: "juggler-other-night" });
  return { value: after.informationDeliveries.at(-1)!.values![0], after };
};
const asked = (g: StorytellerLobbyRecord) => {
  const result = evaluate(g);
  expect(result, JSON.stringify(result)).toMatchObject({ ok: false, code: "needsInput" });
  return result.ok ? undefined : result.requirements![0]!;
};
const THREE: Guess[] = [{ who: "p2", role: "clockmaker", correct: true }, { who: "p1", role: "nodashii", correct: false }, { who: "p4", role: "savant", correct: true }];

describe("SV-5f Juggler: a guess is judged when made (the character they register as)", () => {
  const verdict = (g: StorytellerLobbyRecord, who: string, role: string) => jugglerGuessVerdict(proofQuery(g), bind(g, who), role);
  it("an ordinary player: correct only for their actual character", () => {
    const g = proofGame(ROLES, "day", 1);
    expect(verdict(g, "p2", "clockmaker")).toEqual({ kind: "known", correct: true });
    expect(verdict(g, "p2", "dreamer")).toEqual({ kind: "known", correct: false });
    expect(verdict(g, "p1", "fanggu")).toEqual({ kind: "known", correct: true });
    // The Juggler may guess themself.
    expect(verdict(g, "p0", "juggler")).toEqual({ kind: "known", correct: true });
  });

  it("a Drunk who believes they are the Clockmaker is the Drunk; a Marionette the Marionette", () => {
    let g = patchPlayer(proofGame(ROLES, "day", 1), "p2", { actualRole: "drunk", shownRole: "clockmaker" });
    expect(verdict(g, "p2", "clockmaker")).toEqual({ kind: "known", correct: false });
    expect(verdict(g, "p2", "drunk")).toEqual({ kind: "known", correct: true });
    g = patchPlayer(proofGame(ROLES, "day", 1), "p3", { actualRole: "marionette", shownRole: "savant", actualAlignment: "evil" });
    expect(verdict(g, "p3", "savant")).toEqual({ kind: "known", correct: false });
    expect(verdict(g, "p3", "marionette")).toEqual({ kind: "known", correct: true });
  });

  it("a healthy Spy or Recluse who might register as the guess: the Storyteller's Yes / No; a form they cannot take: incorrect", () => {
    const g = proofGame(["juggler", "imp", "spy", "recluse", "chef", "monk", "empath"], "day", 1);
    expect(verdict(g, "p2", "chef")).toMatchObject({ kind: "ask" });
    expect(verdict(g, "p2", "spy")).toMatchObject({ kind: "ask" });
    expect(verdict(g, "p2", "imp")).toEqual({ kind: "known", correct: false });
    expect(verdict(g, "p3", "imp")).toMatchObject({ kind: "ask" });
    expect(verdict(g, "p3", "poisoner")).toMatchObject({ kind: "ask" });
    expect(verdict(g, "p3", "recluse")).toMatchObject({ kind: "ask" });
    expect(verdict(g, "p3", "chef")).toEqual({ kind: "known", correct: false });
  });

  it("a poisoned Spy registers as itself: no question", () => {
    const g = impair(proofGame(["juggler", "imp", "spy", "chef", "monk"], "day", 1), "p2");
    expect(verdict(g, "p2", "spy")).toEqual({ kind: "known", correct: true });
    expect(verdict(g, "p2", "chef")).toEqual({ kind: "known", correct: false });
  });
});

describe("SV-5f Juggler: that night", () => {
  it("the page's first example: three guesses, two correct, learns 2; Next also removes the guesses and Done", () => {
    const g = withGuesses(night2(), "p0", THREE);
    const { value, after } = told(g);
    expect(value).toMatchObject({ requirementId: "correct", kind: "number", value: 2 });
    expect(after.players.p0!.effects.filter((effect) => effect.type === JUGGLER_GUESS || effect.type === JUGGLER_DONE)).toEqual([]);
  });

  it("the page's second example: the same player guessed twice and a repeated character, one correct: 1", () => {
    const g = withGuesses(night2(), "p0", [{ who: "p3", role: "pithag", correct: false }, { who: "p3", role: "cerenovus", correct: true }, { who: "p5", role: "cerenovus", correct: false }]);
    expect(told(g).value).toMatchObject({ value: 1 });
  });

  it("zero guesses with Done: 0; five correct: 5", () => {
    expect(told(withGuesses(night2(), "p0", [])).value).toMatchObject({ value: 0 });
    const five = ["p1", "p2", "p3", "p4", "p5"].map((who, i) => ({ who, role: ROLES[i + 1]!, correct: true }));
    expect(told(withGuesses(night2(), "p0", five)).value).toMatchObject({ value: 5 });
  });

  it("guessed while drunk, sober tonight: the true count (the page)", () => {
    // The guess-time poisoning ended at dawn; nothing about it is read.
    expect(told(withGuesses(night2(), "p0", THREE)).value).toMatchObject({ value: 2 });
  });

  it("drunk or poisoned tonight: the Storyteller chooses any number 0 to 5, and the records stay until dawn", () => {
    const g = impair(withGuesses(night2(), "p0", THREE), "p0");
    expect(asked(g)).toMatchObject({ id: JUGGLER_COMMUNICATED, kind: "number", source: "storyteller" });
    const { value, after } = told(g, { [JUGGLER_COMMUNICATED]: num(4) });
    expect(value).toMatchObject({ value: 4 });
    expect(jugglerTally(after.players.p0!, 1).guesses).toHaveLength(3);
    expect(evaluate(g, { [JUGGLER_COMMUNICATED]: num(6) })).toMatchObject({ ok: false, code: "illegal" });
  });

  it("Done not recorded: the Storyteller's number, and says why", () => {
    const g = withGuesses(night2(), "p0", THREE, false);
    const requirement = asked(g);
    expect(requirement).toMatchObject({ id: JUGGLER_UNRECORDED, kind: "number" });
    const result = evaluate(g);
    expect(result.ok ? "" : result.message).toMatch(/not marked done/);
    expect(told(g, { [JUGGLER_UNRECORDED]: num(1) }).value).toMatchObject({ value: 1 });
  });

  it("a Drunk shown the Juggler: the Storyteller chooses", () => {
    const g = patchPlayer(night2(), "p0", { actualRole: "drunk", shownRole: "juggler" });
    expect(asked(g)).toMatchObject({ id: JUGGLER_COMMUNICATED });
  });

  it("a Vortox: any number but the true count; a drunk Juggler too; without Done, by hand", () => {
    const roles = ["juggler", "vortox", "clockmaker", "cerenovus", "savant", "artist", "mutant"];
    const g = withGuesses(night2(roles), "p0", THREE);
    expect(asked(g)).toMatchObject({ id: JUGGLER_COMMUNICATED, exclude: [2] });
    expect(evaluate(g, { [JUGGLER_COMMUNICATED]: num(2) })).toMatchObject({ ok: false, code: "illegal" });
    const { value, after } = told(g, { [JUGGLER_COMMUNICATED]: num(3) });
    expect(value).toMatchObject({ value: 3 });
    expect(jugglerTally(after.players.p0!, 1).guesses).toEqual([]);
    const drunk = impair(g, "p0");
    expect(asked(drunk)).toMatchObject({ id: JUGGLER_COMMUNICATED, exclude: [2] });
    expect(jugglerTally(told(drunk, { [JUGGLER_COMMUNICATED]: num(0) }).after.players.p0!, 1).guesses).toHaveLength(3);
    expect(evaluate(withGuesses(night2(roles), "p0", THREE, false))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("guesses from another Day, or another Juggler's, are not counted", () => {
    const old = withGuesses(proofGame(ROLES, "night", 3), "p0", THREE, true, 1);
    expect(asked(old)).toMatchObject({ id: JUGGLER_UNRECORDED });
  });

  it("is automated (guided) for a real Juggler on the reviewed list", () => {
    const g = withGuesses(night2(), "p0", THREE);
    expect(automationEligibility({ query: proofQuery(g), descriptor: CANONICAL_ABILITY_SEMANTICS.get("juggler")!, actor: bind(g, "p0"), roleId: "juggler", simulated: false }).kind).toBe("automated");
  });
});

describe("SV-5f Juggler: the records", () => {
  it("go when the Juggler changes character before their Night (a Pit-Hag): no CORRECT token is left on a non-Juggler", () => {
    // p0 juggler, p1 pithag, p2 fanggu, p3 chef, p4 monk
    const g = withGuesses(proofGame(["juggler", "pithag", "fanggu", "chef", "monk"], "night", 2), "p0", [{ who: "p3", role: "chef", correct: true }]);
    const after = planned(plan(g, request(g, "p1", "pithag", { target: pick(g, "p0"), character: { kind: "character", roleIds: ["empath"] } })));
    expect(after.players.p0!.actualRole).toBe("empath");
    expect(after.players.p0!.effects.filter((effect) => effect.type === JUGGLER_GUESS || effect.type === JUGGLER_DONE)).toEqual([]);
  });

  it("stay on a Juggler who died before the Night (they do not wake; they expire at dawn)", () => {
    const g = patchPlayer(withGuesses(night2(), "p0", THREE), "p0", { alive: false });
    expect(evaluate(g)).toMatchObject({ ok: false, code: "notApplicable" });
    expect(jugglerTally(g.players.p0!, 1).guesses).toHaveLength(3);
  });

  it("are approved Storyteller facts, valid in the saved game, and never make an ending proposal manual", () => {
    expect(effectSemanticsOf(JUGGLER_GUESS)).toBe("storytellerFact");
    expect(effectSemanticsOf(JUGGLER_DONE)).toBe("storytellerFact");
    const g = withGuesses(night2(), "p0", THREE);
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(true);
    // victoryEvidence.ts: an unregistered Effect type would make every ending proposal manual. On a Trouble Brewing table (whose endings are
    // automated) the same records leave it automated.
    const environment = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
    const tb = proofGame(["chef", "imp", "empath", "poisoner", "monk"], "night", 2);
    expect(victoryCoverageEligibility(tb, environment)).toEqual({ kind: "automated" });
    expect(victoryCoverageEligibility(withGuesses(tb, "p0", THREE), environment)).toEqual({ kind: "automated" });
  });

  it("draw one official CORRECT token per correct guess on the Juggler; incorrect guesses and Done draw nothing", () => {
    const g = withGuesses(night2(), "p0", THREE);
    const tokens = officialEffectPresentation(g.players.p0!, { query: proofQuery(g), target: bind(g, "p0") }).tokens;
    expect(tokens.map((token) => [token.key, token.label, token.instances.length])).toEqual([["juggler:jugglerGuess", "Correct", 2]]);
    const none = withGuesses(night2(), "p0", [{ who: "p1", role: "imp", correct: false }]);
    expect(officialEffectPresentation(none.players.p0!, { query: proofQuery(none), target: bind(none, "p0") }).tokens).toEqual([]);
  });
});

