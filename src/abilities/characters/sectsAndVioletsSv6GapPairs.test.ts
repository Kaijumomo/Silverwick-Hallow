// @vitest-environment node
// SV-6a: the 15 pairs of the Sects & Violets script that no earlier stage owned. They are all pairs among the No Dashii, Oracle, Pit-Hag, Town
// Crier, Vigormortis and Witch (docs/ai/SECTS_AND_VIOLETS_PAIRS.md, rows marked "SV-6a"). Each test is named with its pair. Production semantics
// through the proof fixtures; no seeded outcomes.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { subjectId } from "./shared";
import { POISONED_NEIGHBOUR } from "./vigormortis";
import { bind, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";

const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const impaired = (g: StorytellerLobbyRecord, id: string) => query(g).impaired(bind(g, id));
const functions = (g: StorytellerLobbyRecord, id: string) => query(g).abilityFunctions(bind(g, id));
const character = (roleId: string) => ({ kind: "character" as const, roleIds: [roleId] });
const hag = (g: StorytellerLobbyRecord, actor: string, target: string, roleId: string) =>
  plan(g, request(g, actor, "pithag", { target: pick(g, target), character: character(roleId) }));
const kill = (g: StorytellerLobbyRecord, actor: string, role: string, target: string, extra = {}) =>
  plan(g, request(g, actor, role, { target: pick(g, target), ...extra }));
const choice = (g: StorytellerLobbyRecord, minion: string, who: string) => ({ [subjectId(POISONED_NEIGHBOUR, bind(g, minion))]: pick(g, who) });
const curseOn = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "witchCurse");
const lastValues = (g: StorytellerLobbyRecord) => g.informationDeliveries.at(-1)!.values;

// Nominations of the Day just ended (the Town Crier's source), as in townCrierOraclePro.test.ts.
const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
const round = (g: StorytellerLobbyRecord, nominator: string, nominee: string): VotingRound => {
  const order = [ref(g, nominator), ref(g, nominee)];
  return { id: `r-${nominator}-${nominee}`, mode: "nomination", nominator: ref(g, nominator), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: "no" as const, weight: 0, spentGhostVote: false, refundSafe: false, lifeSafe: true })),
    threshold: 3, status: "acknowledged", result: "belowThreshold", tally: 0, virginPending: false, contextStamp: "", executionEventIds: [] };
};
const nominated = (g: StorytellerLobbyRecord, nominator: string, nominee: string, day = 2): StorytellerLobbyRecord =>
  ({ ...g, voting: { day, revision: 1, coverage: "known", rounds: [round(g, nominator, nominee)], activeRoundId: null, block: null, modifiers: [] } });
const crier = (g: StorytellerLobbyRecord, id: string) => plan(g, request(g, id, "towncrier"));
const oracle = (g: StorytellerLobbyRecord, id: string) => plan(g, request(g, id, "oracle"));

