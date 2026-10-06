# Phase 10H — Storyteller UI/UX & Visual Design System

**Status:** **CLOSED AND INTEGRATED** (2026-10-06 UTC). Production RTDB Rules were deployed and verified first; only then was `main` fast-forwarded (§19).\
**Phase created:** 2026-10-04\
**Closure recorded:** 2026-10-06. Initial documentation closure `a15dcbc5e5fcb6f46abcc3b02b4919c18539ee1d`. Reconciled after the post-closure review R3–R3.2 by `2007f8ca058f472c961b4594e15960acdc4d50e9` (§17). Final integration recorded by the docs-only commit directly on top of `2007f8c` on `main` (§19).\
**Branch:** `dev/phase-10h-ui`\
**Start:** `e0ba539ae448eb494ca5739564a39c49d2e59467` (post-10G `main`)\
**Final reviewed implementation:** `9263fc79ed4ce20b9eee85a616038266cbb3ae58` (R3.2). It supersedes `668dc3dff4930d42e79e2fcc52b0877812f2abee` (R2), the final reviewed implementation in the initial closure record.\
**Store/schema:** v26, integrated on `main`\
**Firebase RTDB Rules:** Phase 10H adds the narrowly authorized `revealAcks/{uid}` and `results/{uid}` paths (§15). **Deployed to production and verified:** project `mobile-botc`, instance `mobile-botc-default-rtdb`, Rules SHA-256 `2ec0aa3795f6a82148273d8cbcd41fb3a6ab56ec37e55d8bca9900bfb454d92e`.\
**Integration:** **complete.** `main` was fast-forwarded (no merge commit) from `e0ba539ae448eb494ca5739564a39c49d2e59467` to the integration checkpoint `2007f8ca058f472c961b4594e15960acdc4d50e9`, after the Rules release was verified. The final closure-doc commit sits directly on top (§19).

---

## 0. Closure record (read this first)

**Phase 10H is CLOSED AND INTEGRATED.** Software implementation and review are complete.

- Production RTDB Rules were deployed to project `mobile-botc` (instance `mobile-botc-default-rtdb`) and verified **before** `main` integration.
- `main` was then fast-forwarded to `2007f8ca058f472c961b4594e15960acdc4d50e9`, and the integration was verified.
- Phase 11 is now unblocked. The release record is in §19.

History: the status was **CLOSED — READY FOR RULES-FIRST INTEGRATION** from the initial closure record until this integration.

- Final reviewed implementation: `9263fc79ed4ce20b9eee85a616038266cbb3ae58` (R3.2). Review lineage, evidence and findings: §17.
- Opening PR #1 triggered an additional independent Codex review after the initial closure record (`a15dcbc`, at R2 `668dc3d`). Its accepted findings caused a narrow software-review reopening (R3, R3.1, R3.2), not a reopening of the Phase 10H design. That review chain is now complete.
- Original Astra findings ASTRA-10H-001 through ASTRA-10H-009: **CLOSED**. Post-closure findings PR-10H-001 through PR-10H-004, R3-ADJ-001 and R3-CLOSURE-001: **CLOSED**.
- Luna final R3.2 targeted verification: **PASS**. Astra final R3-CLOSURE-001 re-closure: **PASS**, with no new findings.
- Final independent normal suite: **4392/4392 across 192 files**. Firebase Rules emulator: **240/240, 0 skipped**. Typecheck, production build and diff check: **PASS**. The final review worktrees were clean.
- Hardware acceptance: **AC-064 WAIVED** and **AC-066 WAIVED** for phase closure. Both are waived, **not passed** (§18).
- Remaining software closure blockers: **none**.

§§1–12 below are the **original planning record of 2026-10-04**, preserved for traceability. Where they describe work as future, or the contract as not yet frozen, §§13–20 supersede them. The frozen implementation contract is not reproduced in this repository. Source comments cite it as `10H-IMPLEMENTATION-CONTRACT-v1.0`, with acceptance criteria numbered `10H-AC-…`. This document records its outcome.

