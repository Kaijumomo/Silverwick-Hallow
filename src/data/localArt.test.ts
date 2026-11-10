// @vitest-environment node
// Package 3 (A5): the player phone uses self-hosted official art first.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { listBuiltinScripts } from "@/data/scripts";
import { publicScriptOf } from "@/data/publicScript";
import { listOfficialRoles } from "@/data/officialRoles";
import { TRAVELERS } from "@/data/travelers";
import { iconUrlFor } from "./iconUrl";
import { localCharacterArt } from "./localArt";

const PUBLIC = resolve(__dirname, "../../public");
const provenance = readFileSync(resolve(PUBLIC, "art/PROVENANCE.md"), "utf8");

describe("local official character art (Package 3 A5)", () => {
  const roles = [...listBuiltinScripts().flatMap((s) => s.characters), ...TRAVELERS];

  it("every built-in script character and Traveller has a committed local icon", () => {
    const missing = roles.filter((r) => !localCharacterArt(r.id) || !existsSync(resolve(PUBLIC, "." + localCharacterArt(r.id)!)));
    expect(missing.map((r) => r.id)).toEqual([]);
  });

  it("iconUrlFor prefers the local file and only falls back to the CDN when none exists", () => {
    const empath = roles.find((r) => r.id === "empath")!;
    expect(iconUrlFor(empath)).toBe("/art/characters/tb/empath.png");
    expect(iconUrlFor("imp")).toBe("/art/characters/tb/imp.png");
    expect(iconUrlFor({ ...empath, id: "notacharacter" })).toMatch(/^https:\/\/release\.botc\.app\//);
    expect(iconUrlFor({ ...empath, iconUrl: "https://example.test/own.png" })).toBe("https://example.test/own.png");
  });

  it("every committed file is listed in PROVENANCE.md with its recorded source and a matching SHA-256 prefix", () => {
    for (const r of roles) {
      const url = localCharacterArt(r.id)!;
      const rel = url.replace(/^\/art\//, "");
      const row = provenance.split("\n").find((l) => l.startsWith(`| \`${rel}\``));
      expect(row, rel).toBeTruthy();
      const prefix = /`([0-9a-f]{16})`/.exec(row!.split("|")[4] ?? "")?.[1];
      const sha = createHash("sha256").update(readFileSync(resolve(PUBLIC, "." + url))).digest("hex");
      expect(sha.startsWith(prefix!), rel).toBe(true);
    }
  });
});

describe("self-hosted art for all 181 official characters (custom scripts, Stage 2)", () => {
  const all = listOfficialRoles();

  it("every official character has a committed local icon, so no custom script needs the CDN", () => {
    expect(all).toHaveLength(181);
    const missing = all.filter((r) => !localCharacterArt(r.id) || !existsSync(resolve(PUBLIC, "." + localCharacterArt(r.id)!)));
    expect(missing.map((r) => r.id)).toEqual([]);
    expect(all.filter((r) => /^https:/.test(iconUrlFor(r))).map((r) => r.id)).toEqual([]);
  });

  it("every one of those files is listed in PROVENANCE.md", () => {
    const unlisted = all.map((r) => localCharacterArt(r.id)!.replace(/^\/art\//, "")).filter((rel) => !provenance.includes(`| \`${rel}\``));
    expect(unlisted).toEqual([]);
  });
});

describe("homebrew characters with no art of their own (custom scripts, Stage 3)", () => {
  const homebrew = (over: Record<string, unknown>) => ({ id: "clockwinder", name: "Clockwinder", type: "townsfolk", provenance: { status: "homebrew" }, ...over }) as never;

  it("wear their team's generic icon on the grimoire, the same as on the phone, never a CDN address", () => {
    for (const type of ["townsfolk", "outsider", "minion", "demon"]) {
      const url = iconUrlFor(homebrew({ type }));
      expect(url).toBe(`/art/characters/generic/${type}.png`);
      expect(existsSync(resolve(PUBLIC, "." + url))).toBe(true);
    }
  });

  it("do so even when they reuse an official id, as on the phone, while the official character keeps its own art", () => {
    expect(iconUrlFor(homebrew({ id: "empath" }))).toBe("/art/characters/generic/townsfolk.png");
    expect(iconUrlFor("empath")).toBe("/art/characters/tb/empath.png");
  });

  it("use the very file the phone is given for the same character", () => {
    const entry = { id: "clockwinder", name: "Clockwinder", type: "demon" as const };
    expect(iconUrlFor(homebrew({ type: "demon" }))).toBe(publicScriptOf({ scriptId: "x", scriptHomebrew: [entry] }).characters[0]!.iconUrl);
  });

  it("keep an author's own image address on the grimoire (a phone never loads one)", () => {
    expect(iconUrlFor(homebrew({ iconUrl: "https://example.test/own.png" }))).toBe("https://example.test/own.png");
  });
});
