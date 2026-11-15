// SV-1d -- Barber: "If you died today or tonight, the Demon may choose 2 players (not another Demon) to swap characters."
// https://wiki.bloodontheclocktower.com/Barber -- production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { BARBER, BARBER_DEMON, BARBER_NOBODY, BARBER_PLAYERS, barberRegistersAsDemonId, haircutsTonight } from "./barber";
import { nightTriggerStatus } from "@/abilities/invocation";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request, requirementIds } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { nightTriggerStepKey, participantStepKey } from "@/stores/nightProgress";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { computeNightOrder } from "@/rules/night/nightOrder";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// p0 barber, p1 imp, p2 clockmaker, p3 dreamer, p4 witch, p5 mathematician
const ROLES = ["barber", "imp", "clockmaker", "dreamer", "witch", "mathematician"];
const game = () => store.getState().game!;
const pid = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.participantId!;
const none = { kind: "participant" as const, participants: [] };

/** Night 2: the Imp kills the Barber through the real coordinator. */
function nightDeath(g = proofGame(ROLES, "night", 2)): StorytellerLobbyRecord {
  return planned(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") })));
}
/** Day 2: the Barber is executed (the real life command). Leaves the game open in the store. */
function executed(g = proofGame(ROLES, "day", 2)): StorytellerLobbyRecord {
  openInStore(g);
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }).ok).toBe(true);
  store.setState({ undoStack: [] });
  return game();
}
const swap = (g: StorytellerLobbyRecord, ids: string[], extra: Record<string, unknown> = {}, env = undefined as ReturnType<typeof homebrewEnv> | undefined) =>
  plan(g, request(g, "p0", "barber", { [BARBER_PLAYERS]: ids.length ? pick(g, ...ids) : none, ...extra },
    { invocationPath: "nightTrigger", withStep: true, completeStep: true }), env);
