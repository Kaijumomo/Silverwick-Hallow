// @vitest-environment node
// SV-5g2 (PO Q17 A): the ABNORMAL marks the app places by itself, through the real coordinator and production semantics. Each case is
// worked out by hand from the seating beside it: the true answer first, then what was delivered, then whether it is provably abnormal.
import { describe, expect, it } from "vitest";
import { impair, num, patchPlayer, pick, plan, planned, proofGame, request, yes } from "@/test/proofFixtures";
import { CLOCKMAKER_COMMUNICATED } from "./characters/clockmaker";
import { DREAMER_EVIL, DREAMER_GOOD } from "./characters/dreamer";
import { subjectId } from "./characters/shared";
import {
  ABNORMAL_BY_HAND, ABNORMAL_IMPAIRED, ABNORMAL_VORTOX, abnormalMarkIntents, abnormalMarksOf, abnormalReasons,
} from "@/stores/abnormalMarks";
import { applyEffectPlan, planEffectTransaction } from "@/stores/effectResolution";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { AbilityInputs } from "./semantics";
import { withEffectIntents } from "./abnormalInformation";
import { isMechanical, type AbilityOperation } from "@/stores/abilityResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";

const step = { withStep: true, completeStep: true } as const;
const after = (g: StorytellerLobbyRecord, actor: string, roleId: string, inputs: AbilityInputs = {}) => planned(plan(g, request(g, actor, roleId, inputs, step)));
const reasonsOn = (g: StorytellerLobbyRecord, id: string) => abnormalReasons(abnormalMarksOf(g.players[id]!));
const character = (roleId: string) => ({ kind: "character" as const, roleIds: [roleId] });

