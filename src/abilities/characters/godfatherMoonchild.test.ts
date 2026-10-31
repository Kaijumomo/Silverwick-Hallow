// Treacherous 30th slice 2C -- Godfather and Moonchild. Production semantics.
import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// Seats: p0 godfather, p1 saint (outsider), p2 chef, p3 moonchild, p4 imp, p5 empath, p6 baron
const ROLES = ["godfather", "saint", "chef", "moonchild", "imp", "empath", "baron"];
const subject = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
const withEvents = (g: StorytellerLobbyRecord, events: LifeEvent[]): StorytellerLobbyRecord => ({ ...g, lifeEventWindow: { ...g.lifeEventWindow, events } });
const executed = (g: StorytellerLobbyRecord, id: string, role: string, day: number): LifeEvent =>
  ({ id: `e-${id}-${day}`, kind: "execution", moment: { phase: "day", day }, outcome: "died", subject: subject(g, id), actualRoleAtEvent: role }) as LifeEvent;
const died = (g: StorytellerLobbyRecord, id: string, role: string, moment: { phase: "day" | "night"; day: number }): LifeEvent =>
  ({ id: `d-${id}`, kind: "death", moment, subject: subject(g, id), actualRoleAtEvent: role }) as LifeEvent;

describe("Godfather", () => {
  const night3 = () => proofGame(ROLES, "night", 3);
  const run = (g: StorytellerLobbyRecord, target: string) => plan(g, request(g, "p0", "godfather", { target: pick(g, target) }));

  it("kills when an Outsider died during the Day that just ended", () => {
    const base = night3();
    const g = withEvents(patchPlayer(base, "p1", { alive: false }), [executed(base, "p1", "saint", 2)]);
    const next = planned(run(g, "p2"));
    expect(next.players.p2!.alive).toBe(false);
  });

  it("does not act when no Outsider died: a Townsfolk execution, or no death at all", () => {
    const base = night3();
    const townsfolk = withEvents(patchPlayer(base, "p2", { alive: false }), [executed(base, "p2", "chef", 2)]);
    expect(run(townsfolk, "p5")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(run(base, "p5")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("an Outsider that died at night, or on an earlier Day, does not count", () => {
    const base = night3();
    const nightDeath = withEvents(patchPlayer(base, "p1", { alive: false }), [died(base, "p1", "saint", { phase: "night", day: 3 })]);
    expect(run(nightDeath, "p5")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("two Outsiders dying still allows only one kill", () => {
    const base = proofGame(["godfather", "saint", "chef", "recluse", "imp", "empath", "baron"], "night", 3);
    const g = withEvents(base, [executed(base, "p1", "saint", 2), died(base, "p1", "saint", { phase: "day", day: 2 })]);
    const next = planned(run(g, "p2"));
    expect(Object.values(next.players).filter((p) => !p.alive)).toHaveLength(1);
  });

  it("a Spy death, or a missing role record, is never guessed (Manual)", () => {
    const base = night3();
    const spy = withEvents(base, [executed(base, "p1", "spy", 2)]);
    expect(run(spy, "p2")).toMatchObject({ ok: false, code: "unsupported", message: expect.stringContaining("cannot verify") });
    const unrecorded = withEvents(base, [{ ...executed(base, "p1", "saint", 2), actualRoleAtEvent: undefined } as LifeEvent]);
    expect(run(unrecorded, "p2")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("Night 2 follows Day 1; Night 1 never acts; impaired Godfather kills no one; homebrew inherits nothing", () => {
    const two = proofGame(ROLES, "night", 2);
    const g = withEvents(patchPlayer(two, "p1", { alive: false }), [executed(two, "p1", "saint", 1)]);
    expect(planned(run(g, "p2")).players.p2!.alive).toBe(false);
    const one = proofGame(ROLES, "night", 1);
    expect(run(one, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    const imp = impair(withEvents(patchPlayer(night3(), "p1", { alive: false }), [executed(night3(), "p1", "saint", 2)]), "p0");
    expect(run(imp, "p2")).toEqual({ ok: true, changed: false });
    const h = night3();
    expect(plan(h, request(h, "p0", "godfather", { target: pick(h, "p2") }), homebrewEnv("godfather"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Moonchild", () => {
  const night3 = () => proofGame(ROLES, "night", 3);
  const run = (g: StorytellerLobbyRecord, target: string) => plan(g, request(g, "p3", "moonchild", { target: pick(g, target) }));
  const afterExecution = () => {
    const base = night3();
    return withEvents(patchPlayer(base, "p3", { alive: false }), [executed(base, "p3", "moonchild", 2)]);
  };

  it("kills a good chosen player after the Moonchild died during the Day", () => {
    const g = afterExecution();
    expect(planned(run(g, "p2")).players.p2!.alive).toBe(false);
  });

  it("an evil chosen player is unharmed", () => {
    const g = afterExecution();
    expect(run(g, "p6")).toEqual({ ok: true, changed: false });
    expect(run(g, "p4")).toEqual({ ok: true, changed: false });
  });

  it("is refused for a living Moonchild and when the Moonchild died earlier", () => {
    const base = night3();
    expect(run(base, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    const earlier = patchPlayer(base, "p3", { alive: false }); // dead, but no death event in the window
    expect(run(earlier, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a death during tonight's Night counts too", () => {
    const base = night3();
    const g = withEvents(patchPlayer(base, "p3", { alive: false }), [died(base, "p3", "moonchild", { phase: "night", day: 3 })]);
    expect(planned(run(g, "p2")).players.p2!.alive).toBe(false);
  });

  it("an impaired Moonchild kills no one; a chosen dead player and a Goon are not decided", () => {
    const g = afterExecution();
    expect(run(impair(g, "p3"), "p2")).toEqual({ ok: true, changed: false });
    const dead = patchPlayer(g, "p2", { alive: false });
    expect(run(dead, "p2")).toMatchObject({ ok: false });
    const goon = patchPlayer(g, "p2", { actualRole: "goon" });
    expect(run(goon, "p2")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the Innkeeper-protected target survives; homebrew inherits nothing", () => {
    const g = afterExecution();
    const guarded = patchPlayer(g, "p2", { effects: [{ id: "cd", type: "cannotDie", sourceCharacter: "innkeeper", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "never" } } as never] });
    expect(run(guarded, "p2")).toEqual({ ok: true, changed: false });
    expect(plan(g, request(g, "p3", "moonchild", { target: pick(g, "p2") }), homebrewEnv("moonchild"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
