# Phase 10F — Guided Ability Resolution / Night Actions

**Status:** SOL CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED\
**Decision date:** 2026-10-02\
**Starting branch:** `dev/phase-10f`\
**Starting checkpoint:** `2252c5e76284fcd12d0e4d5debdfc34f66f86a17`\
**Starting schema/store:** v23\
**Target schema/store:** v24

## 1. Purpose

Phase 10F teaches Silverwick to guide the Storyteller through character abilities rather than merely displaying reference text.

The product rule is:

> Automate only mechanics that have one encoded, mechanically correct answer from authoritative state. Capture player/Storyteller choices explicitly. When BOTC grants discretion, ambiguity exists, an interaction is unsupported, or authoritative state is insufficient, Silverwick asks the Storyteller instead of guessing.

Phase 10F is both a rules-architecture phase and a Storyteller interaction phase. The Night Order becomes an operating workflow, not only a reference/checklist.

## 2. Frozen foundation

The following are authoritative and are not reopened unless implementation proves a genuine contradiction:

- 10A — Life Transition Semantics.
- 10B — Effect Lifecycle.
- 10C — Reminder Workflow.
- 10D — Role Transitions.
- 10E — Alignment Transitions.

10F composes these primitives; it does not reimplement them.

Current State remains the only mechanical authority. History remains explanatory. Information Delivery records what was communicated. Reminders remain Storyteller-private non-authoritative notation.

## 3. Core architecture

### 3.1 Ability semantics

Add a canonical Ability Semantics Registry.

A canonical ability definition is a hybrid:

- declarative descriptor for timing, invocation shape, inputs, usage, relevant hooks and presentation;
- optional small pure evaluator for character-specific logic.

Ability prose, first/other-night prompts and Reminder text are never parsed as executable mechanics.

Canonical semantics attach only when canonical ownership is proven through the existing canonical-role ownership boundary. A homebrew character, including one that reuses an official RoleId, inherits no official automation.

Unsupported/homebrew abilities enter the Manual workspace.

### 3.2 Rules Query layer

Add pure derived queries for facts ability evaluators need, including:

- actor/functioning state;
- mechanically applicable Effect interpretation;
- registration candidates;
- alive-neighbour queries;
- in-play character queries;
- Life Event Window queries with coverage;
- current Game Moment;
- modifier/hook results.

Derived applicability is never persisted merely because it was computed.

An unknown/custom interaction produces an explicit Storyteller judgment or unsupported result, never an invented rule.

### 3.3 Pure ability coordinator

Add one pure coordinator, conceptually:

`planAbilityResolution(game, request, environment)`

The coordinator:

1. validates the workflow fingerprint and participant bindings;
2. runs the pure evaluator;
3. receives an ordered outcome;
4. plans each frozen domain operation against one evolving working snapshot;
5. applies accepted plans only to that working snapshot;
6. validates the complete composed game;
7. returns a final plan, a true no-op, a structured refusal, or a request for explicit Storyteller input.

No production domain `resolve*` store command is called from inside the coordinator.

### 3.4 One authoritative commit

Add one Storyteller-owned store command, conceptually:

`resolveAbility(...)`

An accepted ability resolution performs exactly:

- one authoritative game replacement;
- one Undo push;
- one localSeq increment;
- one projection cycle.

If any sub-plan refuses, nothing is committed.

A true no-op changes no game state, Undo or localSeq. Marking a Night step done is itself a bookkeeping mutation when requested.

## 4. Operation ordering

Order is part of character semantics.

An evaluator that emits more than one mechanically meaningful operation must specify their order explicitly.

There is **no universal fallback mechanical order** such as Life → Role → Alignment → Effect.

Consecutive operations within one frozen domain may be batched where that domain's contract supports it.

Non-mechanical bookkeeping may occur after resolved mechanics:

- Reminder notation;
- Information Delivery;
- Night-step completion.

A same-participant Role or Alignment chain that the frozen seam does not support is refused as unsupported rather than silently collapsed.

## 5. Identity and stale-state safety

### 5.1 Workflow fingerprint

Opening a guided workflow captures enough render-time state to detect staleness, including as applicable:

- actor `{ playerId, participantId }`;
- actor Actual Role;
- actor Shown Role / simulated wake role;
- phase/day;
- abilityUsed;
- Night-step identity/status.

Before commit, `resolveAbility` revalidates the fingerprint.

### 5.2 Participant choices

Every current-player answer stores `{ playerId, participantId }`.

Seat reuse never transfers a choice or outcome to the replacement occupant.

### 5.3 Life binding — Sol decision H-06

Do **not** reopen the 10A Life intent contract solely to add ParticipantId.

