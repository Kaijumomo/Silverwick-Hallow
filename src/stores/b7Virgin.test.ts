import { beforeEach, describe, expect, it } from "vitest";
import { makeSTPlayer } from "@/test/fixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { useStorytellerStore as store } from "./storytellerStore";
import { currentVoter, currentVotingState, freshVotingDay, planVoting, virginNominationOutcome, votingContextChanged } from "./voting";
import type { EffectRecord, StorytellerLobbyRecord } from "./types";
import type { VotingIntent } from "./votingTypes";
import { VotingDayStateSchema } from "./votingSchema";
import { StorytellerLobbyRecordSchema } from "./schemas";

let game: StorytellerLobbyRecord;
const script = BUILTIN_SCRIPTS.tb!;
const environment = { script, registry: buildRegistry(script) };
const bind = (id: string) => ({ playerId: id, participantId: game.players[id]!.participantId! });
type Action = VotingIntent extends infer I ? I extends VotingIntent ? Omit<I, "code" | "day" | "expectedRevision"> : never : never;
const plan = (action: Action) => planVoting(game, { ...action, code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision } as VotingIntent, environment);
function act(action: Action) {
  const result = plan(action);
  if (!result.ok) throw new Error(result.message);
  game = result.game;
  expect(VotingDayStateSchema.safeParse(game.voting).success).toBe(true);
  return result;
}
const begin = (from = "p0", to = "p1") => act({ kind: "begin", mode: "nomination", roundId: "r1", nominator: bind(from), nominee: bind(to) });
const effect = (type: string): EffectRecord => ({ id: `test-${type}`, type, state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" } });
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [] });
  store.getState().newGame("tb", { plannedPlayerCount: 5, plannedTravelerCount: 0 });
  const players = Object.fromEntries(["chef", "virgin", "soldier", "poisoner", "imp"].map((role, i) => [`p${i}`, makeSTPlayer({ id: `p${i}`, seat: i, name: `Player ${i}`, actualRole: role, shownRole: role, packetEpoch: `epoch-${i}` })]));
  game = { ...store.getState().game!, code: "B7VIRGIN", phase: "day", day: 1, players, seatOrder: Object.keys(players), voting: freshVotingDay(1), lifeEventWindow: { events: [], coverageFrom: { phase: "night", day: 1 } } };
});

