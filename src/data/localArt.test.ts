// Package 3 (A5): the player phone uses self-hosted official art first.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { listBuiltinScripts } from "@/data/scripts";
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