const triggerOf = (g: StorytellerLobbyRecord) => nightTriggerStatus(BARBER, bind(g, "p0"), proofQuery(g));
const haircuts = (g: StorytellerLobbyRecord) => haircutsTonight(proofQuery(g), bind(g, "p0"));
const roles = (g: StorytellerLobbyRecord) => g.seatOrder.map((id) => g.players[id]!.actualRole);
const order = (g: StorytellerLobbyRecord) => computeNightOrder(g.players, g.seatOrder, proofScript, false, g)
  .flatMap((s) => s.kind === "player" ? [`${s.playerId}:${s.effectiveRoleId}`] : []);

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("Barber -- the Night step", () => {
  it("the Demon chooses two players: their characters swap, alignments stay, each is told their new character, and the step closes", () => {
    const g = nightDeath();
    expect(triggerOf(g)).toMatchObject({ kind: "triggered" });
    expect(haircuts(g)).toBe(true);
    const used = patchPlayer(g, "p3", { abilityUsed: true });
    const next = planned(swap(used, ["p2", "p3"]));
    expect(roles(next)).toEqual(["barber", "imp", "dreamer", "clockmaker", "witch", "mathematician"]);
    for (const id of ["p2", "p3"]) {
      expect(next.players[id]!.shownRole).toBe(next.players[id]!.actualRole);
      expect(next.players[id]!.actualAlignment).toBe(g.players[id]!.actualAlignment);
    }
    // "they gain the new ability, even if ... a 'once per game' ability that the original character already used"
    expect(next.players.p3!.abilityUsed).toBe(false);
    const eventId = (triggerOf(g) as { eventId: string }).eventId;
    expect(next.nightProgress[`2:${nightTriggerStepKey(pid(g, "p0"), "barber", eventId)}`]?.status).toBe("done");
    expect(triggerOf(next)).toMatchObject({ kind: "notTriggered" });
    // The HAIRCUTS TONIGHT token goes once the Demon has chosen.
    expect(haircuts(next)).toBe(false);
  });

  it("the Demon chooses nobody: nothing changes, the step closes and the token goes", () => {
    const g = nightDeath();
    const next = planned(swap(g, []));
    expect(next.players).toEqual(g.players);
    expect(triggerOf(next)).toMatchObject({ kind: "notTriggered" });
    expect(haircuts(next)).toBe(false);
    expect(BARBER.inputs[0]).toMatchObject({ allowNone: true, noneLabel: BARBER_NOBODY, count: 2 });
    expect(BARBER_NOBODY).toBe("The Demon chooses nobody");
    expect(BARBER.presentation?.action).toBe("The Demon may choose 2 players to swap characters");
  });

  it("dead players may be chosen, and the Demon may choose itself: a good player who becomes the Demon stays good", () => {
    const deadDreamer = nightDeath(patchPlayer(proofGame(ROLES, "night", 2), "p3", { alive: false }));
    expect(roles(planned(swap(deadDreamer, ["p3", "p5"])))).toEqual(["barber", "imp", "clockmaker", "mathematician", "witch", "dreamer"]);
    const deadBarber = planned(swap(nightDeath(), ["p0", "p2"]));
    expect(roles(deadBarber).slice(0, 3)).toEqual(["clockmaker", "imp", "barber"]);
    const next = planned(swap(nightDeath(), ["p1", "p2"]));
    expect(next.players.p2).toMatchObject({ actualRole: "imp", shownRole: "imp", actualAlignment: "good", shownAlignment: "good" });
    expect(next.players.p1).toMatchObject({ actualRole: "clockmaker", shownRole: "clockmaker", actualAlignment: "evil", shownAlignment: "evil" });
  });

  it("only two players, and never another Demon", () => {
    const g = nightDeath();
    expect(swap(g, ["p2"])).toMatchObject({ ok: false, code: "invalid" });
    // A dead Demon is still another Demon.
    const two = patchPlayer(nightDeath(), "p5", { actualRole: "vortox", shownRole: "vortox", actualAlignment: "evil", alive: false });
    expect(swap(two, ["p5", "p2"])).toMatchObject({ ok: false, code: "illegal", message: "The Demon may not choose another Demon." });
  });

  it("a Recluse (who might register as a Demon): the Storyteller's ruling; Yes refuses the pair, No swaps; a sober Spy is never asked", () => {
    const g = patchPlayer(nightDeath(), "p4", { actualRole: "recluse", shownRole: "recluse", actualAlignment: "good" });
    const id = barberRegistersAsDemonId(pid(g, "p4"));
    expect(requirementIds(swap(g, ["p4", "p2"]))).toEqual([id]);
    expect(swap(g, ["p4", "p2"], { [id]: { kind: "boolean", value: true } })).toMatchObject({ ok: false, code: "illegal", message: "The Demon may not choose another Demon." });
    expect(roles(planned(swap(g, ["p4", "p2"], { [id]: { kind: "boolean", value: false } }))).slice(2, 5)).toEqual(["recluse", "dreamer", "clockmaker"]);
    // A drunk Recluse registers truly: no ruling.
    expect(swap(impair(g, "p4", "drunk"), ["p4", "p2"])).toMatchObject({ ok: true, changed: true });
    const spy = patchPlayer(nightDeath(), "p4", { actualRole: "spy", shownRole: "spy", actualAlignment: "evil" });
    expect(swap(spy, ["p4", "p2"])).toMatchObject({ ok: true, changed: true });
  });

  it("more than one living Demon: the Storyteller chooses which Demon makes the swap", () => {
    const g = patchPlayer(nightDeath(), "p5", { actualRole: "vortox", shownRole: "vortox", actualAlignment: "evil" });
    expect(requirementIds(swap(g, ["p2", "p3"]))).toEqual([BARBER_DEMON]);
    // The Vortox makes the swap: it may choose itself, not the Imp.
    expect(swap(g, ["p5", "p2"], { [BARBER_DEMON]: pick(g, "p5") })).toMatchObject({ ok: true, changed: true });
    expect(swap(g, ["p1", "p2"], { [BARBER_DEMON]: pick(g, "p5") })).toMatchObject({ ok: false, code: "illegal", message: "The Demon may not choose another Demon." });
    expect(swap(g, ["p2", "p3"], { [BARBER_DEMON]: pick(g, "p2") })).toMatchObject({ ok: false, code: "illegal" });
  });

  it("drunk or poisoned: the token is still drawn, no swap happens, and the step closes with nobody", () => {
    for (const type of ["drunk", "poisoned"]) {
      const g = impair(nightDeath(), "p0", type);
      expect(haircuts(g)).toBe(true);
      expect(swap(g, ["p2", "p3"])).toMatchObject({ ok: false, code: "illegal", message: expect.stringContaining("no swap happens") });
      const next = planned(swap(g, []));
      expect(next.players).toEqual(g.players);
      expect(triggerOf(next)).toMatchObject({ kind: "notTriggered" });
    }
  });

  it("no living Demon: no swap, and the step closes with nobody", () => {
    const g = nightDeath();
    const noDemon = patchPlayer(g, "p1", { alive: false });
    expect(swap(noDemon, ["p2", "p3"])).toMatchObject({ ok: false, code: "illegal", message: expect.stringContaining("no living Demon") });
    expect(triggerOf(planned(swap(noDemon, [])))).toMatchObject({ kind: "notTriggered" });
  });

  it("a Traveller, a concealed identity or an unofficial character: swapped by hand", () => {
    const g = nightDeath();
    expect(swap(patchPlayer(g, "p5", { isTraveler: true }), ["p5", "p2"])).toMatchObject({ ok: false, code: "unsupported" });
    expect(swap(patchPlayer(g, "p5", { actualRole: "drunk", shownRole: "mathematician" }), ["p5", "p2"])).toMatchObject({ ok: false, code: "unsupported" });
    expect(swap(g, ["p5", "p2"], {}, homebrewEnv("mathematician"))).toMatchObject({ ok: false });
  });

  it("a player who died and then became the Barber: no token and no step", () => {
    const base = proofGame(ROLES, "night", 2);
    const event = { id: "d-chef", kind: "death", moment: { phase: "night", day: 2 }, actualRoleAtEvent: "chef",
      subject: { kind: "participant", playerId: "p0", participantId: pid(base, "p0"), nameAtTime: "Player 0" } } as LifeEvent;
    const g = { ...patchPlayer(base, "p0", { alive: false }), lifeEventWindow: { coverageFrom: { phase: "night" as const, day: 1 }, events: [event] } };
    expect(triggerOf(g)).toMatchObject({ kind: "notTriggered" });
    expect(haircuts(g)).toBe(false);
    expect(swap(g, ["p2", "p3"])).toMatchObject({ ok: false });
  });

  it("a living Barber has no step and no token", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(triggerOf(g)).toMatchObject({ kind: "notTriggered" });
    expect(haircuts(g)).toBe(false);
    expect(swap(g, ["p2", "p3"])).toMatchObject({ ok: false });
  });
});

