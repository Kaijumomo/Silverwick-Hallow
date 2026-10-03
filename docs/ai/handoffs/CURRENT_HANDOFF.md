# Silverwick Hollow — Current Handoff

**Date:** 2026-10-02\
**State:** Phase 10E — Alignment Transitions is **CLOSED AND INTEGRATED** into `main`. Phase 10F — Guided Ability Resolution / Night Actions: the rules-neutral foundation passed Luna (§24), Sol froze the proof-character rules matrix (§25), and **Slice 7 — proof-character semantics — is implemented and READY FOR LUNA** on `dev/phase-10f` (code checkpoint `d9b927ae172f5327910e8a31d375096118cf7850`, with a docs-only handoff commit on top; schema/store v24, unchanged). Starting checkpoint: `2252c5e76284fcd12d0e4d5debdfc34f66f86a17`. 10F is NOT closed; nothing merged or deployed.

## Phase 10D — CLOSED

Final reviewed implementation checkpoint (before docs-only closure metadata):
`62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`

The docs-only closure commit on top of it, `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`, is the integration checkpoint: `main` was fast-forwarded to it (no merge commit) after the rules-first release step below. A docs-only integration-record commit directly on top of it is the final `main`, and `dev/phase-10e` starts from that exact `main`. Verify exact SHAs rather than branch names.

Lineage on top of `c6fce7dd77e50baf4a34c75529ad48490558296d`: implementation `b2e0c6bf4d43537d770fcfcc2cc9b4abca22c4fe` → post-Luna remediation (same-Role Traveler `restart`) `4ca328256058c48c834c968d63a61a732364227f` → SOL-10D-R2 Astra remediation ASTRA-10D-001…004 + C01/C02 Life amendments `921b73ef102ff3d9b4456b78c759f571893c9b8c` → SOL-10D-C03 duplicate RoleId ownership `a5ef611150ee85f76915e5b4eece828c6ecd30d6` → SOL-10D-C03-R1 Setup compatibility `444820274eb5fd672d567bbc9c95bf24fd0865ef` → CLOSURE-01 immutable pending Traveler requests / CLOSURE-02 deferred request liveness / CLOSURE-03 canonical Traveler downstream ownership `a614496187bbf43cd4541d8a73a30645d7d7bdf2` → LUNA-CLOSURE-03-R1 Almanac RoleId uniqueness `b4068b4f517e51015c3c974d73ddc6503036f416` → ASTRA-FINAL-01 stopped-writer lifecycle `62055408e75ba33a9b1900e19b1d4bcd3cbf93aa` → docs-only closure `22dfd49e7220d642eec353c2ea83fa3a2547ce8b` (integration checkpoint) → docs-only integration record (final `main`).

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

Release record: the project owner ran `npm run rules:deploy` against the production Firebase project's default Realtime Database instance from `22dfd49e7220d642eec353c2ea83fa3a2547ce8b` (`src/firebase/rules.json` SHA-256 `9cccdc7f474d4948007f5e3b62fa485d0e20e6e06b50194258f348e01e0db076`). The read-only `npm run rules:verify` then reported that the deployed rules match `src/firebase/rules.json`. Both steps were owner-run and owner-reported; the integration session did not observe them directly. `main` was then fast-forwarded on 2026-10-01 (UTC) from `c6fce7dd77e50baf4a34c75529ad48490558296d` to `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`. The integration-record commit on top changes documentation only, so the deployed rules still match `main`. The client ships from `main` automatically; that client deployment was not observed from the integration session.

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

Update 2026-10-01: as part of the Phase 10D integration, the project owner deployed the current rules to production and verified them (see the Phase 10D release record above). No production Go Live → live lobby → End Game smoke test is recorded, so the production incident itself is not recorded as closed.

## Phase 10 roadmap

- **10A Life Transition Semantics + visual life-state grammar — CLOSED**
- **10B Effect Lifecycle + visual Effect indicators — CLOSED**
- **10C Reminder Workflow + visual Reminder tokens — CLOSED**
- **10D Role Transitions — CLOSED**
- **10E Alignment Transitions — CLOSED AND INTEGRATED**
- **10F Guided Ability Resolution / Night Actions — SLICE 7 PROOF SEMANTICS READY FOR LUNA (not closed)**
- 10G Advanced Storyteller bookkeeping / final visual integration

## Standing Phase 10 UX invariant

Phase 10 may increase Silverwick's mechanical intelligence, but routine Storyteller operation must remain fast, visually clear and low-friction. Complexity belongs under the interface; common table actions use progressive disclosure and should not ask the Storyteller for information Silverwick already knows.

