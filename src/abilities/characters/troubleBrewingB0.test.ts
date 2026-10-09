import { describe, expect, it } from "vitest";
import { pick, plan, proofGame, request } from "@/test/proofFixtures";

describe("B0 complete action safety", () => {
  it("refuses Slayer's entire shot when Scarlet Woman succession is not modeled", () => {
    const game = proofGame(["slayer", "imp", "scarletwoman", "chef", "monk"], "day", 2);
    const before = JSON.stringify(game);
    expect(plan(game, request(game, "p0", "slayer", { target: pick(game, "p1") })))
      .toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(game)).toBe(before);
  });
});
