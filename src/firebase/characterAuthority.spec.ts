// @vitest-environment jsdom
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { SessionWriter } from "./writer";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { writeProjections } from "./sync";
import { useSessionRuntime } from "./storytellerSync";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { captureFingerprint } from "@/stores/abilityResolution";
import { participantStepKey } from "@/stores/nightProgress";
import { usePrivacyStore } from "@/stores/privacyStore";

let env: RulesTestEnvironment;
const code = "CHAR2345";
const host = "character-host";
const writers: SessionWriter[] = [];
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
afterEach(async () => { vi.restoreAllMocks(); for (const writer of writers.splice(0)) await writer.dispose(); });
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