---

## 1. Purpose

Phase 10H is a newly inserted post-10G product/design phase.

Phase 10G and the 10A–10G mechanical/state program remain **closed and integrated**. 10H does not reopen prior findings, change their acceptance evidence, or weaken the authority/workflow primitives established through Phase 10.

The purpose of 10H is to overhaul Silverwick Hollow's Storyteller-facing web UI around the now-stable mechanics **before** Phase 11 expands canonical character coverage at high volume.

The outcome should be a coherent, reusable Silverwick design system and a substantially improved Storyteller experience rather than a collection of isolated cosmetic changes.

---

## 2. Product objective

The Storyteller should be able to run a dense live game quickly and confidently while Silverwick presents mechanical truth, private bookkeeping, workflow guidance and available actions with a clear visual hierarchy.

The redesign must make the interface:

- faster to scan during live play;
- visually coherent across Setup, Day, Night and finished-game review;
- comfortable on desktop, tablet and phone;
- clear under dense real-game states;
- accessible by keyboard, touch and assistive technology;
- consistent with Privacy Mode and hidden-information boundaries;
- expressive enough to feel like Silverwick Hollow rather than generic application chrome.

Visual polish is not permission to alter authoritative behavior.

---

## 3. Authority and non-regression constraints

The following remain frozen constraints:

- Storyteller is the authoritative writer.
- Current State remains the source of present mechanical truth.
- History remains explanatory/audit state.
- Information Delivery remains what was communicated.
- Actual Role and Shown Role remain distinct.
- Actual Alignment and shown/perceived Alignment remain distinct.
- PlayerId / ParticipantId / ParticipantRef identity rules remain unchanged.
- Effects, Reminders, Rule Facts, Life, Role, Alignment and ability-resolution seams remain authoritative as already frozen.
- Public/private/self projections remain allowlisted and fail closed.
- Privacy Mode must remove/suppress private Storyteller material according to its existing contract.
- Ended games remain read-only review.
- Nominations and ordinary voting remain out of scope.
- No UI refactor may bypass writer fencing, stale-state checks, planner seams or command refusals.

A visual or interaction proposal that requires changing one of these properties is an architecture question for Sol, not an implementation convenience.

---

## 4. Design ownership

| Responsibility | Owner |
|---|---|
| Visual direction and final product taste | **Project owner / Guillermo** |
| Product/UX requirements, scope and acceptance contract | **ChatGPT / Sol** |
| Default UI/design-system implementation | **Claude Code / Sonnet** |
| Architecture/interaction challenge where design affects state, privacy or maintainability | **Claude Chat / Opus** |
| Independent mechanical/responsive/accessibility/visual verification | **Codex / Luna** |
| Adversarial privacy/hidden-information/stale/ended-state interaction review | **Codex / Astra** |

Sonnet is the default hands-on design/implementation lead for 10H after the contract is frozen. Opus does not become a co-designer for routine visual work; it is used when the proposed experience creates a material architecture or interaction-contract question.

---

## 5. Recommended Claude Code design toolchain

These tools are recommended for project-scoped 10H work. Their installation is tooling preparation only; it is not a design approval or implementation PASS.

- Anthropic `frontend-design`
- Vercel `web-design-guidelines`
- Vercel `react-best-practices`
- Impeccable
- Anthropic `webapp-testing`
- Playwright MCP

Optional later diagnostic tooling:

- Chrome DevTools MCP

The project should also create a Silverwick-specific skill/design reference after the visual direction is approved, so later screens reuse the same design decisions rather than re-inventing them.

Candidate project skill:

`.claude/skills/silverwick-ui-design/`

It should eventually capture approved design tokens, typography, surfaces, component grammar, player-seat anatomy, effect/reminder presentation, responsive behavior, privacy treatment and representative screenshots/states.

---

## 6. In-scope design surfaces

### 6.1 Global design system

