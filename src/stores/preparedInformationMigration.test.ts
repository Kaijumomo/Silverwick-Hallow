import { describe, expect, it } from "vitest";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import { StorytellerGamePersistedSchema } from "./schemas";
import { proofGame } from "@/test/proofFixtures";

type Raw = Record<string, unknown>;
const evidence = { kind: "canonical-only" } as const;
function legacy27(): Raw {
  const game = structuredClone(proofGame(["washerwoman", "chef", "imp"])) as unknown as Raw;
  game.gameSchemaVersion = 27;
  delete game.preparedInformation;
  return game;
}

describe("B6 prepared-information compatibility", () => {
  it("converts v27 without deriving preparation intent from official-looking tokens", () => {
    const game = legacy27();
    const players = game.players as Record<string, { reminders: unknown[] }>;
    players.p1!.reminders = [{ id: "manual-townsfolk", label: "Townsfolk", sourceCharacter: "washerwoman" }];
    const before = structuredClone(game);
    expect(detectLegacyGameVersion(game)).toBe(27);
    migrateGameEntry(game, 27, evidence);
    expect(game).toEqual({ ...before, gameSchemaVersion: 28, preparedInformation: [] });
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
    migrateGameEntry(game, 27, evidence);
    expect(game).toEqual({ ...before, gameSchemaVersion: 28, preparedInformation: [] });
  });

  it.each([undefined, null, {}, "", [null]])("never defaults malformed v28 collection %j", value => {
    const game = { ...legacy27(), gameSchemaVersion: 28 } as Raw;
    if (value !== undefined) game.preparedInformation = value;
    const before = structuredClone(game);
    migrateGameEntry(game, 13, evidence);
    expect(game).toEqual(before);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
  });

  it.each([undefined, 20, 26, 27])("does not launder v28 evidence under marker %j", marker => {
    const game = { ...legacy27(), preparedInformation: [] } as Raw;
    if (marker === undefined) delete game.gameSchemaVersion;
    else game.gameSchemaVersion = marker;
    const before = structuredClone(game);
    migrateGameEntry(game, 13, evidence);
    expect(game).toEqual(before);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
  });

  it("a v28 envelope never repairs a v27 entry below its claimed version", () => {
    const game = legacy27();
    const before = structuredClone(game);
    migrateGameEntry(game, 28, evidence);
    expect(game).toEqual(before);
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(false);
  });
});
