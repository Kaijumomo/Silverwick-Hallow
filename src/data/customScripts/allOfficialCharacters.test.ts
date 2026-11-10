// @vitest-environment node
// Stage 1 of "custom scripts everywhere": every one of the 181 official characters can be imported by id into a
// custom script, and what the phones and the public display are told about that script stays public-safe.
import { describe, expect, it } from "vitest";
import { listOfficialRoles } from "@/data/officialRoles";
import { isCanonicalRole } from "@/data/canonical";
import { parseClocktowerScript } from "@/data/customScript";
import { publicScriptOf } from "@/data/publicScript";
import { buildRegistry } from "@/data/roleRegistry";
import { BUILTIN_SCRIPT_IDS } from "@/data/scripts";
import { buildSetupGame } from "@/stores/storytellerStore";
import { publicScriptFields } from "@/stores/projections";
import { buildTownSquareView } from "@/features/publicDisplay/townSquareModel";
import type { PublicLobbyRecord, Script } from "@/stores/types";

const official = listOfficialRoles();
const ORDINARY = new Set(["townsfolk", "outsider", "minion", "demon"]);

function importScript(ids: string[], name = "Everything"): Script {
  const result = parseClocktowerScript([{ id: "_meta", name, author: "Test" }, ...ids]);
  if (!result.ok) throw new Error(result.error);
  return result.script;
}

describe("a custom script of all 181 official characters", () => {
  it("has the 181 official characters, none duplicated", () => {
    expect(official).toHaveLength(181);
    expect(new Set(official.map((role) => role.id)).size).toBe(181);
  });

  const all = importScript(official.map((role) => role.id));

  it("imports every character as its verified definition, as a custom script", () => {
    expect(all.characters.map((role) => role.id)).toEqual(official.map((role) => role.id));
    expect(all.characters.filter((role) => !isCanonicalRole(role)).map((role) => role.id)).toEqual([]);
    expect(BUILTIN_SCRIPT_IDS.has(all.id)).toBe(false);
  });

  it("builds a registry and a Setup game from it", () => {
    expect(() => buildRegistry(all)).not.toThrow();
    expect(buildSetupGame(all, { plannedPlayerCount: 15, plannedTravelerCount: 0 }).scriptId).toBe(all.id);
  });

  it("publishes its name and every ordinary character id, and no Traveller, Fabled or Loric", () => {
    const ordinary = official.filter((role) => ORDINARY.has(role.type)).map((role) => role.id);
    expect(ordinary).toHaveLength(138);
    expect(publicScriptFields(all)).toEqual({ scriptName: "Everything", scriptCharacters: ordinary });
  });

  it("resolves back on a phone to the same ordinary characters", () => {
    const fields = publicScriptFields(all);
    const seen = publicScriptOf({ scriptId: all.id, ...fields });
    expect(seen.name).toBe("Everything");
    expect(seen.characters.map((role) => role.id)).toEqual(fields.scriptCharacters);
  });

  it("is named on the public display", () => {
    const lobby = { code: "ABCD2345", scriptId: all.id, phase: "day", day: 1, fabled: [], lorics: [], seatOrder: [], players: {}, ...publicScriptFields(all) } as PublicLobbyRecord;
    expect(buildTownSquareView({ lobby, status: "live" }).scriptName).toBe("Everything");
  });
});

describe.each(official.map((role) => [role.id, role.type] as const))("a one-character custom script: %s", (id, type) => {
  it("imports, and is shown to phones only if it is an ordinary character", () => {
    const script = importScript([id], "Solo");
    expect(script.characters.map((role) => role.id)).toEqual([id]);
    expect(isCanonicalRole(script.characters[0]!)).toBe(true);
    expect(publicScriptFields(script).scriptCharacters).toEqual(ORDINARY.has(type) ? [id] : undefined);
  });
});
