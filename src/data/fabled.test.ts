import { describe, expect, it } from "vitest";
import { RoleDefSchema } from "@/stores/schemas";
import { FABLED, getFabled, listFabled } from "./fabled";

describe("FABLED registry", () => {
  it("contains the 14 official fabled", () => {
    expect(FABLED).toHaveLength(14);
  });

  it("every fabled validates against RoleDefSchema", () => {
    for (const f of FABLED) {
      const r = RoleDefSchema.safeParse(f);
      expect(r.success, `${f.id} failed validation`).toBe(true);
    }
  });

  it("every fabled has type=fabled", () => {
    for (const f of FABLED) expect(f.type).toBe("fabled");
  });

  it("getFabled returns the role, undefined for unknown", () => {
    expect(getFabled("djinn")?.name).toBe("Djinn");
    expect(getFabled("nope")).toBeUndefined();
  });

  it("listFabled returns the registry", () => {
    expect(listFabled()).toBe(FABLED);
  });
});
