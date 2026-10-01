# Phase 10E — Alignment Transitions

Status: **CLOSED — READY FOR INTEGRATION.** Store/game schema **v23** (`GAME_SCHEMA_VERSION = 23`, `STORE_VERSION = 23`).  
Decision date: **2026-10-01**  
Starting repository checkpoint: **b170d3d448a4b035a273443894611e69cf882c10**  
Starting branch: **dev/phase-10e**  
Starting schema/store: **v22**  
Final schema/store: **v23**

Final reviewed implementation checkpoint (before docs-only closure metadata):  
`f978c366ab18fffb873b7ea150c1b3ec69e8f71b`.

This document is the Sol implementation contract for Phase 10E. It incorporates the independent Opus 5.5 architecture challenge, the targeted Traveler-perception follow-up, the BOTC rules review, Sol adjudication, and project-owner approval. Implementation begins from the commit containing this frozen contract, not from an older Phase 10D checkpoint.

## 1. Objective

Phase 10E establishes one safe, participant-bound Alignment primitive for Silverwick Hollow.

It must support:

- Actual Alignment as authoritative Current State;
- gameplay Alignment changes and Storyteller corrections as distinct semantic operations;
- atomic multi-participant Alignment resolution;
- History/provenance sufficient to explain live changes;
- explicit player-facing alignment perception without conflating it with truth;
- the normal BOTC rule that players ordinarily know their alignment while still representing legitimate exceptional mechanics that withhold or misstate it;
- ordinary and Traveler workflows through one coherent model;
- migration, Undo, recovery, privacy and stale-identity safety;
- a future Phase 10F coordinator that can consume already-resolved Alignment intents without Phase 10E implementing character abilities.

Phase 10E does not evaluate character abilities.

## 2. Preserved project invariants

The following remain load-bearing:

- Storyteller is the authoritative writer.
- Current State means what is true now.
- History means what changed and never reconstructs Current State.
- Information Delivery means what was actually communicated and is never rewritten merely because Current State changes.
- PlayerId is a reusable seat address.
- ParticipantId identifies one continuous participation instance and is never reused.
- ParticipantRef is durable historical identity.
- Actual Role and Actual Alignment are independent.
- Shown Role / alignment perception are distinct from actual truth.
- Role changes never infer Alignment changes.
- Alignment changes never infer Role changes.
- Public/private/self projections remain allowlisted and fail closed.
- Life, Effects, Reminders, Role and Alignment stay separate authoritative domains unless a later coordinator explicitly composes their plans.
- Routine Storyteller operation stays low-friction; exceptional controls use progressive disclosure.
- No player-authoritative game-state path is added.
- No full ability engine is added.

## 3. Frozen Alignment state model

### 3.1 Actual Alignment

Actual Alignment remains:

- good
- evil
- absent / unresolved

The persisted field remains actualAlignment.

Absent means Silverwick does not currently have an authoritative Good/Evil answer. It is never guessed.

A live/general Alignment intent may transition FROM unresolved to Good/Evil, but Phase 10E does not add a live destination that clears Actual Alignment back to unresolved.

Setup-specific construction may continue to create or clear initial state according to existing Setup rules.

### 3.2 Player-facing alignment perception

The persisted shownAlignment field expands in v23 from:

- good
- evil
- null

to:

- good
- evil
- undisclosed
- null

The sentinel undisclosed is perception only. It is never a possible Actual Alignment.

Semantics are:

| Stored shownAlignment | Ordinary participant self view | Traveler self view |
|---|---|---|
| null | derive alignment from valid Shown Role | show current Actual Alignment; omit alignment while Actual is unresolved |
| good | explicitly show Good | explicitly show Good |
| evil | explicitly show Evil | explicitly show Evil |
| undisclosed | show valid Shown Role but omit alignment | show Traveler character but omit alignment |

This is the smallest complete vocabulary needed to distinguish:

- normal disclosure;
- explicit Good;
- explicit Evil;
- deliberately not disclosed.

It is an explicit amendment to Phase 10D interpretation 3. Traveler shownAlignment is no longer inert after v23; null preserves the normal automatic mirror.

### 3.3 Ownership

Phase 10E does NOT create a second perception writer.

Phase 10D setPerception remains the authoritative live/general owner of:

- shownRole;
- shownAlignment;
- behaviorMode.

Phase 10E is authorized to extend that existing perception seam and schemas so shownAlignment accepts undisclosed and projection/validation support its frozen semantics.

The new Alignment seam writes Actual Alignment and Alignment-specific Traveler cleanup only. It never writes shownAlignment.

### 3.4 Normal BOTC disclosure versus exceptions

Normal behavior must remain easy:

- an ordinary participant with shownAlignment null derives alignment from their Shown Role;
- a Traveler with shownAlignment null automatically sees their Actual Alignment;
- no extra "copy Actual to shown" action exists.

Exceptional mechanics may later choose explicit Good, Evil or undisclosed through the perception seam.

Phase 10E provides the representation only. It does not decide that Ogre, Tor, Lunatic, Marionette, a homebrew character, or any other mechanic should select a particular perception state.

