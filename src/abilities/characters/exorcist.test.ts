// @vitest-environment node
// BM-1c -- Exorcist. https://wiki.bloodontheclocktower.com/Exorcist  Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { interactionCoverageEligibility } from "@/abilities/automationEligibility";
import { EXORCISED_REASON, EXORCIST_CHOSEN, exorcisedDemonReason, exorcistRegistersAsDemonId } from "./exorcist";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, requirementIds, yes } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const env = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] };
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, env);
// p0 exorcist, p1 chef (Townsfolk), p2 imp, p3 monk, p4 recluse
const ROLES = ["exorcist", "chef", "imp", "monk", "recluse"];
const night = (g: StorytellerLobbyRecord, day: number): StorytellerLobbyRecord => ({ ...g, day });
const chosen = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === EXORCIST_CHOSEN);
const told = (g: StorytellerLobbyRecord, id: string) => {
  const flag = chosen(g, id)?.parameters?.exorcised;
  return flag?.kind === "boolean" ? flag.value : undefined;
};
const choose = (g: StorytellerLobbyRecord, target: string, registers?: boolean, actor = "p0") =>
  plan(g, request(g, actor, "exorcist", { target: pick(g, target), ...(registers === undefined ? {} : { [exorcistRegistersAsDemonId(g.players[target]!.participantId!)]: yes(registers) }) }));
const impStep = (g: StorytellerLobbyRecord) => plan(g, request(g, "p2", "imp", { target: pick(g, "p1") }));

