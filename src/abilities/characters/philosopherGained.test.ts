// SV-3b -- the Philosopher runs a gained Snake Charmer, Town Crier or Oracle exactly as the real character's step (PO decision Q2 A).
// "If the Philosopher gains an ability that works at night, they wake when that character would wake."
// https://wiki.bloodontheclocktower.com/Philosopher ; Snake Charmer page: "If the Philosopher has the Snake Charmer ability and becomes
// the Demon, the Demon becomes a poisoned Philosopher." Production semantics, the real coordinator and the real store.
import { beforeEach, describe, expect, it } from "vitest";
import { PHILOSOPHER_CHARACTER } from "./philosopher";
import { SNAKE_CHARMER_TARGET } from "./snakecharmer";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { planInformationDelivery, planManualInformationDelivery } from "@/stores/informationDelivery";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { gainedRoleOf } from "@/stores/gainedAbility";
import { runsGainedAbility } from "./passiveRules";
import { charactersToReveal } from "@/features/grimoire-v6/night/newCharacters";
import { playerMarks } from "@/features/grimoire-v6/board/marks";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";

const game = () => store.getState().game!;
const pid = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.participantId!;
const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
const step = { withStep: true, completeStep: true } as const;
/** Night `day - 1`: the Philosopher (p0) chooses `roleId`; then the clock moves to Night `day`. */
function gained(roles: string[], roleId: string, day = 3): StorytellerLobbyRecord {
  const g = proofGame(roles, "night", day - 1);
  const chosen = planned(plan(g, request(g, "p0", "philosopher", { [PHILOSOPHER_CHARACTER]: character(roleId) }, step)));
  expect(gainedRoleOf(chosen.players.p0)).toBe(roleId);
  return { ...chosen, day };
}
const charm = (g: StorytellerLobbyRecord, target: string, actor = "p0") =>
  plan(g, request(g, actor, "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, target) }, step));
const functions = (g: StorytellerLobbyRecord, id: string) => proofQuery(g).abilityFunctions(bind(g, id));
const status = (g: StorytellerLobbyRecord, id: string, roleId: string) => g.nightProgress[`${g.day}:${participantStepKey(pid(g, id), roleId)}`]?.status;
const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
const round = (g: StorytellerLobbyRecord, nominator: string, nominee: string): VotingRound => {
  const order = [ref(g, nominator), ref(g, nominee)];
  return { id: `r-${nominator}-${nominee}`, mode: "nomination", nominator: ref(g, nominator), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: "no" as const, weight: 0, spentGhostVote: false, refundSafe: false, lifeSafe: true })),
    threshold: 3, status: "acknowledged", result: "belowThreshold", tally: 0, virginPending: false, contextStamp: "", executionEventIds: [] };
};
const withVoting = (g: StorytellerLobbyRecord, day: number, rounds: VotingRound[]): StorytellerLobbyRecord =>
  ({ ...g, voting: { day, revision: 1, coverage: "known", rounds, activeRoundId: null, block: null, modifiers: [] } });

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

// p0 philosopher, p1 fanggu, p2 dreamer, p3 clockmaker, p4 witch
const SC = ["philosopher", "fanggu", "dreamer", "clockmaker", "witch"];

