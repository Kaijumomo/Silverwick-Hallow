// Phase 9R.2 Section 19/21H: participant identity and historical snapshots
// must survive checkpoint, reconnect, and remote restore exactly -- recovery
// never regenerates a different ParticipantId for an already-current v17
// occupied player, and no historical identity ever depends on a roster
// lookup after rehydration. Local and remote v16 -> v17 migration must stay
// coherent. Driven through the real production chokepoints
// (writeProjections / startStorytellerSession / readCheckpoint /
// migrateStoreState), never an unexported internal.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { refersToParticipant } from "@/stores/participants";
import { buildRegistry } from "@/data/roleRegistry";
import { setupScript } from "@/test/setupFixtures";
import type { PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { writeProjections } from "./sync";
import { SnapshotValidationError } from "./snapshots";

const code = "PART2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
const store = () => useStorytellerStore.getState();
const game = () => store().game!;

function resetStore() {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
}

beforeEach(() => {
  resetStore();
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function openLobby(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  store().setLobby(lobby);
  return { session, lobby };
}

/** A fresh device (no local game, no sync evidence) recovering the lobby. */
async function recoverOnFreshDevice(b: MemoryRoomBackend, lobby: Awaited<ReturnType<typeof openLobby>>["lobby"], sessionId: string) {
  resetStore();
  store().setLobby(lobby);
  const writer = new SessionWriter(b, code, sessionId);
  const recovered = await startStorytellerSession(b, lobby, writer);
  disposals.push(async () => { recovered.stop(); await writer.dispose(); });
  expect(recovered.outcome).toBe("live");
  return game();
}

const idOf = (name: string): PlayerId => Object.values(game().players).find((p) => p.name === name && !p.isEmpty)!.id;

/** Alice (washerwoman) receives information, is referenced by others, then
 * leaves; Bob fills her seat and gets his own record. */
function aliceThenBob() {
  store().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi"]) store().addPlayerToSeat(name);
  store().setRolePool(["washerwoman", "fortuneteller", "investigator", "chef", "empath", "poisoner", "imp"]);
  expect(store().dealRolePool().ok).toBe(true);
  for (const [name, role] of [["Alice", "washerwoman"], ["Carol", "fortuneteller"]] as const) {
    const holder = Object.values(game().players).find((p) => p.actualRole === role)!.id;
    if (holder !== idOf(name)) expect(store().swapSetupRoles(idOf(name), holder).ok).toBe(true);
  }
  for (const id of game().seatOrder) store().showAssignedRole(id);
  expect(store().revealRoles().ok).toBe(true);
  expect(store().beginNightOne().ok).toBe(true);
  const P = idOf("Alice");
  const A = game().players[P]!.participantId!;
  store().setStatus(P, "poisoned", true);
  expect(store().recordInformationDelivery(P, "washerwoman-first-night", [
    { requirementId: "players", kind: "player", playerIds: [idOf("Carol"), idOf("Dave")] },
    { requirementId: "role", kind: "role", roleId: "chef" },
  ]).ok).toBe(true);
  expect(store().recordInformationDelivery(idOf("Carol"), "fortuneteller-first-night", [
    { requirementId: "players", kind: "player", playerIds: [P, idOf("Dave")] },
    { requirementId: "isDemon", kind: "boolean", value: false },
  ], { provenance: { sourcePlayer: P } }).ok).toBe(true);
  store().addReminder(idOf("Carol"), { label: "Townsfolk", sourcePlayer: P, lifetime: { kind: "manual" } });
  store().unseatPlayer(P);
  store().addPlayerToSeat("Bob");
  const B = game().players[P]!.participantId!;
  store().setStatus(P, "drunk", true);
  return { P, A, B };
}

describe("Phase 9R.2: checkpoint / reconnect / remote restore", () => {
  it("a real v17 checkpoint restores on a fresh device with every ParticipantId and historical snapshot byte-identical -- none regenerated, none re-resolved from the roster", async () => {
    const b = new MemoryRoomBackend();
    const { P, A, B } = aliceThenBob();
    const { lobby, session } = await openLobby(b);
    const before = structuredClone(game());
    await writeProjections({ backend: b, code, stState: before, registry: buildRegistry(setupScript), online: {}, membership: {} });

    const restored = await recoverOnFreshDevice(b, lobby, session.id);
    expect(restored.players).toEqual(before.players);
    expect(restored.history).toEqual(before.history);
    expect(restored.informationDeliveries).toEqual(before.informationDeliveries);
    expect(restored.players[P]!.participantId).toBe(B);
    // Alice's records remain Alice's after the restore; Bob's remain Bob's.
    expect(restored.history.filter((h) => refersToParticipant(h.participant, A))).toHaveLength(1);
    expect(restored.history.filter((h) => refersToParticipant(h.participant, B))).toHaveLength(1);
    expect(restored.informationDeliveries[0]!.recipient).toEqual({ kind: "participant", participantId: A, playerId: P, nameAtTime: "Alice" });
    expect(restored.informationDeliveries[1]!.provenance!.sourceParticipant).toEqual(restored.informationDeliveries[0]!.recipient);

    // Privacy: participant bookkeeping never reached any public/player path.
    const pub = JSON.stringify(await b.get(`${root}/public`));
    const players = JSON.stringify(await b.get(`${root}/player`));
    for (const leak of [A, B, "participant", "nameAtTime", "recipient"]) {
      expect(pub).not.toContain(leak);
      expect(players).not.toContain(leak);
    }
  });

  it("H: the same v16 game migrates identically through local persisted-state migration and remote checkpoint recovery", async () => {
    const v16Game = {
      code, storytellerUid: "host", scriptId: "tb", phase: "night", day: 1, notes: "",
      bluffs: [], fabled: [], lorics: [], rolePool: [], nightProgress: {}, pendingPlayers: {},
      plannedPlayerCount: 2, plannedTravelerCount: 0, setupRolesDealt: true, setupRolesRevealed: true,
      seatOrder: ["a", "e"],
      players: {
        a: { id: "a", name: "Bob", seat: 0, joinedAt: 1, actualRole: "chef", shownRole: "chef", shownAlignment: null,
          behaviorMode: "normal", publicDisplayRole: null, alive: true, ghostVote: true, abilityUsed: false, statuses: {},
          stNotes: "", isTraveler: false, actualAlignment: "good", isEmpty: false,
          effects: [{ id: "x", type: "poisoned", sourcePlayer: "e", lifetime: { kind: "manual" } }], reminders: [] },
        e: { id: "e", name: "", seat: 1, joinedAt: 1, actualRole: "", shownRole: null, shownAlignment: null,
          behaviorMode: "normal", publicDisplayRole: null, alive: true, ghostVote: true, abilityUsed: false, statuses: {},
          stNotes: "", isTraveler: false, isEmpty: true, effects: [], reminders: [] },
      },
      history: [{ id: "h1", category: "life", playerId: "a", moment: { phase: "night", day: 1 },
        change: { kind: "value", from: { alive: true }, to: { alive: false } }, provenance: { sourcePlayer: "e" } }],
      informationDeliveries: [{ id: "d1", recipientPlayerId: "a", actualRole: "chef", informationActionId: "chef-first-night",
        values: [{ requirementId: "pairs", kind: "number", value: 0 }] }],
    };
    const local = (migrateStoreState({ game: structuredClone(v16Game), undoStack: [] }, 16) as { game: StorytellerLobbyRecord }).game;
    expect(takeMigrationResetFlag()).toBe(false);

    const b = new MemoryRoomBackend();
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: v16Game, roster: {} }));
    const { lobby, session } = await openLobby(b);
    const remote = await recoverOnFreshDevice(b, lobby, session.id);

    expect(remote.players).toEqual(local.players);
    expect(remote.history).toEqual(local.history);
    expect(remote.informationDeliveries).toEqual(local.informationDeliveries);
    expect(remote.players.a!.participantId).toBe("legacy-current:a");
    expect(remote.history[0]!.participant).toEqual({ kind: "legacy", playerId: "a" });
    expect(remote.informationDeliveries[0]!.recipient).toEqual({ kind: "legacy", playerId: "a" });
  });

  it("a checkpoint mixing v17 markers with a leftover v16 field is treated as v17 and rejected -- never partially repaired", async () => {
    const b = new MemoryRoomBackend();
    aliceThenBob();
    const { lobby, session } = await openLobby(b);
    const mixed = structuredClone(game()) as unknown as { history: Record<string, unknown>[] };
    mixed.history.push({ id: "stale", category: "life", playerId: "x", change: { kind: "value", from: {}, to: {} } });
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: mixed, roster: {} }));
    resetStore();
    store().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(store().game).toBeNull();
  });
});