describe("B7 Virgin qualification and authoritative voting composition", () => {
  it("consumes a verified first nomination and asks only for actual death", () => {
    begin();
    expect(game.players.p1!.abilityUsed).toBe(true);
    expect(game.players.p0!.alive).toBe(true);
    expect(currentVoter(game)).toBeNull();
    expect(plan({ kind: "virgin", roundId: "r1", execute: false }).ok).toBe(false);
    act({ kind: "virgin", roundId: "r1", execute: true, outcome: "survived" });
    expect(game.players.p0!.alive).toBe(true);
    expect(game.lifeEventWindow.events).toEqual([expect.objectContaining({ kind: "execution", outcome: "survived" })]);
    expect(game.voting!.rounds[0]!.result).toBe("virgin");
  });
  it.each(["drunk", "saint", "recluse", "poisoner", "imp"])("%s actual identity does not trigger even with a Townsfolk shown role", role => {
    game.players.p0 = { ...game.players.p0!, actualRole: role, shownRole: "chef" };
    begin();
    expect(game.players.p1!.abilityUsed).toBe(true);
    expect(currentVoter(game)).not.toBeNull();
    expect(game.lifeEventWindow.events).toHaveLength(0);
  });
  it("poisoned Townsfolk still qualify", () => {
    game.players.p0!.effects = [effect("poisoned")];
    begin(); act({ kind: "virgin", roundId: "r1", execute: true, outcome: "died" });
    expect(game.players.p0!.alive).toBe(false);
    expect(game.lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
  });
  it.each(["poisoned", "drunk"])("a %s Virgin consumes the ability and continues ordinary voting", type => {
    game.players.p1!.effects = [effect(type)];
    begin();
    expect(game.players.p1!.abilityUsed).toBe(true);
    expect(game.voting!.rounds[0]!.virginPending).toBe(false);
    expect(currentVoter(game)).not.toBeNull();
  });
  it.each([true, false])("Spy registration remains wholly manual until explicit resolution, execute=%s", execute => {
    game.players.p0!.actualRole = "spy";
    begin();
    expect(game.players.p1!.abilityUsed).toBe(false);
    expect(virginNominationOutcome(game, bind("p0"), bind("p1"), environment).kind).toBe("manual");
    act({ kind: "virgin", roundId: "r1", execute, ...(execute ? { outcome: "died" as const } : {}) });
    expect(game.players.p1!.abilityUsed).toBe(true);
    expect(game.players.p0!.alive).toBe(!execute);
  });
  it("known impaired Spy cannot register as Townsfolk", () => {
    game.players.p0 = { ...game.players.p0!, actualRole: "spy", effects: [effect("poisoned")] };
    begin(); expect(currentVoter(game)).not.toBeNull(); expect(game.players.p1!.abilityUsed).toBe(true);
  });
  it("unknown effect keeps the entire character outcome manual", () => {
    game.players.p3!.effects = [effect("unknown-house-rule")];
    begin(); expect(game.players.p1!.abilityUsed).toBe(false); expect(currentVoter(game)).toBeNull();
  });
  it("invalid dead nomination changes nothing", () => {
    game.players.p0!.alive = false;
    const before = structuredClone(game);
    expect(plan({ kind: "begin", mode: "nomination", roundId: "r1", nominator: bind("p0"), nominee: bind("p1") }).ok).toBe(false);
    expect(game).toEqual(before);
  });
  it("allows self nomination with one ability consumption and one execution", () => {
    begin("p1", "p1"); act({ kind: "virgin", roundId: "r1", execute: true, outcome: "died" });
    expect(game.players.p1).toMatchObject({ alive: false, abilityUsed: true });
    expect(game.lifeEventWindow.events).toHaveLength(1);
  });
  it("refuses duplicate execution through day completion", () => {
    begin(); act({ kind: "virgin", roundId: "r1", execute: true, outcome: "died" });
    expect(plan({ kind: "execution", target: bind("p2"), outcome: "died" }).ok).toBe(false);
    act({ kind: "acknowledge", roundId: "r1" });
    expect(plan({ kind: "begin", mode: "nomination", roundId: "r2", nominator: bind("p2"), nominee: bind("p3") }).ok).toBe(false);
    expect(game.players.p2!.alive).toBe(true);
  });
  it.each(["role", "epoch", "effect", "ability correction", "modifier"])("refuses changed pending %s rather than reinterpreting the first nomination", change => {
    begin();
    if (change === "role") game.players.p0!.actualRole = "drunk";
    if (change === "epoch") game.players.p1!.packetEpoch = "new-epoch";
    if (change === "effect") game.players.p1!.effects = [effect("poisoned")];
    if (change === "ability correction") game.players.p1!.abilityUsed = false;
    if (change === "modifier") game.fabled = ["hellslibrarian"];
    expect(votingContextChanged(game, game.voting!.rounds[0]!)).toBe(true);
    expect(plan({ kind: "virgin", roundId: "r1", execute: true, outcome: "died" }).ok).toBe(false);
    expect(plan({ kind: "acknowledgeContext", roundId: "r1" }).ok).toBe(false);
  });
  it("JSON reload preserves the exact pending context", () => {
    game.players.p0!.effects = [effect("poisoned")];
    begin(); game = StorytellerLobbyRecordSchema.parse(JSON.parse(JSON.stringify(game)));
    expect(votingContextChanged(game, game.voting!.rounds[0]!)).toBe(false);
    act({ kind: "virgin", roundId: "r1", execute: true, outcome: "survived" });
  });
  it("same-ID script definition changes cannot reinterpret pending qualification", () => {
    begin();
    const changedScript = { ...script, characters: script.characters.map(role => role.id === "chef" ? { ...role, ability: "An unverified changed ability." } : role) };
    const changedEnvironment = { script: changedScript, registry: buildRegistry(changedScript) };
    expect(votingContextChanged(game, game.voting!.rounds[0]!, changedEnvironment)).toBe(true);
    expect(planVoting(game, { kind: "virgin", roundId: "r1", execute: true, outcome: "died", code: game.code, day: game.day, expectedRevision: game.voting!.revision }, changedEnvironment).ok).toBe(false);
  });
});
