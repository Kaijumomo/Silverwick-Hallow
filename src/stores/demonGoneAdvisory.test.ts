// @vitest-environment node
// WP-9 (F-16): the End control's discreet "!" when every Demon is dead; never a verdict.
import { describe, expect, it } from "vitest";
import { demonGoneAdvisory, endGameEligibility } from "./endGameEligibility";
import { patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";

const env = { registry: proofRegistry, script: proofScript };
const roles = (extra: string) => ["imp", "chef", "empath", "monk", "saint", extra, "poisoner"];

describe("demonGoneAdvisory", () => {
  it("is silent while a Demon lives, before any Demon has died, and in Setup or after the game", () => {
    expect(demonGoneAdvisory(proofGame(roles("baron"), "day", 2), env)).toBeNull();
    const none = proofGame(["chef", "empath", "monk", "saint", "baron", "poisoner", "librarian"], "day", 2);
    expect(demonGoneAdvisory(none, env)).toBeNull();
    expect(demonGoneAdvisory({ ...patchPlayer(proofGame(roles("baron"), "day", 2), "p0", { alive: false }), phase: "ended" }, env)).toBeNull();
  });

  it("flags a dead Demon with no verdict, and names a living Scarlet Woman or Mastermind", () => {
    const dead = (extra: string) => patchPlayer(proofGame(roles(extra), "day", 2), "p0", { alive: false });
    expect(demonGoneAdvisory(dead("baron"), env)).toMatch(/Demon is dead\. Check whether the game has ended/);
    expect(demonGoneAdvisory(dead("scarletwoman"), env)).toMatch(/Scarlet Woman is alive/);
    expect(demonGoneAdvisory(dead("mastermind"), env)).toMatch(/Mastermind is alive/);
    // Advisory only: the eligibility itself still claims nothing it cannot prove.
    expect(endGameEligibility(dead("baron"), env).kind).toBe("unknown");
  });

  it("is silent once a successor Demon lives (the Imp passed it on)", () => {
    const passed = patchPlayer(patchPlayer(proofGame(roles("baron"), "night", 2), "p0", { alive: false }), "p5", { actualRole: "imp" });
    expect(demonGoneAdvisory(passed, env)).toBeNull();
  });
});
