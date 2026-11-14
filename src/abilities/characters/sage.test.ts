// SV-1a -- Sage: "If the Demon kills you, you learn that it is 1 of 2 players." https://wiki.bloodontheclocktower.com/Sage
// Production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { SAGE, SAGE_PLAYERS, sageCauseId, sageCauseQuestion } from "./sage";
import { nightTriggerStatus } from "@/abilities/invocation";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, impair, openInStore, patchPlayer, plan, planned, proofEnv, proofGame, proofQuery, request, requirementIds, yes } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { PIT_HAG_ARBITRARY_DEATHS } from "@/stores/gameRuleFacts";
import type { AbilityInputs } from "@/abilities/semantics";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// p0 sage, p1 imp, p2 chef, p3 saint, p4 monk, p5 poisoner, p6 empath
const ROLES = ["sage", "imp", "chef", "saint", "monk", "poisoner", "empath"];
const players = (g: StorytellerLobbyRecord, ...ids: string[]) =>
  ({ kind: "participant" as const, participants: ids.map((id) => bind(g, id)) });

/** Night 2: the Imp kills the Sage through the real coordinator (the guided kill records its cause). */
function demonKill(roles = ROLES, killer = "p1"): StorytellerLobbyRecord {
  const g = proofGame(roles, "night", 2);
  return planned(plan(g, request(g, killer, "imp", { target: { kind: "participant", participants: [bind(g, "p0")] } })));
}
/** A death the Storyteller entered by hand (the life command, no recorded cause). */
function handDeath(g: StorytellerLobbyRecord, id = "p0"): StorytellerLobbyRecord {
  openInStore(g);
  expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: id }] }).ok).toBe(true);
  const next = store.getState().game!;
  store.setState({ game: null, undoStack: [] });
  return next;
}
/** A recorded death with an explicit cause (to state a non-Demon kill the app does not guide yet). */
function recordedDeath(g: StorytellerLobbyRecord, id: string, sourceCharacter: string, phase: "night" | "day" = "night", day = g.day): StorytellerLobbyRecord {
  const p = g.players[id]!;
  const event = { id: `le-${id}-${phase}${day}`, kind: "death", moment: { phase, day }, actualRoleAtEvent: p.actualRole,
    subject: { kind: "participant", participantId: p.participantId!, playerId: id, nameAtTime: p.name },
    provenance: { sourceCharacter, sourceParticipant: { kind: "participant", participantId: g.players.p5!.participantId!, playerId: "p5", nameAtTime: "x" } } } as LifeEvent;
  return { ...patchPlayer(g, id, { alive: false }), lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [event] } };
}
const sage = (g: StorytellerLobbyRecord, inputs: AbilityInputs = {}) =>
  plan(g, request(g, "p0", "sage", inputs, { invocationPath: "nightTrigger", withStep: true, completeStep: true }));
const status = (g: StorytellerLobbyRecord) => nightTriggerStatus(SAGE, bind(g, "p0"), proofQuery(g));
const eventOf = (g: StorytellerLobbyRecord) => g.lifeEventWindow!.events.find((e) => e.kind === "death" && e.subject.kind === "participant" && e.subject.playerId === "p0")!;
const arbitraryNight = (g: StorytellerLobbyRecord): StorytellerLobbyRecord =>
  ({ ...g, gameRuleFacts: [{ type: PIT_HAG_ARBITRARY_DEATHS, recordedAt: { phase: "night", day: g.day }, expiresAt: { phase: "day", day: g.day } }] });

describe("Sage -- the guided Demon kill records its cause", () => {
  it("the Imp's guided kill stores the Imp and its player on the death", () => {
    const g = demonKill();
    expect(g.players.p0!.alive).toBe(false);
    expect(eventOf(g).provenance).toMatchObject({ sourceCharacter: "imp", sourceParticipant: { kind: "participant", playerId: "p1", participantId: g.players.p1!.participantId } });
  });

  it("a death entered by hand records no cause", () => {
    expect(eventOf(handDeath(proofGame(ROLES, "night", 2))).provenance?.sourceCharacter).toBeUndefined();
  });
});

