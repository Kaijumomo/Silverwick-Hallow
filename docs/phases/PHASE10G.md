# Phase 10G — Advanced Storyteller Bookkeeping / Final Visual Integration

**Current status:** CLOSED AND INTEGRATED (§37)\
**Contract status (as frozen):** SOL CONTRACT FROZEN — IMPLEMENTATION AUTHORIZED\
**Decision date:** 2026-10-03\
**Starting branch:** dev/phase-10g\
**Starting checkpoint:** 52e685b16e76df15154512a52a34831a6aeba399\
**Required relationship:** identical to main, 0 ahead / 0 behind before implementation\
**Starting schema/store:** v24\
**Target schema/store:** v25\
**Firebase Rules:** no rules change authorized or expected


## 1. Purpose

Phase 10G closes the generic Storyteller operating model established by Phase 10 before Phase 11 expands canonical character coverage.

The product rule is:

Phase 10G may add the minimum generic authoritative bookkeeping and presentation needed to operate the existing Phase 10 engine safely. It must not become another character-coverage phase, a generic rules engine, a win-condition solver, or a broad UI redesign.

At 10G closure, Phase 11 should be able to focus primarily on character descriptors, evaluators, verified modifier semantics and tests rather than inventing another state domain or Storyteller workflow.


## 2. Frozen foundation

The following remain authoritative and are not reopened unless implementation establishes a genuine contradiction:

* 10A — Life Transition Semantics.
* 10B — Effect Lifecycle.
* 10C — Reminder Workflow.
* 10D — Role Transitions.
* 10E — Alignment Transitions.
* 10F — Guided Ability Resolution / Night Actions.

Preserve:

* Storyteller as authoritative writer.
* Current State as mechanical truth.
* History as explanatory only.
* Information Delivery as the record of what was communicated.
* Reminders as non-authoritative notation.
* PlayerId as reusable seat identity.
* ParticipantId as immutable participation identity.
* Actual Role separate from Shown Role.
* Actual Alignment separate from Shown Alignment.
* the existing Life / Effect / Reminder / Role / Alignment planner seams.
* one pure guided ability coordinator.
* one authoritative resolveAbility commit.
* explicit Storyteller judgment for discretion/ambiguity.
* Manual fallback for unsupported/homebrew interactions.
* public/self allowlist projections.
* Privacy Mode DOM-absence behavior.
* nominations and ordinary voting remaining outside Silverwick.
* routine Storyteller operation remaining low-friction.

No architecture change is authorized merely for elegance.


## 3. Phase 10G scope

Phase 10G contains six implementation slices:

1. Game-scoped Rule Facts.
2. Completion of the two explicitly deferred 10F consumers.
3. Storyteller Activity and Manual Information Delivery.
4. Dawn Review.
5. Final Grimoire integration.
6. Terminal Game End, bounded text and Phase 10 closure.

No additional character wave is part of 10G.


## 4. Game-scoped Rule Facts

### 4.1 Why a new primitive exists

Some authoritative mechanical state applies to the game/table rather than a participant.

It cannot truthfully be represented by:

* Life State;
* participant Effects;
* Reminders;
* Information Delivery;
* Life Events;
* History;
* Night progress.

10G therefore adds one narrow Current-State primitive:

Game Rule Facts

This is not an extension of participant Effect ownership.

It is not a generic rules DSL.


### 4.2 Authoritative record

The v25 game snapshot gains a Storyteller-private collection conceptually equivalent to:

gameRuleFacts

A stored Rule Fact must contain only bounded structured state needed by the approved primitive.

The minimum record semantics are:

* stable semantic type;
* exact Live Game Moment at which it was recorded;
* optional exact Live Game Moment at which it expires;
* optional Provenance;
* optional resolutionId.

No arbitrary free-text type acquires mechanics merely because it exists.

No general parameter/rules-expression system is introduced in 10G.

A Rule Fact type may be mechanically interpreted only when it is explicitly registered by Silverwick.

Unknown/custom Rule Fact types must never silently acquire rules.

Initial registered types

10G production semantics are limited to the two explicitly approved facts:

* pitHagArbitraryDeaths
* toymakerDemonSkipOccurred

Names may vary locally only if the same distinction and ownership are preserved consistently.


### 4.3 Multiplicity

The two 10G fact types are singleton facts.

An attempt to apply a fact whose authoritative singleton state is already current is a true no-op.

No duplicate active records for the same 10G fact type may coexist.

A future phase may amend multiplicity if a verified mechanic requires it; 10G does not design that future system.


### 4.4 Planner seam

Add one pure authoritative Rule-Fact planner and pure application seam.

Conceptually:

planGameRuleFactTransaction(...)

applyGameRuleFactPlan(...)

and one Storyteller-owned store command conceptually:

resolveGameRuleFacts(...)

Exact local names are implementation details.

The seam owns:

* application;
* explicit removal/correction;
* deterministic expiry;
* explanatory History;
* validation;
* true-no-op behavior.

An ended game refuses Rule-Fact mutation.

A refusal changes no:

* Current State;
* History;
* Undo;
* localSeq.


### 4.5 Persistence preflight

A direct Rule-Fact mutation is a new 10G authoritative mutation and must not repeat the persistence gap deliberately deferred from legacy commands.

Before authoritative local commit, a changed direct Rule-Fact plan must pass the applicable:

* persisted game/schema validation;
* Firebase-writable validation;
* recovery-checkpoint-envelope validation.

Failure refuses the command before any game replacement, Undo push, History addition or localSeq change.

A Rule Fact created as part of resolveAbility inherits the existing 10F C3/E1 authority boundary and must not introduce a second persistence path.


## 5. v25 History amendment

### 5.1 Existing invariant

Every existing History category remains participant-scoped exactly as frozen in 9R/10A–10E.

Existing participant History must continue to require a durable ParticipantRef.

No existing History record is rewritten by migration.


### 5.2 Game-scoped History

Game Rule Facts have no truthful participant subject.

v25 therefore adds one narrow game-scoped History variant/category:

gameRuleFact

A game-fact History record:

* has no participant;
* must not manufacture one;
* identifies the Rule Fact type;
* records its operation;
* records its before/after or added/removed snapshot;
* may carry Provenance;
* may carry resolutionId;
* may be marked as a correction where appropriate.

Allowed operations are conceptually:

* apply;
* remove;
* expire.

No update operation is required in 10G because the two approved facts are presence/lifecycle facts rather than mutable parameter objects.

Deterministic expiry is explanatory History, not a new mechanical authority.

The schema must preserve strict participant requirements for all old History categories while explicitly forbidding/failing fake participant attribution on game-fact History.


## 6. Rule-Fact expiry and phase transition

A Rule Fact with an exact expiry boundary expires atomically when entering that boundary.

Rule-Fact expiry must occur inside the same advancePhase authoritative game replacement that already owns:

* Life Event Window rollover;
* Effect expiry;
* phase/day advancement.

There must not be:

1. phase transition commit;
2. separate fact-expiry commit.

Undoing an ordinary Night/Day phase transition restores the pre-transition snapshot, including the expired Rule Fact.

A finished game freezes its final Rule-Fact state.


## 7. Rules Query integration

Rules Query gains one pure way to query registered game facts from Current State.

It must never consult:

* History;
* Reminders;
* Activity presentation state

to answer a mechanical question.

A registered fact may produce a known result.

An unknown/custom fact type must not automatically become mechanically meaningful.

The Rule-Fact query must remain pure and derive from the evolving working snapshot when used inside ability composition.


## 8. Ability composition

GameRuleFact becomes an authoritative mechanical operation available to the existing pure ability coordinator.

It is part of explicit ability operation ordering.

There is no second ability coordinator.

There is no post-commit fact writer for an ability result.

If an ability produces:

1. a Role change; then
2. a game Rule Fact,

that ordered outcome is planned against one evolving working snapshot and committed exactly once by resolveAbility.

All existing 10F stale-state, participant-binding, confirmation, C3/E1 and one-commit guarantees remain intact.


## 9. Pit-Hag — deferred Demon branch

10G completes only the Pit-Hag branch already verified and deliberately deferred by 10F.

The frozen ordinary Pit-Hag behavior is not reopened.

When a functioning Pit-Hag legally makes a Demon:

1. the target’s Role changes through the existing Role seam;
2. Actual Alignment is preserved under the frozen Role rules;
3. the existing told-role/perception behavior is reused;
4. pitHagArbitraryDeaths becomes Current State in the same ability resolution;
5. the fact expires on entering the following Day.

No partial Role change may commit if the Rule-Fact operation refuses.

Traveler transformation, concealed-identity cases and other branches already left Manual remain Manual.

No new Pit-Hag rule is inferred beyond the frozen matrix.


## 10. Arbitrary-death consumption

pitHagArbitraryDeaths must not be implemented as separate Pit-Hag checks copied into individual character evaluators.

Its effect must be consumed through one shared death-attempt / protection / Rules Query path used by death-touching guided mechanics.

While the fact applies:

Silverwick must not claim an ordinarily deterministic death result is mechanically forced.

