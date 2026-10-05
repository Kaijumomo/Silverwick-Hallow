// Phase 10H (contract §21): RS-15 / RS-20 are real, valid v26 games -- and,
// when RS_FIXTURE_OUT is set, are serialized as the browser-evidence fixture
// (local dev-server localStorage only; never Firebase).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { buildRS15, buildRS20, buildSetupPreparation, persistedEnvelope } from "./representativeStates";

const reset = () => store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null });
beforeEach(reset);
afterEach(reset);

describe("representative states", () => {
  it("RS-15: 15 occupied seats, Night 2, divergence, Life variants, Effects, Reminders, ability used", () => {
    const { ids, drunkId } = buildRS15();
    const game = store.getState().game!;
    expect(ids).toHaveLength(15);
    expect(game).toMatchObject({ phase: "night", day: 2, gameSchemaVersion: 26 });
    expect(game.players[drunkId]).toMatchObject({ actualRole: "drunk", shownRole: "virgin" });
    const players = Object.values(game.players);
    expect(players.filter((p) => !p.alive).length).toBeGreaterThanOrEqual(2);
    expect(players.some((p) => p.abilityUsed)).toBe(true);
    expect(players.some((p) => p.effects.length > 0)).toBe(true);
    expect(players.some((p) => p.reminders.length >= 3)).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
    if (process.env.RS_FIXTURE_OUT) writeFileSync(`${process.env.RS_FIXTURE_OUT}/rs15.json`, persistedEnvelope());
  });

  it("RS-20: RS-15 plus five Travelers, Fabled and a Loric", () => {
    const { travelerIds } = buildRS20();
    const game = store.getState().game!;
    expect(game.seatOrder).toHaveLength(20);
    expect(travelerIds.every((id) => game.players[id]!.isTraveler)).toBe(true);
    expect(game.fabled.length).toBe(2);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
    if (process.env.RS_FIXTURE_OUT) writeFileSync(`${process.env.RS_FIXTURE_OUT}/rs20.json`, persistedEnvelope());
  });

  it("Setup Preparation: dealt, unrevealed, one shown identity still needed", () => {
    const { drunkId } = buildSetupPreparation();
    const game = store.getState().game!;
    expect(game).toMatchObject({ phase: "setup", setupRolesDealt: true });
    expect(game.setupRolesRevealed).toBeFalsy();
    expect(game.players[drunkId]!.shownRole).toBeNull();
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
    if (process.env.RS_FIXTURE_OUT) writeFileSync(`${process.env.RS_FIXTURE_OUT}/setup.json`, persistedEnvelope());
  });
});
