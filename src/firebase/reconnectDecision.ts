// Phase 9C.2A — OPUS-001 Core Reconnect Integrity.
//
// A pure decision module: no Firebase, no Zustand, no I/O, no timers, no
// wall-clock. It answers exactly one question — "given what the local store
// remembers and what the server currently shows, what should reconnect do
// with the local game?" — and returns one of four explicit outcomes.
//
// This module intentionally knows nothing about *how* its inputs were
// gathered (lease acquisition, checkpoint parsing, store persistence). The
// caller is responsible for acquiring writer authority first, snapshotting
// local state, validating the remote checkpoint, and then applying the
// returned decision. See src/firebase/storytellerSync.ts.

// GuardStamp/SyncMeta are the canonical persisted shapes, defined in
// src/stores/types.ts (a dependency-free leaf module) and re-exported here
// so consumers of this decision module don't need a second import. This
// keeps the dependency direction consistent with the rest of the codebase
// (src/firebase/* depends on src/stores/*, never the reverse).
export type { GuardStamp, SyncMeta } from "@/stores/types";
import type { GuardStamp, SyncMeta } from "@/stores/types";

/** The (code, sessionId) pair reconnect is being attempted against right now. */
export type ReconnectScope = {
  code: string;
  sessionId: string;
};

export type CheckpointState =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "valid" };

export type ReconnectInputs = {
  /** Whether a local game exists and belongs to the scope being reconnected to. */
  localGameInScope: boolean;
  /** Local game-content sequence number at the moment of comparison. */
  localSeq: number;
  /** Persisted sync metadata, whatever scope it currently claims (or null). */
  sync: SyncMeta | null;
  /** The (code, sessionId) this reconnect attempt targets. */
  scope: ReconnectScope;
  /** Precomputed validity of the remote checkpoint (decoding/schema
   * validation happens in the caller — this module does no I/O). */
  checkpoint: CheckpointState;
  /** The server guard observed immediately after this writer acquired its
   * lease. Null means the server has no writeGuard yet (brand new lobby). */
  remoteGuard: GuardStamp | null;
};

export type ReconnectIncoherentReason =
  /** Malformed remote checkpoint; no evidenced local dirty claim exists.
   * Callers preserve the legacy hard-failure behavior for this reason. */
  | "invalid_checkpoint"
  /** Malformed remote checkpoint while local carries unacknowledged work
   * that a blind restore-or-throw would put at risk. */
  | "invalid_checkpoint_dirty_local"
  /** The server-observed guard revision is behind our own accepted
   * baseline for this exact scope — an apparent server rewind. Never
   * silently guessed past. */
  | "server_rewind";

/** Why a KEEP_LOCAL outcome was reached (Finding B1). A caller must be able
 * to tell a recognized lost acknowledgement apart from every other
 * KEEP_LOCAL reason, because only the lost-ack case carries a guard that
 * must be promoted to durable accepted evidence — synchronously, before any
 * later writer attempt can allocate another revision — or a subsequent
 * writer attempt can overwrite the only record that the lost commit was
 * ever acknowledged. */
export type KeepLocalReason =
  /** No remote checkpoint exists at all (case 1) — nothing to compare. */
  | "no_checkpoint"
  /** The remote guard exactly equals the already-accepted baseline (case
   * 7) — no server commit has advanced beyond what local already knows. */
  | "baseline_current";

export type ReconnectDecision =
  /** Retain the local game untouched. Reconcile membership, then let the
   * normal initial projection flush publish the surviving local snapshot. */
  | { type: "KEEP_LOCAL"; reason: KeepLocalReason }
  /** A commit genuinely landed on the server but this device never
   * recorded its acknowledgement (crash/close between the write landing
   * and the response being processed) — recognized by an exact
   * token/revision match against the persisted unresolved `lastAttempt`
   * (case 5). `recoveredGuard` is that same matched guard, returned so the
   * caller can promote it to durable accepted evidence before anything
   * else can allocate a new revision (Finding B1). Never carries any
   * inference about `ackedGameSeq` — the recovered commit could equally
   * have been a projection flush or a membership-only write, and only
   * durable seq-to-guard evidence (which this decision does not have)
   * could tell those apart. */
  | { type: "KEEP_LOCAL"; reason: "lost_ack_recovered"; recoveredGuard: GuardStamp }
  /** Replace local game with the validated remote checkpoint and adopt the
   * observed remote guard as the new accepted baseline. */
  | { type: "RESTORE" }
  /** Remote has advanced beyond our accepted baseline while local carries
   * unacknowledged work: neither side may be written automatically. */
  | { type: "CONFLICT" }
  /** Blocked recovery: never resolved automatically, no silent fallback. */
  | { type: "INCOHERENT"; reason: ReconnectIncoherentReason };

function guardsEqual(a: GuardStamp, b: GuardStamp): boolean {
  return a.token === b.token && a.revision === b.revision;
}

function scopeMatches(sync: SyncMeta, scope: ReconnectScope): boolean {
  return sync.code === scope.code && sync.sessionId === scope.sessionId;
}