describe("Sage -- the trigger", () => {
  it("killed by the Demon tonight: the step opens; one of the two must be the killer", () => {
    const g = demonKill();
    expect(status(g)).toMatchObject({ kind: "triggered" });
    expect(sage(g, { [SAGE_PLAYERS]: players(g, "p2", "p3") })).toMatchObject({ ok: false, code: "illegal", message: "One of the two must be the Demon that killed the Sage." });
    expect(sage(g, { [SAGE_PLAYERS]: players(g, "p2") })).toMatchObject({ ok: false });
    const next = planned(sage(g, { [SAGE_PLAYERS]: players(g, "p2", "p1") }));
    expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "sage", informationActionId: "sage-triggered",
      values: [{ requirementId: SAGE_PLAYERS, kind: "player", participants: [expect.objectContaining({ participantId: g.players.p2!.participantId }), expect.objectContaining({ participantId: g.players.p1!.participantId })] }] });
    expect(next.nightProgress[`2:${participantStepKey(g.players.p0!.participantId!, "sage")}`]?.status).toBe("done");
    // Information only: no player, Effect or life state changes.
    expect(next.players).toEqual(g.players);
  });

  it("the Sage may be shown themself (any two players; one is the Demon)", () => {
    const g = demonKill();
    expect(sage(g, { [SAGE_PLAYERS]: players(g, "p0", "p1") })).toMatchObject({ ok: true, changed: true });
  });

  it("a death caused by another character does not open the step", () => {
    const g = recordedDeath(proofGame(ROLES, "night", 2), "p0", "assassin");
    expect(status(g)).toMatchObject({ kind: "notTriggered" });
    expect(sage(g, { [SAGE_PLAYERS]: players(g, "p1", "p2") })).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("an execution, a Day death or a previous Night's death does not open the step", () => {
    const day = recordedDeath(proofGame(ROLES, "night", 3), "p0", "imp", "day", 2);
    const old = recordedDeath(proofGame(ROLES, "night", 3), "p0", "imp", "night", 2);
    for (const g of [day, old]) {
      expect(status(g)).toMatchObject({ kind: "notTriggered" });
      expect(sage(g, { [SAGE_PLAYERS]: players(g, "p1", "p2") })).toMatchObject({ ok: false, code: "notApplicable" });
    }
    const alive = proofGame(ROLES, "night", 2);
    expect(status(alive)).toMatchObject({ kind: "notTriggered" });
  });

  it("the ordinary Night Order and Day entry never run it", () => {
    const g = demonKill();
    expect(plan(g, request(g, "p0", "sage", { [SAGE_PLAYERS]: players(g, "p1", "p2") }, { invocationPath: "nightOrder" }))).toMatchObject({ ok: false });
  });
});

