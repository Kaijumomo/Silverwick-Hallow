// SV-6c / SV-6e: the shared harness of the Sects & Violets whole-game tests. Like b9WholeGames.test.ts, a game is created, seated, dealt (characters
// pinned to seats with the Storyteller's own pin command), revealed and advanced with production commands only: no setState seeding of roles,
// deaths, effects, phases or outcomes. Seat i holds roles[i], so every neighbour-dependent rule is placed on purpose.
import { expect } from "vitest";
import { sectsAndViolets } from "@/data/scripts/sectsAndViolets";
import { buildRegistry } from "@/data/roleRegistry";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs, type AbilityInputValue } from "@/abilities/semantics";
import { deriveNightWork, stepResolved } from "@/features/nightOrder/nightWork";
import { request } from "@/test/proofFixtures";
import { captureCharacterActionContext, captureVotingContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { currentVoter, currentVotingState } from "@/stores/voting";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import type { VotingIntent } from "@/stores/votingTypes";
import { createRulesQuery } from "@/stores/rulesQuery";
import { jugglerGuessVerdict, JUGGLER_CHARACTER, JUGGLER_CORRECT, JUGGLER_DONE, JUGGLER_GUESS, JUGGLER_GUESSED } from "@/abilities/characters/juggler";
import type { V6Ctx } from "@/features/grimoire-v6/ctx";
import type { StorytellerLobbyRecord } from "@/stores/types";

export const state = () => store.getState();
export const game = () => state().game!;
export const registry = buildRegistry(sectsAndViolets);
export const environment = { script: sectsAndViolets, registry, semantics: CANONICAL_ABILITY_SEMANTICS };
/** The seat of `role` (a living holder first). */
export const id = (role: string) => Object.values(game().players).find((player) => player.actualRole === role && player.alive)?.id
  ?? Object.values(game().players).find((player) => player.actualRole === role)?.id!;
export const seat = (index: number) => game().seatOrder[index]!;
export const binding = (playerId: string) => ({ playerId, participantId: game().players[playerId]!.participantId! });
export const target = (...playerIds: string[]): AbilityInputValue => ({ kind: "participant", participants: playerIds.map(binding) });
export const character = (roleId: string): AbilityInputValue => ({ kind: "character", roleIds: [roleId] });
export const number = (value: number): AbilityInputValue => ({ kind: "number", value });
export const ok = (result: { ok: boolean; message?: string }) => expect(result, result.message).toMatchObject({ ok: true });
export const advance = () => ok(state().advancePhase(captureVotingContext()));
export const work = () => deriveNightWork(game(), environment);
export const alive = () => Object.values(game().players).filter((player) => player.alive);

type Vote = VotingIntent extends infer T ? T extends VotingIntent ? Omit<T, "code" | "day" | "expectedRevision"> : never : never;
export const vote = (action: Vote) => state().resolveVoting({ ...action, code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision } as VotingIntent, captureVotingContext());

export function resetStores() {
  localStorage.clear(); useShellStore.getState().reset(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false, sync: null });
}

/** New game, one player per role, seat i pinned to roles[i], roles shown, Demon bluffs at 7 or more. */
export function setup(roles: string[], bluffs: string[] = ["washerwoman", "fortuneteller", "investigator"], afterDeal: () => void = () => undefined) {
  state().newGame(sectsAndViolets.id, { plannedPlayerCount: roles.length, plannedTravelerCount: 0 });
  for (let index = 0; index < roles.length; index++) state().addPlayerToSeat(`Player ${index + 1}`);
  const seats = game().seatOrder; expect(seats).toHaveLength(roles.length);
  state().setRolePool(roles);
  ok(state().dealRolePool(undefined, undefined, Object.fromEntries(seats.map((seatId, index) => [seatId, roles[index]!]))));
  expect(seats.map((seatId) => game().players[seatId]!.actualRole)).toEqual(roles);
  afterDeal();
  for (const player of Object.values(game().players)) state().showAssignedRole(player.id);
  ok(state().revealRoles());
  const demon = roles.find((role) => ["vortox", "fanggu", "vigormortis", "nodashii"].includes(role))!;
  if (roles.length >= 7) state().setBluffs(id(demon), bluffs);
  expect(game().setupRolesDealt).toBe(true); expect(game().setupRolesRevealed).toBe(true);
  expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
}

