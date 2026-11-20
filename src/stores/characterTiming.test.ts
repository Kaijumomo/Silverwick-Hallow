// SV-1 (PO 2026-11-15): character timing and the Juggler's Night. "On your 1st day, publicly guess up to 5 players' characters. That
// night, you learn how many you got correct." https://wiki.bloodontheclocktower.com/Juggler -- the Juggler wakes once, on the night
// after their first Day as the Juggler. Production store, real coordinator, real projections, real checkpoint recovery.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { buildSetupGame } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { computeNightOrder } from "@/rules/night/nightOrder";
import { BARBER_PLAYERS } from "@/abilities/characters/barber";
import { MemoryRoomBackend } from "@/test/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { SessionWriter } from "@/firebase/writer";
import { startStorytellerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { bind, openInStore, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
/** The Storyteller's mid-game "Change character" (the grimoire's picker): the player is told, so the shown character follows. */
const byHand = (id: string, role: string) => {
  const p = game().players[id]!;
  expect(store.getState().resolveRoles({ intents: toldRoleChangeIntents(p, role, p.shownAlignment) }).ok).toBe(true);
};
/** Whether the player's Juggler row is on tonight's Night list. */
const jugglerListed = (g: StorytellerLobbyRecord, id: string) => computeNightOrder(g.players, g.seatOrder, proofScript, false, g)
  .some((s) => s.kind === "player" && s.playerId === id && s.effectiveRoleId === "juggler");
/** The same game moved to Night `day` (nothing else changes). */
const atNight = (g: StorytellerLobbyRecord, day: number): StorytellerLobbyRecord => ({ ...g, phase: "night", day });
// p0 barber, p1 imp, p2 juggler, p3 dreamer, p4 savant, p5 pithag
const ROLES = ["barber", "imp", "juggler", "dreamer", "savant", "pithag"];
const swapNight = (g = proofGame(ROLES, "night", 3)) => {
  const killed = planned(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") })));
  return planned(plan(killed, request(killed, "p0", "barber", { [BARBER_PLAYERS]: pick(killed, "p3", "p2") },
    { invocationPath: "nightTrigger", withStep: true, completeStep: true })));
};

beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

describe("character timing: what is recorded", () => {
  it("a new game records character changes from Night 1; no player has timing at the deal", () => {
    const g = buildSetupGame(proofScript);
    expect(g.characterSinceFrom).toEqual({ phase: "night", day: 1 });
    expect(Object.values(g.players).some((p) => p.characterSince)).toBe(false);
  });

  it("a real change in play starts a fresh character now (Night or Day); a correction or a perception change keeps the timing; Setup records none", () => {
    openInStore(proofGame(ROLES, "night", 3));
    expect(store.getState().assignRole("p4", "juggler").ok).toBe(true);
    expect(game().players.p4!.characterSince).toEqual({ phase: "night", day: 3 });
    expect(store.getState().correctRole("p4", "oracle").ok).toBe(true);
    expect(game().players.p4!.actualRole).toBe("oracle");
    expect(game().players.p4!.characterSince).toEqual({ phase: "night", day: 3 });
    expect(store.getState().setShownRole("p4", "dreamer").ok).toBe(true);
    expect(game().players.p4!.characterSince).toEqual({ phase: "night", day: 3 });
    openInStore(proofGame(ROLES, "day", 4));
    expect(store.getState().assignRole("p3", "juggler").ok).toBe(true);
    expect(game().players.p3!.characterSince).toEqual({ phase: "day", day: 4 });
    const setup = buildSetupGame(proofScript);
    expect(Object.values(setup.players).some((p) => p.characterSince)).toBe(false);
  });

  it("the Barber's swap and the Pit-Hag record it too; Undo restores the character and its timing together", () => {
    const swapped = swapNight();
    expect(swapped.players.p2!).toMatchObject({ actualRole: "dreamer", characterSince: { phase: "night", day: 3 } });
    expect(swapped.players.p3!).toMatchObject({ actualRole: "juggler", characterSince: { phase: "night", day: 3 } });
    const g = proofGame(ROLES, "night", 3);
    const hagged = planned(plan(g, request(g, "p5", "pithag", { target: pick(g, "p4"), character: { kind: "character", roleIds: ["oracle"] } })));
    expect(hagged.players.p4!).toMatchObject({ actualRole: "oracle", characterSince: { phase: "night", day: 3 } });
    openInStore(proofGame(ROLES, "night", 3));
    expect(store.getState().assignRole("p4", "juggler").ok).toBe(true);
    store.getState().undo();
    expect(game().players.p4!.actualRole).toBe("savant");
    expect(game().players.p4!.characterSince).toBeUndefined();
  });
});

describe("the Juggler's Night: only the night after their first Day as the Juggler", () => {
  it("from the deal: Night 2 only", () => {
    const g = proofGame(ROLES, "night", 2);
    expect(jugglerListed(g, "p2")).toBe(true);
    expect(jugglerListed(atNight(g, 3), "p2")).toBe(false);
    expect(jugglerListed(atNight(g, 5), "p2")).toBe(false);
  });

  it("made the Juggler by the Barber's swap on Night 3: not that night, Night 4 only", () => {
    const g = swapNight();
    expect(jugglerListed(g, "p3")).toBe(false);
    expect(jugglerListed(atNight(g, 4), "p3")).toBe(true);
    expect(jugglerListed(atNight(g, 5), "p3")).toBe(false);
  });

  it("made the Juggler by the Pit-Hag on Night 3, or by hand during Day 3: Night 4 only", () => {
    const g = proofGame(ROLES.map((r) => r === "juggler" ? "clockmaker" : r), "night", 3);
    const hagged = planned(plan(g, request(g, "p5", "pithag", { target: pick(g, "p4"), character: { kind: "character", roleIds: ["juggler"] } })));
    expect([3, 4, 5].map((day) => jugglerListed(atNight(hagged, day), "p4"))).toEqual([false, true, false]);
    openInStore(proofGame(ROLES, "day", 3));
    byHand("p4", "juggler");
    expect([3, 4, 5].map((day) => jugglerListed(atNight(game(), day), "p4"))).toEqual([false, true, false]);
  });

  it("changed away and made the Juggler again: a fresh character, so a fresh first Day", () => {
    openInStore(proofGame(ROLES, "night", 3));
    byHand("p2", "oracle");
    store.setState({ game: { ...game(), phase: "night", day: 5 } });
    byHand("p2", "juggler");
    expect([5, 6, 7].map((day) => jugglerListed(atNight(game(), day), "p2"))).toEqual([false, true, false]);
  });

  it("a game saved before character timing existed: nothing is assumed, so the row stays on every later night (as before)", () => {
    const old = proofGame(ROLES, "night", 2, { characterSinceFrom: undefined });
    delete (old as Partial<StorytellerLobbyRecord>).characterSinceFrom;
    expect([2, 3, 4].map((day) => jugglerListed(atNight(old, day), "p2"))).toEqual([true, true, true]);
    // A change made after the update is known exactly, even in that game.
    const known = patchPlayer(old, "p4", { actualRole: "juggler", shownRole: "juggler", characterSince: { phase: "night", day: 3 } });
    expect([3, 4, 5].map((day) => jugglerListed(atNight(known, day), "p4"))).toEqual([false, true, false]);
  });

  it("a dead Juggler is never listed", () => {
    expect(jugglerListed(patchPlayer(proofGame(ROLES, "night", 2), "p2", { alive: false }), "p2")).toBe(false);
  });
});

describe("character timing: private, saved and recovered", () => {
  it("never reaches a player's view or the public view", () => {
    const g = swapNight();
    const text = JSON.stringify([projectLobbyToPublic(g, {}), projectLobbyToSelfMap(g, proofRegistry)]);
    expect(text).not.toMatch(/characterSince/);
  });

  it("the saved-game schema keeps both fields; an app that does not know a field still opens the game (it drops the field)", () => {
    const g = swapNight();
    const parsed = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(g)));
    expect(parsed.characterSinceFrom).toEqual({ phase: "night", day: 1 });
    expect(parsed.players.p3!.characterSince).toEqual({ phase: "night", day: 3 });
    const withFutureField = { ...g, someLaterField: { x: 1 }, players: { ...g.players, p3: { ...g.players.p3!, someLaterField: 1 } } };
    const opened = StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(withFutureField)));
    expect(opened.success).toBe(true);
    expect(opened.success && "someLaterField" in opened.data).toBe(false);
  });

  it("survives Firebase checkpoint recovery on a new device", async () => {
    const code = "JUGL2345";
    usePlayerStore.getState().reset();
    useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
    const g = { ...swapNight(), code, storytellerUid: "host" };
    const b = new MemoryRoomBackend();
    await b.set(`lobbies/${code}/checkpoint`, JSON.stringify({ game: g, roster: {} }));
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.getState().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, writer);
    try {
      expect(recovered.outcome).toBe("live");
      expect(game().characterSinceFrom).toEqual({ phase: "night", day: 1 });
      expect(game().players.p3!).toMatchObject({ actualRole: "juggler", characterSince: { phase: "night", day: 3 } });
      expect(bind(game(), "p3").participantId).toBe(g.players.p3!.participantId);
    } finally {
      recovered.stop(); writer.dispose();
    }
  });
});

afterEach(() => store.setState({ lobby: null }));
