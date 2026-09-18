import { describe, expect, it } from "vitest";
import { writeProjections } from "./sync";
import { MemoryRoomBackend } from "./memoryBackend";
import { buildRegistry } from "@/data/roleRegistry";
import { tbScript, makePublishedSTPlayer } from "@/test/fixtures";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";
import type { StorytellerLobbyRecord } from "@/stores/types";

// `public/` is the town view: NO role data of any kind, ever.
const FORBIDDEN_ON_PUBLIC = [
  "actualRole",
  "shownRole",
  "shownAlignment",
  "behaviorMode",
  "privateInfo",
  "stNotes",
  "abilityUsed",
  "statuses",
  "reminders",
  "bluffs",
  "fakeMinions",
  "actualAlignment",
  "effects",
] as const;

// `player/{id}/` is one player's self-view: shownRole/shownAlignment/bluffs
// are EXPECTED here (that's the projection's purpose). The forbidden set is
// the ST-only fields that must never reach a player device.
const FORBIDDEN_ON_PLAYER = [
  "actualRole",
  "behaviorMode",
  "privateInfo",
  "stNotes",
  "abilityUsed",
  "statuses",
  "reminders",
  "actualAlignment",
  "effects",
] as const;

const registry = buildRegistry(tbScript);

function makeLobby(): StorytellerLobbyRecord {
  return {
    code: "ABCD",
    storytellerUid: "uid-st",
    scriptId: "tb",
    phase: "night",
    day: 1,
    bluffs: ["chef", "washerwoman", "saint"],
    fabled: [],
    lorics: [],
    notes: "ST private notes — never publish",
    seatOrder: ["p1", "p2", "p3"],
    nightProgress: {},
    rolePool: [],
    history: [], informationDeliveries: [],
    plannedPlayerCount: 0,
    plannedTravelerCount: 0,
    pendingPlayers: {},
    players: {
      p1: makePublishedSTPlayer({
        id: "p1",
        name: "Alice",
        seat: 0,
        actualRole: "imp",
        shownRole: "imp",
        privateInfo: { bluffs: ["chef", "washerwoman", "saint"] },
        stNotes: "Imp; bluffs assigned night 1",
        reminders: [{ id: "r1", label: "killed Bob", lifetime: { kind: "manual" } }],
        statuses: { protected: true },
        actualAlignment: "evil",
        effects: [{ id: "manual:protected", type: "protected", lifetime: { kind: "manual" } }],
      }),
      p2: makePublishedSTPlayer({
        id: "p2",
        name: "Bob",
        seat: 1,
        actualRole: "lunatic",
        shownRole: "imp",
        shownAlignment: null,
        behaviorMode: "fake_demon_behavior",
        privateInfo: {
          bluffs: ["poisoner", "baron", "scarletwoman"],
          fakeMinions: ["p3"],
        },
        stNotes: "Lunatic — pretend they are demon",
      }),
      p3: makePublishedSTPlayer({
        id: "p3",
        name: "Cara",
        seat: 2,
        actualRole: "drunk",
        shownRole: "chef",
        shownAlignment: null,
        behaviorMode: "drunk_fake_role_behavior",
      }),
    },
  };
}

