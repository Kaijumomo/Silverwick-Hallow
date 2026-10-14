import { beforeEach, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { buildRegistry } from "@/data/roleRegistry";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { StorytellerGamePersistedSchema } from "./schemas";
import { DRUNK_REMINDER_LABEL, ownsDrunkReminder } from "./drunkReminders";

const state = () => store.getState();
const game = () => state().game!;
const player = () => game().players.p0!;
const target = () => ({ playerId: "p0", participantId: player().participantId! });
const registry = buildRegistry(setupScript);
beforeEach(() => {
  localStorage.clear();
  useSessionRuntime.setState({ backend: null, status: "idle" });
  const value = setupGame(["drunk", "chef", "empath", "saint", "poisoner", "imp"], { setupRolesDealt: true });
  value.players.p0!.shownRole = null;
  store.setState({ game: value, lobby: null, terminalClose: null, undoStack: [], localSeq: 0,
    customScripts: { [setupScript.id]: setupScript } });
});

it("prepares one official self-owned note atomically without effects, identity, alignment or composition changes", () => {
  const before = game();
  expect(state().setShownRole("p0", "monk")).toMatchObject({ ok: true, changed: true });
  expect(player()).toMatchObject({ actualRole: "drunk", shownRole: "monk" });
  expect(player().actualAlignment).toBe(before.players.p0!.actualAlignment);
  expect(Object.values(game().players).map(p => p.actualRole)).toEqual(Object.values(before.players).map(p => p.actualRole));
  expect(player().effects).toEqual(before.players.p0!.effects);
  expect(player().reminders).toHaveLength(1);
  expect(player().reminders[0]).toMatchObject({ label: DRUNK_REMINDER_LABEL, sourceCharacter: "drunk",
    sourceParticipant: { kind: "participant", playerId: "p0", participantId: player().participantId }, createdAt: { phase: "setup" } });
  expect(ownsDrunkReminder(player(), player().reminders[0]!)).toBe(true);
  expect(state().undoStack).toHaveLength(1);
  expect(game().gameSchemaVersion).toBe(28);
  expect(JSON.stringify(projectLobbyToPublic(game(), {}))).not.toMatch(/drunk|Is The Drunk|monk/);
  expect(projectLobbyToSelfMap(game(), registry)).toEqual({});
  state().undo();
  expect(player().shownRole).toBeNull(); expect(player().reminders).toEqual([]);
});

it("no-op preparation and a different disguise preserve one record and original provenance", () => {
  state().setShownRole("p0", "monk"); const note = player().reminders[0]!; const before = game();
  expect(state().setShownRole("p0", "monk")).toMatchObject({ ok: true, changed: false });
  expect(game()).toBe(before); expect(state().undoStack).toHaveLength(1);
  state().setShownRole("p0", "soldier"); expect(player().reminders).toEqual([note]);
  state().setShownAlignment("p0", "evil"); expect(player().reminders).toEqual([note]);
  state().undo(); state().undo(); expect(player().shownRole).toBe("monk"); expect(player().reminders).toEqual([note]);
});

it("an already placed official note is retained without a duplicate or provenance rewrite", () => {
  state().resolveReminders({ intents: [{ kind: "place", target: target(), reminder: {
    id: "manual-official", label: DRUNK_REMINDER_LABEL, sourceCharacter: "drunk", note: "Owner's notation",
  } }] });
  const manual = player().reminders[0]!;
  state().setShownRole("p0", "monk");
  expect(player().reminders).toEqual([manual]); expect(ownsDrunkReminder(player(), manual)).toBe(false);
});

it("exact removal leaves identity and other notation intact, stays removed on later commands/reload, and is undoable", async () => {
  state().setShownRole("p0", "monk"); const generated = player().reminders[0]!;
  state().resolveReminders({ intents: [{ kind: "place", target: target(), reminder: { id: "lookalike", label: DRUNK_REMINDER_LABEL, sourceCharacter: "chef" } }] });
  const before = game();
  expect(state().resolveReminders({ intents: [{ kind: "remove", target: target(), reminderId: generated.id }] }).ok).toBe(true);
  expect(player().reminders.map(n => n.id)).toEqual(["lookalike"]);
  expect(player()).toMatchObject({ actualRole: "drunk", shownRole: "monk" }); expect(player().effects).toEqual([]);
  state().setShownAlignment("p0", "evil");
  const after = game(); const persisted = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null }); localStorage.setItem("new-blood-st", persisted); await store.persist.rehydrate();
  expect(game()).toEqual(after); expect(player().reminders.map(n => n.id)).toEqual(["lookalike"]);
  state().undo(); state().undo();
  expect(player().reminders).toEqual(before.players.p0!.reminders);
});