export function begin() {
  ok(state().beginNightOne());
  const globals = work().steps.filter((step) => step.kind === "global").map((step) => step.stepKey);
  if (game().seatOrder.length < 7) { expect(globals).toContain("smallGameInfo"); expect(globals).not.toContain("minionInfo"); }
  else { expect(globals).toContain("minionInfo"); expect(globals).toContain("demonInfo"); }
}

/** One character's ability through the production command. The Night step is completed when it is a Night step. */
/** Death-triggered characters are run from their trigger, not from a place of their own in the Night order. */
const TRIGGERED = ["ravenkeeper", "barber", "sweetheart", "sage"];
export function ability(role: string, inputs: AbilityInputs = {}, actor = id(role), extra: Record<string, unknown> = {}) {
  return state().resolveAbility(request(game(), actor, role, inputs, { withStep: game().phase === "night", completeStep: game().phase === "night",
    invocationPath: game().phase === "day" ? "dayEntry" : TRIGGERED.includes(role) ? "nightTrigger" : "nightOrder", ...extra } as never), undefined, captureCharacterActionContext());
}
export function choose(role: string, chosen: string, actor = id(role)) { ok(ability(role, { target: target(chosen) }, actor)); }

/** Answers the Storyteller's follow-up questions the way the Night card does: `answers` maps a requirement id's prefix to the value. */
export function answered(role: string, inputs: AbilityInputs, answers: Record<string, AbilityInputValue>, actor = id(role)) {
  let current = { ...inputs };
  for (let attempts = 0; attempts < 8; attempts++) {
    const result = ability(role, current, actor);
    if (result.ok) return result;
    if (result.code !== "needsInput") return result;
    const asked = (result.requirements ?? []).filter((requirement) => !(requirement.id in current));
    expect(asked.length, `${role} asked again for ${(result.requirements ?? []).map((requirement) => requirement.id)}`).toBeGreaterThan(0);
    for (const requirement of asked) {
      const key = Object.keys(answers).find((prefix) => requirement.id === prefix || requirement.id.startsWith(`${prefix}:`));
      expect(key, `${role}: no answer prepared for "${requirement.id}" (${requirement.label})`).toBeDefined();
      current = { ...current, [requirement.id]: answers[key!]! };
    }
  }
  throw new Error(`${role} never settled`);
}

/** Only specifically named manual procedures may be acknowledged with Done. A forgotten guided character action fails the test. */
export function dawn(manualRoles: string[] = []) {
  for (const step of work().steps) {
    if (stepResolved(game(), step)) continue;
    if (step.kind === "player") expect(manualRoles, `Unperformed ${step.effectiveRoleId} on Night ${game().day}`).toContain(step.effectiveRoleId);
    else expect(["smallGameInfo", "minionInfo", "demonInfo"], `Unexpected manual procedure ${step.stepKey}`).toContain(step.stepKey);
    ok(state().setNightStepStatus(game().day, step.stepKey, "done", captureCharacterActionContext()));
  }
  expect(work().steps.every((step) => stepResolved(game(), step))).toBe(true);
  advance(); expect(game().phase).toBe("day");
}
export function markManual(role: string) {
  const step = work().steps.find((candidate) => candidate.kind === "player" && candidate.effectiveRoleId === role)!;
  expect(step, `no Night step for ${role}`).toBeDefined(); ok(state().setNightStepStatus(game().day, step.stepKey, "done", captureCharacterActionContext()));
}

/** A nomination that is voted all the way through. `votes` decides who votes yes (default: everybody asked). */
export function nominate(roundId: string, nominator: string, nominee: string, votes: (voter: ReturnType<typeof currentVoter>) => "yes" | "no" = () => "yes") {
  ok(vote({ kind: "begin", roundId, mode: "nomination", nominator: binding(nominator), nominee: binding(nominee) }));
  for (let attempts = 0; currentVoter(game()) && attempts < 40; attempts++) {
    const voter = currentVoter(game())!;
    ok(vote({ kind: "respond", roundId, voter, choice: votes(voter) }));
  }
  expect(currentVoter(game())).toBeNull();
  const round = game().voting!.rounds.at(-1)!;
  ok(vote({ kind: "acknowledge", roundId }));
  return round;
}
/** Everybody votes yes on `executee`, then the execution is recorded as died. */
export function execute(executee: string, roundId = `day-${game().day}-ballot`) {
  const nominator = alive().find((player) => player.id !== executee)!.id;
  const round = nominate(roundId, nominator, executee);
  expect(round.result).toBe("block");
  ok(vote({ kind: "execution", target: binding(executee), outcome: "died" }));
  expect(game().players[executee]!.alive).toBe(false);
}