## 4. Authoritative Alignment mutation seam

Add one pure Alignment planner/apply boundary, following the established Phase 10B–10D pattern:

AlignmentIntent[] -> planAlignmentTransaction -> AlignmentPlan | true no-op | structured refusal -> applyAlignmentPlan -> resolveAlignments -> one authoritative game replacement.

Recommended module: src/stores/alignmentResolution.ts.

The exact exported names may follow repository conventions, but there must be one authoritative Alignment planning seam and one store commit seam.

## 5. Alignment intents

Exactly two Actual Alignment intent kinds are authorized:

### changeActualAlignment

A real gameplay change in Actual Alignment.

Required target/binding data:

- playerId;
- participantId;
- expectedActualAlignment, where null means the field was absent/unresolved;
- expectedIsTraveler;
- destination actualAlignment: good or evil.

### correctActualAlignment

Repairs Silverwick's recorded Actual Alignment rather than representing a gameplay event.

It carries the same target/binding and destination fields.

During Live Play its Alignment History carries correction: true.

A correction changes Current State to the same final truth a gameplay change would. The semantic difference is explanatory History, not a different truth model.

## 6. Binding and stale safety

Every intent is bound to:

- PlayerId;
- ParticipantId;
- the Actual Alignment the caller observed;
- the ordinary-vs-Traveler status the caller observed.

If the participant moved, the seat was reused, Actual Alignment changed, or Traveler status changed, the transaction returns stale and nothing changes.

Do not bind the Alignment intent to Actual Role. Role and Alignment are independent.

An empty seat or nonexistent seat cannot be an Alignment target.

A new participant must never inherit Actual Alignment from a reusable empty-seat record.

## 7. Transaction semantics

- Multiple participants may change atomically.
- All intents are validated before the store commits anything.
- Any refusal means no participant changes.
- At most one Actual Alignment intent per ParticipantId per transaction.
- A second intent for the same ParticipantId is conflict, even if the first would be a no-op.
- Gameplay Actual Alignment intents and correction Actual Alignment intents do not mix in one transaction; mixing is mixedCorrection.
- A completely net-zero transaction produces no History, Undo entry, localSeq change, packet invalidation or other side effect.
- There is no same-participant A -> B -> C ordering primitive in 10E.
- Phase 10E does not define a universal cross-domain ordering with Role/Life/Effect/Reminder plans.
- A future 10F coordinator may plan/apply domain plans against an evolving working snapshot and commit the composed final result once.

A transaction must be bounded to the maximum supported participant population; do not permit unbounded intent arrays.

## 8. Runtime input hardening

Carry forward the mature hostile-input rules from Phase 10D:

- transaction and intent values must be plain objects;
- sparse arrays are refused and identify the offending index where useful;
- kind must be an own string property before discriminator lookup;
- inherited properties never satisfy required fields;
- unknown keys are refused by presence, including keys whose value is undefined;
- Mutation Context uses the strict runtime schema;
- player maps use own-property lookups;
- empty/oversized transactions are refused;
- malformed input returns a structured refusal and never throws;
- nothing partially applies.

Required refusal codes:

- invalid
- phase
- notSeated
- stale
- conflict
- mixedCorrection
- tooMany

Additional internal detail may exist, but UI-facing refusal copy must remain concise and must not disclose hidden alignment values.

## 9. Phase boundaries

| Lifecycle | Gameplay Alignment change | Alignment correction | History |
|---|---|---|---|
| Setup before initial Reveal | allowed; existing Setup construction remains separate | allowed | none |
| After Reveal, before Night 1 | refused, except an unresolved Traveler may receive their initial Good/Evil alignment | allowed | none |
| Night / Day | allowed | allowed | yes |
| Ended | refused | refused | none |

Existing Deal / Shuffle / Swap / Manual Override / Edit Bag behavior remains Setup-specific.

For ordinary Setup construction, fresh/dealt identity may continue deriving initial Actual Alignment from the dealt Role.

Traveler character assignment never infers Actual Alignment.

A legitimate special starting alignment should be established during Setup; if the committed starting record is discovered to be wrong after Reveal, use correction rather than pretending a gameplay event occurred.

## 10. Traveler Current State and private-information behavior

A Traveler uses the same Actual Alignment seam as every other participant.

Whenever a genuine Actual Alignment change is committed for a Traveler, gameplay or correction:

1. Actual Alignment changes.
2. Any published private packet is withdrawn.
3. A fresh packet epoch is minted.
4. privateInfo.travelerDemon is removed if present.
5. Other privateInfo fields are preserved unless an existing independent perception rule makes them inapplicable.
6. travelerArrival is NEVER created merely because Alignment changed.
7. Existing travelerArrival fields, including demonInfoComplete, firstNightComplete and arrivalCheckComplete, are preserved.
8. Information Delivery records are untouched.
9. Night progress is untouched.
10. Role, Life, Effects, Reminders and public Traveler character are untouched.

Packet invalidation is required on the raw Actual Alignment change even when an explicit perception override means the visible alignment label does not change, because the packet may contain alignment-dependent Traveler information.

