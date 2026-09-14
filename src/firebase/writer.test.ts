// Phase 9C.2A.2A (OPUS-001) remediation, Finding H1 — SessionWriter's own
// continuous-authority bookkeeping (leaseEpoch/leaseExpiresAt,
// reconfirmAuthority, holdsAuthority), tested directly against
// MemoryRoomBackend with Date.now mocked so lease-expiry/reclaim scenarios
// are deterministic and instantaneous — no real or fake-timer waiting.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter, LEASE_MS, FENCE_MARGIN_MS } from "./writer";

const code = "WRTR2345";

async function setup() {
  const b = new MemoryRoomBackend();
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  return { b, session };
}

const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

describe("SessionWriter continuous authority (Finding H1)", () => {
  it("reconfirmAuthority returns a handle whose epoch/expiresAt reflect the just-confirmed lease", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();

    const handle = await writer.reconfirmAuthority();
    expect(handle.expiresAt).toBe(baseNow + LEASE_MS);
    expect(writer.holdsAuthority(handle, FENCE_MARGIN_MS)).toBe(true);
  });

  it("ordinary renewal (called while the prior lease is still valid) keeps the same epoch", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();

    // Still comfortably inside the lease just acquired — an ordinary renewal.
    nowSpy.mockReturnValue(baseNow + 1000);
    const handle2 = await writer.reconfirmAuthority();

    expect(handle2.epoch).toBe(handle1.epoch);
    // A handle issued before this later, still-same-epoch renewal remains
    // valid: the writer's own bookkeeping was extended, not reclaimed.
    expect(writer.holdsAuthority(handle1, FENCE_MARGIN_MS)).toBe(true);
  });

  it("a renewal that finds its own previously-recorded lease already lapsed increments the epoch (reclaim after lapse)", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();

    // Jump forward past this writer's own recorded expiry — from its own
    // bookkeeping's point of view, the previous interval has lapsed.
    nowSpy.mockReturnValue(baseNow + LEASE_MS + 1);
    const handle2 = await writer.reconfirmAuthority();

    expect(handle2.epoch).toBe(handle1.epoch + 1);
    // The old handle is no longer valid: the epoch moved on.
    expect(writer.holdsAuthority(handle1, FENCE_MARGIN_MS)).toBe(false);
    // The fresh handle, reflecting the reclaim, is valid.
    expect(writer.holdsAuthority(handle2, FENCE_MARGIN_MS)).toBe(true);
  });

  it("holdsAuthority is false once server-clock estimate + margin reaches the recorded lease expiry, even with the epoch unchanged and the writer not stopped", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const handle = await writer.reconfirmAuthority();
    expect(writer.holdsAuthority(handle, FENCE_MARGIN_MS)).toBe(true);

    // Exactly at the fence boundary: margin eats the last instant of headroom.
    nowSpy.mockReturnValue(baseNow + LEASE_MS - FENCE_MARGIN_MS);
    expect(writer.holdsAuthority(handle, FENCE_MARGIN_MS)).toBe(false);
    expect(writer.isStopped()).toBe(false); // no interval tick, nothing else stopped it
  });

  it("holdsAuthority is false for a handle from a different (older) epoch even when the writer currently holds a valid lease", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const staleHandle = await writer.reconfirmAuthority();

    nowSpy.mockReturnValue(baseNow + LEASE_MS + 1);
    await writer.reconfirmAuthority(); // reclaims — bumps the epoch
    const currentHandle = await writer.reconfirmAuthority(); // now an ordinary renewal at the new epoch

    expect(writer.holdsAuthority(currentHandle, FENCE_MARGIN_MS)).toBe(true);
    expect(writer.holdsAuthority(staleHandle, FENCE_MARGIN_MS)).toBe(false);
  });

  it("holdsAuthority is false once the writer has stopped, regardless of epoch or remaining time", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    const baseNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const handle = await writer.reconfirmAuthority();
    expect(writer.holdsAuthority(handle, FENCE_MARGIN_MS)).toBe(true);

    writer.stop();
    expect(writer.holdsAuthority(handle, FENCE_MARGIN_MS)).toBe(false);
    await writer.dispose();
  });

  it("holdsAuthority performs no I/O — it is a synchronous, non-async method", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await writer.start();
    const handle = await writer.reconfirmAuthority();
    // A synchronous function's return value is a boolean, not a Promise —
    // this fails to typecheck/at runtime if holdsAuthority were ever made
    // async, which would reintroduce exactly the "await between gate and
    // mutation" bug Finding H1 closes.
    const result: boolean = writer.holdsAuthority(handle, FENCE_MARGIN_MS);
    expect(typeof result).toBe("boolean");
  });
});

describe("SessionWriter.reconfirmAuthority failure path", () => {
  it("rejects (does not return a handle) when another writer's valid lease already blocks reclamation", async () => {
    const { b, session } = await setup();
    const first = new SessionWriter(b, code, session.id);
    const second = new SessionWriter(b, code, session.id);
    disposals.push(() => first.dispose(), () => second.dispose());
    await first.start();
    await expect(second.start()).rejects.toThrow(/Another Storyteller/);
  });
});