describe("Barber -- what happens after the swap tonight", () => {
  it("a living player who becomes the Clockmaker (\"you start knowing\") gets its first-night step right after the Barber's", () => {
    const g = nightDeath();
    expect(order(g)).not.toContain("p3:clockmaker");
    const next = planned(swap(g, ["p2", "p3"]));
    expect(next.nightProgress[`2:${participantStepKey(pid(g, "p3"), "clockmaker")}`]?.status).toBe("pending");
    const steps = computeNightOrder(next.players, next.seatOrder, proofScript, false, next);
    const barberAt = steps.findIndex((s) => s.kind === "player" && s.effectiveRoleId === "barber");
    const clock = steps.findIndex((s) => s.kind === "player" && s.effectiveRoleId === "clockmaker");
    expect(barberAt).toBeGreaterThanOrEqual(0);
    expect(clock).toBe(barberAt + 1);
    expect(steps[clock]).toMatchObject({ playerId: "p3", prompt: proofRegistry.get("clockmaker")!.firstNightPrompt });
    // Only tonight: the next Night lists no Clockmaker.
    const later = { ...next, day: 3 };
    expect(computeNightOrder(later.players, later.seatOrder, proofScript, false, later).some((s) => s.kind === "player" && s.effectiveRoleId === "clockmaker")).toBe(false);
  });

  it("a dead player who becomes the Clockmaker gets no step", () => {
    const g = nightDeath(patchPlayer(proofGame(ROLES, "night", 2), "p3", { alive: false }));
    const next = planned(swap(g, ["p2", "p3"]));
    expect(next.nightProgress[`2:${participantStepKey(pid(g, "p3"), "clockmaker")}`]).toBeUndefined();
    expect(order(next)).not.toContain("p3:clockmaker");
  });

  it("a character whose place tonight has passed (the Demon, the Witch) is marked skipped; a later one wakes as usual", () => {
    const next = planned(swap(nightDeath(), ["p1", "p4"]));
    expect(next.nightProgress[`2:${participantStepKey(pid(next, "p4"), "imp")}`]?.status).toBe("skipped");
    expect(next.nightProgress[`2:${participantStepKey(pid(next, "p1"), "witch")}`]?.status).toBe("skipped");
    const later = planned(swap(nightDeath(), ["p3", "p5"]));
    expect(later.nightProgress[`2:${participantStepKey(pid(later, "p5"), "dreamer")}`]).toBeUndefined();
    expect(order(later)).toContain("p5:dreamer");
  });
});

