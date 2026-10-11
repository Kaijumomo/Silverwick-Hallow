import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { buildRegistry } from "@/data/roleRegistry";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs } from "@/abilities/semantics";
import { deriveNightWork, stepResolved } from "@/features/nightOrder/nightWork";
import { request } from "@/test/proofFixtures";
import { captureCharacterActionContext, captureVotingContext, useStorytellerStore as store } from "./storytellerStore";
import { currentVoter, currentVotingState } from "./voting";
import { preparedInformationContext } from "./preparedInformation";
import { butlerSelectionContext } from "./butlerSelection";
import { StorytellerGamePersistedSchema } from "./schemas";
import { endGameEligibility } from "./endGameEligibility";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { usePrivacyStore } from "./privacyStore";
import { useShellStore } from "./shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import type { VotingIntent } from "./votingTypes";

// Independent acceptance trajectories. Games are created, seated, dealt,
// revealed and advanced using production commands. No live game snapshots,
// deaths, roles, effects, phase jumps or outcomes are seeded via setState.
const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(troubleBrewing);
const environment = { script: troubleBrewing, registry, semantics: CANONICAL_ABILITY_SEMANTICS };
const id = (role: string) => Object.values(game().players).find(player => player.actualRole === role && player.alive)?.id
  ?? Object.values(game().players).find(player => player.actualRole === role)?.id!;
const binding = (playerId: string) => ({ playerId, participantId: game().players[playerId]!.participantId! });
const target = (playerId: string) => ({ kind: "participant" as const, participants: [binding(playerId)] });
const ok = (result: { ok: boolean; message?: string }) => expect(result, result.message).toMatchObject({ ok: true });
const advance = () => ok(state().advancePhase(captureVotingContext()));
type Vote = VotingIntent extends infer T ? T extends VotingIntent ? Omit<T, "code" | "day" | "expectedRevision"> : never : never;
const vote = (action: Vote) => state().resolveVoting({ ...action, code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision } as VotingIntent, captureVotingContext());
const work = () => deriveNightWork(game(), environment);

function setup(roles: string[]) {
  state().newGame(troubleBrewing.id, { plannedPlayerCount: roles.length, plannedTravelerCount: 0 });
  for (let index = 0; index < roles.length; index++) state().addPlayerToSeat(`Player ${index + 1}`);
  state().setRolePool(roles);
  ok(state().dealRolePool());
  expect(Object.values(game().players).map(player => player.actualRole).sort()).toEqual([...roles].sort());
  for (const player of Object.values(game().players)) {
    if (player.actualRole === "drunk") state().setShownRole(player.id, "chef");
    else state().showAssignedRole(player.id);
  }
  ok(state().revealRoles());
  if (roles.length >= 7) state().setBluffs(id("imp"), ["washerwoman", "fortuneteller", "investigator"]);
  expect(game().setupRolesDealt).toBe(true); expect(game().setupRolesRevealed).toBe(true);
  expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
}

function begin() {
  ok(state().beginNightOne());
  const globals = work().steps.filter(step => step.kind === "global").map(step => step.stepKey);
  if (game().seatOrder.length < 7) {
    expect(globals).toContain("smallGameInfo"); expect(globals).not.toContain("minionInfo"); expect(globals).not.toContain("demonInfo");
  } else { expect(globals).toContain("minionInfo"); expect(globals).toContain("demonInfo"); }
}

function pairPreparation(sourceRole: "librarian", qualifyingRole: string, wrongRole: string) {
  const source = id(sourceRole), qualifying = id(qualifyingRole), wrong = id(wrongRole);
  ok(state().prepareInformation({ character: sourceRole, source: binding(source), expected: preparedInformationContext(game(), troubleBrewing),
    clue: { kind: "pair", candidates: [binding(qualifying), binding(wrong)], shownCharacter: qualifyingRole, qualifyingParticipantId: binding(qualifying).participantId } }, captureCharacterActionContext()));
}
function deliverPreparation() {
  const prepared = game().preparedInformation[0]!;
  ok(state().deliverPreparedInformation({ preparationId: prepared.id, source: binding(id("librarian")), expected: preparedInformationContext(game(), troubleBrewing) }, captureCharacterActionContext()));
  expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "role", kind: "role", roleId: "drunk" });
  expect(game().players[id("drunk")]!.shownRole).toBe("chef");
}
function ability(role: string, inputs: AbilityInputs = {}, actor = id(role)) {
  return state().resolveAbility(request(game(), actor, role, inputs, { withStep: game().phase === "night", completeStep: game().phase === "night",
    invocationPath: role === "ravenkeeper" ? "nightTrigger" : game().phase === "day" ? "dayEntry" : "nightOrder" }), undefined, captureCharacterActionContext());
}
function choose(role: string, chosen: string) { ok(ability(role, { target: target(chosen) })); }

/** Only specifically named manual procedures may be acknowledged via Next.
 * A forgotten deterministic character action fails this acceptance test. */
