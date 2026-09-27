# Silverwick Hollow — Current Handoff

**Date:** 2026-09-27\
**State:** Phase 10B is **CLOSED** and integrated into `main`. Phase 10C — Reminder Workflow + Visual Reminder Tokens is **IMPLEMENTED — ready for Luna verification** (not closed). See `PHASE10C.md`.

## Phase 10C — implemented, awaiting verification

Implemented from `70864ada51f887399d5d3529a450204468fc8d65` per the Sol implementation contract (after the Claude Chat / Opus architecture challenge). Store v21.

- Reminders are participant-bound, Storyteller-private, non-authoritative notation; nothing mechanical reads `player.reminders` (guarded by `src/stores/reminderArchitecture.test.ts`).
- Strict v21 `ReminderRecord` (no lifetime; optional presentation-only `cleanupCue`); empty seats own no Reminders; duplicate ids and future `createdAt` rejected.
- One pure planner (`src/stores/reminderResolution.ts`) + one commit seam (`resolveReminders`); `addReminder`/`removeReminder` are thin adapters.
- v20 -> v21 migration: empty-seat Reminders dropped, finite lifetimes -> `unresolved` ("Needs check"), incoherent legacy `createdAt` omitted, History never rewritten; legacy Reminder History stays valid.
- Grimoire notation grammar (distinct from Effects, aggregation, `+N more`, words not colour, accessible summary); Drawer fast path + progressive disclosure; Privacy Mode DOM absence.
- No Firebase rule / writer / fencing change.

Next: Luna verification -> Astra adversarial review -> Sol adjudication -> closure verification -> Sol closure -> integration into `main`.

## Phase 10B — CLOSED

Final reviewed implementation checkpoint (before docs-only closure metadata):
`3c9e20f4506258bab143b5f20750deb34b290379`

The docs-only closure commit on top of it is the integration checkpoint; `main` was fast-forwarded to it and `dev/phase-10c` was created from that exact `main`. Verify exact SHAs rather than branch names.

Final verification evidence:
- typecheck PASS
- normal tests **2738/2738 across 107 files**
- Firebase emulator tests **184/184**, 0 skipped
- production build PASS
- `git diff --check` PASS
- Luna verdict: **PASS — READY FOR ASTRA ADVERSARIAL REVIEW**
- Astra final verdict: **PASS — ASTRA-10B-001..004 CLOSED; READY FOR SOL CLOSURE**
- Sol verdict: **CLOSED — READY FOR INTEGRATION**

Remaining Blocker/High/Medium findings: **None.**

Known non-blocking / deferred:
- LUNA-10B-001 — duplicate Role choices in the advanced Effect Character dropdown — LOW
- OPUS-10B-010 — correction cannot assign a departed participant as Effect origin
- Reminder empty-seat inheritance → Phase 10C
- character-target convention → Phase 10F
- accepted identical remove/reapply array-order behavior
- accepted equality-based expiry-coupling ambiguity

### Phase 10B frozen behavior (summary)

See `PHASE10B.md` for the full model and semantics.
- store v20: explicit `gameSchemaVersion: 20` on every authoritative game snapshot; Effect `state` (active/suppressed), resolved `expiry` (none / at / unresolved) and typed `parameters`;
- one pure Effect planner (`src/stores/effectResolution.ts`) and one commit seam (`resolveEffects`); `setStatus`/`addEffect`/`removeEffect` are adapters over it; the phase transition commits deterministic expiry in the same replacement;
- `expiry` is the sole mechanical duration authority (declared `lifetime` is metadata; Update may change expiry, only correction changes lifetime); corrections re-derive expiry only while still coupled to the old facts;
- empty seats own no Effects; game-level Effect temporal validity is schema-enforced; suppression is an explicit decision, not derived applicability; `manual:` ids are reserved; mutation provenance comes only from the runtime-validated Mutation Context; net-zero Effect identities leave no History; resolving a legacy `unresolved` end is a correction;
- v19 → v20 migration: manual → active + none, finite → active + unresolved ("Needs check"), History never consulted; v20 evidence blocks every legacy step per entry;
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
- **10B Effect Lifecycle + visual Effect indicators — CLOSED**
- **10C Reminder Workflow + visual Reminder tokens — IMPLEMENTED, awaiting Luna verification**
- 10D Role Transitions
- 10E Alignment Transitions
- 10F Guided Ability Resolution / Night Actions
- 10G Advanced Storyteller bookkeeping / final visual integration

## Standing Phase 10 UX invariant

Phase 10 may increase Silverwick's mechanical intelligence, but routine Storyteller operation must remain fast, visually clear and low-friction. Complexity belongs under the interface; common table actions use progressive disclosure and should not ask the Storyteller for information Silverwick already knows.

This requirement continues through 10C–10G.

## Phase 10C starting intent (historical -- answered by the Sol contract; see `PHASE10C.md`)

The list of questions the architecture challenge answered.

Phase 10C must define the smallest correct Reminder primitive/workflow that supports manual Storyteller use now and the future ability engine later.

Known areas to challenge:
- Reminder identity;
- target;
- source / provenance;
- placement / update / removal;
- lifetime, where applicable;
- ParticipantId durability;
- stacking;
- correction semantics;
- Undo / recovery;
- privacy / projections;
- accessible visual Reminder tokens;
- the future ability-engine seam;
- the relationship between authoritative Effects and Reminders;
- the already-known empty-seat Reminder inheritance issue (10B made empty seats own no Effects; the analogous Reminder rule was deliberately not changed in 10B).

Frozen principles carried into 10C:
- If a mechanical condition is authoritative as an Effect, a Reminder may visualize or help bookkeep it but must **never** become a second independent source of that mechanical truth.
- Routine Storyteller Reminder placement/removal should be fast and visually obvious. Advanced detail should remain progressively disclosed.

Do not implement Role ability evaluation in 10C.

## Starting branch

Use:
`dev/phase-10c`

It was created from the exact integrated `main` carrying the Phase 10B closure commit and has no implementation changes.

At the start of any new session, verify the exact branch SHA and read:
- `docs/ai/MASTER_IMPLEMENTATION_PLAN.md`
- `docs/ai/handoffs/CURRENT_HANDOFF.md`
- `PHASE10A.md`
- `PHASE10B.md`
- `TERMINOLOGY.md`
- existing Reminder types, schemas, store commands, projections, migrations, UI and tests, and the Phase 10B Effect seam they must not duplicate.

## Immediate next task

**Luna verification** of the Phase 10C implementation. Verify the exact
implementation commit SHA (not branch names) and read `PHASE10C.md`.
