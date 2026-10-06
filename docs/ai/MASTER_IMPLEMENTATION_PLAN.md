# Silverwick Hollow — Master Implementation Plan

**Status:** Active canonical roadmap  
**Updated:** 2026-10-06\
**Integrated branch:** `main`  
**Phase 10A closure checkpoint:** `d798266b988e49f904aa8f8658c917fd5b7e7abb`  
**Pre-10B Firebase lifecycle hotfix checkpoint:** `38b10119544ce2c02590e9bc9c741aab995a91d1`  
**Phase 10B final reviewed implementation checkpoint:** `3c9e20f4506258bab143b5f20750deb34b290379` (integrated into `main` with the docs-only closure commit on top)\
**Phase 10C final reviewed implementation checkpoint:** `ca808fa18e97d758750aad63ceacc2bea3d8f627` (integrated into `main` with the docs-only closure commit on top)\
**Phase 10D final reviewed implementation checkpoint:** `62055408e75ba33a9b1900e19b1d4bcd3cbf93aa` (integrated into `main` with the docs-only closure commit on top)\
**Phase 10D docs/integration checkpoint:** `22dfd49e7220d642eec353c2ea83fa3a2547ce8b` (the docs-only closure commit; `main` fast-forwarded to it after the rules-first release step, with a docs-only integration record directly on top)\
**Phase 10G final reviewed checkpoint:** `2aabccbb925183c2359bef5d48a2ee5cca2dfd03` (final production `7add7c661e43349634e0b6717d7c05ee18a31957`); `main` fast-forwarded to it, with a docs-only closure commit directly on top\
**Schema:** v25 integrated on `main`. v26 exists on `dev/phase-10h-ui` only; `main` remains pre-10H until the Phase 10H integration.\
**Phase 10 mechanical/state program:** COMPLETE (10A–10G closed and integrated; 10H does not reopen their closure)\
**Phase 10H final reviewed implementation checkpoint:** `9263fc79ed4ce20b9eee85a616038266cbb3ae58` (R3.2) on `dev/phase-10h-ui`. It supersedes R2 `668dc3dff4930d42e79e2fcc52b0877812f2abee`. Not yet integrated; `main` remains `e0ba539ae448eb494ca5739564a39c49d2e59467`.\
**Current phase:** Phase 10H — Storyteller UI/UX & Visual Design System — **CLOSED — READY FOR RULES-FIRST INTEGRATION**. Software implementation and the full review chain, including the post-closure R3–R3.2 review, are complete. Production RTDB Rules deployment/verification and `main` integration have not yet occurred. Phase 11 is queued after the 10H integration.

## Product invariants

- Storyteller remains the authoritative writer.
- Current State = what is true now.
- History = what changed; explanatory, never reconstructed into Current State.
- Information Delivery = what the Storyteller communicated.
- PlayerId is a reusable seat; ParticipantId is a participation instance; ParticipantRef is durable historical identity.
- Actual Role/Shown Role and Actual Alignment/Shown Alignment remain distinct.
- Public/private/self projections stay allowlisted.
- Nominations and ordinary voting remain out of scope.
- Silverwick should automate deterministic BOTC mechanics while leaving judgment, discretion, ambiguity and optional choices to the Storyteller.

### Standing Storyteller UX invariant

Phase 10 may increase Silverwick's mechanical intelligence, but routine Storyteller operation must remain fast, visually clear and low-friction. Complexity belongs under the interface; common table actions use progressive disclosure and should not ask the Storyteller for information Silverwick already knows.

This requirement is inherited by Phase 10H and remains a hard constraint on the redesign.

## Completed foundation

Phases 1–9 are closed, including security, snapshot validation, seating/removal, lifecycle/retry, Actual-vs-Shown identity, deceptive wakes/private delivery, Privacy Mode, canonical BOTC data/night order, UI/accessibility, setup readiness, active-game Traveler defaults, reconnect/recovery/writer fencing, participant continuity, and Phase 9D structured Current State groundwork.

The Phase 9 terminology audit checkpoint is `746b9b6bff56da6fb6f93c02df475eb45a9eb879`.

## Phase 10A — Life Transition Semantics + Visual Life-State Grammar

**Status:** CLOSED  
**Checkpoint:** `d798266b988e49f904aa8f8658c917fd5b7e7abb`

Phase 10A established the authoritative Life primitive:

