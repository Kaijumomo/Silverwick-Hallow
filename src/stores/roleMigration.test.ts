// Phase 10D: store / game schema v22 -- the explicit per-entry marker ladder
// (20 -> 21 -> 22, 21 -> 22), v22 evidence that fails closed, and
// local Current State / every Undo snapshot / remote checkpoint recovery
// following exactly the same routing. v21 -> v22 is a STAMP: no Role
// inference, no History rewrite, no Current State reconstruction.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { usePlayerStore } from "./playerStore";
import { HistoryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { detectLegacyGameVersion, hasV21Evidence, hasV22Evidence, migrateGameEntry } from "./gameMigration";
import { changeRoleIntent, correctRoleIntent } from "./roleResolution";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { asV20, asV21, asV22, withV21Reminders, withV22Roles, withV23Alignment, withV24Guided } from "@/test/v20Migration";

// Phase 10E: the ladder continues to v23 (see alignmentMigration.test.ts for
// the v22 -> v23 step itself). Every v22 result below therefore also receives
// v22 -> v23; these fixtures carry no Traveler explicit Shown Alignment, so it
// is the marker advance only.
const toCurrent = (v22: Raw): Raw => withV24Guided(withV23Alignment(v22));
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { SessionWriter } from "@/firebase/writer";
import { startStorytellerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { SnapshotValidationError } from "@/firebase/snapshots";

const code = "ROLE2345";
const root = `lobbies/${code}`;
const state = () => store.getState();
const game = () => state().game!;
type Raw = Record<string, unknown>;
const disposals: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript } });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  localStorage.clear();
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

/** A live current-version (v23) game whose History holds a LEGACY-shaped Role
 * record (a plain change), a Role correction and a correlated Role record. */
function currentGame(): Raw {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"]) state().addPlayerToSeat(name);
  state().setRolePool(standardRoles(7));
  state().dealRolePool();
  for (const id of game().seatOrder) state().showAssignedRole(id);
  state().revealRoles();
  state().beginNightOne();
  const [a, b, c] = game().seatOrder as [string, string, string];
  expect(state().assignRole(a, "saint")).toMatchObject({ ok: true }); // no correction, no resolutionId
  expect(state().correctRole(b, "monk")).toMatchObject({ ok: true }); // v22 evidence: correction
  expect(state().resolveRoles({ intents: [changeRoleIntent(game().players[c]!, "chef")], resolutionId: "res-1" })).toMatchObject({ ok: true }); // v22 evidence: resolutionId
  return { ...JSON.parse(JSON.stringify(game())), code, storytellerUid: "host" };
}
const roleRecords = (g: Raw) => (g.history as Raw[]).filter((h) => h.category === "role");

