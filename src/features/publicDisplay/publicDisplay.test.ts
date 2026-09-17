import { describe, expect, it } from "vitest";
import { selectActiveFabled } from "./presenters";
import type { PlayerPublicRecord, PublicLobbyRecord } from "@/stores/types";

function makePublic(over: Partial<PublicLobbyRecord> = {}): PublicLobbyRecord {
  return {
    code: "ABCD",
    scriptId: "tb",
    phase: "night",
    day: 1,
    seatOrder: [],
    players: {},
    fabled: [],
    lorics: [],
    ...over,
  };
}

const FORBIDDEN_KEYS = [
  "actualRole",
  "shownRole",
  "shownAlignment",
  "behaviorMode",
  "bluffs",
  "fakeMinions",
  "stNotes",
  "statuses",
  "reminders",
  "actualAlignment",
  "effects",
] as const;

describe("selectActiveFabled", () => {
  it("resolves fabled IDs to {id, name, ability} entries", () => {
    const lobby = makePublic({ fabled: ["djinn", "doomsayer"] });
    const result = selectActiveFabled(lobby);
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.name).sort();
    expect(names).toEqual(["Djinn", "Doomsayer"]);
    for (const r of result) {
      expect(typeof r.ability).toBe("string");
    }
  });

  it("returns empty array when fabled list is empty", () => {
    const lobby = makePublic({ fabled: [] });
    expect(selectActiveFabled(lobby)).toEqual([]);
  });
});

describe("public display view-model has no private fields", () => {
  it("stringified presenter output + lobby contains no forbidden keys", () => {
    const players: Record<string, PlayerPublicRecord> = {
      p1: {
        id: "p1",
        name: "Alice",
        seat: 0,
        alive: true,
        ghostVote: true,
        online: true,
        joinedAt: 1,
        isTraveler: false,
      },
      p2: {
        id: "p2",
        name: "Bob",
        seat: 1,
        alive: false,
        ghostVote: false,
        online: false,
        joinedAt: 2,
        isTraveler: true,
        publicDisplayRole: "saint",
      },
    };
    const lobby = makePublic({
      seatOrder: ["p1", "p2"],
      players,
      fabled: ["djinn"],
    });
    const fabled = selectActiveFabled(lobby);
    const json = JSON.stringify({ lobby, fabled });
    for (const key of FORBIDDEN_KEYS) {
      expect(json, `view-model contained forbidden "${key}"`).not.toContain(`"${key}"`);
    }
  });
});