export async function reload() {
  const before = structuredClone(game()); const saved = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
  expect(game()).toEqual(before); expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
}

/** The Storyteller-only facts that must never reach the public or the self projections. */
export function privateProjection(extra: RegExp[] = []) {
  const exposed = JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), registry)]);
  expect(exposed).not.toMatch(/gameRuleFacts|sourceParticipant|lifeEventWindow|informationDeliveries|preparedInformation|safeFromDemon|resolvedDemonDeathNoSuccessor/);
  for (const pattern of extra) expect(exposed).not.toMatch(pattern);
  return exposed;
}

/** Declares the winner after the Storyteller's confirmation, checks Undo of the ending and a reload, and declares again. */
export async function declare(winner: "good" | "evil") {
  privateProjection(); const live = structuredClone(game());
  ok(state().finishGame({ kind: "declare", winner })); expect(game().phase).toBe("ended");
  await reload(); ok(state().undoFinishedGame()); expect(game()).toEqual(live);
  ok(state().finishGame({ kind: "declare", winner })); expect(game().result).toMatchObject({ winner });
  expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
}

export type Game = StorytellerLobbyRecord;

/** The game without the players' reveal tokens: by design Undo never restores an older reveal token (revealTokens.ts), so a role change
 * that is undone leaves a fresh one; everything else must be restored exactly. */
export const withoutRevealTokens = (g: StorytellerLobbyRecord) => ({ ...g, players: Object.fromEntries(Object.entries(g.players).map(([key, player]) => [key, { ...player, revealToken: undefined }])) });

/** The Storyteller screen's context over the live game (what the Day rows and the End control read); `privacy` is Privacy Mode. */
export const ctx = (privacy = false) => ({ game: game(), script: environment.script, registry: environment.registry, privacy }) as unknown as V6Ctx;
/** The seats (by role) that carry an Effect of this type. */
export const effects = (type: string) => Object.values(game().players).filter((player) => player.effects.some((effect) => effect.type === type)).map((player) => player.actualRole);
export const lastValues = () => game().informationDeliveries.at(-1)!.values;
export const visit = (playerId: string) => game().players[playerId]!;
/** The Night steps listed now, by character (or global step). */
export const order = () => work().steps.map((step) => step.kind === "player" ? step.effectiveRoleId : step.stepKey);
/** The Juggler's Day guess, recorded exactly as the Day row records it (one Effect on the Juggler, its correctness judged now). */
export function jugglerGuess(guessed: string, roleId: string) {
  const me = binding(id("juggler")), who = binding(guessed);
  const verdict = jugglerGuessVerdict(createRulesQuery(game(), { registry, script: sectsAndViolets, semantics: CANONICAL_ABILITY_SEMANTICS }), who, roleId);
  expect(verdict.kind).toBe("known");
  ok(state().resolveEffects({ intents: [{ kind: "apply", target: me, effect: { type: JUGGLER_GUESS, source: me, sourceCharacter: "juggler", lifetime: { kind: "untilDawn" },
    parameters: { [JUGGLER_GUESSED]: { kind: "participant", participants: [who] }, [JUGGLER_CHARACTER]: { kind: "role", roleIds: [roleId] }, [JUGGLER_CORRECT]: { kind: "boolean", value: verdict.kind === "known" && verdict.correct } } } }] }));
  return verdict.kind === "known" && verdict.correct;
}
/** The Juggler's Done pill: one Effect, as the Day row records it. */
export const jugglerDone = () => { const me = binding(id("juggler")); ok(state().resolveEffects({ intents: [{ kind: "apply", target: me, effect: { type: JUGGLER_DONE, source: me, sourceCharacter: "juggler", lifetime: { kind: "untilDawn" } } }] })); };