- Current State life fields: `alive`, `ghostVote`, `exiled`, `abilityUsed`.
- Bounded authoritative `lifeEventWindow` with explicit `coverageFrom`.
- Life Event kinds: death, execution, exile, resurrection.
- Execution and exile do not inherently equal death.
- True resurrection is distinct from status correction.
- Covered absence can mean none; uncovered/expired absence is unknown.
- History mirrors Life changes/events but mechanics read Current State + Life Event Window.
- Multi-participant and ordered same-participant Life Events are atomic through one planner/writer seam.
- One resolution = one authoritative replacement, one Undo entry and one local sequence advancement.
- ParticipantId prevents seat-reuse confusion.
- Live progression is monotonic: Night N → Day N → Night N+1.
- Setup canonicalization runs only on genuine pre-game Setup → Night 1.
- Live play cannot return to Setup through the ordinary phase API.
- Privacy Mode closes/suppresses private Life Event dialogs.

A generic Al-Hadikhia-shaped transaction was proven atomically:
`resurrection(C) → death(A) → death(B) → death(C)`.

Final closure gate:

- typecheck PASS
- normal tests **2516/2516 across 99 files**
- Firebase emulator tests **178/178**, 0 skipped
- build PASS
- `git diff --check` PASS
- clean review worktree
- Astra remaining findings: **None**
- final Astra verdict: **PASS — READY FOR SOL CLOSURE**

## Pre-10B Firebase Go Live Lifecycle Hotfix

**Status:** CLOSED  
**Checkpoint:** `38b10119544ce2c02590e9bc9c741aab995a91d1`

A focused pre-10B hotfix closed a production-facing multiplayer lifecycle failure without changing schema, Firebase rules, or the core `SessionWriter.commit()` fencing path.

Root cause reproduced in the emulator:
- deployed RTDB rules older than Phase 9R.6 deny the Storyteller startup read of `membershipRevocations`;
- rules older than Phase 9R.2 deny `rosterParticipants`;
- the lobby/session can be created while Storyteller startup fails before the initial acknowledged projection/checkpoint flush;
- the earlier UI then trapped the Storyteller in a non-live lobby that could not cleanly End Game.

Closed behavior:
- runtime distinguishes connecting/reconnecting/live/blocked/stopped/failed;
- the runtime writer is still exposed only after the first acknowledged flush;
- startup failures are attributed without treating denied reads as empty state;
- failed-start End Game retries through a fresh fenced `SessionWriter`, never a direct write;
- local-only **Leave multiplayer — keep game offline** is offered only when authoritative server reads prove the expected session is active with no checkpoint and local accepted-live evidence does not disqualify it;
- that proof fails closed and is re-checked when Leave is chosen;
- resume handling routes a possibly-lapsed writer through the existing reconnect seam without modifying the commit path;
- the old fixed error overlay was replaced with an in-flow connection-status surface;
- `npm run rules:verify -- --project <ID>` provides a read-only deployed-rules drift check.

Final Luna verification:
- **2555/2555** normal tests across 102 files;
- **184/184** Firebase emulator tests across 3 files, 0 skipped;
- typecheck PASS;
- build PASS;
- `git diff --check` PASS;
- remaining findings: **None**;
- verdict: **PASS — READY FOR SOL CLOSURE**.

Operational note: the code hotfix is closed, but production Go Live still depends on the deployed Firebase RTDB rules matching `src/firebase/rules.json`. Verify/deploy the current rules before treating the production incident itself as closed.

Update 2026-10-01: as part of the Phase 10D integration, the project owner deployed the current rules to production and verified them (see 10D below). No production Go Live → live lobby → End Game smoke test is recorded, so the production incident itself is not recorded as closed.

## Phase 10 roadmap

### 10B — Effect Lifecycle + Visual Effect Indicators
**Status:** CLOSED\
**Final reviewed implementation checkpoint:** `3c9e20f4506258bab143b5f20750deb34b290379`\
**Integration:** the docs-only closure commit on top of that checkpoint, fast-forwarded into `main`. See `PHASE10B.md`.

Opus remediation SOL-10B-R1…R9, closure patch SOL-10B-RC1/RC2 and Astra findings ASTRA-10B-001…004 were all remediated and closed.

Final closure gate:

- typecheck PASS
- normal tests **2738/2738 across 107 files**
- Firebase emulator tests **184/184**, 0 skipped
- production build PASS
- `git diff --check` PASS
- Luna verdict: **PASS — READY FOR ASTRA ADVERSARIAL REVIEW**
- Astra final verdict: **PASS — ASTRA-10B-001..004 CLOSED; READY FOR SOL CLOSURE**
- Sol verdict: **CLOSED — READY FOR INTEGRATION**
- remaining Blocker/High/Medium findings: **None**

Known non-blocking / deferred: LUNA-10B-001 (LOW, duplicate Role choices in the advanced Effect Character dropdown); OPUS-10B-010 (correction cannot assign a departed participant as Effect origin); Reminder empty-seat inheritance → 10C; character-target convention → 10F; accepted identical remove/reapply array-order behavior; accepted equality-based expiry-coupling ambiguity.

