import { beforeEach, describe, expect, it } from "vitest";
import { makeSTPlayer } from "@/test/fixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { useStorytellerStore as store } from "./storytellerStore";
import { currentVoter, currentVotingState, freshVotingDay, planVoting, reconcileVotingDependencies, voteWeight, votingContextChanged } from "./voting";
import { VotingDayStateSchema } from "./votingSchema";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import type { StorytellerLobbyRecord } from "./types";
import type { VotingBinding, VotingIntent } from "./votingTypes";

let game: StorytellerLobbyRecord;
const binding = (id: string): VotingBinding => ({ playerId: id, participantId: game.players[id]!.participantId! });
type Action = VotingIntent extends infer I ? I extends VotingIntent ? Omit<I, "code" | "day" | "expectedRevision"> : never : never;
function plan(action: Action) { return planVoting(game, { ...action, code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision } as VotingIntent, environment); }
function act(action: Action) {
  const result = plan(action);
  if (!result.ok) throw new Error(result.message);
  game = result.game;
  expect(VotingDayStateSchema.safeParse(game.voting).success).toBe(true);
  return result;
}
const script = BUILTIN_SCRIPTS.tb!;
const environment = { registry: buildRegistry(script), script };
function begin(id = "r1", from = "p0", to = "p2", mode: "nomination" | "exile" = "nomination") {
  act({ kind: "begin", roundId: id, nominator: binding(from), nominee: binding(to), mode });
}
function respond(choice: "yes" | "no", roundId = "r1") {
  const voter = currentVoter(game)!;
  act({ kind: "respond", roundId, voter, choice });
}
function all(yes: number, roundId = "r1") {
  while (currentVoter(game)) { respond(yes-- > 0 ? "yes" : "no", roundId); }
}
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [] });
  store.getState().newGame("tb", { plannedPlayerCount: 5, plannedTravelerCount: 0 });
  const players = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}`, makeSTPlayer({ id: `p${i}`, seat: i, name: `Player ${i}` })]));
  game = { ...store.getState().game!, phase: "day", day: 1, players, seatOrder: Object.keys(players), voting: freshVotingDay(1),
    lifeEventWindow: { events: [], coverageFrom: { phase: "night", day: 1 } } };
});

describe("participant-bound voting", () => {
  it("starts clockwise after nominee, ends at nominee; pure planning changes no input", () => {
    const before = JSON.stringify(game);
    const result = plan({ kind: "begin", roundId: "r1", mode: "nomination", nominator: binding("p0"), nominee: binding("p2") });
    expect(result.ok).toBe(true); expect(JSON.stringify(game)).toBe(before);
    begin(); expect(game.voting!.rounds[0]!.order.map(p => p.playerId)).toEqual(["p3", "p4", "p0", "p1", "p2"]);
    expect(game.voting!.rounds[0]!.threshold).toBe(3);
  });
  it("No is accepted distinctly from skipped and never spends a dead vote", () => {
    game.players.p3 = { ...game.players.p3!, alive: false, ghostVote: true };
    game.players.p4 = { ...game.players.p4!, alive: false, ghostVote: false };
    begin(); respond("no");
    expect(game.voting!.rounds[0]!.responses.map(r => r.choice)).toEqual(["no", "skipped"]);
    expect(game.players.p3.ghostVote).toBe(true); expect(currentVoter(game)?.playerId).toBe("p0");
  });
  it("dead Yes and ballot are one immutable result; semantic undo restores token and cursor", () => {
    game.players.p3 = { ...game.players.p3!, alive: false };
    begin(); const before = game; respond("yes");
    expect(before.players.p3!.ghostVote).toBe(true); expect(game.players.p3.ghostVote).toBe(false);
    expect(game.history.length).toBe(before.history.length + 1);
    act({ kind: "undoLast", roundId: "r1" });
    expect(game.players.p3.ghostVote).toBe(true); expect(currentVoter(game)?.playerId).toBe("p3");
    expect(game.voting!.rounds[0]!.responses).toEqual([]);
  });
  it("repeated stale submit cannot double vote or spend twice", () => {
    begin(); const intent = { kind: "respond" as const, roundId: "r1", voter: currentVoter(game)!, choice: "yes" as const, code: game.code, day: 1, expectedRevision: game.voting!.revision };
    const first = planVoting(game, intent, environment); expect(first.ok).toBe(true); if (!first.ok) return;
    game = first.game; expect(planVoting(game, intent, environment)).toMatchObject({ ok: false, code: "stale" });
    expect(game.voting!.rounds[0]!.responses).toHaveLength(1);
  });
  it("seat reuse refuses old response and skips departed participant without voting as replacement", () => {
    begin(); const old = currentVoter(game)!;
    game = { ...game, players: { ...game.players, p3: { ...game.players.p3!, participantId: "replacement" } } };
    expect(plan({ kind: "respond", roundId: "r1", voter: old, choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
  });
  it("ties clear the candidate but preserve tally; a higher tally replaces the tie", () => {
    begin(); all(3); act({ kind: "acknowledge", roundId: "r1" });
    expect(game.voting!.block?.nominee?.playerId).toBe("p2");
    begin("r2", "p1", "p3"); all(3, "r2"); act({ kind: "acknowledge", roundId: "r2" });
    expect(game.voting!.block).toMatchObject({ nominee: null, tally: 3 });
    begin("r3", "p2", "p4"); all(4, "r3");
    expect(game.voting!.block).toMatchObject({ nominee: { playerId: "p4" }, tally: 4 });
    expect(Object.values(game.players).every(p => p.alive)).toBe(true);
  });
  it("correction recalculates result and refunds only its consumed dead token", () => {
    game.players.p3 = { ...game.players.p3!, alive: false };
    begin(); all(2);
    expect(game.voting!.block?.nominee?.playerId).toBe("p2");
    act({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "no" });
    expect(game.players.p3.ghostVote).toBe(true); expect(game.voting!.block).toBeNull();
  });
  it("abandon retains already cast token expenditure and excludes the incomplete tally", () => {
    game.players.p3 = { ...game.players.p3!, alive: false };
    begin(); respond("yes"); act({ kind: "abandon", roundId: "r1" });
    expect(game.players.p3.ghostVote).toBe(false); expect(game.voting!.activeRoundId).toBeNull(); expect(game.voting!.block).toBeNull();
  });
  it("exile includes all dead participants, half of everyone, no ghost expenditure", () => {
    game.players.p2 = { ...game.players.p2!, isTraveler: true, actualRole: "bureaucrat" };
    game.players.p3 = { ...game.players.p3!, alive: false, ghostVote: false };
    begin("r1", "p3", "p2", "exile"); all(3);
    expect(game.voting!.rounds[0]!.result).toBe("exilePassed");
    expect(game.voting!.rounds[0]!.responses[0]).toMatchObject({ choice: "yes", weight: 1, spentGhostVote: false });
    expect(game.players.p2.alive).toBe(true);
    act({ kind: "exileOutcome", roundId: "r1", outcome: "survived" }); expect(game.players.p2.alive).toBe(true);
  });
  it("Bureaucrat gives three votes and only one ghost token; dead or impaired source loses weight", () => {
    game.players.p1 = { ...game.players.p1!, isTraveler: true, actualRole: "bureaucrat" };
    game.players.p3 = { ...game.players.p3!, alive: false };
    act({ kind: "bureaucrat", modifierId: "b", source: binding("p1"), target: binding("p3") });
    expect(voteWeight(game, binding("p3"), environment)).toEqual({ known: true, value: 3 });
    begin(); respond("yes");
    expect(game.voting!.rounds[0]!.responses[0]).toMatchObject({ weight: 3, spentGhostVote: true });
    game.players.p1 = { ...game.players.p1!, alive: false };
    expect(voteWeight(game, binding("p3"), environment)).toEqual({ known: true, value: 1 });
  });
  it("Virgin first nomination consumes ability even if no execution; actual execution is explicit", () => {
    game.players.p2 = { ...game.players.p2!, actualRole: "virgin" };
    begin(); expect(game.players.p2.abilityUsed).toBe(true); expect(currentVoter(game)).toBeNull();
    act({ kind: "virgin", roundId: "r1", execute: false });
    expect(game.players.p0!.alive).toBe(true); expect(currentVoter(game)?.playerId).toBe("p3");
  });
  it("Virgin explicit execution uses Life semantics and does not synthesize ordinary votes", () => {
    game.players.p2 = { ...game.players.p2!, actualRole: "virgin" };
    begin(); act({ kind: "virgin", roundId: "r1", execute: true, outcome: "died" });
    expect(game.players.p0!.alive).toBe(false); expect(game.voting!.rounds[0]!.result).toBe("virgin");
    expect(game.lifeEventWindow.events.at(-1)?.kind).toBe("execution"); expect(game.voting!.block).toBeNull();
  });
  it("unknown legacy eligibility needs explicit acknowledgement, never fabricated past nominations", () => {
    game.voting = freshVotingDay(1, "unknown");
    expect(plan({ kind: "begin", roundId: "r1", mode: "nomination", nominator: binding("p0"), nominee: binding("p2") })).toMatchObject({ ok: false });
    act({ kind: "begin", roundId: "r1", mode: "nomination", nominator: binding("p0"), nominee: binding("p2"), confirmUnknown: true });
    expect(game.voting!.coverage).toBe("unknown");
  });
  it("rejects malformed stored cursor/tally/duplicate identity and keeps voting private", () => {
    begin(); respond("yes");
    expect(VotingDayStateSchema.safeParse({ ...game.voting, activeRoundId: "missing" }).success).toBe(false);
    const altered = JSON.parse(JSON.stringify(game.voting)); altered.rounds[0].tally = 77;
    expect(VotingDayStateSchema.safeParse(altered).success).toBe(false);
    const pub = projectLobbyToPublic(game, {}); const self = projectLobbyToSelfMap(game, environment.registry);
    expect(pub).not.toHaveProperty("voting"); expect(self).not.toHaveProperty("voting");
    expect(JSON.stringify(pub)).not.toContain("participantId");
  });
  it("signed adjustment keeps the affirmative response even at zero or negative contribution", () => {
    begin(); act({ kind: "respond", roundId: "r1", voter: currentVoter(game)!, choice: "yes", weightOverride: -1 });
    expect(game.voting!.rounds[0]!.responses[0]).toMatchObject({ choice: "yes", weight: -1 });
    act({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "yes", weightOverride: 0 });
    expect(game.voting!.rounds[0]!.responses[0]).toMatchObject({ choice: "yes", weight: 0 });
  });
  it("correcting an older completed round recomputes later ties and block", () => {
    begin(); all(3); act({ kind: "acknowledge", roundId: "r1" });
    begin("r2", "p1", "p3"); all(3, "r2"); act({ kind: "acknowledge", roundId: "r2" });
    expect(game.voting!.block?.nominee).toBeNull();
    act({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "no" });
    expect(game.voting!.rounds[0]!.result).toBe("belowThreshold");
    expect(game.voting!.block?.nominee?.playerId).toBe("p3");
  });
  it("execution prevents an earlier response correction from silently undoing its dependency", () => {
    begin(); all(3); act({ kind: "acknowledge", roundId: "r1" });
    act({ kind: "execution", target: binding("p2"), outcome: "survived" });
    expect(plan({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "no" })).toMatchObject({ ok: false });
  });
  it("external token restore/spend cycle permanently invalidates old refund evidence", () => {
    game.players.p3 = { ...game.players.p3!, alive: false };
    begin(); respond("yes");
    game = reconcileVotingDependencies(game, { ...game, players: { ...game.players, p3: { ...game.players.p3!, ghostVote: true } } });
    game = reconcileVotingDependencies(game, { ...game, players: { ...game.players, p3: { ...game.players.p3!, ghostVote: false } } });
    expect(game.voting!.rounds[0]!.responses[0]!.refundSafe).toBe(false);
    act({ kind: "acknowledgeContext", roundId: "r1" });
    const before = game;
    expect(plan({ kind: "undoLast", roundId: "r1" })).toMatchObject({ ok: false }); expect(game).toBe(before);
    expect(plan({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "no" })).toMatchObject({ ok: false });
  });
  it("source death retires Bureaucrat selection permanently; resurrection does not reactivate it", () => {
    game.players.p1 = { ...game.players.p1!, isTraveler: true, actualRole: "bureaucrat" };
    act({ kind: "bureaucrat", modifierId: "b", source: binding("p1"), target: binding("p3") });
    game = reconcileVotingDependencies(game, { ...game, players: { ...game.players, p1: { ...game.players.p1!, alive: false } } });
    game = reconcileVotingDependencies(game, { ...game, players: { ...game.players, p1: { ...game.players.p1!, alive: true } } });
    expect(game.voting!.modifiers).toEqual([]); expect(voteWeight(game, binding("p3"), environment)).toEqual({ known: true, value: 1 });
  });
  it("midround Life change requires explicit context review, then refreshes threshold", () => {
    begin(); game = { ...game, players: { ...game.players, p4: { ...game.players.p4!, alive: false } } };
    expect(votingContextChanged(game, game.voting!.rounds[0]!)).toBe(true);
    expect(plan({ kind: "respond", roundId: "r1", voter: currentVoter(game)!, choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    act({ kind: "acknowledgeContext", roundId: "r1" }); expect(game.voting!.rounds[0]!.threshold).toBe(2); respond("yes");
  });
  it("correction cannot acknowledge a changed living count or hide its threshold review", () => {
    begin(); respond("no");
    const died = planLifeTransaction(game, { intents: [{ kind: "death", playerId: "p4" }] });
    expect(died.ok && died.changed).toBe(true); if (!died.ok || !died.changed) return;
    game = reconcileVotingDependencies(game, applyLifePlan(game, died.plan));
    const before = structuredClone(game);
    expect(plan({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    expect(game).toEqual(before);
    expect(votingContextChanged(game, game.voting!.rounds[0]!)).toBe(true);
    expect(game.voting!.rounds[0]!.threshold).toBe(3);
    act({ kind: "acknowledgeContext", roundId: "r1" });
    expect(game.voting!.rounds[0]!.threshold).toBe(2);
    act({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "yes" });
    all(1);
    expect(game.voting!.rounds[0]).toMatchObject({ tally: 2, result: "block" });
    expect(game.voting!.block).toMatchObject({ nominee: { playerId: "p2" }, tally: 2 });
  });
  it.each(["departed", "replaced"] as const)("correction preserves review until the %s current voter is skipped by acknowledgement", change => {
    begin(); respond("no"); const former = currentVoter(game)!;
    if (change === "departed") {
      const { p4: _departed, ...players } = game.players;
      game = { ...game, players, seatOrder: game.seatOrder.filter(id => id !== "p4") };
    } else {
      game = { ...game, players: { ...game.players, p4: { ...game.players.p4!, participantId: "replacement" } } };
    }
    const before = structuredClone(game);
    expect(plan({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    expect(game).toEqual(before); expect(currentVoter(game)).toEqual(former);
    expect(votingContextChanged(game, game.voting!.rounds[0]!)).toBe(true);
    act({ kind: "acknowledgeContext", roundId: "r1" });
    expect(currentVoter(game)?.playerId).toBe("p0");
    expect(game.voting!.rounds[0]!.responses[1]).toMatchObject({ voter: former, choice: "skipped", weight: 0 });
    expect(game.voting!.rounds[0]!.threshold).toBe(change === "departed" ? 2 : 3);
    expect(plan({ kind: "respond", roundId: "r1", voter: former, choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    if (change === "replaced") expect(plan({ kind: "respond", roundId: "r1", voter: binding("p4"), choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    act({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "yes" });
    all(0); expect(game.voting!.rounds[0]!.status).toBe("outcome");
    expect(game.voting!.rounds[0]!.responses.some(r => r.voter.participantId === "replacement")).toBe(false);
  });
  it("an outcome correction also requires active context review before recalculating the block", () => {
    begin(); all(1);
    game = { ...game, players: { ...game.players, p4: { ...game.players.p4!, alive: false } } };
    expect(plan({ kind: "correctResponse", roundId: "r1", voter: binding("p0"), choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    expect(game.voting!.block).toBeNull();
    act({ kind: "acknowledgeContext", roundId: "r1" });
    act({ kind: "correctResponse", roundId: "r1", voter: binding("p0"), choice: "yes" });
    expect(game.voting!.block).toMatchObject({ nominee: { playerId: "p2" }, tally: 2 });
  });
  it("historical correction retains its recorded threshold and cannot acknowledge a different active round", () => {
    begin(); all(3); act({ kind: "acknowledge", roundId: "r1" });
    begin("r2", "p1", "p3"); respond("no", "r2");
    const died = planLifeTransaction(game, { intents: [{ kind: "death", playerId: "p2" }] });
    expect(died.ok && died.changed).toBe(true); if (!died.ok || !died.changed) return;
    game = reconcileVotingDependencies(game, applyLifePlan(game, died.plan));
    const activeBefore = structuredClone(game.voting!.rounds[1]);
    act({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "no" });
    expect(game.voting!.rounds[0]).toMatchObject({ threshold: 3, tally: 2, result: "belowThreshold", status: "acknowledged" });
    expect(game.voting!.rounds[1]).toEqual(activeBefore);
    expect(votingContextChanged(game, game.voting!.rounds[1]!)).toBe(true);
    expect(game.voting!.block).toBeNull();
    expect(plan({ kind: "correctResponse", roundId: "r2", voter: binding("p4"), choice: "yes" })).toMatchObject({ ok: false, code: "stale" });
    act({ kind: "acknowledgeContext", roundId: "r2" });
    expect(game.voting!.rounds[0]!.threshold).toBe(3); expect(game.voting!.rounds[1]!.threshold).toBe(2);
  });
  it("even-count exile needs half, is once per Traveler per Day, and remains independent of execution", () => {
    delete game.players.p4; game.seatOrder = game.seatOrder.filter(id => id !== "p4");
    game.players.p2 = { ...game.players.p2!, isTraveler: true, actualRole: "bureaucrat" };
    begin("r1", "p0", "p2", "exile"); expect(game.voting!.rounds[0]!.threshold).toBe(2); all(2);
    act({ kind: "exileOutcome", roundId: "r1", outcome: "survived" });
    expect(plan({ kind: "begin", roundId: "r2", nominator: binding("p1"), nominee: binding("p2"), mode: "exile" })).toMatchObject({ ok: false });
  });
  it("dead Virgin has no automatic first-use trigger; Bureaucrat cannot target self", () => {
    game.players.p2 = { ...game.players.p2!, actualRole: "virgin", alive: false };
    begin(); expect(game.players.p2.abilityUsed).toBe(false); expect(game.voting!.rounds[0]!.virginPending).toBe(false);
    game.players.p1 = { ...game.players.p1!, actualRole: "bureaucrat", isTraveler: true };
    expect(plan({ kind: "bureaucrat", modifierId: "b", source: binding("p1"), target: binding("p1") })).toMatchObject({ ok: false });
  });
  it("an execution that survived still closes ordinary nominations", () => {
    act({ kind: "execution", target: binding("p2"), outcome: "survived" });
    expect(plan({ kind: "begin", roundId: "r1", nominator: binding("p0"), nominee: binding("p1"), mode: "nomination" })).toMatchObject({ ok: false });
  });
  it("Bureaucrat source poison removes its weight only while impaired", () => {
    game.players.p1 = { ...game.players.p1!, actualRole: "bureaucrat", isTraveler: true };
    act({ kind: "bureaucrat", modifierId: "b", source: binding("p1"), target: binding("p3") });
    game.players.p1 = { ...game.players.p1!, effects: [{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }] };
    expect(voteWeight(game, binding("p3"), environment)).toEqual({ known: true, value: 1 });
    game.players.p1 = { ...game.players.p1!, effects: [] };
    expect(voteWeight(game, binding("p3"), environment)).toEqual({ known: true, value: 3 });
  });
  it("execution directly from completed nomination acknowledges it atomically", () => {
    begin(); all(3);
    act({ kind: "execution", target: binding("p2"), outcome: "died" });
    expect(game.voting!.activeRoundId).toBeNull(); expect(game.voting!.rounds[0]!.status).toBe("acknowledged");
    expect(game.players.p2!.alive).toBe(false);
  });
  it("20-player ring includes every participant exactly once and finishes without an extra action", () => {
    for (let i = 5; i < 20; i++) { const id = `p${i}`; game.players[id] = makeSTPlayer({ id, seat: i }); game.seatOrder.push(id); }
    begin(); expect(game.voting!.rounds[0]!.threshold).toBe(10);
    all(10); const round = game.voting!.rounds[0]!;
    expect(round.responses).toHaveLength(20); expect(new Set(round.responses.map(r => r.voter.participantId)).size).toBe(20);
    expect(round.status).toBe("outcome"); expect(round.responses.at(-1)?.voter.playerId).toBe("p2");
    expect(game.voting!.block?.tally).toBe(10);
  });
  it("recovery rejects a forged block rather than treating it as a new authoritative outcome", () => {
    begin(); all(3); const bad = JSON.parse(JSON.stringify(game.voting));
    bad.block.nominee = bad.rounds[0].nominator;
    expect(VotingDayStateSchema.safeParse(bad).success).toBe(false);
  });
  it("Virgin first legal nomination while poisoned still spends use; later-Day nomination cannot trigger again", () => {
    game.players.p2 = { ...game.players.p2!, actualRole: "virgin", effects: [{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }] };
    begin(); expect(game.players.p2.abilityUsed).toBe(true);
    act({ kind: "virgin", roundId: "r1", execute: false }); all(0); act({ kind: "acknowledge", roundId: "r1" });
    game = { ...game, day: 2, players: { ...game.players, p2: { ...game.players.p2, effects: [] } }, voting: freshVotingDay(2) };
    begin("r2"); expect(game.voting!.rounds[0]!.virginPending).toBe(false); expect(currentVoter(game)?.playerId).toBe("p3");
  });
  it("completed exile support cannot be corrected underneath an applied exile outcome", () => {
    game.players.p2 = { ...game.players.p2!, isTraveler: true, actualRole: "bureaucrat" };
    begin("r1", "p0", "p2", "exile"); all(3); act({ kind: "exileOutcome", roundId: "r1", outcome: "died" });
    expect(plan({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "no" })).toMatchObject({ ok: false });
    expect(game.players.p2.alive).toBe(false);
  });
  it("a living response cannot later consume a dead token when corrected after death", () => {
    begin(); respond("no"); const died = planLifeTransaction(game, { intents: [{ kind: "death", playerId: "p3" }] });
    expect(died.ok && died.changed).toBe(true); if (!died.ok || !died.changed) return;
    game = reconcileVotingDependencies(game, applyLifePlan(game, died.plan));
    expect(plan({ kind: "correctResponse", roundId: "r1", voter: binding("p3"), choice: "yes" })).toMatchObject({ ok: false });
    expect(game.players.p3!.ghostVote).toBe(true);
  });
  it("external survived execution stops an in-progress ordinary vote without relying on alive-field changes", () => {
    begin(); const execution = planLifeTransaction(game, { intents: [{ kind: "execution", playerId: "p1", outcome: "survived" }] });
    expect(execution.ok && execution.changed).toBe(true); if (!execution.ok || !execution.changed) return;
    game = reconcileVotingDependencies(game, applyLifePlan(game, execution.plan));
    expect(plan({ kind: "respond", roundId: "r1", voter: currentVoter(game)!, choice: "yes" })).toMatchObject({ ok: false });
    act({ kind: "abandon", roundId: "r1" }); expect(game.voting!.activeRoundId).toBeNull();
  });
  it("a homebrew role borrowing the Virgin id never acquires canonical first-use mechanics", () => {
    game.players.p2 = { ...game.players.p2!, actualRole: "virgin" };
    const custom = { ...script, characters: [{ id: "virgin", name: "Different role", type: "townsfolk" as const, ability: "A homebrew ability." }, ...script.characters.filter(r => r.id !== "virgin")] };
    const result = planVoting(game, { kind: "begin", roundId: "r1", mode: "nomination", nominator: binding("p0"), nominee: binding("p2"), code: game.code, day: game.day, expectedRevision: 0 }, { script: custom, registry: buildRegistry(custom) });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.game.players.p2!.abilityUsed).toBe(false); expect(result.game.voting!.rounds[0]!.virginPending).toBe(false);
  });
});