This requirement continues through 10C–10G.

## Phase 10E frozen implementation direction

The architecture challenge is complete and adjudicated. `PHASE10E.md` is the frozen Sol implementation contract.

Key frozen decisions:
- one participant-bound Actual Alignment planner/commit seam;
- gameplay Alignment change and correction are distinct;
- Actual Role and Actual Alignment never infer each other;
- player-facing alignment perception supports Normal / explicit Good / explicit Evil / Not Told through the existing 10D perception seam;
- Normal ordinary perception derives from Shown Role; Normal Traveler perception follows Actual Alignment;
- v23 normalizes inert legacy Traveler shown-alignment copies to Normal and adds Alignment History correction/correlation support;
- new participation never inherits stale seat alignment;
- Traveler Actual Alignment changes invalidate alignment-dependent private packet material without erasing historical arrival completion or Information Delivery;
- multi-participant Alignment changes are atomic;
- ability evaluation remains Phase 10F.

Do not implement ability resolution in 10E.

## Starting branch

Use:
`dev/phase-10e`

It starts from the exact final `main` of the Phase 10D integration (the docs-only integration record directly on top of the Phase 10D closure commit `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`), with no implementation changes. Verify `dev/phase-10e` equals that `main` before starting.

At the start of any new session, verify the exact branch SHA and read:
- `docs/ai/MASTER_IMPLEMENTATION_PLAN.md`
- `docs/ai/handoffs/CURRENT_HANDOFF.md`
- `PHASE10A.md`
- `PHASE10B.md`
- `PHASE10C.md`
- `PHASE10D.md`
- `TERMINOLOGY.md`

## Phase 10E implementation (delivered, unverified)

Implementation review checkpoint: the `dev/phase-10e` commit named in the implementation report (verify the exact SHA). Started from the contract-freeze commit `98558c506b400d352af8cbff5521114a341f2e57`. Schema / store version: **v23**. No Firebase Rules / authority change. The required local gate results (typecheck, normal tests, emulator rules tests, build, `git diff --check`) are recorded in the implementation report for that exact SHA.

Delivered:
- `src/stores/alignmentResolution.ts` -- pure `planAlignmentTransaction` / `applyAlignmentPlan` (intents `changeActualAlignment` / `correctActualAlignment`; refusal family invalid / phase / notSeated / stale / conflict / mixedCorrection / tooMany; partial-field patches limited to `actualAlignment`, `privateInfo`, `publishedPacket`, `packetEpoch`), committed once by `resolveAlignments`.
- `setActualAlignment` / `setTravelerAlignment` are thin adapters (return the structured result). `setTravelerAlignment` no longer resets `demonInfoComplete` or clears the whole draft (PHASE10E.md 10).
- Phase 10D `setPerception` admits `undisclosed`; `shownAlignmentIntent` helper; projection: Normal / explicit / Not Told for ordinary and Traveler; self decoder renders a shown identity without alignment (never WAITING).
- v22 -> v23 (`migrateEntryV22ToV23`): Traveler `shownAlignment` good/evil -> null, fail-closed stamp; `hasV23Evidence` (undisclosed, alignment `correction` / `resolutionId`) runs before older heuristics; strict v23 Alignment History snapshots in `HistoryRecordSchema`.
- `occupySeat` drops a stale seat `actualAlignment` (every new participation starts unresolved; legacy empty-seat state stays loadable).
- UI: `src/features/players/AlignmentControls.tsx` -- Actual Alignment (one-tap gameplay change, disclosed "Correct the recorded alignment…"), Player-facing alignment (Normal, disclosed Shown Good / Shown Evil / Not told, "View overridden"), ordinary "Player view differs" advisory; used by PlayerDrawer (ordinary) and TravelerArrival (Traveler); Privacy Mode renders none of it.
- Guard: `src/stores/alignmentArchitecture.test.ts`. Tests: `alignmentResolution`, `alignmentPerception`, `alignmentMigration`, `AlignmentControls` suites plus updated version-ladder tests.

Sol pre-Luna adjudication:
1. **REMEDIATED (SOL-10E-R1):** "View overridden" is semantic (`alignmentViewOverridden` / `normalAlignmentOf` in `AlignmentControls.tsx`). Existing Setup explicit Good/Evil equal to Normal must not create routine override noise. Do not change Deal storage or ordinary migration; compute the cue from effective divergence from Normal, with Not told always overridden.
2. **REMEDIATED (SOL-10E-R2):** "Player view differs" may arm only after gameplay `changeActualAlignment`, never after `correctActualAlignment`.
3. **ACCEPTED INTERPRETATION:** before Reveal the separate correction affordance may stay hidden because Setup has no History and a plain change repairs the same Current State.
4. **ACCEPTED INTERPRETATION:** ordinary packet/draft stays untouched by Actual Alignment mutation.
5. The transaction bound remains `MAX_TOTAL_PLAYERS` (one intent per participant).