Delivered: store v20 with explicit `gameSchemaVersion` evidence; Effect
`state` / resolved `expiry` / typed `parameters`; the pure Effect planner
(`effectResolution.ts`) and single `resolveEffects` commit seam with
participant-bound identity, apply/update/remove/suppress/resume/correction
semantics and structured refusals; deterministic expiry inside the phase
transition; v19 → v20 migration (finite legacy Effects → `unresolved`, never
guessed); centralized queries and presentation registry; aggregated Grimoire
indicators and Player Drawer quick/active/advanced Effects with Privacy Mode
suppression.

Goals:
- operationalize structured Effects already introduced in Phase 9D;
- define authoritative apply/update/remove/expire/correct semantics;
- define lifetime progression across Night/Day;
- preserve source/provenance and ParticipantId safety;
- support deterministic expiry where correct and Storyteller override where needed;
- add accessible visual indicators for Poisoned, Drunk, Protected and future effects;
- preserve privacy/projection boundaries;
- create one authoritative Effect mutation/lifecycle seam for the future ability engine.

10B does **not** implement full Role ability evaluation.

### 10C — Reminder Workflow + Visual Reminder Tokens
**Status:** CLOSED\
**Final reviewed implementation checkpoint:** `ca808fa18e97d758750aad63ceacc2bea3d8f627`\
**Integration:** the docs-only closure commit on top of that checkpoint, fast-forwarded into `main`. See `PHASE10C.md`.

Lineage: implementation `94c93390c8cf4bea915b1319fc2910cac81b5ed7` → Luna remediation LUNA-10C-001/002 `7ddc3fb9f566f429a5c5a6e0f4d0b8bbbabb5ae4` → Astra remediation ASTRA-10C-001…004 `ca808fa18e97d758750aad63ceacc2bea3d8f627`.

Final closure gate:

- typecheck PASS
- normal tests **2923/2923 across 112 files**
- Firebase emulator tests **184/184**, 0 skipped
- production build PASS
- `git diff --check` PASS
- Luna final verdict: **PASS — ASTRA-10C-001..004 MECHANICALLY CLOSED; READY FOR ASTRA TARGETED CLOSURE REVIEW**
- Astra final verdict: **PASS — ASTRA-10C-001..004 CLOSED; READY FOR SOL CLOSURE**
- Sol verdict: **CLOSED — READY FOR INTEGRATION**
- remaining Blocker/High/Medium findings: **None**

Known non-blocking / deferred: ASTRA-10C-005 (LOW, the Reminder planner should require `intent.kind` to be an own string property before discriminator lookup; malformed runtime input can otherwise throw or inherit `kind`); canonical per-character Reminder token disposition → 10F; departed-origin correction limitation (as OPUS-10B-010).

Frozen: Reminders are participant-bound, Storyteller-private, non-authoritative notation; mechanics never read Reminders as truth; current occupied ParticipantIds are globally unique; empty seats own no Reminders; origin and mutation provenance stay separate; cleanup cues are presentation-only with no automatic expiry; legacy History is preserved, never rewritten; the pure Reminder planner/apply seam remains available for 10F composition.

Delivered (store v21): Reminders are participant-bound, Storyteller-private, non-authoritative notation -- never mechanics input (architecture-guarded); strict v21 record (no lifetime; optional presentation-only `cleanupCue`); pure `planReminderTransaction` / `applyReminderPlan` and the single `resolveReminders` commit seam (place/amend/remove + corrections, ParticipantId-bound, all-or-nothing); empty seats own no Reminders; v20 -> v21 migration (empty-seat Reminders dropped, finite lifetimes -> `unresolved` "Needs check", History never rewritten; legacy Reminder History stays valid); explicit marker-20/21 routing; distinct Grimoire notation grammar with aggregation, explicit overflow and accessible summary; Privacy Mode DOM absence.

Structured placement/removal/update, source/target/lifetime, free text where appropriate, accessible token grammar, future-engine seam.

Frozen principle carried in from 10B: if a mechanical condition is authoritative as an Effect, a Reminder may visualize or help bookkeep it but must never become a second independent source of that mechanical truth. Routine Reminder placement/removal must be fast and visually obvious; advanced detail stays progressively disclosed.

### 10D — Role Transitions
**Status:** CLOSED\
**Final reviewed implementation checkpoint:** `62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`\
**Integration:** the docs-only closure commit on top of that checkpoint, `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`, fast-forwarded into `main` (no merge commit) on 2026-10-01 (UTC), only after the Phase 10D Firebase Rules were deployed to production and verified (rules first, then client). A docs-only integration-record commit directly on top of it is the final `main` of this integration. See `PHASE10D.md`.\
**Schema/store:** v22

