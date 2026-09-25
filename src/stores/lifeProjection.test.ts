import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { needsShownIdentity } from "./identity";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { lifeAccessibleLabel, lifeStatusOf, publicLifeOf, publicLifeStateOf, LIFE_STATE_LABEL } from "./lifeState";
import { makeSTPlayer } from "@/test/fixtures";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { writeProjections } from "@/firebase/sync";
import type { PlayerId } from "./types";

// Phase 10A: life is public table information; Life Events, Provenance,
// ParticipantIds and Actual Alignment are not.

const game = () => store.getState().game!;
const state = () => store.getState();
const registry = buildRegistry(setupScript);

beforeEach(() => store.setState({
  game: null, lobby: null, undoStack: [], localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
}));

function dayWithEverything(): { ids: PlayerId[]; traveler: PlayerId } {
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  for (let i = 0; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(game().players[id]!.actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  const ids = [...game().seatOrder];
  state().addPlayerToSeat("Tess");
  const traveler = game().seatOrder.at(-1)!;
  state().assignRole(traveler, "thief");
  state().setTravelerAlignment(traveler, "evil");
  state().recordDeath(ids[0]!, { provenance: { sourcePlayer: ids[1]!, sourceCharacter: "imp", reason: "SENTINEL-PROVENANCE" } });
  state().advancePhase();
  state().recordExecution(ids[1]!, "survived");
  state().recordExile(traveler, "died");
  state().spendGhostVote(traveler);
  return { ids, traveler };
}

describe("Phase 10A: public and self projections", () => {
  it("never carry the Life Event Window, Provenance, ParticipantIds or Life Event internals", () => {
    dayWithEverything();
    const serialized = JSON.stringify({ pub: projectLobbyToPublic(game(), {}), self: projectLobbyToSelfMap(game(), registry) });
    for (const secret of ["lifeEventWindow", "coverageFrom", "SENTINEL-PROVENANCE", "provenance", "participant", "resolutionId", "le-"]) {
      expect(serialized).not.toContain(secret);
    }
    // Actual Alignment never reaches the public view (a self view may carry
    // a player's OWN shown alignment, which is not a leak).
    expect(JSON.stringify(projectLobbyToPublic(game(), {}))).not.toMatch(/"(good|evil)"/);
    for (const event of game().lifeEventWindow.events) expect(serialized).not.toContain(event.id);
  });

  it("a dead Traveler with public Role art is publicly dead, exiled, and shows the vote token state; alignment stays private", () => {
    const { traveler } = dayWithEverything();
    const pub = projectLobbyToPublic(game(), {}).players[traveler]!;
    expect(pub).toMatchObject({ alive: false, ghostVote: false, exiled: true, isTraveler: true, publicDisplayRole: "thief" });
    expect(pub).not.toHaveProperty("actualAlignment");
    expect(publicLifeStateOf(pub)).toBe("exiledVoteUsed");
  });

  it("dead/alive and vote availability are accurate; exiled is absent unless the current death was an exile", () => {
    const { ids } = dayWithEverything();
    const pub = projectLobbyToPublic(game(), {}).players;
    expect(pub[ids[0]!]).toMatchObject({ alive: false, ghostVote: true });
    expect(pub[ids[0]!]).not.toHaveProperty("exiled");
    expect(pub[ids[1]!]).toMatchObject({ alive: true, ghostVote: true }); // survived execution
    expect(pub[ids[1]!]).not.toHaveProperty("exiled");
  });

  it("the storyteller checkpoint carries the window while public/player paths never do", async () => {
    dayWithEverything();
    const backend = new MemoryRoomBackend();
    await writeProjections({ backend, code: "PUBL1234", stState: { ...game(), code: "PUBL1234" }, registry, online: {} });
    const checkpoint = JSON.parse((await backend.get("lobbies/PUBL1234/checkpoint")) as string);
    expect(checkpoint.game.lifeEventWindow.events).toHaveLength(game().lifeEventWindow.events.length);
    expect(JSON.stringify(await backend.get("lobbies/PUBL1234/public"))).not.toContain("lifeEventWindow");
    expect(JSON.stringify(await backend.get("lobbies/PUBL1234/player"))).not.toContain("lifeEventWindow");
  });
});

describe("Phase 10A: lifeStatusOf / publicLifeOf", () => {
  it("derives all five public states with text for each", () => {
    const cases = [
      [{ alive: true, ghostVote: true }, "alive"],
      [{ alive: false, ghostVote: true }, "deadVote"],
      [{ alive: false, ghostVote: false }, "deadVoteUsed"],
      [{ alive: false, ghostVote: true, exiled: true, isTraveler: true }, "exiledVote"],
      [{ alive: false, ghostVote: false, exiled: true, isTraveler: true }, "exiledVoteUsed"],
    ] as const;
    for (const [over, expected] of cases) {
      const status = lifeStatusOf(makeSTPlayer(over));
      expect(status).toEqual({ state: expected, anomalies: [] });
      expect(LIFE_STATE_LABEL[status.state]).toBeTruthy();
      expect(LIFE_STATE_LABEL[status.state]).not.toMatch(/voted/);
    }
  });

  it("classifies legacy anomalies without throwing, and normalizes them away publicly", () => {
    const aliveExiled = makeSTPlayer({ alive: true, exiled: true, isTraveler: true });
    expect(lifeStatusOf(aliveExiled)).toEqual({ state: "alive", anomalies: ["aliveButExiled"] });
    expect(publicLifeOf(aliveExiled)).toEqual({ alive: true, ghostVote: true });
    const livingNoVote = makeSTPlayer({ alive: true, ghostVote: false });
    expect(lifeStatusOf(livingNoVote).anomalies).toEqual(["aliveWithoutVote"]);
    expect(publicLifeOf(livingNoVote)).toEqual({ alive: true, ghostVote: true });
    const exiledOrdinary = makeSTPlayer({ alive: false, ghostVote: true, exiled: true });
    expect(lifeStatusOf(exiledOrdinary)).toEqual({ state: "deadVote", anomalies: ["exiledNonTraveler"] });
    expect(publicLifeOf(exiledOrdinary)).toEqual({ alive: false, ghostVote: true });
    const deadEmptySeat = makeSTPlayer({ isEmpty: true, alive: false });
    expect(lifeStatusOf(deadEmptySeat).anomalies).toEqual(["emptySeatLifeState"]);
  });

  it("accessible labels name the player, seat and state", () => {
    expect(lifeAccessibleLabel("Alice", 3, "deadVote")).toBe("Alice, seat 3, dead, vote available");
    expect(lifeAccessibleLabel("Tess", 8, "exiledVoteUsed", true)).toBe("Tess, seat 8, exiled, vote used, needs check");
  });
});
