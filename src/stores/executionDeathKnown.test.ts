import { describe, expect, it } from "vitest";
import { proofEnv, proofGame } from "@/test/proofFixtures";
import { executionDeathKnown } from "./executionAdvice";

const env = () => { const e = proofEnv(); return { script: e.script, registry: e.registry }; };

describe("executionDeathKnown", () => {
  it("is certain for an ordinary executed Townsfolk", () => {
    const g = proofGame(["chef", "empath", "soldier", "poisoner", "imp"], "day", 2);
    expect(executionDeathKnown(g, "p1", env())).toBe(true);
  });

  it("is not certain while a Loric that touches death (the Ventriloquist) is active: the Storyteller is asked", () => {
    const g = proofGame(["chef", "empath", "soldier", "poisoner", "imp"], "day", 2, { lorics: ["ventriloquist"] });
    expect(executionDeathKnown(g, "p1", env())).toBe(false);
  });
});
