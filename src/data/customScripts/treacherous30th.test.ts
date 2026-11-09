// Treacherous 30th (import-only custom script): pins the committed JSON to the
// author's script sheet (character list, teams, night orders) and to verified
// canonical definitions. The expectations are typed from the sheet, not
// generated from the code under test.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import script from "./treacherous-30th.json";
import { parseClocktowerScript } from "@/data/customScript";
import { isCanonicalRole } from "@/data/canonical";
import { BUILTIN_SCRIPT_IDS } from "@/data/scripts";
import { iconUrlFor } from "@/data/iconUrl";
import { TRAVELERS } from "@/data/travelers";
import { buildRegistry } from "@/data/roleRegistry";

const TEAMS: Record<string, string[]> = {
  townsfolk: ["investigator", "librarian", "empath", "fortuneteller", "towncrier", "oracle", "undertaker", "innkeeper", "monk", "gambler", "professor", "slayer", "ravenkeeper"],
  outsider: ["drunk", "recluse", "golem", "moonchild"],
  minion: ["godfather", "poisoner", "witch", "marionette"],
  demon: ["nodashii", "imp", "shabaloth", "vigormortis"],
};
const FIRST_NIGHT = ["marionette", "poisoner", "godfather", "witch", "librarian", "investigator", "empath", "fortuneteller"];
const OTHER_NIGHTS = ["poisoner", "innkeeper", "gambler", "monk", "witch", "imp", "shabaloth", "nodashii", "vigormortis", "godfather", "professor", "moonchild", "ravenkeeper", "empath", "fortuneteller", "undertaker", "towncrier", "oracle"];
const RECOMMENDED_TRAVELLERS = ["thief", "gunslinger", "bonecollector", "deviant", "scapegoat"];

const parsed = parseClocktowerScript(script);
if (!parsed.ok) throw new Error(parsed.error);
const imported = parsed.script;

describe("Treacherous 30th import file", () => {
  it("imports as a custom script, not a built-in one", () => {
    expect(imported.name).toBe("Treacherous 30th");
    expect(imported.author).toBe("Guillermo");
    expect(imported.id).toBe("treacherous-30th");
    expect(BUILTIN_SCRIPT_IDS.has(imported.id)).toBe(false);
  });

  it("has exactly the sheet's 25 characters, in each team", () => {
    expect(imported.characters).toHaveLength(25);
    for (const [team, ids] of Object.entries(TEAMS)) {
      expect(imported.characters.filter((r) => r.type === team).map((r) => r.id).sort()).toEqual([...ids].sort());
    }
  });

  it("keeps every character a verified canonical definition", () => {
    expect(imported.characters.filter((r) => !isCanonicalRole(r)).map((r) => r.id)).toEqual([]);
  });

  it("reproduces the sheet's first-night and other-nights order", () => {
    const order = (key: "firstNight" | "otherNight") =>
      imported.characters.filter((r) => r[key]).sort((a, b) => a[key]! - b[key]!).map((r) => r.id);
    expect(order("firstNight")).toEqual(FIRST_NIGHT);
    expect(order("otherNight")).toEqual(OTHER_NIGHTS);
  });

  it("leaves Travellers to the catalogue, where all five recommended ones exist", () => {
    expect(imported.characters.some((r) => r.type === "traveler")).toBe(false);
    const registry = buildRegistry(imported);
    for (const id of RECOMMENDED_TRAVELLERS) {
      expect(TRAVELERS.some((t) => t.id === id), id).toBe(true);
      expect(registry.get(id)?.type, id).toBe("traveler");
    }
  });
});

describe("Treacherous 30th art", () => {
  const PUBLIC = resolve(__dirname, "../../../public");
  const provenance = readFileSync(resolve(PUBLIC, "art/PROVENANCE.md"), "utf8");

  it("every character, including Golem and Marionette, has a committed local icon", () => {
    for (const role of imported.characters) {
      const url = iconUrlFor(role);
      expect(url, role.id).toMatch(/^\/art\/characters\//);
      expect(existsSync(resolve(PUBLIC, "." + url)), url).toBe(true);
    }
  });

  it("lists the Golem and Marionette files in PROVENANCE.md with matching SHA-256 prefixes", () => {
    for (const rel of ["characters/carousel/golem.png", "characters/carousel/marionette.png",
      "characters/carousel/variants/golem-evil.png", "characters/carousel/variants/marionette-good.png"]) {
      const row = provenance.split("\n").find((l) => l.startsWith(`| \`${rel}\``));
      expect(row, rel).toBeTruthy();
      const prefix = /`([0-9a-f]{16})`/.exec(row!.split("|")[4] ?? "")?.[1];
      const sha = createHash("sha256").update(readFileSync(resolve(PUBLIC, "art", rel))).digest("hex");
      expect(sha.startsWith(prefix!), rel).toBe(true);
    }
    expect(provenance).toMatch(/personal_use_only/);
  });
});
