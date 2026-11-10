// @vitest-environment node
import { describe, expect, it } from "vitest";
import { T30_VERBS } from "./t30Verbs";

describe("Treacherous 30th card verbs", () => {
  it("covers every character with a night action in the design handoff", () => {
    for (const id of ["innkeeper", "gambler", "shabaloth", "nodashii", "vigormortis", "godfather", "professor", "moonchild", "oracle"]) {
      expect(T30_VERBS[id], id).toBeTruthy();
    }
  });
  it("tells the Innkeeper that the first player tapped is drunk", () => {
    expect(T30_VERBS.innkeeper).toContain("first player tapped is drunk");
  });
});
