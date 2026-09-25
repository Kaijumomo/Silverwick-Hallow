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

  it("a live game cannot be moved back to Setup, so canonicalization can never rerun over live play", () => {
    const ids = revealedSetup();
    expect(state().beginNightOne().ok).toBe(true);
    expect(state().recordDeath(ids[0]!).ok).toBe(true);
    expect(state().setPhase("setup").ok).toBe(false);
    expect(state().beginNightOne().ok).toBe(false); // not in Setup: no restart
    expect(game().phase).toBe("night");
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

describe("10A-LUNA-RV-001: Live Play never returns to Setup through the phase API", () => {
  const REFUSAL = { ok: false, message: "Setup is only available before live play begins." };
  /** Every piece of store state a refused command must leave untouched. */
  const everything = () => {
    const s = state();
    return { game: s.game, undoStack: s.undoStack, localSeq: s.localSeq, sync: s.sync,
      history: s.game?.history, window: s.game?.lifeEventWindow, json: JSON.stringify(s.game) };
  };
  function expectInert(before: ReturnType<typeof everything>) {
    const after = everything();
    expect(after.game).toBe(before.game);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.localSeq).toBe(before.localSeq);
    expect(after.sync).toBe(before.sync);
    expect(after.history).toBe(before.history);
    expect(after.window).toBe(before.window);
    expect(after.json).toBe(before.json);
  }
  function liveNight(): { ids: PlayerId[]; traveler: PlayerId } {
    const ids = revealedSetup();
    expect(state().beginNightOne().ok).toBe(true);
    state().addPlayerToSeat("Tess");
    const traveler = game().seatOrder.at(-1)!;
    state().assignRole(traveler, "thief");
    state().ensureSyncScope("RVSYNC01", "session-rv");
    return { ids, traveler };
  }

  it("Night -> Setup is refused and changes nothing", () => {
    liveNight();
    const before = everything();
    expect(state().setPhase("setup")).toEqual(REFUSAL);
    expect(game().phase).toBe("night");
    expectInert(before);
  });

  it("Day -> Setup is refused and changes nothing", () => {
    liveNight();
    expect(state().advancePhase().ok).toBe(true);
    const before = everything();
    expect(state().setPhase("setup")).toEqual(REFUSAL);
    expect(game().phase).toBe("day");
    expectInert(before);
  });

  it("beginNightOne() on a live game is refused and changes nothing (no restart, no canonicalization)", () => {
    const { ids } = liveNight();
    state().recordDeath(ids[0]!);
    for (const advance of [false, true]) {
      if (advance) state().advancePhase();
      const before = everything();
      expect(state().beginNightOne().ok).toBe(false);
      expectInert(before);
    }
    expect(player(ids[0]!).alive).toBe(false);
  });

  it("a legitimate death survives the attempted regression and later phase changes", () => {
    const { ids } = liveNight();
    expect(state().recordDeath(ids[0]!).ok).toBe(true);
    expect(state().setPhase("setup").ok).toBe(false);
    expect(player(ids[0]!)).toMatchObject({ alive: false, ghostVote: true });
    state().advancePhase(); state().advancePhase(); state().advancePhase(); // Day 1, Night 2, Day 2
    expect(game()).toMatchObject({ phase: "day", day: 2 });
    expect(player(ids[0]!)).toMatchObject({ alive: false, ghostVote: true });
  });

  it("a legitimate exile survives the attempted regression and later phase changes", () => {
    const { traveler } = liveNight();
    state().advancePhase();
    expect(state().recordExile(traveler, "died").ok).toBe(true);
    expect(state().setPhase("setup").ok).toBe(false);
    state().advancePhase(); state().advancePhase();
    expect(player(traveler)).toMatchObject({ alive: false, ghostVote: true, exiled: true });
  });

  it("a spent ghost vote survives the attempted regression and later phase changes", () => {
    const { ids } = liveNight();
    state().recordDeath(ids[1]!);
    expect(state().spendGhostVote(ids[1]!).ok).toBe(true);
    expect(state().setPhase("setup").ok).toBe(false);
    state().advancePhase(); state().advancePhase();
    expect(player(ids[1]!)).toMatchObject({ alive: false, ghostVote: false });
  });

  it("Undo of the initial start still restores the exact pre-start Setup, and restarting canonicalizes again", () => {
    const ids = revealedSetup();
    withPlayer(ids[0]!, STALE);
    const preStart = structuredClone(game());
    expect(state().beginNightOne().ok).toBe(true);
    expectCanonicalAlive(player(ids[0]!));
    state().undo();
    expect(game()).toEqual(preStart);
    expect(state().beginNightOne().ok).toBe(true);
    expectCanonicalAlive(player(ids[0]!));
  });

  it("an adopted genuine Setup checkpoint stays Setup and starts through beginNightOne() with canonicalization", () => {
    const ids = revealedSetup();
    withPlayer(ids[1]!, STALE);
    state().restoreRemoteCheckpoint(structuredClone(game()), null);
    expect(game().phase).toBe("setup");
    expect(state().setPhase("night").ok).toBe(true); // routes through beginNightOne()
    expect(game()).toMatchObject({ phase: "night", day: 1 });
    expectCanonicalAlive(player(ids[1]!));
    expect(game().history).toEqual([]);
  });

  it("setPhase(\"setup\") while already in Setup remains a successful true no-op", () => {
    revealedSetup();
    const before = everything();
    expect(state().setPhase("setup")).toEqual({ ok: true });
    expectInert(before);
  });

  it("the ended-game lifecycle is unchanged: leaving 'ended' (including to Setup) is refused with no change", () => {
    liveNight();
    expect(state().setPhase("ended").ok).toBe(true);
    const before = everything();
    expect(state().setPhase("setup")).toEqual({ ok: false, message: "This game has ended. Create a new setup to play again." });
    expect(state().setPhase("night").ok).toBe(false);
    expectInert(before);
  });

  it("New Game still starts a fresh Setup", () => {
    liveNight();
    state().newGame(setupScript.id, { plannedPlayerCount: 5 });
    expect(game()).toMatchObject({ phase: "setup", day: 0 });
  });
});
