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

Implemented strictly to `docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md`, in the frozen order. Code checkpoint: `d9b927ae172f5327910e8a31d375096118cf7850` (the owner-specified final Harlot Information Action shape on top of `aa14fee`; a docs-only commit sits on top). Schema / store version unchanged (v24); no Firebase Rules change.

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

The pinned canonical data had no Harlot Information Action. Per the contract, implementation stopped and asked; the project owner explicitly authorized a Silverwick-authored `harlot-other-night` Information Action -- structured metadata for the frozen Harlot rule, not a new mechanic -- in `src/data/informationActions.ts` (never the pinned `src/data/canonical/roles.json`): timing `otherNight`; requirements `chosenPlayer` (player, exactly 1: the consenting player the Harlot chose) and `role` (role, exactly 1: the character shown). It is subject to the canonical ownership boundary (`roleRegistry.silverwickInformationActions`): a custom / homebrew definition reusing `harlot` inherits nothing.

### Gate at `aa14fee`

typecheck PASS; proof suites 182/182 (15 files); 10F foundation / guard suites 355/355 (16 files); full normal suite 3,745/3,745 across 153 files (0 skipped); Firebase emulator 201/201 (0 skipped); production build PASS; worktree `git diff --check` PASS. The baseline-range `git diff --check` failed at the required starting HEAD `e656642` on four pre-existing trailing-double-space hard breaks in this matrix's header; the docs commit converts them to `\` hard breaks (identical rendering, no content change), after which the range check passes.

Re-gate at the final code checkpoint `d9b927a` (after the owner-specified Harlot action shape): typecheck PASS; proof suites 188/188 (15 files); 10F foundation / guard suites 355/355 (16 files); full normal suite 3,751/3,751 across 153 files (0 skipped); Firebase emulator 201/201 (0 skipped); production build PASS; worktree and baseline-range `git diff --check` PASS. `src/data/canonical/roles.json` is unchanged.


## 27. Sol pre-Luna Slice 7 fidelity adjudication — 2026-10-03

The Slice 7 implementation report at `eb4822e421e4b18a72dbef91adcea0ac8e00204e` is **not yet ready for Luna**. Sol accepted the owner-authorized Harlot Information Action shape, but found two source/contract fidelity defects during spot-check.

### SOL-10F-S7-F1 — Harlot may choose themself — HIGH

The official Harlot How-to-Run says the Harlot points at **any player**. The frozen matrix requires one living participant and deliberately contains no `notSelf` constraint.

Current implementation declares the Harlot target with `constraints: ["alive", "notSelf"]`, incorrectly rejecting a legal self-choice.

Freeze:

- Harlot target is exactly one **living** participant;
- self is legal;
- consent remains the selected participant's Player choice;
- if the Harlot selected themself, the workflow must still preserve the rule shape without inventing a second participant;
- any resulting "both might die" consequence must be resolved without creating duplicate contradictory Life intents for one ParticipantId.

Add explicit self-target tests for consent No, consent Yes/no-death, and consent Yes/Storyteller-death.

### SOL-10F-S7-F2 — Red Herring fact is independent of Fortune Teller functioning — HIGH

The official Fortune Teller How-to-Run establishes the Red Herring while preparing the first Night. The Red Herring is the same player throughout the game. This authoritative Storyteller fact therefore exists independently of whether the Fortune Teller is later poisoned/drunk when their first-night wake occurs.

The frozen matrix already defines `fortuneTellerRedHerring` as Storyteller-private authoritative setup/current state with **no mechanical dependence on source functioning**, and says a missing initial fact is created during the first Fortune Teller workflow before Information Delivery.

Current implementation branches to impaired-information handling before Red Herring creation. Because the coordinator correctly forbids ordinary mechanical state from a non-functioning ability, an impaired Night-1 Fortune Teller creates no Red Herring and leaves later Nights requiring correction. That contradicts the source and matrix.

Freeze:

- an **actual canonical Fortune Teller** on Night 1 must establish exactly one Red Herring fact when missing, even if the Fortune Teller is currently drunk/poisoned;
- the Red Herring creation is Storyteller-owned authoritative setup bookkeeping, not an effect produced by a functioning Fortune Teller ability;
- a simulated Drunk shown as Fortune Teller must **not** create a Red Herring;
- after the fact is established, an impaired Fortune Teller still receives arbitrary structurally valid Yes/No information;
- later Nights reuse the same fact;
- do not weaken the general invariant that a non-functioning ability cannot create mechanical Current State.

Preferred generic seam: add an explicit descriptor-authorized independent Storyteller-fact capability and permit only those declared `storytellerFact` Effect applications through the non-functioning guard. Keep it source-independent (no sourceParticipant/sourceCharacter) and architecture-guarded. Do not special-case Fortune Teller inside the coordinator.

