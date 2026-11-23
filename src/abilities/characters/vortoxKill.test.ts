// SV-5k -- the Vortox's kill: "Each night*, choose a player: they die." https://wiki.bloodontheclocktower.com/Vortox
// Production semantics, the real coordinator and the real store. The false information (SV-5h/i/j) and the no-execution ending (SV-5l)
// are rules with their own tests; this file is the wake.
import { beforeEach, describe, expect, it } from "vitest";
import { VORTOX } from "./vortox";
import { SAGE, SAGE_PLAYERS } from "./sage";
import { nightTriggerStatus } from "@/abilities/invocation";
import { automationEligibility } from "@/abilities/automationEligibility";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { createRulesQuery } from "@/stores/rulesQuery";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { computeNightOrder } from "@/rules/night/nightOrder";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 vortox, p1 clockmaker, p2 monk, p3 sage, p4 mutant, p5 witch, p6 fool
const ROLES = ["vortox", "clockmaker", "monk", "sage", "mutant", "witch", "fool"];
const game = () => store.getState().game!;
const attack = (g: StorytellerLobbyRecord, target: string, extra: Record<string, unknown> = {}) =>
  plan(g, request(g, "p0", "vortox", { target: pick(g, target), ...extra }, { withStep: true, completeStep: true }));