A death-touching guided interaction requiring the arbitrary-death ruling must route to explicit Storyteller judgment or Manual resolution.

The Storyteller may then use existing Life/Manual primitives to record whichever deaths actually occurred.

No automatic arbitrary-death chooser is introduced.

No win-condition logic is introduced.


## 11. Toymaker skip bookkeeping

10G records only the positive authoritative fact:

the required Toymaker Demon skip has occurred.

Do not persist a separate skipRequired = true state.

Derive:

Toymaker skip still required

from:

* Toymaker is currently active; and
* toymakerDemonSkipOccurred is absent.

Derive:

Toymaker skip satisfied

from:

* Toymaker is currently active; and
* the fact is present.

If Toymaker is inactive, the fact produces no active Toymaker requirement.

The stored fact remains valid game bookkeeping if Toymaker later becomes active again.


### 11.1 Toymaker modifier behavior

The verified Toymaker modifier hook must consume the Rule Fact.

When Toymaker is active:

* skip fact present → the missing-skip history no longer gates an otherwise valid Demon attack;
* skip fact absent → retain explicit Storyteller judgment where the verified Toymaker rule requires it.

Silverwick still does not calculate whether a Demon attack would end the game.


### 11.2 Recording the skip

Provide a deliberate Storyteller control to record that the Demon skipped.

The authoritative action must use the Game Rule Fact seam.

It must not:

* write a Reminder;
* infer the skip from Night progress;
* infer it from a skipped Demon row;
* attach the fact to the current Demon participant;
* modify Imp semantics merely to store the fact.

A contextual Demon-row shortcut is optional; a global Storyteller Rule-Fact surface is sufficient.


## 12. Information Delivery — v25

### 12.1 Existing structured delivery remains frozen

The existing structured Information Delivery shape remains semantically unchanged.

It continues to mean:

information actually communicated through a registered Role Information Action.

Existing v24 records are not rewritten by migration.

Existing structured records without a new discriminator remain structured records.

The v25 schema must continue to validate their existing requirements strictly.

No synthetic generic Information Action id is introduced.


### 12.2 Manual Information Delivery

v25 adds one explicit Manual Information Delivery variant.

It records communication truth without pretending an unsupported/homebrew Role owns a canonical Information Action.

A Manual Delivery includes, at minimum:

* explicit manual discriminator;
* id;
* durable recipient ParticipantRef;
* recipient Actual Role snapshot;
* Game Moment;
* bounded text describing what was communicated;
* optional authorized performedRole;
* optional Provenance;
* optional resolutionId.

A Manual Delivery does not contain or invent a canonical informationActionId.

It is never mechanical input.


### 12.3 Performed Role

When a Manual Delivery records a performed Role different from Actual Role, it must come from the actual workflow context and may not be an arbitrary unrelated Role.

Existing simulated-wake identity safety must be preserved where applicable.

The Storyteller cannot use Manual Delivery to falsify Current State.


### 12.4 Manual workspace

Add Information told as a Manual resolution step.

It must route through the existing Manual ability outcome and resolveAbility.

Therefore a Manual resolution containing Information Delivery inherits:

* workflow stale detection;
* participant binding;
* ordered composition;
* one final game replacement;
* one Undo;
* one localSeq;
* resolutionId;
* C3/E1 persistence preflight.

Do not create a second standalone Manual-delivery mutation path solely for the workspace.

Manual Delivery text maximum:

4,000 characters.

Oversized text is refused, never silently truncated.


## 13. Storyteller Activity

Add one Storyteller-private review surface, working name:

Activity

It presents the bookkeeping the game already owns.

Changes

From:

game.history

Information told

From:

game.informationDeliveries

No new persisted Activity stream is created.


### 13.1 Authority boundary

Activity is presentation.

It must never become a mechanical reconstruction source.

Rules Query, ability evaluators and domain planners must not read the Activity presentation or History to infer Current State.

Activity may route the Storyteller to authoritative correction controls.


### 13.2 Ordering honesty

History and Information Delivery are separate arrays and do not contain a universal cross-stream sequence number.

Activity must not invent exact cross-stream ordering where none is known.

It may:

* group by Game Moment;
* group records sharing resolutionId;
* preserve ordering inside each source where meaningful.

Within one Game Moment, unrelated History and Delivery records without common correlation must not be presented as though their exact interleaving is authoritative.


### 13.3 Required Activity behavior

Activity must support at least:

* viewing History;
* viewing structured Information Deliveries;
* viewing Manual Information Deliveries;
* viewing participant-less game-fact History;
* basic filtering or focusing by participant/category/moment sufficient for practical Storyteller review;
* displaying resolutionId-correlated records together where applicable.

History itself is read-only.


### 13.4 Information Delivery removal

Expose the existing Information Delivery removal/correction behavior.

Removal may apply to an older/non-latest Delivery.

UI copy must state or clearly imply:

removing the stored record does not undo or “unsay” information already communicated.

10G does not add a new historical-delivery reconstruction engine.

The existing frozen remove-then-record model remains unless the current recipient/workflow permits a new record.


## 14. Dawn Review

Night → Day gains a Storyteller review analogous in purpose, not necessarily appearance, to Dusk Review.

Its correctness purpose is:

unfinished Night work must not silently disappear because Night Order unmounts on Day.


### 14.1 Shared derivation

Night Order and Dawn Review must use the same authoritative/pure derivation of Night work.

Do not independently restate Night-step or trigger rules in the two UI surfaces.

The shared derivation must cover:

* current Night Order rows;
* participant-scoped Night progress;
* verified triggered abilities;
* custom Night steps.


### 14.2 Review contents

Dawn Review must identify unfinished current-Night work including:

* unresolved Night rows;
* unresolved/open verified triggers;
* trigger states requiring a Storyteller check;
* pending custom Night steps.

Deaths tonight and Effects expiring at Dawn may be shown as contextual information, but they are not required acceptance criteria for 10G.


### 14.3 Advisory, not hard mechanical gate

If no unfinished work exists:

Night → Day may advance directly.

If unfinished work exists:

present:

* Review Night
* Continue to Day anyway

Continuing anyway is explicit Storyteller authority.

No authoritative nightComplete field is added.

No acknowledgment record is persisted.


### 14.4 Privacy Mode

Freeze one consistent rule:

Night → Day review requires Privacy Mode to be off.

While Privacy Mode is on, the Night → Day action is disabled and instructs the Storyteller to turn Privacy Mode off to review the Night before continuing.

Do not render private Night-review content or even a derived private unresolved-items list underneath Privacy Mode.

This matches the existing Dusk safety pattern and preserves DOM-absence expectations.


## 15. Final Grimoire integration

Do not redesign the Grimoire.

Add only the state that Phase 10 now makes operationally important.


### 15.1 Ability-used indicator

If a participant has:

abilityUsed === true

show one concise Storyteller-private used/spent marker on their Grimoire token.

No marker is required for false.

The indicator is presentation-only.

It does not determine ability legality.

Privacy Mode removes it from the DOM.


### 15.2 Actual Alignment indicator

Actual Alignment remains distinct from Role and perception.

For an ordinary participant:

* derive the Role’s ordinary/default alignment through the existing Role registry/type semantics;
* show a concise Storyteller-private marker when Actual Alignment differs from that ordinary alignment.

Do not show a redundant marker merely to restate the normal Role alignment.

For a Traveler:

* Actual Alignment may be shown directly once resolved because it is not safely inferable from an ordinary character team.

Existing Traveler unresolved-alignment handling remains authoritative.

Shown Alignment is not substituted for Actual Alignment.

Privacy Mode removes the Actual Alignment marker from the DOM.


### 15.3 Global Rule-Fact surface

Active/derived game-level bookkeeping must appear in a global Storyteller surface rather than on a participant token.

At minimum make clear when relevant:

* Arbitrary deaths are active tonight.
* Toymaker skip is still required.
* Toymaker skip has been satisfied.

The surface must give the Storyteller an appropriate path to Rule-Fact controls/correction.

It must not expose private rule facts under Privacy Mode.


## 16. Night Rules Query cleanup

The Night dashboard must not construct its ordinary Rules Query with a blanket:

modifiers: []

unless a specific modifier-free query is deliberately required and separately named/tested.

The ordinary Night dashboard query should use the same active modifier derivation expected by the Rules Query architecture.

The authoritative ability coordinator remains the final rules authority.

This is a Phase 11 readiness hardening item, not a reopening of 10F.


## 17. Formal Game End

The current user-facing End Game behavior is replaced by a true terminal lifecycle.

“Finish game” and “discard/delete this game” are not the same operation.


### 17.1 When Finish Game is available

Formal Finish Game applies to a game in live play:

* Night;
* Day.

A Setup is not turned into a finished played game merely because the Storyteller wants to abandon setup.

Setup discard/replacement remains a separate concept.


### 17.2 Live multiplayer finish sequence

For a live multiplayer game:

1. Storyteller explicitly confirms Finish Game.
2. Existing fenced multiplayer/session close completes authoritatively.
3. If remote close fails, the local game remains live and unchanged.
4. Only after authoritative close succeeds does the local game become the retained ended snapshot.
5. Local lobby association is detached.
6. Undo history is cleared.
7. The final local game is retained with phase: "ended".

No result/winner is inferred or required.


### 17.3 Offline finish

An offline live game may transition directly to the same local ended state.

For consistency, Finish Game is terminal locally in both modes.

No ordinary Undo path is required back into Night/Day.


### 17.4 No Undo to live play

A finished live game must not create an Undo entry that can restore Night/Day.

Do not implement Finish Game as a naive caller of the existing setPhase("ended") if doing so preserves its current Undo behavior.

The finished snapshot is terminal/read-only.

This is especially mandatory for multiplayer because the remote session has already ended and cannot be made live again by local Undo.


### 17.5 Detachment

The retained ended snapshot must no longer be associated with an active lobby/runtime writer.

Reloading the app must not attempt to reconnect the ended local review snapshot to its terminated session.

Historical room code/state may remain inside the frozen snapshot if needed for record fidelity; active lobby association must not.


## 18. Ended-game review surface

An ended game remains reviewable.

At minimum the Storyteller can inspect:

* final Grimoire state;
* participant state in read-only form;
* Activity;
* final History;
* Information Deliveries;
* final Life/Effect/Reminder/Role/Alignment state.

Do not mount mutation affordances merely because underlying legacy store commands still exist.

The ended review UI is read-only by product contract.

10G does not retrofit every legacy store mutator with an ended-phase refusal solely to enforce UI read-only behavior.

The new Game Rule Fact planner and new Manual Delivery path themselves must refuse mutation in ended.

Home may expose the retained snapshot as:

Review finished game

rather than “Continue current game.”

New Game explicitly replaces/discards the finished snapshot.


## 19. Winner/result semantics

10G does not add authoritative winner/result state.

Do not:

* infer Good/Evil victory;
* add win-condition solving;
* populate the legacy optional public winner field;
* remove that legacy field merely because it is unused.

The existing public/player terminal “Game ended” behavior remains valid.

Public post-game Role reveal is out of scope.


## 20. Bounded free text

Opus independently reproduced localStorage quota failure through repeated very-large note input.

10G closes the realistically reachable input vector without creating a broad persistence subsystem.


### 20.1 Player Storyteller notes

Maximum accepted length:

4,000 characters.

Apply the limit:

* in the Storyteller UI input; and
* at the store command boundary.

A command receiving oversized changed text refuses it.

Do not silently truncate.

An already-loaded legacy/current save containing more than 4,000 characters must remain loadable.

Therefore this limit is not retroactively enforced as a persisted-game schema rejection against old data.

An unchanged oversized legacy value remains a true no-op.


### 20.2 Night-step notes

Maximum accepted length:

4,000 characters.

Apply the same rules:

* UI maxLength/feedback;
* command-boundary refusal;
* no silent truncation;
* no schema rejection of already-saved oversized values.


### 20.3 New 10G text

Manual Information Delivery text is limited to:

4,000 characters

from its first schema version.

Do not add an unbounded Storyteller-editable Game Rule Fact note field in 10G.


### 20.4 Deferred persistence hardening

Explicitly defer:

* general QuotaExceededError transaction/recovery architecture;
* dynamic Undo trimming;
* storage-health management;
* universal local-persistence rollback;
* store-wide E1 retrofit.

Record the reproduced quota failure in 10G documentation as evidence for the later infrastructure-hardening backlog.


## 21. Store-wide E1 checkpoint preflight

Decision:

DEFER

Do not refactor every legacy game mutation to use the 10F E1 precommit envelope.

Reasons:

* there is no safe universal structured-refusal seam across existing commands;
* a universal store commit abstraction would reopen multiple closed phases;
* writer-side exact validation already prevents partial remote projections;
* Phase 11 guided ability mutations already use resolveAbility;
* localStorage quota can fail before Firebase’s checkpoint limit anyway.

10G rule

Any new 10G authoritative command capable of increasing persisted game state must use the appropriate precommit compatibility/checkpoint proof.

Legacy command retrofit remains separate future hardening.


## 22. v24 → v25 migration

Phase 10G performs one schema/store bump:

v24 → v25

Migration must be per-snapshot and apply to:

* Current State;
* Undo snapshots;
* recovered checkpoint games.

The migration:

1. stamps v25;
2. initializes the new game Rule-Fact collection empty where absent;
3. does not invent Rule Facts;
4. does not rewrite existing History;
5. does not invent participant-less History;
6. does not rewrite existing structured Information Deliveries;
7. does not invent Manual Deliveries;
8. does not alter participant identity;
9. does not alter Life/Effect/Reminder/Role/Alignment state.

Current-version malformed v25 data fails validation rather than being “repaired.”

Existing structured v24 Delivery records remain structurally recognizable as structured deliveries without requiring migration to add a discriminator.


## 23. Projection and privacy

Game Rule Facts, Activity, History, Information Delivery, Actual Alignment indicators and ability-used indicators remain Storyteller-private unless an existing public field independently exposes equivalent information.

Do not expand public/self projections for 10G Rule Facts.

No player-facing Manual Delivery record is introduced.

Privacy Mode maintains DOM absence for all new Storyteller-private UI.

The only existing public lifecycle behavior relevant to Finish Game is the existing terminal session/public-status behavior.

No Firebase Rules change is expected.

If implementation discovers that a required v25 write cannot pass current rules, stop and report a material architecture conflict to Sol rather than altering rules silently.


## 24. Responsive behavior

10G does not authorize a broad responsive redesign.

Every newly introduced major Storyteller surface must nevertheless receive narrow-viewport verification, including:

* Activity;
* Dawn Review;
* global Rule-Fact controls/status;
* ended-game review.

Also verify the existing Night Order + Grimoire target-picking interaction at narrow width as part of the Phase 10 closure gate.

Redesign only if verification demonstrates an actual usability/accessibility defect.


## 25. Explicitly out of scope

Phase 10G does not include:

* any additional canonical character coverage beyond the two frozen consumers named above;
* mid-game Fortune Teller Red Herring creation;
* full Traveler ability automation;
* broad Fabled mechanics;
* broad Loric mechanics;
* full Jinx semantics;
* live Fabled/Loric redesign;
* nominations;
* ordinary voting;
* Cult Leader cult-vote automation;
* automatic win detection;
* winner/result modeling;
* AI Storyteller assistance;
* AI rulings;
* analytics;
* post-game statistics;
* public role reveal;
* replay/archive system;
* generic global rules DSL;
* game-scoped participant Effects;
* broad Grimoire redesign;
* second ability coordinator;
* second audit/event log;
* store-wide E1 retrofit;
* general persistence-quota recovery architecture.


## 26. Acceptance criteria

Game Rule Facts

10G-AC-01 — v25 authoritative state
A v25 game has a validated Storyteller-private Game Rule Fact collection. v24 → v25 migration creates an empty collection without inventing facts.

10G-AC-02 — Registered semantics only
Only explicitly registered Rule Fact types acquire mechanics. Unknown/custom labels do not alter gameplay.

10G-AC-03 — Pure Rule-Fact planner
Apply/remove/correction planning is pure, singleton-safe, refusal-safe and produces true no-ops when state is already current.

10G-AC-04 — Direct precommit safety
Any changed direct Rule-Fact command validates the resulting persistent/Firebase/checkpoint composition before authoritative local commit.

10G-AC-05 — Participant-less History
Game Rule Fact History has category: gameRuleFact, carries no participant subject, and existing History categories continue requiring their ParticipantRef exactly as before.

10G-AC-06 — Atomic expiry
A fact expiring at the next phase expires in the same game replacement as phase rollover and Effect expiry, with explanatory expiry History and ordinary phase-transition Undo restoring it.

10G-AC-07 — Pure Rules Query
Approved game facts are queryable from Current State through Rules Query. History/Reminder/Activity data are not consulted mechanically.

10G-AC-08 — Ability composition
Rule-Fact operations compose inside planAbilityResolution and commit only through the existing one-commit resolveAbility boundary.


Deferred consumers

10G-AC-09 — Pit-Hag Demon creation
A legal functioning Pit-Hag Demon creation atomically performs the frozen Role/perception change and establishes the arbitrary-deaths Rule Fact. Any refusal commits neither.

10G-AC-10 — Pit-Hag expiry
The arbitrary-deaths fact expires on entry to the following Day.

10G-AC-11 — Shared arbitrary-death gate
Death-touching guided mechanics consume arbitrary-death state through one shared rules/death-attempt seam rather than character-specific duplicated branches.

10G-AC-12 — Toymaker bookkeeping
The Storyteller can deliberately record that Toymaker’s mandatory Demon skip occurred; the record is game-scoped and survives Demon replacement.

10G-AC-13 — Toymaker derived requirement
Toymaker active + no fact derives “skip required”; Toymaker active + fact derives “skip satisfied”; inactive Toymaker creates no active requirement.

10G-AC-14 — No Toymaker win solver
Toymaker attack legality that depends on whether an attack would end the game remains explicit Storyteller judgment.