10F validates the bound ParticipantId immediately before translating a Life operation into the existing PlayerId-addressed Life intent. Planning and final commit are synchronous within one store call; a stale binding refuses the whole resolution.

## 6. Ability use — narrow 10A amendment

`abilityUsed` is authoritative Life Current State but is not currently composable.

Add additive Life-planner intents:

- `useAbility`;
- `correctAbilityUsed`.

They must preserve the existing 10A ownership of `abilityUsed`, compose atomically with other Life intents, and remain distinct from Role-change/resurrection resets.

The existing `setAbilityUsed` becomes a compatibility adapter over the authoritative path.

No independent ability-use writer may bypass the Life boundary after this amendment.

## 7. Effects, impairment and protection

Stored active Effect state is not equivalent to mechanical applicability.

10F derives applicability through Rules Query/evaluator logic.

Freeze these architecture rules:

- Effect `state` remains lifecycle state, not cached applicability.
- The presentation registry never decides mechanics.
- `safeFromDemon`, `cannotDie` and generic `protected` remain distinct semantic types even when they share a visual family.
- Generic/manual `protected` never automatically means "cannot die"; it requires an explicit Storyteller decision unless a future approved semantic rule says otherwise.
- Unknown/custom Effects never acquire automatic rules by name.
- Applicability recursion/cycles fail safe to unknown/judgment.
- Reminders are never read to determine Effect applicability.

Exact per-character BOTC rulings are not frozen from the architecture challenge alone. Production semantics for proof characters must be backed by authoritative BOTC references before implementation.

## 8. Information Delivery — v24

10F makes Information Delivery composable.

Extract a pure `planInformationDelivery` from the current `recordInformationDelivery` behavior. The existing store command becomes an adapter over the pure plan.

v24 extends an Information Delivery so it can distinguish:

- recipient;
- recipient Actual Role at delivery;
- **performedRole** — the character ability/procedure actually performed when different from Actual Role;
- Information Action;
- values communicated;
- moment;
- provenance;
- optional `resolutionId` correlation.

This supports real deliveries for simulated abilities such as a Drunk shown as an information character without pretending the recipient actually holds that Role.

The v24 delivery shape must fail closed against malformed extra/current-version fields; migration preserves every legacy delivery exactly and does not invent `performedRole` or `resolutionId`.

Information Delivery remains non-authoritative for mechanics.

Undo may remove the stored delivery record, but UI copy must never imply that spoken information can be "unsaid."

## 9. Night-progress identity — v24

Current player Night progress is seat-addressed. 10F changes guided player-step identity to participation identity.

Conceptually:

`p:{participantId}:{wakeRole}`

Traveler-arrival coupling must likewise be participation-bound.

For v23 → v24 migration, do not guess the owner of ambiguous legacy player/Traveler step keys. Drop ambiguous participant-specific progress and preserve only progress whose identity remains provable/global. A one-night bookkeeping reset is safer than transferring completion to a replacement participant.

## 10. Night public-information boundary — v24

A guided Night ability can now mutate Life in the middle of Night. Current public projection would expose that immediately.

Freeze the v24 privacy rule:

> During Night, public/player-town projection does not expose Life State (alive/dead, ghost vote or exile result). Normal public Life projection resumes when Day begins.

Do not reconstruct a pre-Night Life State from History or Life Event Window. Current State remains authoritative; the Night projection simply withholds that public information until Day.

Storyteller view continues to show authoritative Life immediately.

## 11. Setup boundary

10F does not become a second Setup engine.

Deal, Shuffle, Swap, Replace/Manual Override, Edit Bag, Reveal, composition policy and Setup analysis remain in their existing Setup architecture.

Ability semantics may reference Setup-owned facts. New Setup facts needed by live mechanics may use an already-authoritative primitive where appropriate (for example a typed Effect), but only under an approved character contract.

No Setup fact may be represented only by a Reminder if mechanics need to read it.

## 12. Travelers, Fabled, Lorics and modifiers

Travelers use the same frozen Life/Effect/Role/Alignment primitives. No parallel Traveler mutation system is added.

Fabled, Lorics, passive abilities and jinxes participate through a hook/modifier vocabulary rather than participant wakes when they have no participant.

10F defines the hook contract and proves it with a limited set. Game-level modifier state that does not yet have an authoritative home remains 10G scope.

An unverified modifier/jinx gates only evaluations it could actually affect. It does not globally block unrelated abilities. Bootlegger-style global custom rules may require a global manual gate.

## 13. Workflow persistence and recovery

In-progress guided workflow state is UI memory only.

Reload, reconnect and remote checkpoint adoption rebuild from authoritative Current State.

A workflow whose fingerprint no longer matches becomes stale; it is never silently resumed against changed state.

