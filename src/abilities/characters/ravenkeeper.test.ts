// Phase 10F Slice 7 -- Ravenkeeper + the explicit verified Night trigger
// (matrix Section 9). Production semantics.
import { beforeEach, describe, expect, it } from "vitest";
import { CHARACTER_JUDGMENT, RAVENKEEPER, SHOWN } from "./ravenkeeper";
import { subjectId } from "./shared";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilityInputValue, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { invocationEligibility, nightTriggerJudgmentId } from "@/abilities/invocation";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, request, requirementIds, reseat, yes } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// p0 ravenkeeper, p1 imp, p2 chef, p3 recluse, p4 monk, p5 poisoner, p6 empath
const ROLES = ["ravenkeeper", "imp", "chef", "recluse", "monk", "poisoner", "empath"];
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
/** Night 2: the Imp kills the Ravenkeeper through the real coordinator. */
function killedTonight(): StorytellerLobbyRecord {
  const g = proofGame(ROLES, "night", 2);
  return planned(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") })));
}
/** SOL-10F-A1: the shown / judged character is bound to the chosen player. */
const sid = (g: StorytellerLobbyRecord, target: string, base: string) => subjectId(base, bind(g, target));
const bound = (g: StorytellerLobbyRecord, target: string, values: Record<string, AbilityInputValue>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [[SHOWN, CHARACTER_JUDGMENT].includes(key) ? sid(g, target, key) : key, value]));
const trigger = (g: StorytellerLobbyRecord, target: string, inputs: Record<string, AbilityInputValue> = {}, extra: { judgments?: Record<string, AbilityInputValue> } & Record<string, unknown> = {}) =>
  plan(g, request(g, "p0", "ravenkeeper", { target: pick(g, target), ...bound(g, target, inputs) },
    { invocationPath: "nightTrigger", withStep: true, completeStep: true, ...extra, ...(extra.judgments ? { judgments: bound(g, target, extra.judgments) } : {}) }));
const death = (g: StorytellerLobbyRecord, id: string, phase: "night" | "day", day: number): LifeEvent => ({ id: `le-${id}-${phase}${day}`, kind: "death",
  subject: { kind: "participant", participantId: g.players[id]!.participantId!, playerId: id, nameAtTime: g.players[id]!.name }, moment: { phase, day } } as LifeEvent);

