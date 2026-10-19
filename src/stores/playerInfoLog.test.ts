import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeSelfSnapshot } from "@/firebase/snapshots";
import { useStorytellerStore as store, migrateStoreState, takeMigrationResetFlag } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { detectLegacyGameVersion, migrateGameEntry } from "./gameMigration";
import { projectLobbyToSelfEnvelopeMap, selfEnvelopeOf } from "./projections";
import { StorytellerGamePersistedSchema, MAX_PLAYER_INFO_ENTRIES_PER_PARTICIPANT } from "./schemas";
import {
  appendPlayerInfoEntry, contentOfPayload, entriesFor, infoHistoryFor, isDuplicateDelivery, newPlayerInfoEntry, planCorrectPlayerInfo,
} from "./playerInfoLog";
import { teamInformationFor } from "./teamInformation";
import { previewPrivatePacket } from "./privatePackets";
import { patchPlayer, proofGame, proofRegistry, reseat } from "@/test/proofFixtures";
import type { PlayerInfoEntry, StorytellerLobbyRecord } from "./types";

const SEVEN = ["washerwoman", "chef", "empath", "monk", "saint", "poisoner", "imp"];
const live = (over: Partial<StorytellerLobbyRecord> = {}) => proofGame(SEVEN, "night", 2, over);

/** Delivers `text` to `playerId`, the way the send command records it. */
function deliver(game: StorytellerLobbyRecord, playerId: string, text: string, id = `e-${playerId}-${game.playerInfoLog.length}`): StorytellerLobbyRecord {
  const player = game.players[playerId]!;
  const payload = { shownRole: player.shownRole!, shownAlignment: player.shownAlignment ?? undefined, extraText: text } as never;
  const entry = newPlayerInfoEntry(game, playerId, `pk-${id}`, payload, id)!;
  const packet = { id: entry.packetId, payload, forDay: game.day, forPhase: game.phase };
  const planned = appendPlayerInfoEntry(patchPlayer(game, playerId, { publishedPacket: packet } as never), entry);
  if (!planned.ok) throw new Error(planned.message);
  return planned.game;
}

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0 });
  usePrivacyStore.getState().reset();
  takeMigrationResetFlag();
});
afterEach(() => usePrivacyStore.getState().reset());

describe("the log: entries, ownership and budget", () => {
  it("records the shown content against the recipient's participation", () => {
    const game = deliver(live(), "p0", "  You saw p3 and p4  ");
    const [entry] = game.playerInfoLog as [PlayerInfoEntry];
    expect(entry.recipient).toMatchObject({ kind: "participant", playerId: "p0", participantId: game.players.p0!.participantId });
    expect(entry.moment).toEqual({ phase: "night", day: 2 });
    expect(entry.shown).toEqual({ text: "You saw p3 and p4" });
    expect(StorytellerGamePersistedSchema.safeParse(game).success).toBe(true);
  });

  it("a Setup delivery has no moment (it reads as Earlier)", () => {
    const game = deliver(proofGame(SEVEN, "night", 1, { phase: "setup", day: 0 }), "p0", "Hello");
    expect(game.playerInfoLog[0]!.moment).toBeUndefined();
  });

  it("only the same participation sees an entry: reseating, takeover or a new uid start empty", () => {
    const game = deliver(live(), "p0", "secret");
    expect(entriesFor(game, game.players.p0!)).toHaveLength(1);
    expect(entriesFor(game, reseat(game, "p0").players.p0!)).toHaveLength(0);
    expect(entriesFor(game, game.players.p1!)).toHaveLength(0);
    // Same participant, new name (rename) keeps the history.
    expect(entriesFor(game, patchPlayer(game, "p0", { name: "Renamed" }).players.p0!)).toHaveLength(1);
    // The same seat now holding someone with the same ParticipantId on a DIFFERENT playerId never matches.
    expect(entriesFor(game, { ...game.players.p0!, id: "p9" })).toHaveLength(0);
  });

  it("refuses entries beyond 100 per participant and a log over the byte budget", () => {
    let game = live();
    for (let i = 0; i < MAX_PLAYER_INFO_ENTRIES_PER_PARTICIPANT; i++) game = deliver(game, "p0", `n${i}`, `e${i}`);
    const player = game.players.p0!;
    const extra = newPlayerInfoEntry(game, "p0", "pk-x", { shownRole: player.shownRole!, extraText: "one more" } as never, "ex")!;
    expect(appendPlayerInfoEntry(game, extra).ok).toBe(false);
    const big = (i: number) => newPlayerInfoEntry(live(), "p1", `pk${i}`, { shownRole: "chef", extraText: "x".repeat(4000) } as never, `big${i}`)!;
    let heavy = live();
    let refused = false;
    for (let i = 0; i < 400 && !refused; i++) {
      const owner = `p${i % 7}`;
      const entry = { ...big(i), recipient: { ...big(i).recipient, playerId: owner, participantId: heavy.players[owner]!.participantId! } };
      const next = appendPlayerInfoEntry(heavy, entry);
      if (next.ok) heavy = next.game; else refused = true;
    }
    expect(refused).toBe(true);
  });

  it("a repeat of the same delivery at the same moment is a duplicate; new text or a new night is not", () => {
    const game = deliver(live(), "p0", "same");
    const player = game.players.p0!;
    expect(isDuplicateDelivery(game, player, { text: "same" })).toBe(true);
    expect(isDuplicateDelivery(game, player, { text: "different" })).toBe(false);
    expect(isDuplicateDelivery({ ...game, day: 3 }, player, { text: "same" })).toBe(false);
  });
});

