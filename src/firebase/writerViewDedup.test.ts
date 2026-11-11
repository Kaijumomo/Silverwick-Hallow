// @vitest-environment node
// WP 4-4 (F-14): a writer leaves out of its commit any whole public or player view identical to the copy it last
// committed, instead of uploading every view again on every Storyteller action.
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRoomBackend } from "@/test/memoryBackend";
import type { Json } from "./backend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";

const code = "DEDP2345";
const root = `lobbies/${code}`;
const pub = `${root}/public`;
const alice = `${root}/player/alice-id`;
const bob = `${root}/player/bob-id`;

const writers: SessionWriter[] = [];
afterEach(async () => { for (const w of writers.splice(0)) await w.dispose().catch(() => {}); });

async function setup() {
  const b = new MemoryRoomBackend();
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const sent: Record<string, Json>[] = [];
  const update = b.update.bind(b);
  b.update = async (updates) => { sent.push(updates); return update(updates); };
  const start = async () => {
    const w = new SessionWriter(b, code, session.id);
    writers.push(w);
    await w.start();
    return w;
  };
  /** Paths of the last commit, without the writeGuard every commit carries. */
  const last = () => Object.keys(sent.at(-1)!).filter(p => p !== `${root}/writeGuard`).sort();
  return { b, sent, start, last };
}

describe("SessionWriter: unchanged views are not uploaded again (F-14)", () => {
  it("sends a view once, then only when it changes; other paths and the writeGuard are always sent", async () => {
    const { b, start, last, sent } = await setup();
    const w = await start();
    await w.update({ [pub]: { phase: "day" }, [alice]: { seat: 1 }, [bob]: { seat: 2 }, [`${root}/storyteller`]: { n: 1 } });
    expect(last()).toEqual([`${root}/storyteller`, alice, bob, pub].sort());

    await w.update({ [pub]: { phase: "day" }, [alice]: { seat: 1 }, [bob]: { seat: 3 }, [`${root}/storyteller`]: { n: 2 } });
    expect(last()).toEqual([`${root}/storyteller`, bob].sort());
    expect(sent.at(-1)![`${root}/writeGuard`]).toMatchObject({ token: w.token });
    expect(await b.get(alice)).toEqual({ seat: 1 });
    expect(await b.get(bob)).toEqual({ seat: 3 });
  });

  it("a value that changes and then changes back (an Undo) is sent both times", async () => {
    const { b, start, last } = await setup();
    const w = await start();
    await w.update({ [alice]: { alive: true } });
    await w.update({ [alice]: { alive: false } });
    await w.update({ [alice]: { alive: true } });
    expect(last()).toEqual([alice]);
    expect(await b.get(alice)).toEqual({ alive: true });
  });

  it("always sends a removal, and a removal makes the next identical value go out again", async () => {
    const { b, start, last } = await setup();
    const w = await start();
    await w.update({ [alice]: { seat: 1 } });
    await w.update({ [alice]: null });
    expect(last()).toEqual([alice]);
    await w.update({ [alice]: null });
    expect(last()).toEqual([alice]);
    await w.update({ [alice]: { seat: 1 } });
    expect(last()).toEqual([alice]);
    expect(await b.get(alice)).toEqual({ seat: 1 });
  });

  it("a write inside or above a remembered view makes the writer send that view in full next time", async () => {
    const { start, last } = await setup();
    const w = await start();
    await w.update({ [pub]: { phase: "day", status: "open" }, [alice]: { seat: 1 } });
    await w.update({ [`${pub}/status`]: "ended" });
    await w.update({ [pub]: { phase: "day", status: "open" }, [alice]: { seat: 1 } });
    expect(last()).toEqual([pub]);
    await w.update({ [`${root}/player`]: null });
    await w.update({ [pub]: { phase: "day", status: "open" }, [alice]: { seat: 1 } });
    expect(last()).toEqual([alice]);
  });

  it("a new writer (reconnect, reload) starts with nothing remembered and sends every view once", async () => {
    const { start, last } = await setup();
    const first = await start();
    await first.update({ [pub]: { phase: "day" }, [alice]: { seat: 1 } });
    await first.dispose();
    const second = await start();
    await second.update({ [pub]: { phase: "day" }, [alice]: { seat: 1 } });
    expect(last()).toEqual([alice, pub].sort());
  });

  it("after a failed commit nothing is remembered: the server may or may not hold those views", async () => {
    const { b, start } = await setup();
    const w = await start();
    await w.update({ [alice]: { seat: 1 } });
    const update = b.update;
    let fail = true;
    const seen: Record<string, Json>[] = [];
    b.update = async (updates) => {
      seen.push(updates);
      if (fail) { fail = false; throw Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" }); }
      return update(updates);
    };
    await expect(w.update({ [alice]: { seat: 2 } })).rejects.toThrow();
    // The writer stopped (as for any failed commit); a reconnect starts a fresh writer anyway, so the check here is
    // that the failure itself cleared the memory.
    expect((w as unknown as { committedViews: Map<string, string> }).committedViews.size).toBe(0);
    expect(seen).toHaveLength(1);
  });
  it("after a renewal that finds a gap in its lease (another writer may have written meanwhile), every view goes out again", async () => {
    const { b, start, last } = await setup();
    const w = await start();
    await w.update({ [pub]: { phase: "day" }, [alice]: { seat: 1 } });
    // The lease lapsed: another writer held it, wrote, and let it expire.
    await b.set(`${root}/writer`, { token: "other-tab", expiresAt: Date.now() - 1 });
    await w.reconfirmAuthority(); // the same renewal transaction the interval runs; this one is discontinuous
    await w.update({ [pub]: { phase: "day" }, [alice]: { seat: 1 } });
    expect(last()).toEqual([alice, pub].sort());
  });
});
