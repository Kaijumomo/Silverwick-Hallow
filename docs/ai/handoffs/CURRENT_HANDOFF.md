# Silverwick Hollow — Current Handoff

**Date:** 2026-09-30\
**State:** Phase 10D — Role Transitions is **CLOSED** (Sol: **CLOSED — READY FOR INTEGRATION**). Its docs-only closure commit is the integration checkpoint. Integration is rules-first: the Phase 10D Firebase Rules are deployed to production and verified, then `main` is fast-forwarded to that commit, then `dev/phase-10e` is created from that exact `main`. Phase 10E — Alignment Transitions is **NEXT**; it has **not** been designed yet.

## Phase 10D — CLOSED

Final reviewed implementation checkpoint (before docs-only closure metadata):
`62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`

The docs-only closure commit on top of it is the integration checkpoint: `main` is fast-forwarded to it only after the rules-first release step below, and `dev/phase-10e` is created from that exact `main`. Verify exact SHAs rather than branch names.

Lineage on top of `c6fce7dd77e50baf4a34c75529ad48490558296d`: implementation `b2e0c6bf4d43537d770fcfcc2cc9b4abca22c4fe` → post-Luna remediation (same-Role Traveler `restart`) `4ca328256058c48c834c968d63a61a732364227f` → SOL-10D-R2 Astra remediation ASTRA-10D-001…004 + C01/C02 Life amendments `921b73ef102ff3d9b4456b78c759f571893c9b8c` → SOL-10D-C03 duplicate RoleId ownership `a5ef611150ee85f76915e5b4eece828c6ecd30d6` → SOL-10D-C03-R1 Setup compatibility `444820274eb5fd672d567bbc9c95bf24fd0865ef` → CLOSURE-01 immutable pending Traveler requests / CLOSURE-02 deferred request liveness / CLOSURE-03 canonical Traveler downstream ownership `a614496187bbf43cd4541d8a73a30645d7d7bdf2` → LUNA-CLOSURE-03-R1 Almanac RoleId uniqueness `b4068b4f517e51015c3c974d73ddc6503036f416` → ASTRA-FINAL-01 stopped-writer lifecycle `62055408e75ba33a9b1900e19b1d4bcd3cbf93aa` → docs-only closure.

Schema / store version: **v22**.

Final verification evidence at `62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`:
- typecheck PASS
- normal tests **3172/3172 across 119 files**
- Firebase emulator tests **201/201**, 0 skipped
- production build PASS
- `git diff --check` PASS
- final reviewed worktree clean
- ASTRA-FINAL-01: independently mechanically verified by Luna at the final target (real Firebase-emulator regression at all three awaited-read boundaries; every expected no-mutation assertion passed; complete gate passed)
- Sol verdict: **CLOSED — READY FOR INTEGRATION**

Remaining Blocker/High/Medium implementation or contract findings: **None.** CLOSURE-02 and CLOSURE-03 are closed.

Evidence limitation: the final requested Astra re-confirmation of ASTRA-FINAL-01 could not be executed, because that review environment repeatedly classified the authorized local concurrency regression task as cybersecurity content. Sol adjudicated this as a **review-environment limitation**, not a remaining product defect or product evidence gap: Astra originally established the defect, the exact remediation was implemented, and Luna independently executed the real-emulator regression at all three boundaries with every expected assertion and the complete gate passing. There is **no** Astra PASS for a post-`62055408` confirmation — that run did not occur.

### Release order — Firebase Rules first

Phase 10D changed `src/firebase/rules.json`: a player's pending Traveler request is immutable for the player until the Storyteller or the membership lifecycle clears it. The rules enforce that for every client, including older ones; the new client only discourages a replacement. The web client ships from `main` automatically, but rules change only through `npm run rules:deploy`. Therefore:

1. `npx firebase use <PROJECT_ID>` then `npm run rules:deploy` (Realtime Database rules only);
2. `npm run rules:verify -- --project <PROJECT_ID>` (add `--instance <DB_INSTANCE>` for a non-default instance) must exit 0 with the deployed rules identical to `src/firebase/rules.json`;
3. only then fast-forward `main` to the Phase 10D closure commit.

### Phase 10D frozen behavior (summary)

See `PHASE10D.md` for the full model and semantics.
- `actualRole` is authoritative Current State; `shownRole` / perception stays separate; Actual Alignment stays separate from Role (10D never changes it).
- One participant-bound, pure Role transaction seam (`planRoleTransaction` / `applyRolePlan`, committed through `resolveRoles`); gameplay Role change, Role correction and perception change are distinct; multi-participant Role resolution is atomic (one replacement, one Undo entry, one localSeq step).
- Ordinary ↔ Traveler transitions are supported; a Traveler arrival correction is `preserve` (default) or `restart`.
- Role History is explanatory only; ParticipantId binding refuses stale intents.
- Canonical Role ownership: first-definition ownership for legacy script duplicates, canonical Traveler precedence, ASTRA-10D-004 Fabled/Loric protection — shared by every Role consumer, downstream lists included.
- A player's pending Traveler request is immutable until the Storyteller or membership lifecycle clears it; a later request is a new generation; an in-flight Storyteller callback passes a final synchronous writer-lifetime gate before any local Role mutation (ASTRA-FINAL-01).
- Role changes preserve Life, Effects, Reminders and Actual Alignment unless a separately authorized primitive changes them.
- Store/game schema v22 migration behavior preserved.

