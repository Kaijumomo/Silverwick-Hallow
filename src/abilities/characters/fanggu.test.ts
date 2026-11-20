// SV-2b -- Fang Gu: "Each night*, choose a player: they die. The 1st Outsider this kills becomes an evil Fang Gu & you die instead.
// [+1 Outsider]" https://wiki.bloodontheclocktower.com/Fang_Gu -- production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { FANG_GU, FANG_GU_ONCE_BY_HAND, FANG_GU_TARGET, fangGuRegistersAsOutsiderId } from "./fanggu";
import { SNAKE_CHARMER_TARGET } from "./snakecharmer";
import { SAGE, SAGE_PLAYERS } from "./sage";
import { SWEETHEART } from "./sweetheart";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request, requirementIds } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { nightTriggerStatus } from "@/abilities/invocation";
import { participantStepKey } from "@/stores/nightProgress";
import { FANG_GU_ONCE, gameRuleFactDefinition } from "@/stores/gameRuleFactRegistry";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { computeNightOrder } from "@/rules/night/nightOrder";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 fanggu, p1 sweetheart, p2 clockmaker, p3 monk, p4 sage, p5 mutant, p6 dreamer
const ROLES = ["fanggu", "sweetheart", "clockmaker", "monk", "sage", "mutant", "dreamer"];
const game = () => store.getState().game!;
const pid = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.participantId!;
const attack = (g: StorytellerLobbyRecord, target: string, extra: Record<string, unknown> = {}, actor = "p0") =>
  plan(g, request(g, actor, "fanggu", { [FANG_GU_TARGET]: pick(g, target), ...extra }, { withStep: true, completeStep: true }));
