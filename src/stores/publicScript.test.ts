// Phone support for imported custom scripts: the public lobby carries only the
// script's name and verified official character ids -- never a definition,
// ability text or anything Storyteller-only.
import { describe, expect, it } from "vitest";
import { makePublishedSTPlayer } from "@/test/fixtures";
import { canonicalRoles } from "@/data/canonical";
import { parseClocktowerScript } from "@/data/customScript";
import { publicScriptOf } from "@/data/publicScript";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { decodePublicSnapshot } from "@/firebase/snapshots";
import { projectLobbyToPublic, publicScriptFields } from "./projections";
import type { Script, StorytellerLobbyRecord } from "./types";

const imported = (() => {
  const result = parseClocktowerScript([{ id: "_meta", name: "Treacherous Test", author: "A" }, "empath", "golem", "marionette", "imp", "witch"]);
  if (!result.ok) throw new Error(result.error);
  return result.script;
})();

function lobby(scriptId: string): StorytellerLobbyRecord {
  return {
    gameSchemaVersion: 29, preparedInformation: [], playerInfoLog: [], gameRuleFacts: [],
    code: "ABCD12", storytellerUid: "uid-st", scriptId, phase: "setup", day: 0,
    bluffs: ["chef", "washerwoman", "saint"], fabled: [], lorics: [], notes: "ST-only", seatOrder: ["p1"],
    nightProgress: {}, rolePool: [], history: [], informationDeliveries: [],
    lifeEventWindow: { coverageFrom: { phase: "setup", day: 0 }, events: [] },
    plannedPlayerCount: 0, plannedTravelerCount: 0, pendingPlayers: {},
    players: { p1: makePublishedSTPlayer({ id: "p1", actualRole: "imp", shownRole: "imp" }) },
  } as unknown as StorytellerLobbyRecord;
}

describe("publicScriptFields", () => {
  it("publishes the name and the official character ids in script order", () => {
    expect(publicScriptFields(imported)).toEqual({ scriptName: "Treacherous Test", scriptCharacters: ["empath", "golem", "marionette", "imp", "witch"] });
  });

  it("omits a homebrew or modified definition, so a phone never shows the wrong ability for its id", () => {
    const modified = { ...canonicalRoles(["empath"])[0]!, ability: "Changed text." };
    const script: Script = { id: "x", name: "X", characters: [modified, ...canonicalRoles(["imp"])] };
    expect(publicScriptFields(script).scriptCharacters).toEqual(["imp"]);
    const none: Script = { id: "y", name: "Y", characters: [modified] };
    expect(publicScriptFields(none)).toEqual({ scriptName: "Y" });
  });

  it("is empty without a script and clips an overlong name", () => {
    expect(publicScriptFields(undefined)).toEqual({});
    expect(publicScriptFields({ ...imported, name: "N".repeat(90) }).scriptName).toHaveLength(60);
  });
});

describe("public lobby projection with a script", () => {
  it("adds only the name and ids; nothing from the definitions or the Storyteller record", () => {
    const pub = projectLobbyToPublic(lobby("treacherous-test"), {}, undefined, imported);
    expect(pub.scriptName).toBe("Treacherous Test");
    expect(pub.scriptCharacters).toEqual(["empath", "golem", "marionette", "imp", "witch"]);
    const json = JSON.stringify(pub);
    for (const secret of ["ST-only", "uid-st", "bluffs", "actualRole", "shownRole", "Each night", "ability", "author"]) expect(json).not.toContain(secret);
    const without = projectLobbyToPublic(lobby("treacherous-test"), {});
    expect(without.scriptName).toBeUndefined();
    expect(without.scriptCharacters).toBeUndefined();
  });

  it("survives the phone-side decoder, and an older record without the fields still decodes", () => {
    const pub = projectLobbyToPublic(lobby("treacherous-test"), {}, undefined, imported);
    const decoded = decodePublicSnapshot(JSON.parse(JSON.stringify(pub)), "ABCD12");
    expect(decoded.status).toBe("ready");
    if (decoded.status === "ready") expect(decoded.data.scriptCharacters).toEqual(["empath", "golem", "marionette", "imp", "witch"]);
    const old = decodePublicSnapshot(JSON.parse(JSON.stringify(projectLobbyToPublic(lobby("tb"), {}))), "ABCD12");
    expect(old.status).toBe("ready");
  });
});

describe("publicScriptOf (phone)", () => {
  it("uses the built-in script when the id is built in", () => {
    const tb = publicScriptOf({ scriptId: "tb" });
    expect(tb.name).toBe("Trouble Brewing");
    expect(tb.characters).toHaveLength(BUILTIN_SCRIPTS.tb!.characters.length);
  });

  it("builds a custom script from the published ids, skipping any that do not resolve", () => {
    const result = publicScriptOf({ scriptId: "treacherous-test", scriptName: "Treacherous Test", scriptCharacters: ["empath", "golem", "notacharacter", "marionette"] });
    expect(result.name).toBe("Treacherous Test");
    expect(result.characters.map((r) => r.id)).toEqual(["empath", "golem", "marionette"]);
  });

  it("is empty for a custom script from an older Storyteller, and for no lobby", () => {
    expect(publicScriptOf({ scriptId: "custom-1" })).toEqual({ characters: [] });
    expect(publicScriptOf(null)).toEqual({ characters: [] });
  });
});