- color system and semantic colors;
- typography scale and hierarchy;
- spacing/grid system;
- surfaces, borders, elevation and contrast;
- iconography;
- motion/transition rules;
- focus, hover, pressed, selected, disabled and destructive states;
- loading, empty, warning and error states;
- responsive breakpoints/behavior;
- reusable component primitives and design tokens.

### 6.2 Storyteller navigation and shell

- global navigation;
- top-level status and phase context;
- dialogs, drawers, sheets, popovers and alerts;
- notification/error surfaces;
- Storyteller-only controls;
- page-level spacing and responsive structure.

### 6.3 Grimoire and participant presentation

- player/seat anatomy;
- role and alignment presentation;
- alive/dead/ghost-vote/exile grammar;
- ability-used state;
- Effect indicators;
- Reminder notation;
- Rule Fact/global modifier presentation;
- selection, targeting and multi-target states;
- long names and dense marker states;
- fixed/movable seat behavior.

### 6.4 Player detail / workspaces

- participant detail hierarchy;
- Life controls;
- Role/Alignment controls;
- Effects;
- Reminders;
- abilities;
- Activity/history/delivery access where appropriate;
- progressive disclosure for advanced operations.

### 6.5 Night operation

- Night Order/dashboard;
- guided ability workspace;
- manual workspace;
- target selection;
- Storyteller judgment prompts;
- Night progress;
- Dawn Review;
- visibility at narrow phone widths.

### 6.6 Setup and lifecycle

- New Game / Setup;
- script and role composition workflow;
- readiness/warnings;
- Go Live/multiplayer state presentation;
- Finish Game;
- ended/read-only review;
- return to Home / review finished game.

### 6.7 Activity and bookkeeping

- History;
- Information Delivery;
- Storyteller Activity;
- global Rule Fact strip;
- notes and bounded free text;
- clear distinction between authoritative truth, notation and explanatory records.

---

## 7. Required representative states

10H must be designed and verified against realistic dense states, not only empty or happy-path screens.

At minimum:

- 12–15 occupied seats;
- long player names;
- mixed alive/dead/exiled/ghost-vote states;
- Actual-vs-Shown Role difference;
- Actual-vs-Shown Alignment difference;
- several simultaneous Effects;
- several Reminder tokens;
- ability-used markers;
- global Rule Facts;
- selected participant with an open workspace;
- active Night Order/guided ability step;
- manual/judgment path;
- Privacy Mode;
- multiplayer warning/error state;
- ended/read-only review;
- phone, tablet and desktop widths.

The same information hierarchy should remain understandable across these states without horizontal overflow or inaccessible controls.

---

## 8. First design deliverable — visual north star

Before broad production refactoring, create one representative Storyteller screen that intentionally combines the major information layers:

- populated Grimoire;
- realistic player-state variety;
- Effects and Reminders;
- Role/Alignment variance;
- Rule Fact state;
- one selected participant/workspace;
- Night controls/progress;
- desktop/tablet/phone variants.

This screen is the visual north star for 10H.

The project owner approves the visual direction. Sol then converts the accepted direction into the frozen design/implementation contract and acceptance criteria.

Do not treat an attractive isolated mock as sufficient. The design must survive the representative-state matrix above.

---

## 9. Candidate work sequence

This sequence was planning guidance until Sol froze the implementation contract. The delivered outcome is recorded in §§13–17.

### 10H-A — Interface audit + visual direction

- inventory current screens/components;
- identify duplicated visual patterns and inconsistent interactions;
- capture representative current screenshots;
- produce the visual north star;
- approve typography, palette, density, surfaces and interaction character.

### 10H-B — Design system foundation

- tokens;
- typography;
- spacing;
- button/input/dialog/drawer/sheet primitives;
- indicators/badges/markers;
- focus and accessibility grammar;
- responsive shell.

### 10H-C — Core Storyteller flows

- Grimoire;
- Player Drawer/workspaces;
- Night Order/guided resolution;
- Setup/New Game;
- Activity;
- Finish Game/ended review.

