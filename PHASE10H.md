# Phase 10H — Storyteller UI/UX & Visual Design System

**Status:** **CLOSED — READY FOR RULES-FIRST INTEGRATION** (Sol status decision; software implementation and review complete)\
**Phase created:** 2026-10-04\
**Closure recorded:** 2026-10-06 (this documentation closure checkpoint)\
**Branch:** `dev/phase-10h-ui`\
**Start:** `e0ba539ae448eb494ca5739564a39c49d2e59467` (post-10G `main`)\
**Final reviewed implementation:** `668dc3dff4930d42e79e2fcc52b0877812f2abee`\
**Store/schema:** v26 on `dev/phase-10h-ui` (v25 on `main` until integration)\
**Firebase RTDB Rules:** Phase 10H adds the narrowly authorized `revealAcks/{uid}` and `results/{uid}` paths (§15). They are **not yet deployed to production**.\
**Integration:** **not yet performed.** `main` remains `e0ba539ae448eb494ca5739564a39c49d2e59467`. Production release is Rules first, then client/`main` (§19).

---

## 0. Closure record (read this first)

Phase 10H software implementation and review are complete. Sol's status decision is **CLOSED — READY FOR RULES-FIRST INTEGRATION**.

Phase 10H is **not** yet integrated. The production RTDB Rules have not been deployed, and `main` has not moved. The phase is recorded as closed and integrated only after the Rules-first release (§19) and the integration verification.

- Final reviewed implementation: `668dc3dff4930d42e79e2fcc52b0877812f2abee`. Review lineage, evidence and findings: §17.
- Luna final targeted verification: **PASS**. Astra final targeted closure: **PASS**. ASTRA-10H-001 through ASTRA-10H-009: **CLOSED**.
- Full unit/integration suite: **4346/4346 across 188 files**. Typecheck, production build and the final targeted diff check: **PASS**. The final reviewed worktree was clean.
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
- **Terminal recovery/receipt.** The same terminal commit also writes the Storyteller's own result receipt, the identical player-safe payload, at `results/{storytellerUid}`. A declared result is therefore durably recoverable even with zero phone recipients.
  - A retry that finds the session already ended keeps exactly that commit's confirmed outcome: either the declared result read back from the receipt, or a confirmed absence (End Without Result). A different retry selection never rewrites it, and an outcome that cannot be confirmed fails closed.
  - Any remote failure leaves the local game live and unchanged, with the intent kept for retry.
  - The terminal close also clears reveal acknowledgements.

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

These Rules exist on `dev/phase-10h-ui` only. **They have not been deployed to production.** The production release order is in §19.

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

Review lineage on top of `e0ba539ae448eb494ca5739564a39c49d2e59467`:

| Step | Checkpoint |
|---|---|
| Initial implementation | `6f312591b495e53ff888384f0d733116209c6959` |
| Astra remediation R1 | `f2abdf832a894cc8751212284c2e1e11da1eee11` |
| Astra remediation R2 / **final reviewed implementation** | `668dc3dff4930d42e79e2fcc52b0877812f2abee` |

Final evidence at `668dc3dff4930d42e79e2fcc52b0877812f2abee`:

- Luna final targeted verification: **PASS**;
- Astra final targeted closure: **PASS**;
- ASTRA-10H-001 through ASTRA-10H-009: **CLOSED**;
- full unit/integration suite: **4346/4346 across 188 files**;
- typecheck: **PASS**;
- production build: **PASS**;
- final targeted diff check: **PASS**;
- final reviewed worktree: clean.

Firebase Rules emulator evidence: **228/228, zero skipped**, recorded at the last Rules-affecting checkpoint. `src/firebase/rules.json` itself changed only in the initial implementation `6f31259`. R2 (`f2abdf8` → `668dc3d`) changed no Firebase/Rules production source and no emulator spec file; its only Firebase-directory change is the normal-suite test `src/firebase/phase10hTerminal.test.ts`. The emulator suite was therefore not rerun for R2.

Remaining software closure blockers: **none**.

---

## 18. Hardware acceptance waivers

| Criterion | Status |
|---|---|
| **AC-064** — real-iPhone Safari touch validation | **WAIVED FOR PHASE CLOSURE** |
| **AC-066** — notched-device safe-area validation | **WAIVED FOR PHASE CLOSURE** |

These criteria are **WAIVED, not passed.**

- Real physical-device access to the exact reviewed build was unavailable at closure time, so no real-device evidence exists for either criterion.
- Extensive rendered phone and tablet browser evidence passed through Luna and Astra. That browser evidence does not substitute for, and is not recorded as, a physical-device PASS.
- If a genuine physical-device defect is later observed (iPhone Safari touch or notched-device safe-area), it is valid follow-up work: a normal defect/hotfix. It is never grounds to rewrite this record or to record either criterion as passed retroactively.

---

## 19. Production release order — Rules first

Phase 10H changes `src/firebase/rules.json`. The web client ships from `main` automatically, but Rules change only through `npm run rules:deploy`. A v26 client running against pre-10H production Rules would be denied the new `revealAcks` and `results` paths. Therefore:

1. **Deploy the RTDB Rules** from the Phase 10H closure checkpoint: `npx firebase use <PROJECT_ID>`, then `npm run rules:deploy` (Realtime Database Rules only).
2. **Verify the deployed Rules equal the repository Rules:** `npm run rules:verify -- --project <PROJECT_ID>` (add `--instance <DB_INSTANCE>` for a non-default instance). It must exit 0, with the deployed Rules identical to `src/firebase/rules.json` (SHA-256 `2ec0aa37…`, §15).
3. **Only then integrate the client/`main`** to the Phase 10H closure checkpoint, and verify the integration.

Stop point: do not move `main` until steps 1 and 2 have both succeeded. **No Rules deployment, client deployment or `main` integration has occurred as of this record.**

---

## 20. Next

1. This documentation closure checkpoint on `dev/phase-10h-ui`.
2. Production RTDB Rules deploy and verification (§19 steps 1–2).
3. Integrate the final Phase 10H checkpoint into `main` (§19 step 3).
4. Record Phase 10H as CLOSED AND INTEGRATED only after the integration verification.
5. Phase 11 (canonical character coverage) remains the next implementation phase. It must not begin until the Phase 10H integration completes.