The app must not pretend a player forgot information already delivered. demonInfoComplete records prior completion and is not reset simply because Actual Alignment changes.

Existing Traveler guidance may continue to read Actual Alignment and completion state as advisory Current State. Phase 10E does not decide every ability-specific entitlement to new Demon information; that belongs to 10F / Storyteller judgment.

## 11. Alignment History and provenance

Only Actual Alignment mutations write Alignment History.

Live gameplay change:

- category: alignment;
- change kind: value;
- from: either empty object for unresolved or exactly { actualAlignment: good|evil };
- to: exactly { actualAlignment: good|evil };
- ParticipantRef;
- live Game Moment;
- optional provenance;
- optional transaction resolutionId.

Live correction is identical plus correction: true.

Setup mutations write no History.

Perception-only changes write no Alignment History.

Information Delivery is never rewritten.

Legacy pre-v23 Alignment History is preserved byte-for-byte and is never rewritten into the new strict shape.

For v23-shaped Alignment History carrying correction or resolutionId, schema validation must require the strict Alignment snapshot shapes above.

## 12. v23 schema and migration

Phase 10E advances both GAME_SCHEMA_VERSION and STORE_VERSION to 23.

v22 -> v23 is a small real migration, not stamp-only.

For every migrated game entry:

- if a player is a Traveler and v22 carries shownAlignment good or evil, normalize shownAlignment to null;
- do not copy Actual Alignment into shownAlignment;
- do not change ordinary participants' shownAlignment;
- do not alter Actual Alignment;
- do not alter Role, Life, Effects, Reminders, arrival completion, Information Delivery or History;
- do not invent undisclosed;
- then stamp v23 only when the entry is otherwise valid for the step.

Rationale: v22 Traveler explicit Good/Evil values are inert historical leftovers. Honoring them in v23 would revive stale values and change what existing players see. Normalizing them to null preserves the behavior actually delivered by v22: Traveler self projection followed Actual Alignment.

The same migrateGameEntry path must cover:

- Current State;
- every Undo snapshot;
- remote checkpoint recovery.

### v23 evidence

hasV23Evidence must include at least:

- any persisted shownAlignment equal to undisclosed;
- any Alignment History record carrying correction;
- any Alignment History record carrying resolutionId.

v23 evidence detection must run before v22/v21/v20/v19 heuristics because correction and resolutionId overlap older generic evidence keys.

An older marker combined with v23-only evidence is rejected unrepaired.

Marker-less v23 evidence is rejected rather than legacy-repaired.

A legitimate v22 Traveler with stored good/evil shownAlignment is NOT v23 evidence; it must be eligible for the normalization step.

Unsupported/newer markers remain rejected.

## 13. Self/public projection contract

### Public

No alignment field is added to public projection. Actual Alignment and player-facing alignment remain non-public.

### Self

Player self projection must support a valid identity with alignment omitted for BOTH ordinary participants and Travelers when shownAlignment is undisclosed.

The undisclosed sentinel itself must never be sent to the player. Projection expresses it by omitting the alignment field.

Therefore the player self wire/schema/decoder/UI must distinguish:

- no valid/revealed identity -> WAITING / no identity;
- valid shown identity with alignment omitted -> show the character but no alignment label.

Do not continue treating "ordinary identity with no alignment field" as equivalent to WAITING once v23 undisclosed is implemented.

Unsafe/unknown Shown Roles still fail closed exactly as Phase 10D requires; undisclosed never makes an unsafe Shown Role projectable.

Actual Alignment is never used as a fallback for an ordinary participant.

Traveler null/default projection mirrors Actual Alignment; explicit good/evil overrides and undisclosed are honored.

## 14. Perception seam amendment

Extend the existing Phase 10D setPerception intent, validation and wrappers to admit the v23 shownAlignment domain.

Preserve all existing stale binding, partial-field planning, packet invalidation, behavior-mode and Role validation rules.

A perception change that changes the effective self identity/alignment remains a perception mutation and may invalidate the existing private packet under the established Phase 10D rules.

Do not reintroduce the historical "Show alignment to Traveler" copy action.

Do not auto-copy Actual Alignment into shownAlignment.

## 15. Storyteller UI

### Actual Alignment

Every occupied participant gets a Storyteller-private Actual Alignment surface in the Player Drawer:

- current state: Good / Evil / Unresolved;
- Good and Evil actions;
- normal action means gameplay change where that lifecycle allows it;
- progressively disclosed "Correct the recorded alignment..." action means correction.

The UI must construct render-bound intents from the ParticipantId, Actual Alignment and Traveler status it rendered. A stale response is shown inline and changes nothing.

### Player-facing alignment

The existing perception controls are extended to make the v23 semantics understandable:

- Normal;
- Shown Good;
- Shown Evil;
- Not told.

Normal means:
- ordinary -> derive from Shown Role;
- Traveler -> follow Actual Alignment.

Exceptional choices are progressively disclosed.

