import { describe, expect, it } from "vitest";
import {
  decideReconnect,
  type GuardStamp,
  type ReconnectInputs,
  type SyncMeta,
} from "./reconnectDecision";

const SCOPE = { code: "ABCD2345", sessionId: "session-1" };
const guard = (token: string, revision: number): GuardStamp => ({ token, revision });
const sync = (overrides: Partial<SyncMeta> = {}): SyncMeta => ({
  code: SCOPE.code,
  sessionId: SCOPE.sessionId,
  ackedGuard: guard("writer-A", 5),
  ackedGameSeq: 10,
  lastAttempt: null,
  ...overrides,
});
const base = (overrides: Partial<ReconnectInputs> = {}): ReconnectInputs => ({
  localGameInScope: true,
  localSeq: 10,
  sync: sync(),
  scope: SCOPE,
  checkpoint: { kind: "valid" },
  remoteGuard: guard("writer-A", 5),
  ...overrides,
});

describe("decideReconnect: no checkpoint", () => {
  it("KEEP_LOCAL when there is no remote checkpoint at all, even with sync metadata present", () => {
    expect(decideReconnect(base({ checkpoint: { kind: "absent" } }))).toEqual({ type: "KEEP_LOCAL", reason: "no_checkpoint" });
  });
  it("KEEP_LOCAL when there is no checkpoint and also no local game (nothing to restore, nothing to keep)", () => {
    expect(decideReconnect(base({ checkpoint: { kind: "absent" }, localGameInScope: false, sync: null }))).toEqual({ type: "KEEP_LOCAL", reason: "no_checkpoint" });
  });
});

describe("decideReconnect: legacy / no sync metadata / scope mismatch", () => {
  it("RESTORE when sync is null (legacy v11 store) and a valid checkpoint exists", () => {
    expect(decideReconnect(base({ sync: null }))).toEqual({ type: "RESTORE" });
  });
  it("RESTORE when sync exists but for a different code (scope mismatch)", () => {
    expect(decideReconnect(base({ sync: sync({ code: "WXYZ6789" }) }))).toEqual({ type: "RESTORE" });
  });
  it("RESTORE when sync exists but for a different sessionId (scope mismatch)", () => {
    expect(decideReconnect(base({ sync: sync({ sessionId: "other-session" }) }))).toEqual({ type: "RESTORE" });
  });
  it("RESTORE when sync matches scope but has never recorded a confirmed baseline (ackedGuard null, no lost-ack match)", () => {
    expect(decideReconnect(base({ sync: sync({ ackedGuard: null }), remoteGuard: guard("writer-A", 1) }))).toEqual({ type: "RESTORE" });
  });
  it("a legacy/no-evidence RESTORE does not require local to exist at all", () => {
    expect(decideReconnect(base({ sync: null, localGameInScope: false }))).toEqual({ type: "RESTORE" });
  });
});

describe("decideReconnect: equal guard baseline", () => {
  it("KEEP_LOCAL when the remote guard exactly equals the accepted baseline (no server commit has advanced)", () => {
    expect(decideReconnect(base({ remoteGuard: guard("writer-A", 5) }))).toEqual({ type: "KEEP_LOCAL", reason: "baseline_current" });
  });
  it("KEEP_LOCAL at equal baseline even when local is dirty (must not clear undo just because nothing advanced)", () => {
    expect(decideReconnect(base({ remoteGuard: guard("writer-A", 5), localSeq: 999 }))).toEqual({ type: "KEEP_LOCAL", reason: "baseline_current" });
  });
});

describe("decideReconnect: remote advanced beyond baseline — clean vs dirty local", () => {
  it("RESTORE when remote advanced beyond baseline and local is clean (localSeq <= ackedGameSeq)", () => {
    expect(decideReconnect(base({ remoteGuard: guard("writer-B", 6), sync: sync({ ackedGameSeq: 10 }), localSeq: 10 }))).toEqual({ type: "RESTORE" });
  });
  it("CONFLICT when remote advanced beyond baseline and local is dirty (localSeq > ackedGameSeq) — the core second-device safety rule", () => {
    expect(decideReconnect(base({ remoteGuard: guard("writer-B", 6), sync: sync({ ackedGameSeq: 10 }), localSeq: 11 }))).toEqual({ type: "CONFLICT" });
  });
  it("CONFLICT for a foreign newer guard (different token, higher revision) with dirty local", () => {
    expect(decideReconnect(base({ remoteGuard: guard("some-other-device-writer", 42), sync: sync({ ackedGuard: guard("writer-A", 5), ackedGameSeq: 3 }), localSeq: 4 }))).toEqual({ type: "CONFLICT" });
  });
  it("RESTORE for a foreign newer guard when local is clean — a stale-but-clean device safely adopts newer remote state", () => {
    expect(decideReconnect(base({ remoteGuard: guard("some-other-device-writer", 42), sync: sync({ ackedGuard: guard("writer-A", 5), ackedGameSeq: 3 }), localSeq: 3 }))).toEqual({ type: "RESTORE" });
  });
  it("dirty requires localGameInScope: no local game means no evidenced claim, so RESTORE even if localSeq > ackedGameSeq", () => {
    expect(decideReconnect(base({ remoteGuard: guard("writer-B", 6), sync: sync({ ackedGameSeq: 10 }), localSeq: 11, localGameInScope: false }))).toEqual({ type: "RESTORE" });
  });
});