Writer fencing, SessionWriter authority, Firebase rules and remote authority paths remain unchanged.

## 14. Refusal/result model

10F distinguishes:

- `needsInput` — supported ability awaiting explicit choice/judgment;
- `unsupported` — no verified semantics for this character/interaction;
- `notApplicable` — cannot act in current state/timing;
- `stale` — actor, target, role, phase/day or step changed;
- `invalid` — malformed caller request;
- `illegal` — encoded rule forbids the chosen outcome;
- `domain` — a frozen planner refused, preserving domain/code/index;
- `invalidComposition` — final composed snapshot failed authoritative schema validation;
- `no-op` — nothing to record.

No refusal partially commits.

## 15. Storyteller UX architecture

### 15.1 Night Order

Night Order becomes the primary operating dashboard.

Rows show:

- status;
- character;
- participant;
- concise state chips;
- next required action or completed result;
- skipped/not-applicable reason where relevant.

The active simple ability expands inline. Complex/judgment-heavy abilities open a dedicated workspace.

Triggered steps appear when authoritative state establishes their trigger.

### 15.2 Ability workspace

The workspace supports:

- participant selection;
- character selection;
- alignment selection;
- numeric/boolean/text answers;
- player choice;
- Storyteller choice;
- Storyteller judgment;
- ordered multi-participant resolution;
- relevant-state explanations;
- impairment/unknown-interaction warnings.

Deterministic results are filled in rather than asked.

### 15.3 Grimoire interaction

The Grimoire may act as a target picker while a guided ability is active, with a non-Grimoire picker as fallback.

The implementation must not break drag/reposition behavior.

### 15.4 Confirmation

Do not require a heavy confirmation step for every trivial action.

Require consequence preview + explicit confirmation when a resolution includes any of:

- death/resurrection or other significant Life change;
- Role change;
- Alignment change;
- multiple participants;
- explicit Storyteller judgment;
- another materially destructive/complex outcome defined by the contract.

Simple one-participant Effect/Reminder/Information actions may resolve directly with Undo affordance.

### 15.5 Manual / rule-exception path

Do not label deterministic Silverwick rules as casually "overrideable."

When the Storyteller knows an interaction Silverwick does not model, the explicit escape hatch is **Resolve manually / unmodeled interaction**.

Manual outcomes use the same frozen authoritative primitives and one coordinator commit.

## 16. Corrections and Undo

Undo remains whole-snapshot and one accepted ability resolution is one Undo entry.

A done row may offer:

- Undo only when it is the latest reversible commit;
- otherwise a progressively disclosed Correct action built from Current State through existing correction primitives.

Corrections never reconstruct truth from History.

10F guarantees correction UX for the proof-set behaviors it implements. Broader canonical correction coverage expands with semantic coverage.

## 17. Phase 10F proof set

10F proves the architecture with a deliberately diverse set, subject to authoritative BOTC rules verification before production semantics are written:

1. Poisoner — timed impairment Effect.
2. Monk — constrained target + Demon-specific protection.
3. Imp — kill/protection + conditional Role transfer.
4. Fortune Teller — two targets, registration/judgment, Information Delivery, impairment.
5. Drunk shown as Empath — simulated wake/delivery with no Actual Role mechanics.
6. Ravenkeeper — Life Event Window trigger/coverage.
7. Slayer — Day invocation + once-per-game ability use.
8. Cult Leader — Alignment/perception composition.
9. Pit-Hag — Role change + conditional Storyteller judgment.
10. Al-Hadikhia — ordered multi-participant Life outcomes.
11. Tinker — pure Storyteller discretion.
12. Harlot — Traveler timing/consent/multi-domain shape.
13. Toymaker — Fabled modifier-hook proof with unresolved history left to judgment.
14. Baron — negative proof that Setup composition remains Setup-owned.

Vortox is not required for 10F closure. The hook system must still have a rules-neutral test proving that an information modifier can constrain another evaluator.

## 18. Full canonical coverage roadmap

Full official semantic coverage is **not** 10F scope.

Recommended roadmap:

- **10F** — coordinator, semantics contract, Rules Query/hook vocabulary, interactive Night Order/workspace, v24 composition infrastructure and proof set.
- **10G** — remaining authoritative homes for advanced/global bookkeeping, Setup-fact integration, derived-state visual integration, final Phase 10 closure.
- **Phase 11 — Canonical Ability Knowledge & Coverage** in waves:
  - 11A Trouble Brewing
  - 11B Bad Moon Rising
  - 11C Sects & Violets
  - 11D Experimental
  - 11E Travelers
  - 11F Fabled + Lorics + jinxes

Generate a manifest from the pinned canonical data.

