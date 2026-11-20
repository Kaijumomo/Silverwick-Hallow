// SV-1b -- Sweetheart: "When you die, 1 player is drunk from now on." https://wiki.bloodontheclocktower.com/Sweetheart
// Production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { SWEETHEART, SWEETHEART_PLAYER, sweetheartOpenDayDeath } from "./sweetheart";
import { nightTriggerStatus } from "@/abilities/invocation";
import { bind, impair, openInStore, patchPlayer, plan, planned, proofGame, proofQuery, proofRegistry, request } from "@/test/proofFixtures";
import { projectLobbyToPublic, projectLobbyToSelfEnvelopeMap } from "@/stores/projections";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { nightTriggerStepKey } from "@/stores/nightProgress";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import { officialEffectPresentation } from "@/features/reminders/officialReminderPresentation";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 sweetheart, p1 imp, p2 chef, p3 monk, p4 empath, p5 poisoner
const ROLES = ["sweetheart", "imp", "chef", "monk", "empath", "poisoner"];
const one = (g: StorytellerLobbyRecord, id?: string) => ({ kind: "participant" as const, participants: id ? [bind(g, id)] : [] });
const game = () => store.getState().game!;

/** Night 2: the Imp kills the Sweetheart through the real coordinator. */
function nightDeath(g = proofGame(ROLES, "night", 2)): StorytellerLobbyRecord {
  return planned(plan(g, request(g, "p1", "imp", { target: one(g, "p0") })));
}
/** Day 2: the Sweetheart is executed (the real life command). Leaves the game open in the store. */
function executed(g = proofGame(ROLES, "day", 2)): StorytellerLobbyRecord {
  openInStore(g);
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }).ok).toBe(true);
  store.setState({ undoStack: [] });
  return game();
}
const atNight = (g: StorytellerLobbyRecord, id = "p2") =>
  plan(g, request(g, "p0", "sweetheart", { [SWEETHEART_PLAYER]: one(g, id) }, { invocationPath: "nightTrigger", withStep: true, completeStep: true }));
const inDay = (g: StorytellerLobbyRecord, id?: string) =>
  plan(g, request(g, "p0", "sweetheart", { [SWEETHEART_PLAYER]: one(g, id) }, { invocationPath: "dayEntry" }));
