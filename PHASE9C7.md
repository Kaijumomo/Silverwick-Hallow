# Phase 9C.7 — Setup random-deal enforcement

First package after formal Phase 9C closure. Narrow domain-model correction,
not a Setup UX redesign. No Phase 10 work.

1. **Starting state.** Verified before editing: `origin/dev/phase-9c` at
   `d2ffc6d426a0d802e1df8eb3f417a3aaff1d9fc3`, clean working tree.

2. **Contradiction found.** The Setup UI already presented one randomized
   deal as the only initial action (no manual/random selector, `dealRolePool()`
   already shuffles). But the underlying readiness model still let a fresh
   Day-0 game reach Night 1 from manual assignment alone: `setupReadiness`'s
   `"manual"` action only checked that the pool was empty and every ordinary
   player had a role — never that a deal had actually produced them. Clearing
   an undealt pool after assigning roles by hand ("clear the pool to use
   manual assignments") was a supported path to Night 1.

3. **Invariant enforced.** For a fresh Day-0 game, ordinary characters are
   always initially distributed through the randomized deal
   (`dealRolePool()`), never by hand. Manual role changes remain fully
   supported, but only as corrections *after* that deal — Storyteller
   corrections, setup-character placement (Gardener, Marionette, ...), and
   later game effects.

4. **Implementation.** `setupContext.ts` gained `isPostDeal(game)` (moved
   from presentation, since readiness now needs it too): true when the role
   pool is empty and either `setupRolesDealt` was recorded or `day > 0`. A
   new blocker in `setupReadiness.ts`, `not-dealt`, fails the begin action
   whenever `isPostDeal` is false — this is the single check that closes the
   escape hatch, using only existing persisted evidence. No second
   deal-history mechanism was added. The internal action name `"manual"` —
   which no longer describes any supported workflow — was renamed to
   `"begin"` across `setupContext`, `setupAnalyzer`, `setupReadiness`,
   `setupPresentation`, and the store's `beginNightOne()`/`undo()` callers.
   Findings that implied a manual initial path (`"Deal the pool, or clear it
   to begin with manually assigned roles."`, `"...clear the pool to use
   manual assignments."`) were reworded; assigned-role composition analysis
   itself (Gardener/Marionette/duplicate/jinx checks) is unchanged.

5. **Final Setup lifecycle.** Choose player count → seat ordinary players →
   select the role pool → **Deal roles** (randomized; `setupRolesDealt` is
   recorded) → Storyteller may correct individual roles → configure
   concealed/shown identities → **Begin Night 1**. Phase 9C.4's all-or-none
   ordinary perception barrier is untouched: a deal may still leave a
   concealed role (Drunk, Marionette, Lunatic) unrevealed, and beginning
   Night 1 stays blocked until it's configured.

6. **Legacy compatibility.** A running/legacy game that predates
   `setupRolesDealt` and returns to Setup is not treated as if it never
   dealt: `day > 0` alone is trusted evidence that setup already completed
   once, without fabricating a deal record. No migration invents history.

7. **Traveler lifecycle.** Unchanged: excluded from the ordinary bag/deal,
   own assignment path, late arrivals still default to Travelers.

8. **Tests.** `setupCommands.test.ts`, `setupAnalyzer.test.ts` (plus
   `storytellerStore.test.ts`, `NightOrderPanel.test.tsx`, and
   `reconnectIntegration.test.ts` fixtures that had relied on the old manual
   path) were updated to prove: manual-only assignment cannot start Night 1
   through `beginNightOne()`, `advancePhase()`, `setPhase("night")`, or
   `setPhase("day")`; a real deal allows all four; a post-deal manual
   correction remains valid; the concealed-perception gate remains intact;
   clearing the pool never fabricates a deal; a legacy running game remains
   usable; the Fisher–Yates shuffle proof is preserved.

9. **Verification.**

   | Gate | Result |
   | --- | --- |
   | `npm run typecheck` | Passed |
   | `npm test` | 927 passed, 0 failed, 0 skipped (53 files) |
   | `npm run test:rules` | 116 emulator tests passed, 0 skipped |
   | `npm run build` | Passed |
   | `git diff --check` | Clean |

10. **Boundaries.** No Firebase rules, `SessionWriter`, reconnect
    architecture, persistence version, public/self projections, membership,
    Public Display, Privacy Mode, Traveler lifecycle, night-order engine,
    canonical role data, nomination/voting, or Phase 10 changes. No broader
    Setup UX redesign.

11. **Verdict.** PASS — RANDOMIZED INITIAL DEAL ENFORCEMENT COMPLETE.
