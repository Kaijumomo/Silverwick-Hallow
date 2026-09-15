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

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation (OPUS-001) — SessionWriter.renew() now decides
// continuity from the server lease record the COMMITTING transaction
// invocation observed, never from a `now`/reclaim decision made before that
// transaction was awaited (Finding H1's root cause). The suite above already
// exercises the observable epoch/expiresAt behavior end to end; these tests
// enumerate the task's required minimum coverage explicitly, including the
// updater-retry cases that require simulating Firebase invoking the same
// transaction's updater more than once before one invocation's return value
// actually commits — MemoryRoomBackend's own transaction() only ever calls
// its updater once, so those two tests wrap it to fabricate that behavior.
// ---------------------------------------------------------------------------
describe("SessionWriter.renew() — server-observed continuity (Finding H1 remediation)", () => {
  it("1. first successful acquisition advances leaseEpoch from 0 to 1", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await writer.start(); // start()'s own renew() IS the first acquisition
    const handle = await writer.reconfirmAuthority(); // ordinary renewal right after — epoch unchanged from start()'s own bump
    expect(handle.epoch).toBe(1);
  });

  it("2. an uninterrupted same-writer renewal (still valid) preserves the epoch", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();
    const handle2 = await writer.reconfirmAuthority(); // still comfortably within the lease just confirmed
    expect(handle2.epoch).toBe(handle1.epoch);
  });

  it("3. renewal after this writer's own lease has genuinely expired server-side advances the epoch", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();

    nowSpy.mockReturnValue(baseNow + LEASE_MS + 1); // past the server-recorded expiresAt
    const handle2 = await writer.reconfirmAuthority();

    expect(handle2.epoch).toBe(handle1.epoch + 1);
  });

  it("4. reacquisition over a released foreign lease (foreign token, expiresAt: 0) advances the epoch", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();

    // A foreign writer legitimately released — a real production shape,
    // not this writer's own bookkeeping lapsing.
    await b.set(`lobbies/${code}/writer`, { token: "some-foreign-writer-token", expiresAt: 0 });

    const handle2 = await writer.reconfirmAuthority();
    expect(handle2.epoch).toBe(handle1.epoch + 1);
    expect(writer.holdsAuthority(handle1, FENCE_MARGIN_MS)).toBe(false);
    expect(writer.holdsAuthority(handle2, FENCE_MARGIN_MS)).toBe(true);
  });

  it("5. a failed/uncommitted renewal (blocked by another writer's still-valid lease) changes neither leaseEpoch nor leaseExpiresAt", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();
    expect(writer.holdsAuthority(handle1, FENCE_MARGIN_MS)).toBe(true);

    // A foreign writer's still-valid lease now blocks any renewal.
    await b.set(`lobbies/${code}/writer`, { token: "another-writer-token", expiresAt: baseNow + LEASE_MS });

    await expect(writer.reconfirmAuthority()).rejects.toThrow(/Another Storyteller/);

    // Neither leaseEpoch nor leaseExpiresAt moved: the old handle reads
    // exactly as it did before the failed attempt.
    expect(writer.holdsAuthority(handle1, FENCE_MARGIN_MS)).toBe(true);
  });

  it("6. transaction updater retry: an earlier invocation looks continuous, but the FINAL (committing) invocation proves discontinuity — epoch MUST increment", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();

    const path = `lobbies/${code}/writer`;
    const originalTransaction = b.transaction.bind(b);
    b.transaction = async (txPath, change) => {
      if (txPath !== path) return originalTransaction(txPath, change);
      // Simulated retry: the FIRST invocation Firebase makes sees a
      // fabricated, still-continuous self lease — if this were the
      // deciding invocation, the epoch would NOT move. It is discarded.
      change({ token: writer.token, expiresAt: Date.now() + LEASE_MS });
      // The FINAL invocation — the one whose return value actually
      // commits — sees a foreign, released lease: genuinely discontinuous.
      const finalResult = change({ token: "some-other-writer-token", expiresAt: 0 });
      if (finalResult === undefined) return false;
      return originalTransaction(txPath, () => finalResult);
    };

    const handle2 = await writer.reconfirmAuthority();
    b.transaction = originalTransaction;

    expect(handle2.epoch).toBe(handle1.epoch + 1); // followed the FINAL invocation, not the first
  });

  it("7. transaction updater retry (reverse): an earlier invocation looks discontinuous, but the FINAL (committing) invocation proves continuous self-ownership — epoch must NOT move", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    await writer.start();
    const handle1 = await writer.reconfirmAuthority();

    const path = `lobbies/${code}/writer`;
    const originalTransaction = b.transaction.bind(b);
    b.transaction = async (txPath, change) => {
      if (txPath !== path) return originalTransaction(txPath, change);
      // Simulated retry: the FIRST invocation sees a fabricated foreign,
      // released lease — if this were the deciding invocation, the epoch
      // WOULD move. It is discarded.
      change({ token: "some-other-writer-token", expiresAt: 0 });
      // The FINAL invocation — the one whose return value actually
      // commits — sees this writer's own still-valid lease: genuinely
      // continuous.
      const finalResult = change({ token: writer.token, expiresAt: Date.now() + LEASE_MS });
      if (finalResult === undefined) return false;
      return originalTransaction(txPath, () => finalResult);
    };

    const handle2 = await writer.reconfirmAuthority();
    b.transaction = originalTransaction;

    expect(handle2.epoch).toBe(handle1.epoch); // followed the FINAL invocation only — unchanged
  });

  it("8. a continuously renewed writer keeps an old AuthorityHandle valid across more than one lease duration, as long as authority never became discontinuous", async () => {
    const { b, session } = await setup();
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(baseNow);
    await writer.start();
    const originalHandle = await writer.reconfirmAuthority();

    // Renew several times, always while still comfortably valid — never
    // lapsing — spanning more than one full LEASE_MS in total.
    for (let i = 1; i <= 4; i++) {
      nowSpy.mockReturnValue(baseNow + i * (LEASE_MS / 2));
      await writer.reconfirmAuthority();
    }

    expect(writer.holdsAuthority(originalHandle, FENCE_MARGIN_MS)).toBe(true);
  });
});
