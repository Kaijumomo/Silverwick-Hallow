// @vitest-environment jsdom
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { SessionWriter } from "./writer";
import { createLobby, knockOnLobby, seatPlayer } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { writeProjections } from "./sync";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { captureCharacterActionContext, captureVotingContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { captureFingerprint } from "@/stores/abilityResolution";
import { participantStepKey } from "@/stores/nightProgress";
import { usePrivacyStore } from "@/stores/privacyStore";
import { preparedInformationContext } from "@/stores/preparedInformation";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import { butlerSelectionContext } from "@/stores/butlerSelection";
import { currentVotingState, freshVotingDay, votingContextChanged } from "@/stores/voting";
import { validVictoryEvidence } from "@/stores/victoryEvidence";
import { SAINT_EXECUTION_GOOD_TEAM_LOST, SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED, MAYOR_DAY_END_GOOD_TEAM_WON, RESOLVED_DEMON_DEATH_NO_SUCCESSOR } from "@/stores/gameRuleFactRegistry";
import { impair } from "@/test/proofFixtures";

let env: RulesTestEnvironment;
const code = "CHAR2345";
const host = "character-host";
const writers: SessionWriter[] = [];
const subscriptions: (() => void)[] = [];
beforeAll(async () => {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error("A local RTDB emulator is required.");
  const [hostname, port] = address.split(":");
  env = await initializeTestEnvironment({ projectId: "demo-silverwick-rules",
    database: { host: hostname, port: Number(port), rules: readFileSync(resolve(__dirname, "rules.json"), "utf8") } });
});
afterAll(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase(); localStorage.clear();
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(async () => { vi.restoreAllMocks(); for (const stop of subscriptions.splice(0)) stop(); for (const writer of writers.splice(0)) await writer.dispose(); });
const game = () => store.getState().game!;
const binding = (id: string) => ({ playerId: id, participantId: game().players[id]!.participantId! });
async function open() {
  const backend = new FirebaseRoomBackend(env.authenticatedContext(host).database() as unknown as Database);
  await createLobby(backend, host, { codeGenerator: () => code });
  const session = await requireActiveSession(backend, code);
  const writer = new SessionWriter(backend, code, session.id); writers.push(writer); await writer.start();
  store.setState({ game: setupGame(["poisoner", "soldier", "empath", "monk", "imp"], { phase: "night", day: 2, code, storytellerUid: host }),
    lobby: { code, uid: host, sessionId: session.id, status: "live" } });
  useSessionRuntime.setState({ backend: writer, status: "live" });
  return { backend, writer, session };
}
function poison() {
  const stepKey = participantStepKey(binding("p0").participantId, "poisoner");
  return store.getState().resolveAbility({ mode: "guided", invocationPath: "nightOrder", roleId: "poisoner",
    fingerprint: captureFingerprint(game(), "p0", { day: 2, stepKey })!, inputs: { target: { kind: "participant", participants: [binding("p1")] } },
    completeStep: true }, undefined, captureCharacterActionContext());
}
const publish = (writer: SessionWriter) => writeProjections({ backend: writer, code, stState: game(), registry: buildRegistry(setupScript), online: {}, membership: {} });

test.each(["saint", "saintNonqualifying", "mayor", "resolvedDemon"] as const)("B8 %s temporal evidence survives real checkpoint recovery privately and rejects stale writer actions", async character => {
  const { backend, writer, session } = await open();
  let day = setupGame(character === "resolvedDemon" ? ["imp", "scarletwoman", "chef", "soldier"] : [character === "saintNonqualifying" ? "saint" : character, "chef", "imp"], { code, storytellerUid: host, phase: "day", day: 2, voting: freshVotingDay(2) });
  if (character === "saintNonqualifying") day = impair(day, "p0");
  for (const player of Object.values(day.players)) player.actualAlignment = buildRegistry(setupScript).alignmentOf(player.actualRole);
  store.setState({ game: day, undoStack: [], localSeq: 0, sync: null });
  const playerUid = "b8-player";
  const playerDb = env.authenticatedContext(playerUid).database();
  await knockOnLobby(new FirebaseRoomBackend(playerDb as unknown as Database), code, playerUid, "Player 1");
  await seatPlayer(writer, code, playerUid, "p1", null, { participantId: day.players.p1!.participantId!, name: day.players.p1!.name });
  const project = (activeWriter: SessionWriter) => writeProjections({ backend: activeWriter, code, stState: game(), registry: buildRegistry(setupScript), online: {}, membership: { [playerUid]: "p1" } });
  const outcome = character === "resolvedDemon"
    ? store.getState().recordExecution("p0", "died", undefined, undefined, captureCharacterActionContext())
    : character !== "mayor"
    ? store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }, captureCharacterActionContext())
    : store.getState().advancePhase(captureVotingContext());
  expect(outcome).toMatchObject({ ok: true });
  expect(game().gameSchemaVersion).toBe(28);
  expect(game().gameRuleFacts).toHaveLength(1);
  expect(game().gameRuleFacts[0]?.type).toBe(character === "saint" ? SAINT_EXECUTION_GOOD_TEAM_LOST : character === "saintNonqualifying" ? SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED : character === "resolvedDemon" ? RESOLVED_DEMON_DEATH_NO_SUCCESSOR : MAYOR_DAY_END_GOOD_TEAM_WON);
  if (character === "resolvedDemon") {
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    expect(game().gameRuleFacts[0]).toMatchObject({ resolutionId: game().lifeEventWindow.events[0]!.id,
      provenance: { sourceParticipant: { participantId: day.players.p0!.participantId }, sourceCharacter: "imp" } });
  }
  expect(store.getState().undoStack).toEqual([day]);
  await project(writer);
  const checkpoint = await backend.get(`lobbies/${code}/checkpoint`);
  const accepted = game();
  expect(StorytellerGamePersistedSchema.parse(JSON.parse(checkpoint as string).game)).toEqual(accepted);
  for (const path of ["checkpoint", "storyteller", "storyteller/gameRuleFacts"])
    await assertFails(playerDb.ref(`lobbies/${code}/${path}`).once("value"));
  expect(JSON.stringify((await playerDb.ref(`lobbies/${code}/public`).once("value")).val())).not.toMatch(/gameRuleFacts|saintExecution|mayorDayEnd|resolvedDemonDeathNoSuccessor|sourceParticipant|resolutionId/);
  expect(JSON.stringify((await playerDb.ref(`lobbies/${code}/player/p1`).once("value")).val())).not.toMatch(/gameRuleFacts|saintExecution|mayorDayEnd|resolvedDemonDeathNoSuccessor|sourceParticipant|resolutionId/);
  const retained = captureCharacterActionContext();
  await writer.dispose();
  const replacement = new SessionWriter(backend, code, session.id); writers.push(replacement);
  // Exercise the production checkpoint decoder/adoption path, not just JSON.
  store.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
  const restored = await startStorytellerSession(backend, store.getState().lobby!, replacement);
  subscriptions.push(restored.stop);
  useSessionRuntime.setState({ backend: replacement, status: "live" });
  expect(validVictoryEvidence(game())).toEqual(accepted.gameRuleFacts);
  expect(game().lifeEventWindow).toEqual(accepted.lifeEventWindow);
  expect(game().gameSchemaVersion).toBe(28);
  const before = store.getState();
  expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p1" }] }, retained)).toMatchObject({ ok: false });
  expect(store.getState()).toBe(before);
  await expect(project(writer)).rejects.toThrow();
  await project(replacement);
  expect(JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game.gameRuleFacts).toEqual(accepted.gameRuleFacts);
  await assertFails(playerDb.ref(`lobbies/${code}/storyteller/gameRuleFacts`).set([]));
  // The replacement writer can make a real correction and Undo it as one
  // authority-owned replacement, retaining the exact qualification on Undo.
  expect(store.getState().resolveLife({ intents: [{ kind: "correctStatus", playerId: "p1", target: { alive: false, ghostVote: true } }] }, captureCharacterActionContext())).toMatchObject({ ok: true });
  expect(game().gameRuleFacts).toEqual([]);
  store.getState().undo();
  expect(game().gameRuleFacts).toEqual(accepted.gameRuleFacts);
  await project(replacement);
  const undoneCheckpoint = StorytellerGamePersistedSchema.parse(JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game);
  expect(undoneCheckpoint.gameRuleFacts).toEqual(accepted.gameRuleFacts);
  expect(undoneCheckpoint.lifeEventWindow).toEqual(accepted.lifeEventWindow);
});

