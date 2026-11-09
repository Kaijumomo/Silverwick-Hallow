import { describe, expect, it } from "vitest";
import { bind, impair, num, patchPlayer, pick, plan, planned, proofGame, request, yes } from "@/test/proofFixtures";
import { withRedHerring } from "@/test/redHerringFixture";
import { subjectId } from "./shared";
import type { AbilityInputs } from "../semantics";

describe("R1 contextual Recluse information choices", () => {
  it.each([0, 1, 2])("Empath accepts the explicitly communicated %s without changing registration", value => {
    const game = proofGame(["empath", "recluse", "imp", "monk", "soldier"]);
    expect(plan(game, request(game, "p0", "empath"))).toMatchObject({ ok: false, code: "needsInput",
      requirements: [{ id: "communicated", kind: "number", source: "storyteller" }] });
    const next = planned(plan(game, request(game, "p0", "empath", { communicated: num(value) })));
    expect(next.informationDeliveries[0]!.values).toContainEqual({ requirementId: "evilNeighbors", kind: "number", value });
    expect(next.players).toBe(game.players);
    expect(plan(next, request(next, "p0", "empath"))).toMatchObject({ ok: false, code: "needsInput" });
  });

  it("Empath uses living neighbours and current seats before requesting a choice", () => {
    const game = proofGame(["empath", "recluse", "imp", "monk", "soldier"]);
    const seatOrder = ["p0", "p2", "p1", "p3", "p4"];
    const swapped = { ...game, seatOrder, players: Object.fromEntries(seatOrder.map((id, seat) => [id, { ...game.players[id]!, seat }])) };
    for (const current of [swapped, patchPlayer(game, "p1", { alive: false })]) {
      const next = planned(plan(current, request(current, "p0", "empath", { communicated: num(2) })));
      expect(next.informationDeliveries[0]!.values![0]).toMatchObject({ value: 1 });
    }
  });

  it.each(["poisoned", "drunk", "abilityLost"])("%s Recluse has deterministic information", effect => {
    const game = impair(proofGame(["empath", "recluse", "imp", "monk", "soldier"]), "p1", effect);
    const next = planned(plan(game, request(game, "p0", "empath", { communicated: num(2) })));
    expect(next.informationDeliveries[0]!.values![0]).toMatchObject({ value: 0 });
  });

  it.each(["soberHealthy", "registersFalsely"])("unknown %s on Recluse never bypasses whole-action manual handling", effect => {
    for (const role of ["empath", "chef", "fortuneteller"]) {
      const game = withRedHerring(impair(proofGame([role, "recluse", "imp", "monk", "soldier"], "night", 1), "p1", effect), "p4");
      const inputs: AbilityInputs = role === "fortuneteller" ? { targets: pick(game, "p1", "p3"),
        [subjectId("communicated", bind(game, "p1"), bind(game, "p3"))]: yes() } : { communicated: num(1) };
      expect(plan(game, request(game, "p0", role, inputs))).toMatchObject({ ok: false, code: "unsupported" });
    }
  });

  it("Chef scans all consequential edges before exposing a Recluse choice", () => {
    const game = proofGame(["chef", "recluse", "imp", "spy", "soldier"], "night", 1);
    expect(plan(game, request(game, "p0", "chef", { communicated: num(1) }))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("Fortune Teller choices stay bound to the pair and never override a definite Yes", () => {
    const game = withRedHerring(proofGame(["fortuneteller", "recluse", "imp", "monk", "soldier"]), "p4");
    const oldAnswer = { [subjectId("communicated", bind(game, "p1"), bind(game, "p3"))]: yes(false) };
    expect(plan(game, request(game, "p0", "fortuneteller", { targets: pick(game, "p1", "p0"), ...oldAnswer })))
      .toMatchObject({ ok: false, code: "needsInput" });
    for (const decisive of ["p2", "p4"]) {
      const next = planned(plan(game, request(game, "p0", "fortuneteller", { targets: pick(game, "p1", decisive),
        [subjectId("communicated", bind(game, "p1"), bind(game, decisive))]: yes(false) })));
      expect(next.informationDeliveries[0]!.values).toContainEqual({ requirementId: "isDemon", kind: "boolean", value: true });
    }
  });
});