describe("decideReconnect: lost acknowledgement", () => {
  it("KEEP_LOCAL (reason lost_ack_recovered, carrying the recovered guard) when the remote guard exactly matches the persisted unresolved lastAttempt (token AND revision)", () => {
    expect(decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-A", 5), lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-A", 6),
    }))).toEqual({ type: "KEEP_LOCAL", reason: "lost_ack_recovered", recoveredGuard: guard("writer-A", 6) });
  });
  it("lost-ack recognition does not require local to be dirty (an attempt may have been membership-only)", () => {
    expect(decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-A", 5), ackedGameSeq: 10, lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-A", 6),
      localSeq: 10,
    }))).toEqual({ type: "KEEP_LOCAL", reason: "lost_ack_recovered", recoveredGuard: guard("writer-A", 6) });
  });
  it("mismatched revision (same token as lastAttempt, different revision) is NOT a lost-ack match — falls through to advanced-baseline handling", () => {
    expect(decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-A", 5), lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-A", 7),
      localSeq: 11,
    }))).toEqual({ type: "CONFLICT" });
  });
  it("mismatched token (same revision as lastAttempt, different token) is NOT a lost-ack match — never combine a token from one writer with a revision from another", () => {
    expect(decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-A", 5), lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-C", 6),
      localSeq: 11,
    }))).toEqual({ type: "CONFLICT" });
  });
  it("does not identify a lost acknowledgement merely because a fresh writer token exists with no lastAttempt recorded", () => {
    expect(decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-A", 5), lastAttempt: null }),
      remoteGuard: guard("writer-A", 5),
    }))).toEqual({ type: "KEEP_LOCAL", reason: "baseline_current" }); // via equal-baseline, not lost-ack
  });
});

describe("decideReconnect: server rewind", () => {
  it("INCOHERENT when the remote guard revision is behind the accepted baseline", () => {
    expect(decideReconnect(base({ sync: sync({ ackedGuard: guard("writer-A", 9) }), remoteGuard: guard("writer-A", 3) }))).toEqual({ type: "INCOHERENT", reason: "server_rewind" });
  });
  it("INCOHERENT when the server shows no guard at all despite a confirmed local baseline", () => {
    expect(decideReconnect(base({ sync: sync({ ackedGuard: guard("writer-A", 9) }), remoteGuard: null }))).toEqual({ type: "INCOHERENT", reason: "server_rewind" });
  });
  it("never silently guesses past a rewind even when local is clean", () => {
    expect(decideReconnect(base({ sync: sync({ ackedGuard: guard("writer-A", 9), ackedGameSeq: 20 }), remoteGuard: guard("writer-A", 3), localSeq: 20 }))).toEqual({ type: "INCOHERENT", reason: "server_rewind" });
  });

  // Luna review (Finding 1): server rewind must outrank lost-ack recovery
  // whenever an accepted baseline exists — checked BEFORE lost-ack matching,
  // not after. A stale lastAttempt left over from a prior local lineage
  // (restoreRemoteCheckpoint now clears it, but this is the defensive
  // second layer) must never let an exact-match coincidence against a
  // rewound guard masquerade as a legitimate lost acknowledgement.
  it("server rewind returns INCOHERENT even when a stale lastAttempt exactly matches the rewound remote guard", () => {
    const decision = decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-B", 20), ackedGameSeq: 20, lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-A", 6), // exactly equals lastAttempt, but is BEHIND the accepted baseline (revision 20)
      localSeq: 20,
    }));
    expect(decision).toEqual({ type: "INCOHERENT", reason: "server_rewind" });
    expect(decision).not.toEqual({ type: "KEEP_LOCAL" });
  });
  it("a stale lastAttempt equal to an older rewound server guard cannot return KEEP_LOCAL, even with local dirty", () => {
    const decision = decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-B", 20), ackedGameSeq: 5, lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-A", 6),
      localSeq: 11, // dirty relative to ackedGameSeq
    }));
    expect(decision.type).toBe("INCOHERENT");
    expect(decision).not.toEqual({ type: "KEEP_LOCAL" });
  });
  it("a legitimate lost acknowledgement genuinely AHEAD of the accepted baseline still returns KEEP_LOCAL (rewind check does not reject it)", () => {
    expect(decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-A", 5), ackedGameSeq: 5, lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-A", 6), // ahead of the baseline (5) — a genuine lost ack, not a rewind
      localSeq: 6,
    }))).toEqual({ type: "KEEP_LOCAL", reason: "lost_ack_recovered", recoveredGuard: guard("writer-A", 6) });
  });
  it("exact lost acknowledgement with no prior accepted baseline (ackedGuard null) still returns KEEP_LOCAL — the rewind gate only fires when a baseline exists", () => {
    expect(decideReconnect(base({
      sync: sync({ ackedGuard: null, ackedGameSeq: 0, lastAttempt: guard("writer-A", 1) }),
      remoteGuard: guard("writer-A", 1),
      localSeq: 1,
    }))).toEqual({ type: "KEEP_LOCAL", reason: "lost_ack_recovered", recoveredGuard: guard("writer-A", 1) });
  });
});

