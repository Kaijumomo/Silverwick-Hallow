import { describe, expect, it } from "vitest";
import {
  checkLobbyStatus,
  cancelJoinRequest,
  classifyRoster,
  createLobby,
  endLobby,
  generateCode,
  knockOnLobby,
  readOwnRosterEntry,
  seatPlayer,
  watchLobbyStatus,
  watchRoster,
  watchJoinRequests,
} from "./lobby";
import { MemoryRoomBackend } from "./memoryBackend";

describe("generateCode", () => {
  it("produces an 8-char string from the safe alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const c = generateCode();
      expect(c).toHaveLength(8);
      expect(/^[BCDFGHJKLMNPQRSTVWXYZ23456789]+$/.test(c)).toBe(true);
    }
  });

  it("is configurable in length", () => {
    expect(generateCode(6)).toHaveLength(6);
  });
});

describe("createLobby", () => {
  it("claims a lobby code transactionally", async () => {
    const b = new MemoryRoomBackend();
    const r = await createLobby(b, "uid-st", { codeGenerator: () => "ABCD" });
    expect(r.code).toBe("ABCD");
    expect(await b.get("lobbies/ABCD/storytellerUid")).toBe("uid-st");
  });

  it("retries with a new code when a collision occurs", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/AAAA/storytellerUid", "someone-else");
    const seq = ["AAAA", "BBBB"];
    let i = 0;
    const r = await createLobby(b, "uid-st", { codeGenerator: () => seq[i++]! });
    expect(r.code).toBe("BBBB");
  });

  it("gives up after MAX_CREATE_ATTEMPTS collisions", async () => {
    const b = new MemoryRoomBackend();
    // Pre-seed many collisions
    for (let i = 0; i < 30; i++) {
      await b.set(`lobbies/X${i}/storytellerUid`, "occupied");
    }
    let i = 0;
    await expect(
      createLobby(b, "uid-st", { codeGenerator: () => `X${i++}` })
    ).rejects.toThrow(/Could not allocate/);
  });
});

describe("knockOnLobby — phase 1 of player join", () => {
  it("writes the requested name only into joinRequests/{uid}", async () => {
    const b = new MemoryRoomBackend();
    await knockOnLobby(b, "ABCD", "uid-bob", "Bob");
    expect(await b.get("lobbies/ABCD/joinRequests/uid-bob")).toBe("Bob");
    expect(await b.get("lobbies/ABCD/roster/uid-bob")).toBeUndefined();
  });

  it("trims whitespace", async () => {
    const b = new MemoryRoomBackend();
    await knockOnLobby(b, "ABCD", "uid", "  Bob  ");
    expect(await b.get("lobbies/ABCD/joinRequests/uid")).toBe("Bob");
  });

  it("rejects an empty name", async () => {
    const b = new MemoryRoomBackend();
    await expect(knockOnLobby(b, "ABCD", "uid", "  ")).rejects.toThrow(
      /Name is required/
    );
  });

  it("does NOT overwrite a pre-existing seated playerId (refresh-safe)", async () => {
    const b = new MemoryRoomBackend();
    // Simulate ST has already seated this uid
    await b.set("lobbies/ABCD/roster/uid-bob", "p-12345");
    // Player refreshes and re-knocks
    await knockOnLobby(b, "ABCD", "uid-bob", "Bob");
    // The binding stays intact
    expect(await b.get("lobbies/ABCD/roster/uid-bob")).toBe("p-12345");
    expect(await b.get("lobbies/ABCD/joinRequests/uid-bob")).toBeUndefined();
  });
});

describe("seatPlayer — phase 2 atomic seating", () => {
  it("writes player/{id} and rebinds roster/{uid} in ONE update", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD/joinRequests/uid-bob", "Bob");
    await seatPlayer(b, "ABCD", "uid-bob", "p-1", {
      shownRole: "chef",
      shownAlignment: "good",
    });
    expect(await b.get("lobbies/ABCD/player/p-1")).toEqual({
      shownRole: "chef",
      shownAlignment: "good",
    });
    expect(await b.get("lobbies/ABCD/roster/uid-bob")).toBe("p-1");
    expect(await b.get("lobbies/ABCD/joinRequests/uid-bob")).toBeUndefined();
  });

  it("with null selfRecord binds the roster and consumes the request without writing a role", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD/joinRequests/uid-bob", "Bob");
    await seatPlayer(b, "ABCD", "uid-bob", "p-1", null);
    expect(await b.get("lobbies/ABCD/roster/uid-bob")).toBe("p-1");
    expect(await b.get("lobbies/ABCD/player/p-1")).toBeUndefined();
    expect(await b.get("lobbies/ABCD/joinRequests/uid-bob")).toBeUndefined();
  });

  it("never writes roster→playerId without the matching player record (atomicity)", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD/joinRequests/uid-bob", "Bob");
    // Snapshot the writeLog length BEFORE seatPlayer to identify which writes
    // belong to it.
    const before = b.writeLog.length;
    await seatPlayer(b, "ABCD", "uid-bob", "p-1", {
      shownRole: "chef",
      shownAlignment: "good",
    });
    // The seatPlayer multi-path update lands as one batch — both player and
    // roster writes appended together. Order within the batch doesn't matter
    // because RTDB's update() commits them atomically.
    const seatBatch = b.writeLog.slice(before);
    const paths = seatBatch.map((w) => w.path);
    expect(paths).toContain("lobbies/ABCD/player/p-1");
    expect(paths).toContain("lobbies/ABCD/roster/uid-bob");
    expect(seatBatch).toContainEqual({ path: "lobbies/ABCD/joinRequests/uid-bob", value: null });
    const rosterEntry = seatBatch.find(
      (w) => w.path === "lobbies/ABCD/roster/uid-bob"
    );
    expect(rosterEntry?.value).toBe("p-1");
  });
});