describe("writeProjections — privacy chokepoint", () => {
  it("writes public/, player/{id}/ for each player, and storyteller/", async () => {
    const backend = new MemoryRoomBackend();
    await writeProjections({
      backend,
      code: "ABCD",
      stState: makeLobby(),
      registry,
      online: { p1: true, p2: true, p3: false },
    });

    const pub = await backend.get("lobbies/ABCD/public");
    const p1 = await backend.get("lobbies/ABCD/player/p1");
    const p2 = await backend.get("lobbies/ABCD/player/p2");
    const p3 = await backend.get("lobbies/ABCD/player/p3");
    const st = await backend.get("lobbies/ABCD/storyteller");

    expect(pub).toBeDefined();
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(p3).toBeDefined();
    expect(st).toBeDefined();
  });

  it("public path never contains any forbidden private field", async () => {
    const backend = new MemoryRoomBackend();
    await writeProjections({
      backend,
      code: "ABCD",
      stState: makeLobby(),
      registry,
      online: { p1: true, p2: true, p3: false },
    });
    const pubJson = JSON.stringify(await backend.get("lobbies/ABCD/public"));
    for (const key of FORBIDDEN_ON_PUBLIC) {
      expect(pubJson, `public contained "${key}"`).not.toContain(`"${key}"`);
    }
    // Also verify by role-id strings (the actual data)
    expect(pubJson).not.toContain("imp");
    expect(pubJson).not.toContain("lunatic");
    expect(pubJson).not.toContain("drunk");
    expect(pubJson).not.toContain("ST private notes");
  });

  it("player/{id}/ contains ONLY the self projection, never another player's role", async () => {
    const backend = new MemoryRoomBackend();
    await writeProjections({
      backend,
      code: "ABCD",
      stState: makeLobby(),
      registry,
      online: { p1: true, p2: true, p3: false },
    });

    const p1 = (await backend.get("lobbies/ABCD/player/p1")) as Record<string, unknown>;
    const p2 = (await backend.get("lobbies/ABCD/player/p2")) as Record<string, unknown>;
    const p3 = (await backend.get("lobbies/ABCD/player/p3")) as Record<string, unknown>;

    // p1 (Imp) sees imp + real bluffs
    expect(p1.shownRole).toBe("imp");
    expect(p1.shownAlignment).toBe("evil");
    expect(p1.bluffs).toEqual(["chef", "washerwoman", "saint"]);
    // never the actualRole leaked into the self projection
    expect(JSON.stringify(p1)).not.toContain("actualRole");

    // p2 (Lunatic) sees imp + FAKE bluffs, never the real demon's bluffs
    expect(p2.shownRole).toBe("imp");
    expect(p2.shownAlignment).toBe("evil");
    expect(p2.bluffs).toEqual(["poisoner", "baron", "scarletwoman"]);
    // CRITICAL: lunatic's payload must not contain the string "lunatic"
    expect(JSON.stringify(p2)).not.toContain("lunatic");
    // CRITICAL: lunatic must not see the real demon's bluffs
    expect(JSON.stringify(p2)).not.toContain("washerwoman");

    // p3 (Drunk) sees chef
    expect(p3.shownRole).toBe("chef");
    expect(p3.shownAlignment).toBe("good");
    expect(JSON.stringify(p3)).not.toContain("drunk");
  });

  it("every write logged by the backend to `public/` or `player/` is privacy-clean", async () => {
    const backend = new MemoryRoomBackend();
    await writeProjections({
      backend,
      code: "ABCD",
      stState: makeLobby(),
      registry,
      online: {},
    });

    for (const entry of backend.writeLog) {
      const json = JSON.stringify(entry.value);
      const forbidden = entry.path.startsWith("lobbies/ABCD/public")
        ? FORBIDDEN_ON_PUBLIC
        : entry.path.startsWith("lobbies/ABCD/player/")
          ? FORBIDDEN_ON_PLAYER
          : null;
      if (!forbidden) continue;
      for (const key of forbidden) {
        expect(
          json,
          `path ${entry.path} contained forbidden "${key}"`
        ).not.toContain(`"${key}"`);
      }
    }
  });

  it("writes go through ONE update call (atomic from the player's view)", async () => {
    const backend = new MemoryRoomBackend();
    await writeProjections({
      backend,
      code: "ABCD",
      stState: makeLobby(),
      registry,
      online: {},
    });

    // The MemoryBackend's writeLog appends one entry per path inside an
    // update. They all share the same atomic batch — assert path coverage.
    const paths = backend.writeLog.map((w) => w.path);
    expect(paths).toContain("lobbies/ABCD/public");
    expect(paths).toContain("lobbies/ABCD/player/p1");
    expect(paths).toContain("lobbies/ABCD/player/p2");
    expect(paths).toContain("lobbies/ABCD/player/p3");
    expect(paths).toContain("lobbies/ABCD/storyteller");
  });

  it("unassigned players (no actualRole) are skipped — no projection written", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    // Add an unassigned player
    lobby.seatOrder = [...lobby.seatOrder, "p4"];
    lobby.players.p4 = makePublishedSTPlayer({
      id: "p4",
      name: "Dani",
      seat: 3,
      actualRole: "",
      shownRole: null,
    });
    // Should NOT throw despite the empty actualRole
    await writeProjections({
      backend,
      code: "ABCD",
      stState: lobby,
      registry,
      online: {},
    });
    // p1/p2/p3 have projections
    expect(await backend.get("lobbies/ABCD/player/p1")).toBeDefined();
    expect(await backend.get("lobbies/ABCD/player/p2")).toBeDefined();
    expect(await backend.get("lobbies/ABCD/player/p3")).toBeDefined();
    // p4 (unassigned) is explicitly null (cleanup path)
    expect(await backend.get("lobbies/ABCD/player/p4")).toBeUndefined();
  });

  it("clearing a role wipes the stale per-player projection", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    await writeProjections({
      backend,
      code: "ABCD",
      stState: lobby,
      registry,
      online: {},
    });
    // p1 (Imp) was written
    expect(await backend.get("lobbies/ABCD/player/p1")).toBeDefined();
    // ST withdraws perception while keeping actual identity private.
    lobby.players.p1!.shownRole = null;
    delete lobby.players.p1!.privateInfo;
    await writeProjections({
      backend,
      code: "ABCD",
      stState: lobby,
      registry,
      online: {},
    });
    // p1's projection is now removed
    expect(await backend.get("lobbies/ABCD/player/p1")).toBeUndefined();
    expect(await backend.get("lobbies/ABCD/storyteller/players/p1/actualRole")).toBe("imp");
  });

  it("a Lunatic with an unpublished draft gets identity but no private information", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    // A configured draft is not publication.
    delete lobby.players.p2!.publishedPacket;
    await writeProjections({
      backend,
      code: "ABCD",
      stState: lobby,
      registry,
      online: {},
    });

    const p2 = (await backend.get("lobbies/ABCD/player/p2")) as Record<string, unknown>;
    expect(p2.shownRole).toBe("imp");
    expect(p2.shownAlignment).toBe("evil");
    expect(p2.bluffs).toBeUndefined();
    expect(p2.fakeMinions).toBeUndefined();
  });

  it("two-bluff scenario: Demon and Lunatic bluffs are fully isolated from each other and public", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    // Demon bluffs (A, B, C) already set on p1. Lunatic bluffs (X, Y, Z) on p2.
    // Confirm the fixture is correct first.
    const demonBluffs = ["chef", "washerwoman", "saint"];
    const lunaticBluffs = ["poisoner", "baron", "scarletwoman"];

    await writeProjections({
      backend,
      code: "ABCD",
      stState: lobby,
      registry,
      online: { p1: true, p2: true, p3: true },
    });

    const p1 = (await backend.get("lobbies/ABCD/player/p1")) as Record<string, unknown>;
    const p2 = (await backend.get("lobbies/ABCD/player/p2")) as Record<string, unknown>;
    const p3 = (await backend.get("lobbies/ABCD/player/p3")) as Record<string, unknown>;
    const pubJson = JSON.stringify(await backend.get("lobbies/ABCD/public"));

    // Demon sees their own bluffs only.
    expect(p1.bluffs).toEqual(demonBluffs);
    for (const b of lunaticBluffs) {
      expect(JSON.stringify(p1), `demon payload contained lunatic bluff "${b}"`).not.toContain(`"${b}"`);
    }

    // Lunatic sees their own bluffs only.
    expect(p2.bluffs).toEqual(lunaticBluffs);
    for (const b of demonBluffs) {
      // "saint" is in both demo data sets — skip for the one that overlaps.
      if (lunaticBluffs.includes(b)) continue;
      expect(JSON.stringify(p2), `lunatic payload contained demon bluff "${b}"`).not.toContain(`"${b}"`);
    }

    // p3 (not a bluff holder) has no bluffs.
    expect(p3.bluffs).toBeUndefined();

    // Public path contains no bluff ids at all.
    expect(pubJson).not.toContain('"bluffs"');
    for (const b of [...demonBluffs, ...lunaticBluffs]) {
      // Some role ids also appear as player names in fixture; check key form.
      expect(pubJson, `public contained bluff role id "${b}"`).not.toContain(`"bluffs"`);
    }
  });

  it("unsubscribe stops callbacks — no listener leak after lobby code changes", async () => {
    const backend = new MemoryRoomBackend();
    let fires = 0;
    const unsub = backend.subscribe("lobbies/OLD/public", () => fires++);
    unsub(); // simulates React effect cleanup when lobby.code changes
    await backend.set("lobbies/OLD/public", { phase: "day" } as never);
    expect(fires).toBe(1); // only the immediate subscribe fire; nothing after unsub
  });

  it("explicit shownAlignment override projects through the chokepoint", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    // ScarletWoman (minion → evil by default) but ST has overridden shownAlignment to good
    lobby.players.p3 = makePublishedSTPlayer({
      id: "p3",
      name: "Cara",
      seat: 2,
      actualRole: "scarletwoman",
      shownRole: "scarletwoman",
      shownAlignment: "good",
      behaviorMode: "normal",
    });
    await writeProjections({
      backend,
      code: "ABCD",
      stState: lobby,
      registry,
      online: {},
    });
    const p3 = (await backend.get("lobbies/ABCD/player/p3")) as Record<string, unknown>;
    expect(p3.shownRole).toBe("scarletwoman");
    // Override is honored — minion would default to evil
    expect(p3.shownAlignment).toBe("good");
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.4 (OPUS-004) — the setup all-or-none barrier flushes atomically
// through this same chokepoint. writeProjections gains no setup-specific
// policy of its own: it just keeps nulling any player path the (barrier-
// aware) self map withdraws, exactly as the pre-existing withdrawal loop
// already does for an ordinary shownRole clear.
// ---------------------------------------------------------------------------

describe("writeProjections — Phase 9C.4 setup barrier atomicity", () => {
  function setupLobby(p2ShownRole: string | null, revealed = false): StorytellerLobbyRecord {
    return {
      code: "SETP", storytellerUid: "uid-st", scriptId: "tb", phase: "setup", day: 0,
      bluffs: [], fabled: [], lorics: [], notes: "", setupRolesRevealed: revealed,
      seatOrder: ["p1", "p2", "t1"], nightProgress: {}, rolePool: [], history: [], informationDeliveries: [],
      plannedPlayerCount: 2, plannedTravelerCount: 0, pendingPlayers: {},
      players: {
        p1: makePublishedSTPlayer({ id: "p1", seat: 0, actualRole: "chef", shownRole: "chef" }),
        p2: makePublishedSTPlayer({ id: "p2", seat: 1, actualRole: "drunk",
          shownRole: p2ShownRole, shownAlignment: p2ShownRole ? "good" : null,
          behaviorMode: p2ShownRole ? "normal" : "normal" }),
        t1: makePublishedSTPlayer({ id: "t1", seat: 2, isTraveler: true, actualRole: "thief", shownRole: "thief" }),
      },
    };
  }
  function spyOnUpdate(backend: MemoryRoomBackend) {
    const calls: Record<string, unknown>[] = [];
    const raw = backend.update.bind(backend);
    backend.update = async (updates) => { calls.push(updates); await raw(updates); };
    return calls;
  }

  it("a barred setup flush is one update: every ordinary path null/absent, Traveler/public/storyteller/checkpoint still land", async () => {
    const backend = new MemoryRoomBackend();
    // Pre-seed p1's path to prove the barrier actively withdraws it, not merely omits a new write.
    await backend.set("lobbies/SETP/player/p1", { shownRole: "chef", shownAlignment: "good" });
    const calls = spyOnUpdate(backend);

    // p2 (Drunk) has no configured shown identity — the ordinary set is
    // incomplete, so p1's otherwise-complete record must be withheld too.
    await writeProjections({ backend, code: "SETP", stState: setupLobby(null), registry, online: {} });

    expect(calls).toHaveLength(1);
    const update = calls[0]!;
    expect(update["lobbies/SETP/player/p1"]).toBeNull();
    expect(update["lobbies/SETP/player/p2"]).toBeNull();
    expect(update["lobbies/SETP/player/t1"]).toEqual({ shownRole: "thief" });
    expect(update["lobbies/SETP/public"]).toBeDefined();
    expect(update["lobbies/SETP/storyteller"]).toBeDefined();
    expect(update["lobbies/SETP/checkpoint"]).toBeDefined();

    expect(await backend.get("lobbies/SETP/player/p1")).toBeUndefined();
    expect(await backend.get("lobbies/SETP/player/p2")).toBeUndefined();
    expect(await backend.get("lobbies/SETP/player/t1")).toBeDefined();
  });

  it("a complete-but-not-yet-revealed ordinary set still withholds every ordinary path (Deal does not imply Reveal)", async () => {
    const backend = new MemoryRoomBackend();
    const calls = spyOnUpdate(backend);

    // p2 has a configured shown identity -- the ordinary set is complete --
    // but the Storyteller has not pressed Reveal Roles yet.
    await writeProjections({ backend, code: "SETP", stState: setupLobby("washerwoman", false), registry, online: {} });

    expect(calls).toHaveLength(1);
    const update = calls[0]!;
    expect(update["lobbies/SETP/player/p1"]).toBeNull();
    expect(update["lobbies/SETP/player/p2"]).toBeNull();
    expect(update["lobbies/SETP/player/t1"]).toEqual({ shownRole: "thief" });

    expect(await backend.get("lobbies/SETP/player/p1")).toBeUndefined();
    expect(await backend.get("lobbies/SETP/player/p2")).toBeUndefined();
  });

  it("the completing, explicitly revealed flush publishes every ordinary self record together in one update", async () => {
    const backend = new MemoryRoomBackend();
    const calls = spyOnUpdate(backend);

    // p2 now has a configured (different, concealed) shown identity, the
    // ordinary set is complete, and the Storyteller has explicitly revealed.
    await writeProjections({ backend, code: "SETP", stState: setupLobby("washerwoman", true), registry, online: {} });

    expect(calls).toHaveLength(1);
    const update = calls[0]!;
    expect(update["lobbies/SETP/player/p1"]).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(update["lobbies/SETP/player/p2"]).toEqual({ shownRole: "washerwoman", shownAlignment: "good" });
    expect(update["lobbies/SETP/player/t1"]).toEqual({ shownRole: "thief" });

    expect(await backend.get("lobbies/SETP/player/p1")).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(await backend.get("lobbies/SETP/player/p2")).toEqual({ shownRole: "washerwoman", shownAlignment: "good" });
  });
});

describe("Phase 9D.1: live-state persistence/recovery round trip", () => {
  it("actualAlignment, effects, and reminders survive the checkpoint round trip with no projection/privacy regression", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    lobby.players.p1 = {
      ...lobby.players.p1!,
      actualAlignment: "evil",
      effects: [
        { id: "manual:protected", type: "protected", lifetime: { kind: "manual" } },
        { id: "poisoner-1", type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: "p2", lifetime: { kind: "untilDawn" } },
      ],
      reminders: [
        { id: "r1", label: "Killed Bob", sourceCharacter: "imp", createdAt: { phase: "night", day: 1 }, lifetime: { kind: "manual" } },
      ],
    };

    await writeProjections({ backend, code: "ABCD", stState: lobby, registry, online: {} });

    // The checkpoint is the authoritative game snapshot used for
    // reconnect/restore -- it must carry the richer live state whole,
    // exactly as the existing checkpoint mechanism already does for every
    // other STPlayerRecord field.
    const rawCheckpoint = (await backend.get("lobbies/ABCD/checkpoint")) as string;
    const decoded = JSON.parse(rawCheckpoint) as { game: unknown };
    const parsed = StorytellerGamePersistedSchema.parse(decoded.game);
    const restoredP1 = parsed.players.p1!;
    expect(restoredP1.actualAlignment).toBe("evil");
    expect(restoredP1.effects).toEqual(lobby.players.p1.effects);
    expect(restoredP1.reminders).toEqual(lobby.players.p1.reminders);

    // No projection/privacy regression: none of it reached public or self.
    const pub = JSON.stringify(await backend.get("lobbies/ABCD/public"));
    const self = JSON.stringify(await backend.get("lobbies/ABCD/player/p1"));
    for (const leak of ["actualAlignment", "effects", "reminders", "Killed Bob", "poisoner-1"]) {
      expect(pub).not.toContain(leak);
      expect(self).not.toContain(leak);
    }
  });
});