describe("Sage -- a death with no recorded cause asks the Storyteller", () => {
  it("Yes: the Storyteller points at two players, one of whom can register as the Demon", () => {
    const g = handDeath(proofGame(ROLES, "night", 2));
    expect(status(g)).toMatchObject({ kind: "triggered" });
    const id = sageCauseId(eventOf(g).id);
    // The coordinator collects the declared pick first; the evaluator then asks the cause before checking the pair.
    expect(requirementIds(sage(g))).toEqual([SAGE_PLAYERS]);
    expect(requirementIds(sage(g, { [SAGE_PLAYERS]: players(g, "p2", "p1") }))).toEqual([id]);
    expect(sageCauseQuestion(proofQuery(g), bind(g, "p0"), eventOf(g).id)).toMatchObject({ id, heading: `Did the Demon kill ${g.players.p0!.name}?` });
    expect(sage(g, { [id]: yes(), [SAGE_PLAYERS]: players(g, "p2", "p4") })).toMatchObject({ ok: false, code: "illegal" });
    expect(sage(g, { [id]: yes(), [SAGE_PLAYERS]: players(g, "p2", "p1") })).toMatchObject({ ok: true, changed: true });
  });

  it("No: the step closes and the Sage learns nothing", () => {
    const g = handDeath(proofGame(ROLES, "night", 2));
    const id = sageCauseId(eventOf(g).id);
    const result = sage(g, { [id]: yes(false), [SAGE_PLAYERS]: { kind: "participant", participants: [] } });
    expect(result).toMatchObject({ ok: true });
    if (result.ok && result.changed) {
      expect(result.plan.game.informationDeliveries).toEqual(g.informationDeliveries);
      expect(result.plan.game.nightProgress[`2:${participantStepKey(g.players.p0!.participantId!, "sage")}`]?.status).toBe("done");
    }
  });

  it("nobody is refused once the Storyteller says the Demon killed the Sage", () => {
    const g = demonKill();
    expect(sage(g, { [SAGE_PLAYERS]: { kind: "participant", participants: [] } })).toMatchObject({ ok: false });
  });

  it("a Pit-Hag night of arbitrary deaths asks even when a Demon kill was recorded", () => {
    const g = arbitraryNight(demonKill());
    expect(status(g)).toMatchObject({ kind: "triggered" });
    const id = sageCauseId(eventOf(g).id);
    expect(requirementIds(sage(g, { [SAGE_PLAYERS]: players(g, "p2", "p1") }))).toEqual([id]);
    expect(sageCauseQuestion(proofQuery(g), bind(g, "p0"), eventOf(g).id)?.note).toBe("Deaths tonight are arbitrary. The Sage wakes only if the Demon killed them.");
    // Even a non-Demon cause asks on that night: the Storyteller decides who killed whom.
    const other = arbitraryNight(recordedDeath(proofGame(ROLES, "night", 2), "p0", "assassin"));
    expect(status(other)).toMatchObject({ kind: "triggered" });
  });
});

describe("Sage -- impairment and modifiers", () => {
  it("a drunk or poisoned Sage is shown any two players", () => {
    for (const type of ["drunk", "poisoned"]) {
      const g = impair(demonKill(), "p0", type);
      const next = planned(sage(g, { [SAGE_PLAYERS]: players(g, "p2", "p4") }));
      expect(next.informationDeliveries.at(-1)).toMatchObject({ informationActionId: "sage-triggered" });
    }
  });

  it("a living Vortox makes the whole step the Storyteller's (Manual)", () => {
    const g = handDeath(proofGame(["sage", "vortox", "chef", "monk", "empath"], "night", 2));
    const id = sageCauseId(eventOf(g).id);
    expect(sage(g, { [id]: yes(), [SAGE_PLAYERS]: players(g, "p1", "p2") })).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a Recluse in play: the jinx \"The Recluse might register as the Demon to the Sage\" keeps the step the Storyteller's", () => {
    const g = demonKill(["sage", "imp", "chef", "recluse", "monk"]);
    expect(proofQuery(g).modifierGate("sage", SAGE.hooks)).toMatchObject({ kind: "gated", modifiers: [expect.objectContaining({ id: "jinx:recluse+sage" })] });
    expect(sage(g, { [SAGE_PLAYERS]: players(g, "p1", "p2") })).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a homebrew Sage reusing the official id inherits no semantics", () => {
    const g = demonKill();
    expect(plan(g, request(g, "p0", "sage", { [SAGE_PLAYERS]: players(g, "p1", "p2") }, { invocationPath: "nightTrigger", withStep: true }),
      proofEnv({ semantics: new Map([...CANONICAL_ABILITY_SEMANTICS].filter(([id]) => id !== "sage")) }))).toMatchObject({ ok: false });
  });
});

describe("Sage -- one commit and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  it("the step commits once; Undo removes the delivery and reopens the step", () => {
    const g = demonKill();
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "sage", { [SAGE_PLAYERS]: players(g, "p1", "p2") }, { invocationPath: "nightTrigger", withStep: true, completeStep: true })))
      .toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().game).toEqual(g);
  });

  it("Undo of the Imp's kill removes the death and its recorded cause together", () => {
    const g = proofGame(ROLES, "night", 2);
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p1", "imp", { target: { kind: "participant", participants: [bind(g, "p0")] } }))).toMatchObject({ ok: true, changed: true });
    store.getState().undo();
    expect(store.getState().game).toEqual(g);
  });
});