describe("classifyRoster", () => {
  it("treats every roster value as a binding, never as a name or request", () => {
    const r = classifyRoster(
      {
        "uid-a": "p-1",
        "uid-b": "Bob",
        "uid-c": "p-2",
      }
    );
    expect(r).toContainEqual({ uid: "uid-a", phase: "seated", playerId: "p-1" });
    expect(r).toContainEqual({ uid: "uid-b", phase: "seated", playerId: "Bob" });
    expect(r).toContainEqual({ uid: "uid-c", phase: "seated", playerId: "p-2" });
  });

  it("returns an empty list for null/undefined", () => {
    expect(classifyRoster(null)).toEqual([]);
    expect(classifyRoster(undefined)).toEqual([]);
  });

  it("skips empty/non-string values defensively", () => {
    const r = classifyRoster(
      // @ts-expect-error — testing defensive skip
      { "uid-a": "", "uid-b": null, "uid-c": "Bob" }
    );
    expect(r).toEqual([{ uid: "uid-c", phase: "seated", playerId: "Bob" }]);
  });
});

describe("readOwnRosterEntry", () => {
  it("returns absent when nothing is at the path", async () => {
    const b = new MemoryRoomBackend();
    expect(await readOwnRosterEntry(b, "ABCD", "uid")).toEqual({ phase: "absent" });
  });

  it("returns the seated playerId when the binding is set", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD/roster/uid-bob", "p-1");
    const r = await readOwnRosterEntry(b, "ABCD", "uid-bob");
    expect(r).toEqual({ phase: "seated", playerId: "p-1" });
  });
});

describe("watchRoster", () => {
  it("fires whenever a roster entry changes", async () => {
    const b = new MemoryRoomBackend();
    const seen: (Record<string, string> | null)[] = [];
    const off = watchRoster(b, "ABCD", (v) => seen.push(v));
    await knockOnLobby(b, "ABCD", "uid-bob", "Bob");
    expect(seen).toEqual([null]); // requests do not modify the authoritative roster
    await seatPlayer(b, "ABCD", "uid-bob", "p-1", {
      shownRole: "chef",
      shownAlignment: "good",
    });
    off();
    // initial null + seating; the request itself never modifies this path
    expect(seen.length).toBe(2);
    const last = seen[seen.length - 1];
    expect(last?.["uid-bob"]).toBe("p-1");
  });

  it("unsubscribed listener stops firing — no leak after off() is called", async () => {
    const b = new MemoryRoomBackend();
    let fires = 0;
    const off = watchRoster(b, "ABCD", () => fires++);
    // One immediate fire on subscribe (null — roster empty).
    expect(fires).toBe(1);
    off();
    // Write after unsubscribe must not trigger the callback.
    await knockOnLobby(b, "ABCD", "uid-bob", "Bob");
    expect(fires).toBe(1);
    // subscribePaths records the subscription was made (proof the path was wired).
    expect(b.subscribePaths).toContain("lobbies/ABCD/roster");
  });
});

describe("watchJoinRequests", () => {
  it("observes a request and its cancellation independently of membership", async () => {
    const b = new MemoryRoomBackend();
    const seen: Record<string, string>[] = [];
    const off = watchJoinRequests(b, "ABCD", (requests) => seen.push(requests));
    await knockOnLobby(b, "ABCD", "uid-bob", "p-alice");
    expect(seen.at(-1)).toEqual({ "uid-bob": "p-alice" });
    expect(await readOwnRosterEntry(b, "ABCD", "uid-bob")).toEqual({ phase: "absent" });
    await cancelJoinRequest(b, "ABCD", "uid-bob");
    expect(seen.at(-1)).toEqual({});
    off();
  });
});