Lineage on top of `c6fce7dd77e50baf4a34c75529ad48490558296d`: implementation `b2e0c6bf4d43537d770fcfcc2cc9b4abca22c4fe` → post-Luna remediation `4ca328256058c48c834c968d63a61a732364227f` → SOL-10D-R2 Astra remediation incl. C01/C02 Life amendments `921b73ef102ff3d9b4456b78c759f571893c9b8c` → SOL-10D-C03 duplicate RoleId ownership `a5ef611150ee85f76915e5b4eece828c6ecd30d6` → SOL-10D-C03-R1 Setup compatibility `444820274eb5fd672d567bbc9c95bf24fd0865ef` → CLOSURE-01/02/03 `a614496187bbf43cd4541d8a73a30645d7d7bdf2` → LUNA-CLOSURE-03-R1 `b4068b4f517e51015c3c974d73ddc6503036f416` → ASTRA-FINAL-01 `62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`.

Final closure gate:

- typecheck PASS
- normal tests **3172/3172 across 119 files**
- Firebase emulator tests **201/201**, 0 skipped
- production build PASS
- `git diff --check` PASS
- final reviewed worktree clean
- remaining closure-blocking (Blocker/High/Medium) findings: **None**; CLOSURE-02 and CLOSURE-03 closed; ASTRA-FINAL-01 independently mechanically verified by Luna at the final target
- evidence limitation: the final Astra re-confirmation of ASTRA-FINAL-01 could not run (that review environment classified the authorized local concurrency regression as cybersecurity content); Sol adjudicated it a review-environment limitation, not a product defect or evidence gap. There is no Astra PASS for that final run.
- Sol verdict: **CLOSED — READY FOR INTEGRATION**

Frozen Phase 10D architecture:

- `actualRole` is authoritative Current State; `shownRole` / perception stays separate.
- Actual Alignment remains separate from Role (10D never changes it).
- One participant-bound, pure Role transaction seam (`planRoleTransaction` / `applyRolePlan`, committed through `resolveRoles`).
- Gameplay Role change, Role correction and perception change are distinct operations.
- Multi-participant Role resolution is atomic (one replacement, one Undo entry, one localSeq step).
- Ordinary ↔ Traveler transitions are supported; a Traveler arrival correction is `preserve` or `restart`.
- Role History is explanatory only; Current State is never rebuilt from it.
- ParticipantId binding protects against stale state (a stale intent is refused).
- Canonical Role ownership: first-definition ownership for legacy script duplicates, canonical Traveler precedence, ASTRA-10D-004 Fabled/Loric protection — applied by every Role consumer, downstream lists included.
- A player's pending Traveler request is immutable until the Storyteller or membership lifecycle clears it (Firebase Rules enforced).
- Role changes preserve Life, Effects, Reminders and Actual Alignment unless a separately authorized primitive changes them.
- Store/game schema v22 migration behavior is preserved.

Release order: Phase 10D changed `src/firebase/rules.json`; the client ships from `main` automatically, so the Firebase Rules were deployed and verified before `main` moved. The project owner ran `npm run rules:deploy` against the production project's default Realtime Database instance from `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`, then the read-only `npm run rules:verify`, which reported that the deployed rules match `src/firebase/rules.json`. Both steps were owner-run and owner-reported. The client deployment from `main` was not observed by the integration session.

### 10E — Alignment Transitions
**Status:** CLOSED AND INTEGRATED. Final reviewed implementation checkpoint: `f978c366ab18fffb873b7ea150c1b3ec69e8f71b`. Docs-only closure/integration checkpoint: `6129c7f4585da0e12aeea3a9a5007c88fb508ad7`; `main` fast-forwarded to it with no merge commit, and a docs-only integration record sits directly on top. Luna targeted remediation verification passed; Astra targeted closure passed with ASTRA-10E-001..005 closed and no remaining findings/evidence gaps. See `PHASE10E.md` §§26–28.

Delivered (store/game schema v23): `src/stores/alignmentResolution.ts` (pure `planAlignmentTransaction` / `applyAlignmentPlan`) committed by `resolveAlignments`; `setActualAlignment` / `setTravelerAlignment` are adapters over it; the Phase 10D `setPerception` seam admits `shownAlignment: "undisclosed"`; projection honors Normal / explicit / Not Told for ordinary participants and Travelers; the self wire renders an alignment-less identity; v22 -> v23 normalizes Traveler Good/Evil Shown Alignment to Normal with v23 evidence detected first; `occupySeat` drops stale seat alignment; Storyteller UI `src/features/players/AlignmentControls.tsx`; architecture guard `src/stores/alignmentArchitecture.test.ts`. No Firebase Rules change.

