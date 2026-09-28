// Phase 10D: projection safety. An unresolvable / unsafe Shown Role fails
// CLOSED per participant -- it never throws (so it cannot block the table's
// checkpoint or anyone else's public/self projection), never exposes the
// Actual Role or Actual Alignment, and a non-Traveler can never receive a
// Traveler-type perception (which would carry the Actual Alignment through the
// Traveler projection branch).
import { describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { writeProjections } from "@/firebase/sync";
import { identityNeedsCheck, projectIdentity, projectLobbyToPublic, projectLobbyToSelfMap, projectToSelf } from "./projections";
import { previewPrivatePacket } from "./privatePackets";
import type { StorytellerLobbyRecord } from "./types";

const registry = buildRegistry(setupScript);
const code = "PROJ2345";

function table(over: Record<string, Partial<StorytellerLobbyRecord["players"][string]>>): StorytellerLobbyRecord {
  const base = setupGame(standardRoles(7), { phase: "night", day: 1, code });
  const players = { ...base.players };
  for (const [id, patch] of Object.entries(over)) players[id] = { ...players[id]!, ...patch };
  return { ...base, players };
}

describe("an unusable Shown Role fails closed per participant", () => {
  it("an unresolvable Shown Role does not throw and yields no self identity, exposing neither Actual Role nor Actual Alignment", () => {
    const p = makeSTPlayer({ id: "x", actualRole: "imp", actualAlignment: "evil", shownRole: "no-such-role", shownAlignment: "evil" });
    expect(() => projectIdentity(p, registry)).not.toThrow();
    expect(projectIdentity(p, registry)).toBeNull();
    expect(projectToSelf(p, registry)).toBeNull();
    expect(identityNeedsCheck(p, registry)).toBe(true);
    expect(() => previewPrivatePacket({ ...p, privateInfo: { extraText: "x" } }, setupGame(), registry)).toThrow(/identity/i);
  });

  it("one bad Shown Role never breaks the whole table's self map or public projection", () => {
    const g = table({ p0: { shownRole: "no-such-role" } });
    expect(() => projectLobbyToSelfMap(g, registry)).not.toThrow();
    const map = projectLobbyToSelfMap(g, registry);
    expect(map.p0).toBeUndefined();
    for (const id of g.seatOrder.filter((pid) => pid !== "p0")) expect(map[id]).toBeDefined();
    expect(projectLobbyToPublic(g, {}).players.p0).toBeDefined();
  });

  it("checkpoint / public / self publication proceeds for everyone else (writeProjections does not throw)", async () => {
    const g = table({ p0: { shownRole: "no-such-role" }, p1: { shownRole: FABLED[0]!.id }, p2: { shownRole: LORICS[0]!.id } });
    const backend = new MemoryRoomBackend();
    await backend.set(`lobbies/${code}/player/p0`, { shownRole: "stale", shownAlignment: "good" });
    await expect(writeProjections({ backend, code, stState: g, registry, online: {}, membership: {} })).resolves.toBeUndefined();
    expect(await backend.get(`lobbies/${code}/checkpoint`)).toEqual(expect.any(String));
    expect(await backend.get(`lobbies/${code}/public/players/p3`)).toBeDefined();
    expect(await backend.get(`lobbies/${code}/player/p3`)).toMatchObject({ shownRole: expect.any(String) });
    // The unsafe participants' self records are withdrawn, never a fallback to Actual identity.
    for (const id of ["p0", "p1", "p2"]) expect(await backend.get(`lobbies/${code}/player/${id}`)).toBeUndefined();
    const stored = JSON.stringify(await backend.get(`lobbies/${code}/public`));
    for (const secret of ["actualRole", "actualAlignment", "no-such-role"]) expect(stored).not.toContain(secret);
  });

  it("a Fabled or Loric Shown Role is never delivered to an ordinary participant", () => {
    for (const shownRole of [FABLED[0]!.id, LORICS[0]!.id]) {
      const p = makeSTPlayer({ id: "x", actualRole: "chef", shownRole });
      expect(projectToSelf(p, registry)).toBeNull();
      expect(identityNeedsCheck(p, registry)).toBe(true);
    }
  });

  it("a malformed published packet degrades to the plain identity, never a throw", () => {
    const p = makeSTPlayer({ id: "x", actualRole: "chef", shownRole: "chef", shownAlignment: "good",
      publishedPacket: { id: "sent", payload: { shownRole: "chef", shownAlignment: "good", bluffs: [""] } as never } });
    expect(() => projectToSelf(p, registry)).not.toThrow();
    expect(projectToSelf(p, registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
  });
});

describe("the Traveler-shown-role alignment leak is structurally closed", () => {
  it("a NON-Traveler with a Traveler-type Shown Role receives nothing -- the Traveler branch (which mirrors Actual Alignment) is Traveler-only", () => {
    const evil = makeSTPlayer({ id: "x", actualRole: "imp", actualAlignment: "evil", shownRole: "thief", isTraveler: false });
    expect(projectToSelf(evil, registry)).toBeNull();
    expect(JSON.stringify(projectLobbyToSelfMap({ ...setupGame(), players: { x: evil }, seatOrder: ["x"] }, registry))).not.toContain("evil");
    expect(identityNeedsCheck(evil, registry)).toBe(true);
  });

  it("an actual Traveler is unchanged: public character plus their own Actual Alignment, privately", () => {
    const traveler = makeSTPlayer({ id: "t", actualRole: "thief", actualAlignment: "evil", shownRole: "thief", isTraveler: true, publicDisplayRole: "thief" });
    expect(projectToSelf(traveler, registry)).toEqual({ shownRole: "thief", shownAlignment: "evil" });
    expect(identityNeedsCheck(traveler, registry)).toBe(false);
  });

  it("safe identities are unchanged: ordinary explicit perception, unrevealed, empty seat", () => {
    expect(projectToSelf(makeSTPlayer({ actualRole: "imp", shownRole: "chef", shownAlignment: null }), registry)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(projectToSelf(makeSTPlayer({ actualRole: "imp", shownRole: "chef", shownAlignment: "evil" }), registry)).toEqual({ shownRole: "chef", shownAlignment: "evil" });
    expect(projectToSelf(makeSTPlayer({ actualRole: "chef", shownRole: null }), registry)).toBeNull();
    expect(identityNeedsCheck(makeSTPlayer({ actualRole: "chef", shownRole: null }), registry)).toBe(false);
    expect(projectToSelf(makeSTPlayer({ isEmpty: true, shownRole: "chef" }), registry)).toBeNull();
  });
});