// ---------------------------------------------------------------------------
// Lobby status — endLobby / checkLobbyStatus / watchLobbyStatus
//
// Status lives at lobbies/${code}/public/status — inside the existing
// public object so no new Firebase rules are needed.
// ---------------------------------------------------------------------------

describe("endLobby", () => {
  it("writes status=ended to lobbies/${code}/public/status", async () => {
    const b = new MemoryRoomBackend();
    await endLobby(b, "ABCD");
    expect(await b.get("lobbies/ABCD/public/status")).toBe("ended");
  });

  it("writes status=ended first, then nulls storyteller/ as cleanup", async () => {
    const b = new MemoryRoomBackend();
    await endLobby(b, "ABCD");
    // First write must be the status signal so players redirect immediately.
    expect(b.writeLog[0]!.path).toBe("lobbies/ABCD/public/status");
    expect(b.writeLog[0]!.value).toBe("ended");
    // Storyteller private data is nulled in the cleanup update.
    expect(b.writeLog.some((e) => e.path === "lobbies/ABCD/storyteller" && e.value === null)).toBe(true);
    // roster/ and public/ are NOT written (would break roster-gated public read).
    expect(b.writeLog.every((e) => !e.path.startsWith("lobbies/ABCD/roster"))).toBe(true);
    expect(b.writeLog.filter((e) => e.path === "lobbies/ABCD/public/status").length).toBe(1);
  });

  it("nulls each player/{id} path when playerIds are provided", async () => {
    const b = new MemoryRoomBackend();
    await endLobby(b, "ABCD", ["p1", "p2"]);
    expect(b.writeLog.some((e) => e.path === "lobbies/ABCD/player/p1" && e.value === null)).toBe(true);
    expect(b.writeLog.some((e) => e.path === "lobbies/ABCD/player/p2" && e.value === null)).toBe(true);
  });
});

describe("checkLobbyStatus", () => {
  it("returns 'active' when no status node exists", async () => {
    const b = new MemoryRoomBackend();
    expect(await checkLobbyStatus(b, "ABCD")).toBe("active");
  });

  it("returns 'ended' after endLobby is called", async () => {
    const b = new MemoryRoomBackend();
    await endLobby(b, "ABCD");
    expect(await checkLobbyStatus(b, "ABCD")).toBe("ended");
  });

  it("returns 'active' for any non-ended value (forward compat)", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD/public/status", "active");
    expect(await checkLobbyStatus(b, "ABCD")).toBe("active");
  });
});

describe("watchLobbyStatus", () => {
  it("fires 'active' on subscribe when no status node exists", async () => {
    const b = new MemoryRoomBackend();
    const seen: string[] = [];
    const off = watchLobbyStatus(b, "ABCD", (s) => seen.push(s));
    off();
    expect(seen).toEqual(["active"]);
  });

  it("fires 'ended' after endLobby is called", async () => {
    const b = new MemoryRoomBackend();
    const seen: string[] = [];
    const off = watchLobbyStatus(b, "ABCD", (s) => seen.push(s));
    await endLobby(b, "ABCD");
    off();
    expect(seen[0]).toBe("active"); // immediate fire on subscribe
    expect(seen[seen.length - 1]).toBe("ended");
  });

  it("stops firing after unsubscribe", async () => {
    const b = new MemoryRoomBackend();
    const seen: string[] = [];
    const off = watchLobbyStatus(b, "ABCD", (s) => seen.push(s));
    off(); // unsubscribe immediately
    await endLobby(b, "ABCD"); // should not fire
    expect(seen).toEqual(["active"]); // only the initial fire
  });
});

// ---------------------------------------------------------------------------
// joinLobby — session state after knock
// The memory transport does not authorize operations. The emulator suite
// separately proves missing/ended lobbies reject requests at the rules boundary.
// ---------------------------------------------------------------------------

import { joinLobby } from "./playerSync";
import { usePlayerStore } from "@/stores/playerStore";
import { beforeEach } from "vitest";
import type { PublicLobbyRecord } from "@/stores/types";

beforeEach(() => {
  usePlayerStore.setState({
    code: null,
    uid: null,
    playerId: null,
    requestedName: null,
    status: "idle",
    error: null,
    self: null,
    publicLobby: null,
    revealed: false,
  });
  localStorage.clear();
});