describe("decideReconnect: invalid checkpoint", () => {
  it("INCOHERENT (invalid_checkpoint_dirty_local) when the checkpoint is malformed and local carries an evidenced dirty claim", () => {
    expect(decideReconnect(base({ checkpoint: { kind: "invalid" }, sync: sync({ ackedGameSeq: 10 }), localSeq: 11 }))).toEqual({ type: "INCOHERENT", reason: "invalid_checkpoint_dirty_local" });
  });
  it("INCOHERENT (invalid_checkpoint) when the checkpoint is malformed and local is clean — callers preserve the legacy hard-failure behavior for this reason", () => {
    expect(decideReconnect(base({ checkpoint: { kind: "invalid" }, sync: sync({ ackedGameSeq: 10 }), localSeq: 10 }))).toEqual({ type: "INCOHERENT", reason: "invalid_checkpoint" });
  });
  it("INCOHERENT (invalid_checkpoint) when the checkpoint is malformed and there is no local game in scope at all", () => {
    expect(decideReconnect(base({ checkpoint: { kind: "invalid" }, localGameInScope: false }))).toEqual({ type: "INCOHERENT", reason: "invalid_checkpoint" });
  });
  it("INCOHERENT (invalid_checkpoint) when the checkpoint is malformed and sync metadata does not exist for this scope (no evidenced claim possible)", () => {
    expect(decideReconnect(base({ checkpoint: { kind: "invalid" }, sync: null, localSeq: 999 }))).toEqual({ type: "INCOHERENT", reason: "invalid_checkpoint" });
  });
  it("an invalid checkpoint is never silently restored nor silently kept as a KEEP_LOCAL/RESTORE decision", () => {
    for (const localSeq of [0, 5, 10, 11, 999]) {
      const decision = decideReconnect(base({ checkpoint: { kind: "invalid" }, localSeq }));
      expect(decision.type).toBe("INCOHERENT");
    }
  });
});

describe("decideReconnect: KEEP_LOCAL reason discrimination (Finding B1)", () => {
  it("lost_ack_recovered is distinguishable from every other KEEP_LOCAL reason and carries the recovered guard", () => {
    const recovered = decideReconnect(base({
      sync: sync({ ackedGuard: guard("writer-A", 5), lastAttempt: guard("writer-A", 6) }),
      remoteGuard: guard("writer-A", 6),
    }));
    expect(recovered.type).toBe("KEEP_LOCAL");
    if (recovered.type !== "KEEP_LOCAL") throw new Error("unreachable");
    expect(recovered.reason).toBe("lost_ack_recovered");
    if (recovered.reason !== "lost_ack_recovered") throw new Error("unreachable");
    expect(recovered.recoveredGuard).toEqual(guard("writer-A", 6));

    const noCheckpoint = decideReconnect(base({ checkpoint: { kind: "absent" } }));
    expect(noCheckpoint).toEqual({ type: "KEEP_LOCAL", reason: "no_checkpoint" });
    expect(noCheckpoint).not.toEqual(recovered);
    expect("recoveredGuard" in noCheckpoint).toBe(false);

    const baselineCurrent = decideReconnect(base({ remoteGuard: guard("writer-A", 5) }));
    expect(baselineCurrent).toEqual({ type: "KEEP_LOCAL", reason: "baseline_current" });
    expect(baselineCurrent).not.toEqual(recovered);
    expect("recoveredGuard" in baselineCurrent).toBe(false);
  });
});

describe("decideReconnect: decision purity / determinism", () => {
  it("is a pure function: identical inputs always produce identical (deep-equal) output", () => {
    const inputs = base({ remoteGuard: guard("writer-B", 6), localSeq: 11 });
    const first = decideReconnect(inputs);
    const second = decideReconnect(inputs);
    expect(first).toEqual(second);
  });
  it("never mutates its inputs", () => {
    const inputs = base();
    const snapshot = JSON.parse(JSON.stringify(inputs));
    decideReconnect(inputs);
    expect(inputs).toEqual(snapshot);
  });
});