test("B8 a retained Demon execution callback cannot create temporal evidence after writer takeover, and storage failure is atomic", async () => {
  const { backend, writer, session } = await open();
  const day = setupGame(["imp", "scarletwoman", "chef", "soldier"], { code, storytellerUid: host, phase: "day", day: 2, voting: freshVotingDay(2) });
  for (const player of Object.values(day.players)) player.actualAlignment = buildRegistry(setupScript).alignmentOf(player.actualRole);
  store.setState({ game: day, undoStack: [], localSeq: 0, sync: null });
  await publish(writer);
  const checkpoint = await backend.get(`lobbies/${code}/checkpoint`);
  const captured = captureCharacterActionContext();
  const delayedExecution = () => store.getState().recordExecution("p0", "died", undefined, undefined, captured);
  await writer.dispose();
  const replacement = new SessionWriter(backend, code, session.id); writers.push(replacement); await replacement.start();
  useSessionRuntime.setState({ backend: replacement, status: "live" });
  const before = store.getState();
  expect(delayedExecution()).toMatchObject({ ok: false });
  expect(store.getState()).toBe(before);
  expect(await backend.get(`lobbies/${code}/checkpoint`)).toBe(checkpoint);
  await expect(publish(writer)).rejects.toThrow();

  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  expect(store.getState().recordExecution("p0", "died", undefined, undefined, captureCharacterActionContext())).toMatchObject({ ok: false });
  expect(store.getState()).toBe(before);
  expect(game().players.p0!.alive).toBe(true);
  expect(game().gameRuleFacts).toEqual([]);
  write.mockRestore();
  expect(await backend.get(`lobbies/${code}/checkpoint`)).toBe(checkpoint);

  expect(store.getState().recordExecution("p0", "died", undefined, undefined, captureCharacterActionContext())).toMatchObject({ ok: true });
  expect(store.getState().undoStack).toEqual([day]);
  expect(store.getState().localSeq).toBe(1);
  expect(game().gameRuleFacts).toEqual([expect.objectContaining({ type: RESOLVED_DEMON_DEATH_NO_SUCCESSOR,
    resolutionId: game().lifeEventWindow.events[0]!.id, provenance: expect.objectContaining({ sourceParticipant: expect.objectContaining({ participantId: day.players.p0!.participantId }) }) })]);
  await publish(replacement);
  const accepted = game();
  expect(StorytellerGamePersistedSchema.parse(JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game)).toEqual(accepted);
  const saved = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
  expect(game()).toEqual(accepted);
  expect(validVictoryEvidence(game())).toEqual(accepted.gameRuleFacts);
  store.getState().undo();
  expect(game()).toEqual(day);
  await publish(replacement);
  expect(JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game.gameRuleFacts).toEqual([]);
});

