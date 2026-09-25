import { beforeEach, describe, expect, it } from "vitest";
import { takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";
import { StorytellerGamePersistedSchema } from "./schemas";
import { canonicalizeStartingLife } from "./lifeResolution";
import type { PlayerId, STPlayerRecord, StorytellerLobbyRecord } from "./types";

// Phase 10A Luna blocker 10A-LUNA-001: Setup life state is never gameplay.
// Every occupied participant enters Night 1 with canonical starting life
// (alive, vote held, not exiled) at the single Setup -> Live Play boundary
// (beginNightOne), inside that same commit -- with no Life Event, no
// History, and one Undo entry holding the exact pre-start Setup snapshot.

const STORAGE_KEY = "new-blood-st";
const game = () => store.getState().game!;
const state = () => store.getState();
const player = (id: PlayerId) => game().players[id]!;
const STALE = { alive: false, ghostVote: false, exiled: true } as const;

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
  takeMigrationResetFlag();
});

/** A dealt, explicitly revealed Setup, ready to begin Night 1. */
function revealedSetup(): PlayerId[] {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (let i = 0; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(game().phase).toBe("setup");
  return [...game().seatOrder];
}

function withPlayer(id: PlayerId, over: Partial<STPlayerRecord>) {
  store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), ...over } } } });
}

function expectCanonicalAlive(p: STPlayerRecord) {
  expect(p.alive).toBe(true);
  expect(p.ghostVote).toBe(true);
  expect(p.exiled === true).toBe(false);
}

describe("10A-LUNA-001: Luna's exact reproduction (migrated v18 Setup)", () => {
  it("a stale dead/vote-used/exiled Setup participant enters Night 1 canonically alive; no Life Event/History; one Undo entry; Undo restores it; restarting canonicalizes again", async () => {
    const ids = revealedSetup();
    const target = ids[2]!;
    // Persist the Setup exactly as a v18 app would have: no Life Event
    // Window, and the stale life fields on an occupied ordinary participant.
    const v18Game = JSON.parse(JSON.stringify(game())) as Record<string, unknown> & StorytellerLobbyRecord;
    delete (v18Game as Partial<StorytellerLobbyRecord>).lifeEventWindow;
    Object.assign(v18Game.players[target]!, STALE);
    // Clear memory first: persist writes through on every setState.
    store.setState({ game: null, undoStack: [], localSeq: 0 });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 18, state: { game: v18Game, undoStack: [] } }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);

    // Schema-valid, still Setup, still carrying the anomaly.
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    expect(game().phase).toBe("setup");
    expect(player(target)).toMatchObject(STALE);
    // Setup life correction stays refused (no Setup Life controls).
    expect(state().correctLifeStatus(target, { alive: true }).ok).toBe(false);

    const preStart = structuredClone(game());
    const seqBefore = state().localSeq;
    const undoBefore = state().undoStack.length;

    expect(state().beginNightOne().ok).toBe(true);
    expect(game()).toMatchObject({ phase: "night", day: 1 });
    expectCanonicalAlive(player(target));
    expect("exiled" in player(target)).toBe(false);
    // Nothing fabricated: no Life Event, no History, no Provenance anywhere.
    expect(game().lifeEventWindow).toEqual({ coverageFrom: { phase: "night", day: 1 }, events: [] });
    expect(game().history).toEqual([]);
    // One logical operation: one localSeq step, one Undo entry = pre-start Setup.
    expect(state().localSeq).toBe(seqBefore + 1);
    expect(state().undoStack.length).toBe(undoBefore + 1);
    expect(state().undoStack.at(-1)).toEqual(preStart);

    state().undo();
    expect(game()).toEqual(preStart);
    expect(player(target)).toMatchObject(STALE);

    expect(state().beginNightOne().ok).toBe(true);
    expectCanonicalAlive(player(target));
    expect(game().history).toEqual([]);
    expect(game().lifeEventWindow.events).toEqual([]);
  });
});

