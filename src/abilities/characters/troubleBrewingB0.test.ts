import { describe, expect, it } from "vitest";
import { impair, pick, plan, proofGame, request } from "@/test/proofFixtures";

describe("B0 complete action safety", () => {
  it("refuses Slayer's entire shot when Scarlet Woman functioning is uncertain", () => {
    // B4 closes ordinary succession; uncertain functioning retains B0's
    // whole-action guard, including zero Slayer consumption.
    const game = impair(proofGame(["slayer", "imp", "scarletwoman", "chef", "monk"], "day", 2), "p2", "soberHealthy");
    const before = JSON.stringify(game);
    expect(plan(game, request(game, "p0", "slayer", { target: pick(game, "p1") })))
      .toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(game)).toBe(before);
  });
});
