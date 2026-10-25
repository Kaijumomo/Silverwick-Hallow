import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRoomBackend } from "./memoryBackend";
import { subscribeToPublicLobby, usePublicLobby } from "./publicSync";
import { sessionPath } from "./lifecycle";
import { publicPath } from "./paths";
import { endLobby } from "./lobby";
import type { PublicLobbyRecord } from "@/stores/types";

function makePublic(over: Partial<PublicLobbyRecord> = {}): PublicLobbyRecord {
  return {
    code: "ABCD",
    scriptId: "tb",
    phase: "night",
    day: 1,
    seatOrder: ["p1"],
    players: {
      p1: {
        id: "p1",
        name: "Alice",
        seat: 0,
        alive: true,
        ghostVote: true,
        online: true,
        joinedAt: 1,
        isTraveler: false,
      },
    },
    fabled: [],
    lorics: [],
    ...over,
  };
}

describe("subscribeToPublicLobby — path safety + behavior", () => {
  it("subscribes ONLY to publicPath(code) — no other path is read", () => {
    const backend = new MemoryRoomBackend();
    const unsub = subscribeToPublicLobby(backend, "ABCD", () => {});
    expect(backend.subscribePaths).toEqual([publicPath("ABCD")]);
    // None of the private paths should ever be subscribed to.
    expect(backend.subscribePaths).not.toContain("lobbies/ABCD/storyteller");
    expect(backend.subscribePaths.some((p) => p.startsWith("lobbies/ABCD/player/"))).toBe(false);
    expect(backend.subscribePaths.some((p) => p.startsWith("lobbies/ABCD/roster"))).toBe(false);
    expect(backend.subscribePaths.some((p) => p.startsWith("lobbies/ABCD/presence"))).toBe(false);
    unsub();
  });

  it("invokes the callback with the public record when written", async () => {
    const backend = new MemoryRoomBackend();
    const seen: (PublicLobbyRecord | null)[] = [];
    const unsub = subscribeToPublicLobby(backend, "ABCD", (v) => seen.push(v));
    await backend.set(publicPath("ABCD"), makePublic({ phase: "day", day: 2 }) as never);
    const last = seen[seen.length - 1];
    expect(last).not.toBeNull();
    expect(last!.phase).toBe("day");
    expect(last!.day).toBe(2);
    unsub();
  });

  it("invokes the callback with status='ended' record intact", async () => {
    const backend = new MemoryRoomBackend();
    const seen: (PublicLobbyRecord | null)[] = [];
    const unsub = subscribeToPublicLobby(backend, "ABCD", (v) => seen.push(v));
    await backend.set(
      publicPath("ABCD"),
      makePublic({ status: "ended" }) as never
    );
    const last = seen[seen.length - 1];
    expect(last).not.toBeNull();
    expect(last!.status).toBe("ended");
    unsub();
  });

  it("unsubscribe stops further callbacks", async () => {
    const backend = new MemoryRoomBackend();
    const seen: (PublicLobbyRecord | null)[] = [];
    const unsub = subscribeToPublicLobby(backend, "ABCD", (v) => seen.push(v));
    await backend.set(publicPath("ABCD"), makePublic({ day: 1 }) as never);
    const countBeforeUnsub = seen.length;
    unsub();
    await backend.set(publicPath("ABCD"), makePublic({ day: 9 }) as never);
    expect(seen.length).toBe(countBeforeUnsub);
  });

  // E4 — ended detection via child write + path-deletion teardown
  it("endLobby child write to public/status triggers callback with status=ended", async () => {
    // endLobby writes to lobbies/ABCD/public/status (a child of public/).
    // The subscription is on public/ (the ancestor). RTDB (and MemoryRoomBackend)
    // fire ancestor watchers on descendant writes — verify the integration.
    const backend = new MemoryRoomBackend();
    await backend.set(publicPath("ABCD"), makePublic({ phase: "night" }) as never);

    const seen: (PublicLobbyRecord | null)[] = [];
    const unsub = subscribeToPublicLobby(backend, "ABCD", (v) => seen.push(v));
    // First fire: current value (phase=night, no status).
    expect(seen.length).toBe(1);
    expect(seen[0]!.phase).toBe("night");

    await endLobby(backend, "ABCD");
    unsub();

    // After endLobby, the last callback should carry status=ended.
    const last = seen[seen.length - 1];
    expect(last).not.toBeNull();
    expect(last!.status).toBe("ended");
  });

  it("endLobby path-deletion teardown: storyteller/ and player/{id}/ are null after end", async () => {
    const backend = new MemoryRoomBackend();
    // Pre-populate private paths to confirm they get deleted.
    await backend.set("lobbies/ABCD/storyteller", { secret: "data" });
    await backend.set("lobbies/ABCD/player/p1", { shownRole: "chef" });
    await backend.set("lobbies/ABCD/player/p2", { shownRole: "imp" });

    await endLobby(backend, "ABCD", ["p1", "p2"]);

    // Null-writes delete nodes in RTDB (undefined = absent).
    expect(await backend.get("lobbies/ABCD/storyteller")).toBeUndefined();
    expect(await backend.get("lobbies/ABCD/player/p1")).toBeUndefined();
    expect(await backend.get("lobbies/ABCD/player/p2")).toBeUndefined();
    // public/status was written, not deleted.
    expect(await backend.get("lobbies/ABCD/public/status")).toBe("ended");
  });
});