Required regression cases:

1. sober Night-1 Fortune Teller missing Red Herring -> choose/create fact + deliver;
2. poisoned Night-1 actual Fortune Teller missing Red Herring -> choose/create same fact + arbitrary Boolean delivery;
3. Drunk simulated as Fortune Teller -> no Red Herring creation;
4. later Night after impaired Night 1 -> same Red Herring reused;
5. Red Herring remains one participant throughout the game;
6. no Reminder truth source;
7. generic impaired abilities still cannot create ordinary Effect/Life/Role/Alignment state.

### Gate

Remediate F1 and F2 only, run targeted tests plus the full Phase 10F gate, and return one exact clean checkpoint for Luna. Do not merge, deploy or close 10F.

## 28. SOL-10F-S7-F1 / F2 remediation record — 2026-10-03

Remediated only the two §27 findings, on top of `9153b4548f33445cb39b6635f3b8b6971b5efd81`. Code checkpoint: `53ab172a723d70b2de4220d448ec8da8f79a173a` (`c5d65f8` F1, `53ab172` F2). Schema / store version unchanged (v24); no Firebase Rules change. Phase 10F is NOT closed.

- **F1 — Harlot self-target:** the target is exactly one living participant (`notSelf` removed); a self-chosen Harlot is one participant, so the Storyteller-chosen death consequence makes exactly one death attempt for that ParticipantId (protection / judgment applied to it). The owner-authorized Information Action shape (`chosenPlayer` + `role`) is unchanged.
- **F2 — independent Storyteller facts:** `AbilityDescriptor.independentFacts` declares Effect types a workflow may initialize independently of actor functioning. The coordinator's non-functioning guard admits an Effect operation only when every intent is an `apply` of a declared type classified `storytellerFact`, with no source participant and no source character; all other mechanical output of a non-functioning ability is still refused, and simulated wakes are still refused every mechanical operation. The Fortune Teller declares `fortuneTellerRedHerring`: on Night 1 the actual Fortune Teller's missing Red Herring is established first (even while drunk / poisoned), then a functioning Fortune Teller computes and an impaired one receives an arbitrary Boolean, in one commit. A simulated Drunk shown as the Fortune Teller creates none.

Gate at `53ab172`: typecheck PASS; F1/F2 suites 49/49; proof-character suites 203/203 (15 files); 10F foundation / guard suites 355/355 (16 files); full normal suite 3,766/3,766 across 153 files (0 skipped); Firebase emulator 201/201 (0 skipped); build PASS; worktree and baseline-range `git diff --check` PASS. Three planted mutations of the new exception (dropping the `storytellerFact` check, the no-source check, or the descriptor declaration) were each caught and restored.


## 29. Sol acceptance of Slice 7 pre-Luna remediation — 2026-10-03

Sol independently spot-checked the §27 remediation at exact pushed target `bd9050c97acef292173ef3437b139465f8493f2e` (code checkpoint `53ab172a723d70b2de4220d448ec8da8f79a173a`) and accepts both targeted fixes:

- **SOL-10F-S7-F1 CLOSED for Luna review:** Harlot target is one living participant with self legal; self-target death consequence produces one death attempt for that ParticipantId.
- **SOL-10F-S7-F2 CLOSED for Luna review:** Fortune Teller Red Herring initialization is descriptor-authorized, source-independent `storytellerFact` state; an actual Night-1 Fortune Teller establishes it even while impaired, simulated wakes cannot create it, and the generic non-functioning mechanical guard remains intact.

The owner-authorized Harlot Information Action remains `harlot-other-night` with `chosenPlayer` + `role`; pinned publisher data remains unchanged.

This is a **Sol handoff decision only**, not Phase 10F closure. The next gate is an independent Luna mechanical/rules-fidelity review of the complete Slice 7 implementation at exact target `bd9050c97acef292173ef3437b139465f8493f2e`.

## 30. Luna Slice 7 verification complete — 2026-10-03

Luna independently closed the final documentation recheck at exact target `abef4b6e3fb5d0b1792bf72b283a779fa6d50099` and returned:

**PASS — DOC-10F-RECHECK-001 CLOSED; PHASE 10F SLICE 7 READY FOR ASTRA**

Repository identity, documentation completeness, historical-record preservation, repair scope and diff hygiene all passed. The complete `PHASE10F.md` contract remains §§1–29 at the reviewed target; this §30 records the resulting handoff state.

The earlier substantive Luna review had already found no proof-character semantic/mechanical blocker and independently passed the full Slice 7 gate. No production code changed during the documentation repair/recheck sequence.

### Next gate