describe("Exorcist: the nightly choice", () => {
  it("wakes on other nights only", () => {
    expect(choose(proofGame(ROLES, "night", 1), "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(choose(proofGame(ROLES, "night", 2), "p1")).toMatchObject({ ok: true, changed: true });
  });
  it("a player who is not the Demon: CHOSEN is placed, nobody is told, nothing is asked", () => {
    const next = planned(choose(proofGame(ROLES), "p1"));
    expect(chosen(next, "p1")).toBeDefined();
    expect(told(next, "p1")).toBe(false);
    expect(exorcisedDemonReason(query(next), bind(next, "p2"))).toBeNull();
    expect(impStep(next)).toMatchObject({ ok: true });
  });
  it("any player may be chosen: a dead player, and the Exorcist themself", () => {
    const g = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    expect(choose(g, "p1")).toMatchObject({ ok: true, changed: true });
    expect(choose(proofGame(ROLES), "p0")).toMatchObject({ ok: true, changed: true });
  });
  it("the Demon: told, and the Demon's ordinary wake tonight does not happen (with the reason)", () => {
    const g = proofGame(ROLES);
    const next = planned(choose(g, "p2"));
    expect(told(next, "p2")).toBe(true);
    expect(exorcisedDemonReason(query(next), bind(next, "p2"))).toBe(EXORCISED_REASON);
    expect(impStep(next)).toMatchObject({ ok: false, code: "notApplicable", message: EXORCISED_REASON });
    // Before the Exorcist acts the Imp still wakes.
    expect(impStep(g)).toMatchObject({ ok: true });
  });
  it("the block belongs to tonight: the next night the Imp wakes again", () => {
    const next = night(planned(choose(proofGame(ROLES), "p2")), 3);
    expect(impStep(next)).toMatchObject({ ok: true });
  });
  it("a drunk Demon is still told and still does not wake", () => {
    const next = planned(choose(impair(proofGame(ROLES), "p2", "drunk"), "p2"));
    expect(told(next, "p2")).toBe(true);
  });
  it("only a Demon is stopped: a Minion the Exorcist chose is not, and a Marionette is not the Demon", () => {
    const g = proofGame(["exorcist", "chef", "imp", "monk", "poisoner"]);
    const next = planned(choose(g, "p4"));
    expect(told(next, "p4")).toBe(false);
    // A Marionette believes they are good and is not the Demon.
    const marionette = proofGame(["exorcist", "chef", "imp", "marionette", "monk"]);
    expect(told(planned(choose(marionette, "p3")), "p3")).toBe(false);
  });
});

describe("Exorcist: a different player each night; CHOSEN moves", () => {
  it("refuses last night's player", () => {
    const first = night(planned(choose(proofGame(ROLES), "p1")), 3);
    expect(choose(first, "p1")).toMatchObject({ ok: false, code: "illegal", message: "Player 1 was chosen last night. Choose a different player." });
  });
  it("allows it again the night after next, and CHOSEN moves to the new pick", () => {
    const first = night(planned(choose(proofGame(ROLES), "p1")), 3);
    const second = planned(choose(first, "p3"));
    expect(chosen(second, "p1")).toBeUndefined();
    expect(chosen(second, "p3")).toBeDefined();
    expect(choose(night(second, 4), "p1")).toMatchObject({ ok: true, changed: true });
  });
  it("a corrected pick tonight replaces tonight's CHOSEN", () => {
    const first = planned(choose(proofGame(ROLES), "p1"));
    const second = planned(choose(first, "p3"));
    expect(chosen(second, "p1")).toBeUndefined();
    expect(chosen(second, "p3")).toBeDefined();
  });
  it("the rule is about the player, not the role", () => {
    const first = night(planned(choose(proofGame(ROLES), "p4", false)), 3);
    expect(choose(first, "p4", false)).toMatchObject({ ok: false, code: "illegal" });
  });
  it("CHOSEN outlives the Exorcist's death (the memory of last night's pick)", () => {
    const first = planned(choose(proofGame(ROLES), "p1"));
    const dead = patchPlayer(night(first, 3), "p0", { alive: false });
    expect(chosen(dead, "p1")).toBeDefined();
  });
});

describe("Exorcist: a drunk or poisoned Exorcist", () => {
  it.each(["poisoned", "drunk"])("a %s Exorcist chooses and CHOSEN is placed, but the Demon is not told and wakes", type => {
    const next = planned(choose(impair(proofGame(ROLES), "p0", type), "p2"));
    expect(chosen(next, "p2")).toBeDefined();
    expect(told(next, "p2")).toBe(false);
    expect(impStep(next)).toMatchObject({ ok: true });
  });
  it("the pick counts for 'a different player' even though the Exorcist was impaired", () => {
    const first = night(planned(choose(impair(proofGame(ROLES), "p0", "drunk"), "p1")), 3);
    expect(choose(first, "p1")).toMatchObject({ ok: false, code: "illegal" });
  });
  it("an Exorcist who becomes poisoned later the same night no longer stops the Demon (read live)", () => {
    const next = planned(choose(proofGame(ROLES), "p2"));
    expect(impStep(next)).toMatchObject({ ok: false, code: "notApplicable" });
    expect(impStep(impair(next, "p0", "poisoned"))).toMatchObject({ ok: true });
  });
});

describe("Exorcist: a player who might register as the Demon", () => {
  it("asks once, with nothing pre-selected", () => {
    const g = proofGame(ROLES);
    const result = choose(g, "p4");
    expect(result).toMatchObject({ ok: false, code: "needsInput" });
    expect(requirementIds(result)).toEqual([exorcistRegistersAsDemonId(g.players.p4!.participantId!)]);
  });
  it("Yes: told; No: not told", () => {
    const g = proofGame(ROLES);
    expect(told(planned(choose(g, "p4", true)), "p4")).toBe(true);
    expect(told(planned(choose(g, "p4", false)), "p4")).toBe(false);
  });
  it("a Recluse who registered as the Demon does not stop the real Demon", () => {
    const next = planned(choose(proofGame(ROLES), "p4", true));
    expect(impStep(next)).toMatchObject({ ok: true });
  });
  it("an impaired Exorcist asks nothing", () => {
    expect(choose(impair(proofGame(ROLES), "p0", "poisoned"), "p4")).toMatchObject({ ok: true, changed: true });
  });
});

describe("Exorcist: the shared rule reaches every Demon's ordinary wake", () => {
  it.each(["imp", "shabaloth", "nodashii", "fanggu", "vigormortis", "vortox"])("%s does not wake once exorcised", demon => {
    const roles = ["exorcist", "chef", demon, "monk", "saint"];
    const next = planned(choose(proofGame(roles), "p2"));
    expect(exorcisedDemonReason(query(next), bind(next, "p2"))).toBe(EXORCISED_REASON);
    expect(plan(next, request(next, "p2", demon, { target: pick(next, "p1"), targets: pick(next, "p1", "p3") }))).toMatchObject({ ok: false, code: "notApplicable", message: EXORCISED_REASON });
  });
});

describe("Exorcist: coverage", () => {
  it("is no longer wholly manual: a game with an Exorcist is covered", () => {
    expect(interactionCoverageEligibility(query(proofGame(ROLES)))).toEqual({ kind: "automated" });
  });
});