/**
 * Pure reconnect decision. The branches below are ordered by priority
 * (most-certain / most-protective first): absence and validity of the
 * checkpoint are resolved first, then scope evidence, then — whenever an
 * accepted baseline exists — a confirmed server rewind is checked and
 * outranks everything below it (Luna review, Finding 1: a confirmed
 * rewind always outranks lost-ack recovery once a baseline has been
 * accepted), then the exact lost-acknowledgement match, then the
 * no-baseline/equal-baseline/advanced-baseline cases last.
 */
export function decideReconnect(inputs: ReconnectInputs): ReconnectDecision {
  const { localGameInScope, localSeq, sync, scope, checkpoint, remoteGuard } = inputs;

  // 1. No checkpoint exists at all: there is nothing remote to restore, and
  // nothing to conflict with. Local — if any — simply continues.
  if (checkpoint.kind === "absent") return { type: "KEEP_LOCAL", reason: "no_checkpoint" };

  const scopedSync = sync && scopeMatches(sync, scope) ? sync : null;
  const dirty = localGameInScope && scopedSync !== null && localSeq > scopedSync.ackedGameSeq;

  // 2. The remote recovery object itself is malformed. Never discard local
  // work because of that; but where there is no evidenced local claim at
  // stake, preserve the pre-existing hard-failure behavior instead of
  // inventing a new automatic outcome.
  if (checkpoint.kind === "invalid") {
    return dirty
      ? { type: "INCOHERENT", reason: "invalid_checkpoint_dirty_local" }
      : { type: "INCOHERENT", reason: "invalid_checkpoint" };
  }

  // From here, checkpoint.kind === "valid".

  // 3. No sync metadata for this exact scope (legacy v11 store, a brand
  // new scope, or a scope mismatch) — there is no evidence proving local is
  // newer than the checkpoint. This intentionally preserves the pre-9C.2A
  // recovery behavior for legacy/first-time data.
  if (!scopedSync) return { type: "RESTORE" };

  // 4. Apparent server rewind, checked BEFORE lost-ack matching whenever an
  // accepted baseline exists: the server-observed guard is missing
  // entirely, or sits at a revision behind our own accepted baseline for
  // this scope. This must outrank a lost-ack match — restoreRemoteCheckpoint
  // clears lastAttempt on every accepted restore (Finding 1, part A), but
  // this ordering is the defensive second layer: even if some other path
  // ever left stale attempt evidence behind, a confirmed rewind against the
  // CURRENT accepted baseline can never be masked by it. A legitimate
  // lost-ack match is never behind the baseline (see case 6 below), so this
  // never rejects a genuine lost acknowledgement — only a rewind.
  if (scopedSync.ackedGuard && (!remoteGuard || remoteGuard.revision < scopedSync.ackedGuard.revision)) {
    return { type: "INCOHERENT", reason: "server_rewind" };
  }

  // 5. Lost acknowledgement: recognized ONLY by an exact atomic match of the
  // persisted unresolved attempt's token AND revision against what the
  // server now shows. A token alone (e.g. from a brand new writer) or a
  // revision alone is never sufficient — never combine a token from one
  // writer with a revision ceiling generated by another. Reached only after
  // the rewind check above has already cleared this remote guard as at or
  // ahead of any accepted baseline, so a genuine lost-ack match (always at
  // or ahead of the baseline it was attempted against) is never rejected.
  // Finding B1: this specific reason carries `recoveredGuard` — the exact
  // matched guard — so the caller can promote it to durable accepted
  // evidence synchronously, before anything else can allocate a new
  // revision over it. Deliberately not decomposed into a bare KEEP_LOCAL:
  // every other KEEP_LOCAL reason needs no such promotion.
  if (scopedSync.lastAttempt && remoteGuard && guardsEqual(scopedSync.lastAttempt, remoteGuard)) {
    return { type: "KEEP_LOCAL", reason: "lost_ack_recovered", recoveredGuard: remoteGuard };
  }

  // 6. We have no confirmed baseline yet for this scope (e.g. the very
  // first attempt for this scope failed in some other way, or this scope's
  // sync was established without ever having a success). With no baseline
  // to compare the remote guard against, and no lost-ack match, prefer the
  // same "no evidence" bias as case 3.
  if (!scopedSync.ackedGuard) return { type: "RESTORE" };

  // By construction, remoteGuard cannot be null here: case 4 already
  // returned INCOHERENT(server_rewind) if an accepted baseline (just
  // reconfirmed non-null above) existed alongside a null remoteGuard. This
  // is a defensive restatement of that invariant for the type checker,
  // not a new runtime branch — it fails safe to INCOHERENT rather than
  // ever reaching the guard-equality comparison below with a null value.
  if (!remoteGuard) return { type: "INCOHERENT", reason: "server_rewind" };

  // 7. Remote guard equals the accepted baseline exactly: no server commit
  // has advanced beyond what local already knows about. Keep local as-is
  // (this also means: do not clear undo).
  if (guardsEqual(remoteGuard, scopedSync.ackedGuard)) return { type: "KEEP_LOCAL", reason: "baseline_current" };

  // 8. Remote has advanced beyond the accepted baseline and this is not a
  // recognized lost acknowledgement. This is the core second-device safety
  // rule: a stale device may not publish over newer state written by
  // another Storyteller device, but a clean stale device may safely adopt it.
  return dirty ? { type: "CONFLICT" } : { type: "RESTORE" };
}
