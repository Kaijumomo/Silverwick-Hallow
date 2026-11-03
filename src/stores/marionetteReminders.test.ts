// WP-8: "Is The Marionette" is placed like "Is The Drunk": once, when the Marionette's shown character is prepared.
import { beforeEach, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { buildRegistry } from "@/data/roleRegistry";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { MARIONETTE_REMINDER_LABEL, ownsMarionetteReminder } from "./drunkReminders";

const state = () => store.getState();
const game = () => state().game!;
const player = () => game().players.p0!;
const registry = buildRegistry(setupScript);
beforeEach(() => {
  localStorage.clear();
  useSessionRuntime.setState({ backend: null, status: "idle" });
  const value = setupGame(["marionette", "chef", "empath", "saint", "poisoner", "imp"], { setupRolesDealt: true });
  value.players.p0!.shownRole = null;
  store.setState({ game: value, lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript } });
});

it("choosing the Marionette's shown character places the official note once, in one Undo step", () => {
  expect(player().reminders).toEqual([]);
  expect(state().setShownRole("p0", "chef")).toMatchObject({ ok: true, changed: true });
  expect(player().reminders).toHaveLength(1);
  expect(player().reminders[0]).toMatchObject({ label: MARIONETTE_REMINDER_LABEL, sourceCharacter: "marionette", createdAt: { phase: "setup" } });
  expect(ownsMarionetteReminder(player(), player().reminders[0]!)).toBe(true);
  expect(state().undoStack).toHaveLength(1);
  expect(JSON.stringify(projectLobbyToPublic(game(), {}))).not.toMatch(/marionette|Is The Marionette/i);
  expect(projectLobbyToSelfMap(game(), registry)).toEqual({});
  state().undo();
  expect(player().shownRole).toBeNull();
  expect(player().reminders).toEqual([]);
});

it("a different disguise keeps the one note, and a note the Storyteller removed is not invented again", () => {
  state().setShownRole("p0", "chef");
  const note = player().reminders[0]!;
  state().setShownRole("p0", "saint");
  expect(player().reminders).toEqual([note]);
  state().resolveReminders({ intents: [{ kind: "remove", target: { playerId: "p0", participantId: player().participantId! }, reminderId: note.id }] });
  expect(player().reminders).toEqual([]);
  state().setShownRole("p0", "saint");
  expect(player().reminders).toEqual([]);
});

it("a Demon or Minion is not a valid disguise, so no note is placed for it", () => {
  state().setShownRole("p0", "imp");
  expect(player().reminders).toEqual([]);
});

it("an unrelated player never gets the note", () => {
  state().setShownRole("p0", "chef");
  expect(game().players.p1!.reminders).toEqual([]);
});
