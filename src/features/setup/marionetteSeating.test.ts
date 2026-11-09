import { describe, expect, it } from "vitest";
import { buildRegistry } from "@/data/roleRegistry";
import { canonicalRoles } from "@/data/canonical";
import { seatMarionetteBesideDemon } from "./marionetteSeating";

const ids = ["imp", "marionette", "poisoner", "monk", "empath", "chef", "washerwoman", "undertaker"];
const registry = buildRegistry({ id: "t", name: "t", characters: canonicalRoles(ids) });
const demonSeat = (roles: string[]) => roles.indexOf("imp");

describe("seatMarionetteBesideDemon", () => {
  it("always leaves the Marionette next to the Demon, whatever the draw", () => {
    for (let i = 0; i < 200; i++) {
      const draw = [...ids].sort(() => Math.random() - 0.5);
      const { roles } = seatMarionetteBesideDemon(draw, registry);
      const d = demonSeat(roles), m = roles.indexOf("marionette"), n = roles.length;
      expect([(d + 1) % n, (d + n - 1) % n]).toContain(m);
      expect([...roles].sort()).toEqual([...ids].sort());
    }
  });
  it("leaves a draw without a Marionette alone", () => {
    const draw = ids.filter((id) => id !== "marionette");
    expect(seatMarionetteBesideDemon(draw, registry)).toEqual({ roles: draw, moved: false });
  });
});
