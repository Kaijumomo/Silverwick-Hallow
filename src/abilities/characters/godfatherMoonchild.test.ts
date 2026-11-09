// @vitest-environment node
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

  it("a missing role record is never guessed (Manual)", () => {
    const base = night3();
    const unrecorded = withEvents(base, [{ ...executed(base, "p1", "saint", 2), actualRoleAtEvent: undefined } as LifeEvent]);
    expect(run(unrecorded, "p2")).toMatchObject({ ok: false, code: "unsupported", message: expect.stringContaining("cannot verify") });
  });

  // Game 2 report: a Recluse killed in the Day (here by the Golem) left the wake stuck on "cannot verify". The Storyteller is now asked once.
  it.each(["recluse", "spy"])("a %s death in the Day is put to the Storyteller as one question, and the wake follows the answer", (role) => {
    const base = proofGame(["godfather", role, "chef", "moonchild", "imp", "empath", "baron"], "night", 2);
    const g = withEvents(patchPlayer(base, "p1", { alive: false }), [died(base, "p1", role, { phase: "day", day: 1 })]);
    const first = run(g, "p2");
    expect(first).toMatchObject({ ok: false, code: "needsInput", requirements: [{ kind: "boolean", source: "storyteller" }] });
    const id = !first.ok && first.code === "needsInput" ? first.requirements![0]!.id : "";
    const answer = (value: boolean) => plan(g, request(g, "p0", "godfather", { target: pick(g, "p2"), [id]: { kind: "boolean", value } }));
    expect(planned(answer(true)).players.p2!.alive).toBe(false);
    expect(answer(false)).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a Recluse death beside a certain Outsider death needs no question", () => {
    const base = proofGame(["godfather", "recluse", "chef", "moonchild", "imp", "empath", "baron"], "night", 2);
    const g = withEvents(base, [died(base, "p1", "recluse", { phase: "day", day: 1 }), died(base, "p3", "moonchild", { phase: "day", day: 1 })]);
    expect(planned(run(g, "p2")).players.p2!.alive).toBe(false);
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

  it("the Moonchild chooses in the Day, so with no recorded choice there is nothing to do at Night, however they died", () => {
    expect(run(afterExecution(), "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    const base = night3();
    const tonight = withEvents(patchPlayer(base, "p3", { alive: false }), [died(base, "p3", "moonchild", { phase: "night", day: 3 })]);
    expect(run(tonight, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(run(tonight, "p6")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("is refused for a living Moonchild and when the Moonchild died earlier", () => {
    const base = night3();
    expect(run(base, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    const earlier = patchPlayer(base, "p3", { alive: false }); // dead, but no death event in the window
    expect(run(earlier, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });
});

describe("Moonchild -- the public Day choice (WP-4)", () => {
  const night = () => proofGame(ROLES, "night", 3);
  const choice = (g: StorytellerLobbyRecord, holder: string, id = "mc1"): StorytellerLobbyRecord => patchPlayer(g, holder, { effects: [{
    id, type: "moonchildChoice", sourceCharacter: "moonchild", lifetime: { kind: "untilDawn" }, state: "active",
    sourceParticipant: { kind: "participant", playerId: "p3", participantId: g.players.p3!.participantId!, nameAtTime: "Player 3" },
    expiry: { kind: "at", moment: { phase: "day", day: 4 } }, appliedAt: { phase: "day", day: 3 } } as never] });
  // The Moonchild died during the previous NIGHT and chose in the Day: the old death window no longer sees it.
  const decided = () => choice(patchPlayer(night(), "p3", { alive: false }), "p2");
  const run = (g: StorytellerLobbyRecord, target: string) => plan(g, request(g, "p3", "moonchild", { target: pick(g, target) }));

  it("resolves the chosen player's death on the Night after the Day choice, without any death in the window, and consumes the choice", () => {
    const next = planned(run(decided(), "p2"));
    expect(next.players.p2!.alive).toBe(false);
    expect(next.players.p2!.effects.filter((e) => e.type === "moonchildChoice" && e.state === "active")).toEqual([]);
  });

  it("an impaired Moonchild tonight kills no one (their state tonight decides)", () => {
    expect(run(impair(decided(), "p3"), "p2")).toEqual({ ok: true, changed: false });
  });

  it("a protected chosen player survives and the choice is still consumed", () => {
    const g = patchPlayer(decided(), "p2", { effects: [...decided().players.p2!.effects, { id: "cd", type: "cannotDie", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 3 } } as never] });
    const next = planned(run(g, "p2"));
    expect(next.players.p2!.alive).toBe(true);
    expect(next.players.p2!.effects.filter((e) => e.type === "moonchildChoice" && e.state === "active")).toEqual([]);
  });

  it("the death is the player the Moonchild publicly chose, never a different target", () => {
    expect(run(decided(), "p5")).toMatchObject({ ok: false });
    expect(planned(run(decided(), "p2")).players.p5!.alive).toBe(true);
  });

  it("a choice sourced from another participant is ignored", () => {
    const base = patchPlayer(night(), "p3", { alive: false });
    const other = patchPlayer(base, "p2", { effects: [{ id: "x", type: "moonchildChoice", sourceCharacter: "moonchild", lifetime: { kind: "untilDawn" }, state: "active",
      sourceParticipant: { kind: "participant", playerId: "p0", participantId: base.players.p0!.participantId!, nameAtTime: "Player 0" },
      expiry: { kind: "at", moment: { phase: "day", day: 4 } }, appliedAt: { phase: "day", day: 3 } } as never] });
    expect(run(other, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });
});