The Storyteller-only "View overridden" indicator is semantic, not a raw-storage warning:
- show it when the current effective player-facing alignment differs from what Normal would currently produce;
- always show it for an explicit undisclosed / Not told state;
- do NOT show it merely because shownAlignment stores an explicit Good/Evil value that is currently identical to Normal.
Do not rewrite or normalize an ordinary participant's stored explicit Good/Evil merely to suppress the cue. If Normal later changes and that explicit value becomes meaningfully different, the cue appears then.

For an ordinary participant, when a GAMEPLAY Actual Alignment change leaves the effective player-facing alignment different from the new Actual Alignment, surface a concise advisory cue that the player view differs and link/direct the Storyteller to the existing perception control. A correction must not arm this advisory automatically: correction repairs Silverwick's record and does not itself establish that the player experienced a new alignment change. Do not automatically decide whether a mechanic requires disclosure.

Traveler arrival UI uses the same Alignment seam for Actual Alignment and the same perception seam for player-facing alignment. No Traveler-only Actual Alignment writer remains authoritative.

Privacy Mode must suppress private Alignment/perception controls, values, badges and refusal detail according to existing project patterns.

## 16. Compatibility adapters and writer audit

setActualAlignment and setTravelerAlignment become compatibility adapters over the new authoritative Alignment seam.

- New render-bound UI must call the participant-bound seam directly rather than relying on PlayerId-only wrappers.
- setActualAlignment targets the participant occupying that PlayerId at call time and supplies its observed binding.
- setTravelerAlignment remains Traveler-only compatibility behavior but routes through the same planner.
- The two adapters may return the structured Alignment command result; callers may ignore it.
- No live/general writer may bypass resolveAlignments for Actual Alignment.

Narrow non-live writers remain permitted:

- Setup construction / dealt identity;
- setIsTraveler Setup reset behavior;
- constructors / occupancy;
- migration;
- whole-snapshot Undo/recovery.

Add an architecture guard comparable to Role/Reminder/Effect guards so new direct live Actual Alignment writes are caught.

## 17. Participation-boundary hardening

occupySeat and every path that creates a new participation instance through it must explicitly ensure the new participant starts with Actual Alignment unresolved, regardless of stale/malformed alignment data carried by the reusable empty seat.

This includes normal seating, planned-seat fill, pending-player seating and recovery seating that creates/restores a participation into an empty reusable seat.

Do not add a persisted-schema invariant that rejects an otherwise loadable empty seat merely because legacy state carries actualAlignment. Harden the occupancy boundary instead.

Whole-snapshot recovery of an already-occupied participant remains authoritative and is not rewritten as a new participation.

## 18. Undo, recovery, sync and Firebase authority

An accepted Alignment transaction commits:

- one Current State replacement;
- one Undo entry;
- one localSeq advancement;
- all Alignment History produced by that transaction.

A refusal or true no-op commits nothing.

Undo restores the whole pre-transaction snapshot, including:

- Actual Alignment;
- perception state;
- packet/draft state;
- History;
- Traveler state.

Remote checkpoint recovery continues through the existing migration/validation path. No Alignment-specific recovery subsystem is added.

No new remote path, player-authoritative write path or writer-fencing mechanism is expected.

Phase 10E is not authorized to change Firebase authority semantics. If implementation discovers that a Firebase Rules change is genuinely required, stop and return that design conflict to Sol instead of silently broadening scope.

## 19. 10F composition boundary

Phase 10E must expose a pure, reusable Alignment planner that can operate against a valid working snapshot without importing character/ability logic.

A future 10F coordinator may use it for already-resolved outcomes such as a multi-participant alignment swap.

10E does NOT implement:

- Snake Charmer;
- Cult Leader;
- Goon;
- Ogre;
- Mezepheles;
- Politician;
- Bounty Hunter setup logic beyond preserving current setup behavior;
- Tor;
- Lunatic;
- Marionette;
- any generic ability parser/evaluator;
- cross-domain automatic order selection.

Those names are architecture test cases only.

## 20. Explicit non-goals

Do not add:

- nominations/voting;
- automatic alignment decisions from Role type during live play;
- full ability resolution;
- a second perception writer;
- a parallel History/recovery model;
- a new public alignment path;
- a new player-authoritative mutation path;
- a universal Rule/Alignment cross-domain coordinator;
- speculative alignment clearing during live play;
- automatic rewriting of Information Delivery;
- automatic forgetting/regranting of Traveler information;
- unrelated refactors or visual redesign.

## 21. Acceptance criteria

### Alignment primitive

**10E-AC-01 — Ordinary gameplay change**  
In Live Play, an ordinary participant changes Good -> Evil through changeActualAlignment. Actual Role, shown perception, Life, Effects and Reminders are unchanged. Exactly one Alignment History record, one Undo entry and one localSeq advancement result.

**10E-AC-02 — Correction**  
A Live correction changes the same Current State field but History carries correction: true. Current State side effects are otherwise the same as a gameplay change for the same starting participant state.

**10E-AC-03 — Unresolved origin**  
An unresolved participant may be assigned Good/Evil where the lifecycle permits it. History from unresolved uses the canonical empty from snapshot when Live.

