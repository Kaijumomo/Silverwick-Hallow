# Silverwick Hollow — Master Implementation Plan

**Status:** Active canonical roadmap  
**Updated:** 2026-09-26\
**Integrated branch:** `main`  
**Phase 10A closure checkpoint:** `d798266b988e49f904aa8f8658c917fd5b7e7abb`  
**Pre-10B Firebase lifecycle hotfix checkpoint:** `38b10119544ce2c02590e9bc9c741aab995a91d1`  
**Schema:** v20 on `dev/phase-10b` (v19 on `main`)\
**Current phase:** Phase 10B — Effect Lifecycle + Visual Effect Indicators

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

## Phase 10 roadmap

### 10B — Effect Lifecycle + Visual Effect Indicators
**Status:** IMPLEMENTED on `dev/phase-10b`; Opus architecture remediation SOL-10B-R1…R9 applied — awaiting targeted Opus re-check, then Luna verification (not closed). See `PHASE10B.md`.

Implemented: store v20 with explicit `gameSchemaVersion` evidence; Effect
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
Structured placement/removal/update, source/target/lifetime, free text where appropriate, accessible token grammar, future-engine seam.

### 10D — Role Transitions
Actual Role and Shown Role transitions, correction vs gameplay semantics, durable History and replacement workflows.

### 10E — Alignment Transitions
Actual Alignment mutation semantics, shown/perceived alignment where needed, History/provenance, correction vs gameplay transition.

### 10F — Guided Ability Resolution / Night Actions
Structured ability semantics, deterministic interaction resolution, Storyteller prompts for judgment/choice, effect/protection/poisoning interactions, and authoritative mutation through 10A–10E seams.

### 10G — Advanced Storyteller Bookkeeping / Final Visual Integration
Ability-specific bookkeeping that does not belong in generic Life/Effect/Reminder/Role/Alignment primitives, final visual integration, and Phase 10 closure.

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
- `dev/phase-10b` must be moved/recreated from the post-hotfix integrated `main` before 10B implementation begins.

## Immediate next action

Do **not** start 10B by adding ad-hoc Poisoned/Drunk/Protected booleans.

First audit the existing structured Effect model and define the smallest correct authoritative Effect lifecycle for applying, updating, expiring, removing and correcting Effects, including source/provenance, lifetime semantics, stacking/replacement, phase rollover, privacy/projections, Undo/recovery and the future ability-engine seam.
