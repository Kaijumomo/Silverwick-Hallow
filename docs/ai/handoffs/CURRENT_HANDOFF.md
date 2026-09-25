# Silverwick Hollow — Current Handoff

**Date:** 2026-09-25  
**State:** Post-Phase-10A closure; ready to begin Phase 10B architecture work.

## Current checkpoint

Phase 10A is **CLOSED**.

Closure checkpoint:
`d798266b988e49f904aa8f8658c917fd5b7e7abb`

Final Astra verdict:
`PASS — READY FOR SOL CLOSURE`

Final gate:
- **2516/2516** normal tests across 99 files
- **178/178** Firebase emulator tests, 0 skipped
- typecheck PASS
- build PASS
- `git diff --check` PASS
- clean worktree
- remaining findings: None

## Frozen architecture

- Current State is authoritative.
- History is explanatory, not authoritative.
- Information Delivery is what was communicated.
- PlayerId is reusable; ParticipantId is continuous participation; ParticipantRef is durable history.
- Actual/Shown Role and Actual/Shown Alignment remain distinct.
- Storyteller is the only authoritative game-state writer.
- Firebase lease/guard/revision fencing remains load-bearing.
- Public/private/self projections remain allowlisted.
- Nominations/voting remain out of scope.

## Phase 10A frozen behavior

Life Current State:
- `alive`
- `ghostVote`
- `exiled`
- `abilityUsed`

Recent mechanically relevant Life Events live in bounded `lifeEventWindow` with explicit coverage.

Life Events:
- death
- execution
- exile
- resurrection

Key semantics:
- execution ≠ automatically death;
- exile ≠ automatically death;
- true resurrection ≠ status correction;
- death grants a fresh ghost vote;
- Setup starting life canonicalizes only at genuine Setup → Night 1;
- live play cannot return to Setup via ordinary phase APIs;
- live time is monotonic: Night N → Day N → Night N+1;
- stale confirmations are ParticipantId + Game Moment bound;
- Privacy Mode closes/suppresses private Life Event dialogs.

The generic Life transaction seam supports ordered multiple events for the same participant in one atomic resolution. Al-Hadikhia-shaped resurrection/death sequencing has been proven without splitting the transaction.

## Important review history

Luna caught:
1. migrated Setup life anomalies entering Night 1;
2. live → Setup re-triggering starting canonicalization.

Astra caught:
1. backward phase progression manufacturing false known absence;
2. stale confirmation mutating a replacement occupant;
3. private Life Event dialog leakage under Privacy Mode;
4. one-event-per-participant restriction blocking legitimate atomic resolution.

All were remediated. Final Astra closure found no remaining findings.

A later Luna concern about manually fabricating a context-matching confirmation acknowledgment was adjudicated **not** to be a security defect: the acknowledgment is trusted Storyteller-side context confirmation, not a cryptographic capability. The security boundary is Storyteller identity + single-writer lease/fencing + Firebase rules.

## Phase 10 roadmap

- **10A Life Transition Semantics + visual life-state grammar — CLOSED**
- **10B Effect Lifecycle + visual Effect indicators — NEXT**
- 10C Reminder Workflow + visual Reminder tokens
- 10D Role Transitions
- 10E Alignment Transitions
- 10F Guided Ability Resolution / Night Actions
- 10G Advanced Storyteller bookkeeping / final visual integration

## Phase 10B starting intent

10B operationalizes the structured Effect model introduced in Phase 9D.

Target examples:
- Poisoned
- Drunk
- Protected
- future generic effects

10B must define:
- effect identity/type/source/target/provenance;
- authoritative Current State ownership;
- apply/update/remove/correct semantics;
- lifetime and deterministic expiry semantics;
- phase rollover;
- stacking/replacement/conflict rules;
- Undo/recovery/reconnect;
- public/self/private projection behavior;
- Privacy Mode handling;
- accessible visual grammar;
- the authoritative seam future ability logic will call.

Do not implement complete Role ability parsing/evaluation in 10B.

## Starting branch

Use:
`dev/phase-10b`

It must be created from the integrated `main` checkpoint **after this documentation commit**.

At the start of any new session, verify the exact branch SHA and read:
- `docs/ai/MASTER_IMPLEMENTATION_PLAN.md`
- `docs/ai/handoffs/CURRENT_HANDOFF.md`
- `PHASE10A.md`
- `TERMINOLOGY.md`
- existing Effect/Reminder types, schemas, store commands, projections, migrations and tests.

## Immediate next task

Do not code yet.

First answer:

> What is the smallest correct authoritative Effect lifecycle for Silverwick Hollow that supports manual Storyteller operation now and future rules-aware ability resolution later, while preserving Current State/History separation, ParticipantId durability, phase rollover, Undo/recovery, privacy/projections, source/provenance, stacking/replacement rules and deterministic-vs-judgment boundaries?