Activity and Information

10G-AC-15 — Activity visibility
The Storyteller can inspect History and Information Deliveries from one private Activity surface.

10G-AC-16 — Honest Activity ordering
Activity groups by available moment/correlation evidence and never invents authoritative cross-stream ordering.

10G-AC-17 — Game-fact Activity
Participant-less game-fact History renders correctly without a fake participant.

10G-AC-18 — Manual Delivery variant
v25 validates an explicit Manual Information Delivery variant distinct from existing structured Information Actions.

10G-AC-19 — Structured Delivery compatibility
Every valid v24 structured Information Delivery remains valid after migration without semantic rewriting or invented discriminator/action data.

10G-AC-20 — Manual workspace communication
Manual ability resolution can include bounded “Information told” bookkeeping and commits it through resolveAbility in the same atomic resolution.

10G-AC-21 — Delivery is non-mechanical
Neither structured nor Manual Information Delivery becomes a Current-State reconstruction source.

10G-AC-22 — Delivery review/removal
The Storyteller can inspect and remove an existing Delivery record, including a non-latest record, with explicit copy that removal cannot unsay communication.


Dawn Review

10G-AC-23 — Shared unfinished-Night derivation
Night Order and Dawn Review use one shared derivation for relevant Night rows/triggers/custom steps.

10G-AC-24 — Unfinished work warning
Attempting Night → Day with unfinished current-Night work opens Dawn Review instead of silently advancing.

10G-AC-25 — Storyteller override
Dawn Review offers Review Night and Continue to Day anyway; continuing creates no new acknowledgment state.

10G-AC-26 — Clean fast path
When no unfinished work exists, Night → Day remains low-friction and may advance directly.

10G-AC-27 — Privacy behavior
Night → Day is disabled under Privacy Mode until Privacy Mode is turned off; Dawn Review private content is not rendered underneath Privacy Mode.


Final visual integration

10G-AC-28 — Ability-used marker
A true abilityUsed state produces one concise Storyteller-private Grimoire marker; false produces none.

10G-AC-29 — Actual Alignment exception marker
An ordinary participant whose Actual Alignment differs from their Role’s ordinary alignment has a concise ST-private marker. Traveler Actual Alignment remains independently visible when resolved.

10G-AC-30 — Global Rule-Fact visibility
The Storyteller can see active arbitrary-death state and Toymaker skip required/satisfied state from a global surface.

10G-AC-31 — Privacy DOM absence
All new private indicators, Activity content, Rule-Fact details and Dawn-review content are absent from the DOM under Privacy Mode.

10G-AC-32 — Modifier query cleanup
The ordinary Night dashboard no longer silently constructs its normal Rules Query with an empty modifier set.


Terminal lifecycle

10G-AC-33 — Authoritative close before local finish
A live multiplayer Finish Game changes no local game lifecycle state unless authoritative session close succeeds.

10G-AC-34 — Retained final snapshot
Successful Finish Game retains the complete final local game with phase: ended rather than setting game: null.

10G-AC-35 — Detached terminal state
The retained ended snapshot has no active lobby/writer association and cannot reconnect to the terminated multiplayer session on reload.

10G-AC-36 — No Undo resurrection
Finish Game leaves no Undo path capable of restoring Night/Day after terminal multiplayer closure.

10G-AC-37 — Read-only ended UI
The post-game review surface mounts no ordinary game-mutating controls while still allowing inspection of final Grimoire/participant/Activity state.

10G-AC-38 — New Game transition
A finished snapshot can be explicitly replaced by New Game; it is not silently destroyed by Finish Game itself.

10G-AC-39 — No winner semantics
10G does not create, infer or project new winner/result state.


Persistence text safety

10G-AC-40 — Player-note cap
Changed Storyteller participant notes over 4,000 characters are refused at the command boundary and constrained in UI without silent truncation.

10G-AC-41 — Night-note cap
Changed Night-step notes over 4,000 characters are refused at the command boundary and constrained in UI without silent truncation.

10G-AC-42 — Legacy oversized compatibility
Previously saved oversized participant/Night notes do not make an otherwise valid old game unloadable merely because 10G adds command limits.

10G-AC-43 — Manual Delivery cap
Manual Delivery text over 4,000 characters is rejected.


Migration/recovery/closure

10G-AC-44 — v25 migration coverage
Current game, Undo snapshots and checkpoint recovery all migrate v24 → v25 consistently.

10G-AC-45 — No participant regression
Seat reuse and ParticipantId invariants remain intact across Rule Facts, Activity, Manual Delivery, migration and recovery.

10G-AC-46 — Projection stability
No new private Rule Fact, Activity, Manual Delivery, Actual Alignment or ability-used state leaks into public/self projections.

10G-AC-47 — Narrow viewport
New 10G surfaces are operable at narrow viewport widths without requiring a large UI redesign.

10G-AC-48 — Scope discipline
Coverage-manifest/documentation changes show only the two approved 10F deferred consumers gaining new semantics; no additional Phase 11 character coverage enters 10G.


## 27. Implementation gate

Claude Code must implement against this contract only.

Before claiming an implementation checkpoint, run and report:

* exact branch/HEAD verification;
* final diff scope;
* TypeScript typecheck;
* complete Vitest suite;
* targeted 10G tests;
* Firebase Rules/emulator suite;
* production build;
* migration/checkpoint recovery tests;
* privacy tests;
* responsive/narrow-viewport tests relevant to new surfaces.

Existing test counts are not frozen; all applicable tests must pass.

No test may be weakened merely to achieve green status.


## 28. Required targeted proof areas

Implementation tests must specifically prove:

1. participant-less game-fact History cannot accidentally carry/fake a participant;
2. existing History categories still require participants;
3. Pit-Hag Role + Rule Fact is atomic;
4. arbitrary-death state reaches the shared death-attempt decision path;
5. Toymaker skip survives Demon replacement;
6. Manual Delivery cannot impersonate a structured Information Action;
7. Activity is not read by mechanical modules;
8. Night Order and Dawn Review cannot disagree because they use shared derivation;
9. Privacy Mode removes every new private surface from the DOM;
10. terminal Finish Game cannot be Undone back into a live local game;
11. failed multiplayer close leaves the local game un-ended;
12. reload with a retained ended snapshot does not reconnect the terminated lobby;
13. command-level text caps refuse oversized changed input;
14. migration does not reject legacy oversized note values;
15. v24 structured Delivery records remain unchanged through migration;
16. public/self projections contain none of the new private bookkeeping.


## 29. Phase 11 readiness

Phase 10G may close only when:

* participant-scoped mechanics remain owned by the five frozen player domains;
* game-scoped mechanical facts have one approved authoritative home;
* Rules Query can read both without consulting History/Reminders;
* Pit-Hag and Toymaker no longer depend on Storyteller memory for the explicitly deferred state;
* History and Information Delivery are usable Storyteller bookkeeping rather than write-only arrays;
* Manual fallback can truthfully record unmodeled communication;
* unfinished Night work cannot disappear silently at Dawn;
* Actual Alignment, ability use and global facts are operationally visible;
* a game can end, remain reviewable and remain terminal;
* persistence boundaries for new 10G state are stable;
* Phase 11 can add supported characters primarily through descriptors, evaluators, registered semantics and tests rather than introducing another generic state domain.


## 30. Stop conditions for implementation

Claude Code must stop and return to Sol rather than improvise if implementation establishes that:

* current Firebase Rules actually block the required v25 writes;
* GameRuleFact cannot be composed without bypassing a frozen planner/authority boundary;
* the participant-less History variant requires weakening existing participant History validation;
* terminal Game End cannot retain the snapshot without reopening the multiplayer lifecycle protocol;
* v24 Delivery compatibility requires rewriting existing records;
* any required behavior would force additional character semantics not authorized here;
* a material contradiction with 10A–10F is proven.

A preference for another design is not a stop condition.


## 31. Explicit deferred hardening

Record for later work, without reopening Phase 10G:

* store-wide E1 precommit generalization;
* localStorage quota transaction/recovery;
* dynamic Undo trimming;
* broad persistence-health monitoring;
* any broader final-result/winner model.


## 32. Contract authority

This document supersedes architecture proposals made during the 10G challenge where those proposals differ from the adjudicated rules above.

Opus architecture reports remain evidence.

This Sol contract defines the authorized Phase 10G implementation.

Any material change to these rules requires explicit Sol adjudication before implementation continues.


## 33. Phase 10G implementation record (implementation checkpoint, not closed) — 2026-10-04