// Package 4 (PO-approved public winner delivery): after the end the display
// keeps the final public record, with the declared winner once the terminal
// commit lands, and falls back to the neutral scene when it cannot read it.
describe("usePublicLobby — the final record after the end", () => {
  const code = "ABCD";
  const active = { version: 2, id: "s1", state: "active" };
  const ended = { version: 2, id: "s1", state: "ended" };
  async function liveBackend() {
    const backend = new MemoryRoomBackend();
    await backend.set(sessionPath(code), active as never);
    await backend.set(publicPath(code), makePublic({ code, phase: "day", day: 3 }) as never);
    return backend;
  }

  it("keeps the seats after the public signal, then shows the winner the terminal commit adds", async () => {
    const backend = await liveBackend();
    const { result } = renderHook(() => usePublicLobby(backend, code));
    await waitFor(() => expect(result.current.publicLobby?.phase).toBe("day"));
    await act(async () => { await backend.set(`${publicPath(code)}/status`, "ended"); });
    await waitFor(() => expect(result.current.ended).toBe(true));
    await waitFor(() => expect(result.current.publicLobby?.status).toBe("ended"));
    expect(result.current.publicLobby?.winner).toBeUndefined();
    await act(async () => {
      await backend.update({ [`${publicPath(code)}/winner`]: "evil", [sessionPath(code)]: ended } as never);
    });
    await waitFor(() => expect(result.current.publicLobby?.winner).toBe("evil"));
    expect(result.current.publicLobby?.seatOrder).toEqual(["p1"]);
  });

  it("a display opened after the end reads the final record once", async () => {
    const backend = await liveBackend();
    await backend.update({ [`${publicPath(code)}/status`]: "ended", [`${publicPath(code)}/winner`]: "good", [sessionPath(code)]: ended } as never);
    const { result } = renderHook(() => usePublicLobby(backend, code));
    await waitFor(() => expect(result.current.publicLobby?.winner).toBe("good"));
    expect(result.current.ended).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("a Night-declared ending still withholds every Life field from the final record", async () => {
    const backend = new MemoryRoomBackend();
    await backend.set(sessionPath(code), ended as never);
    await backend.set(publicPath(code), makePublic({ code, phase: "night", day: 2, status: "ended", winner: "good" }) as never);
    const { result } = renderHook(() => usePublicLobby(backend, code));
    await waitFor(() => expect(result.current.publicLobby?.winner).toBe("good"));
    const seat = result.current.publicLobby!.players.p1!;
    expect("alive" in seat || "ghostVote" in seat).toBe(false);
  });

  it("a refused final read (older Rules) leaves the neutral ended scene, never an invented winner", async () => {
    const backend = await liveBackend();
    await backend.update({ [`${publicPath(code)}/status`]: "ended", [sessionPath(code)]: ended } as never);
    const get = backend.get.bind(backend);
    backend.get = async (target: string) => { if (target === publicPath(code)) throw new Error("PERMISSION_DENIED"); return get(target); };
    const { result } = renderHook(() => usePublicLobby(backend, code));
    await waitFor(() => expect(result.current.ended).toBe(true));
    await act(async () => {});
    expect(result.current.publicLobby).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