test("B7 Master notation and v28 preparation stay private through checkpoint publication and real writer takeover", async () => {
  const { backend, writer, session } = await open();
  const night = setupGame(["butler", "washerwoman", "chef", "poisoner", "imp"], { code, storytellerUid: host, phase: "night", day: 1 });
  Object.values(night.players).forEach(player => { player.packetEpoch = `b7-identity-${player.id}`; });
  store.setState({ game: night, undoStack: [], localSeq: 0 });
  const playerUid = "b7-butler-player";
  const playerDb = env.authenticatedContext(playerUid).database();
  await knockOnLobby(new FirebaseRoomBackend(playerDb as unknown as Database), code, playerUid, "Player 0");
  await seatPlayer(writer, code, playerUid, "p0", null);
  const project = (activeWriter: SessionWriter) => writeProjections({ backend: activeWriter, code, stState: game(), registry: buildRegistry(setupScript), online: {}, membership: { [playerUid]: "p0" } });
  expect(store.getState().prepareInformation({ character: "washerwoman", source: binding("p1"), expected: preparedInformationContext(game(), setupScript),
    clue: { kind: "pair", candidates: [binding("p2"), binding("p3")], shownCharacter: "chef", qualifyingParticipantId: binding("p2").participantId },
  }, captureCharacterActionContext())).toMatchObject({ ok: true });
  const prepared = game().preparedInformation;
  const select = (target: string) => ({ source: binding("p0"), target: binding(target), expected: butlerSelectionContext(game(), setupScript, binding("p0")) });
  expect(store.getState().selectButlerMaster(select("p2"), captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
  expect(game().preparedInformation).toEqual(prepared);
  expect(game().informationDeliveries).toEqual([]);
  const master = game().players.p2!.reminders.find(reminder => reminder.sourceCharacter === "butler")!;
  expect(master).toMatchObject({ label: "Master", sourceParticipant: { participantId: binding("p0").participantId } });
  await project(writer);
  const checkpoint = await backend.get(`lobbies/${code}/checkpoint`);
  const saved = JSON.parse(checkpoint as string).game;
  expect(StorytellerGamePersistedSchema.parse(saved)).toEqual(game());
  await assertFails(playerDb.ref(`lobbies/${code}/checkpoint`).once("value"));
  await assertFails(playerDb.ref(`lobbies/${code}/storyteller`).once("value"));
  const publicAndSelf = JSON.stringify([(await playerDb.ref(`lobbies/${code}/public`).once("value")).val(),
    (await playerDb.ref(`lobbies/${code}/player/p0`).once("value")).val()]);
  expect(publicAndSelf).not.toMatch(/butler-master|Master|sourceParticipant|preparedInformation|qualifyingParticipantId/);
  const retained = select("p3"); const captured = captureCharacterActionContext();
  await writer.dispose();
  const replacement = new SessionWriter(backend, code, session.id); writers.push(replacement); await replacement.start();
  useSessionRuntime.setState({ backend: replacement, status: "live" });
  const before = store.getState();
  expect(store.getState().selectButlerMaster(retained, captured)).toMatchObject({ ok: false });
  expect(store.getState()).toBe(before);
  expect(await backend.get(`lobbies/${code}/checkpoint`)).toBe(checkpoint);
  await expect(project(writer)).rejects.toThrow();
  expect(store.getState().selectButlerMaster(select("p3"), captureCharacterActionContext())).toMatchObject({ ok: true });
  await project(replacement);
  const updated = JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game;
  expect(updated.preparedInformation).toEqual(prepared);
  expect(updated.players.p2.reminders.some((reminder: { id: string }) => reminder.id === master.id)).toBe(false);
  expect(updated.players.p3.reminders).toContainEqual(expect.objectContaining({ id: master.id, label: "Master" }));
});

test("B7 Virgin consumption and distinct execution outcome survive real checkpoint serialization without a second Day execution", async () => {
  const { backend, writer } = await open();
  const day = setupGame(["chef", "virgin", "soldier", "poisoner", "imp"], { code, storytellerUid: host, phase: "day", day: 1, voting: freshVotingDay(1) });
  Object.values(day.players).forEach(player => { player.packetEpoch = `b7-virgin-${player.id}`; });
  store.setState({ game: day, undoStack: [], localSeq: 0 });
  expect(store.getState().resolveVoting({ kind: "begin", roundId: "b7-first-nomination", mode: "nomination", nominator: binding("p0"), nominee: binding("p1"),
    code, day: 1, expectedRevision: 0 }, captureVotingContext())).toMatchObject({ ok: true });
  expect(game().players.p1!.abilityUsed).toBe(true);
  expect(game().players.p1!.reminders).toContainEqual(expect.objectContaining({ label: "No Ability", sourceCharacter: "virgin" }));
  await publish(writer);
  const pending = StorytellerGamePersistedSchema.parse(JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game);
  expect(votingContextChanged(pending, pending.voting!.rounds[0]!, { script: setupScript, registry: buildRegistry(setupScript) })).toBe(false);
  store.setState({ game: pending });
  expect(store.getState().resolveVoting({ kind: "virgin", roundId: "b7-first-nomination", execute: true, outcome: "survived",
    code, day: 1, expectedRevision: currentVotingState(game()).revision }, captureVotingContext())).toMatchObject({ ok: true });
  expect(game().players.p0!.alive).toBe(true);
  expect(game().lifeEventWindow.events).toEqual([expect.objectContaining({ kind: "execution", outcome: "survived" })]);
  await publish(writer);
  const executed = await backend.get(`lobbies/${code}/checkpoint`);
  expect(JSON.parse(executed as string).game).toEqual(game());
  expect(store.getState().resolveVoting({ kind: "execution", target: binding("p2"), outcome: "died", code, day: 1,
    expectedRevision: currentVotingState(game()).revision }, captureVotingContext())).toMatchObject({ ok: false });
  expect(await backend.get(`lobbies/${code}/checkpoint`)).toBe(executed);
  expect(JSON.stringify(await backend.get(`lobbies/${code}/public`))).not.toMatch(/No Ability|abilityUsed|virginPending|contextStamp/);
  store.getState().undo();
  expect(game()).toEqual(pending);
});

test("B6 pending clue and delivered communication serialize privately through the real guarded writer", async () => {
  const { backend, writer } = await open();
  const setup = setupGame(["washerwoman", "chef", "empath", "poisoner", "imp"], {
    code, storytellerUid: host, setupRolesDealt: true, setupRolesRevealed: true,
  });
  Object.values(setup.players).forEach(player => { player.packetEpoch = `b6-identity-${player.id}`; });
  store.setState({ game: setup, undoStack: [], localSeq: 0 });
  const playerUid = "b6-player";
  const playerDb = env.authenticatedContext(playerUid).database();
  await knockOnLobby(new FirebaseRoomBackend(playerDb as unknown as Database), code, playerUid, "Player 1");
  await seatPlayer(writer, code, playerUid, "p1", null);
  const project = () => writeProjections({ backend: writer, code, stState: game(), registry: buildRegistry(setupScript),
    online: {}, membership: { [playerUid]: "p1" } });
  expect(store.getState().prepareInformation({ character: "washerwoman", source: binding("p0"),
    expected: preparedInformationContext(game(), setupScript), clue: { kind: "pair",
      candidates: [binding("p1"), binding("p2")], shownCharacter: "chef", qualifyingParticipantId: binding("p1").participantId },
  }, captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
  expect(store.getState().undoStack).toHaveLength(1);
  expect(game().informationDeliveries).toEqual([]);
  await project();
  const pending = JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game;
  expect(pending).toEqual(game());
  expect(StorytellerGamePersistedSchema.safeParse(pending).success).toBe(true);
  expect(pending.preparedInformation).toHaveLength(1);
  for (const privatePath of ["checkpoint", "storyteller", "storyteller/preparedInformation"])
    await assertFails(playerDb.ref(`lobbies/${code}/${privatePath}`).once("value"));
  const publicAndSelf = JSON.stringify([
    (await playerDb.ref(`lobbies/${code}/public`).once("value")).val(),
    (await playerDb.ref(`lobbies/${code}/player/p1`).once("value")).val(),
  ]);
  expect(publicAndSelf).not.toMatch(/preparedInformation|qualifyingParticipantId|sourceIdentityEpoch|informationDeliveries|Townsfolk|Wrong/);
  store.setState({ game: { ...game(), phase: "night", day: 1 } });
  const delivery = { preparationId: game().preparedInformation[0]!.id, source: binding("p0"), expected: preparedInformationContext(game(), setupScript) };
  expect(store.getState().deliverPreparedInformation(delivery, captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
  expect(store.getState().undoStack).toHaveLength(2);
  await project();
  const delivered = JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game;
  expect(delivered).toEqual(game());
  expect(delivered.preparedInformation).toEqual([]);
  expect(delivered.informationDeliveries).toHaveLength(1);
  expect(delivered.players.p1.reminders[0].id).toBe(pending.players.p1.reminders[0].id);
  expect(delivered.players.p2.reminders[0].id).toBe(pending.players.p2.reminders[0].id);
  expect(JSON.stringify((await playerDb.ref(`lobbies/${code}/player/p1`).once("value")).val()))
    .not.toMatch(/preparedInformation|qualifyingParticipantId|informationDeliveries/);
  expect(store.getState().deliverPreparedInformation(delivery, captureCharacterActionContext())).toMatchObject({ ok: false });
  expect(JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game).toEqual(delivered);
});

test("a guarded character action publishes its atomic private checkpoint without leaking effects publicly", async () => {
  const { backend, writer } = await open(); const before = game();
  expect(poison()).toMatchObject({ ok: true, changed: true });
  expect(store.getState().undoStack).toHaveLength(1); expect(store.getState().localSeq).toBe(1);
  await publish(writer);
  const checkpoint = JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string);
  expect(checkpoint.game).toEqual(game());
  expect(checkpoint.game.players.p1.effects[0].type).toBe("poisoned");
  const publicGame = JSON.stringify(await backend.get(`lobbies/${code}/public`));
  expect(publicGame).not.toContain("effects"); expect(publicGame).not.toContain("reminders"); expect(publicGame).not.toContain("poisoner");
  await assertFails(env.authenticatedContext("outsider").database().ref(`lobbies/${code}/checkpoint`).once("value"));
  const saved = localStorage.getItem("new-blood-st")!; const expected = game();
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
  expect(game()).toEqual(expected); store.getState().undo(); expect(game()).toEqual(before);
});

test("storage refusal and a replacement live writer cannot publish a retained character callback", async () => {
  const { backend, writer, session } = await open(); await publish(writer);
  const checkpoint = await backend.get(`lobbies/${code}/checkpoint`); const before = store.getState();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  expect(poison()).toMatchObject({ ok: false }); expect(game()).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack);
  write.mockRestore();
  expect(await backend.get(`lobbies/${code}/checkpoint`)).toBe(checkpoint);
  const context = captureCharacterActionContext(); const target = binding("p1");
  await writer.dispose();
  const replacement = new SessionWriter(backend, code, session.id); writers.push(replacement); await replacement.start();
  useSessionRuntime.setState({ backend: replacement, status: "live" });
  expect(store.getState().resolveReminders({ intents: [{ kind: "place", target, reminder: { label: "Selected" } }] }, context)).toMatchObject({ ok: false });
  expect(game()).toBe(before.game); expect(await backend.get(`lobbies/${code}/checkpoint`)).toBe(checkpoint);
  await expect(publish(writer)).rejects.toThrow();
  expect(poison()).toMatchObject({ ok: true }); await publish(replacement);
  expect(JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string).game.players.p1.effects).toHaveLength(1);
});