describe("projection to the player", () => {
  it("emits only the shown content, never packet ids, recipients or earlier versions", () => {
    let game = deliver(live(), "p0", "original text");
    const entryId = game.playerInfoLog[0]!.id;
    const corrected = planCorrectPlayerInfo(game, entryId, { text: "corrected text" });
    if (!corrected.ok) throw new Error(corrected.message);
    game = corrected.game;
    const envelope = projectLobbyToSelfEnvelopeMap(game, proofRegistry)["p0"]!;
    expect(envelope.infoHistory).toEqual([{ id: entryId, moment: { phase: "night", day: 2 }, text: "corrected text" }]);
    const wire = JSON.stringify(envelope);
    expect(wire).not.toContain("original text");
    expect(wire).not.toContain("versions");
    expect(wire).not.toContain("packetId");
    expect(wire).not.toContain("participantId");
    expect(wire).not.toContain("recipient");
  });

  it("omits the key (never an empty array) when nothing was delivered, and never leaks to another occupant", () => {
    const game = deliver(live(), "p0", "only for p0");
    const map = projectLobbyToSelfEnvelopeMap(game, proofRegistry);
    expect(map.p1).toBeDefined();
    expect("infoHistory" in map.p1!).toBe(false);
    expect(JSON.stringify(map.p1)).not.toContain("only for p0");
    const replaced = reseat(game, "p0");
    const env = selfEnvelopeOf(replaced, "p0", { shownRole: replaced.players.p0!.shownRole! });
    expect("infoHistory" in env).toBe(false);
    expect(infoHistoryFor(replaced, replaced.players.p0!)).toEqual([]);
  });
});