"Complete coverage" means **zero unclassified canonical entries/jinxes**. Every entry must be structurally understood: timing/invocation, relevant interaction scope, supported deterministic mechanics, Storyteller decisions, and an accepted reason for anything intentionally left manual/reference. It does not mean every decision is automated.

## 19. Candidate acceptance criteria — frozen for implementation

### Composition

**10F-AC-01 — Atomic cross-domain**\
One ability spanning multiple domains commits all accepted consequences together or none.

**10F-AC-02 — One boundary**\
An accepted resolution creates exactly one Undo entry, one localSeq step and one projection cycle.

**10F-AC-03 — Evolving working snapshot**\
Every sub-plan observes the snapshot produced by all preceding accepted operations.

**10F-AC-04 — Explicit mechanical order**\
Every multi-domain mechanical resolution defines its operation order. There is no silent global mechanical fallback order.

**10F-AC-05 — Final validation**\
The composed game must pass the authoritative persisted-game schema before commit.

**10F-AC-06 — True no-op**\
A resolution that changes neither authoritative state nor requested progress commits nothing.

### Identity

**10F-AC-07 — Participant-bound targets**\
Seat reuse cannot redirect a stale choice or Life operation to a replacement participant.

**10F-AC-08 — Stale actor/workflow**\
Actor ParticipantId, relevant Role/perception, phase/day, usage and step identity/status are revalidated before commit.

**10F-AC-09 — Participant-scoped Night progress**\
A new participant never inherits another participant's completion marker.

### Rules versus judgment

**10F-AC-10 — Deterministic answer**\
An encoded one-answer mechanic is computed rather than re-asked.

**10F-AC-11 — Manual/unmodeled interaction**\
A Storyteller can explicitly switch to manual resolution when Silverwick lacks a modeled interaction; the bypass is visible and not silently treated as the computed rule.

**10F-AC-12 — Impairment**\
A modeled impaired ability does not create functioning Current State outcomes; information remains an explicit Storyteller communication choice where rules require it.

**10F-AC-13 — Derived applicability**\
Stored Effects are not rewritten merely because an evaluator derives that they do or do not currently apply.

**10F-AC-14 — Protection specificity**\
Distinct protection types keep distinct mechanics; generic Protected never implies Cannot Die.

**10F-AC-15 — Ability use**\
A once-per-game use marker commits atomically with the ability outcome through the Life boundary.

**10F-AC-16 — Ordered Life**\
A multi-event same-participant Life resolution preserves intent order through one Life transaction.

### Information and notation

**10F-AC-17 — Composable Information Delivery**\
A delivery may be planned into the same final snapshot as other domains; the legacy store command remains an adapter.

**10F-AC-18 — Simulated delivery**\
v24 can record Actual Role plus performedRole for a simulated ability with no invented Current State mechanics.

**10F-AC-19 — Delivery Undo semantics**\
Undo removes the stored delivery record but UI never claims spoken information was erased.

**10F-AC-20 — Reminders write-only**\
Ability modules may write Reminders through the 10C seam and are architecture-guarded from reading Reminder text/presence as mechanical authority.

### Boundaries

**10F-AC-21 — Setup separation**\
Setup composition remains Setup-owned.

**10F-AC-22 — Travelers**\
Traveler outcomes use frozen primitives; arrival behavior remains separate and participant-bound.

**10F-AC-23 — Modifier gating**\
Unknown modifiers/jinxes gate only mechanics they could affect; no unsupported interaction is silently automated.

**10F-AC-24 — Homebrew safety**\
Homebrew, including official-id reuse, never inherits canonical automation.

**10F-AC-25 — Structured refusals**\
The result taxonomy is distinct, safe, non-throwing and atomic.

### Recovery/privacy

**10F-AC-26 — Ephemeral workflow**\
Reload/reconnect/checkpoint adoption persists committed state only and invalidates stale drafts.

**10F-AC-27 — Authority unchanged**\
No change to writer fencing, SessionWriter authority or Firebase remote paths.

**10F-AC-28 — Privacy**\
The guided workspace is Storyteller-private and suppressed under Privacy Mode; projections gain only fields explicitly approved by this contract.

**10F-AC-29 — Night Life withholding**\
During Night, public/player-town views reveal no Life State; Day resumes normal public Life projection from Current State.

### UX

**10F-AC-30 — Interactive Night Order**\
Night rows expose status, next need/result, triggered/skipped states and guided entry.

**10F-AC-31 — Simple flow**\
A simple target-and-Effect ability can be completed in at most target + Resolve after opening.

**10F-AC-32 — Complex preview**\
Significant/multi-participant/judgment resolutions preview the combined consequences before confirmation.

### Extensibility/schema

