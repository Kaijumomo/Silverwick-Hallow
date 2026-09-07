import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRoomBackend } from "./memoryBackend";
import { publicPath } from "./paths";
import { subscribeToPublicLobby, usePublicLobby } from "./publicSync";
import {
  CONNECTION_ERROR_MESSAGE,
  DATA_ERROR_MESSAGE,
  decodeJoinRequest,
  decodeJoinRequests,
  decodeLobbyStatus,
  decodePresence,
  decodePublicSnapshot,
  decodeRoster,
  decodeRosterEntry,
  decodeSelfSnapshot,
} from "./snapshots";
import type { PublicLobbyRecord } from "@/stores/types";

afterEach(cleanup);

const player = {
  id: "p1",
  name: "Alice",
  seat: 0,
  alive: true,
  ghostVote: true,
  online: true,
  joinedAt: 1,
  isTraveler: false,
};

function validPublic(over: Partial<PublicLobbyRecord> = {}): PublicLobbyRecord {
  return {
    code: "ROOM",
    scriptId: "tb",
    phase: "night",
    day: 1,
    seatOrder: ["p1"],
    players: { p1: player },
    fabled: [],
    lorics: [],
    ...over,
  };
}

describe("Firebase snapshot decoders", () => {
  it("normalizes null and omitted empty public collections without inventing required scalars", () => {
    const snapshot = decodePublicSnapshot({
      code: "ROOM",
      scriptId: "tb",
      phase: "setup",
      day: 0,
      players: null,
      seatOrder: null,
      fabled: null,
      lorics: null,
    }, "ROOM");

    expect(snapshot).toEqual({
      status: "ready",
      data: {
        code: "ROOM",
        scriptId: "tb",
        phase: "setup",
        day: 0,
        players: {},
        seatOrder: [],
        fabled: [],
        lorics: [],
      },
    });
  });

  it("treats a null public node as waiting and an ended signal as controlled state", () => {
    expect(decodePublicSnapshot(null, "ROOM")).toEqual({ status: "waiting" });
    expect(decodePublicSnapshot({}, "ROOM")).toEqual({ status: "waiting" });
    expect(decodePublicSnapshot({ status: "ended" }, "ROOM")).toEqual({ status: "ended" });
  });

  it("accepts omitted empty collections while retaining the required lobby scalars", () => {
    const required = { code: "ROOM", scriptId: "tb", phase: "setup", day: 0 };
    for (const field of ["players", "seatOrder", "fabled", "lorics"] as const) {
      const snapshot = decodePublicSnapshot({
        ...required,
        players: {},
        seatOrder: [],
        fabled: [],
        lorics: [],
        [field]: undefined,
      }, "ROOM");
      expect(snapshot.status, field).toBe("ready");
    }
  });

  it("does not expose a public model while required scalars are missing", () => {
    expect(decodePublicSnapshot({ code: "ROOM", players: {}, seatOrder: [] }, "ROOM")).toEqual({ status: "waiting" });
    expect(decodePublicSnapshot({ ...validPublic(), day: "1" }, "ROOM").status).toBe("invalid");
    expect(decodePublicSnapshot({ ...validPublic(), phase: "dusk" }, "ROOM").status).toBe("invalid");
    expect(decodePublicSnapshot({ ...validPublic(), code: "OTHER" }, "ROOM").status).toBe("invalid");
  });

  it("rejects malformed or internally inconsistent players and seat order", () => {
    expect(decodePublicSnapshot({ ...validPublic(), players: { p1: { ...player, name: 42 } } }, "ROOM").status).toBe("invalid");
    expect(decodePublicSnapshot({ ...validPublic(), players: { wrong: player } }, "ROOM").status).toBe("invalid");
    expect(decodePublicSnapshot({ ...validPublic(), seatOrder: ["p1", "p1"] }, "ROOM").status).toBe("invalid");
    expect(decodePublicSnapshot({ ...validPublic(), seatOrder: ["p2"] }, "ROOM")).toEqual({ status: "waiting" });
  });

  it("validates self, roster, request, presence, and status nodes", () => {
    expect(decodeSelfSnapshot(null)).toEqual({ status: "waiting" });
    expect(decodeSelfSnapshot({ shownAlignment: "good" })).toEqual({ status: "waiting" });
    expect(decodeSelfSnapshot({ shownRole: "chef", shownAlignment: "neutral" }).status).toBe("invalid");
    expect(decodeSelfSnapshot({ shownRole: "chef", shownAlignment: "good" })).toEqual({
      status: "ready", data: { shownRole: "chef", shownAlignment: "good" },
    });

    expect(decodeRoster(null)).toEqual({ status: "ready", data: {} });
    expect(decodeRoster({ bob: "p1" })).toEqual({ status: "ready", data: { bob: "p1" } });
    expect(decodeRoster({ bob: 7 }).status).toBe("invalid");
    expect(decodeRosterEntry(null)).toEqual({ status: "waiting" });
    expect(decodeRosterEntry({ id: "p1" }).status).toBe("invalid");

    expect(decodeJoinRequest(null)).toEqual({ status: "waiting" });
    expect(decodeJoinRequest(" Alice ").status).toBe("invalid");
    expect(decodeJoinRequests(null)).toEqual({ status: "ready", data: {} });
    expect(decodeJoinRequests({ bob: "Bob" })).toEqual({ status: "ready", data: { bob: "Bob" } });
    expect(decodeJoinRequests({ bob: 7 }).status).toBe("invalid");

    expect(decodePresence(null)).toEqual({ status: "ready", data: {} });
    expect(decodePresence({ bob: { online: true, lastSeen: 1 } }).status).toBe("ready");
    expect(decodePresence({ bob: { online: "yes", lastSeen: 1 } }).status).toBe("invalid");
    expect(decodeLobbyStatus(null)).toEqual({ status: "ready", data: "active" });
    expect(decodeLobbyStatus("active")).toEqual({ status: "ready", data: "active" });
    expect(decodeLobbyStatus("ended")).toEqual({ status: "ready", data: "ended" });
    expect(decodeLobbyStatus("broken").status).toBe("invalid");
  });
});