describe("correcting delivered information", () => {
  it("silently replaces what the player sees, keeps the original privately and keeps the root packet in step", () => {
    const game = deliver(live(), "p0", "I am the original");
    const id = game.playerInfoLog[0]!.id;
    const result = planCorrectPlayerInfo(game, id, { text: "Fixed" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.game.playerInfoLog[0]!.shown).toEqual({ text: "Fixed" });
    expect(result.game.playerInfoLog[0]!.versions).toEqual([{ text: "I am the original" }]);
    expect(result.game.players.p0!.publishedPacket!.payload.extraText).toBe("Fixed");
    expect(StorytellerGamePersistedSchema.safeParse(result.game).success).toBe(true);
  });

  it("an older entry does not touch the current published packet", () => {
    let game = deliver(live(), "p0", "first");
    game = deliver(game, "p0", "second");
    const result = planCorrectPlayerInfo(game, game.playerInfoLog[0]!.id, { text: "first, fixed" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.game.players.p0!.publishedPacket!.payload.extraText).toBe("second");
  });

  it("refuses empty content, an unchanged value, an unknown entry, a replaced occupant and an ended game", () => {
    const game = deliver(live(), "p0", "text");
    const id = game.playerInfoLog[0]!.id;
    expect(planCorrectPlayerInfo(game, id, {}).ok).toBe(false);
    expect(planCorrectPlayerInfo(game, id, { text: "text" }).ok).toBe(false);
    expect(planCorrectPlayerInfo(game, "missing", { text: "x" }).ok).toBe(false);
    expect(planCorrectPlayerInfo(reseat(game, "p0"), id, { text: "x" }).ok).toBe(false);
    expect(planCorrectPlayerInfo({ ...game, phase: "ended" }, id, { text: "x" }).ok).toBe(false);
  });

  it("keeps the original and the latest versions when corrected many times", () => {
    let game = deliver(live(), "p0", "v0");
    const id = game.playerInfoLog[0]!.id;
    for (let i = 1; i <= 14; i++) {
      const next = planCorrectPlayerInfo(game, id, { text: `v${i}` });
      if (!next.ok) throw new Error(next.message);
      game = next.game;
    }
    const versions = game.playerInfoLog[0]!.versions;
    expect(versions).toHaveLength(10);
    expect(versions[0]).toEqual({ text: "v0" });
    expect(versions.at(-1)).toEqual({ text: "v13" });
    expect(game.playerInfoLog[0]!.shown).toEqual({ text: "v14" });
  });

  it("the store command clears Undo (never pushes) and refuses in Privacy Mode", () => {
    const game = deliver(live(), "p0", "text");
    store.setState({ game, undoStack: [structuredClone(game)] });
    const id = game.playerInfoLog[0]!.id;
    usePrivacyStore.getState().setEnabled(true);
    expect(store.getState().correctPlayerInfo(id, { text: "no" }).ok).toBe(false);
    usePrivacyStore.getState().setEnabled(false);
    expect(store.getState().correctPlayerInfo(id, { text: "yes" })).toEqual({ ok: true });
    expect(store.getState().undoStack).toEqual([]);
    expect(store.getState().game!.playerInfoLog[0]!.shown).toEqual({ text: "yes" });
  });
});

describe("Undo and the log", () => {
  it("never carries the log in a snapshot and never rolls delivered information back", () => {
    store.setState({ game: live({ phase: "day" }), undoStack: [] });
    store.getState().setNotes("p1", "a change that can be undone");
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().undoStack[0]!.playerInfoLog).toEqual([]);
    // Delivered information arrives after the snapshot was taken.
    store.setState({ game: deliver(store.getState().game!, "p0", "delivered after") });
    store.getState().undo();
    expect(store.getState().game!.playerInfoLog).toHaveLength(1);
    expect(store.getState().game!.playerInfoLog[0]!.shown).toEqual({ text: "delivered after" });
  });
});

describe("migration v28 -> v29", () => {
  const v28 = (game: StorytellerLobbyRecord): Record<string, unknown> => {
    const raw = structuredClone(game) as unknown as Record<string, unknown>;
    delete raw.playerInfoLog;
    raw.gameSchemaVersion = 28;
    return raw;
  };
  const packetFor = (game: StorytellerLobbyRecord, playerId: string, payload: Record<string, unknown>, extra = {}) =>
    patchPlayer(game, playerId, { publishedPacket: { id: `pk-${playerId}`, payload, forDay: 2, forPhase: "night", ...extra } } as never);

  it("backfills one entry from the latest published packet that matches what the participant sees", () => {
    const base = live();
    const shown = base.players.p0!;
    const game = packetFor(base, "p0", { shownRole: shown.shownRole, shownAlignment: shown.shownAlignment, extraText: "You learned 2" });
    const raw = v28(game);
    expect(detectLegacyGameVersion(raw)).toBe(28);
    migrateGameEntry(raw, 28, { kind: "canonical-only" });
    const migrated = StorytellerGamePersistedSchema.parse(raw);
    expect(migrated.gameSchemaVersion).toBe(29);
    expect(migrated.playerInfoLog).toHaveLength(1);
    expect(migrated.playerInfoLog[0]).toMatchObject({
      id: "migrated-pk-p0", packetId: "pk-p0", moment: { phase: "night", day: 2 }, shown: { text: "You learned 2" }, versions: [],
      recipient: { participantId: shown.participantId, playerId: "p0" },
    });
  });

  it("invents nothing: identity-only packets, mismatching roles and seats without a participant add no entry", () => {
    let game = packetFor(live(), "p0", { shownRole: live().players.p0!.shownRole });
    game = packetFor(game, "p1", { shownRole: "chef", extraText: "role differs", shownAlignment: "evil" });
    game = packetFor(game, "p2", { shownRole: "wrong-role", extraText: "role differs" });
    const raw = v28(game);
    migrateGameEntry(raw, 28, { kind: "canonical-only" });
    expect(StorytellerGamePersistedSchema.parse(raw).playerInfoLog).toEqual([]);
  });

  it("an absent phase leaves the entry without a moment; Undo snapshots get an empty log", () => {
    const base = live();
    const game = packetFor(base, "p0", { shownRole: base.players.p0!.shownRole, shownAlignment: base.players.p0!.shownAlignment, extraText: "x" }, { forPhase: undefined, forDay: undefined });
    const state = { game: v28(game), undoStack: [v28(game)], customScripts: {} };
    const migrated = migrateStoreState(state, 28) as { game: StorytellerLobbyRecord; undoStack: StorytellerLobbyRecord[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(migrated.game.playerInfoLog).toHaveLength(1);
    expect(migrated.game.playerInfoLog[0]!.moment).toBeUndefined();
    expect(migrated.undoStack[0]!.playerInfoLog).toEqual([]);
    expect(migrated.game.gameSchemaVersion).toBe(29);
    expect(migrated.undoStack[0]!.gameSchemaVersion).toBe(29);
  });

  it("is not stamped over malformed prepared information, and a v29 marker with no log stays rejected", () => {
    const raw = v28(live());
    raw.preparedInformation = [{ nope: true }];
    migrateGameEntry(raw, 28, { kind: "canonical-only" });
    expect(raw.gameSchemaVersion).toBe(28);
    expect(StorytellerGamePersistedSchema.safeParse(raw).success).toBe(false);
    const missing = v28(live());
    missing.gameSchemaVersion = 29;
    migrateGameEntry(missing, 28, { kind: "canonical-only" });
    expect(missing.playerInfoLog).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(missing).success).toBe(false);
  });

  it("a log under an older marker is malformed current data and is not repaired", () => {
    const raw = v28(live());
    raw.gameSchemaVersion = 27;
    delete raw.preparedInformation;
    raw.playerInfoLog = [];
    migrateGameEntry(raw, 27, { kind: "canonical-only" });
    expect(raw.gameSchemaVersion).toBe(27);
  });

  it("migrates the finished-game recovery envelope the same way", () => {
    const base = live();
    const ended = { ...base, phase: "ended" as const };
    const state = { game: v28(ended), undoStack: [], finishedGameUndo: { ended: v28(ended), live: v28(base), undoStack: [v28(base)] }, customScripts: {} };
    const migrated = migrateStoreState(state, 28) as { finishedGameUndo: { ended: StorytellerLobbyRecord; live: StorytellerLobbyRecord; undoStack: StorytellerLobbyRecord[] } };
    expect(takeMigrationResetFlag()).toBe(false);
    for (const g of [migrated.finishedGameUndo.ended, migrated.finishedGameUndo.live, ...migrated.finishedGameUndo.undoStack]) {
      expect(g.gameSchemaVersion).toBe(29);
      expect(g.playerInfoLog).toEqual([]);
    }
  });
});

describe("the evil team (teamInformationFor)", () => {
  const seven = (roles: string[], over: Partial<StorytellerLobbyRecord> = {}) => proofGame(roles, "night", 1, { ...over, phase: "setup", day: 0 });

  it("tells a Minion the Demon and the other Minions; tells the Demon every Minion; never a character", () => {
    const game = seven(["washerwoman", "chef", "empath", "monk", "saint", "poisoner", "imp"]);
    const minion = teamInformationFor(game, proofRegistry, "p5");
    expect(minion).toEqual({ ok: true, demon: { id: "p6", name: "Player 6", seat: 6 } });
    const demon = teamInformationFor(game, proofRegistry, "p6");
    expect(demon).toEqual({ ok: true, minions: [{ id: "p5", name: "Player 5", seat: 5 }] });
    const two = seven(["washerwoman", "chef", "empath", "monk", "scarletwoman", "poisoner", "imp"]);
    expect(teamInformationFor(two, proofRegistry, "p5")).toEqual({
      ok: true, demon: { id: "p6", name: "Player 6", seat: 6 }, minions: [{ id: "p4", name: "Player 4", seat: 4 }],
    });
    expect(JSON.stringify([minion, demon])).not.toMatch(/poisoner|imp"|scarletwoman/);
  });

  it("fails closed: a living Magician, two Demons, a missing Demon, few players, a Traveller or a good recipient", () => {
    const base = ["washerwoman", "chef", "empath", "monk", "saint", "poisoner", "imp"];
    expect(teamInformationFor(seven([...base.slice(0, 4), "magician", "poisoner", "imp"]), proofRegistry, "p5").ok).toBe(false);
    expect(teamInformationFor(seven([...base.slice(0, 5), "imp", "imp"]), proofRegistry, "p5").ok).toBe(false);
    expect(teamInformationFor(seven([...base.slice(0, 5), "poisoner", "baron"]), proofRegistry, "p5").ok).toBe(false);
    expect(teamInformationFor(seven(base.slice(0, 6)), proofRegistry, "p5").ok).toBe(false);
    expect(teamInformationFor(seven(base), proofRegistry, "p0").ok).toBe(false);
    expect(teamInformationFor(seven(base), proofRegistry, "nobody").ok).toBe(false);
    const traveller = patchPlayer(seven(base), "p5", { isTraveler: true });
    expect(teamInformationFor(traveller, proofRegistry, "p5").ok).toBe(false);
    const deceived = patchPlayer(seven(base), "p5", { behaviorMode: "drunk_fake_role_behavior" } as never);
    expect(teamInformationFor(deceived, proofRegistry, "p5").ok).toBe(false);
  });

  it("the packet preview carries the team only when the draft asks for it", () => {
    const game = patchPlayer(seven(["washerwoman", "chef", "empath", "monk", "saint", "poisoner", "imp"]), "p5", { privateInfo: { team: true } } as never);
    const preview = previewPrivatePacket(game.players.p5!, game, proofRegistry);
    expect(preview.payload).toMatchObject({ shownRole: "poisoner", demon: { id: "p6" } });
    expect(contentOfPayload(preview.payload)).toEqual({ demon: { id: "p6", name: "Player 6", seat: 6 } });
    const refused = patchPlayer(game, "p0", { privateInfo: { team: true } } as never);
    expect(() => previewPrivatePacket(refused.players.p0!, refused, proofRegistry)).toThrow();
  });
});

describe("the player's decoder", () => {
  const base = { shownRole: "chef", shownAlignment: "good" as const };
  it("keeps good entries, drops bad ones and says so, and never invalidates the identity", () => {
    const decoded = decodeSelfSnapshot({
      ...base,
      infoHistory: [
        { id: "a", moment: { phase: "night", day: 1 }, text: "fine" },
        { id: "b", text: "" },
        { id: "c", text: "x", unknown: 1 },
        { id: "d", demon: { id: "p1", name: "Una", seat: 1 } },
        { id: "a", text: "duplicate id" },
      ],
    });
    expect(decoded.status).toBe("ready");
    if (decoded.status !== "ready") return;
    expect(decoded.data.infoHistory?.map((e) => e.id)).toEqual(["a", "d"]);
    expect(decoded.data.infoHistoryPartial).toBe(true);
    expect(decoded.data.shownRole).toBe("chef");
  });
  it("no key means no history and no warning; an all-bad history shows only the warning", () => {
    const none = decodeSelfSnapshot(base);
    expect(none.status === "ready" && "infoHistory" in none.data).toBe(false);
    const bad = decodeSelfSnapshot({ ...base, infoHistory: [{ nope: 1 }] });
    expect(bad.status === "ready" && bad.data.infoHistory).toBeFalsy();
    expect(bad.status === "ready" && bad.data.infoHistoryPartial).toBe(true);
  });
  it("accepts the object form Firebase returns for a sparse list", () => {
    const decoded = decodeSelfSnapshot({ ...base, infoHistory: { "0": { id: "a", text: "one" }, "2": { id: "b", text: "two" } } });
    expect(decoded.status === "ready" && decoded.data.infoHistory?.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