**10F-AC-33 — Extensible semantics**\
Adding a supported canonical character requires a semantics module/tests, not coordinator or frozen-domain redesign.

**10F-AC-34 — Coverage manifest**\
A generated canonical manifest tracks the proof set now and full Phase 11 coverage later.

**10F-AC-35 — v24 migration**\
v23 migrates deterministically to v24 for the approved Information Delivery / Night-progress / projection contract, including Current State, Undo entries and remote checkpoint recovery.

## 20. Implementation sequence

Implement in small reviewable slices:

1. v24 schema/migration + pure Information Delivery plan + participant-scoped Night-progress primitives + Night public-Life boundary.
2. additive Life ability-use intents.
3. rules-neutral ability semantic types, Rules Query/hook interfaces and pure coordinator.
4. one-store-commit `resolveAbility` + Manual outcome path.
5. interactive Night Order/workspace foundation and Privacy Mode behavior.
6. authoritative rules matrix for proof characters.
7. proof-character semantic modules and scenario tests.
8. coverage manifest and architecture guards.
9. full review gate.

Do not code character semantics from unverified general rules knowledge.

## 21. Required gate

Before Luna handoff:

- typecheck;
- full normal test suite;
- Firebase emulator suite where contract-relevant;
- production build;
- `git diff --check`;
- architecture-guard tests;
- migration/recovery tests for v23 → v24;
- one-commit/Undo/localSeq tests;
- stale ParticipantId tests;
- privacy/projection tests;
- representative guided-workflow tests;
- clean review checkpoint.

Phase 10F does not close until Luna/Astra/Sol closure and integration complete.


## 22. Luna rules-neutral verification adjudication — 2026-10-02

Luna independently verified exact checkpoint `b1d6bd7f071c8f5195c5f440abcaa43441446aaf` in an isolated clean worktree and returned **REVISE**. The full required gate passed (typecheck; 3,474 normal tests across 134 files; 201/201 Firebase emulator tests; production build; both diff checks), and the v24 migration, Information Delivery extraction, Life/`abilityUsed` ownership, Night Life withholding, Rules Query purity and one-commit coordinator were mechanically supported.

Sol accepts seven findings for targeted remediation before the proof-character rules matrix is frozen.

### SOL-10F-L1 — Jinx activation uses authoritative represented characters, not script membership — HIGH

The current rules-neutral jinx gate activates a canonical jinx when both ids merely appear on the script. This is too broad and conflicts with the low-friction modifier rule.

Freeze:

- a canonical jinx is considered potentially active only when both jinx endpoints are **currently represented in authoritative game state**;
- representation means at least one current participant whose `actualRole` is that endpoint and whose resolved definition passes the existing canonical ownership boundary;
- dead participants still represent their current character;
- a Role change immediately changes which jinx endpoints are represented;
- an unassigned/script-only character does not activate a jinx;
- a homebrew/custom definition reusing an official id never activates the canonical jinx;
- once active, an unverified jinx still gates only the affected character evaluation and remains Storyteller judgment/manual until its semantics are verified.

Fabled/Loric activation continues to come from authoritative `game.fabled` / `game.lorics`.

### SOL-10F-L2 — Guided workspace renders the declared typed input contract — HIGH

The workspace must support every `AbilityInputRequirement` shape already declared by the semantics contract rather than coercing several kinds to text or one participant.

Freeze:

- `participant`: render exactly the declared `count` (default 1), capture `ParticipantBinding` for each, enforce `distinct` / `notSelf` / alive/dead constraints consistently with coordinator validation;
- `character`: emit `{ kind: "character", roleIds }`, using a character picker appropriate to the active script/registry;
- `alignment`: emit the typed Alignment value;
- `number`, `boolean`, `text`: preserve their typed values;
- Storyteller-judgment requirements use the **requirement's own kind and cardinality**, not an unconditional boolean checkbox;
- player choice, Storyteller choice and Storyteller judgment remain visually distinct;
- no UI coercion may create a payload different from the declared semantics type.

### SOL-10F-L3 — Day ability entry point — HIGH

Phase 10F includes Day-timed / Storyteller-invoked ability shapes and the proof set includes Slayer. The guided engine cannot be Night-only.

Add a Storyteller-private Day ability entry point using the **same AbilityWorkspace / coordinator**, not a second resolver. Preferred product boundary:

- Player Drawer exposes a progressively disclosed **Abilities / Use ability…** action during live play;
- during Day it can launch verified Day semantics for that participant;
- unsupported/unmodeled behavior may launch the same Manual workspace explicitly;
- fingerprinting, ParticipantId safety, confirmation policy, Privacy Mode and one-commit behavior are identical to Night;
- do not duplicate character mechanics or build a separate Day rules engine.