### 10H-D — Responsive + accessibility hardening

- desktop/tablet/phone;
- keyboard;
- screen-reader semantics;
- touch targets;
- focus management;
- reduced-motion behavior;
- dense-state overflow.

### 10H-E — Visual regression + closure

- representative-state screenshot/reference suite;
- workflow regressions;
- Privacy Mode checks;
- responsive checks;
- final Luna verification;
- Astra adversarial review where privacy/state edges are material;
- Sol closure/integration.

---

## 10. Explicitly out of scope

Unless Sol separately reopens the contract:

- Phase 11 canonical character semantic coverage;
- new role/ability rules or game-rule interpretation;
- new persisted mechanics solely to support visual decoration;
- schema/store bumps for cosmetic state;
- Firebase Rules changes for visual convenience;
- writer/session protocol redesign;
- projection weakening;
- nominations or ordinary voting;
- unrelated persistence/performance hardening deferred from 10G.

A UI bug discovered during 10H may be fixed if Sol explicitly accepts it into 10H scope; otherwise record and route it separately.

Closure note: the frozen contract narrowly authorized the store/schema v26 additions (§14) and the two RTDB Rules paths (§15). They exist for functional player-reveal acknowledgement and the terminal result, not for cosmetic state or visual convenience, so the exclusions above still hold.

---

## 11. Evidence expectations

10H cannot close on source review alone.

Expected evidence includes:

- exact starting/review checkpoints;
- clean scope/diff review;
- typecheck;
- full normal test suite;
- Firebase emulator suite when affected paths warrant it;
- production build;
- `git diff --check`;
- rendered browser verification;
- desktop/tablet/phone widths;
- keyboard/focus review;
- accessibility semantics;
- Privacy Mode DOM/visibility checks;
- representative dense-state screenshots/reference comparisons;
- regression tests for any interaction/state bug corrected during the redesign.

Visual approval by the project owner is a product gate, not a substitute for mechanical verification.

---

## 12. Phase 11 relationship

Phase 11 retains its existing scope: canonical Character / Traveler / Fabled / Loric and jinx coverage on the completed ability-resolution foundation.

10H is intentionally placed first so Phase 11 can add high-volume character coverage into a stable visual/component system rather than forcing a large retrofit afterward.

No Phase 11 implementation starts until 10H closes and is integrated unless Sol explicitly changes the roadmap.

---

## 13. Final product decisions

Phase 10H delivered these product decisions under the frozen implementation contract:

- **Visual language:** a hybrid cinematic visual language. Ceremonial moments get a cinematic treatment (the first role reveal, the result transition and the post-game summary). Routine live operation stays operational and legible.
- **Typography:** Source Sans 3 is the operational typeface, used alongside the identity fonts (Cinzel Decorative, Cormorant Garamond, IM Fell English). All four are self-hosted under `public/fonts/` with their OFL licences.
- **Grimoire:** an oval, fitted Grimoire. Free Roam seating is retained.
- **Interaction model:** Grimoire-centred. The Table is the primary surface from which participants, Night actors and actions are reached.
- **Role presentation:** Shown Role is the primary presentation. Actual Role remains explicit and authoritative, and is never hidden or inferred from Shown Role.
- **Reminders:** density-tiered Reminder presentation, so dense seats stay readable without losing notation.
- **Phone Table:** the spatial Table acts as a locator, alongside a textual Roster (and a Labels lens that preserves full Effect/Reminder detail). The Roster replaces the spatial Table when required.
- **Participant workspace:** sections ordered Truth → Now → Identity → Records → Admin.
- **Adaptive dock/sheet:** desktop arranges coordinated regions around a dominant Table. Tablet shows one secondary dock at a time, and phone one bottom sheet/workspace at a time.
- **Night:** the current Night actor plus a modular action card. Tapping the lit actor opens or resumes the action, and the draft is kept while the card is hidden.
- **Setup:** staged, Grimoire-centred Setup.
- **Day:** calm Day presentation.
- **Game end:** the Storyteller declares a Good or Evil victory, or chooses End Without Result. Nothing is inferred, and there is no win-condition evaluation in 10H.
- **Player role card:** reveal, reseal (hide) and acknowledgement. The sealed card distinguishes a first reveal, a neutral "role was updated" notice, and an already-seen identity.
- **Player-safe result snapshot:** after a declared result, players see only the winner and the declaration moment.
- **Information Delivery:** latest-only player presentation. The player sees the latest private information from the Storyteller, with no history list. Storyteller-side Information Delivery records are unchanged.
- **Player Life visibility:** a player sees their own current Life State, including at Night. Public/player-town Night withholding of everyone's Life State is unchanged.
- **Town notes:** retained through post-game review.