describe("Phase 9D.2: live-game history persistence/recovery round trip", () => {
  it("multiple history categories survive the checkpoint round trip together, with no projection/privacy regression", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    lobby.history = [
      {
        id: "h1", category: "identity", playerId: "p1", moment: { phase: "night", day: 1 },
        change: { kind: "value", from: { actualRole: "chef" }, to: { actualRole: "imp" } },
      },
      {
        id: "h2", category: "alignment", playerId: "p1", moment: { phase: "night", day: 1 },
        change: { kind: "value", from: { actualAlignment: "good" }, to: { actualAlignment: "evil" } },
      },
      {
        id: "h3", category: "life", playerId: "p2", moment: { phase: "day", day: 1 },
        change: { kind: "value", from: { alive: true }, to: { alive: false } },
      },
      {
        id: "h4", category: "effect", playerId: "p1", moment: { phase: "night", day: 1 },
        change: { kind: "added", item: { id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" } } },
        provenance: { sourceCharacter: "poisoner" },
      },
      {
        id: "h5", category: "reminder", playerId: "p1", moment: { phase: "night", day: 1 },
        change: { kind: "removed", item: { id: "r1", label: "Old note", lifetime: { kind: "manual" } } },
      },
    ];

    await writeProjections({ backend, code: "ABCD", stState: lobby, registry, online: {} });

    const rawCheckpoint = (await backend.get("lobbies/ABCD/checkpoint")) as string;
    const decoded = JSON.parse(rawCheckpoint) as { game: unknown };
    const parsed = StorytellerGamePersistedSchema.parse(decoded.game);
    expect(parsed.history).toEqual(lobby.history);

    // No projection/privacy regression: history never reached public or self.
    const pub = JSON.stringify(await backend.get("lobbies/ABCD/public"));
    const self = JSON.stringify(await backend.get("lobbies/ABCD/player/p1"));
    for (const leak of ["history", "h1", "h2", "h3", "h4", "h5", "Old note"]) {
      expect(pub).not.toContain(leak);
      expect(self).not.toContain(leak);
    }
  });
});

describe("Phase 9D.3: Information Delivery persistence/recovery round trip", () => {
  it("Information Delivery Records for different Information Requirement shapes survive the checkpoint round trip together, with no projection/privacy regression", async () => {
    const backend = new MemoryRoomBackend();
    const lobby = makeLobby();
    lobby.informationDeliveries = [
      {
        // Number only (Chef).
        id: "d1", recipientPlayerId: "p1", actualRole: "chef", informationActionId: "chef-first-night",
        moment: { phase: "night", day: 1 },
        values: [{ requirementId: "pairs", kind: "number", value: 1 }],
      },
      {
        // Players + Role (Washerwoman).
        id: "d2", recipientPlayerId: "p2", actualRole: "washerwoman", informationActionId: "washerwoman-first-night",
        moment: { phase: "night", day: 1 },
        values: [
          { requirementId: "players", kind: "player", playerIds: ["p1", "p3"] },
          { requirementId: "role", kind: "role", roleId: "chef" },
        ],
        provenance: { reason: "manually confirmed" },
        note: "double-checked with the player",
      },
      {
        // Players + Boolean (Fortune Teller).
        id: "d3", recipientPlayerId: "p3", actualRole: "fortuneteller", informationActionId: "fortuneteller-first-night",
        moment: { phase: "night", day: 1 },
        values: [
          { requirementId: "players", kind: "player", playerIds: ["p1", "p2"] },
          { requirementId: "isDemon", kind: "boolean", value: false },
        ],
      },
    ];

    await writeProjections({ backend, code: "ABCD", stState: lobby, registry, online: {} });

    const rawCheckpoint = (await backend.get("lobbies/ABCD/checkpoint")) as string;
    const decoded = JSON.parse(rawCheckpoint) as { game: unknown };
    const parsed = StorytellerGamePersistedSchema.parse(decoded.game);
    expect(parsed.informationDeliveries).toEqual(lobby.informationDeliveries);

    // No projection/privacy regression: never reached public or self.
    const pub = JSON.stringify(await backend.get("lobbies/ABCD/public"));
    const self = JSON.stringify(await backend.get("lobbies/ABCD/player/p1"));
    for (const leak of ["informationDeliveries", "d1", "d2", "d3", "double-checked", "manually confirmed"]) {
      expect(pub).not.toContain(leak);
      expect(self).not.toContain(leak);
    }
  });
});