Night Order remains the primary Night dashboard.

### SOL-10F-L4 — malformed fingerprint is `invalid`, changed valid fingerprint is `stale` — MEDIUM

Validate the fingerprint's runtime structure before stale comparison.

- malformed/missing required fingerprint content → `invalid`;
- a structurally valid fingerprint whose participant/Role/perception/phase/day/ability-use/step no longer matches → `stale`.

Do not classify malformed caller input as stale state.

### SOL-10F-L5 — information constraints cannot silently skip Player-valued information — MEDIUM

A verified information constraint must never silently bypass a matching Player-valued delivery.

Implement one of these fail-safe shapes:

1. preferred: define a typed normalized information-constraint value union and compare Player-valued candidates by durable/current `ParticipantId` bindings (including cardinality/order as explicitly represented by the constraint); or
2. if no current verified hook needs this shape, explicitly return `unsupported` / judgment for a Player-valued constraint until a typed comparator exists.

The existing silent `continue` is forbidden.

### SOL-10F-L6 — prose-derived `oncePerGame` is not mechanical authority — MEDIUM

The legacy canonical adapter currently derives `RoleDef.oncePerGame` from ability prose and Night Order uses it to suppress a row. That violates the 10F rule that ability prose is not executable mechanics.

Freeze:

- 10F usage behavior comes from `AbilityDescriptor.usage` only;
- generic Night Order must not suppress/authorize an ability because prose-derived `roleDef.oncePerGame` is true;
- the legacy field may remain as backward-compatible/reference metadata if other non-mechanical consumers require it, but no 10F mechanical decision may read it;
- unsupported/unverified characters remain visible/manual rather than silently omitted because of prose parsing.

Audit all production reads of `oncePerGame`.

### SOL-10F-L7 — strengthen Role/Alignment writer guards — MEDIUM

Luna's mutation proof showed the older Role writer detector misses an ordinary semicolon-terminated object-literal write.

Strengthen the guard so equivalent direct writes are caught regardless of ordinary `}` / `};` formatting, and add planted self-checks that would fail for:

- `const next = { ...p, actualRole: "x" };`
- direct property assignment;
- bracket assignment;
- delete;
- the analogous `actualAlignment` forms.

Keep the reviewed false-positive allowlists narrow. No current production bypass was found.

### Accepted Luna watchpoints

- `setAbilityUsed` live-only compatibility: **accepted**; no Setup production dependency exists.
- Grimoire picking only outside the modal workspace: **accepted** for 10F because the complex workspace has an accessible picker fallback.
- Fabled/Loric structural scope table: **accepted as safety-gating metadata only**; it is not semantic authority and must not produce deterministic BOTC outcomes.
- v24 migration / Night Life withholding / Information Delivery / one-commit coordinator: no Sol remediation from this Luna pass.

### Remediation gate

Before a Luna re-verification checkpoint:

- remediate SOL-10F-L1…L7;
- add targeted regressions and mutation/self-checks for each;
- run typecheck;
- full normal suite;
- Firebase emulator suite;
- production build;
- `git diff --check` and baseline-range `git diff --check`;
- keep `CANONICAL_ABILITY_SEMANTICS` production-empty;
- do not implement proof-character rules yet.

Only after Luna re-verifies this rules-neutral foundation may Sol freeze the authoritative proof-character rules matrix.


## 23. Luna targeted re-verification adjudication — 2026-10-02

Luna re-verified exact remediation target `180b20e173b5dcccc3a6a1853d37987c6589c4de` and returned **REVISE** on one remaining issue. SOL-10F-L1, L2, L4, L5, L6 and L7 passed; the full gate also passed (typecheck; 3,498/3,498 normal tests across 137 files; 201/201 Firebase emulator tests; production build; both diff checks).

### SOL-10F-L3-R1 — Invocation eligibility must be enforced — HIGH

The Day entry exists and correctly uses the shared AbilityWorkspace / coordinator, but the current generic eligibility logic treats `triggered` and `passive` timing as actionable in either live phase without consulting `AbilityDescriptor.invocation`.

Freeze this correction:

- **Generic Day entry** is guided only when the verified descriptor explicitly has `timing: "day"` **and** an actionable Day invocation of `"publicClaim"` or `"procedure"`.
- **Generic Night Order guided entry** remains for explicit first/other-Night timing and an actionable Night invocation of `"wake"` or `"procedure"`.
- `timing: "triggered"` does **not** by itself make a descriptor actionable from the Day drawer or ordinary Night cadence.
- `timing: "passive"` is never a user-invoked guided action merely because the game is in a live phase.
- `invocation: "none"` is never directly actionable.
- Triggered/passive abilities remain Manual/reference-only until a verified semantic module and an explicit supported invocation/trigger path authorize them. Do not guess a trigger from timing alone.
- The **coordinator must enforce the same invocation eligibility as the UI**. UI hiding is not authority; a crafted Guided request that uses an unsupported timing/invocation combination must refuse safely.
- This remediation does not define Ravenkeeper/Tinker/etc. rules. Their future proof-character contracts may add the explicit trigger/Storyteller-invocation path they require after authoritative BOTC rules verification.