Storyteller shell UI state (lens, dock tab, workspace detent, Night cursor, action card) is session-local by construction. It is never part of the game record, schema, checkpoints, projections, Undo or URLs.

---

## 14. Store/schema v26 architectural additions

Phase 10H moves the store and game schema from v25 to **v26**. The v25 → v26 migration is a stamp. It invents nothing for existing data: no existing participation receives a reveal token until its visible identity next changes, and no legacy ended game receives a Game Result (it reads as "No recorded result").

- **`revealToken` participation token.** An opaque random token (128 bits, base64url) names one participation's *currently projected visible identity*: its projected Shown Role and player-facing Shown Alignment.
  - A new participation instance always receives a fresh token, and seat reuse never inherits one.
  - Every change to the projected visible identity mints a fresh token. Undo is a transition like any other, so A → B → A ends on a third token and an old acknowledgement can never become valid again.
  - Hidden Actual Role/Alignment changes, Effects, Reminders, Life, notes and packets never rotate it.
  - It is applied at the store's one central game-commit seam and is never derived from ParticipantId or any other identity.
- **`revealAcks/{uid}` advisory acknowledgement.** A player's "I've seen my role" acknowledgement records the token they saw. "Viewed" means `ack === currentRevealToken` and nothing else. It is advisory runtime state only and never game truth.
- **Private self Night Life projection.** The player's private self envelope carries the player's own current Life State, using the same normalization as the public Day projection but not withheld at Night. It is attached only to the player's own record and is never a Life Event or anyone else's Life. Public Night withholding is unchanged.
- **`GameResult`.** A Storyteller-declared result (`winner`: Good or Evil, `declaredAt`: the live Game Moment). It has a strict shape, with no reason taxonomy and no participant data. End Without Result records no Game Result.
- **Terminal `results/{uid}`.** The player-safe terminal snapshot is exactly `{ version: 1, sessionId, winner, declaredAt }`. It carries no Role, Alignment, ParticipantId, Effect, Reminder, History, delivery or Storyteller notes, and no "you won/lost" derivation.
  - It is published only inside the one fenced atomic terminal close, only for a declared Good or Evil victory, and only to coherent current participants.
  - End Without Result publishes nothing.