Implemented on `dev/phase-10g` from the exact starting checkpoint `52e685b16e76df15154512a52a34831a6aeba399` (identical to `main`, 0 ahead / 0 behind, verified before the first commit). Schema/store v24 → v25. No Firebase Rules change: `src/firebase/rules.json` is untouched, the Storyteller game path carries no structural `.validate` children, and the recovery checkpoint stays one string leaf, so every v25 write is admitted by the current rules (Section 30's first stop condition did not arise). No other stop condition arose.

### Lineage

| Slice | Commit | Scope |
| --- | --- | --- |
| 1 | `02f70ce2d85b7b88e24585a2fb17fdc7af90d861` | v25 Game Rule Facts, participant-less `gameRuleFact` History, atomic expiry, Rules Query reader, v24 → v25 migration |
| 2 | `9645add63576dd26a27c13ea7097ca001d2fa6bf` | Pit-Hag Demon branch, shared arbitrary-death gate, Toymaker skip fact consumption |
| 3 | `3c2c7fcd7fb5a39edfcc90b8aaef5b70fd8041cc` | Manual Information Delivery, Storyteller Activity, delivery removal |
| 4 | `ab169ced2514166aafb2fb962c5852f3aa68f4d9` | Dawn Review over one shared unfinished-Night derivation; Privacy Mode disables Night → Day |
| 5 | `9f27622aec6a14097f61160e173686bca53611f7` | Grimoire ability-used / Actual Alignment markers, global Rule-Fact strip, Night dashboard modifier cleanup |
| 6 | `bb3c28fd8cb6e1cad4b4997b2688737057204df8` | Terminal Finish Game, read-only ended review, Home "Review finished game", bounded free text |
| 6 fix | `cf5efc5f1717513acb8c2f7a7541bcad8919b97e` | Section 24 finding: Grimoire target picking at phone width (below) |

This record is a documentation-only commit on top of the slice-6 fix.

### Slice 1 — Game Rule Facts (Sections 4–8, 22)

- `src/stores/gameRuleFacts.ts`: the registry (`pitHagArbitraryDeaths` — recordable at Night only, expires on entry to the following Day; `toymakerDemonSkipOccurred` — recordable at Night or Day, no expiry), `gameRuleFactActive`, the derived `toymakerSkipStatus` (`inactive` / `required` / `satisfied`; no `skipRequired` state is stored), the pure `planGameRuleFactTransaction` / `applyGameRuleFactPlan`, and `planGameRuleFactExpiry`. Apply of a present fact and remove of an absent fact are true no-ops; refusals are `invalid`, `notLive`, `ended`, `unregistered`, `phase`, `notSeated`. An unregistered stored type carries no mechanics and may only be removed.
- `GameRuleFactRecord` is strict: `type`, `recordedAt`, optional `expiresAt` (must follow `recordedAt`), optional Provenance, optional `resolutionId`. No free-text note field (Section 20.3). Singleton per type is enforced by the snapshot schema; temporal coherence is checked (none in Setup; live `recordedAt ≤ now < expiresAt`; ended games are frozen).
- History: `GameRuleFactHistoryRecord` (`category: "gameRuleFact"`, `ruleFactType`, `ruleFactOperation` `apply`/`remove`/`expire`, matching added/removed item) is a separate strict schema that rejects any `participant` key. `HistoryRecordSchema` dispatches on the raw `category`; every existing participant category keeps its exact ParticipantRef requirement and additionally forbids the rule-fact keys (proof areas 1–2). `expire` is never a correction.
- `resolveGameRuleFacts` commits once (one replacement, one Undo entry, one localSeq step) after the same persistence preflight `resolveAbility` uses (`validateFirebaseWritableValue` + `validateCheckpointEnvelope`) (10G-AC-04, Section 21's 10G rule). `resolveAbility` itself is unchanged from 10F so its 10F guards still hold unmodified.
- Expiry runs inside `advancePhase` in the same replacement, after Effect expiry, with `expire` History (Provenance reason `expired`); ordinary phase Undo restores both (10G-AC-06).
- `rulesQuery.gameRuleFact(type)` answers `known(active)` for a registered type and `unknown` otherwise; it reads Current State only (10G-AC-07).
- `abilityResolution.ts`: a `gameRuleFact` mechanical domain (declared order, confirmation required) planned on the evolving working snapshot (10G-AC-08).
- Migration v24 → v25 per entry (Current State, every Undo snapshot, recovered checkpoint games): stamps 25 and adds `gameRuleFacts: []` only where absent. Nothing else is touched. v25 evidence (a `gameRuleFacts` key, `gameRuleFact` History or rule-fact keys, a delivery `kind`) routes marker-less entries; markers above 25 stay unsupported.

### Slice 2 — Deferred 10F consumers (Sections 9–11)

- Pit-Hag Demon creation now passes the same Traveller / canonical / concealed-identity gates as the ordinary branch, then returns `[roleChange, gameRuleFact apply pitHagArbitraryDeaths]` in declared order: one commit, and a refusal of either operation commits neither (proof area 3). The optional Traveller rule and concealed identities stay Manual.
- The shared `deathAttempt` gate in `src/abilities/characters/shared.ts` consults `query.gameRuleFact(pitHagArbitraryDeaths)`. While the fact applies, every death-touching guided evaluator gets an explicit Storyteller judgment, even for an otherwise known unprotected or protected target. No evaluator carries its own Pit-Hag branch (architecture-tested, proof area 4).
- The Toymaker modifier hook returns no effect once `toymakerDemonSkipOccurred` is present and keeps explicit judgment otherwise. The fact is game-scoped, so it survives Demon replacement (proof area 5). Silverwick still never decides whether an attack would end the game (10G-AC-14). The skip is recorded only by a deliberate control through the Rule Fact seam, never from Night progress, a skipped Demon row or a Reminder.
- The coverage manifest changes only the Pit-Hag and Toymaker notes (10G-AC-48).

### Slice 3 — Manual Information Delivery and Activity (Sections 12–13)

- `ManualInformationDeliveryRecord` (`kind: "manual"`, recipient ParticipantRef, Actual Role, optional performed Role, Live Game Moment, text ≤ 4,000, optional Provenance / note / `resolutionId`) is a distinct strict variant that can carry no Information Action or values. Structured v24 records keep their exact shape with no discriminator, and a `kind` key on one is rejected (10G-AC-18/19, proof areas 6 and 15).
- `planManualInformationDelivery` refuses ended / non-live games, blank or oversized text, and a performed Role not authorized by the workflow's simulated wake. The `manualInformation` coordinator operation exists only in Manual resolution (`options.manualWorkflow`), so guided evaluators can never emit one. The Manual workspace gains an "Information told" step (textarea `maxLength` 4,000 with a counter).
- `src/features/activity/activity.ts` + `ActivityPanel.tsx`: one Storyteller-private Activity surface over History and Information Delivery. Records are grouped by Live Game Moment (newest first) and by `resolutionId` correlation when one exists. The two streams are never interleaved within a group, and an explicit note says no cross-stream order is implied (10G-AC-16). Game-fact History renders with no participant. Any delivery, including a non-latest one, can be removed with the copy "Removing the stored record does not undo or unsay what was already communicated." (10G-AC-22).
- Architecture tests: no store, rules or ability module imports Activity; Rules Query and ability modules never read Information Delivery or History (proof area 7).

### Slice 4 — Dawn Review (Sections 14, 16)

- `src/features/nightOrder/nightWork.ts` (`deriveNightWork`, `unfinishedNightWork`, `stepResolved`) is the one derivation of Night rows, custom steps and verified open triggers. The Night Order and the game screen both read it, and neither calls `computeNightOrder` itself (architecture-tested, proof area 8).
- Night → Day with unfinished work opens Dawn Review ("Night N — before Day") with Review Night and Continue to Day anyway. Continuing is exactly the ordinary phase transition and stores no acknowledgment. A clean Night advances directly.
- Under Privacy Mode, Night → Day is disabled with the reason as its title. An open Dawn Review leaves the DOM and never reopens by itself.
- The dashboard's Rules Query uses the game's active modifiers; no `modifiers: []` remains (10G-AC-32).

### Slice 5 — Final Grimoire integration (Section 15)

- `src/features/grimoire/tokenMarkers.ts`: one concise "Ability used" marker when `abilityUsed` is true; an Actual Alignment marker only for an ordinary participant whose Actual Alignment differs from the Role's ordinary alignment (perception is never substituted); a Traveler's resolved Actual Alignment is shown directly. Markers are folded into the token's accessible name. They overlay the token disc absolutely, so token geometry is unchanged.
- `src/features/ruleFacts/RuleFactStrip.tsx` (region "Game rule facts"): active arbitrary deaths with their expiry, Toymaker skip required (with "Record Demon skip") or satisfied, unregistered facts shown as carrying no effect, removal as a correction, and a Night-only "Record arbitrary deaths tonight" under "More…" for a manually resolved Pit-Hag. Every control goes through `resolveGameRuleFacts`.
- Privacy Mode removes markers, the strip, Activity and Dawn Review from the DOM (10G-AC-31, proof area 9).

### Slice 6 — Terminal lifecycle and bounded text (Sections 17–20)

- `finishGame()` refuses no game, Setup, an ended game, and any still-attached lobby. On success it sets `phase: "ended"` (the Life Event window is pruned as on any ended game), clears Undo, and detaches lobby, sync, pending knocks and selection. The complete final game is retained. The UI's "Finish game" (Night/Day, confirmed) first awaits `closeMultiplayerSession` and calls `finishGame` only after that succeeds; a failed close leaves the local game live and unchanged (proof area 11). Reload of the retained snapshot carries no lobby/sync, so it cannot reconnect (proof area 12). Undo cannot return to Night/Day (proof area 10). Setup keeps the old discard as "Discard setup".
- The ended review mounts no game-mutating control: no Undo, Go live, phase advance, Life/Day controls, seat edits or ring reordering. It shows a "Finished game" banner, the read-only final Rule-Fact state, Activity "(final)" without removal, and a read-only final-state participant dialog (`EndedParticipantReview.tsx`) in place of the Player Drawer. Home offers "Review finished game"; New Game is the explicit replacement. No winner/result state is created or projected (10G-AC-39).
- `setNotes` / `setNightStepNotes` return a structured result and refuse changed text over 4,000 characters (never truncated). An unchanged value, including an oversized legacy one, is a true no-op. The persisted schema does not reject oversized saved notes (10G-AC-40..42, proof areas 13–14). The UI uses `maxLength` with a counter shown from 90%.
- `EndedParticipantReview.tsx` displays Reminders through `reminderPresentation`, so it was added to the reviewed presentation allowlist of the 10C Reminder architecture guard (the guard's designed review step; no mechanics module is allowlisted).

### Section 24 finding — Night Order + Grimoire target picking at phone width

The closure check of the existing 10F interaction found a real usability defect. At 360 and 390 px the Night dashboard is a fixed bottom sheet (up to 76 dvh) over the Grimoire. Once "Pick on Grimoire" is active, the seats sit under the sheet, so a tap lands on the sheet and the pick cannot be completed by pointer. Closing the sheet cancels the pick. The participant dropdown still worked, so this was not a total blocker. The same blocked tap was reproduced in a real browser against the baseline `52e685b`, so it predates 10G.

Minimal fix (`cf5efc5`): while a pick is active, the phone-width sheet collapses to its header (`.night-panel-picking`, inside `@media (max-width: 760px)`). Its body stays mounted, so every choice is kept, and the Grimoire's own "Choosing …: tap a seat" banner with Cancel stays visible. The sheet returns when the pick ends. Wider layouts are unchanged. Tests cover the class toggle and the phone-only CSS scope, and both fail without the fix. The browser check confirms that tapping Carol fills the Monk's choice and the sheet body is visible again afterwards.

### Decisions recorded for review

- **Activity ordering honesty.** Within a moment, History and deliveries are shown as two labelled lists, not merged, because no authoritative cross-stream order exists. A `resolutionId` group is shown as "One resolution". Life History carries no top-level `resolutionId`, so correlation reads it from the record's single Life Event when present.
- **Marker placement.** Markers were first a row under the token, which grew token height and added ring overlap at 360 px. They are now an absolute overlay inside the disc frame; measured token geometry is identical to the baseline.
- **Pre-existing narrow-ring overlap.** At 360 px the baseline (`52e685b`) Grimoire ring already has 5 overlapping token pairs in the verification fixture. 10G leaves the same 5. Section 24 does not authorize a broad redesign, so this is recorded rather than changed.
- **Expiry moment.** `pitHagArbitraryDeaths` recorded at Night N expires at Day N (the "following Day").

### Persistence evidence and deferred hardening (Sections 20.4, 21, 31)

- **Quota evidence.** Opus independently reproduced a localStorage quota failure through repeated very-large note input (Section 20). 10G closes that per-field vector with the 4,000-character command caps. The aggregate persisted size is still not bounded in general. The Undo stack holds up to 20 prior snapshots (`UNDO_LIMIT`), Night-step notes are capped per step but not in count, and History grows with play. A `QuotaExceededError` therefore remains possible in long games. This is evidence for the infrastructure-hardening backlog, not a 10G defect.
- **Deferred, not reopened:** store-wide E1 precommit generalization (legacy commands); localStorage quota transaction/recovery; dynamic Undo trimming; broad persistence-health monitoring; any broader final-result/winner model.

## 34. Phase 10G implementation gate — 2026-10-04

Run at code checkpoint `cf5efc5f1717513acb8c2f7a7541bcad8919b97e` on `dev/phase-10g`, with a clean worktree.

- **Branch/HEAD:** `dev/phase-10g`. Ancestry: `52e685b16e76df15154512a52a34831a6aeba399` → seven 10G commits (§33) → this docs-only record. The starting checkpoint was identical to `main` before the first commit.
- **Diff scope (`52e685b..cf5efc5`):** 90 files, +3,876 / −291, all under `src/`. 17 added and 73 modified: 32 production files, 58 test files and test helpers. No change to `src/firebase/rules.json`, `firebase.json`, `firebase.rules-test.json`, scripts or dependencies. `tsconfig.app.tsbuildinfo` is unchanged from the starting checkpoint.
- **Typecheck** (`tsc -b --noEmit`): PASS.
- **Complete Vitest suite:** **4126/4126 across 171 files**, 0 failed, 0 skipped.
- **Targeted 10G tests** (`gameRuleFacts`, `phase10gConsumers`, `manualDelivery`, `activity`, `dawnReview`, `phase10gGrimoire`, `phase10gTerminal`, `finishGame`): **149/149 across 8 files**. Every acceptance criterion 10G-AC-01..48 and every proof area 1–16 of Section 28 is named in these tests.
- **Firebase Rules / emulator suite** (`npm run test:rules`): **201/201 across 3 files, 0 skipped.**
- **Production build** (`npm run build`): PASS. The Vite chunk-size warning predates 10G: baseline `52e685b` main chunk 772.67 kB, now 805.40 kB.
- **Migration / checkpoint recovery:** the 39 test files that exercise store migration, entry migration, checkpoint envelopes, recovery or rehydration pass, **1128/1128**. This includes v24 → v25 of Current State, every Undo snapshot and checkpoint-style recovery (10G-AC-44), legacy oversized notes through migration (10G-AC-42), and unchanged structured deliveries (proof area 15).
- **Privacy:** the 35 test files that exercise Privacy Mode pass, **430/430**. This includes DOM absence of markers, the Rule-Fact strip, Activity and Dawn Review, the disabled Night → Day, and no new private bookkeeping in public/self projections (10G-AC-31, AC-46).
- **Responsive / narrow viewport:** jsdom tests cover the narrow overflow menu reaching Activity, Finish game and the Rule-Fact strip, plus target picking and the phone-only collapse. A real Chromium run at 360 and 390 px measured zero document overflow and no off-screen or overflowing dialog or panel for these surfaces: the Night panel with the Rule-Fact strip, target picking (the pick completes and the sheet returns), Dawn Review, Activity, the ended review and the ended participant view. The pre-existing ring overlap is recorded in §33.
- **`git diff --check`:** PASS for the worktree and for `52e685b..HEAD`.

No test was weakened. Expectation changes in existing tests follow the v25 bump and the new union shapes (version 24 → 25, unsupported markers moved to 26, v24 fixtures stripped of v25-only keys). The one allowlist addition is the reviewed presentation entry for `EndedParticipantReview.tsx` in the 10C Reminder guard (§33).

**Status: IMPLEMENTATION CHECKPOINT — not closed. Next: Luna mechanical verification of the exact HEAD.**


## 35. Astra adversarial review — Sol-accepted findings and bounded remediation — 2026-10-04

Astra's adversarial review of `681775d1726d5a6e9cc21480df1bff2f296af550` found four defects and one test-strength gap. Sol accepted all four findings and authorized a bounded remediation: no architecture change, no new feature, no schema bump above v25, no Firebase Rules change, no Phase 11 work. The remediation started from exactly `681775d` (8 ahead / 0 behind `main` `52e685b`, clean worktree, verified).

### Accepted findings

| ID | Severity | Contract | Defect |
| --- | --- | --- | --- |
| ASTRA-10G-001 | High | §§17.3, 17.5, 18; AC-35 | A Go Live continuation that outlived its game could `setLobby` onto an ended snapshot (ended + active lobby + writer); reload could restart the writer. `setLobby` did not refuse an ended game. |
| ASTRA-10G-002 | High | §§17.4, 18; AC-34, AC-37 | An ended game with a waiting player and an empty seat still rendered the queue; assignment could mutate players, participant identity and localSeq in the terminal snapshot. |
| ASTRA-10G-003 | Medium | §§4.2, 22; AC-01, AC-44 | `gameRuleFacts: z.array(...).default([])` silently repaired explicitly-v25 data missing the collection (History could say a fact applied while Current State denied it). |
| ASTRA-10G-004 | Medium | §§4, 6, 9, 22; AC-01, AC-10 | Recovered registered facts were not constrained to their registry lifetimes (e.g. Pit-Hag without expiry stayed active indefinitely). |
| Test gap | — | §§7, 10 | Dropping Rule Facts from hypothetical `assumingAlive` snapshots left the consumer suite green (no production defect). |

### Remediation

| Commit | Scope |
| --- | --- |
| `b7b77806b2c5fcda73ea14a6cb0aae7d4688ea78` | ASTRA-10G-003 and ASTRA-10G-004 (schema; shared registry module) |
| `b4b010011e15659aea84c210b43455538977aa1b` | Test gap (test-only) |
| `bd3b5c874dbf2b9c35f39441b83262eacaef921c` | ASTRA-10G-001 (Go Live, store, session startup) |
| `3fc38919dabd5310d1bf35011c6498174bbd8d9f` | ASTRA-10G-002 (queue UI and queue commands) |

**ASTRA-10G-001.** The invariant (an ended game never acquires or retains an active multiplayer scope) is enforced at each authority boundary:

- *Go Live continuation* (`GameScreen.goLive`) captures a page-local game-lifecycle token (`gameLifecycleToken()`, advanced by `newGame`, `endGame`, `finishGame`; not persisted). It revalidates after `connectFirebase` (an obsolete Go Live creates nothing) and again before adoption.
- *Superseded scope:* a lobby created for a game that is gone (finished, discarded or replaced) is closed through `closeSupersededLobby`. That uses the existing fenced `SessionWriter` start → close → dispose, now shared with the failed-start close (`closeScopeAuthoritatively`). It is never attached and never orphaned. A failed close is reported to the Storyteller.
- *Store:* `setLobby(non-null)` returns false and changes nothing for an ended game (detaching always works). `setPhase("ended")` is refused while a lobby is attached; Finish game remains the terminal path.
- *Writer startup:* `startStorytellerSession` refuses an ended local game before any lease, sync metadata or write. It never adopts an ended checkpoint game. `finishLive` (the single live transition, shared with reconnect-conflict resolution) refuses an ended game. A rehydrated ended game with a lobby therefore reports "Multiplayer is not live" (never silently live), and End multiplayer closes it authoritatively through the existing failed-start close.
- No second writer protocol, no rules change.

**ASTRA-10G-002.**
- The queue control and popup are not rendered in an ended game. An open popup unmounts when the game ends, and its open state resets.
- `assignPendingToSeat` refuses an ended game before any mutation. A stale popup, a captured action, or a multiplayer seating begun before Finish game therefore cannot complete locally, and `seatPlayerAndCommit` rolls its remote binding back as for any refused local commit.
- The queue's intake (`addToPendingQueue`) and reject (`removePendingPlayer`) are frozen in an ended game.
- No other legacy mutator was changed.

**ASTRA-10G-003.**
- `gameRuleFacts` is required (no default) in the persisted v25 game, covering Current State, every Undo snapshot and recovered checkpoints. A missing collection fails validation and is never reconstructed from History.
- Explicit v24 data still receives `[]` from migration.
- No production path decodes the sparse RTDB `storyteller` projection back into a game: recovery reads only the checkpoint, a JSON string leaf that preserves an empty array. So no wire normalization exists or was added, and local validation is not weakened.

**ASTRA-10G-004.**
- The registry (definitions plus the one expiry rule `registeredGameRuleFactExpiry`) moved to `src/stores/gameRuleFactRegistry.ts`. The planner and the persisted-game schema now share it.
- A stored registered fact must have been recorded in an applicable phase, and its `expiresAt` must equal the boundary its definition resolves. `pitHagArbitraryDeaths`: Night N → exactly Day N. `toymakerDemonSkipOccurred`: Night or Day, no expiry.
- This is checked in every phase, ended snapshots included: the ended moment is frozen, but a malformed lifetime is not made valid.
- Unregistered types gain no lifetime semantics.
- `gameRuleFacts.ts` re-exports the registry, so callers are unchanged.

### Regression tests

All new; each was run against the pre-remediation code.

- `src/firebase/phase10gAstraPersistence.test.ts` (37) — ASTRA-10G-003/004 through the schema, current-version rehydration of Current State and an Undo snapshot (the persist `merge` validator), and real checkpoint recovery (`startStorytellerSession` / `readCheckpoint`). It covers the missing collection (Current State, Undo, checkpoint), v24 migration adding `[]`, malformed present collections, no History reconstruction, the checkpoint round-trip as the intended wire path, and no sparse `storyteller` decode. The five malformed lifetimes are each tested in the schema, an ended snapshot, Current State, Undo and checkpoint. It also covers valid live and ended facts, unregistered types, and planner-produced facts round-tripping through local persistence and checkpoint recovery and expiring on rollover. **30 of 37 fail before the fix**; the 7 that pass are controls, migration, malformed-present, wire-path, unregistered-type and round-trip checks that did not depend on the defect.
- `src/abilities/characters/phase10gHypothetical.test.ts` (4) — the arbitrary-deaths fact survives alive, dead and nested `assumingAlive` overlays. A death attempt against a hypothetical working query still reaches the shared judgment, including Al-Hadikhia's second player after the first dies. A fact-less hypothetical snapshot makes the attempt deterministic (the discriminating contrast). **Mutation check:** with `assumingAlive` changed to drop `gameRuleFacts`, three of these fail while the existing consumer suite stays 18/18 green (Astra's observation reproduced). The mutation was then reverted.
- `src/features/game/phase10gGoLiveRace.test.tsx` (10) — real `GameScreen` Go Live with a gated in-memory backend: delayed `connectFirebase` → Finish game → continuation (nothing created); delayed lobby creation and delayed session acquisition → Finish game (lobby closed authoritatively: session `ended`, public `ended`, writer lease released; never attached). A replaced game (discard, then new setup) never receives the old lobby, and normal Go Live still works. It also covers `setLobby` refusing an ended game and `setPhase("ended")` refused with a lobby. Rehydrated ended + lobby: startup refuses with zero writes, and the session hook reports "not live", after which End multiplayer closes the lobby. An ended checkpoint game is never adopted. **9 of 10 fail before the fix** (normal Go Live is the control).
- `src/features/game/phase10gQueueFence.test.tsx` (7) — ordinary Day assignment is unchanged. The queue control is absent in ended. An open queue unmounts when Finish game lands. A direct or captured assignment, reject or intake after Finish changes nothing. A still-mounted popup's Assign click changes nothing. An in-flight multiplayer seating whose roster write is held open across Finish game cannot commit locally, and its binding is rolled back. After a successful live multiplayer Finish, no queued player can be seated. Each case checks players, participant identity, queue and localSeq. **6 of 7 fail before the fix** (ordinary assignment is the control).

Browser verification (Chromium, 1280 and 390 px, fixture built with the real store commands):
- Day game: the queue pill and popup work. With the popup open, Finish game unmounts it and removes the pill.
- After reload, the ended snapshot keeps its empty seat and waiting player and shows no Assign or Go live control.
- On a fresh live Day, Assign still seats the player.
- Go Live itself cannot be driven in this environment (no Firebase project or network). Its race is covered by the jsdom tests above, which use the real store, writer and in-memory backend.

### Gate

Run at `3fc38919dabd5310d1bf35011c6498174bbd8d9f`, clean worktree.

- Typecheck: PASS.
- Complete Vitest suite: **4184/4184 across 175 files**.
- All Phase 10G targeted tests (the eight implementation files plus the four Astra regression files): **207/207 across 12 files**. Astra regression alone: **58/58 across 4 files**.
- Firebase emulator suite: **201/201 across 3 files, 0 skipped.**
- Production build: PASS (main chunk 807.22 kB; the chunk-size warning predates 10G, §34).
- Migration / checkpoint-recovery group: **1175/1175 across 41 files.**
- Privacy group: **447/447 across 37 files.**
- Session / writer lifecycle (every non-SDK `src/firebase` unit test file) plus the game-screen tests: **842/842 across 47 files.**
- `git diff --check`: PASS for the worktree and `52e685b..HEAD`.

Diff scope `681775d..3fc3891`: 10 files, +962 / −76. Production: `GameScreen.tsx`, `storytellerSync.ts`, `storytellerStore.ts`, `schemas.ts`, `gameRuleFacts.ts`, and the new `gameRuleFactRegistry.ts`. Tests: the four new files above. No change to Firebase Rules, dependencies, schema version, or any area Astra found sound. No existing test was modified or weakened.

**Status: ASTRA REMEDIATION IMPLEMENTED — requires Luna targeted remediation verification. Phase 10G is not closed.**


## 36. Final Astra closure remediation — ASTRA-10G-R1-001 — 2026-10-04

Astra's closure review of the §35 remediation left one finding open; Sol accepted it. The remediation started from exactly `dab10913fc07a43f12aab3a353624a5b1085aa26` (13 ahead / 0 behind `main` `52e685b`, clean worktree, verified). No closed finding was reopened, and the ASTRA-10G-001 authority invariant is unchanged.

### ASTRA-10G-R1-001 — Medium — cleanup failure invisible after GameScreen navigation/unmount

If the authoritative close of a superseded Go Live lobby (ASTRA-10G-001) itself failed, the remote lobby could stay active while the local game correctly stayed detached. GameScreen reported the failure through its component-local `setGoLiveError`. When Finish game, Home or New Game had already unmounted GameScreen, that warning was never seen, leaving no visible trace of the open lobby or its room code.

Reporting invariant (Sol): if cleanup of a superseded lobby fails, the Storyteller keeps a visible warning identifying that lobby across ordinary Storyteller navigation until it is explicitly dismissed. This is runtime/UI state only, never Current State, persisted, checkpoint or reconnect-authority state.

### Remediation — `7add7c661e43349634e0b6717d7c05ee18a31957`

- **Where the warning lives:** a dedicated field on the existing page-global multiplayer runtime, `useSessionRuntime.unattachedCleanupFailures` (`src/firebase/storytellerSync.ts`). Each entry holds `{ code, message }`: the lobby code and a fixed, bounded message with the formatted room code. It never holds an Error object. `useSessionRuntime` is a plain, unpersisted zustand store (it is not the persisted Storyteller store), so the entry is never written to localStorage, Firebase or a checkpoint. It is not the current lobby: it is never attached, never starts a StorytellerSession or writer, never enters reconnect state, and never sets lobby metadata.
- **Capture:** `closeSupersededLobby` records the entry itself when the fenced close fails, then rethrows. The obsolete lobby is still never attached and no writer starts. GameScreen keeps only the console diagnostic and no longer reports this case in its own state.
- **Why navigation cannot erase it:** the runtime outlives every screen, and every existing reset (the StorytellerSession no-lobby reset, `useStorytellerSync` startup and cleanup, and the per-source error ownership) is a partial `setState` of named fields that never includes this one. Starting a later valid session does not clear it. The only remover is `dismissUnattachedCleanupFailure(code)`.
- **Where it renders:** `UnattachedLobbyWarnings` (`src/firebase/StorytellerSession.tsx`), rendered by the App shell (`src/app/App.tsx`) above the Storyteller views. It therefore spans Home, New Game and the game/review screen. It is a `role="alert"` naming the room code and stating that a lobby may still be open and the current game is not connected to it, with one Dismiss action that removes only that entry.
- **Unchanged:** ordinary current-game Go Live errors keep the existing game-screen path. No change to Firebase Rules, schema, the Game Rule Fact model, membership, the session writer protocol, character semantics or projections.

### Regression tests — `src/app/phase10gUnattachedLobby.test.tsx` (6, rendered through the real `App` shell)

- **R1-001-A, Finish → Home:** Go Live; remote lobby created; session acquisition held before adoption; Finish game; ← Home (GameScreen gone); resume with the cleanup's lease acquisition failing. Proves the ended game stays detached (no lobby, code unchanged), no writer ever held a lease or projected, the remote session is still active (cleanup really failed), and Home shows the alert with the formatted room code. The alert survives returning to the review and Home again.
- **R1-001-B, Home → New Game:** Go Live on Game A, held after remote creation; ← Home → New Game → Create setup (Game B); resume with cleanup failing. Proves Game B is untouched and has no lobby, no old writer ever held a lease, and the alert shows the old room code across Home and Game B. A later valid Go Live for Game B starts a real live session, and the old lobby's alert is still shown.
- **Controls:** a successful superseded cleanup creates no warning. Dismiss removes only the dismissed lobby's entry and changes no game, lobby, localSeq or session status. An ordinary Go Live error creates no unattached-lobby warning. The warning is never persisted with the Storyteller state.
- **Proof against regression:** restoring the component-local behavior (GameScreen `setGoLiveError` instead of the global capture) fails both navigation regressions. The pre-remediation production files (`dab1091`) fail R1-001-A, R1-001-B and the Dismiss control.
- **Browser check** (Chromium, 390 and 1280 px; runtime state set by importing the same dev-server module instance): the alert is visible at the top of Home, the game screen and New Game, covers no control, causes no horizontal overflow, and Dismiss removes it. On the game screen (a fixed 100dvh layout) the page scrolls vertically by the alert's height (58 px desktop, 109 px phone) until it is dismissed.

### Gate

Run at `7add7c661e43349634e0b6717d7c05ee18a31957`, clean worktree.

- Typecheck: PASS.
- R1-001 regressions: **6/6**.
- `phase10gGoLiveRace.test.tsx`: **10/10**.
- The four earlier Astra regression files: **58/58** (ASTRA-10G-001…004 and the hypothetical-query test stay closed).
- All Phase 10G tests (13 files): **213/213**.
- App / GameScreen / session runtime (every non-SDK `src/firebase` unit test file, plus the `src/features/game`, `src/app` and New Game screen tests): **880/880 across 49 files**.
- Complete Vitest suite: **4190/4190 across 176 files**.
- Production build: PASS.
- Firebase emulator suite: **201/201 across 3 files, 0 skipped**.
- `git diff --check`: PASS for the worktree and `52e685b..HEAD`.

Diff scope `dab1091..7add7c6`: 5 files, +295 / −7. Production: `src/app/App.tsx`, `src/features/game/GameScreen.tsx`, `src/firebase/StorytellerSession.tsx`, `src/firebase/storytellerSync.ts`. Test: `src/app/phase10gUnattachedLobby.test.tsx`. No existing test was modified or weakened.

**Status: FINAL ASTRA CLEANUP-FAILURE REMEDIATION IMPLEMENTED — targeted verification pending. Phase 10G is not closed.**


## 37. Phase 10G closure and integration — CLOSED AND INTEGRATED — 2026-10-04

### Final integration

- Phase 10G starting checkpoint: `52e685b16e76df15154512a52a34831a6aeba399`
- Final reviewed branch checkpoint: `2aabccbb925183c2359bef5d48a2ee5cca2dfd03` (`dev/phase-10g`)
- Final production checkpoint: `7add7c661e43349634e0b6717d7c05ee18a31957`
- Integration method: fast-forward only. `main` moved from `52e685b16e76df15154512a52a34831a6aeba399` to exactly `2aabccbb925183c2359bef5d48a2ee5cca2dfd03`, with no merge commit, squash, rebase or cherry-pick.
- Pre-integration relationship: `dev/phase-10g` 15 ahead / 0 behind `main`, merge base exactly `52e685b16e76df15154512a52a34831a6aeba399`, clean worktree. Verified before the merge.
- After the fast-forward: `main`, `origin/main`, `dev/phase-10g` and `origin/dev/phase-10g` all resolved to `2aabccbb925183c2359bef5d48a2ee5cca2dfd03`, the branch and `main` trees were identical, and `git diff --check` passed.
- Closure record: this section, the roadmap and the handoff were added by one documentation-only commit directly on top of `2aabccbb925183c2359bef5d48a2ee5cca2dfd03`. The production tree at that commit is byte-identical to the reviewed tree. `dev/phase-10g` is kept at the reviewed checkpoint as a stable historical reference.
- Schema/store: v25.
- Firebase Rules: unchanged in Phase 10G, so no rules deployment is required for this integration.

### Review chain

1. Opus architecture challenge.
2. Sol architecture adjudication and frozen implementation contract (§§1–32).
3. Claude Code initial implementation (§§33–34).
4. Luna mechanical verification — PASS.
5. Astra adversarial review — four findings (§35).
6. Claude bounded remediation (§35).
7. Luna targeted remediation verification — PASS.
8. Astra targeted closure review — one remaining finding, ASTRA-10G-R1-001 (§36).
9. Claude final bounded remediation (§36).
10. Luna R1-001 targeted verification — PASS.
11. Astra final closure confirmation — PASS — READY FOR SOL CLOSURE ADJUDICATION.
12. Sol final adjudication — APPROVE.

### Luna final evidence

- Full Vitest: **4,190 / 4,190**
- Phase 10G tests: **213 / 213**
- Firebase emulator: **201 / 201**, zero skipped
- Typecheck: PASS
- Production build: PASS
- Diff checks: PASS

### Astra final closure

**PASS — READY FOR SOL CLOSURE ADJUDICATION**

- ASTRA-10G-001 — CLOSED
- ASTRA-10G-002 — CLOSED
- ASTRA-10G-003 — CLOSED
- ASTRA-10G-004 — CLOSED
- Hypothetical-query coverage gap — CLOSED
- ASTRA-10G-R1-001 — CLOSED

### Sol verdict

**APPROVE — PHASE 10G CLOSED AND INTEGRATED**

No Phase 10G blockers remain. Phase 10G is the final Phase 10 slice, so **Phase 10 is complete**.

### Deferred for later work (not Phase 10G blockers)

- store-wide E1 precommit generalization;
- localStorage quota transaction/recovery;
- dynamic Undo trimming;
- broader persistence-health monitoring;
- winner/result modeling, if ever separately authorized.

### Next

Phase 11 architecture/scope challenge for canonical character coverage, built on the completed Phase 10 authority/workflow foundation. No Phase 11 code has been written.

### Post-closure roadmap amendment — 2026-10-04

After Phase 10G was already closed and integrated, the roadmap was amended to insert **Phase 10H — Storyteller UI/UX & Visual Design System** before Phase 11. This amendment does not reopen 10G or change any 10G acceptance evidence. Phase 11 canonical coverage remains unchanged in scope and is now sequenced after 10H closes. See `PHASE10H.md`, `docs/ai/MASTER_IMPLEMENTATION_PLAN.md`, and the current handoff.