Preferred implementation: centralize the rules-neutral timing+invocation eligibility in one pure helper shared by UI and coordinator, rather than duplicating a Day-only check.

Required regressions:

1. `timing:["passive"], invocation:"none"` is not offered by Day entry and a crafted Guided request is refused.
2. `timing:["triggered"], invocation:"procedure"` is not automatically offered merely because phase is Day/Night; it remains unavailable until an explicit trigger path exists.
3. `timing:["day"], invocation:"publicClaim"` is eligible in Day.
4. `timing:["day"], invocation:"procedure"` is eligible in Day.
5. `timing:["day"], invocation:"wake"` is not eligible in Day.
6. `timing:["otherNight"], invocation:"wake"` is eligible on later Night.
7. `timing:["otherNight"], invocation:"publicClaim"` is not eligible through ordinary Night Order.
8. UI and coordinator use the same eligibility rule.

No other Luna finding is reopened by this adjudication.

### Gate after remediation

Keep production `CANONICAL_ABILITY_SEMANTICS` empty. Run targeted invocation tests plus typecheck, full normal suite, Firebase emulator suite, production build, and both diff checks. Return one exact clean checkpoint for a narrow Luna closure re-check of SOL-10F-L3-R1.


## 24. Luna rules-neutral foundation closure — 2026-10-02

Luna independently re-verified exact target `aeda04351895175eb78a147fe9c133519fd4f3ba` and returned:

**PASS — SOL-10F-L3-R1 CLOSED; RULES-NEUTRAL FOUNDATION READY FOR SOL CHARACTER-RULE FREEZE**

This is not Phase 10F closure. It closes only the rules-neutral foundation review gate before proof-character semantics.

Verified at this target:

- repository identity: `dev/phase-10f`, baseline relationship 0 / 33;
- shared invocation contract: one pure rules-neutral timing + invocation authority used by Day UI, Night UI and coordinator;
- Day guided eligibility: explicit `day` timing + `publicClaim` / `procedure`;
- Night guided eligibility: explicit first/other-Night timing + `wake` / `procedure`;
- triggered/passive timing does not invent a generic invocation path;
- crafted Guided requests cannot bypass invocation eligibility;
- Player Drawer remains Manual-only for Night guided work; Night Order owns ordinary guided Night execution;
- `nightOrder` request need not carry `fingerprint.step` unless `completeStep` is requested;
- late Traveler arrival first-night exceptions remain deferred to verified Traveler semantics;
- SOL-10F-L1, L2, L4, L5, L6, L7 regression smoke remained green;
- production `CANONICAL_ABILITY_SEMANTICS` remains empty.

Final verification gate at `aeda04351895175eb78a147fe9c133519fd4f3ba`:

- typecheck PASS;
- invocation suite: 64/64;
- targeted regression smoke: 295/295 across 12 files;
- full normal suite: 3,563/3,563 across 138 files;
- Firebase emulator suite: 201/201, 0 skipped;
- production build PASS;
- worktree and baseline-range `git diff --check` PASS;
- final review worktree clean.

### Next authorized work

Sol may now research and freeze the authoritative proof-character rules matrix (contract Slice 6).

Do not populate production `CANONICAL_ABILITY_SEMANTICS` until that matrix is frozen from authoritative BOTC sources.

Phase 10F remains open.


## 25. Authoritative proof-character rules freeze — 2026-10-02

The Phase 10F proof-character rules matrix is frozen in:

`docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md`

Source policy:

- publisher Blood on the Clocktower Wiki character How-to-Run pages;
- publisher Abilities / States / Glossary rules pages;
- pinned Silverwick canonical data revision `f10cd02e3401af227ce406287eaae7bb99a06a42`;
- explicit Sol mapping decisions where a correct BOTC rule needs a Silverwick state/UX representation.

The matrix covers the 14 proof cases plus the minimum Empath / Scarlet Woman dependencies required to prove Drunk→Empath and Imp star-pass behavior.

Production character semantics may now be implemented **only** to the boundaries frozen in that matrix.

Important partial/manual boundaries:

- Cult Leader Day cult vote remains outside the nominations/voting scope.
- Pit-Hag Demon creation remains Manual in 10F because arbitrary deaths tonight need 10G game-level state.
- Tinker remains verified Manual because Storyteller discretion is the mechanic.
- Toymaker attack-skip history remains a 10G authoritative-state dependency.
- Baron remains Setup-owned with no live evaluator.
- Ravenkeeper is authorized to add an explicit verified Night-trigger invocation path; this does not make all `triggered` descriptors generically actionable.
- Fortune Teller Red Herring is approved as Storyteller-private authoritative Effect state (`fortuneTellerRedHerring`), not a Reminder.
- Empath is authorized as a support semantic so simulated Drunk→Empath Information Delivery can be represented truthfully.
- the narrow Scarlet Woman Imp-star-pass priority is authorized as an Imp dependency without expanding to full Scarlet Woman coverage.

This completes contract Slice 6 (rules freeze). Slice 7 — proof-character semantic implementation — is now authorized.

## 26. Slice 7 — proof-character semantic implementation (implementation checkpoint) — 2026-10-03

**Status: IMPLEMENTATION CHECKPOINT — READY FOR LUNA. Phase 10F is NOT closed; nothing merged or deployed.**

Implemented strictly to `docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md`, in the frozen order. Code checkpoint: `aa14fee0811e9f0b19ba3a4fd714cb5cca0488bc` (a docs-only commit sits on top). Schema / store version unchanged (v24); no Firebase Rules change.

### Production semantics

`CANONICAL_ABILITY_SEMANTICS` is assembled from per-character modules in `src/abilities/characters/` (each traced to its matrix section) and is still consulted only through the canonical ownership gate: Poisoner, Monk, Empath (support), Fortune Teller, Slayer, Cult Leader (nightly portion), Harlot, Al-Hadikhia, Imp (with the narrow Scarlet Woman priority), Ravenkeeper, Pit-Hag (non-Demon branch). Verified-Manual (never invokable, reference text only): Tinker, Toymaker, Drunk. Setup-owned: Baron.

### Generic seams added (all pure, ParticipantId-safe, independently tested)

- `AbilityEvaluation` `stale` result for follow-up participant answers an evaluator itself asked for.
- Workspace renders every evaluator follow-up by origin (Player / Storyteller choices answer `inputs`, judgments answer `judgments`).
- `RulesQuery.roleOf` (active registry definition), `RulesQuery.factHolders` (approved `storytellerFact` Effects only), `RulesQuery.assumingAlive` (hypothetical evolving Life state within one resolution).
- Effect semantics `storytellerFact` (no source dependence) for the approved `fortuneTellerRedHerring` Effect; Effect presentation entry "Red Herring".
- A `whileSourceFunctions` Effect stops applying when its source no longer holds the source character (matrix §1/§4; derived, never rewritten).
- `REGISTRATION_ALTERING` drops the blanket `fortuneteller` observer entry (superseded by the authoritative Red Herring fact).
- `AbilityInputRequirement.allowNone` ("nobody, or exactly `count`") + "Nobody" UI control.
- Coordinator Role-chain check counts only Actual Role intents (the Role seam itself admits perception alongside one Actual Role change).
- Coordinator guard: a Night Order / Night-trigger guided request is refused when that participation instance's own step for the ability is already done or skipped tonight (star-pass suppression; no duplicate trigger; no `abilityUsed` faking).
- Explicit verified Night trigger: `AbilityDescriptor.nightTrigger` (`"actorDiedTonight"`), invocation path `nightTrigger` (eligible only for a declared trigger), `nightTriggerStatus` from the Life Event Window with honest coverage (unknown → judgment). Night Order "Triggered now" strip.
- Seam-owned builder `roleResolution.toldRoleChangeIntents` (a Role change the player is told about).
- Verified-Manual classification resolved through the ownership gate (`verifiedManual`); coverage status `verifiedManual` replaces the retired `proofPendingEvidence`.
- Verified Toymaker modifier hook (judgment only for a canonical Demon's death-touching evaluation).

### Owner decision recorded

The pinned canonical data had no Harlot Information Action. Per the contract, implementation stopped and asked; the project owner explicitly authorized a Silverwick-authored `harlot-other-night` Information Action (one Role value: the character shown), added to `src/data/informationActions.ts`.

### Gate at `aa14fee`

typecheck PASS; proof suites 182/182 (15 files); 10F foundation / guard suites 355/355 (16 files); full normal suite 3,745/3,745 across 153 files (0 skipped); Firebase emulator 201/201 (0 skipped); production build PASS; worktree `git diff --check` PASS. The baseline-range `git diff --check` failed at the required starting HEAD `e656642` on four pre-existing trailing-double-space hard breaks in this matrix's header; the docs commit converts them to `\` hard breaks (identical rendering, no content change), after which the range check passes.