Astra performs the adversarial Slice 7 review. Astra's task is to try to falsify the safety/correctness claims that survived Luna: state-transition edge cases, identity/staleness, composition/order, recovery/Undo, privacy, schema-valid unusual states, modifier interactions, and future-primitive safety.

Astra is not asked to repeat Luna's full acceptance matrix or to invent a quota of findings. Established defects must be distinguished from unproven concerns and design questions.

Phase 10F remains open. No merge or deployment is authorized.

## 31. Sol adjudication of Astra Slice 7 adversarial review — 2026-10-03

Astra reviewed exact target `f87ab315a5ccef3819fb1e5126107b0a9ce73e56` and returned **REVISE** with eight reproduced defects. Sol accepts all eight findings. Two of Astra's additional design questions are also frozen into targeted remediation because the existing Phase 10F contract already requires non-retroactive trigger evidence and duplicate-trigger prevention.

### SOL-10F-A1 — dependent follow-up answers must not transfer — HIGH

Accepted from ASTRA-10F-S7-001.

A follow-up Player / Storyteller answer belongs to the prerequisites under which it was collected. Changing a target, ordered participant list, or earlier follow-up must not silently reuse a later answer for a different subject or branch.

Freeze:

- evaluator-requested participant-specific requirements must carry stable subject identity in their requirement identity / validation;
- Harlot consent is bound to the selected participant;
- Al-Hadikhia each live/die choice is bound to both ordered position and ParticipantId;
- changing any declared base input invalidates all dependent follow-up UI state;
- changing a follow-up invalidates later dependent follow-ups in that chain;
- coordinator/evaluator authority must ignore/refuse stale subject-bound answers even if a crafted request supplies them.

Do not treat UI clearing alone as authority.

### SOL-10F-A2 — selections capture ParticipantBinding at selection time — HIGH

Accepted from ASTRA-10F-S7-002.

Inline and Manual UI selections may never store only a reusable PlayerId and later bind it to whoever currently occupies that seat.

Freeze:

- every participant selection captures `{playerId, participantId}` at the moment of selection;
- Grimoire picker and select control must preserve the same binding;
- seat reuse after selection causes `stale`, never retargeting;
- Manual draft operations retain the selected binding and any expected Role/Alignment observation needed by the seam intent builder;
- do not silently drop a stale Manual draft.

### SOL-10F-A3 — verified and unverified modifiers compose — HIGH

Accepted from ASTRA-10F-S7-003.

An unverified reaching modifier may not suppress verified hook evaluation.

Freeze the modifier gate as a combined result containing BOTH:

- every reaching unverified modifier requiring explicit Storyteller confirmation / Manual handling; and
- every reaching verified hook result (`unsupported`, `judgment`, or information constraint).

All applicable verified hook results remain enforceable after unverified-modifier questions are answered.

### SOL-10F-A4 — prospective Role creation must gate creation-triggered jinxes — HIGH

Accepted from ASTRA-10F-S7-004.

The existing represented-character rule remains correct for ordinary CURRENT-state jinx activation, but it is insufficient for a Role-changing ability whose operation itself creates a jinx endpoint.

Freeze:

- add a generic **prospective jinx** query for a proposed canonical Role creation / change;
- derive it from the pinned canonical jinx pairs plus the proposed resulting Role representation, never broad script membership;
- if the proposed Role change would newly create a relevant unverified jinx, the automated Role change must fail safe before mutation;
- for Phase 10F, an unverified prospective creation jinx routes the WHOLE transformation to Manual / unsupported rather than allowing a generic "does not change this resolution" bypass;
- Pit-Hag → Damsel is therefore Manual in 10F; the Storyteller chooses which player becomes the Damsel;
- the same prospective gate applies to other Pit-Hag destination jinxes in the pinned matrix.

Do not globally activate jinxes merely because both characters appear on the script.

### SOL-10F-A5 — definitive source death precedes functioning uncertainty — MEDIUM

Accepted from ASTRA-10F-S7-005.

For a `whileSourceFunctions` Effect:

1. stale source Role mismatch => false;
2. known source death => false;
3. only then evaluate impairment / noAbility uncertainty.

A known-dead source cannot keep a persistent Effect alive through a Storyteller functioning judgment.

A departed/unseated source remains **unknown** in 10F; Astra's separate departure-policy concern is not merged into this fix.

### SOL-10F-A6 — Al-Hadikhia must settle each player before asking the next — MEDIUM

Accepted from ASTRA-10F-S7-006.

Preserve one final atomic commit, but evaluation must follow the running procedure:

1. ask player 1 live/die;
2. resolve all authoritative/judgment consequences of player 1 against the hypothetical evolving state;
3. only then ask player 2;
4. settle player 2;
5. only then ask player 3;
6. settle player 3;
7. apply the final all-alive rule.