describe("Ravenkeeper -- the verified trigger", () => {
  it("died during THIS Night (Life Event Window, exact ParticipantId) -> triggered; resolves while dead", () => {
    const g = killedTonight();
    expect(g.players.p0!.alive).toBe(false);
    const next = planned(trigger(g, "p2"));
    expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "ravenkeeper", informationActionId: "ravenkeeper-triggered",
      values: [{ requirementId: "chosenPlayer", kind: "player", participants: [expect.objectContaining({ participantId: g.players.p2!.participantId })] },
        { requirementId: "role", kind: "role", roleId: "chef" }] });
    expect(next.nightProgress[`2:${participantStepKey(g.players.p0!.participantId!, "ravenkeeper")}`]?.status).toBe("done");
  });

  it("a Day death does not trigger", () => {
    const g = proofGame(ROLES, "night", 3);
    const dayDeath = { ...patchPlayer(g, "p0", { alive: false }), lifeEventWindow: { coverageFrom: { phase: "night" as const, day: 1 }, events: [death(g, "p0", "day", 2)] } };
    expect(trigger(dayDeath, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a previous Night's death does not trigger", () => {
    const g = proofGame(ROLES, "night", 3);
    const old = { ...patchPlayer(g, "p0", { alive: false }), lifeEventWindow: { coverageFrom: { phase: "night" as const, day: 1 }, events: [death(g, "p0", "night", 2)] } };
    expect(trigger(old, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("History is never consulted: a History-only death does not trigger", () => {
    const g = patchPlayer(proofGame(ROLES, "night", 2), "p0", { alive: false });
    const withHistory = { ...g, history: [{ id: "h", category: "life", participant: { kind: "participant", participantId: g.players.p0!.participantId!, playerId: "p0", nameAtTime: "Player 0" },
      moment: { phase: "night", day: 2 }, lifeEvent: { operations: [] } }] } as unknown as StorytellerLobbyRecord;
    expect(trigger(withHistory, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("seat replacement: the new occupant does not inherit the trigger", () => {
    const g = reseat(killedTonight(), "p0");
    expect(trigger(g, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("unknown Life Event coverage is NOT 'did not trigger': the Storyteller judges", () => {
    const g = proofGame(ROLES, "night", 2);
    const migrated = { ...patchPlayer(g, "p0", { alive: false }), lifeEventWindow: { coverageFrom: { phase: "day" as const, day: 2 }, events: [] } };
    const id = nightTriggerJudgmentId("actorDiedTonight", null);
    expect(trigger(migrated, "p2")).toMatchObject({ ok: false, code: "unsupported" });
    expect(trigger(migrated, "p2", {}, { judgments: { [id]: yes(false) } })).toMatchObject({ ok: false, code: "unsupported" });
    const judged = trigger(migrated, "p2", {}, { judgments: { [id]: yes(true) } });
    expect(judged).toMatchObject({ ok: false, code: "unsupported" });
    expect(migrated.informationDeliveries).toEqual([]);
  });

  it("no duplicate execution: once the trigger step is done, a repeated / stale workflow is refused", () => {
    const g = killedTonight();
    const req = request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightTrigger", withStep: true, completeStep: true });
    const next = planned(plan(g, req));
    expect(plan(next, req)).toMatchObject({ ok: false, code: "stale" }); // the captured step changed
    expect(plan(next, request(next, "p0", "ravenkeeper", { target: pick(next, "p2") }, { invocationPath: "nightTrigger", withStep: true }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("SOL-10F-A10: a trigger request must name the trigger event it resolves (no event binding -> invalid)", () => {
    const g = killedTonight();
    const req = request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightTrigger" });
    const unbound = { ...req, fingerprint: { ...req.fingerprint!, trigger: undefined } } as typeof req;
    delete (unbound.fingerprint as { trigger?: unknown }).trigger;
    expect(plan(g, unbound)).toMatchObject({ ok: false, code: "invalid" });
    // Bound to the event, it resolves -- and needs no Night Order row step.
    expect(plan(g, req)).toMatchObject({ ok: true, changed: true });
  });

  it("the ordinary Night Order and Day entry never run it; only the declared trigger path does", () => {
    const g = killedTonight();
    expect(plan(g, request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightOrder" }))).toMatchObject({ ok: false, code: "notApplicable" });
    expect(invocationEligibility(RAVENKEEPER, "dayEntry", { phase: "day", day: 2 })).toMatchObject({ eligible: false });
  });

  it("a generic triggered / passive descriptor WITHOUT a verified trigger never gains the path", () => {
    const generic: AbilityDescriptor = { ...RAVENKEEPER, roleId: "sage" };
    delete (generic as { nightTrigger?: unknown }).nightTrigger;
    expect(invocationEligibility(generic, "nightTrigger", { phase: "night", day: 2 })).toMatchObject({ eligible: false });
    expect(invocationEligibility({ timing: ["passive"], invocation: "none" }, "nightTrigger", { phase: "night", day: 2 })).toMatchObject({ eligible: false });
    const semantics: AbilitySemanticsRegistry = new Map([...CANONICAL_ABILITY_SEMANTICS, ["sage", generic]]);
    const g = patchPlayer(killedTonight(), "p0", { actualRole: "sage", shownRole: "sage" });
    expect(plan(g, request(g, "p0", "sage", { target: pick(g, "p2") }, { invocationPath: "nightTrigger", withStep: true }), proofEnv({ semantics })))
      .toMatchObject({ ok: false, code: "notApplicable" });
  });
});

describe("Ravenkeeper -- information", () => {
  it("any participant (alive or dead); registration ambiguity -> the Storyteller's judgment", () => {
    const g = killedTonight();
    expect(planned(trigger(g, "p0")).informationDeliveries.at(-1)!.values![1]).toEqual({ requirementId: "role", kind: "role", roleId: "ravenkeeper" });
    expect(trigger(g, "p3")).toMatchObject({ ok: false, code: "unsupported" });
    expect(trigger(g, "p3", {}, { judgments: { [CHARACTER_JUDGMENT]: character("scarletwoman") } })).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.informationDeliveries).toEqual([]);
  });

  it("an impaired Ravenkeeper: the wake and choice are simulated; the Storyteller shows any character", () => {
    const g = impair(killedTonight(), "p0", "drunk");
    expect(requirementIds(trigger(g, "p2"))).toEqual([sid(g, "p2", SHOWN)]);
    const next = planned(trigger(g, "p2", { [SHOWN]: character("imp") }));
    expect(next.informationDeliveries.at(-1)!.values![1]).toEqual({ requirementId: "role", kind: "role", roleId: "imp" });
    expect(next.players).toBe(g.players);
  });

  it("a stale chosen player is refused", () => {
    const g = killedTonight();
    const req = request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightTrigger", withStep: true });
    expect(plan(reseat(g, "p2"), req)).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Ravenkeeper reusing the official id inherits no semantics", () => {
    const g = killedTonight();
    expect(plan(g, request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightTrigger", withStep: true }), homebrewEnv("ravenkeeper")))
      .toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Ravenkeeper -- one commit and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  it("the trigger resolution commits once; Undo removes the delivery record and reopens the step", () => {
    const g = killedTonight();
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightTrigger", withStep: true, completeStep: true })))
      .toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().game).toEqual(g);
  });
});