const protect = (g: StorytellerLobbyRecord, target: string) => planned(plan(g, request(g, "p2", "monk", { target: pick(g, target) })));
const deadTokens = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.reminders.filter((r) => r.label === "Dead" && r.sourceCharacter === "vortox");
const step = (g: StorytellerLobbyRecord, id: string) => g.nightProgress[`${g.day}:${participantStepKey(g.players[id]!.participantId!, "vortox")}`]?.status;

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("SV-5k: the Vortox's kill", () => {
  it("is registered production semantics: a wake on every night but the first, a player to kill", () => {
    expect(CANONICAL_ABILITY_SEMANTICS.get("vortox")).toBe(VORTOX);
    expect(VORTOX).toMatchObject({ timing: ["otherNight"], invocation: "wake", inputs: [{ id: "target", kind: "participant", source: "player" }] });
    expect(VORTOX.truth).toBeUndefined();
  });

  it("an unprotected player dies: the Vortox's DEAD token, the cause recorded as the Vortox's, the step Completed", () => {
    const next = planned(attack(proofGame(ROLES), "p1"));
    expect(next.players.p1!.alive).toBe(false);
    expect(deadTokens(next, "p1")).toHaveLength(1);
    expect(next.lifeEventWindow.events.at(-1)).toMatchObject({ kind: "death", actualRoleAtEvent: "clockmaker",
      provenance: { sourceCharacter: "vortox", sourceParticipant: { kind: "participant", playerId: "p0" } } });
    expect(step(next, "p0")).toBe("done");
  });

  it("a dead target changes nothing", () => {
    const g = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    expect(plan(g, request(g, "p0", "vortox", { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
  });

  it("protection: a Monk-protected player survives; a Soldier survives", () => {
    const g = protect(proofGame(ROLES), "p1");
    expect(plan(g, request(g, "p0", "vortox", { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
    const soldier = patchPlayer(proofGame(ROLES), "p1", { actualRole: "soldier", shownRole: "soldier" });
    expect(plan(soldier, request(soldier, "p0", "vortox", { target: pick(soldier, "p1") }))).toEqual({ ok: true, changed: false });
  });

  it("the Fool survives the first death and its ability is used up; the next kill takes it", () => {
    const g = proofGame(ROLES);
    const first = planned(attack(g, "p6"));
    expect(first.players.p6).toMatchObject({ alive: true, abilityUsed: true });
    const later = { ...first, day: first.day + 1 };
    expect(planned(attack(later, "p6")).players.p6!.alive).toBe(false);
  });

  it.each(["drunk", "poisoned"])("a %s Vortox chooses and nobody dies", (type) => {
    const g = impair(proofGame(ROLES), "p0", type);
    expect(plan(g, request(g, "p0", "vortox", { target: pick(g, "p1") }))).toEqual({ ok: true, changed: false });
  });

  it("a Pit-Hag's arbitrary deaths tonight: the Vortox's kill is the Storyteller's, by hand, exactly as for the Imp; nothing is forced", () => {
    // The old Demon is dead (two living Demons are outside verified death rules), so the Pit-Hag's new Demon is the only one.
    const hag = patchPlayer(proofGame(["pithag", "imp", "clockmaker", "monk", "mutant", "sage"]), "p1", { alive: false });
    const made = planned(plan(hag, request(hag, "p0", "pithag", { target: pick(hag, "p2"), character: { kind: "character", roleIds: ["vortox"] } })));
    expect(made.players.p2).toMatchObject({ actualRole: "vortox" });
    expect(made.gameRuleFacts.map((f) => f.type)).toEqual(["pitHagArbitraryDeaths"]);
    const before = JSON.stringify(made);
    expect(plan(made, request(made, "p2", "vortox", { target: pick(made, "p3") }))).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/arbitrary/) });
    expect(JSON.stringify(made)).toBe(before);
  });

  it("the Vortox choosing itself dies (there is no star-pass); a Scarlet Woman who might take over keeps the action by hand", () => {
    const self = planned(attack(proofGame(ROLES), "p0"));
    expect(self.players.p0!.alive).toBe(false);
    const sw = patchPlayer(proofGame(ROLES), "p5", { actualRole: "scarletwoman", shownRole: "scarletwoman" });
    expect(attack(sw, "p0")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("does not act on Night 1; a homebrew character reusing the id inherits nothing", () => {
    const first = proofGame(ROLES, "night", 1);
    expect(plan(first, request(first, "p0", "vortox", { target: pick(first, "p1") }))).toMatchObject({ ok: false, code: "notApplicable" });
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "vortox", { target: pick(g, "p1") }), homebrewEnv("vortox"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the preflight agrees: the wake is automated; it is not information, so no false-answer rule applies to it", () => {
    const g = proofGame(ROLES);
    const query = createRulesQuery(g, proofEnv());
    expect(automationEligibility({ query, descriptor: VORTOX, actor: bind(g, "p0"), roleId: "vortox" }).kind).toBe("automated");
  });

  it("the Night order: a Vortox row on Night 2 (not Night 1)", () => {
    const rows = (g: StorytellerLobbyRecord) => computeNightOrder(g.players, g.seatOrder, proofEnv().script!, g.day === 1).filter((s) => s.kind === "player" && s.effectiveRoleId === "vortox");
    expect(rows(proofGame(ROLES, "night", 2))).toHaveLength(1);
    expect(rows(proofGame(ROLES, "night", 1))).toHaveLength(0);
  });
});

describe("SV-5k: with the other Sects & Violets characters", () => {
  it("Sage: killed by the Vortox, the Sage's step needs no question, and the pair must be false (neither may be the Vortox)", () => {
    const next = planned(attack(proofGame(ROLES), "p3"));
    expect(nightTriggerStatus(SAGE, bind(next, "p3"), proofQuery(next))).toMatchObject({ kind: "triggered" });
    const sage = (a: string, b: string) => plan(next, request(next, "p3", "sage", { [SAGE_PLAYERS]: pick(next, a, b) }, { invocationPath: "nightTrigger", withStep: true, completeStep: true }));
    expect(sage("p0", "p1")).toMatchObject({ ok: false, code: "illegal" });
    expect(sage("p1", "p2")).toMatchObject({ ok: true, changed: true });
  });

  it("Mutant: an ordinary death, nothing more", () => {
    const next = planned(attack(proofGame(ROLES), "p4"));
    expect(next.players.p4!.alive).toBe(false);
  });
});

describe("SV-5k: one commit, Undo and reload", () => {
  it("one commit; Undo restores the death, the token and the step together; the saved game reloads", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "vortox", { target: pick(g, "p1") }, { withStep: true, completeStep: true }))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);
    store.getState().undo();
    expect(game().players.p1!.alive).toBe(true);
    expect(deadTokens(game(), "p1")).toHaveLength(0);
    expect(step(game(), "p0")).toBeUndefined();
  });
});