function dawn(manualRoles: string[] = []) {
  for (const step of work().steps) {
    if (stepResolved(game(), step)) continue;
    if (step.kind === "player") expect(manualRoles, `Unperformed ${step.effectiveRoleId} on Night ${game().day}`).toContain(step.effectiveRoleId);
    else expect(["smallGameInfo", "minionInfo", "demonInfo"], `Unexpected manual procedure ${step.stepKey}`).toContain(step.stepKey);
    ok(state().setNightStepStatus(game().day, step.stepKey, "done", captureCharacterActionContext()));
  }
  expect(work().steps.every(step => stepResolved(game(), step))).toBe(true);
  advance(); expect(game().phase).toBe("day");
}
function markManual(role: string) {
  const step = work().steps.find(step => step.kind === "player" && step.effectiveRoleId === role)!;
  expect(step).toBeDefined(); ok(state().setNightStepStatus(game().day, step.stepKey, "done", captureCharacterActionContext()));
}
function ballot(executee: string, ghost?: string) {
  const roundId = `day-${game().day}-ballot`;
  const nominator = Object.values(game().players).find(player => player.alive && player.id !== executee)!.id;
  ok(vote({ kind: "begin", roundId, mode: "nomination", nominator: binding(nominator), nominee: binding(executee) }));
  for (let attempts = 0; currentVoter(game()) && attempts < 30; attempts++) {
    const voter = currentVoter(game())!;
    ok(vote({ kind: "respond", roundId, voter, choice: "yes" }));
  }
  expect(currentVoter(game())).toBeNull();
  expect(game().voting!.rounds.at(-1)!.result).toBe("block");
  if (ghost) expect(game().players[ghost]!.ghostVote).toBe(false);
  ok(vote({ kind: "acknowledge", roundId }));
  ok(vote({ kind: "execution", target: binding(executee), outcome: "died" }));
  expect(game().players[executee]!.alive).toBe(false);
}
async function reload() {
  const before = structuredClone(game()); const saved = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
  expect(game()).toEqual(before); expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
}
function privateProjection() {
  const exposed = JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), registry)]);
  expect(exposed).not.toMatch(/gameRuleFacts|sourceParticipant|lifeEventWindow|informationDeliveries|preparedInformation|safeFromDemon|resolvedDemonDeathNoSuccessor/);
}
async function finish(winner: "good" | "evil" = "good") {
  expect(endGameEligibility(game(), environment)).toMatchObject({ kind: "verified", team: winner });
  privateProjection(); const live = structuredClone(game());
  ok(state().finishGame({ kind: "declare", winner })); expect(game().phase).toBe("ended");
  await reload(); ok(state().undoFinishedGame()); expect(game()).toEqual(live);
  ok(state().finishGame({ kind: "declare", winner })); expect(game().result).toMatchObject({ winner });
}
beforeEach(() => {
  localStorage.clear(); useShellStore.getState().reset(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false, sync: null });
});
afterEach(() => vi.restoreAllMocks());