describe("v21 -> v22 is a stamp on every entry independently", () => {
  it("local Current State and EACH Undo snapshot receive exactly the marker -- nothing inferred, rewritten or reconstructed", () => {
    const v21 = asV21(currentGame());
    // A legacy ordinary Role-empty seat stays exactly as it is (never given a Role).
    const seats = v21.players as Record<string, Raw>;
    const emptied = Object.keys(seats)[3]!;
    seats[emptied]!.actualRole = "";
    const older = structuredClone(v21);
    older.history = [];
    const result = migrateStoreState({ game: structuredClone(v21), undoStack: [structuredClone(older), structuredClone(v21)] }, 21) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(toCurrent(withV22Roles(v21)));
    expect(result.undoStack[0]).toEqual(toCurrent(withV22Roles(older)));
    expect(result.undoStack[1]).toEqual(result.game);
    expect((result.game.players as Record<string, Raw>)[emptied]!.actualRole).toBe("");
    // History is byte-identical, legacy Role History included.
    expect(JSON.stringify(result.game.history)).toBe(JSON.stringify(v21.history));
    expect(roleRecords(result.game).length).toBeGreaterThan(0);
    expect(StorytellerGamePersistedSchema.safeParse(result.game).success).toBe(true);
  });

  it("legacy Role History is never rewritten into the v22 shape", () => {
    const v21 = asV21(currentGame());
    const legacy = roleRecords(v21)[0]!;
    expect(legacy).not.toHaveProperty("correction");
    expect(legacy).not.toHaveProperty("resolutionId");
    const copy = structuredClone(v21);
    migrateGameEntry(copy, 21, { kind: "canonical-only" });
    expect(roleRecords(copy)).toEqual(roleRecords(v21));
    expect(copy.gameSchemaVersion).toBe(24);
    // A legacy record with looser snapshot keys stays valid; only the v22-only
    // metadata demands the strict { actualRole } shape.
    const loose = { ...legacy, change: { kind: "value", from: { actualRole: "chef", legacyExtra: 1 }, to: { actualRole: "saint", legacyExtra: 2 } } };
    expect(HistoryRecordSchema.safeParse(loose).success).toBe(true);
  });

  it("a genuine v21 localStorage blob rehydrates as current (v23) and is written back as v23", async () => {
    localStorage.setItem("new-blood-st", JSON.stringify({ version: 21, state: { game: asV21(currentGame()), undoStack: [] } }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(game().gameSchemaVersion).toBe(24);
    state().setNotes(game().seatOrder[0]!, "x");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(localStorage.getItem("new-blood-st")!).version).toBe(24);
  });
});

describe("v20 -> v21 -> v22 (marker 20 keeps working)", () => {
  it("marker-20 Current State and Undo entries migrate through BOTH steps, independently", () => {
    const v20 = asV20(currentGame());
    const older = structuredClone(v20);
    const result = migrateStoreState({ game: structuredClone(v20), undoStack: [older] }, 20) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    const expected = toCurrent(withV22Roles(withV21Reminders(v20)));
    expect(result.game).toEqual(expected);
    expect(result.undoStack[0]).toEqual(expected);
    expect(StorytellerGamePersistedSchema.safeParse(result.game).success).toBe(true);
    // Legacy Role History (the v22-only records never existed under v20).
    expect(JSON.stringify(roleRecords(result.game))).toBe(JSON.stringify(roleRecords(v20)));
  });

  it("a mixed store: marker 20 / 21 / 22 / 23 entries each follow their OWN path", () => {
    const current = currentGame();
    const v22 = asV22(current); const v21 = asV21(current); const v20 = asV20(current);
    const result = migrateStoreState({ game: structuredClone(current), undoStack: [structuredClone(v20), structuredClone(v21), structuredClone(v22)] }, 19) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(current); // marker 23: untouched
    expect(result.undoStack[0]).toEqual(toCurrent(withV22Roles(withV21Reminders(v20))));
    expect(result.undoStack[1]).toEqual(toCurrent(withV22Roles(v21)));
    expect(result.undoStack[2]).toEqual(toCurrent(v22));
  });

  it("marker-less genuine legacy (v19) data still migrates through the whole chain to v23", () => {
    const v19 = asV20(currentGame());
    delete v19.gameSchemaVersion;
    for (const p of Object.values(v19.players as Record<string, { effects?: Raw[] }>)) for (const e of p.effects ?? []) { delete e.state; delete e.expiry; }
    const result = migrateStoreState({ game: v19, undoStack: [] }, 19) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game.gameSchemaVersion).toBe(24);
  });
});

describe("routing parity: the one shared per-entry routine serves local state, Undo and remote recovery", () => {
  it.each([["marker 22", (g: Raw) => asV22(g)], ["marker 21", (g: Raw) => asV21(g)], ["marker 20", (g: Raw) => asV20(g)]] as const)(
    "%s: the local store path and the direct (checkpoint-style) path agree byte for byte", (_label, build) => {
      const entry = build(currentGame());
      const local = migrateStoreState({ game: structuredClone(entry), undoStack: [] }, 13) as { game: Raw };
      const direct = structuredClone(entry);
      migrateGameEntry(direct, detectLegacyGameVersion(direct)!, { kind: "canonical-only" });
      expect(takeMigrationResetFlag()).toBe(false);
      expect(direct).toEqual(local.game);
      expect(direct.gameSchemaVersion).toBe(24);
    });

  async function recoverFrom(entry: Raw) {
    const b = new MemoryRoomBackend();
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: entry, roster: {} }));
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.getState().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    return { start: () => startStorytellerSession(b, lobby, writer) };
  }

  it.each([["v21", (g: Raw) => asV21(g), (g: Raw) => toCurrent(withV22Roles(g))], ["v20", (g: Raw) => asV20(g), (g: Raw) => toCurrent(withV22Roles(withV21Reminders(g)))]] as const)(
    "a %s remote checkpoint recovers to the SAME current (v23) result the local migration reaches (two independent recoveries agree)", async (_label, build, expectedOf) => {
      const entry = build(currentGame());
      const local = migrateStoreState({ game: structuredClone(entry), undoStack: [] }, 13) as { game: Raw };
      store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
      const first = await recoverFrom(structuredClone(entry));
      const recovered = await first.start();
      disposals.push(() => recovered.stop());
      expect(recovered.outcome).toBe("live");
      const once = structuredClone(game());
      expect(once).toEqual(expectedOf(entry));
      expect(JSON.parse(JSON.stringify(once))).toEqual(JSON.parse(JSON.stringify(local.game)));
      for (const dispose of disposals.splice(0).reverse()) await dispose();
      store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
      const second = await recoverFrom(structuredClone(entry));
      const again = await second.start();
      disposals.push(() => again.stop());
      expect(game()).toEqual(once);
    });

  it("a current checkpoint carrying Role correction / correlation History recovers unchanged (valid state is preserved, nothing invented)", async () => {
    const entry = currentGame();
    const { start } = await recoverFrom(structuredClone(entry));
    const recovered = await start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(roleRecords(JSON.parse(JSON.stringify(game())))).toEqual(roleRecords(entry));
  });
});

