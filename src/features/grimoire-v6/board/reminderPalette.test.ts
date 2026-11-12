// The Storyteller's reminder picker must offer, and be able to place, every official reminder token of every character
// in play. These tests use the REAL registry a game builds (buildRegistry), never the all-characters proof registry,
// because that one hides the gap this file guards: a Fabled or Loric chosen at setup lives on the game record, and a
// Fabled is not in a script's registry unless a custom script declares it.
import { beforeEach, describe, expect, it } from "vitest";
import { canonicalRoles } from "@/data/canonical";
import raw from "@/data/canonical/roles.json";
import { FABLED } from "@/data/fabled";
import { iconUrlFor } from "@/data/iconUrl";
import { LORICS } from "@/data/lorics";
import { buildRegistry } from "@/data/roleRegistry";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { buildSetupGame, useStorytellerStore as store } from "@/stores/storytellerStore";
import { createRulesQuery } from "@/stores/rulesQuery";
import { usePrivacyStore } from "@/stores/privacyStore";
import { makeSTPlayer } from "@/test/fixtures";
import type { RoleDef, Script, StorytellerLobbyRecord } from "@/stores/types";
import { placeReminder, playerMarks, reminderPalette, type MarkEnv } from "./marks";

const labelsOf = (role: RoleDef): string[] => [...new Set([...(role.reminders ?? []), ...(role.remindersGlobal ?? [])])];
const pairsOf = (roles: RoleDef[]): string[] => roles.flatMap((role) => labelsOf(role).map((label) => `${role.id}:${label}`));
const keyed = (entries: { role: RoleDef; label: string }[]) => entries.map((entry) => `${entry.role.id}:${entry.label}`);

const everyCharacter = canonicalRoles((raw as { id: string }[]).map((r) => r.id));

/** A game record with one seated player holding `seat` (a Traveller is seated as a Traveller), over `script`. */
function gameWith(script: Script, over: Partial<StorytellerLobbyRecord> = {}, seat?: RoleDef): StorytellerLobbyRecord {
  const base = buildSetupGame(script, { plannedPlayerCount: 0 });
  const player = makeSTPlayer({ id: "p0", name: "Player 0", seat: 0, actualRole: seat?.id ?? "chef", isTraveler: seat?.type === "traveler" });
  return { ...base, players: { p0: player }, seatOrder: ["p0"], ...over };
}
const envOf = (game: StorytellerLobbyRecord, script: Script): MarkEnv => {
  const registry = buildRegistry(script);
  return { game, script, registry, query: createRulesQuery(game, { script, registry }) };
};

beforeEach(() => usePrivacyStore.setState({ enabled: false }));

