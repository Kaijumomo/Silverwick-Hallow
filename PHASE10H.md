# Phase 10H — Storyteller UI/UX & Visual Design System

**Status:** PLANNING / DESIGN CONTRACT PREPARATION  
**Decision date:** 2026-10-04  
**Branch:** `dev/phase-10h-ui`  
**Starting checkpoint:** `e0ba539ae448eb494ca5739564a39c49d2e59467`  
**Starting schema/store:** v25  
**Firebase Rules:** unchanged / no change authorized by phase creation  
**Production UI implementation started:** No

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

This sequence is planning guidance until Sol freezes the contract.

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

## 13. Immediate next action

1. Verify `dev/phase-10h-ui` starts from exact post-10G `main` checkpoint `e0ba539ae448eb494ca5739564a39c49d2e59467`.
2. Install/verify the approved project-scoped frontend design tooling without changing production behavior.
3. Audit the current Storyteller UI/component system.
4. Produce the representative Storyteller-screen visual north star and responsive variants.
5. Have Sol freeze the final 10H scope and acceptance criteria.
6. Only then begin broad production UI implementation.

**Phase 10H is not yet implementation-complete or review-ready.**