Frozen direction: one participant-bound Actual Alignment transaction seam; gameplay change vs correction; atomic multi-participant changes; Actual Alignment independent of Role; v23 player-facing alignment perception with Normal / explicit Good / explicit Evil / Not Told; Normal ordinary perception derives from Shown Role while Normal Traveler perception follows Actual Alignment; v22 -> v23 normalization clears inert legacy Traveler shown-alignment copies to Normal; strict v23 Alignment History correction/correlation metadata; occupancy-boundary hardening so a new participant never inherits stale seat alignment; Storyteller UI separates Actual Alignment truth from player-facing perception; 10F remains responsible for ability logic.

### 10F — Guided Ability Resolution / Night Actions
**Status:** **CLOSED AND INTEGRATED.** Sol closure: `PHASE10F.md` §49; integration: §50.\
**Contract:** `PHASE10F.md` (frozen 2026-10-02).\
**Starting checkpoint:** `2252c5e76284fcd12d0e4d5debdfc34f66f86a17`.\
**Contract-freeze checkpoint:** `727530e9364a0c971326c06ce45855adcf39828b`.\
**Implementation review checkpoint:** `403f641944db035d170a9321562e88be096dc77b` (Luna REVISE at `b1d6bd7f071c8f5195c5f440abcaa43441446aaf`).\
**Remediation code checkpoint:** `e5a9b9d019d469609a3c6246043b18dc5d72bf62` (SOL-10F-L1…L7; docs-only handoff commit on top).\
**SOL-10F-L3-R1 code checkpoint:** `93b850d77ea9b8a7adf3ae4db3f4ac7dc7d54a68` (shared invocation-eligibility contract; docs-only handoff commit on top).\
**SOL-10F-B1…B6 code checkpoint:** `b9a7c58cca86a5e0b7b54ccdd1957aef90c866f2` (docs-only record commit on top).\
**SOL-10F-C1…C3 code checkpoint:** `c3ae6910ba6752bac62162a6f67f81076c598502` (docs-only record commit on top).\
**SOL-10F-D1/D2 code checkpoint:** `a0968d0ff6149b7f16eb9fabb7e1eb8dda32ea0c` (docs-only record commit on top).\
**SOL-10F-E1 code checkpoint:** `c6a2938e4e3c5ef3b17013c833cd335fe623b6f8` (docs-only record commit on top).\
**Phase 10F final reviewed target:** `a2d6d1b99242317269bf86f54e6d234e0644df33`.\
**Phase 10F integration checkpoint:** `6f51f8acb78a71f73ee704ffced636f6b4ea0300` (fast-forwarded into `main`; this roadmap/handoff integration record is docs-only on top).\
**Schema/store:** v24 (on `dev/phase-10f`).

Frozen direction: one pure ability coordinator composes the existing Life, Effect, Reminder, Role and Alignment planners on one evolving working snapshot and commits once; mechanical operation order is ability-defined; Storyteller choice/judgment remains explicit; Reminders remain non-authoritative; participant-bound workflow identity prevents seat-reuse staleness; Information Delivery becomes composable and records simulated/performed-role context in v24; player Night progress becomes participant-scoped; public/player-town Life State is withheld during Night; the Night Order becomes a guided operating dashboard with progressive disclosure and complex-outcome previews.

The architecture challenge and Sol adjudication found no contradiction requiring 10A–10E redesign. Narrow 10F-authorized amendments include composable ability-use state through the Life boundary and pure Information Delivery planning. Full canonical Character / Traveler / Fabled / Loric semantic coverage moves to Phase 11 after 10G, with 10F proving the engine against a diverse fixed proof set.

Implemented (see `docs/ai/handoffs/CURRENT_HANDOFF.md` for the lineage and gate): the reviewed-and-repaired pure Information Delivery plan; store v24 (strict deliveries with authorized `performedRole` / `resolutionId`, participant-scoped Night progress with v23 seat-keyed progress dropped, Night public-Life withholding); composable `useAbility` / `correctAbilityUsed` Life intents; the rules-neutral semantics contract, Rules Query, hook/modifier gating, pure coordinator and one-commit `resolveAbility`; the Manual / unmodeled path; the interactive Night Order, workspace, Grimoire target picker and Privacy Mode behavior; the generated coverage manifest and architecture guards. Slice 6 froze the proof-character rules matrix (`docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md`); Slice 7 implemented it (`PHASE10F.md` §26): eleven guided / support semantics, verified-Manual Tinker / Toymaker / Drunk, Setup-owned Baron, an explicit verified Night-trigger path (Ravenkeeper only), the authoritative Red Herring fact, star-pass suppression through participant-scoped Night progress, and the corrected coverage manifest.