describe("B9 independent complete Trouble Brewing games", () => {
  it.each(["good", "evil"] as const)("5 players: first Night information, poisoned Monk, ghost vote, protection, correction/reload and %s declaration", async winner => {
    setup(["chef", "monk", "undertaker", "poisoner", "imp"]); begin();
    choose("poisoner", id("undertaker")); ok(ability("chef")); expect(game().informationDeliveries).toHaveLength(1); dawn();
    advance(); expect(game().day).toBe(2);
    choose("poisoner", id("monk")); choose("monk", id("chef"));
    expect(game().players[id("chef")]!.effects.some(effect => effect.type === "safeFromDemon")).toBe(false);
    const before = game(); choose("imp", id("chef")); expect(game().players[id("chef")]!.alive).toBe(false);
    state().undo(); expect(game()).toEqual(before); choose("imp", id("chef"));
    const recordedDeath = game(); ok(state().correctLifeStatus(id("chef"), { alive: true }));
    expect(game().players[id("chef")]!.alive).toBe(true); state().undo(); expect(game()).toEqual(recordedDeath);
    await reload(); expect(ability("undertaker")).toMatchObject({ ok: false, code: "notApplicable" }); markManual("undertaker"); dawn();
    ballot(id("poisoner"), id("chef")); advance();
    const living = Object.values(game().players).filter(player => player.alive).length;
    choose("monk", id("undertaker")); choose("imp", id(winner === "evil" ? "monk" : "undertaker"));
    if (winner === "evil") { expect(Object.values(game().players).filter(player => player.alive)).toHaveLength(2); await finish("evil"); return; }
    expect(Object.values(game().players).filter(player => player.alive)).toHaveLength(living); ok(ability("undertaker"));
    expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "role", kind: "role", roleId: "poisoner" });
    dawn(); ballot(id("imp")); await finish();
  });

  it("6 players: actual setup Drunk clue, Slayer/SW succession, Undertaker execution information and recovered Good declaration", async () => {
    setup(["librarian", "undertaker", "slayer", "drunk", "scarletwoman", "imp"]);
    const oldImp = id("imp"), successor = id("scarletwoman"), drunk = id("drunk");
    pairPreparation("librarian", "drunk", "slayer"); begin(); deliverPreparation();
    ok(ability("chef", { communicated: { kind: "number", value: 1 } }, drunk));
    expect(game().informationDeliveries).toContainEqual(expect.objectContaining({ actualRole: "drunk", performedRole: "chef" })); dawn();
    const privateBefore = game(); usePrivacyStore.getState().setEnabled(true);
    expect(ability("slayer", { target: target(oldImp) })).toMatchObject({ ok: false }); expect(game()).toBe(privateBefore);
    usePrivacyStore.getState().reset();
    choose("slayer", oldImp); expect(game().players[oldImp]!.alive).toBe(false); expect(game().players[successor]!.actualRole).toBe("imp");
    expect(game().players[id("slayer")]!.abilityUsed).toBe(true); await reload(); ballot(drunk, oldImp); advance();
    choose("imp", id("slayer")); ok(ability("undertaker"));
    expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "role", kind: "role", roleId: "drunk" }); dawn();
    ballot(successor); await finish();
  });

  it("9 players: Baron composition, Drunk/Librarian, Butler, manual Mayor redirects and triggered Ravenkeeper through a complete game", async () => {
    setup(["librarian", "mayor", "ravenkeeper", "butler", "drunk", "recluse", "saint", "baron", "imp"]);
    const ravenkeeper = id("ravenkeeper"), mayor = id("mayor"), butler = id("butler");
    expect(Object.values(game().players).filter(player => registry.get(player.actualRole)?.type === "outsider")).toHaveLength(4);
    pairPreparation("librarian", "drunk", "mayor"); begin(); deliverPreparation();
    ok(ability("chef", { communicated: { kind: "number", value: 0 } }, id("drunk")));
    const master = () => ok(state().selectButlerMaster({ source: binding(butler), target: binding(mayor), expected: butlerSelectionContext(game(), troubleBrewing, binding(butler)) }, captureCharacterActionContext()));
    master(); dawn(); ballot(id("baron")); advance(); master();
    expect(ability("imp", { target: target(mayor) })).toMatchObject({ ok: false, code: "unsupported" });
    // Storyteller chooses Ravenkeeper as the actual redirected death target.
    ok(state().recordDeath(ravenkeeper, undefined, captureCharacterActionContext())); markManual("imp");
    choose("ravenkeeper", mayor); expect(game().informationDeliveries.at(-1)!.values).toContainEqual({ requirementId: "role", kind: "role", roleId: "mayor" });
    expect(game().players[mayor]!.alive).toBe(true); await reload(); dawn(); ballot(id("recluse"), ravenkeeper); advance(); master();
    expect(ability("imp", { target: target(mayor) })).toMatchObject({ ok: false, code: "unsupported" });
    ok(state().recordDeath(butler, undefined, captureCharacterActionContext())); markManual("imp"); dawn(); ballot(id("drunk")); advance();
    // This time the Storyteller chooses Mayor as the actual death target.
    ok(state().recordDeath(mayor, undefined, captureCharacterActionContext())); markManual("imp"); dawn();
    ballot(id("imp")); await finish();
  });

  it("7 players: Spy direct-view/manual registration, Virgin execution, manual Undertaker, protection and final Good declaration", async () => {
    setup(["virgin", "undertaker", "chef", "monk", "soldier", "spy", "imp"]); begin();
    // Spy registration makes this Chef result a deliberate Storyteller choice.
    const chefResult = ability("chef");
    if (!chefResult.ok) {
      expect(chefResult.code).toBe("unsupported");
      ok(state().recordInformationDelivery(id("chef"), "chef-first-night", [{ requirementId: "pairs", kind: "number", value: 0 }])); markManual("chef");
    }
    // Direct viewing is a physical Storyteller procedure, not an app delivery.
    const deliveries = game().informationDeliveries.length; markManual("spy"); expect(game().informationDeliveries).toHaveLength(deliveries);
    privateProjection(); dawn();
    const spy = id("spy"), roundId = "spy-nominates-virgin";
    ok(vote({ kind: "begin", roundId, mode: "nomination", nominator: binding(spy), nominee: binding(id("virgin")) }));
    expect(game().voting!.rounds.at(-1)!.virginPending).toBe(true); expect(game().players[id("virgin")]!.abilityUsed).toBe(false);
    ok(vote({ kind: "virgin", roundId, execute: true, outcome: "died" })); ok(vote({ kind: "acknowledge", roundId }));
    expect(game().players[spy]!.alive).toBe(false); advance();
    choose("monk", id("soldier")); choose("imp", id("soldier"));
    expect(ability("undertaker")).toMatchObject({ ok: false, code: "unsupported" });
    ok(state().recordInformationDelivery(id("undertaker"), "undertaker-other-night", [{ requirementId: "role", kind: "role", roleId: "soldier" }])); markManual("undertaker"); dawn();
    advance(); choose("monk", id("soldier")); choose("imp", id("virgin"));
    expect(ability("undertaker")).toMatchObject({ ok: false, code: "notApplicable" }); markManual("undertaker"); dawn();
    ballot(id("imp"), spy); await finish();
  });
});