describe("joinLobby", () => {
  it("knocks and enters 'waiting' for an active lobby", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD2345/session", { version: 2, id: "test-session", state: "active" });
    await joinLobby(b, "ABCD2345", "uid-bob", "Bob");
    const ps = usePlayerStore.getState();
    expect(ps.status).toBe("waiting");
    expect(ps.code).toBe("ABCD2345");
    expect(ps.requestedName).toBe("Bob");
  });

  it("surfaces an emulator/rules rejection without installing a joined session", async () => {
    const b = new MemoryRoomBackend();
    b.setIfAbsent = async () => { throw new Error("PERMISSION_DENIED"); };
    await b.set("lobbies/ABCD2345/session", { version: 2, id: "test-session", state: "active" });
    await joinLobby(b, "ABCD2345", "uid-bob", "Bob");
    const ps = usePlayerStore.getState();
    expect(ps.status).toBe("error");
    expect(ps.code).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// usePlayerSync contract tests — real-time ended detection
//
// These tests wire up the subscription callbacks from usePlayerSync manually
// against MemoryRoomBackend to verify the observable behaviour without a
// React test harness.  The key property under test:
//
//   When the ST calls endLobby(), a connected player's store transitions to
//   status="ended" AND stays there even if a stale roster event fires
//   concurrently (the guard in the roster callback prevents the clobber).
// ---------------------------------------------------------------------------

describe("usePlayerSync — real-time ended detection", () => {
  it("public/ subscription fires for a child write to public/status", async () => {
    // Verifies MemoryRoomBackend ancestor-notify semantics match RTDB:
    // a watcher on the parent path receives an event when a child changes.
    const b = new MemoryRoomBackend();
    const fired: unknown[] = [];
    const off = b.subscribe("lobbies/ABCD/public", (v) => fired.push(v));
    await endLobby(b, "ABCD");
    off();
    // Initial fire (null) + one update after endLobby writes public/status.
    expect(fired.length).toBe(2);
    expect((fired[1] as Record<string, unknown>)?.status).toBe("ended");
  });

  it("player transitions from 'seated' to 'ended' when public/ fires status=ended", async () => {
    // Mirrors the exact callback wired in usePlayerSync's public/ useEffect.
    const b = new MemoryRoomBackend();
    usePlayerStore.setState({
      code: "ABCD",
      uid: "uid-bob",
      playerId: "p-1",
      requestedName: null,
      status: "seated",
      error: null,
      self: null,
      publicLobby: null,
      revealed: false,
    });
    const off = b.subscribe("lobbies/ABCD/public", (value) => {
      const ps = usePlayerStore.getState();
      if (value === undefined || value === null) { ps.setPublic(null); return; }
      const pub = value as unknown as PublicLobbyRecord;
      if (pub.status === "ended") { ps.setEnded(); return; }
      ps.setPublic(pub);
    });
    await endLobby(b, "ABCD");
    off();
    expect(usePlayerStore.getState().status).toBe("ended");
    // setEnded() clears the session — code/uid/playerId should all be null.
    expect(usePlayerStore.getState().code).toBeNull();
  });

  it("roster callback guard prevents 'ended' being clobbered by a concurrent roster fire", async () => {
    // Regression test for the race: after setEnded() clears store state,
    // the roster subscription (still active until React cleanup) fires with the
    // old playerId value and falls through to setStatus("seated"), undoing ended.
    // The guard — if (ps.status === "ended") return — must stop this.
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD/roster/uid-bob", "p-1");
    usePlayerStore.setState({
      code: "ABCD",
      uid: "uid-bob",
      playerId: "p-1",
      requestedName: null,
      status: "seated",
      error: null,
      self: null,
      publicLobby: null,
      revealed: false,
    });

    // public/ subscription — calls setEnded() when status=ended.
    const publicOff = b.subscribe("lobbies/ABCD/public", (value) => {
      const ps = usePlayerStore.getState();
      if (value === undefined || value === null) { ps.setPublic(null); return; }
      const pub = value as unknown as PublicLobbyRecord;
      if (pub.status === "ended") { ps.setEnded(); return; }
      ps.setPublic(pub);
    });

    // roster subscription WITH the guard (mirrors the fixed usePlayerSync code).
    const rosterOff = b.subscribe("lobbies/ABCD/roster/uid-bob", (value) => {
      const ps = usePlayerStore.getState();
      if (ps.status === "ended") return; // guard — must be present
      if (typeof value !== "string" || value.length === 0) {
        if (ps.playerId) {
          ps.setStatus("error", "Removed from lobby.");
          ps.setPlayerId(null);
          ps.setSelf(null);
        }
        return;
      }
      ps.setPlayerId(value);
      ps.setStatus("seated");
    });

    // ST ends the lobby — fires public/ → setEnded().
    await endLobby(b, "ABCD");
    expect(usePlayerStore.getState().status).toBe("ended");

    // Simulate a concurrent roster delivery (Firebase buffered event arriving
    // after setEnded() but before React cleanup unregisters the subscription).
    await b.set("lobbies/ABCD/roster/uid-bob", "p-1");

    // The guard must have blocked the clobber.
    expect(usePlayerStore.getState().status).toBe("ended");
    expect(usePlayerStore.getState().code).toBeNull();

    publicOff();
    rosterOff();
  });
});