These are narrow Sol clarifications recorded in `PHASE10E.md` §25; architecture is not reopened.

## Phase 10E Astra adjudication — 2026-10-01

Astra reviewed exact checkpoint `264ab0bc1380452216aaec944bb9e2f5498802cb` and returned REVISE.

Sol accepted five implementation findings for remediation:
- SOL-10E-A1: `setIsTraveler` must be Setup-only, not merely pre-Reveal.
- SOL-10E-A2: a Traveler with an incompatible/non-self Shown Role fails self projection closed / Needs check.
- SOL-10E-A3: Night/Day day-0 is invalid persisted live state; Alignment and Role also refuse if a live Game Moment cannot be formed.
- SOL-10E-A4: the ordinary gameplay disclosure cue must resolve permanently once addressed and never revive because of a correction.
- SOL-10E-A5: strict v23 Alignment History snapshots reject extra raw own keys before generic parsing can erase them.

Sol also froze:
- Traveler -> Traveler Role changes/corrections preserve explicit Alignment perception (`shownAlignment`), including Not Told.
- Setup fresh-assignment operations may canonicalize Actual Alignment; special starting Alignment is applied/re-applied after the final relevant Setup Role refinement. No additional preservation mechanism is added in 10E.

The full adjudication is authoritative in `PHASE10E.md` §26.

Remediation delivered (on top of `3b6fcb90752dc8d591b531d5b954aa0ce193c6e1`; exact checkpoint SHA in the remediation report):
- A1: `setIsTraveler` refuses unless `phase === "setup"` (and before Reveal); the Player Drawer shows the Setup Traveler toggle only in that window.
- A2: `identityState` (projections.ts) treats any Traveler whose Shown Role is not their own Traveler character as unsafe / Needs check.
- A3: `StorytellerGamePersistedSchema` rejects Night/Day with `day < 1`; the Alignment and Role planners refuse a live phase without a live Game Moment before drawing any id.
- A4: `AlignmentControls` models the advisory as one gameplay cue `{ participantId, alignment }`, disarmed when no longer pending and cleared by any accepted correction.
- A5: `HistoryRecordSchema` checks v23 Alignment snapshots' raw own keys before generic parsing (legacy History unchanged).
- Traveler -> Traveler Role change/correction preserves `shownAlignment` (roleResolution.ts); ordinary -> Traveler still starts at Normal.
- Regressions: `src/stores/alignmentAstraRemediation.test.ts`, `src/features/players/alignmentAstraRemediation.test.tsx`.

## Phase 10E closure — 2026-10-01

Final reviewed implementation checkpoint:
`f978c366ab18fffb873b7ea150c1b3ec69e8f71b`

Sol verdict:
**CLOSED — READY FOR INTEGRATION**

Closure evidence:
- Luna targeted verification: PASS.
- Astra targeted closure: PASS — ASTRA-10E-001..005 CLOSED.
- normal tests: 126 files, 3321/3321, 0 skipped.
- Firebase emulator/rules: 201/201, 0 skipped.
- typecheck PASS.
- build PASS.
- `git diff --check` PASS.
- remaining findings/evidence gaps: none.

Schema/store version: **v23**.

## Phase 10E integration — 2026-10-01

Phase 10E is **CLOSED AND INTEGRATED**.

- Final reviewed implementation checkpoint: `f978c366ab18fffb873b7ea150c1b3ec69e8f71b`.
- Docs-only closure/integration checkpoint: `6129c7f4585da0e12aeea3a9a5007c88fb508ad7`.
- `main` fast-forwarded to the closure checkpoint with no merge commit.
- No Firebase Rules change or deployment was required.
- Luna targeted remediation verification: PASS.
- Astra targeted closure: PASS — ASTRA-10E-001..005 CLOSED.
- remaining findings/evidence gaps: none.
- schema/store: v23.

## Phase 10F — frozen contract / implementation start

The independent architecture challenge is complete and Sol has adjudicated it. `PHASE10F.md` is the authoritative implementation contract.