describe("SV-6a gap pairs (the six characters no stage owned)", () => {
  it("No Dashii / Oracle: an Oracle beside a living No Dashii is poisoned and the Storyteller chooses the number; with the No Dashii dead the dead evil players are counted", () => {
    const g = proofGame(["nodashii", "oracle", "chef", "witch", "empath"], "night", 3);
    expect(impaired(g, "p1")).toEqual({ known: true, value: true });
    expect(oracle(g, "p1")).toMatchObject({ ok: false, code: "needsInput" });
    const dead = patchPlayer(patchPlayer(g, "p0", { alive: false }), "p3", { alive: false });
    expect(impaired(dead, "p1")).toEqual({ known: true, value: false });
    expect(lastValues(planned(oracle(dead, "p1")))).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 2 });
  });

  it("No Dashii / Pit-Hag: a player the Pit-Hag makes the No Dashii poisons its two nearest Townsfolk at once (derived) and tonight's deaths are arbitrary", () => {
    const g = proofGame(["pithag", "chef", "empath", "monk", "saint", "washerwoman", "oracle"], "night", 3);
    const next = planned(hag(g, "p0", "p1", "nodashii"));
    expect(next.players.p1).toMatchObject({ actualRole: "nodashii", actualAlignment: "good" });
    expect(next.gameRuleFacts).toEqual([expect.objectContaining({ type: "pitHagArbitraryDeaths" })]);
    // The Pit-Hag (a Minion) is skipped on one side: the nearest Townsfolk are the Empath and, round the table, the Oracle.
    expect(impaired(next, "p2")).toEqual({ known: true, value: true });
    expect(impaired(next, "p6")).toEqual({ known: true, value: true });
    expect(impaired(next, "p3")).toEqual({ known: true, value: false });
    // Changing the No Dashii again ends the poison with the character.
    const gone = patchPlayer(next, "p1", { actualRole: "slayer" });
    expect(impaired(gone, "p2")).toEqual({ known: true, value: false });
  });

  it("No Dashii / Town Crier: a Town Crier beside the No Dashii is poisoned (the Storyteller chooses); a Demon's nomination is not a Minion's, so the answer is NO", () => {
    const beside = proofGame(["nodashii", "towncrier", "chef", "witch", "empath"], "night", 3);
    expect(crier(nominated(beside, "p3", "p2"), "p1")).toMatchObject({ ok: false, code: "needsInput" });
    const away = proofGame(["nodashii", "chef", "empath", "towncrier", "witch", "saint", "monk"], "night", 3);
    expect(impaired(away, "p3")).toEqual({ known: true, value: false });
    expect(lastValues(planned(crier(nominated(away, "p0", "p1"), "p3")))).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: false });
  });

  it("No Dashii / Vigormortis: two living Demons keep each kill by hand", () => {
    const g = proofGame(["nodashii", "vigormortis", "chef", "witch", "oracle", "mutant"], "night", 3);
    expect(kill(g, "p0", "nodashii", "p2")).toMatchObject({ ok: false, code: "unsupported" });
    expect(kill(g, "p1", "vigormortis", "p2")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("No Dashii / Witch: the Witch is a Minion, so the No Dashii does not poison her and her curse works (on the No Dashii too)", () => {
    const g = proofGame(["witch", "nodashii", "chef", "empath", "saint"], "night", 3);
    expect(functions(g, "p0")).toEqual({ known: true, value: true });
    expect(impaired(g, "p2")).toEqual({ known: true, value: true });
    // Counter-clockwise from the No Dashii the Witch (a Minion) and the Saint (an Outsider) are skipped: the Empath is the other neighbour.
    expect(impaired(g, "p3")).toEqual({ known: true, value: true });
    expect(impaired(g, "p4")).toEqual({ known: true, value: false });
    expect(curseOn(planned(kill(g, "p0", "witch", "p1")), "p1")).toMatchObject({ sourceCharacter: "witch" });
  });

  it("Oracle / Pit-Hag: a player the Pit-Hag makes the Oracle runs the real step and counts the dead evil players", () => {
    const g = patchPlayer(proofGame(["pithag", "chef", "empath", "imp", "monk", "saint", "washerwoman"], "night", 3), "p3", { alive: false });
    const next = planned(hag(g, "p0", "p1", "oracle"));
    expect(next.players.p1).toMatchObject({ actualRole: "oracle", actualAlignment: "good" });
    expect(lastValues(planned(oracle(next, "p1")))).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 1 });
  });

  it("Oracle / Town Crier: independent information steps; each answers from its own record in the same night", () => {
    const base = patchPlayer(patchPlayer(proofGame(["oracle", "towncrier", "chef", "witch", "imp", "empath", "monk"], "night", 3), "p3", { alive: false }), "p4", { alive: false });
    const g = nominated(base, "p3", "p2");
    expect(lastValues(planned(oracle(g, "p0")))).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 2 });
    expect(lastValues(planned(crier(g, "p1")))).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: true });
  });

  it("Oracle / Vigormortis: a Minion the Vigormortis kills is a dead evil player in the Oracle's count; a poisoned Oracle neighbour gets the Storyteller's number", () => {
    const g = proofGame(["vigormortis", "chef", "empath", "baron", "oracle", "saint", "poisoner"], "night", 3);
    const safe = planned(kill(g, "p0", "vigormortis", "p3", choice(g, "p3", "p2")));
    expect(safe.players.p3!.alive).toBe(false);
    expect(lastValues(planned(oracle(safe, "p4")))).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 1 });
    const hurt = planned(kill(g, "p0", "vigormortis", "p3", choice(g, "p3", "p4")));
    expect(oracle(hurt, "p4")).toMatchObject({ ok: false, code: "needsInput" });
  });

  it("Oracle / Witch: a dead Witch is a dead evil player in the Oracle's count", () => {
    const g = patchPlayer(proofGame(["witch", "oracle", "chef", "imp", "empath", "monk", "saint"], "night", 3), "p0", { alive: false });
    expect(lastValues(planned(oracle(g, "p1")))).toContainEqual({ requirementId: "deadEvil", kind: "number", value: 1 });
  });

  it("Pit-Hag / Town Crier: a Pit-Hag who nominates is a Minion nominating (YES), and a player the Pit-Hag makes the Town Crier runs the real step", () => {
    const g = proofGame(["pithag", "chef", "empath", "imp", "monk", "saint", "washerwoman"], "night", 3);
    const next = planned(hag(g, "p0", "p1", "towncrier"));
    expect(next.players.p1).toMatchObject({ actualRole: "towncrier", actualAlignment: "good" });
    expect(lastValues(planned(crier(nominated(next, "p0", "p2"), "p1")))).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: true });
  });

  it("Pit-Hag / Vigormortis: a player the Pit-Hag makes the Vigormortis makes tonight's deaths arbitrary; a Pit-Hag the Vigormortis kills keeps the ability (HAS ABILITY)", () => {
    const g = proofGame(["pithag", "chef", "empath", "monk", "saint", "washerwoman", "oracle"], "night", 3);
    const made = planned(hag(g, "p0", "p1", "vigormortis"));
    expect(made.gameRuleFacts).toEqual([expect.objectContaining({ type: "pitHagArbitraryDeaths" })]);
    expect(kill(made, "p1", "vigormortis", "p2")).toMatchObject({ ok: false, code: "unsupported" });
    const v = proofGame(["vigormortis", "chef", "empath", "pithag", "monk", "saint", "washerwoman"], "night", 3);
    const killed = planned(kill(v, "p0", "vigormortis", "p3", choice(v, "p3", "p2")));
    expect(killed.players.p3!.alive).toBe(false);
    expect(functions(killed, "p3")).toEqual({ known: true, value: true });
    expect(hag(killed, "p3", "p1", "slayer")).toMatchObject({ ok: true });
  });

  it("Pit-Hag / Witch: changing the Witch removes her curse with the character; a player the Pit-Hag makes the Witch curses from then on", () => {
    const g = proofGame(["pithag", "witch", "chef", "empath", "monk", "saint", "washerwoman"], "night", 3);
    const cursed = planned(kill(g, "p1", "witch", "p2"));
    expect(query(cursed).effectApplies(bind(cursed, "p2"), curseOn(cursed, "p2")!)).toEqual({ known: true, value: true });
    const changed = planned(hag(cursed, "p0", "p1", "slayer"));
    expect(curseOn(changed, "p2")).toBeUndefined();
    const second = proofGame(["pithag", "chef", "empath", "monk", "saint", "washerwoman", "oracle"], "night", 3);
    const witch = planned(hag(second, "p0", "p1", "witch"));
    expect(curseOn(planned(kill(witch, "p1", "witch", "p2")), "p2")).toMatchObject({ sourceCharacter: "witch" });
  });

  it("Town Crier / Vigormortis: a Minion the Vigormortis kills still counts as having nominated; a Town Crier it poisons gets the Storyteller's answer", () => {
    const g = proofGame(["vigormortis", "chef", "towncrier", "baron", "empath", "saint", "poisoner"], "night", 3);
    const safe = nominated(planned(kill(g, "p0", "vigormortis", "p3", choice(g, "p3", "p4"))), "p3", "p1");
    expect(lastValues(planned(crier(safe, "p2")))).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: true });
    const hurt = planned(kill(g, "p0", "vigormortis", "p3", choice(g, "p3", "p2")));
    expect(crier(hurt, "p2")).toMatchObject({ ok: false, code: "needsInput" });
  });

  it("Town Crier / Witch: a Witch who nominated is a Minion nominating (YES); the Witch's curse on the Town Crier does not touch the night answer", () => {
    const g = proofGame(["witch", "towncrier", "chef", "imp", "empath", "monk", "saint"], "night", 3);
    const cursed = planned(kill(g, "p0", "witch", "p1"));
    expect(curseOn(cursed, "p1")).toBeDefined();
    expect(lastValues(planned(crier(nominated(cursed, "p0", "p2"), "p1")))).toContainEqual({ requirementId: "minionNominated", kind: "boolean", value: true });
  });

  it("Vigormortis / Witch: a Witch the Vigormortis kills keeps her ability, so her curse still applies and she poisons the Townsfolk neighbour chosen", () => {
    const g = proofGame(["vigormortis", "chef", "witch", "empath", "monk", "saint", "poisoner"], "night", 3);
    const cursed = planned(kill(g, "p2", "witch", "p5"));
    const killed = planned(kill(cursed, "p0", "vigormortis", "p2", choice(cursed, "p2", "p3")));
    expect(killed.players.p2!.alive).toBe(false);
    expect(functions(killed, "p2")).toEqual({ known: true, value: true });
    expect(query(killed).effectApplies(bind(killed, "p5"), curseOn(killed, "p5")!)).toEqual({ known: true, value: true });
    expect(impaired(killed, "p3")).toEqual({ known: true, value: true });
  });
});
