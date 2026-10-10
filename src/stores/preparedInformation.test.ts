import { beforeEach, describe, expect, it } from "vitest";
import { bind, openInStore, proofGame, proofScript } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { preparedInformationContext, type PrepareInformationRequest } from "./preparedInformation";
import { usePrivacyStore } from "./privacyStore";
import { participantStepKey } from "./nightProgress";
import { useSessionRuntime } from "@/firebase/storytellerSync";

const current = () => store.getState().game!;
function request(): PrepareInformationRequest {
  const game = current();
  return { character: "washerwoman", source: bind(game, "p0"), expected: preparedInformationContext(game, proofScript),
    clue: { kind: "pair", candidates: [bind(game, "p1"), bind(game, "p2")], shownCharacter: "chef", qualifyingParticipantId: game.players.p1!.participantId! } };
}
const prepare = () => store.getState().prepareInformation(request(), captureCharacterActionContext());
beforeEach(() => {
  localStorage.clear(); usePrivacyStore.getState().reset(); useSessionRuntime.setState({ status: "idle", backend: null });
  store.setState({ game: null, lobby: null, undoStack: [], terminalClose: null, sync: null, finishedGameUndo: null, canUndoFinishedGame: false });
  const game = proofGame(["washerwoman", "chef", "empath", "imp", "poisoner"], "night", 1, { phase: "setup", day: 0 });
  for (const player of Object.values(game.players)) player.packetEpoch = `epoch-${player.id}`;
  openInStore(game);
});

describe("B6 prepared clue lifecycle", () => {
  it("rejects malformed or smuggled caller data without mutation", () => {
    for (const value of [null, {}, { ...request(), mode: "verified" }, { ...request(), source: { ...request().source, nameAtTime: "forged" } }]) {
      const before = store.getState();
      expect(store.getState().prepareInformation(value as PrepareInformationRequest)).toMatchObject({ ok: false });
      expect(store.getState()).toBe(before);
    }
  });
  it("wrong-candidate optional registration does not block an unrelated verified clue", () => {
    store.getState().correctRole("p2", "spy");
    expect(prepare()).toMatchObject({ ok: true });
  });
  it("role correction invalidates affected pending intent and Undo restores it", () => {
    expect(prepare()).toMatchObject({ ok: true }); const prepared = current();
    expect(store.getState().correctRole("p1", "soldier")).toMatchObject({ ok: true });
    expect(current().preparedInformation).toEqual([]);
    store.getState().undo(); expect(current()).toEqual(prepared);
  });
  it("replacement removes only old exact generated tokens", () => {
    const manual = store.getState().addReminder("p1", { label: "Townsfolk", sourceCharacter: "washerwoman", sourcePlayer: "p0" });
    expect(prepare()).toMatchObject({ ok: true }); const old = current().preparedInformation[0]!;
    const changed = request(); if (changed.clue.kind !== "pair") throw Error();
    changed.clue = { ...changed.clue, candidates: [bind(current(), "p1"), bind(current(), "p3")] };
    expect(store.getState().prepareInformation(changed)).toMatchObject({ ok: true });
    expect(current().preparedInformation).toHaveLength(1); expect(current().preparedInformation[0]!.id).not.toBe(old.id);
    expect(current().players.p2!.reminders).toEqual([]);
    expect(current().players.p1!.reminders.some(r => r.id === manual)).toBe(true);
    expect(current().players.p3!.reminders).toHaveLength(1);
  });
  it("manual Next closes pending intent without inventing communication or removing notation", () => {
    expect(prepare()).toMatchObject({ ok: true });
    store.setState({ game: { ...current(), phase: "night", day: 1 } });
    store.getState().setNightStepStatus(1, participantStepKey(current().players.p0!.participantId!, "washerwoman"), "done");
    expect(current().preparedInformation).toEqual([]); expect(current().informationDeliveries).toEqual([]);
    expect(current().players.p1!.reminders).toHaveLength(1);
  });
  it("existing explicit information recording consumes pending intent and prevents a duplicate B6 delivery", () => {
    expect(prepare()).toMatchObject({ ok: true }); const preparationId = current().preparedInformation[0]!.id;
    store.setState({ game: { ...current(), phase: "night", day: 1 } });
    const source = bind(current(), "p0"); const expected = preparedInformationContext(current(), proofScript);
    expect(store.getState().recordInformationDelivery("p0", "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: ["p1", "p2"] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ])).toMatchObject({ ok: true });
    expect(current().preparedInformation).toEqual([]); expect(current().informationDeliveries).toHaveLength(1);
    const before = store.getState();
    expect(store.getState().deliverPreparedInformation({ preparationId, source, expected })).toMatchObject({ ok: false });
    expect(prepare()).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
    expect(current().players.p1!.reminders).toHaveLength(1);
  });
  it("an unrelated notation note does not alter the authoritative clue relationship", () => {
    expect(prepare()).toMatchObject({ ok: true }); const game = current();
    const token = game.players.p1!.reminders[0]!;
    expect(store.getState().resolveReminders({ intents: [{ kind: "amend", target: bind(game, "p1"), reminderId: token.id, changes: { note: "Storyteller correction" } }] })).toMatchObject({ ok: true });
    // Notes do not alter the clue relationship. Labels/origin/removal do.
    expect(current().preparedInformation).toHaveLength(1);
  });
});