describe("public Firebase boundary", () => {
  it("handles the original sparse lobby snapshot without exposing an unsafe model", async () => {
    const backend = new MemoryRoomBackend();
    await backend.set("lobbies/ROOM/session", { version: 2, id: "test", state: "active" });
    await backend.set(publicPath("ROOM"), { phase: "setup", scriptId: "tb", day: 0 } as never);
    const { result } = renderHook(() => usePublicLobby(backend, "ROOM"));

    await waitFor(() => expect(backend.subscribePaths).toContain(publicPath("ROOM")));
    expect(result.current.publicLobby).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await backend.set(publicPath("ROOM"), validPublic({ phase: "setup", day: 0 }) as never);
    });
    await waitFor(() => expect(result.current.publicLobby?.phase).toBe("setup"));
  });

  it("reports malformed data without crashing and recovers when a valid snapshot arrives", async () => {
    const backend = new MemoryRoomBackend();
    await backend.set("lobbies/ROOM/session", { version: 2, id: "test", state: "active" });
    await backend.set(publicPath("ROOM"), { ...validPublic(), players: "not-a-map" } as never);
    const { result } = renderHook(() => usePublicLobby(backend, "ROOM"));

    await waitFor(() => expect(result.current.error).toBe(DATA_ERROR_MESSAGE));
    expect(result.current.publicLobby).toBeNull();

    await act(async () => {
      await backend.set(publicPath("ROOM"), validPublic() as never);
    });
    await waitFor(() => expect(result.current.publicLobby?.players.p1.name).toBe("Alice"));
    expect(result.current.error).toBeNull();
  });

  it("keeps listening through a transient invalid snapshot", async () => {
    const backend = new MemoryRoomBackend();
    await backend.set("lobbies/ROOM/session", { version: 2, id: "test", state: "active" });
    const statuses: string[] = [];
    const off = subscribeToPublicLobby(backend, "ROOM", (_value, snapshot) => statuses.push(snapshot.status));

    await backend.set(publicPath("ROOM"), { ...validPublic(), day: "later" } as never);
    await backend.set(publicPath("ROOM"), validPublic({ day: 2 }) as never);
    off();

    expect(statuses).toContain("invalid");
    expect(statuses[statuses.length - 1]).toBe("ready");
  });

  it("maps read failures to a controlled connection error", async () => {
    const backend = new MemoryRoomBackend();
    await backend.set("lobbies/ROOM/session", { version: 2, id: "test", state: "active" });
    const seen: string[] = [];
    backend.subscribe = (_path, _cb, onError) => {
      onError?.(new Error("offline"));
      return () => {};
    };
    const { result } = renderHook(() => usePublicLobby(backend, "ROOM"));
    await waitFor(() => expect(result.current.error).toBe(CONNECTION_ERROR_MESSAGE));
    seen.push(result.current.error!);
    expect(seen).toEqual([CONNECTION_ERROR_MESSAGE]);
  });
});
