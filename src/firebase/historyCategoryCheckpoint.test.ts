// Terminology audit (v17 -> v18): remote checkpoint recovery of the History
// category rename ("identity" -> "role"). Checkpoints carry no game schema
// version, so a v17-or-newer checkpoint is detected as v17 and receives the
// idempotent v17 -> v18 step through the shared migrateGameEntry() path.
// Legacy fixtures are seeded as RAW checkpoint JSON (what an older app wrote)
// and recovered through the real startStorytellerSession/readCheckpoint path.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { buildRichPhase9Game } from "@/test/phase9RichState";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { writeProjections } from "./sync";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { SnapshotValidationError } from "./snapshots";

const code = "TERM2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];

type Raw = Record<string, unknown>;
type RawHistory = { category: string } & Raw;

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: {},
  });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function freshLobby(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  return { session, lobby };
}

/** Seeds `game` as the checkpoint and recovers it on a device with no local
 * game (decideReconnect's RESTORE case). */
async function recoverFrom(game: Raw) {
  const b = new MemoryRoomBackend();
  await b.set(`${root}/checkpoint`, JSON.stringify({ game, roster: {} }));
  const { lobby, session } = await freshLobby(b);
  const writer = new SessionWriter(b, code, session.id);
  disposals.push(() => writer.dispose());
  const recovered = await startStorytellerSession(b, lobby, writer);
  disposals.push(() => recovered.stop());
  return { b, recovered };
}

const alice = { kind: "participant", participantId: "pt-alice", playerId: "a", nameAtTime: "Alice" };
const bobNow = { kind: "participant", participantId: "pt-bob", playerId: "a", nameAtTime: "Bob" };
const carol = { kind: "participant", participantId: "pt-carol", playerId: "c", nameAtTime: "Carol" };
const legacyA = { kind: "legacy", playerId: "a" };

const player = (id: string, seat: number, over: Raw = {}): Raw => ({
  id, name: id.toUpperCase(), seat, joinedAt: 1, actualRole: "chef",
  shownRole: "chef", shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
  alive: true, ghostVote: true, abilityUsed: false, statuses: {}, reminders: [], stNotes: "",
  isTraveler: false, actualAlignment: "good", effects: [], ...over,
});

/** Exactly what a v17 app checkpointed: participant-aware History that still
 * names the Actual Role category "identity". Seat "a" is now Bob's; Alice's
 * records and a legacy seat reference must never become his. */
const v17CheckpointGame = (): Raw => ({
  code, storytellerUid: "host", scriptId: "tb", phase: "night", day: 2, notes: "",
  players: {
    a: player("a", 0, { name: "Bob", participantId: "pt-bob" }),
    c: player("c", 1, { name: "Carol", participantId: "pt-carol" }),
  },
  seatOrder: ["a", "c"], nightProgress: {}, fabled: [], bluffs: [], lorics: [], rolePool: [],
  plannedPlayerCount: 2, plannedTravelerCount: 0, pendingPlayers: {},
  history: [
    { id: "h1", category: "identity", participant: alice, moment: { phase: "night", day: 1 },
      change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } },
      provenance: { sourceParticipant: carol, sourceCharacter: "pithag", reason: "Pit-Hag" }, note: "night 1" },
    { id: "h2", category: "alignment", participant: alice, moment: { phase: "night", day: 1 },
      change: { kind: "value", from: { actualAlignment: "good" }, to: { actualAlignment: "evil" } } },
    { id: "h3", category: "identity", participant: legacyA,
      change: { kind: "value", from: { actualRole: "empath" }, to: { actualRole: "chef" } } },
    { id: "h4", category: "identity", participant: bobNow, moment: { phase: "night", day: 2 },
      change: { kind: "value", from: { actualRole: "" }, to: { actualRole: "chef" } } },
  ],
  informationDeliveries: [{
    id: "d1", recipient: alice, actualRole: "washerwoman", informationActionId: "washerwoman-first-night",
    moment: { phase: "night", day: 1 },
    values: [{ requirementId: "players", kind: "player", participants: [carol, legacyA] }],
  }],
});

function canonical(game: Raw): Raw {
  const copy = structuredClone(game) as { history: RawHistory[] };
  for (const record of copy.history) if (record.category === "identity") record.category = "role";
  return copy as unknown as Raw;
}

