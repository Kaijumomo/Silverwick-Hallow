// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MemoryRoomBackend } from "@/test/memoryBackend";

describe("MemoryRoomBackend — basic ops", () => {
  it("set + get round-trips", async () => {
    const b = new MemoryRoomBackend();
    await b.set("a/b/c", { x: 1 });
    expect(await b.get("a/b/c")).toEqual({ x: 1 });
  });

  it("get on a missing path returns undefined", async () => {
    const b = new MemoryRoomBackend();
    expect(await b.get("nothing/here")).toBeUndefined();
  });

  it("update applies multiple paths atomically", async () => {
    const b = new MemoryRoomBackend();
    await b.update({
      "a/x": 1,
      "a/y": 2,
      "b": "hello",
    });
    expect(await b.get("a/x")).toBe(1);
    expect(await b.get("a/y")).toBe(2);
    expect(await b.get("b")).toBe("hello");
  });

  it("set logs into writeLog with the right path", async () => {
    const b = new MemoryRoomBackend();
    await b.set("k", 1);
    await b.update({ "p/a": 2, "p/b": 3 });
    expect(b.writeLog.map((w) => w.path)).toEqual(["k", "p/a", "p/b"]);
  });
});

describe("MemoryRoomBackend — setIfAbsent (TOCTOU)", () => {
  it("commits when the path is absent", async () => {
    const b = new MemoryRoomBackend();
    const r = await b.setIfAbsent("lobbies/ABCD/storytellerUid", "uid-st");
    expect(r).toEqual({ committed: true });
    expect(await b.get("lobbies/ABCD/storytellerUid")).toBe("uid-st");
  });

  it("rejects + returns existing when the path is occupied", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ABCD/storytellerUid", "uid-first");
    const r = await b.setIfAbsent("lobbies/ABCD/storytellerUid", "uid-second");
    expect(r.committed).toBe(false);
    if (!r.committed) expect(r.existing).toBe("uid-first");
    // value not overwritten
    expect(await b.get("lobbies/ABCD/storytellerUid")).toBe("uid-first");
  });

  it("two concurrent setIfAbsent — only one commits", async () => {
    const b = new MemoryRoomBackend();
    const [r1, r2] = await Promise.all([
      b.setIfAbsent("k", "first"),
      b.setIfAbsent("k", "second"),
    ]);
    const committed = [r1, r2].filter((r) => r.committed);
    expect(committed).toHaveLength(1);
    // Whoever lost can read the actual value
    const stored = await b.get("k");
    expect(stored === "first" || stored === "second").toBe(true);
  });
});

describe("MemoryRoomBackend — subscribe", () => {
  it("fires immediately with current value", async () => {
    const b = new MemoryRoomBackend();
    await b.set("a", "initial");
    let last: unknown;
    const off = b.subscribe("a", (v) => {
      last = v;
    });
    expect(last).toBe("initial");
    off();
  });

  it("fires on later changes at the same path", async () => {
    const b = new MemoryRoomBackend();
    const seen: unknown[] = [];
    const off = b.subscribe("a", (v) => seen.push(v));
    await b.set("a", 1);
    await b.set("a", 2);
    off();
    // initial undefined + two updates
    expect(seen).toEqual([undefined, 1, 2]);
  });

  it("ancestor subscription fires when descendant changes", async () => {
    const b = new MemoryRoomBackend();
    const seen: unknown[] = [];
    const off = b.subscribe("a", (v) => seen.push(v));
    await b.set("a/x", "deep");
    off();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toEqual({ x: "deep" });
  });

  it("does not fire after unsubscribe", async () => {
    const b = new MemoryRoomBackend();
    const seen: unknown[] = [];
    const off = b.subscribe("k", (v) => seen.push(v));
    off();
    await b.set("k", "v");
    expect(seen).toEqual([undefined]); // only the initial fire
  });
});

describe("MemoryRoomBackend — reset", () => {
  it("clears data, listeners, and the write log", async () => {
    const b = new MemoryRoomBackend();
    await b.set("a", 1);
    b.subscribe("a", () => {});
    b.reset();
    expect(await b.get("a")).toBeUndefined();
    expect(b.writeLog).toEqual([]);
  });
});