### 10G — Advanced Storyteller Bookkeeping / Final Visual Integration
**Status:** **CLOSED AND INTEGRATED.** Sol final adjudication: APPROVE — PHASE 10G CLOSED AND INTEGRATED. Closure and integration record: `PHASE10G.md` §37.\
**Contract:** `PHASE10G.md` §§1–32 (Sol contract frozen 2026-10-03); implementation record §33, gate §34, Astra remediation §35, final Astra remediation (ASTRA-10G-R1-001) §36.\
**Starting checkpoint:** `52e685b16e76df15154512a52a34831a6aeba399`.\
**Final production checkpoint:** `7add7c661e43349634e0b6717d7c05ee18a31957`.\
**Final reviewed branch checkpoint:** `2aabccbb925183c2359bef5d48a2ee5cca2dfd03` (`dev/phase-10g`, kept as the historical reference).\
**Integration:** fast-forward only (15 ahead / 0 behind); `main` = `2aabccbb925183c2359bef5d48a2ee5cca2dfd03`, then one docs-only closure commit directly on top.\
**Schema/store:** v25 on `main`. Firebase Rules: unchanged.\
**Final evidence (Luna):** Vitest 4,190/4,190; Phase 10G tests 213/213; Firebase emulator 201/201, zero skipped; typecheck, build and diff checks PASS. **Astra:** PASS — READY FOR SOL CLOSURE ADJUDICATION; ASTRA-10G-001…004, the hypothetical-query coverage gap and ASTRA-10G-R1-001 all CLOSED.

Delivered: game-scoped Game Rule Facts (`pitHagArbitraryDeaths`, `toymakerDemonSkipOccurred`) as one Current-State primitive with a pure planner, one-commit `resolveGameRuleFacts` behind the persistence preflight, participant-less `gameRuleFact` History, atomic expiry inside the phase rollover and a Rules Query reader; the Pit-Hag Demon branch (Role change + fact in one resolution) and the shared arbitrary-death gate; Toymaker skip bookkeeping with a derived required/satisfied state; Manual Information Delivery (`kind: "manual"`, 4,000 characters) through Manual resolution, with structured v24 deliveries unchanged; the Storyteller-private Activity surface with honest grouping and delivery removal; Dawn Review over one shared unfinished-Night derivation (Night → Day disabled under Privacy Mode); Grimoire ability-used and Actual Alignment markers and the global Rule-Fact strip; terminal Finish Game (authoritative close first, retained ended snapshot, no Undo, lobby detached) with a read-only ended review; 4,000-character command caps on Storyteller and Night-step notes; and a fix for Grimoire target picking at phone width found by the Section 24 check.

Deferred hardening (recorded, not Phase 10G blockers): store-wide E1 precommit generalization; localStorage quota transaction/recovery (Opus reproduced a quota failure; 10G closes the per-note vector only); dynamic Undo trimming; broader persistence-health monitoring; winner/result modeling, if ever separately authorized.

**Phase 10 — COMPLETE.** With 10G closed and integrated, every Phase 10 slice (10A–10G) is closed and integrated into `main`.

## Phase 10H — Storyteller UI/UX & Visual Design System

**Status:** **CLOSED — READY FOR RULES-FIRST INTEGRATION** (Sol status decision). Software implementation and review are complete. It is **not yet integrated**: production RTDB Rules deployment/verification and `main` integration have not occurred.\
**Branch:** `dev/phase-10h-ui`\
**Starting baseline:** `e0ba539ae448eb494ca5739564a39c49d2e59467` — the exact post-10G documentation-closure tip of `main`.\
**Final reviewed implementation checkpoint:** `9263fc79ed4ce20b9eee85a616038266cbb3ae58` (R3.2; supersedes R2 `668dc3dff4930d42e79e2fcc52b0877812f2abee`).\
**Schema/store:** v26 on `dev/phase-10h-ui` (v25 baseline). `main` remains pre-10H (v25) until integration.\
**Firebase RTDB Rules:** new `revealAcks/{uid}` and `results/{uid}` Rules exist on `dev/phase-10h-ui` (repository `rules.json` SHA-256 `2ec0aa3795f6a82148273d8cbcd41fb3a6ab56ec37e55d8bca9900bfb454d92e`; unchanged by R3–R3.2). They require a **Rules-first production release** (deploy, then verify the deployed Rules equal the repository Rules) **before** client/`main` integration. They are not yet deployed.\
**Phase document:** `PHASE10H.md` (closure record §0; final record §§13–20).

10H is a newly inserted post-10G product/design phase. It does **not** reopen Phase 10G, invalidate the Phase 10A–10G closure evidence, or change the frozen authority/workflow primitives. Its purpose is to overhaul the Storyteller-facing web UI around the now-stable mechanics before high-volume canonical character coverage expands the interface further.

### Phase 10H closure (not yet integrated)