describe("E. a supported remote checkpoint carrying legacy \"identity\" History", () => {
  it("is accepted and restores \"role\" History with ParticipantRef/Provenance/change data and Current State untouched", async () => {
    const seeded = v17CheckpointGame();
    const { recovered } = await recoverFrom(seeded);
    expect(recovered.outcome).toBe("live");

    const game = useStorytellerStore.getState().game!;
    expect(game.history.map((h) => h.category)).toEqual(["role", "alignment", "role", "role"]);
    expect(game.history).toEqual((canonical(seeded) as { history: unknown }).history);
    expect(game.history[0]!.participant).toEqual(alice);
    expect(game.history[0]!.provenance).toEqual({ sourceParticipant: carol, sourceCharacter: "pithag", reason: "Pit-Hag" });
    expect(game.history[2]!.participant).toEqual(legacyA);
    expect(JSON.stringify(game.history.slice(0, 3))).not.toContain("pt-bob");
    expect(game.players).toEqual(seeded.players);
    expect(game.seatOrder).toEqual(seeded.seatOrder);
    expect(game.informationDeliveries).toEqual(seeded.informationDeliveries);
  });

  it("a v16 checkpoint (PlayerId-only History) runs both steps: an unresolved legacy ref, and \"role\"", async () => {
    const seeded = v17CheckpointGame();
    seeded.players = { a: player("a", 0, { name: "Bob" }), c: player("c", 1, { name: "Carol" }) };
    seeded.history = [{ id: "h1", category: "identity", playerId: "a",
      change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } } }];
    seeded.informationDeliveries = [];
    const { recovered } = await recoverFrom(seeded);
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.history).toEqual([{ id: "h1", category: "role", participant: legacyA,
      change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } } }]);
  });

  it("a rich game's checkpoint written with v17 names restores exactly the game the current app holds", async () => {
    buildRichPhase9Game();
    const current = { ...structuredClone(useStorytellerStore.getState().game!), code };
    expect(current.history.map((h) => h.category)).toContain("role");
    const v17 = structuredClone(current) as unknown as { history: RawHistory[] };
    for (const record of v17.history) if (record.category === "role") record.category = "identity";
    useStorytellerStore.setState({ game: null, undoStack: [], localSeq: 0, sync: null });

    const { recovered } = await recoverFrom(v17 as unknown as Raw);
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game).toEqual(current);
  });

  it("an already-canonical checkpoint is left unchanged (the step is idempotent)", async () => {
    const seeded = canonical(v17CheckpointGame());
    const { recovered } = await recoverFrom(seeded);
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.history).toEqual(seeded.history);
  });
});

describe("G. remote: unknown categories are not the legacy alias", () => {
  it.each(["character", "identity-change", "roles"])("a checkpoint with %j History is rejected, never recovered", async (category) => {
    const seeded = v17CheckpointGame();
    (seeded.history as RawHistory[])[0]!.category = category;
    const b = new MemoryRoomBackend();
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: seeded, roster: {} }));
    const { lobby, session } = await freshLobby(b);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(useStorytellerStore.getState().game).toBeNull();
  });
});

describe("F. new checkpoints serialize \"role\"", () => {
  it("writeProjections checkpoints a Role History Record as \"role\" and never manufactures \"identity\"", async () => {
    const backend = new MemoryRoomBackend();
    const game = canonical(v17CheckpointGame()) as unknown as StorytellerLobbyRecord;
    await writeProjections({ backend, code, stState: game, registry: buildRegistry(troubleBrewing), online: {} });
    const raw = (await backend.get(`${root}/checkpoint`)) as string;
    expect(raw).toContain("\"category\":\"role\"");
    expect(raw).not.toContain("\"identity\"");
    const parsed = StorytellerGamePersistedSchema.parse((JSON.parse(raw) as { game: unknown }).game);
    expect(parsed.history).toEqual(game.history);
  });

  it("a live session's real checkpoint of a rich game carries \"role\", and recovers from it unchanged", async () => {
    const b = new MemoryRoomBackend();
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    buildRichPhase9Game();
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    const manager = await startStorytellerSession(b, lobby, writer);
    await waitFor(() => expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));
    const local = structuredClone(useStorytellerStore.getState().game!);
    manager.stop();
    await writer.dispose();

    const raw = (await b.get(`${root}/checkpoint`)) as string;
    expect(raw).toContain("\"category\":\"role\"");
    expect(raw).not.toContain("\"category\":\"identity\"");

    // A second device with no local game recovers it unchanged.
    useStorytellerStore.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    const replacement = new SessionWriter(b, code, session.id);
    disposals.push(() => replacement.dispose());
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game).toEqual(local);
  });
});
