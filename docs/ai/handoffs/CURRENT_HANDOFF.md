# Silverwick Hollow — Current Handoff

**Date:** 2026-09-26\
**State:** Phase 10B implemented on `dev/phase-10b` (store v20); Opus architecture remediation SOL-10B-R1…R9 applied; awaiting targeted Opus re-check. Phase 10B is **not closed**.

Remediation summary: empty seats own no Effects; `expiry` is the sole mechanical duration authority (declared `lifetime` is metadata; Update may change expiry, only correction changes lifetime); corrections re-derive expiry from corrected facts and refuse already-ended results; game-level Effect temporal validity is schema-enforced; suppression is an explicit decision, not derived applicability; resolving a legacy unresolved end is a correction; `manual:` ids are reserved; mutation provenance comes only from Mutation Context; net-zero Effect identities leave no History. Deferred: OPUS-10B-010 (correcting origin to a departed participant).

## Phase 10B implementation status

See `PHASE10B.md` for the implemented model and semantics. Summary:
- store v20: explicit `gameSchemaVersion: 20` on every authoritative game snapshot; Effect `state` (active/suppressed), resolved `expiry` (none / at / unresolved) and typed `parameters`;
- one pure Effect planner (`src/stores/effectResolution.ts`) and one commit seam (`resolveEffects`); `setStatus`/`addEffect`/`removeEffect` are adapters over it; the phase transition commits deterministic expiry in the same replacement;
- v19 → v20 migration: manual → active + none, finite → active + unresolved ("Needs check"), History never consulted;
- presentation registry (`src/stores/effectRegistry.ts`), aggregated Grimoire indicators, Drawer quick/active/advanced Effects, Privacy Mode suppression;
- no Firebase rule, writer or fencing change.

## Current checkpoint

Phase 10A is **CLOSED**.

Phase 10A closure checkpoint:
`d798266b988e49f904aa8f8658c917fd5b7e7abb`

Final Phase 10A Astra verdict:
`PASS — READY FOR SOL CLOSURE`

A focused pre-10B Firebase Go Live lifecycle hotfix is also **CLOSED**.

Hotfix closure checkpoint:
`38b10119544ce2c02590e9bc9c741aab995a91d1`

Final hotfix Luna verdict:
`PASS — READY FOR SOL CLOSURE`

Hotfix final gate:
- **2555/2555** normal tests across 102 files
- **184/184** Firebase emulator tests across 3 files, 0 skipped
- typecheck PASS
- build PASS
- `git diff --check` PASS
- remaining findings: None

The hotfix changed no persisted schema, no Firebase rules, and did not modify the `SessionWriter.commit()` fencing path.

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

## Pre-10B Firebase lifecycle hotfix — frozen behavior

The production-facing Go Live failure was reproduced as deployed-rule drift:
- pre-9R.6 RTDB rules deny the Storyteller startup read of `membershipRevocations`;
- pre-9R.2 rules deny `rosterParticipants`;
- failure occurs before the initial acknowledged projection/checkpoint flush and before runtime writer exposure.

Frozen hotfix behavior:
- runtime connection state is explicit: connecting/reconnecting/live/blocked/stopped/failed;
- the authoritative runtime writer remains hidden until the first acknowledged flush succeeds;
- startup failures do not reinterpret permission-denied reads as empty state;
- failed-start End Game uses a fresh fenced `SessionWriter` and the existing `close()` path;
- local-only **Leave multiplayer — keep game offline** is permitted only after authoritative server proof that the expected session is active with no checkpoint and no local accepted-live evidence;
- that proof fails closed and is re-checked at click time;
- resume hardening only routes through the existing reconnect/retry seam;
- the core commit path and Firebase fencing remain unchanged;
- `npm run rules:verify -- --project <ID>` is the read-only deployed-rules verification command.

Operational status: production Firebase rules were **not** deployed by the hotfix implementation or verification environments. Before treating the real production incident as closed, verify that deployed RTDB rules match `src/firebase/rules.json`, deploy current rules if needed, and smoke-test Go Live → live lobby → End Game.

## Phase 10 roadmap

- **10A Life Transition Semantics + visual life-state grammar — CLOSED**
- **10B Effect Lifecycle + visual Effect indicators — IMPLEMENTED + Opus remediation applied, awaiting re-check**
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

It must point to the current integrated `main` checkpoint **after the Firebase hotfix and this documentation update**. Do not continue from its older pre-hotfix base.

At the start of any new session, verify the exact branch SHA and read:
- `docs/ai/MASTER_IMPLEMENTATION_PLAN.md`
- `docs/ai/handoffs/CURRENT_HANDOFF.md`
- `PHASE10A.md`
- `TERMINOLOGY.md`
- existing Effect/Reminder types, schemas, store commands, projections, migrations and tests.

## Immediate next task

Targeted Opus re-check of the SOL-10B-R1…R9 remediation on `dev/phase-10b`
(verify the exact commit SHA); then Luna mechanical verification and Astra
adversarial review. Implementation completion is not closure.