Frozen core:
- one pure ability coordinator composes frozen 10A–10E planners against one evolving working snapshot;
- one accepted resolution commits exactly once (one Undo, one localSeq, one projection cycle);
- mechanical operation order is character semantics, never a generic domain fallback;
- every actor/target workflow binding is ParticipantId-safe and stale-checked;
- deterministic mechanics are automated; player choice, Storyteller choice, discretion, ambiguity and unsupported interactions remain explicit;
- Reminders remain write-only notation for mechanics;
- Effect applicability is derived, never cached into Effect lifecycle state;
- v24 makes Information Delivery composable and able to identify a performed/simulated Role;
- v24 makes player Night progress participant-scoped;
- during Night, public/player-town projection withholds Life State rather than reconstructing a pre-Night truth;
- the Night Order becomes an interactive operating dashboard with inline simple actions and a progressively disclosed workspace for complex/judgment-heavy resolutions;
- full canonical semantic coverage moves to Phase 11 after 10G.

Implementation lineage:
- `727530e9364a0c971326c06ce45855adcf39828b` — create/freeze `PHASE10F.md`;
- `069dd36` / `dc38a6a` / `5ee705f` — pre-handoff pure Information Delivery extraction (Sol-authored);
- `f57ea42` / `36e5290` — roadmap / handoff docs;
- `800eedc` — **review remediation (verdict REVISE)**: the pre-handoff extraction failed the gate -- an unused import broke `tsc -b` (typecheck and build), the 10D Role-seam guard (run by the Role and Alignment guard suites) failed on the moved Actual Role snapshot, and refusal precedence drifted ("Unknown script." before the recipient checks). Fixed, with equivalence / purity / composability / one-commit evidence;
- `edeafc3` (+ `8dc6ebd` build-artifact restore) — Slice 1: v24 strict deliveries (authorized `performedRole`, `resolutionId`), participant-scoped Night progress (`src/stores/nightProgress.ts`), v23 → v24 migration (seat-keyed participant progress dropped, never re-keyed), Night public-Life withholding (projection, wire decoder, Public Display, player town list);
- `0d8714d` — Slice 2: Life `useAbility` / `correctAbilityUsed`; `setAbilityUsed` is an adapter (Night/Day only, records Life History); abilityUsed writer guard;
- `c142fc2` — Slice 3: ability semantics contract (`src/abilities/semantics.ts`), hook/modifier gating (`src/abilities/modifiers.ts`), Rules Query (`src/stores/rulesQuery.ts`), pure coordinator (`src/stores/abilityResolution.ts`), pure `planNightStepStatus`;
- `364d4f2` — Slice 4: one-commit `resolveAbility`;
- `5429e48` — Slices 5–6: interactive Night Order, workspace, Manual path, Grimoire target picker, Privacy Mode;
- `6deda52` — generated coverage manifest (`src/abilities/coverage.ts`) and 10F architecture guards;
- `2b8ad61` — preview label polish;
- `403f641` — guided request without a fingerprint refuses `invalid` (**implementation review checkpoint**);
- docs commit on top — `PHASE10F.md` trailing-double-space hard breaks converted to `\\` hard breaks (identical rendering, no content change) so the range `git diff --check` passes; roadmap / handoff / terminology.

Gate at `403f641` (plus the docs commit on top): see the final implementation report (typecheck, full normal suite, Firebase emulator suite, production build, `git diff --check`).

Behavior changes to note for review:
- `setAbilityUsed` now goes through the Life boundary: refused in Setup / after the game ends, and a live toggle records one Life History record (`correction: true` when clearing).
- During Night, public / player-town views show no Life State for anyone (including earlier deaths); Day restores it.
- v23 → v24 drops seat-keyed participant Night progress (a one-night bookkeeping reset), preserving global and custom steps.

No character-specific mechanics are encoded: `CANONICAL_ABILITY_SEMANTICS` is empty, so every Night row offers "Resolve manually / unmodeled interaction"; guided flows are exercised with rules-neutral fixtures only (`src/test/abilityFixtures.ts`). The official BOTC wiki/site was not reachable from the implementation environment (network policy).

No Firebase Rules / writer-fencing change was made.

### Proof-character rules evidence still required (contract Slice 6)

The official BOTC wiki / site was unreachable from the implementation environment; only the pinned canonical data (ability text, night order, jinxes) was available, and ability text alone is not a ruling. Before any proof-character module is written, these need authoritative answers:

1. **Poisoner** -- exact duration boundary of the poison (through which phase transition); does it end immediately if the Poisoner dies, becomes drunk/poisoned or loses their ability mid-Night/Day (Effect persistence `whileSourceFunctions` vs `independent`); may the Poisoner choose themself or a dead player?
2. **Monk** -- does "safe from the Demon" cover every Demon-caused death that Night (including a Demon's self-kill / star-pass and Demon abilities other than the nightly kill); does it persist if the Monk dies or becomes impaired later that Night; exact expiry boundary?
3. **Imp** -- kill resolution against Safe-from-the-Demon / Cannot-die / generic protection; on self-kill, which Minion becomes the Imp (Storyteller choice among living Minions?) and its interaction with the Scarlet Woman; mechanical order of the Imp's death vs the Minion's Role change; does the new Imp act again that Night; does an impaired Imp's self-kill still pass the Demon?
4. **Fortune Teller** -- the red herring as an authoritative Setup fact (where it lives; may it change); registration of Recluse / Spy / other misregistering characters as Storyteller judgment; what an impaired Fortune Teller may be told; dead-player choices.
5. **Drunk shown as Empath** -- any constraint on the arbitrary information (or purely Storyteller choice)?
6. **Ravenkeeper** -- which Night deaths trigger it (any cause, including Minion abilities / executions at night?); is an impaired Ravenkeeper still woken; ordering when the death happens after the Ravenkeeper's night position.
7. **Slayer** -- does an impaired Slayer use up the ability; may a dead Slayer act; may they target themself; registration of the target as Demon (Recluse) as judgment.
8. **Cult Leader** -- which neighbour's alignment (living neighbours? Storyteller choice when they differ); does the Cult Leader learn the change; Shown Alignment handling.
9. **Pit-Hag** -- legal destinations (not in play only?), alignment of the changed player, the "arbitrary deaths" when a Demon is created (who decides, ordering), does the changed player act with the new ability tonight, ability-use reset.
10. **Al-Hadikhia** -- exact order of the three choices and outcomes, "choose to live" for an already-dead player, and the all-three-live case.
11. **Tinker** -- confirm pure Storyteller discretion with no protection interactions (Monk / Soldier / Cannot-die).
12. **Harlot** -- consent flow, who decides the deaths, simultaneous or ordered deaths, timing.
13. **Toymaker** -- an authoritative home for "the Demon has skipped an attack" history (10G), first-night evil information below 7 players.
14. **Baron** -- confirm Setup-only (no in-game mechanic) for the negative proof.

## Luna rules-neutral review — 2026-10-02

Luna reviewed exact target `b1d6bd7f071c8f5195c5f440abcaa43441446aaf` in a fresh isolated clean worktree and returned **REVISE**. Required gates all passed: typecheck; **3,474/3,474** normal tests across 134 files; **201/201** Firebase emulator tests, 0 skipped; production build; worktree and baseline-range `git diff --check`.

Sol accepted seven targeted findings, frozen in `PHASE10F.md` §22:

- **SOL-10F-L1 HIGH:** jinx activation must use canonical authoritative represented-character state, not script membership alone.
- **SOL-10F-L2 HIGH:** AbilityWorkspace must faithfully render every declared typed input/cardinality, including typed judgments.
- **SOL-10F-L3 HIGH:** add a Storyteller-private Day ability entry point using the same workspace/coordinator.
- **SOL-10F-L4 MEDIUM:** malformed fingerprint → `invalid`; valid-but-changed fingerprint → `stale`.
- **SOL-10F-L5 MEDIUM:** verified information constraints may not silently skip Player-valued information.
- **SOL-10F-L6 MEDIUM:** prose-derived `RoleDef.oncePerGame` may not drive mechanical Night suppression; usage authority is the verified AbilityDescriptor.
- **SOL-10F-L7 MEDIUM:** strengthen Role/Alignment writer guards; Luna mutation proved an ordinary semicolon-terminated Role write escaped the older regex.

Accepted without remediation from this pass: live-only `setAbilityUsed` compatibility; modal Grimoire picker limitation with accessible fallback; Fabled/Loric scope table as non-semantic safety metadata; v24 migration, Night Life withholding, Information Delivery extraction, Rules Query purity and one-commit coordinator.

Production `CANONICAL_ABILITY_SEMANTICS` remains empty.

## SOL-10F-L1…L7 remediation — 2026-10-02

Targeted remediation on top of `32770202c3865cffa1e600e0c28f781f93c6dc6c` (the Luna-remediation handoff). No proof-character mechanic, no 10A–10E contract change, no Firebase Rules change; production `CANONICAL_ABILITY_SEMANTICS` is still empty.

- `b334420b25551d1d4f65ed4a2296602f8a7ebdc4` — **L1:** `representedCanonicalCharacters` (Actual Role of a current occupied participant, dead included, canonical ownership via `isCanonicalRole` on the active registry's definition); a jinx is active only when BOTH endpoints are represented. Script-only / unassigned / Shown Role / empty seat / homebrew-reusing-an-official-id never activate it; Fabled / Lorics still come from `game.fabled` / `game.lorics`.
- `aa0f4ed7a377adc1e5cf1b1d95ddb13a3d4ef3fe` — **L2:** `RequirementInput` renders every declared kind (participant with `count` / `notSelf` / `alive` / `dead` / `distinct`, character, alignment, number, boolean, text) for descriptor inputs AND evaluator-asked typed judgments; no default values; the exact typed payload reaches the evaluator and `resolveAbility`.
- `f4c10d7a90c9953bf285b3829d179a98652bc51f` — **L3:** Storyteller-private Day entry point (`AbilityEntry` in the Player Drawer): offers a guided ability only when a verified descriptor acts in the current phase, otherwise the Manual path; same workspace, same coordinator, same one-commit `resolveAbility`; hidden in Privacy Mode and outside Night/Day.
- `54b0cad64c1f3abd16ee756666d2f96f2171eefb` — **L4/L5:** a malformed fingerprint is `invalid`, a well-formed but changed one is `stale`; information constraints are typed (`InformationConstraintValue`; Player-valued constraints compare stable ParticipantIds with an explicit order rule and exact cardinality); a malformed constraint is `unsupported`, a mismatch `illegal` — never silently skipped.
- `2808f6ed5fd7b8bc9fdf4df327f7bd4da8270b26` — **L6:** prose-derived `RoleDef.oncePerGame` no longer suppresses a Night row; usage authority is the verified `AbilityDescriptor.usage`; guarded (no production `.oncePerGame` mechanical read).
- `f2a1697d70fa225f2cda2073d49c618ff92cc82b`, `e5a9b9d019d469609a3c6246043b18dc5d72bf62` — **L7:** one shared formatting-independent write detector (`src/test/writerGuard.ts`) for the Role, Alignment and abilityUsed guards (catches `{ ...p, actualRole: x };`, `})`, multi-line literals, property / bracket assignment, delete; excludes type members). Newly visible sites are asserted, not merely allowlisted: the Alignment seam's single AlignmentChange log entry; the `setShownAlignment` / `setBehaviorMode` perception specs inside `setPerception(id, { … })`; and the 10F read-only snapshot modules (`abilityResolution.ts` → `captureFingerprint`, `informationDelivery.ts` → `planInformationDelivery`, `nightOrder.ts` → `computeNightOrder`) admitted only as verbatim `field: player.field` copies inside that unit. Planted-mutation evidence (each restored): `actualRole` / `actualAlignment` `};` writers in an allowlisted store unit and in a non-reviewed module, an `actualRole` writer in an allowlisted snapshot module outside its unit, direct and literal `abilityUsed` writers, the coordinator calling `resolveLife`, a Reminder read in the Rules Query, and a Night public `alive` leak — every one fails its guard.

Gate and exact counts: see the remediation report for the final HEAD.

## Next task after L1…L7 (done — Luna re-verified at `180b20e`)

Luna re-verifies the SOL-10F-L1…L7 remediation at the exact `dev/phase-10f` HEAD named in the remediation report (code checkpoint `e5a9b9d019d469609a3c6246043b18dc5d72bf62` plus the docs-only handoff commit). Do not implement proof-character semantics, merge, deploy or close 10F. Authoritative BOTC rules research can proceed in parallel, but Sol does not freeze the proof-character matrix until the rules-neutral foundation passes Luna re-verification.


## Luna remediation re-verification — 2026-10-02

Luna re-verified exact target `180b20e173b5dcccc3a6a1853d37987c6589c4de` and returned **REVISE** on one remaining High finding. The full gate passed: typecheck; **3,498/3,498** normal tests across 137 files; **201/201** Firebase emulator tests, 0 skipped; production build; worktree and baseline-range diff checks.

Closed by Luna: **SOL-10F-L1, L2, L4, L5, L6, L7**.

Still open:

- **SOL-10F-L3-R1 HIGH — invocation eligibility.** The Day entry uses the shared workspace/coordinator, but `triggered` and `passive` timing are currently treated as actionable in either live phase without consulting `AbilityDescriptor.invocation`. A passive descriptor with `invocation:"none"` can therefore be offered and accepted.

Sol froze the narrow correction in `PHASE10F.md` §23: generic Day guided entry requires explicit `day` timing plus `publicClaim`/ `procedure`; ordinary Night cadence requires first/other-Night timing plus `wake`/ `procedure`; triggered/passive are not automatically actionable and remain Manual/reference until an explicit supported invocation path exists; coordinator and UI must share/enforce the same rule.

## SOL-10F-L3-R1 remediation — 2026-10-02

Narrow remediation on top of `6309152625c86e08ef418d916588fd4cacd9d73a`; code checkpoint `93b850d77ea9b8a7adf3ae4db3f4ac7dc7d54a68`. No proof-character mechanic, no Firebase Rules / writer change; production `CANONICAL_ABILITY_SEMANTICS` stays empty; L1, L2, L4–L7 untouched.

- `src/abilities/invocation.ts` — the ONE pure, rules-neutral `invocationEligibility(descriptor, path, moment)` contract: `dayEntry` = Day + explicit `day` timing + `publicClaim` / `procedure`; `nightOrder` = Night + explicit `firstNight` (Night 1) / `otherNight` (later Nights) + `wake` / `procedure`. `triggered` / `passive` timing never yields a generic path (no trigger inferred from timing); invocation `none` is never directly actionable; `setup` stays Setup-owned.
- Guided requests carry a runtime-validated `invocationPath: "nightOrder" | "dayEntry"` (missing / unknown → `invalid`). `planAbilityResolution` replaces `timingAllows` with the shared contract and refuses an ineligible descriptor `notApplicable` without mutation.
- The Day entry (`AbilityEntry`) and the Night Order rows use the same contract through `pathAbility()`; an ineligible descriptor falls back to the Manual path with the reason. The Day entry offers no guided action at Night.
- Regressions: `src/abilities/invocation.test.tsx` (§23 matrix, an exhaustive 360-combination helper = entry point = coordinator agreement check, rendered Day entry and Night Order rows, crafted-request refusals, path validation, Manual path); architecture guard (only `abilities/invocation.ts` interprets descriptor timing / invocation). Planted mutations (coordinator ignoring eligibility, Day entry ignoring it, the old triggered/passive rule, timing-only eligibility, unvalidated path) each fail the guards.

## Immediate next task

Luna narrowly re-verifies SOL-10F-L3-R1 at the exact `dev/phase-10f` HEAD named in the remediation report (code checkpoint `93b850d77ea9b8a7adf3ae4db3f4ac7dc7d54a68` plus the docs-only handoff commit). Production `CANONICAL_ABILITY_SEMANTICS` remains empty. Do not implement proof-character semantics, merge, deploy or close 10F.


## Luna invocation closure / rules-neutral foundation PASS — 2026-10-02

Luna re-verified exact target `aeda04351895175eb78a147fe9c133519fd4f3ba` and returned:

**PASS — SOL-10F-L3-R1 CLOSED; RULES-NEUTRAL FOUNDATION READY FOR SOL CHARACTER-RULE FREEZE**

Gate evidence:

- invocation suite **64/64**;
- targeted regression smoke **295/295** across 12 files;
- full normal suite **3,563/3,563** across 138 files;
- Firebase emulator suite **201/201**, 0 skipped;
- typecheck PASS;
- production build PASS;
- worktree and baseline-range diff checks PASS;
- final detached review worktree clean.

No findings remain in the rules-neutral foundation review. Production `CANONICAL_ABILITY_SEMANTICS` is still empty.

Accepted Sol interpretations retained: Night guided work is owned by Night Order while the Player Drawer keeps the Manual fallback; `nightOrder` path does not require a Night-step fingerprint unless completing a step; late-arriving Traveler first-night exceptions remain Manual/deferred until verified Traveler semantics.

## Immediate next task

Sol researches and freezes the authoritative proof-character rules matrix for Poisoner, Monk, Imp, Fortune Teller, simulated Drunk→Empath, Ravenkeeper, Slayer, Cult Leader, Pit-Hag, Al-Hadikhia, Tinker, Harlot, Toymaker and Baron. Use official BOTC sources for character behavior and distinguish explicit rules from Storyteller judgment. Do not implement production semantics until the rules matrix is frozen.


## Phase 10F proof-character rules freeze — 2026-10-02

Sol completed the authoritative rules research and froze contract Slice 6 in:

`docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md`

The matrix is grounded in the publisher Blood on the Clocktower Wiki character How-to-Run pages plus the Abilities / States / Glossary rules pages, cross-checked against Silverwick's pinned canonical data revision `f10cd02e3401af227ce406287eaae7bb99a06a42`.

Authorized implementation set:

- Poisoner — guided Effect;
- Monk — guided safe-from-Demon Effect;
- Imp — guided kill/star-pass with narrow Scarlet Woman priority dependency;
- Fortune Teller — guided information + authoritative Red Herring Effect;
- Empath support semantic + simulated Drunk→Empath delivery;
- Ravenkeeper — verified Night death trigger + information;
- Slayer — guided Day public claim / once-per-game;
- Cult Leader — guided nightly Alignment; Day cult vote stays Manual/out of voting scope;
- Pit-Hag — guided non-Demon Role change; Demon creation stays Manual pending 10G arbitrary-death state;
- Al-Hadikhia — ordered three-player Life resolution;
- Tinker — verified Manual;
- Harlot — guided consent/info/might-death;
- Toymaker — verified Manual/10G skip-state dependency;
- Baron — Setup-owned negative proof.

Key architecture decisions are in PHASE10F.md §25 and the matrix.

## Slice 7 — proof-character semantics implemented — 2026-10-03

Implemented in the frozen order on top of `e656642e3c99a09aaba6d0883c07e817af67d043` (see `PHASE10F.md` §26 for the generic seams and the full gate):

- `7a341d9` — Poisoner and Monk;
- `cb94ac8` — Empath (support), Drunk shown as the Empath, Fortune Teller + authoritative Red Herring;
- `40863b9` — Slayer and Cult Leader (nightly portion);
- `167dc1c` — Harlot (owner-authorized `harlot-other-night` Information Action) and Al-Hadikhia; a follow-up commit records the owner-specified final action shape (`chosenPlayer` + `role`, other Nights) and its ownership tests;
- `f256b0b` — Imp star-pass + narrow Scarlet Woman priority;
- `0499583` — Ravenkeeper + explicit verified Night trigger;
- `6c78644` — Pit-Hag (non-Demon branch; Demon creation Manual);
- `1f1765f` — Tinker / Toymaker / Drunk verified-Manual, Baron Setup-owned, coverage manifest;
- `aa14fee` — proof-character architecture guards (code checkpoint);
- docs-only handoff commit on top (also normalizes four pre-existing trailing-whitespace hard breaks in the matrix header so the baseline-range `git diff --check` passes).

Gate at final code checkpoint `d9b927a` (Harlot action `chosenPlayer` + `role`): typecheck PASS; full normal suite 3,751/3,751 across 153 files (0 skipped); Firebase emulator 201/201 (0 skipped); build PASS; diff checks PASS. Earlier gate at `aa14fee`: typecheck PASS; full normal suite 3,745/3,745 across 153 files (0 skipped); Firebase emulator 201/201 (0 skipped); build PASS; diff checks PASS (after the whitespace normalization). Seven planted mutations (Reminder-as-Red-Herring, History-based trigger, generic trigger path, star-pass store call, Reminder-based Toymaker skip, live Baron semantics, prose parsing) were each caught and restored.

Manual / deferred boundaries kept: Cult Leader Day vote; Pit-Hag Demon creation (10G), Traveller transformation, concealed identities; Tinker discretion (Manual path does not check protection — reference text says to); Toymaker skip history (10G); mid-game Fortune Teller without a Red Herring; Baron live ability (none).

## Immediate next task

Luna independently and mechanically verifies Slice 7 at the exact pushed `dev/phase-10f` HEAD named in the implementation report. Do not merge, deploy or close 10F.


## Sol pre-Luna Slice 7 adjudication — 2026-10-03

Sol spot-checked the pushed Slice 7 checkpoint `eb4822e421e4b18a72dbef91adcea0ac8e00204e`. The owner-authorized Harlot Information Action (`chosenPlayer` + `role`) is accepted. Two targeted fidelity defects remain before Luna:

- **SOL-10F-S7-F1 HIGH — Harlot self-target.** Official How-to-Run permits the Harlot to point at any player; the matrix requires one living participant and no `notSelf`. Current semantics incorrectly forbids self.
- **SOL-10F-S7-F2 HIGH — Fortune Teller Red Herring initialization.** Red Herring is established while preparing the first Night and is source/functioning-independent authoritative Storyteller state. Current impaired Night-1 branch skips creation because ordinary non-functioning abilities cannot change Current State. Add the narrow generic independent-storyteller-fact seam frozen in `PHASE10F.md` §27; simulated Drunk-as-Fortune-Teller must not create the fact.

Do not send this checkpoint to Luna yet.

## Immediate next task

Claude Code remediates F1/F2 only, adds the §27 regressions, runs the full gate, pushes one exact clean checkpoint, and stops for Luna. Phase 10F remains open.