An unresolved protection judgment for player N blocks collection of player N+1's choice.

The dependent-answer invalidation in A1 applies to this ordered chain.

### SOL-10F-A7 — participant-scoped Night progress must use exact identity — MEDIUM

Accepted from ASTRA-10F-S7-007.

Do not use textual prefix matching over unescaped ParticipantIds.

Freeze:

- Role/Traveler transitions remove only exact known participant-step keys belonging to that participation instance;
- derive exact keys from the participant's observed/final Actual Role and Shown Role / Traveler arrival roles as needed;
- a ParticipantId that is a textual prefix of another valid ParticipantId must never match that other participant's progress;
- preserve existing persisted v24 keys; no guessed reassignment.

### SOL-10F-A8 — runtime validate all AbilityInputValue payloads — MEDIUM

Accepted from ASTRA-10F-S7-008.

Before any evaluator consumes request `inputs` or `judgments`, structurally validate EVERY supplied AbilityInputValue, including undeclared evaluator follow-ups.

At minimum:

- boolean => actual boolean;
- number => finite number;
- text => string;
- alignment => good/evil;
- character => array of non-empty RoleIds;
- participant => array of valid ParticipantBindings.

Declared requirement cardinality/constraints remain enforced by `checkInputs`; evaluator follow-ups enforce their own exact cardinality/subject rules. A malformed scalar must return `invalid`, never be consumed by truthiness.

### SOL-10F-A9 — Ravenkeeper trigger requires Ravenkeeper at the triggering death — MEDIUM

Accepted from Astra's design question as a contract clarification.

A death that occurred before the participant became the Ravenkeeper does not retroactively satisfy "If you die at night".

The authoritative trigger evidence must therefore include the participant's Actual Role at the Life Event moment.

Freeze:

- add an optional authoritative Role snapshot to newly recorded Life Events in unreleased v24 (no schema-version bump required);
- new Life Events record the subject's Actual Role at acceptance time;
- Ravenkeeper automatic trigger requires `actualRoleAtEvent === "ravenkeeper"`;
- old/migrated Life Events without that evidence are `unknown` for this trigger and require Storyteller judgment / Manual, never a guess;
- History remains non-authoritative.

### SOL-10F-A10 — a Night trigger is consumed by exact trigger-event identity — MEDIUM

Accepted from Astra's duplicate-trigger design question.

A successful `nightTrigger` resolution may not opt out of consuming the trigger.

Freeze:

- the trigger predicate resolves to the exact authoritative LifeEvent id;
- the trigger workflow/fingerprint binds that event id;
- successful trigger resolution marks an event-specific participant Night-progress key done in the SAME atomic result;
- a repeated request for the same trigger event is refused even if a caller sets `completeStep:false`;
- distinct later qualifying death events may have distinct trigger identities and are not conflated with the earlier event;
- UI may not expose "leave trigger incomplete" for a verified trigger.

This supersedes the single participant+Role trigger-consumption assumption for Ravenkeeper while preserving ordinary Night Order step behavior.

### Astra questions not promoted to defects

- **Multiple functioning Scarlet Women:** current fail-safe Storyteller choice among multiple priority copies is accepted for unusual duplicate-character state; no 10F change.
- **Departed `whileSourceFunctions` source:** remains explicit UNKNOWN in 10F; do not infer death from departure/unseating.
- Astra's positive attack results for independent Storyteller facts, accumulated `assumingAlive`, atomic Manual fallbacks, privacy, Undo/recovery, star-pass ordinary replay suppression and trigger revalidation remain accepted evidence.

### Remediation gate

Claude Code remediates SOL-10F-A1…A10 only. Add targeted regressions reproducing Astra's counterexamples plus the A9/A10 contract cases. Then run:

- typecheck;
- targeted Astra remediation suites;
- all proof-character suites;
- Phase 10F foundation / architecture / writer guards;
- full normal suite;
- Firebase emulator suite;
- production build;
- worktree and baseline-range diff checks.

Return one exact clean checkpoint to Luna for targeted mechanical verification. Do not send directly to Astra, merge, deploy or close 10F.

## 32. SOL-10F-A1…A10 remediation record — 2026-10-03

Remediated exactly the §31 findings, on top of `a5df7674067344900a57c508ecbfde0fb261ba0c`. Code checkpoint: `9b6a25bdd134f7d60fb8366c8f781252b2f4f3a6` (`35e1f67` A3+A8, `c5bb344` A1+A2+A6, `8508244` A4, `d6b9b1d` A5+A7, `9b6a25b` A9+A10). Schema / store version unchanged (v24; `actualRoleAtEvent` is optional and additive); no Firebase Rules change. Phase 10F is NOT closed.

