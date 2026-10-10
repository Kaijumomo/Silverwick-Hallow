import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, openInStore, proofGame, proofScript } from "@/test/proofFixtures";
import { captureCharacterActionContext, migrateStoreState, useStorytellerStore as store } from "./storytellerStore";
import { preparedInformationContext } from "./preparedInformation";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import { PreparedInformationRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useShellStore } from "./shellStore";
import type { StorytellerLobbyRecord } from "./types";

const game = () => store.getState().game!;
function pending() {
  openInStore(proofGame(["washerwoman", "chef", "empath", "imp", "poisoner"], "night", 1, { phase: "setup", day: 0 }));
  store.setState({ game: { ...game(), players: Object.fromEntries(Object.entries(game().players).map(([id, player]) => [id, { ...player, packetEpoch: "epoch-" + id }])) } });
  expect(store.getState().prepareInformation({ character: "washerwoman", source: bind(game(), "p0"), expected: preparedInformationContext(game(), proofScript),
    clue: { kind: "pair", candidates: [bind(game(), "p1"), bind(game(), "p2")], shownCharacter: "chef", qualifyingParticipantId: game().players.p1!.participantId! },
  }, captureCharacterActionContext())).toMatchObject({ ok: true });
  return game();
}
beforeEach(() => {
  localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false, sync: null });
  useShellStore.getState().reset(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("B6 independent prepared-information serialization", () => {
  it.each([20, 21, 22, 23, 24, 25, 26, 27])("explicit v%s converts with empty pending intent and retains reminders without inferring a clue", version => {
    const raw = JSON.parse(JSON.stringify(pending())); raw.gameSchemaVersion = version; delete raw.preparedInformation;
    if (version < 25) delete raw.gameRuleFacts;
    if (version < 27) delete raw.voting;
    for (const player of Object.values(raw.players) as Record<string, any>[]) {
      if (version < 26) delete player.revealToken;
      if (version === 20) for (const reminder of player.reminders) reminder.lifetime = { kind: "manual" };
    }
    if (version === 20) raw.history = [];
    const reminderIds = Object.values(raw.players as StorytellerLobbyRecord["players"]).flatMap(p => p.reminders.map(r => r.id));
    expect(detectLegacyGameVersion(raw)).toBe(version);
    migrateGameEntry(raw, version, { kind: "trusted", customScripts: { [proofScript.id]: proofScript } });
    const parsed = StorytellerGamePersistedSchema.parse(raw);
    expect(parsed.gameSchemaVersion).toBe(28); expect(parsed.preparedInformation).toEqual([]); expect(parsed.informationDeliveries).toEqual([]);
    expect(Object.values(parsed.players).flatMap(p => p.reminders.map(r => r.id))).toEqual(reminderIds);
  });

  it("local v27 envelope independently migrates Current State and Undo snapshots", () => {
    const current = JSON.parse(JSON.stringify(pending())); const prior = JSON.parse(JSON.stringify(store.getState().undoStack[0]));
    for (const item of [current, prior]) { item.gameSchemaVersion = 27; delete item.preparedInformation; }
    const result = migrateStoreState({ game: current, undoStack: [prior], customScripts: { [proofScript.id]: proofScript } }, 27) as { game: StorytellerLobbyRecord; undoStack: StorytellerLobbyRecord[] };
    expect(result.game.preparedInformation).toEqual([]); expect(result.undoStack[0]!.preparedInformation).toEqual([]);
    expect(result.game.gameSchemaVersion).toBe(28); expect(result.undoStack[0]!.gameSchemaVersion).toBe(28);
  });

  it.each(["missing", "null", "object", "invented"])("v28 %s collection is never repaired by a v27 envelope", kind => {
    const raw = JSON.parse(JSON.stringify(pending()));
    if (kind === "missing") delete raw.preparedInformation;
    if (kind === "null") raw.preparedInformation = null;
    if (kind === "object") raw.preparedInformation = {};
    if (kind === "invented") raw.preparedInformation = [{ character: "chef" }];
    migrateGameEntry(raw, 27, { kind: "trusted", customScripts: { [proofScript.id]: proofScript } });
    expect(StorytellerGamePersistedSchema.safeParse(raw).success).toBe(false);
  });

  it.each(["extra-field", "same-candidate", "foreign-qualifier", "wrong-action", "wrong-label", "same-reminder", "non-librarian-zero"])("strict prepared record rejects %s", scenario => {
    const rec = JSON.parse(JSON.stringify(pending().preparedInformation[0]));
    if (scenario === "extra-field") rec.communicated = true;
    if (scenario === "same-candidate") rec.clue.candidates[1] = rec.clue.candidates[0];
    if (scenario === "foreign-qualifier") rec.clue.qualifyingParticipantId = "not-in-pair";
    if (scenario === "wrong-action") rec.informationActionId = "chef-first-night";
    if (scenario === "wrong-label") rec.clue.reminders[0].label = "Minion";
    if (scenario === "same-reminder") rec.clue.reminders[1].id = rec.clue.reminders[0].id;
    if (scenario === "non-librarian-zero") rec.clue = { kind: "zero-outsiders" };
    expect(PreparedInformationRecordSchema.safeParse(rec).success).toBe(false);
  });

  it.each(["missing-token", "wrong-origin", "wrong-target", "wrong-label", "duplicate-preparation"])("current snapshot rejects contradictory %s linkage", scenario => {
    const raw = JSON.parse(JSON.stringify(pending()));
    if (scenario === "missing-token") raw.players.p1.reminders = [];
    if (scenario === "wrong-origin") raw.players.p1.reminders[0].sourceCharacter = "investigator";
    if (scenario === "wrong-target") raw.preparedInformation[0].clue.reminders[0].participant = raw.preparedInformation[0].source;
    if (scenario === "wrong-label") raw.players.p1.reminders[0].label = "Wrong";
    if (scenario === "duplicate-preparation") raw.preparedInformation.push({ ...raw.preparedInformation[0], id: "other-id" });
    expect(StorytellerGamePersistedSchema.safeParse(raw).success).toBe(false);
  });

  it("one Librarian cannot carry both a paired and zero pending clue under separate action IDs", () => {
    const raw = JSON.parse(JSON.stringify(pending()));
    const pair = raw.preparedInformation[0]; pair.character = "librarian"; pair.informationActionId = "librarian-first-night";
    pair.actualRole = "librarian"; pair.shownRole = "librarian";
    pair.clue.reminders[0].label = "Outsider"; pair.clue.shownCharacter = "saint";
    raw.players.p0.actualRole = "librarian"; raw.players.p0.shownRole = "librarian";
    for (const target of [raw.players.p1, raw.players.p2]) target.reminders[0].sourceCharacter = "librarian";
    raw.players.p1.reminders[0].label = "Outsider";
    raw.preparedInformation.push({ ...pair, id: "second-librarian-clue", informationActionId: "librarian-first-night-zero", clue: { kind: "zero-outsiders" } });
    expect(StorytellerGamePersistedSchema.safeParse(raw).success).toBe(false);
  });
});
