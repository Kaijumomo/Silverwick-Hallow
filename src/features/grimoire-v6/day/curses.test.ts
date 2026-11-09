import { describe, expect, it } from "vitest";
import { proofGame, proofRegistry, proofScript, patchPlayer, impair } from "@/test/proofFixtures";
import { curseNotice } from "./curses";
import type { V6Ctx } from "../ctx";

const ROLES = ["witch", "chef", "empath", "monk", "imp", "saint", "poisoner"];
const cursed = (g: ReturnType<typeof proofGame>) => patchPlayer(g, "p1", { effects: [{
  id: "curse", type: "witchCurse", sourceCharacter: "witch", lifetime: { kind: "throughFollowingDay" }, state: "active",
  sourceParticipant: { kind: "participant", playerId: "p0", participantId: g.players.p0!.participantId!, nameAtTime: "Player 0" },
  expiry: { kind: "at", moment: { phase: "night", day: 3 } }, appliedAt: { phase: "night", day: 2 } } as never] });
const ctxOf = (game: ReturnType<typeof proofGame>) => ({ game, script: proofScript, registry: proofRegistry }) as unknown as V6Ctx;
const ref = (g: ReturnType<typeof proofGame>, id: string) => ({ playerId: id, participantId: g.players[id]!.participantId! });

describe("Witch curse notice on the nomination card", () => {
  it("a certain curse (it applies, nothing protects them) is applied by itself when the vote begins: no button", () => {
    const g = cursed(proofGame(ROLES, "day", 2));
    const notice = curseNotice(ctxOf(g), ref(g, "p1"));
    expect(notice?.note).toBe("");
    expect(notice?.actions).toEqual([]);
    expect(notice?.auto).toBeTypeOf("function");
  });

  it("after an Undo inside the round a certain curse offers no spare button; a doubtful one asks a short question", () => {
    const g = cursed(proofGame(ROLES, "day", 2));
    expect(curseNotice(ctxOf(g), ref(g, "p1"), true)).toBeNull();
    const guarded = patchPlayer(g, "p1", { effects: [...g.players.p1!.effects, { id: "inn", type: "cannotDie", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 } } as never] });
    expect(curseNotice(ctxOf(guarded), ref(g, "p1"))).toBeNull();
    const doubtful = curseNotice(ctxOf(guarded), ref(g, "p1"), true);
    expect(doubtful?.auto).toBeUndefined();
    expect(doubtful?.note).toMatch(/^Does /);
    expect(doubtful?.actions).toHaveLength(1);
  });

  it("says nothing for an uncursed nominator, a dead one, at night, with three left, or once the Witch is impaired", () => {
    const g = cursed(proofGame(ROLES, "day", 2));
    expect(curseNotice(ctxOf(g), ref(g, "p2"))).toBeNull();
    expect(curseNotice(ctxOf(patchPlayer(g, "p1", { alive: false })), ref(g, "p1"))).toBeNull();
    expect(curseNotice(ctxOf(cursed(proofGame(ROLES, "night", 2))), ref(g, "p1"))).toBeNull();
    const three = [2, 3, 4, 5].reduce((acc, i) => patchPlayer(acc, `p${i}`, { alive: false }), g);
    expect(curseNotice(ctxOf(three), ref(g, "p1"))).toBeNull();
    expect(curseNotice(ctxOf(impair(g, "p0")), ref(g, "p1"))).toBeNull();
  });
});

import { golemNotice } from "./curses";

describe("Golem nomination notice", () => {
  const roles = ["golem", "chef", "empath", "monk", "imp", "saint", "poisoner"];
  it("a Golem nominating a non-Demon: the death and the spent nomination are applied by themselves, with no button", () => {
    const g = proofGame(roles, "day", 2);
    const notice = golemNotice(ctxOf(g), ref(g, "p0"), ref(g, "p1"));
    expect(notice?.note).toBe("");
    expect(notice?.actions).toEqual([]);
    expect(notice?.auto).toBeTypeOf("function");
    expect(notice?.blocked).toBeUndefined();
  });

  it("the Demon survives the nomination but the nomination is spent, automatically", () => {
    const g = proofGame(roles, "day", 2);
    const notice = golemNotice(ctxOf(g), ref(g, "p0"), ref(g, "p4"));
    expect(notice?.note).toBe("");
    expect(notice?.auto).toBeTypeOf("function");
  });

  it("a Recluse nominee is the Storyteller's call: no automatic action, both rulings offered once the vote has begun", () => {
    const g = proofGame(["golem", "recluse", "empath", "monk", "imp", "saint", "poisoner"], "day", 2);
    const before = golemNotice(ctxOf(g), ref(g, "p0"), ref(g, "p1"));
    expect(before?.auto).toBeUndefined();
    expect(before?.actions).toEqual([]);
    const during = golemNotice(ctxOf(g), ref(g, "p0"), ref(g, "p1"), true);
    expect(during?.auto).toBeUndefined();
    expect(during?.actions).toHaveLength(2);
    expect(during?.note).toMatch(/^Does /);
  });

  it("an impaired Golem still spends its one nomination automatically", () => {
    const base = proofGame(roles, "day", 2);
    const notice = golemNotice(ctxOf(impair(base, "p0")), ref(base, "p0"), ref(base, "p1"));
    expect(notice?.note).toBe("");
    expect(notice?.auto).toBeTypeOf("function");
  });

  it("a spent Golem cannot begin another nomination; once a vote is under way there is nothing to say", () => {
    const base = proofGame(roles, "day", 2);
    const used = patchPlayer(base, "p0", { abilityUsed: true });
    expect(golemNotice(ctxOf(used), ref(base, "p0"), ref(base, "p1"))).toMatchObject({ actions: [], blocked: true });
    expect(golemNotice(ctxOf(used), ref(base, "p0"), ref(base, "p1"), true)).toBeNull();
  });

  it("says nothing for a non-Golem nominator, a dead Golem or at night", () => {
    const g = proofGame(roles, "day", 2);
    expect(golemNotice(ctxOf(g), ref(g, "p2"), ref(g, "p1"))).toBeNull();
    expect(golemNotice(ctxOf(patchPlayer(g, "p0", { alive: false })), ref(g, "p0"), ref(g, "p1"))).toBeNull();
    expect(golemNotice(ctxOf(proofGame(roles, "night", 2)), ref(g, "p0"), ref(g, "p1"))).toBeNull();
  });
});