Delivered UX architecture (full record: `PHASE10H.md` §§13–16):
- hybrid cinematic visual language; Source Sans 3 operational typography alongside the identity fonts;
- an oval, fitted, Grimoire-centred Storyteller interaction model (Free Roam retained), with Shown Role as the primary presentation while Actual Role stays explicit and authoritative, and density-tiered Reminders;
- desktop / tablet-dock / phone-sheet shell. On phone, the spatial Table acts as a locator alongside the Roster, and the Roster replaces it when required. Participant workspace order: Truth → Now → Identity → Records → Admin;
- current Night actor + modular action card; staged Grimoire-centred Setup; calm Day presentation;
- Storyteller-declared Good/Evil result or End Without Result (no win inference);
- player role reveal/reseal/acknowledgement, a player-safe result snapshot, latest-only Information Delivery, player own-Life visibility, and Town notes retained through post-game review;
- store/schema v26: the `revealToken` participation token, advisory `revealAcks/{uid}` acknowledgement, private self Night Life projection, `GameResult`, terminal `results/{uid}` and terminal recovery/receipt behavior;
- every frozen authority/privacy invariant from earlier phases preserved.

Final review gate at `9263fc79ed4ce20b9eee85a616038266cbb3ae58` (full record: `PHASE10H.md` §17):
- lineage: initial implementation `6f312591b495e53ff888384f0d733116209c6959` → Astra remediation R1 `f2abdf832a894cc8751212284c2e1e11da1eee11` → Astra remediation R2 `668dc3dff4930d42e79e2fcc52b0877812f2abee` → initial docs closure `a15dcbc5e5fcb6f46abcc3b02b4919c18539ee1d` → post-closure PR review remediation R3 `938e10d55b6363dcb7e2109e3eba2799e6a1b7a0` → R3.1 lifecycle fence `05c4fd51d0a592ca480bde36c74cced306a6fdee` → R3.2 irreversible terminal boundary / **final reviewed implementation** `9263fc79ed4ce20b9eee85a616038266cbb3ae58`;
- opening PR #1 triggered an additional independent Codex review after the initial closure record. Its findings caused a narrow software-review reopening of the terminal lifecycle and game-scoped UI state, not a 10H design reopening;
- Luna final R3.2 targeted verification: **PASS**. Astra final R3-CLOSURE-001 re-closure: **PASS**, with no new findings;
- **ASTRA-10H-001 through ASTRA-10H-009 remain CLOSED**. **PR-10H-001 through PR-10H-004 CLOSED**; **R3-ADJ-001 CLOSED**; **R3-CLOSURE-001 CLOSED** (writer-runtime `terminalSignalAttempted` latch);
- normal suite **4392/4392 across 192 files**; Firebase Rules emulator **240/240, 0 skipped**; typecheck **PASS**; production build **PASS**; diff check **PASS**; final review worktrees clean;
- historical only: the initial closure record reported 4346/4346 across 188 files and 228/228 emulator tests at R2 `668dc3d`. That evidence is superseded and is not the final gate.

Hardware acceptance: **AC-064** (real-iPhone Safari touch) and **AC-066** (notched-device safe-area) are **WAIVED FOR PHASE CLOSURE — not passed**.
- Real physical-device access to the exact reviewed build was unavailable. Extensive rendered phone/tablet browser evidence passed through Luna and Astra.
- A genuine physical-device defect observed later is ordinary follow-up defect/hotfix work. The waivers are never recorded retroactively as passes. See `PHASE10H.md` §18.

Remaining software closure blockers: **none**.

Release order (`PHASE10H.md` §19):
1. deploy the RTDB Rules;
2. verify the deployed Rules equal the repository Rules (`npm run rules:verify`);
3. only then integrate the client/`main`;
4. only after integration verification, record CLOSED AND INTEGRATED.

Phase 10H is recorded as CLOSED AND INTEGRATED only after that integration is verified.

Original planned scope (planning record, 2026-10-04):
- establish a coherent Silverwick visual identity and reusable design-token/component system;
- overhaul the Grimoire/player-seat hierarchy, Player Drawer/workspaces, navigation, dialogs, panels and responsive layout;
- consolidate visual presentation of Life, Role, Alignment, Effects, Reminders, Rule Facts, Night progress and Storyteller Activity;
- improve Setup/New Game, guided Night operation, Dawn Review, finished-game review and common table workflows;
- define typography, spacing, surfaces, iconography, focus/selected/disabled/error/loading/empty states and motion rules;
- make tablet/phone behavior intentional rather than a desktop layout compressed downward;
- preserve Privacy Mode/hidden-information boundaries and accessible keyboard/touch/screen-reader operation;
- create visual regression/reference states for dense real-game conditions, including 12–15 players, long names, multiple indicators and open workspaces.

Out of scope unless Sol separately authorizes it:
- new BOTC mechanical semantics, new ability automation or canonical character coverage;
- changing Current State / History / Information Delivery authority boundaries;
- schema, Firebase Rules, writer/fencing or projection redesign merely to support a visual preference;
- nominations or ordinary voting.