**10E-AC-04 — Seat reuse**  
An intent bound to Alice's ParticipantId, submitted after the PlayerId is reused by Bob, returns stale. Bob, History, Undo and localSeq are unchanged.

**10E-AC-05 — Expected-state stale checks**  
A mismatch in expectedActualAlignment or expectedIsTraveler returns stale and the whole transaction changes nothing.

**10E-AC-06 — Atomic multi-participant resolution**  
Two participants may change alignment in one transaction. If either intent refuses, neither applies. Success creates one Undo entry and one localSeq advancement.

**10E-AC-07 — Duplicate target conflict**  
A second Actual Alignment intent for one ParticipantId returns conflict, even if the first would be a no-op.

**10E-AC-08 — Mixed semantic conflict**  
Gameplay and correction Actual Alignment intents in the same transaction return mixedCorrection.

**10E-AC-09 — True no-op**  
Setting the current Actual Alignment produces no History, Undo, localSeq, packet epoch or other side effect.

**10E-AC-10 — Role independence**  
Every 10D Role change/correction preserves Actual Alignment, and an Alignment transaction never changes Actual Role or ordinary-vs-Traveler status.

### Perception

**10E-AC-11 — Ordinary Normal**  
For a valid ordinary Shown Role and shownAlignment null, self projection derives alignment from the Shown Role exactly as before.

**10E-AC-12 — Traveler Normal**  
For a Traveler with shownAlignment null, self projection follows current Actual Alignment and omits alignment while Actual is unresolved.

**10E-AC-13 — Explicit overrides**  
Explicit Good/Evil shownAlignment is honored for both ordinary participants and Travelers regardless of Actual Alignment.

**10E-AC-14 — Undisclosed**  
For a valid shown identity with shownAlignment undisclosed, both ordinary and Traveler self projection show the character while omitting alignment. The player never receives the literal sentinel.

**10E-AC-15 — Ordinary undisclosed wire behavior**  
An ordinary self record with valid Shown Role but omitted alignment is rendered as that identity without an alignment label, not as WAITING.

**10E-AC-16 — No actual fallback for ordinary perception**  
An ordinary participant's Actual Alignment is never used to fill an omitted/unsafe ordinary self alignment.

### Traveler safety

**10E-AC-17 — Traveler raw Actual change invalidates packet**  
A genuine Traveler Actual Alignment change withdraws any published packet and mints a new epoch even when an explicit Good/Evil/undisclosed override leaves the visible alignment unchanged.

**10E-AC-18 — Traveler draft cleanup**  
A genuine Traveler Actual Alignment change removes privateInfo.travelerDemon but preserves unrelated draft fields.

**10E-AC-19 — Traveler completion/history preservation**  
Alignment change never creates travelerArrival, never resets existing demonInfoComplete/firstNightComplete/arrivalCheckComplete, and never rewrites Information Delivery.

### Lifecycle

**10E-AC-20 — Setup before Reveal**  
Existing Deal/refinement behavior remains. Alignment seam changes/corrections before Reveal write no History.

**10E-AC-21 — Post-Reveal pre-Night1**  
Gameplay Alignment change is refused except resolving an unresolved Traveler's starting alignment. Corrections are allowed. No History is written.

**10E-AC-22 — Ended**  
Every Alignment intent and compatibility adapter refuses an Ended snapshot without mutation.

### History / provenance

**10E-AC-23 — Strict v23 Alignment History**  
An Alignment record carrying correction or resolutionId has only the approved strict Actual Alignment snapshot shapes.

**10E-AC-24 — Provenance**  
Valid Mutation Context provenance is stored as durable ParticipantRef. Invalid/unresolvable required source participation refuses the transaction according to existing provenance rules.

**10E-AC-25 — Correlation**  
A valid transaction resolutionId is copied to every Alignment History record it produces; empty/oversized ids are refused by the shared contract.

**10E-AC-26 — Legacy History**  
Pre-v23 Alignment History survives migration unchanged and is not rewritten into v23 strict snapshots.

### v23 migration

**10E-AC-27 — Traveler normalization**  
Migrating a v22 Traveler with stored shownAlignment Good/Evil changes that field to null and changes no Actual Alignment, Role, History, Information Delivery, arrival completion or other state.

**10E-AC-28 — No copy from Actual**  
The v22->v23 migration never copies Actual Alignment into shownAlignment.

**10E-AC-29 — Per-entry migration**  
Current State, each Undo entry and remote checkpoint game migrate independently through migrateGameEntry.

**10E-AC-30 — Evidence ordering**  
Alignment correction/resolution metadata or shownAlignment undisclosed is detected as v23 evidence before older heuristics. Older markers carrying v23 evidence and marker-less v23 evidence are rejected unrepaired.

**10E-AC-31 — Legitimate v22 stale Traveler values are migratable**  
Traveler shownAlignment Good/Evil under marker 22 is not considered v23 evidence and is normalized rather than rejected.

