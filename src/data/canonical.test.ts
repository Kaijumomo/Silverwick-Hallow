import { describe, it, expect } from "vitest";
import { CANONICAL_REVISION, canonicalRoles, isCanonicalRole, roleAuthority } from "./canonical";
import raw from "./canonical/roles.json";
import { BUILTIN_SCRIPTS } from "./scripts";
import { EXPERIMENTAL_CHARACTERS } from "./scripts/experimental";
import { TRAVELERS } from "./travelers";
import { FABLED } from "./fabled";
import { LORICS } from "./lorics";
import { RoleDefSchema } from "@/stores/schemas";
import { parseClocktowerScript } from "./customScript";
import { JINXES, jinxBetween } from "./jinxes";

const shipped = [...Object.values(BUILTIN_SCRIPTS).flatMap(s => s.characters), ...EXPERIMENTAL_CHARACTERS, ...TRAVELERS, ...FABLED, ...LORICS];
describe("canonical publisher asset adapter", () => {
  it("all 172 existing bundled records are verified and runtime valid, without changing roster membership", () => {
    expect(shipped).toHaveLength(172);
    expect(new Set(shipped.map(r => r.id)).size).toBe(172);
    for (const r of shipped) {
      expect(RoleDefSchema.safeParse(r).success, r.id).toBe(true);
      expect(isCanonicalRole(r), r.id).toBe(true);
      expect(r.ability).toBe(raw.find(source => source.id === r.id)!.ability);
      expect(r.provenance?.revision).toBe(CANONICAL_REVISION);
      if (r.firstNight) expect(r.firstNightPrompt?.trim(), r.id).toBeTruthy();
      if (r.otherNight) expect(r.otherNightPrompt?.trim(), r.id).toBeTruthy();
      expect(r.firstNightPrompt ?? "").not.toContain(":reminder:");
    }
  });
  it.each([
    ["pope", "duplicate good characters"],
    ["stormcatcher", "can only die by execution"],
    ["toymaker", "Evil players get normal starting info"],
    ["king", "dead equal or outnumber the living"],
    ["legion", "Executions fail if only evil voted"],
    ["boomdandy", "10 to 1 countdown"],
  ])("%s retains the verified gameplay meaning", (id, text) =>
    expect(canonicalRoles([id])[0]!.ability).toContain(text));
  it("official experimental, official, homebrew and unverified references remain distinct", () => {
    expect(roleAuthority(canonicalRoles(["king"])[0]!)).toBe("Official · experimental");
    expect(roleAuthority(canonicalRoles(["butler"])[0]!)).toBe("Official · verified");
    const role = { id: "custom", name: "Custom", type: "townsfolk" as const };
    expect(roleAuthority(role)).toBe("Unverified reference");
    expect(roleAuthority({ ...role, provenance: { status: "homebrew" } })).toBe("Homebrew");
  });
  it("custom objects cannot claim authority by reusing an ID or copying provenance", () => {
    const original = canonicalRoles(["empath"])[0]!;
    const input = { ...original, ability: "Invented ability." };
    expect(isCanonicalRole(input)).toBe(false);
    expect(roleAuthority(input)).toBe("Unverified reference");
    const parsed = parseClocktowerScript([input]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(roleAuthority(parsed.script.characters[0]!)).toBe("Homebrew");
    const byId = parseClocktowerScript(["empath"]);
    if (byId.ok) expect(isCanonicalRole(byId.script.characters[0]!)).toBe(true);
  });
  it("new custom negative/infinite ordering is rejected without migrating old games", () => {
    for (const firstNight of [-1, Infinity]) expect(parseClocktowerScript([{ id: "a", name: "A", type: "townsfolk", firstNight }]).ok).toBe(false);
  });
  it("invented jinxes are removed; official pairs remain symmetric and unique", () => {
    expect(jinxBetween("poisoner", "fortuneteller")).toBeUndefined();
    expect(jinxBetween("vortox", "courtier")).toBeUndefined();
    expect(jinxBetween("imp", "pukka")).toBeUndefined();
    expect(jinxBetween("marionette", "lunatic")).toBeUndefined();
    const jinx = jinxBetween("alchemist", "boffin");
    expect(jinx).toBeDefined();
    expect(jinx).toEqual(jinxBetween("boffin", "alchemist"));
    expect(new Set(JINXES.map(j => [j.a, j.b].sort().join("/"))).size).toBe(JINXES.length);
  });
});