describe("Fabled and Loric chosen at setup offer their official tokens", () => {
  it("covers the whole catalogues (14 Fabled, 11 Loric)", () => {
    expect(FABLED).toHaveLength(14);
    expect(LORICS).toHaveLength(11);
    expect(pairsOf([...FABLED, ...LORICS]).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(BUILTIN_SCRIPTS))("%s: every Fabled and Loric token is offered in play and under All", (_id, script) => {
    const game = buildSetupGame(script, { plannedPlayerCount: 5, plannedFabled: FABLED.map((r) => r.id), plannedLorics: LORICS.map((r) => r.id) });
    expect(game.fabled).toHaveLength(14);
    expect(game.lorics).toHaveLength(11);
    const palette = reminderPalette(envOf(game, script));
    const expected = pairsOf([...FABLED, ...LORICS]);
    for (const list of [palette.inPlay, palette.all]) {
      const offered = keyed(list);
      for (const pair of expected) expect(offered, pair).toContain(pair);
    }
    // The offered entry is the character's own definition, so its token art is the official art.
    for (const entry of palette.inPlay.filter((e) => [...FABLED, ...LORICS].some((r) => r.id === e.role.id))) {
      expect(iconUrlFor(entry.role), entry.role.id).toBeTruthy();
    }
  });

  it("the exact reproduction: Angel, Fibbin, God of Ug and Stormcatcher chosen over Trouble Brewing", () => {
    const script = BUILTIN_SCRIPTS.tb!;
    const game = buildSetupGame(script, { plannedPlayerCount: 5, plannedFabled: ["angel", "fibbin"], plannedLorics: ["godofug", "stormcatcher"] });
    const offered = keyed(reminderPalette(envOf(game, script)).inPlay);
    expect(offered).toEqual(expect.arrayContaining(["angel:Protected", "angel:Something Bad", "fibbin:No Ability", "godofug:Hat", "stormcatcher:Stormcaught"]));
  });

  it("offers nothing extra when none are chosen, and only what was chosen when some are", () => {
    const script = BUILTIN_SCRIPTS.tb!;
    const none = reminderPalette(envOf(buildSetupGame(script, { plannedPlayerCount: 5 }), script));
    const some = reminderPalette(envOf(buildSetupGame(script, { plannedPlayerCount: 5, plannedFabled: ["angel"], plannedLorics: ["godofug"] }), script));
    const isExtra = (key: string) => [...FABLED, ...LORICS].some((role) => key.startsWith(`${role.id}:`));
    expect(keyed(none.all).filter(isExtra)).toEqual([]);
    expect(keyed(some.all).filter(isExtra).sort()).toEqual(["angel:Protected", "angel:Something Bad", "godofug:Hat"]);
  });

  it("follows the game record: a Fabled added later appears, one removed disappears", () => {
    const script = BUILTIN_SCRIPTS.tb!;
    const game = buildSetupGame(script, { plannedPlayerCount: 5 });
    expect(keyed(reminderPalette(envOf(game, script)).inPlay)).not.toContain("fibbin:No Ability");
    expect(keyed(reminderPalette(envOf({ ...game, fabled: ["fibbin"] }, script)).inPlay)).toContain("fibbin:No Ability");
    expect(keyed(reminderPalette(envOf({ ...game, fabled: [] }, script)).inPlay)).not.toContain("fibbin:No Ability");
  });

  it("a custom script's own definition of a chosen Fabled id is the one offered", () => {
    const angel = canonicalRoles(["angel"])[0]!;
    const script: Script = { ...BUILTIN_SCRIPTS.tb!, id: "custom-angel", fabled: [{ ...angel, reminders: ["Custom Token"], provenance: { status: "homebrew" } } as RoleDef] };
    const game = { ...buildSetupGame(script, { plannedPlayerCount: 5 }), fabled: ["angel"] };
    expect(keyed(reminderPalette(envOf(game, script)).inPlay).filter((key) => key.startsWith("angel:"))).toEqual(["angel:Custom Token"]);
  });
});

describe("every official token of every character in the pinned data can be placed", () => {
  it("covers all 181 characters and 179 character/token pairs", () => {
    expect(everyCharacter).toHaveLength(181);
    expect(pairsOf(everyCharacter)).toHaveLength(179);
  });

  /**
   * Each character is put where the app puts it: an ordinary character on a script and seated, a Traveller seated as a
   * Traveller, a Fabled or Loric chosen for the game. Then every one of its tokens is placed on a player through the picker's
   * own command and read back from the stored record and from the marks drawn around the seat.
   */
  it.each(everyCharacter.map((role) => [role.id, role] as const))("%s", (_id, role) => {
    const ordinary = ["townsfolk", "outsider", "minion", "demon"].includes(role.type);
    const script: Script = ordinary ? { id: `palette-${role.id}`, name: "Palette", characters: [role] } : BUILTIN_SCRIPTS.tb!;
    const game = gameWith(script, role.type === "fabled" ? { fabled: [role.id] } : role.type === "loric" ? { lorics: [role.id] } : {}, role.type === "traveler" || ordinary ? role : undefined);
    store.setState({ game, lobby: null, undoStack: [], customScripts: { [script.id]: script } });
    const env = envOf(game, script);
    const labels = labelsOf(role);

    const offered = reminderPalette(env).inPlay.filter((entry) => entry.role.id === role.id);
    expect(offered.map((entry) => entry.label), "offered in play").toEqual(labels);
    expect(reminderPalette(env).all.filter((entry) => entry.role.id === role.id).map((entry) => entry.label), "offered under All").toEqual(labels);

    const player = () => store.getState().game!.players.p0!;
    for (const entry of offered) {
      const result = placeReminder("p0", player().participantId, entry);
      expect(result, `${role.id}: ${entry.label}`).toEqual({ ok: true });
    }
    expect(player().reminders.map((reminder) => [reminder.label, reminder.sourceCharacter])).toEqual(labels.map((label) => [label, role.id]));

    const after = store.getState().game!;
    const marks = playerMarks(envOf(after, script), after.players.p0!).filter((mark) => mark.kind === "notation");
    expect(marks.map((mark) => mark.label)).toEqual(labels);
    for (const mark of marks) {
      expect(mark.title, role.id).toBe(`${role.name}: ${mark.label}`);
      expect(mark.src, `${role.id}: ${mark.label} is drawn with official art`).toBeTruthy();
    }
  });
});