- **A1:** evaluator follow-ups that belong to participants carry them in their id (`subjectId`, JSON-encoded ParticipantIds): Harlot consent / shown / judged character / death consequence; Al-Hadikhia choice per position + participant; impaired Fortune Teller answer per chosen pair; Ravenkeeper shown / judged character per target. The workspace clears every follow-up on a declared-input change and every later follow-up on a follow-up change.
- **A2:** inline, Grimoire and Manual selections capture `{playerId, participantId}` (Manual also the observed record for the Role / Alignment seams) at selection; an unpicked Manual step blocks resolution; the coordinator refuses any non-current Effect / Reminder / Role / Alignment target as `stale`.
- **A3:** the modifier gate carries every reaching unverified modifier AND every reaching verified hook result; the coordinator enforces both.
- **A4:** `prospectiveJinxes` (pinned pairs + represented canonical characters after the proposed Role changes; never script membership); an unverified created jinx sends the whole guided resolution to Manual before mutation.
- **A5:** `whileSourceFunctions`: unseated -> unknown; Role mismatch -> false; known dead -> false; then functioning.
- **A6:** Al-Hadikhia settles each player's consequence (judgment included) before asking the next; final deaths 1 -> 2 -> 3; one commit.
- **A7:** exact participant step keys (`participantRoleStepEntries`) replace prefix matching in the Role seam and Setup Traveler designation.
- **A8:** `abilityInputValueError` validates every supplied input and judgment before any evaluator runs.
- **A9:** gameplay Life Events record `actualRoleAtEvent`; corrections of past moments record none (an amend of the same subject keeps the original's); the Ravenkeeper trigger requires `ravenkeeper` evidence, missing evidence -> judgment.
- **A10:** the trigger resolves to its exact LifeEvent id, bound in the fingerprint, revalidated at commit and always consumed (`nightTriggerStepKey`) in the same snapshot regardless of `completeStep`.

Gate at `9b6a25b`: typecheck PASS; A1…A10 suites 61/61 (2 files); proof-character suites 252/252 (16 files); 10F foundation / architecture / writer guards 355/355 (16 files); Life Event migration / recovery / checkpoint suites 168/168 (6 files); full normal suite 3,827/3,827 across 155 files (0 skipped); Firebase emulator 201/201 (0 skipped); build PASS; worktree and baseline-range `git diff --check` PASS. Astra's ten pure counterexamples reproduced before the fixes and refuse / ask correctly after; the A1/A2 UI regressions fail 10/12 on the pre-fix UI; eleven planted seam mutations were each caught and restored.

## 33. Sol pre-Luna acceptance of A1…A10 remediation — 2026-10-03

Sol independently spot-checked the pushed remediation at code checkpoint `9b6a25bdd134f7d60fb8366c8f781252b2f4f3a6` and accepts the implementation for targeted Luna verification.

Spot-check confirmed the intended shapes for:

- subject-bound dependent follow-up answers and UI invalidation;
- ParticipantBinding capture at selection time for inline and Manual paths;
- combined verified + unverified modifier gating;
- prospective canonical jinx gating before guided Role mutation;
- known-dead `whileSourceFunctions` source resolving false before functioning uncertainty;
- sequential Al-Hadikhia choice/judgment procedure;
- exact ParticipantId Night-progress cleanup;
- runtime validation of all supplied AbilityInputValue payloads;
- additive `actualRoleAtEvent` Life Event evidence;
- exact LifeEvent-bound Night-trigger consumption.

A documentation packaging regression in the implementation handoff temporarily replaced the full `PHASE10F.md` contract with §32 only. Sol restored §§1–31 from exact pre-remediation contract target `a5df7674067344900a57c508ecbfde0fb261ba0c`, retained §32 unchanged, and added this §33 record. No production code changed in that restoration.

This is not a closure verdict. Luna must independently verify SOL-10F-A1…A10 and the complete gate before any Astra re-review.

## 34. Luna targeted A1…A10 verification complete — 2026-10-03

Luna independently verified exact target `ce8b11df9b992023398bbdad7c0a2ee7ec0bc59c` and returned:

**PASS — SOL-10F-A1…A10 CLOSED; PHASE 10F SLICE 7 READY FOR ASTRA RE-VERIFICATION**

Independent gate evidence:

- targeted remediation + proof-character/foundation suites: **577/577** across 28 files;
- full normal suite: **3,827/3,827** across 155 files;
- Firebase emulator suite: **201/201**, 0 skipped;
- typecheck PASS;
- production build PASS;
- worktree and baseline-range diff checks PASS.

Luna independently closed all ten remediation findings, confirmed `actualRoleAtEvent` persistence and event-specific Night-trigger consumption, accepted the simulated Drunk-shown-Ravenkeeper UNKNOWN fail-safe, and confirmed `PHASE10F.md` completeness through §33.

No remaining Luna finding exists for the A1…A10 remediation.

### Next gate

Astra adversarially re-verifies the remediated Slice 7 implementation, concentrating on the original eight reproduced defects, the A9/A10 trigger clarifications, and interactions among the repaired generic seams. Phase 10F remains open; no merge or deployment is authorized.

## 35. Sol adjudication of Astra A1…A10 adversarial re-verification — 2026-10-03

Astra adversarially re-verified exact target `cf980bf1d6a240dfb49dc1c100151c546a84c03f` after Luna closed SOL-10F-A1…A10. Astra confirmed the original ten counterexamples are fixed, but established six additional mechanical defects and one stale-documentation inconsistency. Sol accepts all six mechanical findings for targeted remediation.

### SOL-10F-B1 — incomplete multi-slot participant inputs capture bindings per slot — HIGH

Accepted from Astra re-verification finding 1.

The A2 selection-time identity rule applies to EACH slot as soon as that slot is selected, not only when a multi-slot answer becomes complete.

Freeze:

- `RequirementInput` participant drafts store `ParticipantBinding | null` per slot, never PlayerId strings;
- a slot captures `{playerId, participantId}` immediately when selected by select control or Grimoire picker;
- completing another slot preserves every earlier binding unchanged;
- if an earlier selected participant leaves or the seat is reused before the whole requirement is complete, the completed value retains the stale binding and the coordinator refuses it;
- the rendered control must not silently relabel a stale captured binding as the replacement occupant; show a stale/reselect state where needed;
- distinctness is by ParticipantId.

This applies to Al-Hadikhia, Fortune Teller, and every future multi-participant requirement.

### SOL-10F-B2 — protection judgments are attempt- and dependency-scoped — MEDIUM

Accepted from Astra re-verification finding 2.

A Storyteller protection judgment answers one particular death attempt under one particular evolving resolution state. It is not reusable merely because target + cause are the same later.

Freeze:

- `deathAttempt` admits an explicit judgment-scope / attempt identity;
- Al-Hadikhia uses distinct ids for initial-choice attempts versus final all-alive attempts;
- each Al-Hadikhia attempt id also binds the ordered target/position and the resolved decision/state prefix that precedes that attempt, so changing an earlier choice or consequence cannot reuse a later judgment through a crafted request;
- UI dependency invalidation still clears later judgments, but evaluator identity remains authoritative;
- other single-attempt proof characters may keep their existing stable target/cause judgment identity.

A prior initial protection judgment must never settle the final all-alive death attempt.

### SOL-10F-B3 — ability answer maps are canonical own-property snapshots — MEDIUM

Accepted from Astra re-verification finding 3.

Validation and consumption must operate on the SAME answer set.

Freeze:

- canonicalize `request.inputs` and `request.judgments` to own enumerable properties only before validation/evaluation;
- all subsequent descriptor checks, functioning judgments, modifier confirmations, trigger judgments and evaluator reads use those canonical maps;
- inherited or non-enumerable prototype answers are absent, never consumed;
- malformed OWN values still return `invalid`;
- an inherited `actor:functioning` therefore results in the ordinary missing-answer requirement, never a kill or other mechanic.

Do not rely on TypeScript typing or ordinary property lookup over the caller object.

### SOL-10F-B4 — prospective jinx gating follows the ordered Role-transition sequence — MEDIUM

Accepted from Astra re-verification finding 4.

A final represented-Role set is insufficient. A creation interaction may occur and then disappear, or a pair may be removed and recreated, within one declared guided outcome.

Freeze:

- prospective-jinx analysis consumes Actual Role change intents in their declared operation + intent order;
- simulate represented canonical Roles after EACH proposed Actual Role change;
- record any canonical pinned jinx that becomes active at any step because of that change, even if a later change removes it;
- if an active pair is removed and later recreated, the recreation is a new prospective creation event and is gated;
- any unverified prospective jinx encountered anywhere in the sequence makes the WHOLE guided resolution unsupported/Manual before composition commits;
- canonical ownership rules and "not script membership" remain unchanged.

This is a future-primitive authority rule even though the current shipped Pit-Hag evaluator emits only one Actual Role change.

### SOL-10F-B5 — all participant-scoped Night-progress components use collision-free encoding — MEDIUM

Accepted from Astra re-verification finding 5 and supersedes §31 A7's raw composite-key form.

Raw delimiter concatenation is not collision-free when both ParticipantId and RoleId are schema-valid arbitrary strings.

Freeze:

- one shared `encodeNightProgressComponent` (or equivalent) encodes every dynamic key component before concatenation;
- use it in `participantStepKey`, `travelerArrivalStepKey`, generic participant-scoped builders, and Night-trigger keys;
- encoding must distinguish raw `:`, `%`, Unicode and delimiter-like values;
- static family prefixes remain readable;
- every reader/writer/cleanup path derives keys through the same builders;
- Phase 10F store v24 is unreleased: this remediation defines the final v24 key encoding. Do not bump STORE_VERSION solely for pre-release raw v24 development keys;
- do not guess ownership of an ambiguous legacy/raw v24 composite key. Tests must prove no cross-participant cleanup for adversarial ParticipantId + RoleId pairs.

The ordinary Role-away-and-back re-wake policy remains unchanged and is not part of this finding.

### SOL-10F-B6 — Night-progress encoding is Firebase-key-safe — MEDIUM

Accepted from Astra re-verification finding 6.

Collision-free encoding must also satisfy Firebase Realtime Database key rules.

Freeze:

- the shared component encoding used by B5 must encode every Firebase-forbidden key character, including `.`, `#`, `$`, `[`, `]` and `/`, as well as the delimiter `:` and the escape marker so encodings cannot collide;
- do not rely on bare `encodeURIComponent` because it leaves `.` unchanged;
- event ids such as `death.v1` must produce a writable trigger progress key;
- prove this through both pure key tests and the installed Firebase SDK/emulator-facing path where practical.

### Documentation inconsistency — accepted and corrected in current-state summaries

Astra also found stale subordinate 10F status lines that still described earlier Luna/doc-review states. Historical dated records remain unchanged; current status summaries must describe: Astra re-verification REVISE → SOL-10F-B1…B6 remediation → Luna targeted verification → Astra closure recheck → Phase 10F open.

### Astra concerns not promoted

- **Ordinary Role-away-and-back same-Night replay:** no new 10F rule. Existing progress retention remains conservative; Pit-Hag does not invent extra wakes.
- **Multiple unrecorded/null trigger occurrences:** no new 10F rule. Concrete recorded LifeEvents remain event-specific; an unknown-coverage null trigger remains a single conservative Storyteller-judged trigger identity for that participant/Role/Night.

### Remediation gate

Claude Code remediates SOL-10F-B1…B6 only, preserving all prior A1…A10 closures. Add direct regressions for Astra's six counterexamples plus cross-seam coverage. Run the complete Phase 10F gate and return one exact clean checkpoint to Luna. Do not send directly to Astra, merge, deploy or close 10F.

## 36. SOL-10F-B1…B6 remediation record — 2026-10-03

Remediated exactly the §35 findings, on top of `e72ddf5abcdac5e15f32f035d5a6d8762985b3dd`. Code checkpoint: `b9a7c58cca86a5e0b7b54ccdd1957aef90c866f2` (`9137f16` B5+B6, `f61f2c5` B3, `8235344` B4, `0566207` B2, `a3662f7` B1, `1262796` cross-seam regressions, `b9a7c58` type comment). Schema / store version unchanged (v24 — this remediation defines the FINAL v24 Night-progress key encoding; no migration added); no Firebase Rules change. Phase 10F is NOT closed.

- **B1:** `RequirementInput` participant slots hold `ParticipantBinding | null` per slot, captured through one helper (`captureBinding`) the instant each slot is chosen; filling another slot never rebuilds an earlier one; an initial answer keeps its own bindings; distinctness compares ParticipantId; a complete answer emits exactly the captured bindings, so a slot whose participant left reaches the coordinator stale and is refused. A shared `ParticipantSelect` shows a captured-but-stale binding as an explicit "No longer in that seat — choose again" state (never the replacement occupant under the same PlayerId); choosing the seat again captures the new occupant. The inline flow, the Grimoire picker and Manual workspace steps use the same capture/display. (The workspace is modal — the Grimoire is inert while it is open — so the Grimoire picker feeds the inline single-target flow only.)
- **B2:** `deathAttempt` takes an optional `DeathAttemptScope`; a scoped judgment id is `protection:{cause}@[scope, participantId]` (JSON-encoded; never collides with the unscoped single-attempt id, which Imp / Slayer / Harlot keep). Al-Hadikhia scopes every attempt with `attemptScope`: stage (initial choice consequence vs final all-alive), ordered position, ordered chosen ParticipantIds, choices resolved so far, hypothetical Life intents already resolved, and the alive/dead vector of the chosen players. An initial judgment never settles the final attempt — even with an identical prefix/state — and any earlier change changes later ids. Known protection is recomputed at every attempt; final deaths stay 1 → 2 → 3 in one commit. The A6 test that asserted reuse of the initial judgment in the final sequence was updated to this contract.
- **B3:** the coordinator snapshots `request.inputs` / `request.judgments` with `ownAnswerMap` (frozen, null-prototype, own enumerable entries, each read once) before any validation; validation, declared-input checks, functioning, modifier confirmations, the Night-trigger judgment, the evaluator context and the judgment-used test read only those maps. `abilityInputValueError` additionally requires `kind` and the payload field to be OWN fields. Inherited / non-enumerable answers are absent; malformed own answers stay `invalid`.
- **B4:** `prospectiveJinxes` simulates the proposed Actual Role changes one at a time in declared operation + intent order over a lightweight evolving assignment, recording every pinned canonical pair that turns inactive → active at any step (transient creation and removal/re-creation included). Canonical ownership, "never script membership" and `checkOrdering` unchanged.
- **B5 / B6:** one shared `encodeNightProgressComponent` encodes every dynamic component of `participantStepKey`, `travelerArrivalStepKey`, `participantScopedStepKey` and `nightTriggerStepKey` (and the trigger judgment id): each UTF-16 code unit outside `[A-Za-z0-9_-]` becomes `%XXXX`. Injective for every string (lone surrogates included, never throws), never emits `:`, `%`-escaped, and never emits a Firebase-forbidden key character (`.` `#` `$` `[` `]` `/`, controls). Static family prefixes stay plain; ordinary ids (`pt-<uuid>`, canonical RoleIds) encode to themselves. Pre-fix raw v24 composite keys are never re-interpreted (no guessed ownership); v24 is unreleased and v23 → v24 migration already drops participant-scoped progress.

Unchanged by decision (§35 "not promoted"): ordinary Role-away-and-back same-Night replay policy; the single conservative `eventId:null` trigger identity.

Gate at `b9a7c58cca86a5e0b7b54ccdd1957aef90c866f2`: typecheck PASS; targeted B1…B6 suites 70/70 (3 files: `astraReverification.test.ts`, `astraReverificationUi.test.tsx`, `nightProgressKeys.sdk.test.ts`); A1…A10 suites 61/61 (2 files); proof-character suites 210/210 (16 files); 10F foundation / architecture / writer guards 416/416 (17 files); Life Event migration / recovery / checkpoint suites 163/163 (8 files); full normal suite 3,897/3,897 across 158 files (0 skipped); Firebase emulator 201/201 (0 skipped); build PASS; worktree and baseline-range `git diff --check` PASS. The installed Firebase SDK (12.12.1, offline oracle) rejects the pre-fix raw `…:ideath.v1` trigger key and accepts every encoded key, including an end-to-end Imp kill recorded as LifeEvent `death.v1` followed by the consumed Ravenkeeper trigger. All eight Astra counterexamples reproduced before the fixes (B1 Al-Hadikhia + Fortune Teller emitted the replacement's binding; B2 reused the initial judgment; B3 consumed an inherited `"no"` as functioning and killed the Chef; B4 missed both jinx sequences; B5 produced the identical key `p:alpha:beta:gunslinger`; B6 produced a Firebase-invalid key) and refuse / ask correctly after. The B1 UI regressions fail 8/15 on the pre-fix UI; twelve planted seam mutations (scope ignored, stage or prefix dropped from the attempt token, raw judgment / input reads, inherited value fields, first-vs-last jinx comparison, `:` / `.` / `%` kept plain, raw joins, bare `encodeURIComponent`) were each caught and restored.

## 37. Sol pre-Luna acceptance of B1…B6 remediation — 2026-10-03

Sol independently spot-checked the pushed B1…B6 remediation at code checkpoint `b9a7c58cca86a5e0b7b54ccdd1957aef90c866f2` and accepts it for targeted Luna verification.

The spot-check confirmed the intended authority shapes:

- multi-participant UI slots retain the exact `ParticipantBinding` captured when each slot is selected, including incomplete requirements;
- Al-Hadikhia protection judgments are scoped to a particular death attempt and evolving resolution prefix, so initial and final attempts cannot share one Storyteller answer;
- guided answer maps are canonical own-property snapshots used by every downstream consumer;
- prospective jinx analysis simulates Actual Role changes in declared order rather than comparing only the initial and final represented sets;
- every dynamic component of participant-scoped Night progress uses one injective encoder;
- the same encoding is Firebase-key-safe, including dotted LifeEvent ids, and is exercised through the installed Firebase SDK.

The B5/B6 key encoding remains an unreleased-v24 contract refinement; `STORE_VERSION` stays 24 and no Firebase Rules change is required.

No proof-character rule boundary is reopened by this acceptance. Luna must independently verify B1…B6, preservation of A1…A10, the full regression gate and documentation integrity before Astra closure re-verification.

Phase 10F remains open. No merge or deployment is authorized.
