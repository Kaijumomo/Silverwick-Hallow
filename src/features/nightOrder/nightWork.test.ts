// WP-7: a character brought back after its turn has missed it; one brought back before it has not.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { deriveNightWork, stepResolved, unfinishedNightWork } from "./nightWork";
import { patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 innkeeper (early), p1 professor (later), p2 empath, p3 monk, p4 saint, p5 baron, p6 imp
const ROLES = ["innkeeper", "professor", "empath", "monk", "saint", "baron", "imp"];
const env = { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS };
const game = () => store.getState().game!;
const work = (g: StorytellerLobbyRecord = game()) => deriveNightWork(g, env);
const row = (g: StorytellerLobbyRecord, role: string) => work(g).steps.find((s) => s.kind === "player" && s.effectiveRoleId === role)!;

function start(dead = "p0") {
  store.setState({ game: patchPlayer(proofGame(ROLES, "night", 3), dead, { alive: false }), lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
}
const done = (key: string) => store.getState().setNightStepStatus(3, key, "done");

describe("a character revived after its turn (WP-7)", () => {
  beforeEach(() => start());

  it("the dead Innkeeper has no row; a resurrection before any later step is done leaves the row owed like any living player", () => {
    expect(work().steps.some((s) => s.kind === "player" && s.effectiveRoleId === "innkeeper")).toBe(false);
    store.getState().resolveLife({ intents: [{ kind: "resurrection", playerId: "p0" }] });
    const w = work();
    expect(w.late.size).toBe(0);
    expect(unfinishedNightWork(game(), w).rows.some((s) => s.kind === "player" && s.effectiveRoleId === "innkeeper")).toBe(true);
  });

  it("revived once a later step is done: the row is settled (not unfinished, not the resting place), and Undo makes it owed again", () => {
    const professor = row(game(), "professor");
    expect(done(professor.stepKey).ok).toBe(true);
    store.getState().resolveLife({ intents: [{ kind: "resurrection", playerId: "p0" }] });
    const w = work();
    const innkeeper = row(game(), "innkeeper");
    expect(w.late.has(innkeeper.stepKey)).toBe(true);
    expect(stepResolved(game(), innkeeper, w.late)).toBe(true);
    expect(stepResolved(game(), innkeeper)).toBe(false);
    expect(unfinishedNightWork(game(), w).rows.map((s) => s.stepKey)).not.toContain(innkeeper.stepKey);
    store.getState().undo();
    expect(work().late.size).toBe(0);
  });

  it("a revived player whose turn is still ahead is not settled", () => {
    start("p1");
    store.getState().resolveLife({ intents: [{ kind: "resurrection", playerId: "p1" }] });
    expect(work().late.size).toBe(0);
  });
});