describe("Clockmaker (first night): p0 clockmaker, p1 mathematician, p2 Demon, p3 witch, p4 chef; the true answer is 1 step", () => {
  const vortox = () => proofGame(["clockmaker", "mathematician", "vortox", "witch", "chef"], "night", 1);
  const fangGu = () => proofGame(["clockmaker", "mathematician", "fanggu", "witch", "chef"], "night", 1);

  it("a Vortox: the false number marks the Clockmaker ABNORMAL in the same commit (the page's third example)", () => {
    const g = after(vortox(), "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) });
    expect(g.informationDeliveries.at(-1)).toMatchObject({ informationActionId: "clockmaker-first-night", values: [{ value: 2 }] });
    expect(reasonsOn(g, "p0")).toEqual([ABNORMAL_VORTOX]);
    expect(abnormalMarksOf(g.players.p0!)[0]).toMatchObject({ lifetime: { kind: "untilDawn" }, expiry: { kind: "at", moment: { phase: "day", day: 1 } } });
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(true);
  });

  it("a drunk or poisoned Clockmaker under a Vortox is marked for the Vortox", () => {
    for (const type of ["drunk", "poisoned"]) expect(reasonsOn(after(impair(vortox(), "p0", type), "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) }), "p0")).toEqual([ABNORMAL_VORTOX]);
  });

  it("no mark while nobody living has the Mathematician's ability (none seated, or he is dead)", () => {
    const none = proofGame(["clockmaker", "chef", "vortox", "witch", "sage"], "night", 1);
    expect(after(none, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) }).players.p0!.effects).toEqual([]);
    const dead = patchPlayer(vortox(), "p1", { alive: false });
    expect(after(dead, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) }).players.p0!.effects).toEqual([]);
  });

  it("a dead or poisoned Vortox: true information, nothing abnormal", () => {
    expect(after(patchPlayer(vortox(), "p2", { alive: false }), "p0", "clockmaker").players.p0!.effects).toEqual([]);
    const g = after(impair(vortox(), "p2"), "p0", "clockmaker");
    expect(g.informationDeliveries.at(-1)).toMatchObject({ values: [{ value: 1 }] });
    expect(reasonsOn(g, "p0")).toEqual([]);
  });

  it("a poisoned Clockmaker told the true number is not abnormal (the page's poisoned Empath); told another number, he is", () => {
    expect(reasonsOn(after(impair(fangGu(), "p0"), "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(1) }), "p0")).toEqual([]);
    const g = after(impair(fangGu(), "p0"), "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) });
    expect(reasonsOn(g, "p0")).toEqual([ABNORMAL_IMPAIRED]);
  });

  it("a number a Recluse could make true is not proven false: no mark; a number no registration gives is", () => {
    // p0 clockmaker, p1 chef, p2 mathematician, p3 sage, p4 fanggu, p5 savant, p6 recluse, p7 artist, p8 witch. Fang Gu to the Witch: 4
    // steps; the Recluse as a Minion: 2; the Recluse as a second Demon, to the Witch: 2. So 2 and 4 may be true; 1 and 3 never are.
    const g = impair(proofGame(["clockmaker", "chef", "mathematician", "sage", "fanggu", "savant", "recluse", "artist", "witch"], "night", 1), "p0");
    for (const told of [2, 4]) expect(reasonsOn(after(g, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(told) }), "p0"), String(told)).toEqual([]);
    for (const told of [1, 3]) expect(reasonsOn(after(g, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(told) }), "p0"), String(told)).toEqual([ABNORMAL_IMPAIRED]);
  });

  it("a Drunk shown the Clockmaker is the Storyteller's (the Drunk jinx): never marked by the app", () => {
    const g = patchPlayer(fangGu(), "p0", { actualRole: "drunk", shownRole: "clockmaker", behaviorMode: "drunk_fake_role_behavior" });
    expect(after(g, "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) }).players.p0!.effects).toEqual([]);
  });

  it("a healthy Clockmaker with no Vortox: nothing", () => {
    expect(after(fangGu(), "p0", "clockmaker").players.p0!.effects).toEqual([]);
  });

  it("a player the Storyteller already marked by hand: the Vortox adds its reason to the one mark", () => {
    const g0 = vortox();
    const planned0 = planEffectTransaction(g0, { intents: abnormalMarkIntents(g0.players, { playerId: "p0", participantId: g0.players.p0!.participantId! }, ABNORMAL_BY_HAND) });
    if (!planned0.ok || !planned0.changed) throw new Error("placement");
    const g = after(applyEffectPlan(g0, planned0.plan), "p0", "clockmaker", { [CLOCKMAKER_COMMUNICATED]: num(2) });
    expect(abnormalMarksOf(g.players.p0!)).toHaveLength(1);
    expect(reasonsOn(g, "p0")).toEqual([ABNORMAL_BY_HAND, ABNORMAL_VORTOX]);
  });
});

describe("Seamstress, Dreamer and Oracle while poisoned (no Vortox)", () => {
  it("Seamstress: the Barber and the Clockmaker are both good (true: YES); a poisoned Seamstress told NO is marked, with her use", () => {
    // p0 seamstress, p1 barber, p2 clockmaker, p3 fanggu, p4 sweetheart, p5 witch, p6 mathematician
    const g0 = impair(proofGame(["seamstress", "barber", "clockmaker", "fanggu", "sweetheart", "witch", "mathematician"], "night", 2), "p0");
    const asked = plan(g0, request(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2") }, step));
    const id = asked.ok ? "" : asked.requirements![0]!.id;
    const no = after(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2"), [id]: yes(false) });
    expect(no.players.p0!.abilityUsed).toBe(true);
    expect(reasonsOn(no, "p0")).toEqual([ABNORMAL_IMPAIRED]);
    const told = after(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2"), [id]: yes(true) });
    expect(reasonsOn(told, "p0")).toEqual([]);
  });

  it("Dreamer: the Mutant chosen; neither token the Mutant: marked; the Mutant among them: not", () => {
    // p0 dreamer, p1 mutant, p2 cerenovus, p3 vigormortis, p4 mathematician
    const g = impair(proofGame(["dreamer", "mutant", "cerenovus", "vigormortis", "mathematician"], "night", 2), "p0");
    const inputs = (good: string, evil: string) => ({ target: pick(g, "p1"), [subjectId(DREAMER_GOOD, { playerId: "p1", participantId: g.players.p1!.participantId! })]: character(good),
      [subjectId(DREAMER_EVIL, { playerId: "p1", participantId: g.players.p1!.participantId! })]: character(evil) });
    expect(reasonsOn(after(g, "p0", "dreamer", inputs("sage", "witch")), "p0")).toEqual([ABNORMAL_IMPAIRED]);
    expect(reasonsOn(after(g, "p0", "dreamer", inputs("mutant", "witch")), "p0")).toEqual([]);
  });

  it("Dreamer: a Recluse chosen: an evil token could be his registration, so nothing is proven and nothing is marked", () => {
    // p0 dreamer, p1 recluse, p2 cerenovus, p3 vigormortis, p4 mathematician
    const g = impair(proofGame(["dreamer", "recluse", "cerenovus", "vigormortis", "mathematician"], "night", 2), "p0");
    const inputs = { target: pick(g, "p1"), [subjectId(DREAMER_GOOD, { playerId: "p1", participantId: g.players.p1!.participantId! })]: character("sage"),
      [subjectId(DREAMER_EVIL, { playerId: "p1", participantId: g.players.p1!.participantId! })]: character("witch") };
    expect(reasonsOn(after(g, "p0", "dreamer", inputs), "p0")).toEqual([]);
  });

  it("Oracle: nobody dead is evil (true: 0); a poisoned Oracle told 1 is marked, told 0 is not", () => {
    const g = impair(patchPlayer(proofGame(["oracle", "mathematician", "fanggu", "witch", "chef"], "night", 3), "p4", { alive: false }), "p0");
    expect(reasonsOn(after(g, "p0", "oracle", { communicated: num(1) }), "p0")).toEqual([ABNORMAL_IMPAIRED]);
    expect(reasonsOn(after(g, "p0", "oracle", { communicated: num(0) }), "p0")).toEqual([]);
  });
});

describe("Seamstress and Dreamer under a Vortox", () => {
  it("Seamstress: the Barber and the Clockmaker are both good (true: YES); under a Vortox she is told NO and marked", () => {
    // p0 seamstress, p1 barber, p2 clockmaker, p3 vortox, p4 sweetheart, p5 witch, p6 mathematician
    const g0 = proofGame(["seamstress", "barber", "clockmaker", "vortox", "sweetheart", "witch", "mathematician"], "night", 2);
    const asked = plan(g0, request(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2") }, step));
    const id = asked.ok ? "" : asked.requirements![0]!.id;
    const told = id ? after(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2"), [id]: yes(false) }) : after(g0, "p0", "seamstress", { targets: pick(g0, "p1", "p2") });
    expect(told.informationDeliveries.at(-1)).toMatchObject({ values: expect.arrayContaining([expect.objectContaining({ value: false })]) });
    expect(reasonsOn(told, "p0")).toEqual([ABNORMAL_VORTOX]);
  });

  it("Dreamer: the Mutant chosen; under a Vortox neither token is the Mutant and the Dreamer is marked", () => {
    // p0 dreamer, p1 mutant, p2 cerenovus, p3 vortox, p4 mathematician
    const g = proofGame(["dreamer", "mutant", "cerenovus", "vortox", "mathematician"], "night", 2);
    const inputs = { target: pick(g, "p1"), [subjectId(DREAMER_GOOD, { playerId: "p1", participantId: g.players.p1!.participantId! })]: character("sage"),
      [subjectId(DREAMER_EVIL, { playerId: "p1", participantId: g.players.p1!.participantId! })]: character("witch") };
    expect(reasonsOn(after(g, "p0", "dreamer", inputs), "p0")).toEqual([ABNORMAL_VORTOX]);
  });
});

describe("the coordinator's ordering check stays intact (independent check, finding 1)", () => {
  const table = proofGame(["oracle", "mathematician", "vortox", "witch", "chef"], "night", 2);
  const marks = abnormalMarkIntents(table.players, { playerId: "p0", participantId: table.players.p0!.participantId! }, ABNORMAL_VORTOX);
  const op = (domain: AbilityOperation["domain"]) => ({ domain }) as unknown as AbilityOperation;

  it("a mark that adds the second mechanical domain makes the list order the declared order", () => {
    const outcome = withEffectIntents({ operations: [op("life"), op("information")] }, marks, isMechanical);
    expect(outcome.operations.map((operation) => operation.domain)).toEqual(["life", "effect", "information"]);
    expect(outcome.mechanicalOrder).toBe("declared");
  });

  it("an outcome that already changed two kinds of state with no declared order stays undeclared, so the coordinator still refuses it", () => {
    const outcome = withEffectIntents({ operations: [op("life"), op("role"), op("information")] }, marks, isMechanical);
    expect(outcome.mechanicalOrder).toBeUndefined();
    expect(withEffectIntents({ operations: [op("life"), op("role")], mechanicalOrder: "declared" }, marks, isMechanical).mechanicalOrder).toBe("declared");
  });
});