describe("Barber -- with the other SV-1 characters", () => {
  it("a dead Sweetheart who is swapped loses her ability, so her DRUNK ends; Undo brings it back", () => {
    // p5 is a Sweetheart who died earlier and made the Clockmaker (p2) drunk.
    const base = patchPlayer(proofGame(ROLES, "night", 2), "p5", { actualRole: "sweetheart", shownRole: "sweetheart", alive: false });
    const drunk = { id: "sw-drunk", type: "drunk", sourceCharacter: "sweetheart", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" },
      appliedAt: { phase: "night", day: 1 }, sourceParticipant: { kind: "participant", playerId: "p5", participantId: pid(base, "p5"), nameAtTime: "Player 5" } };
    const g = nightDeath(patchPlayer(base, "p2", { effects: [drunk as never] }));
    expect(proofQuery(g).abilityFunctions(bind(g, "p2"))).toEqual({ known: true, value: false });
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "barber", { [BARBER_PLAYERS]: pick(g, "p5", "p3") },
      { invocationPath: "nightTrigger", withStep: true, completeStep: true }))).toMatchObject({ ok: true, changed: true });
    expect(game().players.p5!.actualRole).toBe("dreamer");
    expect(game().players.p2!.effects).toEqual([]);
    expect(proofQuery(game()).abilityFunctions(bind(g, "p2"))).toEqual({ known: true, value: true });
    store.getState().undo();
    expect(game().players.p2!.effects).toEqual(g.players.p2!.effects);
  });
});

describe("Barber -- a Day death", () => {
  it("the token is drawn from the Day death, the Night step asks, and both end when the Demon has chosen", () => {
    executed();
    expect(haircuts(game())).toBe(true);
    store.getState().setPhase("night");
    const night = game();
    expect(night.day).toBe(3);
    expect(triggerOf(night)).toMatchObject({ kind: "triggered" });
    expect(haircuts(night)).toBe(true);
    const next = planned(swap(night, ["p2", "p3"]));
    expect(haircuts(next)).toBe(false);
  });

  it("an earlier Day's death draws nothing", () => {
    const g = executed();
    expect(haircuts({ ...g, day: 3 })).toBe(false);
  });
});

describe("Barber -- one commit, Undo, and what the phones see", () => {
  it("one commit; Undo restores both characters, both views and the step together", () => {
    const g = nightDeath();
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "barber", { [BARBER_PLAYERS]: pick(g, "p2", "p3") },
      { invocationPath: "nightTrigger", withStep: true, completeStep: true }))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(roles(game())).toEqual(["barber", "imp", "dreamer", "clockmaker", "witch", "mathematician"]);
    store.getState().undo();
    // By design a changed visible identity always gets a fresh reveal token, Undo included (revealTokens.ts): everything else is restored.
    const without = (x: StorytellerLobbyRecord) => Object.fromEntries(Object.entries(x.players).map(([id, p]) => [id, { ...p, revealToken: null }]));
    expect(without(game())).toEqual(without(g));
    expect(game().nightProgress).toEqual(g.nightProgress);
    expect(haircuts(game())).toBe(true);
  });

  it("only the two swapped players' own views change, each to their new character and unchanged alignment; the public view does not change", () => {
    const g = nightDeath();
    const next = planned(swap(g, ["p1", "p2"]));
    const before = projectLobbyToSelfMap(g, proofRegistry), after = projectLobbyToSelfMap(next, proofRegistry);
    for (const id of ["p0", "p3", "p4", "p5"]) expect(after[id]).toEqual(before[id]);
    expect(after.p1).toMatchObject({ shownRole: "clockmaker", shownAlignment: "evil" });
    expect(after.p2).toMatchObject({ shownRole: "imp", shownAlignment: "good" });
    expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
    expect(JSON.stringify(projectLobbyToPublic(next, {}))).not.toMatch(/clockmaker|imp"|dreamer/);
  });
});

describe("Barber -- PO review 2026-11-14 evidence (E1, E2)", () => {
  it("E1: the step opens on the night of the death after every guided Demon kill (Imp, Vigormortis, No Dashii); a Day death is covered in barberUi.v6.test.tsx", () => {
    for (const demon of ["imp", "vigormortis", "nodashii"]) {
      const g0 = proofGame(["barber", demon, "clockmaker", "dreamer", "witch", "mathematician"], "night", 2);
      const g = planned(plan(g0, request(g0, "p1", demon, { target: pick(g0, "p0") })));
      expect(triggerOf(g).kind, demon).toBe("triggered");
      expect(haircuts(g), demon).toBe(true);
      expect(swap(g, ["p2", "p3"]), demon).toMatchObject({ ok: true, changed: true });
      // Not the next night.
      expect(triggerOf({ ...g, day: 3 }).kind, demon).toBe("notTriggered");
    }
  });

  it("E2: a living player swapped into the Clockmaker on Night 3 is listed right after the Barber that night, and not on Night 4", () => {
    const g = nightDeath(proofGame(ROLES, "night", 3));
    const next = planned(swap(g, ["p2", "p3"]));
    const listed = order(next);
    expect(listed.indexOf("p3:clockmaker")).toBe(listed.indexOf("p0:barber") + 1);
    expect(order({ ...next, day: 4 })).not.toContain("p3:clockmaker");
  });
});
