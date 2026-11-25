// @vitest-environment node
// BM-2b: the Zombuul's wake and attack. https://wiki.bloodontheclocktower.com/Zombuul
// "Each night*, if no-one died today, choose a player: they die. The 1st time you die, you live but register as dead."
import { describe, expect, it } from "vitest";
import { impair, patchPlayer, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import { HIDDEN_LIFE, isTrulyAlive } from "@/stores/lifeState";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { REVIEWED_INTERACTION_ROLES } from "./passiveRules";
import { ZOMBUUL_DAY_DEATH } from "./zombuul";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

// Seats: p0 zombuul, p1 chef, p2 empath, p3 monk, p4 poisoner, p5 saint, p6 soldier
const ROLES = ["zombuul", "chef", "empath", "monk", "poisoner", "saint", "soldier"];
const subject = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
const withEvents = (g: StorytellerLobbyRecord, events: LifeEvent[]): StorytellerLobbyRecord => ({ ...g, lifeEventWindow: { ...g.lifeEventWindow, events } });
const executed = (g: StorytellerLobbyRecord, id: string, role: string, day: number, outcome: "died" | "alreadyDead" | "survived" = "died"): LifeEvent =>
  ({ id: `e-${id}-${day}`, kind: "execution", moment: { phase: "day", day }, outcome, subject: subject(g, id), actualRoleAtEvent: role }) as LifeEvent;
const died = (g: StorytellerLobbyRecord, id: string, role: string, moment: { phase: "day" | "night"; day: number }): LifeEvent =>
  ({ id: `d-${id}-${moment.phase}${moment.day}`, kind: "death", moment, subject: subject(g, id), actualRoleAtEvent: role }) as LifeEvent;
const night3 = () => proofGame(ROLES, "night", 3);
const run = (g: StorytellerLobbyRecord, target: string) => plan(g, request(g, "p0", "zombuul", { target: pick(g, target) }));
const hiddenLife = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.some((effect) => effect.type === HIDDEN_LIFE && effect.state === "active");

describe("BM-2b: registration", () => {
  it("is a guided descriptor and on the reviewed list", () => {
    expect(CANONICAL_ABILITY_SEMANTICS.has("zombuul")).toBe(true);
    expect(REVIEWED_INTERACTION_ROLES.has("zombuul")).toBe(true);
  });
});

describe("BM-2b: the wake gate (any death during the previous Day: no wake)", () => {
  it("no-one died during the Day: the chosen player dies and gets the Zombuul's DEAD token", () => {
    const next = planned(run(night3(), "p1"));
    expect(next.players.p1!.alive).toBe(false);
    expect(next.players.p1!.reminders).toEqual([expect.objectContaining({ label: "Dead", sourceCharacter: "zombuul" })]);
  });

  it("an execution or any other Day death: Not Waking, with the plain reason", () => {
    const base = night3();
    const execution = withEvents(patchPlayer(base, "p1", { alive: false }), [executed(base, "p1", "chef", 2)]);
    expect(run(execution, "p2")).toMatchObject({ ok: false, code: "notApplicable", message: ZOMBUUL_DAY_DEATH });
    const dayDeath = withEvents(patchPlayer(base, "p5", { alive: false }), [died(base, "p5", "saint", { phase: "day", day: 2 })]);
    expect(run(dayDeath, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("his own registered death during the Day counts: he does not wake that night; the next quiet night he wakes and kills", () => {
    const base = night3();
    const own = withEvents(patchPlayer(base, "p0", { alive: false, effects: [{ id: "fx-life", type: HIDDEN_LIFE, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 } } as never] }),
      [executed(base, "p0", "zombuul", 2)]);
    expect(isTrulyAlive(own.players.p0!)).toBe(true);
    expect(run(own, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
    const later = { ...own, day: 4 };
    const next = planned(run(later, "p1"));
    expect(next.players.p1!.alive).toBe(false);
  });

  it("an execution of a player already dead is not a death (\"can't die again\"), and nor is a survived one or a night death: he wakes", () => {
    const base = night3();
    const g = withEvents(patchPlayer(patchPlayer(base, "p1", { alive: false }), "p2", { alive: false }), [
      died(base, "p1", "chef", { phase: "night", day: 2 }), executed(base, "p1", "chef", 2, "alreadyDead"), executed(base, "p6", "soldier", 2, "survived"),
    ]);
    expect(planned(run(g, "p5")).players.p5!.alive).toBe(false);
  });

  it("the first night: no wake", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(run(g, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a Day the record cannot vouch for (a game migrated mid-Day): the wake is Manual, never a guess", () => {
    const g = { ...night3(), lifeEventWindow: { coverageFrom: { phase: "night" as const, day: 3 }, events: [] } };
    expect(run(g, "p1")).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("BM-2b: the attack", () => {
  it("drunk or poisoned: the choice is made and nobody dies; after a Day death he is still not woken (the gate never shows he is impaired)", () => {
    const poisoned = impair(night3(), "p0");
    expect(run(poisoned, "p1")).toEqual({ ok: true, changed: false });
    const base = impair(night3(), "p0");
    const afterDeath = withEvents(patchPlayer(base, "p1", { alive: false }), [executed(base, "p1", "chef", 2)]);
    expect(run(afterDeath, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("the shared death gate: a Monk-protected player and a Soldier survive; a dead target is nothing", () => {
    const g = night3();
    const protectedGame = planned(plan(g, request(g, "p3", "monk", { target: pick(g, "p1") })));
    expect(run(protectedGame, "p1")).toEqual({ ok: true, changed: false });
    expect(run(g, "p6")).toEqual({ ok: true, changed: false });
    expect(run(patchPlayer(g, "p1", { alive: false }), "p1")).toEqual({ ok: true, changed: false });
  });

  it("choosing himself while he registers alive: his first death registers, the hidden life is kept and no DEAD token is placed", () => {
    const next = planned(run(night3(), "p0"));
    expect(next.players.p0!.alive).toBe(false);
    expect(hiddenLife(next, "p0")).toBe(true);
    expect(next.players.p0!.reminders).toEqual([]);
  });

  it("choosing himself while he registers dead: his real death, with the DEAD token", () => {
    const g = patchPlayer(night3(), "p0", { alive: false, effects: [{ id: "fx-life", type: HIDDEN_LIFE, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 1 } } as never] });
    const next = planned(run(g, "p0"));
    expect(isTrulyAlive(next.players.p0!)).toBe(false);
    expect(next.players.p0!.reminders).toEqual([expect.objectContaining({ label: "Dead", sourceCharacter: "zombuul" })]);
  });
});