**10E-AC-32 — Persisted round-trip**  
A valid v23 game containing undisclosed perception and correlated/correction Alignment History round-trips through persisted schema/local storage.

### Participation / recovery / privacy

**10E-AC-33 — New participation starts unresolved**  
A stale Actual Alignment on an empty reusable seat is never inherited by a newly occupied participation instance. Legacy empty-seat state remains loadable.

**10E-AC-34 — Undo**  
Undo of an Alignment transaction restores Current State, packet/draft, History and perception-related state exactly to the pre-transaction snapshot.

**10E-AC-35 — Remote recovery**  
v23 checkpoint recovery restores through the existing recovery/fencing path; no parallel authority is created.

**10E-AC-36 — Privacy/public leakage**  
Public projection contains no alignment. Storyteller-private Actual Alignment and override controls disappear under Privacy Mode. Self projection contains only the allowed shown identity/alignment result; never Actual Alignment metadata, ParticipantId, History or drafts.

**10E-AC-37 — Malformed runtime input**  
Sparse arrays, inherited kind, unknown keys, invalid bindings and malformed transactions return structured refusals and never throw or partially mutate.

**10E-AC-38 — Compatibility adapters**  
Both legacy Alignment setters route through the new seam. New render-bound UI does not rely on PlayerId-only mutation.

**10E-AC-39 — Architecture guard**  
Tests prove no unauthorized live/general Actual Alignment writer bypasses the Alignment seam and perception remains owned by the Phase 10D seam.

### UI / future composition

**10E-AC-40 — Storyteller UI**  
Player Drawer and Traveler arrival flows expose Actual Alignment truth separately from player-facing alignment perception, with normal actions low-friction and correction/override controls progressively disclosed.

**10E-AC-41 — Override visibility**  
The Storyteller-only override cue reflects a meaningful departure from Normal, not merely non-null storage. Show it when effective player-facing alignment differs from what Normal would currently produce, and always for undisclosed / Not told. An explicit Good/Evil value currently identical to Normal does not show the cue; if Normal later changes and the stored explicit value diverges, the cue then appears. Normal remains the default and needs no extra action.

**10E-AC-42 — Future-engine seam**  
The Alignment planner imports no character ability evaluation and accepts a valid evolving working snapshot so a later 10F coordinator can compose already-resolved domain plans before one authoritative commit.

## 22. Required implementation evidence

Before handing the implementation to Luna:

1. Verify exact starting branch/commit and clean worktree.
2. Implement only this frozen contract.
3. Add focused unit/integration tests for every applicable AC above.
4. Run typecheck.
5. Run the complete normal test suite.
6. Run the complete Firebase emulator/rules suite, even if no Rules file changes.
7. Run the production build.
8. Run git diff --check.
9. Inspect the final diff for unrelated changes and weakened safeguards.
10. Record exact test counts/skips and the exact review checkpoint SHA.
11. End with a clean worktree at the review checkpoint.

No Firebase Rules change is expected. If one appears necessary, stop and return the reason to Sol before editing authority semantics.

## 23. Implementation authorization and model routing

Architecture is frozen and implementation is authorized.

Default implementation route: **Claude Code / Sonnet 5.5**.

Use the commit containing this contract as the implementation starting checkpoint on dev/phase-10e.

Claude Code may edit production code, tests and directly related documentation needed to satisfy this contract. It may create the requested implementation review checkpoint and push it to dev/phase-10e. It may NOT:

- change the frozen architecture;
- broaden into 10F ability implementation;
- merge to main;
- deploy Firebase Rules or production;
- declare Luna/Astra PASS;
- declare Phase 10E closed.

If implementation uncovers a material contradiction in this contract, stop and report the exact conflict to Sol rather than improvising a new design.

## 24. Implementation handoff report

Return:

A. Starting and final repository identity, diff scope and worktree state.  
B. Implementation summary against this contract.  
C. AC matrix: AC ID | change/location | local test/proof | result/gap.  
D. Required command results, exact counts/skips and any unavailable evidence.  
E. Deviations, conflicts or remaining risks, or none.  
F. Exact implementation review checkpoint SHA and confirmation that dev/phase-10e was pushed.  
G. Advancement statement: ready for Luna mechanical verification, or Sol decision needed.

Local implementation evidence is not independent verification.


## 25. Sol pre-Luna clarification — 2026-10-01

The first implementation checkpoint exposed two narrow UI interpretation gaps. Sol adjudicates them without reopening the Phase 10E architecture:

1. **Default Deal storage versus "View overridden".** Existing Setup intentionally stores explicit ordinary shownAlignment values during Deal. v23 intentionally does not rewrite ordinary perception because those values may be historically intentional. Therefore UI must not equate "non-null shownAlignment" with "meaningfully overridden." The cue is based on effective divergence from Normal, with undisclosed always treated as an override. Do not change Deal storage or the v22 -> v23 ordinary migration for this issue.
2. **Gameplay advisory versus correction.** "Player view differs" is a gameplay-disclosure advisory. It may arm only after an accepted `changeActualAlignment` for an ordinary participant. It must not arm after `correctActualAlignment`; a correction fixes the record rather than asserting a newly experienced gameplay transition.
3. **Pre-Reveal correction UI.** It is acceptable for the UI to omit the separate correction affordance before Reveal because Setup writes no History and a normal pre-Reveal change repairs the same Current State. The underlying correction seam remains valid where called.
4. **Ordinary packet/draft behavior.** No change: ordinary private packets/drafts are not invalidated solely by Actual Alignment mutation because ordinary Actual Alignment is not projected and no ordinary alignment-dependent packet field exists in 10E.