const drunkOf = (g: StorytellerLobbyRecord, id = "p2") => g.players[id]!.effects.find((e) => e.type === "drunk" && e.sourceCharacter === "sweetheart");
const functions = (g: StorytellerLobbyRecord, id = "p2") => proofQuery(g).abilityFunctions(bind(g, id));
const triggerOf = (g: StorytellerLobbyRecord) => nightTriggerStatus(SWEETHEART, bind(g, "p0"), proofQuery(g));

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("Sweetheart -- the Night step", () => {
  it("she dies tonight: the Storyteller's player is really drunk from now on, with the official DRUNK token", () => {
    const g = nightDeath();
    expect(triggerOf(g)).toMatchObject({ kind: "triggered" });
    const next = planned(atNight(g));
    expect(drunkOf(next)).toMatchObject({ type: "drunk", sourceCharacter: "sweetheart", lifetime: { kind: "manual" },
      sourceParticipant: { kind: "participant", playerId: "p0", participantId: g.players.p0!.participantId } });
    expect(functions(next)).toEqual({ known: true, value: false });
    expect(next.nightProgress[`2:${nightTriggerStepKey(g.players.p0!.participantId!, "sweetheart", triggerOf(g).kind === "triggered" ? (triggerOf(g) as { eventId: string }).eventId : "")}`]?.status).toBe("done");
    expect(triggerOf(next)).toMatchObject({ kind: "notTriggered" });
    const tokens = officialEffectPresentation(next.players.p2!, { query: proofQuery(next), target: bind(next, "p2") }).tokens;
    expect(tokens.map((t) => [t.role.id, t.label])).toEqual([["sweetheart", "Drunk"]]);
  });

  it("any player may be chosen, alive or dead, of either team", () => {
    for (const id of ["p1", "p3", "p5"]) expect(atNight(nightDeath(), id)).toMatchObject({ ok: true, changed: true });
    const deadChef = nightDeath(patchPlayer(proofGame(ROLES, "night", 2), "p2", { alive: false }));
    expect(atNight(deadChef, "p2")).toMatchObject({ ok: true, changed: true });
  });

  it("nobody is refused while she has her ability; herself is the Storyteller's ruling", () => {
    const g = nightDeath();
    expect(plan(g, request(g, "p0", "sweetheart", { [SWEETHEART_PLAYER]: one(g) }, { invocationPath: "nightTrigger", withStep: true })))
      .toMatchObject({ ok: false, code: "illegal", message: "Choose the player who becomes drunk." });
    expect(atNight(g, "p0")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("drunk or poisoned when the step runs: nobody becomes drunk, and the step closes", () => {
    for (const type of ["drunk", "poisoned"]) {
      const g = impair(nightDeath(), "p0", type);
      const next = planned(atNight(g));
      expect(drunkOf(next)).toBeUndefined();
      expect(next.players).toEqual(g.players);
      expect(triggerOf(next)).toMatchObject({ kind: "notTriggered" });
      expect(planned(plan(g, request(g, "p0", "sweetheart", { [SWEETHEART_PLAYER]: one(g) }, { invocationPath: "nightTrigger", withStep: true, completeStep: true }))).players).toEqual(g.players);
    }
  });

  it("a living Sweetheart has no step; the ordinary Night Order never runs her", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(triggerOf(g)).toMatchObject({ kind: "notTriggered" });
    const dead = nightDeath();
    expect(plan(dead, request(dead, "p0", "sweetheart", { [SWEETHEART_PLAYER]: one(dead, "p2") }, { invocationPath: "nightOrder" }))).toMatchObject({ ok: false });
  });
});

describe("Sweetheart -- privacy", () => {
  it("her DRUNK reaches no player's view (the drunk player included) and not the public view", () => {
    const g = nightDeath();
    const next = planned(atNight(g));
    expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
    const before = projectLobbyToSelfEnvelopeMap(g, proofRegistry), after = projectLobbyToSelfEnvelopeMap(next, proofRegistry);
    for (const id of g.seatOrder) expect(after[id], id).toEqual(before[id]);
  });
});

describe("Sweetheart -- the lasting drunkenness", () => {
  it("works while she is dead, pauses while she is drunk or poisoned, and resumes after", () => {
    const g = planned(atNight(nightDeath()));
    expect(functions(g)).toEqual({ known: true, value: false });
    const poisoned = impair(g, "p0");
    expect(functions(poisoned)).toEqual({ known: true, value: true });
    const sober = patchPlayer(poisoned, "p0", { effects: g.players.p0!.effects });
    expect(functions(sober)).toEqual({ known: true, value: false });
  });

  it("ends when she changes character: the stored Effect is removed with the change, and Undo restores both", () => {
    const g = planned(atNight(nightDeath()));
    openInStore(g);
    const sweetheart = game().players.p0!;
    expect(store.getState().resolveRoles({ intents: toldRoleChangeIntents(sweetheart, "chef") })).toMatchObject({ ok: true, changed: true });
    expect(drunkOf(game())).toBeUndefined();
    expect(functions(game())).toEqual({ known: true, value: true });
    store.getState().undo();
    expect(game().players.p0!.actualRole).toBe("sweetheart");
    expect(game().players.p2!.effects).toEqual(g.players.p2!.effects);
    expect(functions(game())).toEqual({ known: true, value: false });
    // Derived as well: a changed character makes the Effect stop applying even before anything is removed.
    expect(functions(patchPlayer(g, "p0", { actualRole: "chef" }))).toEqual({ known: true, value: true });
  });

  it("a resurrection does not end it (it is not a change of character)", () => {
    const g = planned(atNight(nightDeath()));
    openInStore(g);
    expect(store.getState().resolveLife({ intents: [{ kind: "resurrection", playerId: "p0" }] }).ok).toBe(true);
    expect(drunkOf(game())).toBeDefined();
  });

  it("removing the DRUNK token by hand removes the drunkenness", () => {
    const g = planned(atNight(nightDeath()));
    openInStore(g);
    expect(store.getState().resolveEffects({ intents: [{ kind: "remove", target: bind(g, "p2"), effectId: drunkOf(g)!.id }] })).toMatchObject({ ok: true });
    expect(functions(game())).toEqual({ known: true, value: true });
  });
});

describe("Sweetheart -- a Day death", () => {
  it("the Day action makes the player drunk at once and closes the next Night's step", () => {
    const g = executed();
    const event = sweetheartOpenDayDeath(proofQuery(g), bind(g, "p0"));
    expect(event).not.toBeNull();
    expect(store.getState().resolveAbility(request(g, "p0", "sweetheart", { [SWEETHEART_PLAYER]: one(g, "p2") }, { invocationPath: "dayEntry" })))
      .toMatchObject({ ok: true, changed: true });
    expect(drunkOf(game())).toBeDefined();
    expect(game().nightProgress[`3:${nightTriggerStepKey(g.players.p0!.participantId!, "sweetheart", event!.id)}`]?.status).toBe("done");
    expect(sweetheartOpenDayDeath(proofQuery(game()), bind(g, "p0"))).toBeNull();
    expect(inDay(game(), "p3")).toMatchObject({ ok: false, code: "notApplicable" });
    store.getState().setPhase("night");
    expect(triggerOf(game())).toMatchObject({ kind: "notTriggered" });
    store.setState({ undoStack: [] });
  });

  it("not done by nightfall: her Night step asks, as the night sheet says", () => {
    executed();
    store.getState().setPhase("night");
    const night = game();
    expect(night.day).toBe(3);
    expect(triggerOf(night)).toMatchObject({ kind: "triggered" });
    expect(drunkOf(planned(atNight(night)))).toBeDefined();
  });

  it("Undo of the Day action brings the row back", () => {
    const g = executed();
    expect(store.getState().resolveAbility(request(g, "p0", "sweetheart", { [SWEETHEART_PLAYER]: one(g, "p2") }, { invocationPath: "dayEntry" }))).toMatchObject({ ok: true });
    store.getState().undo();
    expect(game()).toEqual(g);
    expect(sweetheartOpenDayDeath(proofQuery(game()), bind(g, "p0"))).not.toBeNull();
  });

  it("drunk or poisoned when she dies in the Day: the Day action records that nobody becomes drunk", () => {
    const g = executed(impair(proofGame(ROLES, "day", 2), "p0"));
    const next = planned(inDay(g));
    expect(Object.values(next.players).some((p) => p.effects.some((e) => e.sourceCharacter === "sweetheart"))).toBe(false);
    expect(sweetheartOpenDayDeath(proofQuery(next), bind(g, "p0"))).toBeNull();
  });

  it("a living Sweetheart, or a previous Day's death, has no Day action", () => {
    expect(inDay(proofGame(ROLES, "day", 2), "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    const g = executed(proofGame(ROLES, "day", 2));
    const later = { ...g, day: 3 };
    expect(sweetheartOpenDayDeath(proofQuery(later), bind(g, "p0"))).toBeNull();
  });
});