describe("SV-3b -- which gained abilities the app runs", () => {
  it("exactly the Snake Charmer, the Town Crier and the Oracle (PO Q2: the same step as the real character)", () => {
    expect(["snakecharmer", "towncrier", "oracle"].every(runsGainedAbility)).toBe(true);
    for (const roleId of ["dreamer", "clockmaker", "mathematician", "flowergirl", "savant", "seamstress", "artist", "juggler", "sage", "sweetheart", "barber", "klutz", "mutant", "philosopher"]) {
      expect(runsGainedAbility(roleId), roleId).toBe(false);
    }
  });

  it("another gained ability with verified rules is refused as the Philosopher's (the Sage): it stays the Storyteller's", () => {
    const g = gained(SC, "sage");
    expect(plan(g, request(g, "p0", "sage", {}, step))).toMatchObject({ ok: false, code: "invalid" });
  });

  it("a Philosopher who has not gained the Snake Charmer has no Snake Charmer ability", () => {
    const g = proofGame(SC, "night", 3);
    expect(charm(g, "p1")).toMatchObject({ ok: false, code: "invalid" });
    const other = gained(SC, "towncrier");
    expect(charm(other, "p1")).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("SV-3b -- a gained Snake Charmer", () => {
  it("chooses the Demon: the Philosopher becomes the Demon, the Demon becomes a poisoned Philosopher, fresh (PO Q4); one commit", () => {
    const g = gained(SC, "snakecharmer");
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "snakecharmer", { [SNAKE_CHARMER_TARGET]: pick(g, "p1") }, step))).toMatchObject({ ok: true, changed: true });
    const next = game();
    expect(next.players.p0).toMatchObject({ actualRole: "fanggu", actualAlignment: "evil" });
    expect(next.players.p1).toMatchObject({ actualRole: "philosopher", actualAlignment: "good", abilityUsed: false });
    // The new Philosopher is poisoned for good; nothing is gained.
    expect(functions(next, "p1")).toEqual({ known: true, value: false });
    expect(gainedRoleOf(next.players.p1)).toBeNull();
    // The old Philosopher's gain ended with the change of character.
    expect(gainedRoleOf(next.players.p0)).toBeNull();
    expect(next.players.p0!.effects.some((e) => e.type === "gainedAbility" && e.state === "active")).toBe(false);
    // Tonight: the gained step is done, the new Philosopher does not choose tonight (its place has passed).
    expect(status(next, "p0", "snakecharmer")).toBe("done");
    expect(status(next, "p1", "philosopher")).toBe("skipped");
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(game().players.p0).toMatchObject({ actualRole: "philosopher" });
    expect(gainedRoleOf(game().players.p0)).toBe("snakecharmer");
    expect(game().players.p1).toMatchObject({ actualRole: "fanggu" });
  });

  it("the Storyteller wakes both changed players with YOU ARE on the gained Snake Charmer's row", () => {
    const next = planned(charm(gained(SC, "snakecharmer"), "p1"));
    const woken = charactersToReveal(next, "snakecharmer", { participantId: pid(next, "p0") }).map((p) => [p.id, p.actualRole]);
    expect(woken).toEqual([["p0", "fanggu"], ["p1", "philosopher"]]);
  });

  it("chooses someone who is not the Demon, or themself: nothing happens, the step closes", () => {
    const g = gained(SC, "snakecharmer");
    for (const target of ["p2", "p0"]) {
      const next = planned(charm(g, target));
      expect(next.players).toEqual(g.players);
      expect(status(next, "p0", "snakecharmer")).toBe("done");
    }
  });

  it("a drunk or poisoned Philosopher: the choice is made and nothing happens", () => {
    const g = impair(gained(SC, "snakecharmer"), "p0", "poisoned");
    const next = planned(charm(g, "p1"));
    expect(next.players).toEqual(g.players);
  });

  it("the real Snake Charmer is drunk while the Philosopher has its ability: its choice of the Demon does nothing", () => {
    const g = gained(["philosopher", "fanggu", "snakecharmer", "clockmaker", "witch"], "snakecharmer");
    expect(proofQuery(g).gainedAbilityDrunk(bind(g, "p2"))).toEqual({ known: true, value: true });
    const next = planned(charm(g, "p1", "p2"));
    expect(next.players).toEqual(g.players);
    // The Philosopher's own choice swaps.
    expect(planned(charm(g, "p1")).players.p0!.actualRole).toBe("fanggu");
  });

  it("the gained row is at the Snake Charmer's place, after the Philosopher's", () => {
    const g = gained(SC, "snakecharmer");
    const order = computeNightOrder(g.players, g.seatOrder, proofScript, false, g).flatMap((s) => s.kind === "player" ? [`${s.playerId}:${s.effectiveRoleId}`] : []);
    expect(order).toContain("p0:snakecharmer");
    expect(order).not.toContain("p0:philosopher");
  });

  it("phones: each swapped player sees only their new character and alignment; the public view does not change", () => {
    const g = gained(SC, "snakecharmer");
    const next = planned(charm(g, "p1"));
    const before = projectLobbyToSelfMap(g, proofRegistry), after = projectLobbyToSelfMap(next, proofRegistry);
    for (const id of ["p2", "p3", "p4"]) expect(after[id]).toEqual(before[id]);
    expect(after.p0).toMatchObject({ shownRole: "fanggu", shownAlignment: "evil" });
    expect(after.p1).toMatchObject({ shownRole: "philosopher", shownAlignment: "good" });
    expect(JSON.stringify(after.p1)).not.toMatch(/poison|snakecharmer/i);
    expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
  });
});

// p0 philosopher, p1 chef, p2 empath, p3 monk, p4 imp, p5 saint, p6 baron
const TC = ["philosopher", "chef", "empath", "monk", "imp", "saint", "baron"];

describe("SV-3b -- a gained Town Crier and a gained Oracle", () => {
  it("the Town Crier: learns YES when a Minion nominated; the delivery records the Philosopher performing the Town Crier", () => {
    const base = gained(TC, "towncrier");
    const g = withVoting(base, 2, [round(base, "p6", "p1")]);
    const next = planned(plan(g, request(g, "p0", "towncrier", {}, step)));
    const delivery = next.informationDeliveries.at(-1)!;
    expect(delivery).toMatchObject({ actualRole: "philosopher", performedRole: "towncrier", informationActionId: "towncrier-other-night" });
    expect(JSON.stringify(delivery)).toContain('"value":true');
    expect(status(next, "p0", "towncrier")).toBe("done");
  });

  it("the Town Crier's official tokens are drawn for a Philosopher who has its ability", () => {
    const base = gained(TC, "towncrier");
    const g = withVoting(base, 2, [round(base, "p6", "p1")]);
    const keys = playerMarks({ game: g, script: proofScript, registry: proofRegistry, query: proofQuery(g) }, g.players.p0!).map((m) => m.key);
    expect(keys).toContain("derived:towncrier-nominations");
  });

  it("the Oracle: counts the dead evil players; the delivery records the Philosopher performing the Oracle", () => {
    const g = patchPlayer(patchPlayer(gained(TC, "oracle"), "p4", { alive: false }), "p6", { alive: false });
    const next = planned(plan(g, request(g, "p0", "oracle", {}, step)));
    const delivery = next.informationDeliveries.at(-1)!;
    expect(delivery).toMatchObject({ actualRole: "philosopher", performedRole: "oracle", informationActionId: "oracle-other-night" });
    expect(JSON.stringify(delivery)).toContain('"value":2');
  });

  it("an impaired Philosopher is told the Storyteller's answer, as the real one", () => {
    const g = impair(gained(TC, "oracle"), "p0", "drunk");
    expect(plan(g, request(g, "p0", "oracle", {}, step))).toMatchObject({ ok: false, code: "needsInput" });
    const told = planned(plan(g, request(g, "p0", "oracle", { communicated: { kind: "number", value: 3 } }, step)));
    expect(JSON.stringify(told.informationDeliveries.at(-1))).toContain('"value":3');
  });

  it("with the Vortox in play, a gained Oracle is handled exactly as the real Oracle is", () => {
    const real = proofGame(["oracle", "vortox", "chef", "empath", "monk"], "night", 3);
    const g = gained(["philosopher", "vortox", "chef", "empath", "monk"], "oracle");
    const strip = (result: ReturnType<typeof plan>) => result.ok ? { ok: true } : { ok: false, code: result.code, message: result.message };
    expect(strip(plan(g, request(g, "p0", "oracle", {}, step)))).toEqual(strip(plan(real, request(real, "p0", "oracle", {}, step))));
  });

  it("a delivery may name a performed character only when the player has that ability (gained) or is shown it (simulated)", () => {
    const g = gained(TC, "oracle");
    const env = { registry: proofRegistry };
    expect(planInformationDelivery(g, { recipientPlayerId: "p0", informationActionId: "oracle-other-night", performedRole: "oracle",
      values: [{ requirementId: "deadEvil", kind: "number", value: 0 }] }, env)).toMatchObject({ ok: true });
    expect(planInformationDelivery(g, { recipientPlayerId: "p0", informationActionId: "towncrier-other-night", performedRole: "towncrier",
      values: [{ requirementId: "minionNominated", kind: "boolean", value: false }] }, env)).toMatchObject({ ok: false });
    expect(planManualInformationDelivery(g, { recipientPlayerId: "p0", text: "Two", performedRole: "oracle" }, { ...env, workflowRole: "oracle" })).toMatchObject({ ok: true });
    expect(planManualInformationDelivery(g, { recipientPlayerId: "p0", text: "Two", performedRole: "dreamer" }, { ...env, workflowRole: "dreamer" })).toMatchObject({ ok: false });
  });
});
