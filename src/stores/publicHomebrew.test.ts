// Stage 3 of "custom scripts everywhere": a homebrew or modified ordinary character reaches phones as what the
// physical script sheet prints (name, team, ability) and nothing the Storyteller keeps to themself.
import { describe, expect, it } from "vitest";
import { canonicalRoles } from "@/data/canonical";
import { parseClocktowerScript } from "@/data/customScript";
import { publicRoleOf, publicScriptOf } from "@/data/publicScript";
import { decodePublicSnapshot } from "@/firebase/snapshots";
import { publicScriptFields } from "./projections";
import type { PublicLobbyRecord, RoleDef, Script } from "./types";

const homebrew = (over: Partial<RoleDef> & { id: string; type: RoleDef["type"] }): RoleDef => ({
  name: over.id, provenance: { status: "homebrew" }, ...over,
});
const SECRETS = {
  firstNight: 7, otherNight: 9, firstNightReminder: "FIRSTREMINDER", otherNightReminder: "OTHERREMINDER",
  firstNightPrompt: "FIRSTPROMPT", otherNightPrompt: "OTHERPROMPT", reminders: ["REMINDERTOKEN"], remindersGlobal: ["GLOBALTOKEN"],
  setup: true, flavor: "FLAVOURTEXT", jinxes: [{ id: "imp", reason: "JINXREASON" }], iconUrl: "https://tracker.example/pixel.png", icon: "ICONFIELD",
  informationActions: [], oncePerGame: true, secretNote: "STORYTELLERONLY",
};
const clockwinder = homebrew({ id: "clockwinder", name: "Clockwinder", type: "townsfolk", ability: "Each night, you learn the hour.", ...SECRETS });