## Phase 10C — CLOSED

Final reviewed implementation checkpoint (before docs-only closure metadata):
`ca808fa18e97d758750aad63ceacc2bea3d8f627`

The docs-only closure commit on top of it is the integration checkpoint; `main` was fast-forwarded to it and `dev/phase-10d` was created from that exact `main`. Verify exact SHAs rather than branch names.

Lineage on top of `70864ada51f887399d5d3529a450204468fc8d65`: implementation `94c93390c8cf4bea915b1319fc2910cac81b5ed7` → Luna remediation LUNA-10C-001/002 `7ddc3fb9f566f429a5c5a6e0f4d0b8bbbabb5ae4` → Astra remediation ASTRA-10C-001…004 `ca808fa18e97d758750aad63ceacc2bea3d8f627` → docs-only closure.

Schema / store version: **v21**.

Final verification evidence:
- typecheck PASS
- normal tests **2923/2923 across 112 files**
- Firebase emulator tests **184/184**, 0 skipped
- production build PASS
- `git diff --check` PASS
- Luna final verdict: **PASS — ASTRA-10C-001..004 MECHANICALLY CLOSED; READY FOR ASTRA TARGETED CLOSURE REVIEW**
- Astra final verdict: **PASS — ASTRA-10C-001..004 CLOSED; READY FOR SOL CLOSURE**
- Sol verdict: **CLOSED — READY FOR INTEGRATION**

Remaining Blocker/High/Medium findings: **None.**

Known non-blocking / deferred:
- ASTRA-10C-005 — LOW — the Reminder planner should require `intent.kind` to be an own string property before discriminator lookup; malformed runtime input can otherwise throw or inherit `kind`.
- canonical per-character Reminder token disposition → Phase 10F
- departed-origin correction limitation (same as OPUS-10B-010)

### Phase 10C frozen behavior (summary)

See `PHASE10C.md` for the full model and semantics.
- Reminders are participant-bound, Storyteller-private, non-authoritative notation; mechanics never read Reminders as truth (guarded by `src/stores/reminderArchitecture.test.ts`).
- Current occupied ParticipantIds are globally unique within a game snapshot (enforced by `StorytellerGamePersistedSchema`).
- Empty seats own no Reminders; every new participation instance starts with none.
- Origin (`sourceParticipant`/`sourceCharacter`) and mutation provenance (Mutation Context only) remain separate.
- Cleanup cues are presentation-only; Reminders never expire automatically.
- Legacy History is preserved rather than rewritten; legacy Reminder History is add/remove only.
- One pure planner/apply seam (`planReminderTransaction` / `applyReminderPlan`, `src/stores/reminderResolution.ts`) and one commit seam (`resolveReminders`) remain available for future 10F composition.
- Store v21 migration: explicit marker 20/21 routing; each game entry's own version routes old store migrations; malformed data is never repaired.
- No Firebase rule, writer or fencing change.

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
- **10C Reminder Workflow + visual Reminder tokens — CLOSED**
- **10D Role Transitions — CLOSED**
- **10E Alignment Transitions — NEXT (architecture challenge first)**
- 10F Guided Ability Resolution / Night Actions
- 10G Advanced Storyteller bookkeeping / final visual integration

## Standing Phase 10 UX invariant

Phase 10 may increase Silverwick's mechanical intelligence, but routine Storyteller operation must remain fast, visually clear and low-friction. Complexity belongs under the interface; common table actions use progressive disclosure and should not ask the Storyteller for information Silverwick already knows.

This requirement continues through 10C–10G.

## Phase 10E starting intent

10E is **not yet designed**. Nothing below is a decision; it is the roadmap scope the architecture challenge must examine: Actual Alignment mutation semantics, shown/perceived alignment where needed, History/provenance, correction vs gameplay transition -- consistent with the frozen 10A Life, 10B Effect, 10C Reminder and 10D Role seams, ParticipantId identity and the Actual/Shown distinction.

Do not implement ability resolution (Phase 10F) in 10E.

## Starting branch

Use:
`dev/phase-10e`

It is to be created from the exact integrated `main` carrying the Phase 10D closure commit, with no implementation changes. Verify `dev/phase-10e` equals that `main` before starting.

At the start of any new session, verify the exact branch SHA and read:
- `docs/ai/MASTER_IMPLEMENTATION_PLAN.md`
- `docs/ai/handoffs/CURRENT_HANDOFF.md`
- `PHASE10A.md`
- `PHASE10B.md`
- `PHASE10C.md`
- `PHASE10D.md`
- `TERMINOLOGY.md`

## Immediate next task

1. If `main` does not yet equal the Phase 10D docs-only closure commit, finish the rules-first integration first (deploy and verify the Firebase Rules, fast-forward `main`, create `dev/phase-10e` from that exact `main`).
2. Then perform the **Phase 10E architecture challenge before coding** on `dev/phase-10e` (verify the exact commit SHA). No 10E implementation begins until the challenge is adjudicated into a Sol implementation contract.