Design ownership for 10H:
- **Project owner / Guillermo:** visual direction and final product taste decisions.
- **ChatGPT / Sol:** product/UX contract, scope, acceptance criteria and adjudication.
- **Claude Code / Sonnet:** default design-system and frontend implementation lead after the design contract is frozen.
- **Claude Chat / Opus:** challenge interaction/architecture proposals where a design choice can affect state, privacy, workflow or maintainability.
- **Luna:** independent mechanical/responsive/accessibility/visual acceptance verification.
- **Astra:** adversarial review of hidden-information, Privacy Mode, stale/ended states and interaction edge cases.

Recommended project-scoped Claude tooling for 10H may include Anthropic `frontend-design`, Vercel `web-design-guidelines` and `react-best-practices`, Impeccable, Anthropic `webapp-testing`, and Playwright MCP. Installation is tooling preparation only; it does not itself authorize production redesign or prove design quality.

Planning record (2026-10-04): the first design deliverable should be one representative, dense Storyteller screen used as the visual north star: a populated Grimoire with realistic life/role/alignment/effect/reminder/rule-fact states, one selected participant/workspace, Night controls, and phone/tablet variants. Sol freezes the implementation contract only after the design direction and required states are clear.

## Phase 11 — Canonical character coverage (roadmap unchanged)

Phase 11 keeps its approved scope: full canonical Character / Traveler / Fabled / Loric semantic coverage (see 10F above and `PHASE10F.md` §18), added primarily through descriptors, evaluators, registered semantics and tests on the completed Phase 10 authority/workflow foundation (`PHASE10G.md` §29). Its architecture/scope challenge has not started. It is sequenced **after Phase 10H is integrated into `main`**: 10H is closed but not yet integrated, so Phase 11 must not begin yet.

## Phase workflow

1. Architecture challenge.
2. Sol implementation contract.
3. Claude Code implementation on a dedicated branch.
4. Luna mechanical verification.
5. Astra adversarial review.
6. Sol adjudication/remediation.
7. Targeted closure review.
8. Integrate closed checkpoint into `main`.
9. Update roadmap/handoff before branching the next subphase.

## Universal completion gate

A subphase closes only when approved scope is complete, accepted Blocker/High findings are resolved, migrations/version evidence are deterministic where relevant, Current State/History/Information Delivery boundaries remain coherent, ParticipantId and projection privacy are preserved, writer authority remains intact, relevant Undo/recovery behavior is verified, full tests/build/diff checks pass, and the final checkpoint is integrated into `main`.

## Branch strategy

- `main` contains integrated closed checkpoints.
- Each Phase 10 subphase starts from current `main` on a fresh branch.
- Reviewers verify exact commit identity rather than trusting branch names.
- `dev/phase-10c` was created from the exact integrated `main` carrying the Phase 10B closure.
- `dev/phase-10d` was created from the exact integrated `main` carrying the Phase 10C closure.
- `dev/phase-10e` starts from the exact final `main` of the Phase 10D integration: the docs-only integration record directly on top of the Phase 10D closure commit `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`.
- `dev/phase-10f` starts from the exact final integrated `main` of the Phase 10E integration: the docs-only integration record directly on top of closure checkpoint `6129c7f4585da0e12aeea3a9a5007c88fb508ad7`.
- `dev/phase-10g` starts from the exact final integrated `main` of the Phase 10F integration: `52e685b16e76df15154512a52a34831a6aeba399`.
- `dev/phase-10g` was fast-forwarded into `main` at `2aabccbb925183c2359bef5d48a2ee5cca2dfd03`; the branch is retained at that exact reviewed checkpoint.
- `dev/phase-10h-ui` starts from the exact post-10G documentation-closure `main` checkpoint `e0ba539ae448eb494ca5739564a39c49d2e59467`. Keep 10H UI/design work isolated there until its own review and integration gate.

## Immediate next action

Phase 10H is **CLOSED — READY FOR RULES-FIRST INTEGRATION** at final reviewed implementation `9263fc79ed4ce20b9eee85a616038266cbb3ae58` (R3.2), with the post-R3 documentation reconciliation checkpoint on top on `dev/phase-10h-ui`. Next:

1. Production RTDB Rules deployment from the final Phase 10H closure checkpoint (`npm run rules:deploy`).
2. Verify the deployed Rules equal `src/firebase/rules.json` (`npm run rules:verify -- --project <PROJECT_ID>`, exit 0).
3. Only then integrate the final Phase 10H closure checkpoint into `main` and verify the integration.
4. Only after that verification, record Phase 10H as CLOSED AND INTEGRATED.

Stop point: `main` stays at `e0ba539ae448eb494ca5739564a39c49d2e59467` until steps 1–2 succeed. No Rules deployment, client deployment or `main` integration has occurred yet. Phase 11 canonical coverage remains queued and starts only after the 10H integration completes.
