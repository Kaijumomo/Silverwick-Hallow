// Package 3 (A1): public arrival names for the waiting lobby. Pure derivation
// and projection; the live writer path is covered in setupFlowLifecycle.test.tsx.
import { describe, expect, it } from "vitest";
import { computeArrivals } from "./arrivals";
import { projectLobbyToPublic } from "@/stores/projections";
import { PublicLobbyRecordSchema } from "@/stores/schemas";
import { useStorytellerStore } from "@/stores/storytellerStore";

const setupGame = (names: string[] = []) => {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0, terminalClose: null });
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 7, keepView: true, plannedSeatNames: names });
  return useStorytellerStore.getState().game!;
};

describe("computeArrivals", () => {
  it("lists requested names of unseated arrivals in arrival order, trimmed", () => {
    const game = setupGame();
    const out = computeArrivals(game, [{ uid: "a", playerId: null }, { uid: "b", playerId: null }], { a: " Bram ", b: "Ivy" });
    expect(out).toEqual(["Bram", "Ivy"]);
  });

  it("a seated arrival contributes the Storyteller's seat name; a pending name never wins over it", () => {
    const game = setupGame(["Seated Sue"]);
    const seat = game.seatOrder[0]!;
    const withPending = { ...game, pendingPlayers: { a: "Old Name" } };
    expect(computeArrivals(withPending, [{ uid: "a", playerId: seat }], { a: "Old Name" })).toEqual(["Seated Sue"]);
  });

  it("emits nothing once the game leaves Setup, and skips blank names", () => {
    const game = setupGame();
    expect(computeArrivals({ ...game, phase: "night" }, [{ uid: "a", playerId: null }], { a: "Bram" })).toEqual([]);
    expect(computeArrivals(game, [{ uid: "a", playerId: null }], { a: "   " })).toEqual([]);
  });

  it("never carries a uid or any role/seat binding", () => {
    const game = setupGame();
    const out = computeArrivals(game, [{ uid: "uid-secret-123", playerId: null }], { "uid-secret-123": "Bram" });
    expect(JSON.stringify(out)).not.toContain("uid-secret-123");
  });
});

describe("public projection of arrivals", () => {
  it("publishes arrivals and the planned count during Setup, schema-valid, with no uid", () => {
    const game = setupGame();
    const pub = projectLobbyToPublic({ ...game, code: "ABCD2345" }, {}, ["Bram", "Ivy"]);
    expect(pub.arrivals).toEqual(["Bram", "Ivy"]);
    expect(pub.plannedPlayers).toBe(7);
    expect(PublicLobbyRecordSchema.safeParse(JSON.parse(JSON.stringify(pub))).success).toBe(true);
  });

  it("publishes an empty arrivals list (not absent) when nobody is here during Setup", () => {
    expect(projectLobbyToPublic(setupGame(), {}, []).arrivals).toEqual([]);
  });

  it("is absent outside Setup and from callers that pass no arrivals (older behaviour)", () => {
    const game = setupGame();
    expect(projectLobbyToPublic(game, {}).arrivals).toBeUndefined();
    const live = projectLobbyToPublic({ ...game, phase: "night" }, {}, ["Bram"]);
    expect(live.arrivals).toBeUndefined();
    expect(live.plannedPlayers).toBeUndefined();
  });
});