describe("publicScriptFields: homebrew characters", () => {
  const script: Script = {
    id: "mine", name: "Mine",
    characters: [...canonicalRoles(["empath"]), clockwinder, homebrew({ id: "dread", name: "Dread", type: "demon", ability: "Each night*, choose a player: they die." }), ...canonicalRoles(["imp"])],
  };

  it("lists official characters by id and homebrew ones by name, team and ability only", () => {
    expect(publicScriptFields(script)).toEqual({
      scriptName: "Mine",
      scriptCharacters: ["empath", "imp"],
      scriptHomebrew: [
        { id: "clockwinder", name: "Clockwinder", type: "townsfolk", ability: "Each night, you learn the hour." },
        { id: "dread", name: "Dread", type: "demon", ability: "Each night*, choose a player: they die." },
      ],
    });
  });

  it("never carries night order, reminders, setup, jinxes, flavour, an image address or any other field", () => {
    const json = JSON.stringify(publicScriptFields(script));
    for (const secret of ["FIRSTREMINDER", "OTHERREMINDER", "FIRSTPROMPT", "OTHERPROMPT", "REMINDERTOKEN", "GLOBALTOKEN", "FLAVOURTEXT", "JINXREASON", "tracker.example", "ICONFIELD", "STORYTELLERONLY", "firstNight", "otherNight", "setup", "iconUrl", "jinxes", "provenance"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(Object.keys(publicScriptFields(script).scriptHomebrew![0]!).sort()).toEqual(["ability", "id", "name", "type"]);
  });

  it("never lists a homebrew Traveller, Fabled or Loric", () => {
    const extras: Script = { id: "e", name: "E", characters: [homebrew({ id: "wanderer", type: "traveler", ability: "A." }), homebrew({ id: "sprite", type: "fabled", ability: "B." }), homebrew({ id: "charm", type: "loric", ability: "C." }), clockwinder] };
    expect(publicScriptFields(extras).scriptHomebrew?.map((r) => r.id)).toEqual(["clockwinder"]);
  });

  it("clips to the schema's limits, drops what cannot fit, and still decodes on a phone", () => {
    const long: Script = {
      id: "long", name: "Long",
      characters: [
        homebrew({ id: "a".repeat(41), name: "TooLongId", type: "townsfolk" }),
        homebrew({ id: "blank", name: "   ", type: "townsfolk" }),
        homebrew({ id: "wordy", name: "\u{1F319}".repeat(50), type: "outsider", ability: "x".repeat(900) }),
        homebrew({ id: "noability", name: "Quiet", type: "minion" }),
      ],
    };
    const fields = publicScriptFields(long);
    expect(fields.scriptHomebrew?.map((r) => r.id)).toEqual(["wordy", "noability"]);
    expect(fields.scriptHomebrew![0]!.name.length).toBeLessThanOrEqual(40);
    expect(fields.scriptHomebrew![0]!.ability).toHaveLength(400);
    expect(fields.scriptHomebrew![1]).toEqual({ id: "noability", name: "Quiet", type: "minion" });
    const record = { code: "ABCD2345", scriptId: "long", phase: "setup", day: 0, seatOrder: [], players: {}, fabled: [], lorics: [], ...fields };
    expect(decodePublicSnapshot(JSON.parse(JSON.stringify(record)), "ABCD2345").status).toBe("ready");
  });

  it("caps the list at 60 characters", () => {
    const many: Script = { id: "m", name: "M", characters: Array.from({ length: 75 }, (_, i) => homebrew({ id: `hb${i}`, name: `Hb ${i}`, type: "townsfolk" })) };
    expect(publicScriptFields(many).scriptHomebrew).toHaveLength(60);
  });

  it("publishes a parsed script file the same way", () => {
    const parsed = parseClocktowerScript([{ id: "_meta", name: "File" }, "empath", { id: "clockwinder", name: "Clockwinder", team: "townsfolk", ability: "Learn the hour.", firstNight: 3 }]);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(publicScriptFields(parsed.script)).toEqual({ scriptName: "File", scriptCharacters: ["empath"], scriptHomebrew: [{ id: "clockwinder", name: "Clockwinder", type: "townsfolk", ability: "Learn the hour." }] });
  });
});

describe("a phone reading the published homebrew characters", () => {
  const lobby: Pick<PublicLobbyRecord, "scriptId" | "scriptName" | "scriptCharacters" | "scriptHomebrew"> = {
    scriptId: "mine", scriptName: "Mine", scriptCharacters: ["imp"],
    scriptHomebrew: [{ id: "clockwinder", name: "Clockwinder", type: "townsfolk", ability: "Each night, you learn the hour." }, { id: "empath", name: "Empath", type: "townsfolk", ability: "Changed text." }],
  };

  it("lists official characters, then the homebrew ones, with their ability and the generic team icon", () => {
    const { characters } = publicScriptOf(lobby);
    expect(characters.map((r) => r.id)).toEqual(["imp", "clockwinder", "empath"]);
    const clock = characters[1]!;
    expect(clock).toMatchObject({ name: "Clockwinder", type: "townsfolk", ability: "Each night, you learn the hour.", iconUrl: "/art/characters/generic/townsfolk.png" });
  });

  it("shows a modified official id with the published ability and the generic icon, never the official ones", () => {
    const empath = publicRoleOf(lobby, "empath")!;
    expect(empath.ability).toBe("Changed text.");
    expect(empath.iconUrl).toBe("/art/characters/generic/townsfolk.png");
    expect(publicRoleOf({}, "empath")!.ability).not.toBe("Changed text.");
  });

  it("resolves a homebrew id, and falls back to the official catalogue for anything else", () => {
    expect(publicRoleOf(lobby, "clockwinder")?.name).toBe("Clockwinder");
    expect(publicRoleOf(lobby, "imp")?.name).toBe("Imp");
    expect(publicRoleOf(lobby, "nothing-like-this")).toBeUndefined();
    expect(publicRoleOf(null, "washerwoman")?.name).toBe("Washerwoman");
  });
});