describe("v22 evidence fails closed: never stamped into validity", () => {
  const evidence: [string, (g: Raw) => void][] = [
    ["a Role correction", (g) => { (g.history as Raw[]).push({ id: "hx", category: "role", participant: { kind: "legacy", playerId: "a" }, correction: true,
      change: { kind: "value", from: { actualRole: "a" }, to: { actualRole: "b" } } }); }],
    ["a Role resolutionId", (g) => { (g.history as Raw[]).push({ id: "hx", category: "role", participant: { kind: "legacy", playerId: "a" }, resolutionId: "r",
      change: { kind: "value", from: { actualRole: "a" }, to: { actualRole: "b" } } }); }],
  ];

  it.each(evidence)("%s is v22 evidence -- ahead of any older generic heuristic", (_label, inject) => {
    const g = asV21(currentGame());
    delete g.gameSchemaVersion;
    inject(g);
    expect(hasV22Evidence(g)).toBe(true);
    expect(detectLegacyGameVersion(g)).toBe(24); // reported as current: no legacy step
  });

  it.each(evidence)("marker-less %s: rejected as malformed current-version data -- no legacy step runs, never stamped", (_label, inject) => {
    // The exact trap: the generic `correction` key is v19 Life evidence and the
    // generic `resolutionId` key is v20 evidence, so a naive older heuristic
    // would run v19 -> v22 and stamp this into validity.
    const g = asV20(currentGame());
    delete g.gameSchemaVersion;
    for (const p of Object.values(g.players as Record<string, { effects?: Raw[] }>)) for (const e of p.effects ?? []) { delete e.state; delete e.expiry; }
    delete g.lifeEventWindow; // a v18-shaped entry: every legacy step would otherwise apply
    inject(g);
    const copy = structuredClone(g);
    migrateGameEntry(copy, 18, { kind: "canonical-only" });
    expect(copy).toEqual(g);
    expect("gameSchemaVersion" in copy).toBe(false);
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
    migrateStoreState({ game: structuredClone(g), undoStack: [] }, 18);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it.each([20, 21] as const)("an OLDER marker (%s) carrying v22 evidence is rejected unrepaired -- never stamped", (marker) => {
    for (const [, inject] of evidence) {
      const g = (marker === 21 ? asV21 : asV20)(currentGame());
      inject(g);
      expect(g.gameSchemaVersion).toBe(marker);
      const copy = structuredClone(g);
      migrateGameEntry(copy, marker, { kind: "canonical-only" });
      expect(copy).toEqual(g);
      expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
      for (const version of [marker, 19]) {
        const result = migrateStoreState({ game: structuredClone(g), undoStack: [] }, version) as { game: unknown };
        expect(takeMigrationResetFlag()).toBe(true);
        expect(result.game).toBeNull();
      }
      // The same holds inside an Undo snapshot alone.
      migrateStoreState({ game: (marker === 21 ? asV21 : asV20)(currentGame()), undoStack: [structuredClone(g)] }, marker);
      expect(takeMigrationResetFlag()).toBe(true);
    }
  });

  it("a malformed / unsupported marker is never reinterpreted as legacy: untouched, rejected", () => {
    for (const marker of [25, "22", "21", null, { v: 22 }, 0, -1]) {
      const g = currentGame();
      g.gameSchemaVersion = marker;
      expect(detectLegacyGameVersion(g)).toBe(24);
      const copy = structuredClone(g);
      migrateGameEntry(copy, 13, { kind: "canonical-only" });
      expect(copy).toEqual(g);
      for (const version of [24, 23, 22, 21, 20, 19]) {
        migrateStoreState({ game: structuredClone(g), undoStack: [] }, version);
        expect(takeMigrationResetFlag()).toBe(true);
      }
    }
  });

  it("marker 23 is current: no migration, valid, same content; marker 22 receives only v22 -> v23", () => {
    const g = currentGame();
    const copy = structuredClone(g);
    migrateGameEntry(copy, 13, { kind: "canonical-only" });
    expect(copy).toEqual(g);
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(true);
    const result = migrateStoreState({ game: structuredClone(g), undoStack: [] }, 23) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(g);
    const v22 = asV22(g);
    const migrated = migrateStoreState({ game: structuredClone(v22), undoStack: [] }, 22) as { game: Raw };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(migrated.game).toEqual(toCurrent(v22));
  });

  it("the envelope gate: no migration BELOW an envelope that already claims the target version", () => {
    migrateStoreState({ game: asV22(currentGame()), undoStack: [] }, 23);
    expect(takeMigrationResetFlag()).toBe(true);
    migrateStoreState({ game: asV21(currentGame()), undoStack: [] }, 22);
    expect(takeMigrationResetFlag()).toBe(true);
    migrateStoreState({ game: asV20(currentGame()), undoStack: [] }, 21);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("the evidence is narrow: a correction / resolutionId on OTHER categories is older, legitimate evidence and is not v22 evidence", () => {
    const g: Raw = { history: [
      { id: "h1", category: "life", correction: true }, { id: "h2", category: "effect", resolutionId: "r", effectOperation: "apply", correction: true },
      { id: "h3", category: "reminder", resolutionId: "r", reminderOperation: "place" }, { id: "h4", category: "alignment" },
      { id: "h5", category: "role", change: { kind: "value", from: { actualRole: "a" }, to: { actualRole: "b" } } },
    ] };
    expect(hasV22Evidence(g)).toBe(false);
    expect(hasV21Evidence(g)).toBe(true); // the reminder operation is v21 evidence, as before
    const v21 = asV21(currentGame());
    (v21.history as Raw[]).push({ id: "life-fix", category: "life", participant: { kind: "legacy", playerId: "a" }, correction: true,
      change: { kind: "value", from: { alive: false }, to: { alive: true } } });
    const copy = structuredClone(v21);
    migrateGameEntry(copy, 21, { kind: "canonical-only" });
    expect(copy.gameSchemaVersion).toBe(24);
  });
});

describe("v22 Role History contract", () => {
  const base = { id: "h", category: "role", participant: { kind: "legacy", playerId: "a" } };
  it("a record carrying v22 metadata must be a value change of exactly { actualRole } on each side", () => {
    const ok = { ...base, correction: true, change: { kind: "value", from: { actualRole: "a" }, to: { actualRole: "" } } };
    expect(HistoryRecordSchema.safeParse(ok).success).toBe(true);
    expect(HistoryRecordSchema.safeParse({ ...ok, resolutionId: "r" }).success).toBe(true);
    for (const change of [
      { kind: "value", from: { actualRole: "a", shownRole: "x" }, to: { actualRole: "b" } },
      { kind: "value", from: { actualRole: "a" }, to: { actualRole: "b", actualAlignment: "good" } },
      { kind: "value", from: { actualRole: "a" }, to: {} },
      { kind: "value", from: { actualRole: 5 }, to: { actualRole: "b" } },
      { kind: "added", item: { actualRole: "a" } },
    ]) {
      expect(HistoryRecordSchema.safeParse({ ...ok, change }).success).toBe(false);
    }
    expect(HistoryRecordSchema.safeParse({ ...base, resolutionId: "r", change: { kind: "removed", item: {} } }).success).toBe(false);
  });

  it("the seam writes only records of that shape, and a perception change writes none", () => {
    currentGame();
    const c = game().seatOrder[3]!;
    const before = game().history.length;
    state().setShownRole(c, "librarian");
    expect(game().history).toHaveLength(before);
    state().resolveRoles({ intents: [correctRoleIntent(game().players[c]!, "monk")], resolutionId: "z" });
    const record = game().history.at(-1)!;
    expect(HistoryRecordSchema.safeParse(record).success).toBe(true);
    expect(record.change).toEqual({ kind: "value", from: { actualRole: expect.any(String) }, to: { actualRole: "monk" } });
  });

  it("a recovered checkpoint with a malformed v22 Role record is rejected and never adopted", async () => {
    const entry = currentGame();
    (entry.history as Raw[]).push({ id: "bad", category: "role", participant: { kind: "legacy", playerId: "a" }, correction: true,
      change: { kind: "value", from: { actualRole: "a", shownRole: "x" }, to: { actualRole: "b" } } });
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const b = new MemoryRoomBackend();
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: entry, roster: {} }));
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.getState().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await expect(startStorytellerSession(b, lobby, writer)).rejects.toThrow(SnapshotValidationError);
    expect(store.getState().game).toBeNull();
  });
});