- **Terminal recovery/receipt.** The same terminal commit also writes the Storyteller's own result receipt, the identical player-safe payload, at `results/{storytellerUid}`. A declared result is therefore durably recoverable even with zero phone recipients. The terminal close also clears reveal acknowledgements.
- **Terminal lifecycle boundary (final architecture after R3–R3.2).**
  - A declared-result terminal publication **preflights** its fallible authoritative reads (Storyteller uid, roster, participant records) **before** the irreversible public `ended` signal. End Without Result has no preflight.
  - A first-ever failure before any signal attempt wrote nothing terminal. It may safely restore the live writer (renewal cadence, accepting writes) and the deferred join resync.
  - Once a `SessionWriter` has **ever** attempted the irreversible ended signal, that fact is monotonic for the writer's lifetime (`terminalSignalAttempted`). This latch is **writer-runtime state only**, never persisted: not in the game record, store, checkpoints or projections. A lost response can hide a signal that landed, so an attempt is treated as possibly landed.
  - After that, a later retry failure cannot reopen ordinary gameplay, projection or join resync; it stays fail-closed and retry-oriented. Retries may still re-attempt the ended signal.
  - Lost-response / already-ended recovery keeps exactly the committed outcome: the declared result read back from the receipt, or a confirmed absence (End Without Result). A different retry selection never rewrites it, and an outcome that cannot be confirmed fails closed.
  - Any remote failure leaves the local game unchanged (it becomes the ended snapshot only after a successful close) and keeps the intent for retry.
  - A generic close cannot bypass an outstanding Finish Game intent. While one is outstanding (in flight or failed), only the terminal seam may close the lobby, and the end-the-lobby actions become "Retry finishing game".
  - `newGame` / `endGame` are total no-ops while a terminal close is actively `closing`.
  - A failed terminal intent may still be deliberately replaced or discarded. It is cleared together with its old game and is never retried against a new one.

---

## 15. Firebase RTDB Rules

Phase 10H adds two narrowly authorized paths under `lobbies/{code}` in `src/firebase/rules.json`. No other Rules path changes. Repository Rules SHA-256 on `dev/phase-10h-ui`: `2ec0aa3795f6a82148273d8cbcd41fb3a6ab56ec37e55d8bca9900bfb454d92e`. On `main` it is `9cccdc7f474d4948007f5e3b62fa485d0e20e6e06b50194258f348e01e0db076`, the Rules recorded as deployed during the Phase 10D release.

- **`revealAcks/{uid}`**
  - A rostered player may write only their own entry, in an active v2 session. The value must be a reveal-token string matching `^[A-Za-z0-9_-]{16,64}$`, and the player cannot delete it.
  - The player reads only their own entry. The Storyteller reads all entries.
  - The fenced Storyteller writer (lease, write-guard token and revision) may only clear acknowledgements.
- **`results/{uid}`**
  - Only the fenced Storyteller writer may create an entry. It must not already exist, and it must be written in the same commit that moves the session from `active` to `ended`, with the same session id.
  - The value has exactly the schema in §14: `version` 1, `sessionId` bound to the session, `winner` `good` or `evil`, and `declaredAt` with phase `day`/`night` and an integer day ≥ 1. No other keys are allowed.
  - A player may read only their own entry, and only once the session has ended. The Storyteller reads all entries.

`src/firebase/rules.json` changed only in the initial implementation `6f31259`. R3, R3.1 and R3.2 did **not** change it, so the SHA-256 above is unchanged at the final reviewed implementation `9263fc79`.

These Rules are **deployed to production and verified** (project `mobile-botc`, instance `mobile-botc-default-rtdb`) and are on `main`. The release record is in §19.

---

## 16. Frozen invariants preserved

Phase 10H preserves every frozen authority and privacy invariant from earlier phases (§3):

- the Storyteller is the only authoritative game-state writer;
- Current State is present mechanical truth, History is explanatory, and Information Delivery is what was communicated;
- Actual vs Shown Role and Actual vs Shown Alignment remain distinct;
- PlayerId / ParticipantId / ParticipantRef identity is unchanged;
- the Life, Effect, Reminder, Rule Fact, Role, Alignment and ability-resolution seams remain authoritative as frozen;
- public/private/self projections remain allowlisted and fail closed;
- Privacy Mode and the projection boundaries hold;
- writer fencing (lease/guard/revision), stale-state checks, planner seams and command refusals are not bypassed;
- ended games remain read-only review;
- nominations and ordinary voting remain out of scope.

The v26 additions (§14) and the Rules paths (§15) were authorized by the frozen contract. They do not weaken any of these.

---

## 17. Closure review and evidence

### 17.1 Review lineage

Review lineage on top of `e0ba539ae448eb494ca5739564a39c49d2e59467`:

| Step | Checkpoint |
|---|---|
| Initial implementation | `6f312591b495e53ff888384f0d733116209c6959` |
| Astra remediation R1 | `f2abdf832a894cc8751212284c2e1e11da1eee11` |
| Astra remediation R2 (final reviewed implementation of the initial closure record; now historical) | `668dc3dff4930d42e79e2fcc52b0877812f2abee` |
| Initial documentation closure checkpoint (docs only) | `a15dcbc5e5fcb6f46abcc3b02b4919c18539ee1d` |
| Post-closure PR review remediation R3 | `938e10d55b6363dcb7e2109e3eba2799e6a1b7a0` |
| R3.1 lifecycle-fence remediation | `05c4fd51d0a592ca480bde36c74cced306a6fdee` |
| R3.2 irreversible terminal-boundary remediation / **final reviewed implementation** | `9263fc79ed4ce20b9eee85a616038266cbb3ae58` |

### 17.2 Original review findings

ASTRA-10H-001 through ASTRA-10H-009 were raised and closed through R1 and R2. They remain **CLOSED**, and are not renumbered or reopened by the post-closure review.

### 17.3 Post-closure review (PR #1)

Opening PR #1 triggered an additional independent Codex review after the initial closure record (`a15dcbc`, at R2). Its accepted findings caused a **narrow software-review reopening** of the terminal lifecycle and game-scoped UI state. This was not a reopening of the Phase 10H design, product decisions or contract. Remediation landed as R3, R3.1 and R3.2.

| Finding | Defect | Status |
|---|---|---|
| **PR-10H-001** | Terminal result preflight originally happened after the irreversible ended signal. | **CLOSED** |
| **PR-10H-002** | Structured Town Note content was incomplete in post-game review. | **CLOSED** |
| **PR-10H-003** | The Night cursor could cross game identity. | **CLOSED** |
| **PR-10H-004** | A failed Finish Game could be retried through a generic result-less close. | **CLOSED** |
| **R3-ADJ-001** | A direct `newGame` / `endGame` during an in-flight terminal close could partially transition local lifecycle state. | **CLOSED** |
| **R3-CLOSURE-001** | A later close retry forgot that the same writer had already attempted the irreversible ended signal. | **CLOSED**, via the writer-lifetime monotonic `terminalSignalAttempted` latch (writer-runtime only, never persisted) |

The resulting final terminal-lifecycle architecture is recorded in §14.

### 17.4 Final evidence at `9263fc79ed4ce20b9eee85a616038266cbb3ae58`

- Luna final R3.2 targeted verification: **PASS**; required coverage complete;
- Astra final R3-CLOSURE-001 re-closure: **PASS**; required coverage complete; new findings: none;
- ASTRA-10H-001 through ASTRA-10H-009: **CLOSED**;
- PR-10H-001 through PR-10H-004, R3-ADJ-001 and R3-CLOSURE-001: **CLOSED**;
- final independent normal suite: **4392/4392 across 192 files**;
- final Firebase Rules emulator: **240/240, 0 skipped**;
- typecheck: **PASS**;
- production build: **PASS**;
- diff check: **PASS**;
- final review worktrees: clean.

Remaining software closure blockers: **none**.

### 17.5 Historical evidence (superseded; not the final gate)

At R2 `668dc3dff4930d42e79e2fcc52b0877812f2abee`, the initial closure record reported the following. It is retained as history only and superseded by §17.4.
- Luna final targeted verification PASS and Astra final targeted closure PASS for ASTRA-10H-001..009;
- full suite 4346/4346 across 188 files; typecheck, build and targeted diff check PASS;
- Firebase Rules emulator 228/228, zero skipped, from the last Rules-affecting checkpoint before R3. R2 changed no Firebase/Rules production source, so the emulator suite was not rerun for R2.

---

## 18. Hardware acceptance waivers

| Criterion | Status |
|---|---|
| **AC-064** — real-iPhone Safari touch validation | **WAIVED FOR PHASE CLOSURE** |
| **AC-066** — notched-device safe-area validation | **WAIVED FOR PHASE CLOSURE** |

