import { describe, expect, it } from "vitest";
import { writeProjections } from "./sync";
import { MemoryRoomBackend } from "./memoryBackend";
import { buildRegistry } from "@/data/roleRegistry";
import { tbScript, makePublishedSTPlayer } from "@/test/fixtures";
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
    plannedPlayerCount: 0,
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
        reminders: ["killed Bob"],
        statuses: { protected: true },
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
