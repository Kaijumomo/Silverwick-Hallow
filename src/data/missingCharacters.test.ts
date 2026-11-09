// feature/missing-characters: the eight official characters that were in the
// pinned canonical data but not in any shipped roster. They are reference and
// manual-play characters only: no new rules, schema or ability behaviour.
import { describe, expect, it } from "vitest";
import { CANONICAL_REVISION, NIGHT_SHEET, isCanonicalRole } from "./canonical";
import raw from "./canonical/roles.json";
import { listOfficialRoles, lookupOfficialRole } from "./officialRoles";
import { FABLED } from "./fabled";
import { EXPERIMENTAL_CHARACTERS } from "./scripts/experimental";
import { RoleDefSchema } from "@/stores/schemas";
import { buildReferenceCategories } from "@/features/home/referenceCategories";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { canonicalRoles } from "./canonical";
import { makeSTPlayer } from "@/test/fixtures";
import type { Script } from "@/stores/types";

const EXPERIMENTAL = ["shugenja", "harpy", "summoner", "kazali", "lordoftyphon", "leviathan"];
const FABLED_IDS = ["deusexfiasco", "ferryman"];
const ALL = [...EXPERIMENTAL, ...FABLED_IDS];

describe("the eight added official characters", () => {
  it("are verified canonical records with the right type and provenance", () => {
    for (const id of ALL) {
      const r = lookupOfficialRole(id)!;
      expect(r, id).toBeDefined();
      expect(RoleDefSchema.safeParse(r).success, id).toBe(true);
      expect(isCanonicalRole(r), id).toBe(true);
      expect(r.provenance?.revision).toBe(CANONICAL_REVISION);
      expect(r.ability).toBe(raw.find((x) => x.id === id)!.ability);
    }
    expect(EXPERIMENTAL.map((id) => lookupOfficialRole(id)!.type)).toEqual(["townsfolk", "minion", "minion", "demon", "demon", "demon"]);
    for (const id of EXPERIMENTAL) expect(EXPERIMENTAL_CHARACTERS.some((r) => r.id === id), id).toBe(true);
    for (const id of FABLED_IDS) expect(FABLED.some((r) => r.id === id && r.type === "fabled"), id).toBe(true);
  });

  it("every official role id is unique and every canonical role ships", () => {
    const ids = listOfficialRoles().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(raw.length);
  });

  it("night-sheet procedures carry through to night prompts", () => {
    for (const id of ["shugenja", "harpy", "summoner", "kazali", "lordoftyphon", "leviathan"]) {
      const r = lookupOfficialRole(id)!;
      const first = NIGHT_SHEET.firstNight.includes(id);
      const other = NIGHT_SHEET.otherNight.includes(id);
      expect(Boolean(r.firstNight), id).toBe(first);
      expect(Boolean(r.otherNight), id).toBe(other);
      if (first) expect(r.firstNightPrompt?.trim(), id).toBeTruthy();
      if (other) expect(r.otherNightPrompt?.trim(), id).toBeTruthy();
    }
  });

  it("the Home Reference lists them: Carousel 94, Fabled and Loric included", () => {
    const cats = Object.fromEntries(buildReferenceCategories().map((c) => [c.id, c]));
    const carousel = cats.carousel!.roles.map((r) => r.id);
    for (const id of ALL) expect(carousel, id).toContain(id);
    expect(carousel).toHaveLength(94);
    expect(cats.tb!.roles.length + cats.bmr!.roles.length + cats.snv!.roles.length + carousel.length).toBe(raw.length);
  });

  it("night order lists each night-waking character on a script that includes it, without throwing", () => {
    const script: Script = { id: "added8", name: "Added eight", characters: canonicalRoles(EXPERIMENTAL) };
    const players: Record<string, ReturnType<typeof makeSTPlayer>> = {};
    EXPERIMENTAL.forEach((id, seat) => { players[`p-${id}`] = makeSTPlayer({ id: `p-${id}`, name: id, seat, actualRole: id, shownRole: id }); });
    const seatOrder = Object.keys(players);
    for (const first of [true, false]) {
      const steps = computeNightOrder(players, seatOrder, script, first);
      const named = new Set(steps.filter((x) => x.kind === "player").map((x) => (x as { effectiveRoleId: string }).effectiveRoleId));
      for (const id of EXPERIMENTAL) {
        const wakes = (first ? NIGHT_SHEET.firstNight : NIGHT_SHEET.otherNight).includes(id);
        if (wakes) expect(named.has(id), `${id} ${first ? "first" : "other"} night`).toBe(true);
      }
    }
  });
});