## 26. Sol Astra adjudication — 2026-10-01

Astra adversarial review of checkpoint `264ab0bc1380452216aaec944bb9e2f5498802cb` returned REVISE with five demonstrated implementation findings and two semantic questions. Sol adjudicates them as follows.

### Accepted findings requiring remediation

#### SOL-10E-A1 — Setup-only Traveler designation must be lifecycle-gated

Astra demonstrated that `setIsTraveler` can still run on an Ended snapshot when initial Reveal was never completed, because the command checks only Reveal state. That violates the Setup-only ownership of this writer.

Freeze:
- `setIsTraveler` is valid only while `game.phase === "setup"` and before initial Reveal.
- Night, Day and Ended refuse before any mutation.
- UI must not expose an actionable Setup Traveler toggle outside that lifecycle.
- Refusal changes no Current State, Undo, localSeq, packet or plan count.

This closes ASTRA-10E-001.

#### SOL-10E-A2 — Traveler projection must fail closed on incompatible Shown Role

A schema-valid/recovered Traveler may carry an ordinary Shown Role even though the Role seam would never create that state. The self projection must not reinterpret such a record as an ordinary identity and derive alignment from that ordinary Role.

Freeze:
- for `isTraveler: true`, a projectable self identity requires a valid Traveler Shown Role that is the participant's own current Traveler character (`shownRole === actualRole`);
- otherwise identity is unsafe / Needs check and self projection fails closed;
- a non-Traveler carrying a Traveler Shown Role remains unsafe;
- valid Traveler Normal perception continues to use Actual Alignment; explicit Good/Evil/undisclosed keeps the v23 semantics;
- migration does not invent or repair the incompatible Role.

This closes ASTRA-10E-002.

#### SOL-10E-A3 — Live snapshots require a valid live Game Moment

Astra demonstrated schema-valid Night/Day day-0 snapshots on which Alignment and Role mutation can commit without explanatory History because `currentLiveMoment` returns null.

This is a persisted-timeline boundary defect, not permission to create History without a valid moment.

Freeze:
- a Storyteller game whose phase is Night or Day must have `day >= 1`; persisted validation/recovery must reject Night/Day day-0 rather than reinterpret it;
- Alignment planner must refuse a live-phase mutation when `currentLiveMoment(game)` is null, before ids/patches are produced;
- Role planner receives the same defense-in-depth guard because it shares the same `live && current` History pattern and Phase 10F will compose both seams;
- Setup remains day-0 capable; Ended may retain the day at which it ended, including an ended pre-game snapshot if supported by existing lifecycle;
- migration must not silently repair a malformed Night/Day day-0 entry into validity.

This closes ASTRA-10E-003 and directly hardens the frozen 10D Role seam without reopening Role semantics.

#### SOL-10E-A4 — Gameplay disclosure advisory is one unresolved gameplay cue

Astra demonstrated a previously resolved gameplay advisory reappearing after a later correction because the component retained `cueArmed=true`.

Freeze:
- a correction never arms, revives or carries forward the "Player view differs" gameplay advisory;
- when the player-facing view comes into agreement with the gameplay-changed Actual Alignment, that advisory is resolved and must be disarmed;
- an accepted correction clears any outstanding local gameplay-disclosure advisory for that rendered participation;
- a later independent gameplay change may arm a new advisory if its resulting player view differs;
- participant replacement must not inherit local cue state.

This closes ASTRA-10E-004.

#### SOL-10E-A5 — v23 Alignment History snapshots must reject extra own keys before normalization

Astra demonstrated an Alignment correction snapshot whose raw snapshot carried an extra own key that generic History parsing removed before the v23 strict Alignment refinement inspected it.

Freeze:
- for v23-shaped Alignment History (Alignment record carrying `correction` or `resolutionId`), raw `change.from` / `change.to` must preserve enough input shape for exact-key validation;
- accepted `from` is exactly `{}` or exactly `{ actualAlignment: good|evil }`;
- accepted `to` is exactly `{ actualAlignment: good|evil }`;
- no extra own key may be silently removed before this contract is checked;
- legacy pre-v23 Alignment History remains intentionally loose and is not rewritten or globally tightened;
- do not broaden this into unrelated History-format changes unless mechanically necessary to preserve the raw snapshot at the shared boundary.

This closes ASTRA-10E-005.

### Semantic question 1 — Traveler Role change while Alignment perception is overridden

Sol decision: **preserve explicit Traveler Alignment perception across Traveler -> Traveler Role changes and corrections.**