describe("10A-LUNA-001: who is canonicalized", () => {
  it("an occupied Setup Traveler with stale dead/exiled/vote state starts canonically alive and not exiled", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 6, plannedTravelerCount: 0 });
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const traveler = game().seatOrder[0]!;
    expect(state().setIsTraveler(traveler, true).ok).toBe(true);
    state().setRolePool(standardRoles(5));
    expect(state().dealRolePool().ok).toBe(true);
    state().assignRole(traveler, "thief");
    state().setTravelerAlignment(traveler, "good");
    for (const id of game().seatOrder) {
      if (id === traveler) continue;
      if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
      else state().showAssignedRole(id);
    }
    expect(state().revealRoles().ok).toBe(true);
    withPlayer(traveler, STALE);
    expect(state().beginNightOne().ok).toBe(true);
    expectCanonicalAlive(player(traveler));
    expect("exiled" in player(traveler)).toBe(false);
    expect(player(traveler)).toMatchObject({ isTraveler: true, actualRole: "thief", actualAlignment: "good" });
    expect(game().history).toEqual([]);
    expect(game().lifeEventWindow.events).toEqual([]);
  });

  it("an already-canonical participant is unchanged -- the very same record", () => {
    const ids = revealedSetup();
    withPlayer(ids[0]!, STALE);
    const before = game().players;
    expect(state().beginNightOne().ok).toBe(true);
    for (const id of ids.slice(1)) expect(game().players[id]).toBe(before[id]);
  });

  it("with no anomaly at all, the players map itself is untouched", () => {
    revealedSetup();
    const before = game().players;
    expect(state().beginNightOne().ok).toBe(true);
    expect(game().players).toBe(before);
  });

  it("an empty planned seat is never altered and gains no life state or participant identity", () => {
    const ids = revealedSetup();
    // An unfilled Traveler reservation is an empty seat that may legitimately
    // exist when Night 1 begins; give it stale life fields.
    const emptySeat: STPlayerRecord = { ...player(ids[0]!), id: "empty-seat", name: "", seat: ids.length,
      actualRole: "", shownRole: null, shownAlignment: null, isEmpty: true, plannedTravelerSeat: true,
      alive: false, ghostVote: false, exiled: true };
    delete emptySeat.participantId;
    store.setState({ game: { ...game(), plannedPlayerCount: game().plannedPlayerCount + 1,
      plannedTravelerCount: game().plannedTravelerCount + 1,
      players: { ...game().players, [emptySeat.id]: emptySeat }, seatOrder: [...game().seatOrder, emptySeat.id] } });
    const before = game().players[emptySeat.id];
    const result = state().beginNightOne();
    expect(result).toEqual({ ok: true });
    expect(game().players[emptySeat.id]).toBe(before);
    expect("participantId" in game().players[emptySeat.id]!).toBe(false);
    expect(game().history).toEqual([]);
  });

  it("canonicalizeStartingLife itself: empty seats untouched, occupied fixed, canonical records shared", () => {
    const ids = revealedSetup();
    withPlayer(ids[0]!, STALE);
    const players: StorytellerLobbyRecord["players"] = { ...game().players,
      e: { ...player(ids[1]!), id: "e", isEmpty: true, alive: false, ghostVote: false, exiled: true } };
    const out = canonicalizeStartingLife(players);
    expect(out.e).toBe(players.e!);
    expect(out[ids[1]!]).toBe(players[ids[1]!]);
    expect(out[ids[0]!]).toMatchObject({ alive: true, ghostVote: true });
    expect("exiled" in out[ids[0]!]!).toBe(false);
    expect(out[ids[0]!]!.abilityUsed).toBe(players[ids[0]!]!.abilityUsed); // abilityUsed out of scope
    expect(players[ids[0]!]).toMatchObject(STALE); // input never mutated
    expect(canonicalizeStartingLife(out)).toBe(out);
  });
});

describe("10A-LUNA-001: every Setup -> Live path shares the boundary", () => {
  it.each([
    ["setPhase(\"night\")", () => state().setPhase("night")],
    ["setPhase(\"day\")", () => state().setPhase("day")],
    ["advancePhase()", () => state().advancePhase()],
    ["beginNightOne()", () => state().beginNightOne()],
  ] as const)("%s from Setup canonicalizes in one commit", (_label, start) => {
    const ids = revealedSetup();
    withPlayer(ids[3]!, STALE);
    const preStart = structuredClone(game());
    const seqBefore = state().localSeq;
    expect(start().ok).toBe(true);
    expect(game()).toMatchObject({ phase: "night", day: 1 });
    expectCanonicalAlive(player(ids[3]!));
    expect(game().history).toEqual([]);
    expect(state().localSeq).toBe(seqBefore + 1);
    expect(state().undoStack.at(-1)).toEqual(preStart);
  });

  it("Undo from Setup back to a live snapshot restores that snapshot whole -- no Setup life field crosses", () => {
    const ids = revealedSetup();
    expect(state().beginNightOne().ok).toBe(true);
    expect(state().recordDeath(ids[0]!).ok).toBe(true); // a legitimate live death
    const live = structuredClone(game());
    expect(state().setPhase("setup").ok).toBe(true);
    withPlayer(ids[1]!, STALE); // stale Setup-era life state (not via any command)
    state().undo();
    expect(game()).toEqual(live);
    expectCanonicalAlive(player(ids[1]!));
    expect(player(ids[0]!).alive).toBe(false);
  });

  it("an adopted remote Setup checkpoint stays Setup; starting it canonicalizes", () => {
    const ids = revealedSetup();
    withPlayer(ids[4]!, STALE);
    state().restoreRemoteCheckpoint(structuredClone(game()), null);
    expect(game().phase).toBe("setup");
    expect(player(ids[4]!)).toMatchObject(STALE);
    expect(state().beginNightOne().ok).toBe(true);
    expectCanonicalAlive(player(ids[4]!));
  });
});

describe("10A-LUNA-001: later phase changes never reset live life state", () => {
  it("Night -> Day and Day -> Night keep legitimate deaths, exiles and spent votes", () => {
    const ids = revealedSetup();
    expect(state().beginNightOne().ok).toBe(true);
    state().addPlayerToSeat("Tess");
    const traveler = game().seatOrder.at(-1)!;
    state().assignRole(traveler, "thief");
    expect(state().recordDeath(ids[0]!).ok).toBe(true);
    expect(state().advancePhase().ok).toBe(true); // Night 1 -> Day 1
    expect(state().recordExile(traveler, "died").ok).toBe(true);
    expect(state().spendGhostVote(ids[0]!).ok).toBe(true);
    const snapshot = { dead: { ...player(ids[0]!) }, exiled: { ...player(traveler) } };
    expect(state().advancePhase().ok).toBe(true); // Day 1 -> Night 2
    expect(player(ids[0]!)).toEqual(snapshot.dead);
    expect(player(traveler)).toEqual(snapshot.exiled);
    expect(state().advancePhase().ok).toBe(true); // Night 2 -> Day 2
    expect(player(ids[0]!)).toMatchObject({ alive: false, ghostVote: false });
    expect(player(traveler)).toMatchObject({ alive: false, ghostVote: true, exiled: true });
    expect(state().setPhase("night").ok).toBe(true); // Day -> Night via setPhase
    expect(player(ids[0]!)).toMatchObject({ alive: false, ghostVote: false });
    expect(player(traveler)).toMatchObject({ alive: false, exiled: true });
  });
});