These criteria are **WAIVED, not passed.**

- Real physical-device access to the exact reviewed build was unavailable at closure time, so no real-device evidence exists for either criterion.
- No physical-device evidence was performed after the initial closure record either: not for R2, not for the post-closure R3–R3.2 remediation, and not for the final reviewed implementation `9263fc79`. Both criteria remain WAIVED, not passed.
- Extensive rendered phone and tablet browser evidence passed through Luna and Astra. That browser evidence does not substitute for, and is not recorded as, a physical-device PASS.
- If a genuine physical-device defect is later observed (iPhone Safari touch or notched-device safe-area), it is valid follow-up work: a normal defect/hotfix. It is never grounds to rewrite this record or to record either criterion as passed retroactively.

---

## 19. Production release order — Rules first

Phase 10H changes `src/firebase/rules.json`. The web client ships from `main` automatically, but Rules change only through `npm run rules:deploy`. A v26 client running against pre-10H production Rules would be denied the new `revealAcks` and `results` paths. Therefore:

1. **Deploy the RTDB Rules** from the final Phase 10H closure checkpoint (the documentation checkpoint on top of the final reviewed implementation `9263fc79`): `npx firebase use <PROJECT_ID>`, then `npm run rules:deploy` (Realtime Database Rules only).
2. **Verify the deployed Rules equal the repository Rules:** `npm run rules:verify -- --project <PROJECT_ID>` (add `--instance <DB_INSTANCE>` for a non-default instance). It must exit 0, with the deployed Rules identical to `src/firebase/rules.json` (SHA-256 `2ec0aa37…`, §15).
3. **Only then integrate the client/`main`** to the final Phase 10H closure checkpoint, and verify the integration.
4. **Only after the integration verification**, record Phase 10H as CLOSED AND INTEGRATED.

Stop point: do not move `main` until steps 1 and 2 have both succeeded.

### 19.1 Release record — 2026-10-06 (UTC)

The release followed the order above.

1. **Rules deployment: SUCCESS.** The project owner ran `npm run rules:deploy`, deploying `src/firebase/rules.json` from `2007f8ca058f472c961b4594e15960acdc4d50e9`.
   - Firebase project: `mobile-botc`.
   - RTDB instance: `mobile-botc-default-rtdb`.
   - Rules SHA-256: `2ec0aa3795f6a82148273d8cbcd41fb3a6ab56ec37e55d8bca9900bfb454d92e`.
2. **Rules verification: SUCCESS.** The read-only `npm run rules:verify` reported: "Deployed Realtime Database rules for project \"mobile-botc\" match src/firebase/rules.json."
3. **`main` integration** happened only after that verification. `main` was fast-forwarded from `e0ba539ae448eb494ca5739564a39c49d2e59467` to `2007f8ca058f472c961b4594e15960acdc4d50e9`: 24 commits ahead / 0 behind, merge base exactly the previous `main`, no merge commit, squash, rebase or force push. After the push, `origin/main` = `origin/dev/phase-10h-ui` = `2007f8c` (0 ahead / 0 behind).
4. **Recorded CLOSED AND INTEGRATED** by the docs-only closure commit directly on top of `2007f8c` on `main`. It changes documentation only, so the deployed Rules still match `main`.

Steps 1–2 were owner-run and owner-reported; the integration session did not observe them directly. The client ships from `main` automatically, but that production client deployment was **not** independently observed from the integration session.

---

## 20. Next

Phase 10H is **CLOSED AND INTEGRATED**. Every step of §19 is complete: documentation closure (`a15dcbc`, then `2007f8c`), Rules deploy and verify, `main` fast-forward, and this closure record.

**Phase 11 (canonical character coverage) is now unblocked** and is the next implementation phase.

If a genuine physical-device defect is observed later (AC-064 / AC-066, §18), it is ordinary follow-up defect/hotfix work.