Phase 10D originally reset Traveler `shownAlignment` to null because the field was inert for Traveler self projection. Phase 10E made it meaningful. A Role change must not silently terminate an independent Good/Evil/Not Told Alignment-perception decision.

Freeze:
- Traveler -> Traveler Role change/correction updates Actual Role, Shown Role and public Traveler character together;
- preserve the existing `shownAlignment` value (null / good / evil / undisclosed);
- null therefore continues Normal-follow-Actual behavior;
- explicit Good/Evil/undisclosed remains explicit after the Role change;
- ordinary -> Traveler starts with Normal (`shownAlignment: null`) unless an explicit perception intent in the same composed resolution establishes another value;
- Traveler -> ordinary continues to require valid ordinary perception as already defined by Phase 10D;
- Role change still performs its existing packet/draft invalidation; this decision concerns Alignment perception ownership only.

This is a narrow amendment to the Phase 10D Traveler-perception behavior, required by the Phase 10E v23 perception model.

### Semantic question 2 — special starting Alignment versus Setup refinement

Sol decision: **no new preservation rule in 10E. Setup fresh-assignment operations may canonicalize starting Alignment.**

Deal / Shuffle / Swap / Manual Override / Edit Bag are Setup construction. Their existing fresh-assignment behavior may rederive canonical Actual Alignment from the assigned Role.

Freeze:
- a special starting Alignment is applied after the final Setup Role assignment/refinement that should determine the bag/roles;
- if the Storyteller performs another fresh Setup assignment afterward, that fresh assignment may overwrite the earlier special Alignment and the special Alignment must be re-applied;
- Phase 10E does not introduce hidden alignment-override provenance solely to preserve such a value through a re-deal/refinement;
- future Phase 10F setup ability orchestration must order deterministic special starting Alignment after the Role-assignment/refinement step it depends on.

Astra's demonstrated same-Role `replaceSetupRole` behavior is therefore not classified as a 10E implementation defect.

### Remediation gate

The remediation checkpoint must add focused regressions for A1-A5 and the Traveler perception-preservation amendment, run the complete normal/default-parallel suite, rules/emulator suite, typecheck, build and diff check, and finish clean.

After implementation, route first to **Luna targeted mechanical verification** of the accepted findings/contract amendment. If mechanically closed, return to **Astra targeted closure review** before Sol closure.


## 27. Closure record — 2026-10-01

Phase 10E — **CLOSED — READY FOR INTEGRATION**.

Sol closure basis:

- Frozen implementation contract approved by the project owner.
- Independent Opus architecture challenge + targeted Traveler-perception challenge adjudicated by Sol.
- Initial implementation completed and mechanically verified.
- SOL-10E-R1/R2 pre-Luna UI clarifications implemented and closed.
- Luna full mechanical verification passed after the independently proven test-harness timing flake was corrected.
- Astra adversarial review found ASTRA-10E-001..005 plus two semantic questions.
- Sol adjudicated those findings in §26.
- Remediation checkpoint: `f978c366ab18fffb873b7ea150c1b3ec69e8f71b`.
- Luna targeted remediation verification: **PASS — READY FOR ASTRA TARGETED CLOSURE REVIEW**.
- Astra targeted closure: **PASS — ASTRA-10E-001..005 CLOSED; READY FOR SOL CLOSURE**.
- Remaining closure-blocking findings: **None**.
- Remaining evidence gaps: **None**.

Final independently verified gate at the reviewed checkpoint:

- typecheck PASS;
- default normal tests: **126 files, 3321/3321 passed, 0 skipped**;
- Firebase emulator/rules: **201/201 passed, 0 skipped**;
- production build PASS;
- `git diff --check` PASS;
- final review worktrees clean.

Astra's targeted closure additionally executed **73/73** independent closure probes and **657/657** focused/adjacent tests with no new findings.

Frozen Phase 10E outcomes:

- one participant-bound Actual Alignment transaction seam;
- gameplay Alignment change vs correction;
- atomic multi-participant Alignment resolution;
- Actual Role and Actual Alignment remain independent;
- player-facing Alignment supports Normal / explicit Good / explicit Evil / Not Told;
- ordinary Normal derives from Shown Role;
- Traveler Normal follows Actual Alignment;
- Traveler→Traveler Role changes preserve explicit Alignment perception;
- v22→v23 migration normalizes inert legacy Traveler shown-alignment copies to Normal;
- strict v23 Alignment History correction/correlation snapshots;
- Night/Day persisted state requires a valid live Game Moment;
- new participation never inherits stale seat Alignment;
- Traveler Actual Alignment change invalidates stale alignment-dependent packet material without erasing historical delivery/completion;
- Setup Traveler designation is Setup-only;
- incompatible Traveler perception fails closed;
- public/self privacy boundaries remain intact;
- 10F ability resolution remains out of scope.

Setup ordering remains explicit: fresh Setup Role assignment/refinement may canonicalize Actual Alignment; any special starting Alignment is applied/re-applied after the final relevant Setup Role refinement.

Sol verdict: **CLOSED — READY FOR INTEGRATION**.