const protect = (g: StorytellerLobbyRecord, target: string) => planned(plan(g, request(g, "p3", "monk", { target: pick(g, target) })));
const once = (g: StorytellerLobbyRecord) => proofQuery(g).gameRuleFact(FANG_GU_ONCE);
const step = (g: StorytellerLobbyRecord, id: string, roleId: string) => g.nightProgress[`${g.day}:${participantStepKey(pid(g, id), roleId)}`]?.status;
const deadTokens = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.reminders.filter((r) => r.label === "Dead" && r.sourceCharacter === "fanggu");
/** The next Night, with tonight's progress kept. */
const nextNight = (g: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...g, day: g.day + 1 });
const jumped = () => planned(attack(proofGame(ROLES), "p5"));

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("Fang Gu -- the kill", () => {
  it("a player who is not an Outsider dies (the Fang Gu's DEAD token, the cause recorded as the Fang Gu's); ONCE stays unrecorded", () => {
    const g = proofGame(ROLES);
    const next = planned(attack(g, "p2"));
    expect(next.players.p2!.alive).toBe(false);
    expect(deadTokens(next, "p2")).toHaveLength(1);
    expect(next.lifeEventWindow.events.at(-1)).toMatchObject({ kind: "death", actualRoleAtEvent: "clockmaker",
      provenance: { sourceCharacter: "fanggu", sourceParticipant: expect.objectContaining({ playerId: "p0" }) } });
    expect(once(next)).toEqual({ known: true, value: false });
    expect(next.players.p0!.alive).toBe(true);
  });

  it("a dead target: nothing happens", () => {
    const g = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    const next = planned(attack(g, "p2"));
    expect(next.players).toEqual(g.players);
  });

  it("not on the first night", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(attack(g, "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    expect(FANG_GU.timing).toEqual(["otherNight"]);
    expect(FANG_GU.presentation).toMatchObject({ complexity: "simple", action: "Choose a player to kill" });
  });

  it("protected by the Monk: nobody dies", () => {
    const g = protect(proofGame(ROLES), "p2");
    expect(attack(g, "p2")).toMatchObject({ ok: true });
    expect(planned(attack(g, "p2")).players.p2!.alive).toBe(true);
  });

  it("the Fang Gu chooses itself: it dies, nobody takes its place, ONCE stays unrecorded", () => {
    const next = planned(attack(proofGame(ROLES), "p0"));
    expect(next.players.p0!.alive).toBe(false);
    expect(next.players.p0!.actualRole).toBe("fanggu");
    expect(once(next)).toEqual({ known: true, value: false });
  });

  it("drunk or poisoned: the choice is made and nothing happens; ONCE stays unrecorded", () => {
    for (const type of ["drunk", "poisoned"]) {
      const g = impair(proofGame(ROLES), "p0", type);
      for (const target of ["p2", "p5"]) {
        const next = planned(attack(g, target));
        expect(next.players).toEqual(g.players);
        expect(step(next, "p0", "fanggu")).toBe("done");
        expect(once(next)).toEqual({ known: true, value: false });
      }
    }
  });
});

describe("Fang Gu -- the first Outsider it kills", () => {
  it("the Fang Gu dies instead; the Outsider becomes an evil Fang Gu, told; ONCE is recorded; the new Fang Gu does not attack again tonight", () => {
    const g = proofGame(ROLES);
    const next = jumped();
    expect(next.players.p0!.alive).toBe(false);
    expect(deadTokens(next, "p0")).toHaveLength(1);
    expect(next.players.p5).toMatchObject({ alive: true, actualRole: "fanggu", shownRole: "fanggu", actualAlignment: "evil", shownAlignment: null });
    // The Outsider did not die: no death is recorded for them.
    expect(next.lifeEventWindow.events.filter((e) => e.subject.participantId === pid(g, "p5"))).toEqual([]);
    expect(next.lifeEventWindow.events.at(-1)).toMatchObject({ kind: "death", subject: expect.objectContaining({ playerId: "p0" }), actualRoleAtEvent: "fanggu" });
    expect(next.gameRuleFacts).toEqual([expect.objectContaining({ type: FANG_GU_ONCE })]);
    expect(next.gameRuleFacts[0]!.expiresAt).toBeUndefined();
    expect(once(next)).toEqual({ known: true, value: true });
    expect(step(next, "p5", "fanggu")).toBe("skipped");
    expect(plan(next, request(next, "p5", "fanggu", { [FANG_GU_TARGET]: pick(next, "p2") }))).toMatchObject({ ok: false, code: "notApplicable" });
    expect(gameRuleFactDefinition(FANG_GU_ONCE)).toMatchObject({ label: "ONCE", expiry: "none", applicablePhases: ["night"] });
  });

  it("ONCE stays: the new Fang Gu's Outsider kill is an ordinary death, and the row says ONCE is recorded", () => {
    const later = nextNight(jumped());
    const next = planned(attack(later, "p1", {}, "p5"));
    expect(next.players.p1!.alive).toBe(false);
    expect(next.players.p5!.actualRole).toBe("fanggu");
    const row = computeNightOrder(later.players, later.seatOrder, proofScript, false, later).find((s) => s.kind === "player" && s.playerId === "p5");
    expect(row?.advisory).toContain("ONCE: a Fang Gu has already taken an Outsider's place. An Outsider it kills now dies.");
    const fresh = proofGame(ROLES);
    const freshRow = computeNightOrder(fresh.players, fresh.seatOrder, proofScript, false, fresh).find((s) => s.kind === "player" && s.playerId === "p0");
    expect(freshRow?.advisory ?? "").not.toContain("ONCE");
    // "Don't remove it, even if the Fang Gu dies or changes character."
    const gone = patchPlayer(patchPlayer(later, "p5", { alive: false }), "p0", { actualRole: "chef", shownRole: "chef" });
    expect(once(gone)).toEqual({ known: true, value: true });
  });

  it("an Outsider who does not die (Monk) does not become the Fang Gu, and the Fang Gu does not die", () => {
    const g = protect(proofGame(ROLES), "p5");
    const result = attack(g, "p5");
    const next = result.ok && result.changed ? result.plan.game : g;
    expect(next.players.p5!.actualRole).toBe("mutant");
    expect(next.players.p0!.alive).toBe(true);
    expect(once(next)).toEqual({ known: true, value: false });
  });

  it("a Fang Gu who cannot die tonight (the Monk protects it) while the jump would happen: by hand", () => {
    const g = protect(proofGame(ROLES), "p0");
    expect(attack(g, "p5")).toMatchObject({ ok: false, code: "unsupported", message: expect.stringContaining("cannot die tonight") });
  });

  it("a Recluse or a Spy (who might register as an Outsider or not): the Storyteller's ruling; a drunk Recluse is an Outsider without a question", () => {
    const g = patchPlayer(proofGame(ROLES), "p6", { actualRole: "recluse", shownRole: "recluse", actualAlignment: "good" });
    const id = fangGuRegistersAsOutsiderId(pid(g, "p6"));
    expect(requirementIds(attack(g, "p6"))).toEqual([id]);
    expect(attack(g, "p6")).toMatchObject({ message: "Player 6 might register as an Outsider." });
    const no = planned(attack(g, "p6", { [id]: { kind: "boolean", value: false } }));
    expect(no.players.p6).toMatchObject({ alive: false, actualRole: "recluse" });
    const yes = planned(attack(g, "p6", { [id]: { kind: "boolean", value: true } }));
    expect(yes.players.p6).toMatchObject({ alive: true, actualRole: "fanggu", actualAlignment: "evil" });
    expect(yes.players.p0!.alive).toBe(false);
    const drunk = impair(g, "p6", "drunk");
    expect(planned(attack(drunk, "p6")).players.p6!.actualRole).toBe("fanggu");
    const spy = patchPlayer(proofGame(ROLES), "p6", { actualRole: "spy", shownRole: "spy", actualAlignment: "evil" });
    const spyId = fangGuRegistersAsOutsiderId(pid(spy, "p6"));
    expect(requirementIds(attack(spy, "p6"))).toEqual([spyId]);
    const spyJump = planned(attack(spy, "p6", { [spyId]: { kind: "boolean", value: true } }));
    expect(spyJump.players.p6).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
    // Once ONCE is recorded nothing is asked: every target dies the same way.
    const after = nextNight(patchPlayer(jumped(), "p6", { actualRole: "recluse", shownRole: "recluse", actualAlignment: "good" }));
    expect(planned(attack(after, "p6", {}, "p5")).players.p6!.alive).toBe(false);
  });

  it("a concealed identity (the Drunk, an Outsider who thinks they are a Townsfolk): the jump is by hand", () => {
    const g = patchPlayer(proofGame(ROLES), "p6", { actualRole: "drunk", shownRole: "dreamer", behaviorMode: "drunk_fake_role_behavior" });
    expect(attack(g, "p6")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a jump done by hand records no ONCE: while a Fang Gu has died this game, the Storyteller says whether ONCE already happened; Yes kills and records ONCE in one commit, No jumps", () => {
    // A jump resolved by hand last night: the old Fang Gu (p0) is dead, the Drunk (p6) is now the Fang Gu, ONCE was never recorded.
    const g = patchPlayer(patchPlayer(proofGame(ROLES), "p0", { alive: false }), "p6", { actualRole: "fanggu", shownRole: "fanggu", actualAlignment: "evil" });
    expect(once(g)).toEqual({ known: true, value: false });
    expect(requirementIds(attack(g, "p5", {}, "p6"))).toEqual([FANG_GU_ONCE_BY_HAND]);
    expect(attack(g, "p5", {}, "p6")).toMatchObject({ message: "A Fang Gu has died this game, but ONCE is not recorded." });
    const yes = planned(attack(g, "p5", { [FANG_GU_ONCE_BY_HAND]: { kind: "boolean", value: true } }, "p6"));
    expect(yes.players.p5).toMatchObject({ alive: false, actualRole: "mutant" });
    expect(yes.players.p6!.alive).toBe(true);
    expect(once(yes)).toEqual({ known: true, value: true });
    expect(deadTokens(yes, "p5")).toHaveLength(1);
    const no = planned(attack(g, "p5", { [FANG_GU_ONCE_BY_HAND]: { kind: "boolean", value: false } }, "p6"));
    expect(no.players.p5).toMatchObject({ alive: true, actualRole: "fanggu", actualAlignment: "evil" });
    expect(no.players.p6!.alive).toBe(false);
    expect(once(no)).toEqual({ known: true, value: true });
    // Not asked: a non-Outsider target, or no Fang Gu has died.
    expect(planned(attack(g, "p2", {}, "p6")).players.p2!.alive).toBe(false);
    expect(requirementIds(attack(proofGame(ROLES), "p5"))).toEqual([]);
  });

  it("a Traveller or an unrecorded alignment in the jump: by hand", () => {
    const traveller = patchPlayer(proofGame(ROLES), "p5", { isTraveler: true });
    expect(attack(traveller, "p5")).toMatchObject({ ok: false, code: "unsupported" });
    const unrecorded = patchPlayer(proofGame(ROLES), "p5", { actualAlignment: undefined });
    expect(attack(unrecorded, "p5")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a Scarlet Woman in play: the official jinx keeps the Fang Gu's action by hand", () => {
    const g = patchPlayer(proofGame(ROLES), "p6", { actualRole: "scarletwoman", shownRole: "scarletwoman", actualAlignment: "evil" });
    for (const target of ["p2", "p5"]) expect(attack(g, target), target).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Fang Gu -- with the other Sects & Violets characters", () => {
  it("Sweetheart: becoming the Fang Gu is not a death, so she makes nobody drunk; a later kill as an Outsider does", () => {
    const g = proofGame(ROLES);
    const next = planned(attack(g, "p1"));
    expect(next.players.p1!.actualRole).toBe("fanggu");
    expect(nightTriggerStatus(SWEETHEART, bind(next, "p1"), proofQuery(next))).toMatchObject({ kind: "notTriggered" });
    const later = nextNight(jumped());
    const killed = planned(attack(later, "p1", {}, "p5"));
    expect(nightTriggerStatus(SWEETHEART, bind(killed, "p1"), proofQuery(killed))).toMatchObject({ kind: "triggered" });
  });

  it("Sage: killed by the Fang Gu, the Sage's step needs no question", () => {
    const next = planned(attack(proofGame(ROLES), "p4"));
    expect(nightTriggerStatus(SAGE, bind(next, "p4"), proofQuery(next))).toMatchObject({ kind: "triggered" });
    const sage = plan(next, request(next, "p4", "sage", { [SAGE_PLAYERS]: pick(next, "p0", "p2") }, { invocationPath: "nightTrigger", withStep: true, completeStep: true }));
    expect(sage).toMatchObject({ ok: true, changed: true });
  });

  it("Snake Charmer: a Snake Charmer who chooses the Fang Gu becomes the evil Fang Gu; the old Fang Gu becomes the good, poisoned Snake Charmer; ONCE is not touched", () => {
    const g = patchPlayer(proofGame(ROLES), "p6", { actualRole: "snakecharmer", shownRole: "snakecharmer", actualAlignment: "good" });
    const next = planned(plan(g, request(g, "p6", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, "p0") }, { withStep: true, completeStep: true })));
    expect(next.players.p6).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
    expect(next.players.p0).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
    expect(once(next)).toEqual({ known: true, value: false });
    // Wiki example: a Pit-Hag'd (evil) Snake Charmer who chooses the Fang Gu -- both remain evil.
    const evil = patchPlayer(g, "p6", { actualAlignment: "evil", shownAlignment: "evil" });
    const both = planned(plan(evil, request(evil, "p6", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(evil, "p0") }, { withStep: true, completeStep: true })));
    expect([both.players.p6!.actualAlignment, both.players.p0!.actualAlignment]).toEqual(["evil", "evil"]);
  });
});

describe("Fang Gu -- the Pit-Hag", () => {
  it("a Pit-Hag who makes a Fang Gu is now guided like any Demon it makes (deaths tonight are arbitrary); ONCE is not touched", () => {
    const g = proofGame(["pithag", "imp", "clockmaker", "monk", "mutant"]);
    const next = planned(plan(g, request(g, "p0", "pithag", { target: pick(g, "p2"), character: { kind: "character", roleIds: ["fanggu"] } })));
    expect(next.players.p2).toMatchObject({ actualRole: "fanggu", actualAlignment: "good" });
    expect(next.gameRuleFacts.map((f) => f.type)).toEqual(["pitHagArbitraryDeaths"]);
    expect(once(next)).toEqual({ known: true, value: false });
  });
});

describe("Fang Gu -- one commit, Undo, reload, and what the phones see", () => {
  it("one commit; Undo restores the death, the character, the alignment, ONCE and the steps together", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "fanggu", { [FANG_GU_TARGET]: pick(g, "p5") }, { withStep: true, completeStep: true })))
      .toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(game().players.p5!.actualRole).toBe("fanggu");
    store.getState().undo();
    const without = (x: StorytellerLobbyRecord) => Object.fromEntries(Object.entries(x.players).map(([id, p]) => [id, { ...p, revealToken: null }]));
    expect(without(game())).toEqual(without(g));
    expect(game().gameRuleFacts).toEqual([]);
    expect(game().nightProgress).toEqual(g.nightProgress);
    expect(game().lifeEventWindow).toEqual(g.lifeEventWindow);
  });

  it("a saved and reloaded game keeps the jump and ONCE (same stored format)", () => {
    const next = jumped();
    const parsed = StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(next)));
    expect(parsed.success).toBe(true);
    const reloaded = parsed.data as unknown as StorytellerLobbyRecord;
    expect(reloaded.gameSchemaVersion).toBe(next.gameSchemaVersion);
    expect(once(reloaded)).toEqual({ known: true, value: true });
    expect(reloaded.players.p5).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
  });

  it("only the converted Outsider's own view changes to the Fang Gu and evil, with no Minion list; nothing new reaches the public view", () => {
    const g = proofGame(ROLES);
    const next = jumped();
    const before = projectLobbyToSelfMap(g, proofRegistry), after = projectLobbyToSelfMap(next, proofRegistry);
    for (const id of ["p1", "p2", "p3", "p4", "p6"]) expect(after[id]).toEqual(before[id]);
    expect(after.p5).toMatchObject({ shownRole: "fanggu", shownAlignment: "evil" });
    expect(JSON.stringify(after.p5)).not.toMatch(/monk|clockmaker|sweetheart|"p0"|once/i);
    const pub = JSON.stringify(projectLobbyToPublic(next, {}));
    expect(pub).not.toMatch(/fanggu|mutant|once/i);
    // During the Night the Public Display shows nothing new at all (the death is public only as the table learns it).
    expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
  });
});