it.each(["clear", "replace", "swap", "actual"] as const)("%s identity cleanup removes only generated ownership and Undo restores it", action => {
  state().setShownRole("p0", "monk"); const owned = player().reminders[0]!;
  state().resolveReminders({ intents: [{ kind: "place", target: target(), reminder: { id: "manual", label: DRUNK_REMINDER_LABEL, sourceCharacter: "drunk" } }] });
  const before = game();
  const result = action === "clear" ? state().setShownRole("p0", null)
    : action === "replace" ? state().replaceSetupRole("p0", "soldier")
    : action === "swap" ? state().swapSetupRoles("p0", "p1") : state().assignRole("p0", "soldier");
  expect(result.ok).toBe(true);
  expect(player().reminders.map(n => n.id)).toEqual(["manual"]);
  state().undo();
  expect(player().reminders).toEqual(before.players.p0!.reminders);
  expect(player().reminders).toContainEqual(owned);
});

it("schema v28 persistence/recovery retains notation and shown-only player projection", async () => {
  state().setShownRole("p0", "monk");
  const prepared = game();
  store.setState({ game: { ...prepared, phase: "night", day: 1, setupRolesRevealed: true } });
  const saved = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
  expect(StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(game()))).players.p0!.reminders).toEqual(prepared.players.p0!.reminders);
  expect(projectLobbyToSelfMap(game(), registry).p0).toEqual({ shownRole: "monk", shownAlignment: "good" });
  expect(JSON.stringify(projectLobbyToSelfMap(game(), registry))).not.toMatch(/drunk|Is The Drunk/);
});

it("loading an older prepared identity does not invent missing notation", async () => {
  const value = game(); value.players.p0!.shownRole = "monk";
  store.setState({ game: { ...value } });
  const saved = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
  state().setShownAlignment("p0", "evil");
  expect(player().reminders).toEqual([]);
});

it("live identity correction records exact notation removal in the same undoable action", () => {
  state().setShownRole("p0", "monk");
  store.setState({ game: { ...game(), phase: "day", day: 1 } });
  const before = game(); const undoCount = state().undoStack.length;
  expect(state().assignRole("p0", "soldier").ok).toBe(true);
  expect(player().reminders).toEqual([]);
  expect(game().history.length).toBeGreaterThan(before.history.length);
  expect(state().undoStack).toHaveLength(undoCount + 1);
  state().undo(); expect(player().actualRole).toBe("drunk"); expect(player().reminders).toEqual(before.players.p0!.reminders);
});

it("ordinary drunkenness and manually placing the official note never turn a Townsfolk into the Drunk", () => {
  const chef = game().players.p1!;
  expect(state().resolveEffects({ intents: [{ kind: "apply", target: { playerId: chef.id, participantId: chef.participantId! },
    effect: { type: "drunk", lifetime: { kind: "manual" } } }] }).ok).toBe(true);
  expect(game().players.p1!.reminders).toEqual([]);
  expect(state().resolveReminders({ intents: [{ kind: "place", target: { playerId: chef.id, participantId: chef.participantId! },
    reminder: { label: DRUNK_REMINDER_LABEL, sourceCharacter: "drunk" } }] }).ok).toBe(true);
  expect(game().players.p1).toMatchObject({ actualRole: "chef", shownRole: "chef", behaviorMode: "normal" });
  expect(game().players.p1!.effects).toHaveLength(1);
});
