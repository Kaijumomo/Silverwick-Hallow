# Phase 10D — Role Transitions

Status: **CLOSED.** Store schema **v22** (`GAME_SCHEMA_VERSION = 22`,
`STORE_VERSION = 22`). This document records the frozen Phase 10D contract and
what was delivered.

Final reviewed implementation checkpoint (before docs-only closure metadata):
`62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`. The docs-only closure commit on
top of it, `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`, is the integration
checkpoint. Integration was rules-first: the Phase 10D Firebase Rules were
deployed to production and verified, and only then was `main` fast-forwarded
to that commit (see "Release order" and "Integration record" below).

Starting checkpoint: `c6fce7dd77e50baf4a34c75529ad48490558296d` (`main` =
`dev/phase-10d` at implementation start; Phase 10A/10B/10C closed).

## Closure record

Phase 10D — **CLOSED** and **INTEGRATED** into `main`. Sol verdict:
**CLOSED — READY FOR INTEGRATION.**

History, on top of `c6fce7dd77e50baf4a34c75529ad48490558296d`:

- Initial implementation — the authoritative Role transition seam, store v22
  (`b2e0c6bf4d43537d770fcfcc2cc9b4abca22c4fe`).
- Luna mechanical verification, followed by the same-Role Traveler `restart`
  correction remediation (`4ca328256058c48c834c968d63a61a732364227f`).
- Astra findings ASTRA-10D-001…004 and the C01/C02 Life amendments
  (exile-death is death-scoped; correction-recorded exile events), remediated
  together as SOL-10D-R2 (`921b73ef102ff3d9b4456b78c759f571893c9b8c`).
- Duplicate RoleId ownership correction, SOL-10D-C03
  (`a5ef611150ee85f76915e5b4eece828c6ecd30d6`).
- Setup compatibility correction, SOL-10D-C03-R1
  (`444820274eb5fd672d567bbc9c95bf24fd0865ef`).
- Final closure remediation (`a614496187bbf43cd4541d8a73a30645d7d7bdf2`):
  immutable pending Traveler player requests (CLOSURE-01, Sol amendment),
  deferred request liveness (CLOSURE-02) and canonical Traveler downstream
  ownership (CLOSURE-03).
- Almanac RoleId uniqueness correction, LUNA-CLOSURE-03-R1
  (`b4068b4f517e51015c3c974d73ddc6503036f416`).
- Stopped-writer lifecycle correction, ASTRA-FINAL-01
  (`62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`).

Final verification evidence at `62055408e75ba33a9b1900e19b1d4bcd3cbf93aa`:

- `npm run typecheck` — PASS
- `npm test` — **3172/3172 across 119 files**
- `npm run test:rules` — **201/201**, 0 skipped
- `npm run build` — PASS
- `git diff --check` — PASS
- final reviewed worktree — clean

Closure status:

- No unresolved accepted Blocker/High/Medium implementation or contract
  finding.
- CLOSURE-02 — closed. CLOSURE-03 — closed.
- ASTRA-FINAL-01 — independently mechanically verified by Luna at the final
  target: Luna executed the real Firebase-emulator regression at all three
  awaited-read boundaries, every expected no-mutation assertion passed, and
  the complete gate passed.

Evidence limitation: the final requested Astra re-confirmation of
ASTRA-FINAL-01 could not be executed, because that review environment
repeatedly classified the authorized local concurrency regression task as
cybersecurity content. Sol adjudicated this as a REVIEW-ENVIRONMENT
LIMITATION, not a remaining product defect or product evidence gap: Astra
originally established the defect, the exact remediation was implemented, and
Luna independently executed the real-emulator regression at all three
boundaries with every expected assertion passing and the complete gate
passing. There is no Astra PASS for a post-`62055408` confirmation, because
that run did not occur.

### Release order

Phase 10D changed `src/firebase/rules.json` (player-side immutability of a
pending Traveler request). The rules enforce that for every client, including
older ones, while the new client only discourages a replacement. The web
client ships from `main` automatically, but rules change only through
`npm run rules:deploy`, so the Firebase Rules are deployed and verified
(`npm run rules:verify -- --project <PROJECT_ID>`) **before** `main` moves.

### Integration record

Integration was completed on 2026-10-01 (UTC), in the release order above:

1. The project owner deployed the rules with `npm run rules:deploy` (Realtime
   Database rules only) to the production Firebase project's default Realtime
   Database instance, from the integration checkpoint
   `22dfd49e7220d642eec353c2ea83fa3a2547ce8b` (`src/firebase/rules.json`
   SHA-256 `9cccdc7f474d4948007f5e3b62fa485d0e20e6e06b50194258f348e01e0db076`).
   The read-only `npm run rules:verify -- --project <PROJECT_ID>` then
   reported that the deployed rules match `src/firebase/rules.json`. Both
   steps were run and reported by the project owner; the integration session
   did not observe them directly.
2. `main` was fast-forwarded, with no merge commit, from
   `c6fce7dd77e50baf4a34c75529ad48490558296d` to the integration checkpoint
   `22dfd49e7220d642eec353c2ea83fa3a2547ce8b`.
3. A docs-only integration-record commit directly on top of the integration
   checkpoint records these facts. It is the final `main` of the Phase 10D
   integration and the starting point of `dev/phase-10e`. It changes no code,
   test or rules file, so the deployed rules still match `main`.

The web client ships from `main` automatically through hosting configured
outside this repository; that client deployment was not observed from the
integration session.

## The primitive

```
RoleIntent[] -> planRoleTransaction(game, tx, { script, ids })   (pure)
             -> accepted partial-field RolePlan | true no-op | structured refusal
             -> applyRolePlan(game, plan)                        (pure)
             -> resolveRoles (store): exactly ONE game replacement,
                one Undo entry, one localSeq step, one projection cycle.
```

`src/stores/roleResolution.ts`. Current State stays authoritative: there is no
Role Event Window and no secondary Role ledger. Role/perception Current State
is still `actualRole`, `shownRole`, `shownAlignment`, `behaviorMode`,
`isTraveler` and (where compatibility requires it) `publicDisplayRole`. History
is explanatory only and Current State is never rebuilt from it. A Role change
never mints a ParticipantId. Actual Alignment transitions are Phase 10E: 10D
never changes `actualAlignment`.

**Purity / injection.** Every id the plan needs -- History ids and packet
epochs -- comes from the injected `RoleIdSource`; the module never draws
randomness inside planning (`defaultRoleIds` is exported for the store/UI and is
not referenced by the planner or `applyRolePlan`; an architecture test enforces
this). `ids` is a required argument.

**Partial-field patches (10F composition).** A `RolePlan` never carries a whole
player record. Per participant it is `{ set, remove }` over the closed list
`ROLE_PLAN_FIELDS` -- `actualRole, isTraveler, abilityUsed, shownRole,
shownAlignment, behaviorMode, publicDisplayRole, privateInfo, publishedPacket,
packetEpoch, travelerArrival` -- plus the exact `nightProgress` keys a
Traveler's arrival cleanup removes. It never touches `alive`, `ghostVote`,
`exiled`, `effects`, `reminders`, `actualAlignment`, `participantId` or any
other field, so it composes on a working snapshot a Life/Effect/Reminder plan
already produced. No universal cross-domain order is defined here.

## Intents (strict, runtime-validated)

| Intent | Meaning |
|---|---|
| `changeActualRole` | A REAL gameplay character transition. Bound to `{playerId, participantId}` plus `expectedActualRole` and `expectedIsTraveler`; destination `actualRole`. Resets `abilityUsed`. |
| `correctActualRole` | Silverwick's recorded Role / ordinary-vs-Traveler truth is being REPAIRED (not a gameplay event). Same binding; optional `travelerArrivalPolicy: "preserve" \| "restart"` (default `preserve`). Preserves `abilityUsed`. |
| `setPerception` | Explicitly sets Shown Role, Shown Alignment and optional behavior mode as one bundle. Bound to the participant and to `expectedShownRole`, `expectedShownAlignment` (and `expectedBehaviorMode` exactly when `behaviorMode` is supplied). Neutral with respect to gameplay-vs-correction. |

Hostile-input rules (carried forward from 10B/10C, and the deferred
ASTRA-10C-005 flaw is **not** copied): the transaction and every intent must be
a plain object; the intents array cannot be sparse (each index validated, the
hole's index reported); `kind` must be an OWN string property before any
discriminator lookup (an inherited `kind` is invalid); unknown keys are refused
by presence, including keys whose value is `undefined`; the Mutation Context is
parsed by the strict runtime schema; player/Role maps use own-property lookups
(prototype names never reach inherited properties); empty and oversized
transactions and ended games are structured refusals; a stale ParticipantId
binding and a same-participant expected-state mismatch are both `stale`; nothing
throws for malformed input and nothing is partially applied.

Refusal codes: `invalid | phase | notSeated | stale | conflict | mixedCorrection
| tooMany | role | perception`, with `intentIndex` where useful.

## Transaction semantics

- Multiple participants change atomically; intents are evaluated in order
  against the evolving working snapshot; all-or-nothing.
- At most ONE Actual Role intent per ParticipantId per planner call -- a second
  is `conflict` (never silently composed A -> B -> C), even if the first was a
  no-op.
- Gameplay and correction Actual intents never mix (`mixedCorrection`);
  perception intents may accompany either.
- Character uniqueness is deliberately NOT an invariant (temporary and final
  duplicates stay possible for later ability semantics). There is no alive
  precondition.
- A completely net-zero resolution produces no History, no Undo, no localSeq
  change and no packet invalidation (the packet epoch is minted only for a
  participant whose perception assumptions really changed and still differ at
  the end).
- Perception-derived invalidation (draft deletion/pruning, packet withdrawal,
  packet epoch) is decided ONCE, from each participant's ORIGINAL versus FINAL
  Shown Role / Shown Alignment / behavior mode -- never from intermediate
  intents (ASTRA-10D-002). A perception that round-trips (Chef -> Librarian ->
  Chef) invalidates nothing, even when the same resolution also commits another
  real change (e.g. a Traveler arrival `restart`); a real Actual Role change
  still invalidates everything prepared for the old Role.

## Actual Role change / correction

| | Gameplay (`changeActualRole`) | Correction (`correctActualRole`) |
|---|---|---|
| `actualRole` | new Role | new Role |
| ParticipantId, Actual Alignment, life state, Life Event Window, Effects, Reminders | preserved | preserved |
| `abilityUsed` | reset to `false` | **preserved** |
| private draft (`privateInfo`) | cleared | cleared (only when the Role really changes) |
| published packet | withdrawn, new `packetEpoch` | withdrawn when the Role really changes |
| ordinary Shown Role / Shown Alignment / behavior mode | preserved unless a `setPerception` intent says otherwise | preserved unless a `setPerception` intent says otherwise |
| Live Play History | `category: "role"`, `{actualRole}` -> `{actualRole}` | same, with `correction: true` |
| Setup | no History | no History |

Selecting the same Actual Role under the same ordinary/Traveler state is a true
no-op (nothing reset, cleared, withdrawn or recorded). Effects whose source
character changed are NOT removed or suppressed (future 10F composed logic).

## Ordinary <-> Traveler (live play)

The destination status follows the destination Role's type. Actual Alignment
and the starting-setup planning fields (`plannedTravelerCount`,
`plannedPlayerCount`, `startingNonTravelerCount`) are never rewritten.

- **Ordinary -> Traveler**: `isTraveler`, `actualRole` = the Traveler,
  `shownRole` = `publicDisplayRole` = the Traveler (the character is public),
  Shown Alignment derived, behavior mode `normal`; a gameplay change resets
  `abilityUsed` and creates a fresh Traveler arrival (clearing that
  participant's arrival/role night progress).
- **Traveler -> Traveler**: Actual / Shown / public stay synchronized. Gameplay:
  `abilityUsed` reset, fresh arrival. Correction: `preserve` leaves the arrival
  and its progress (including `demonInfoComplete`) intact; `restart`
  reinitializes only that participant's arrival and arrival/role night steps.
  Packet invalidation never implies either.
- **Traveler -> ordinary**: `isTraveler = false`, `publicDisplayRole` and the
  arrival cleared, arrival night progress cleared. The final ordinary
  participant must not retain a Traveler-type Shown Role, and Silverwick never
  invents one: an explicit valid `setPerception` in the same atomic resolution
  is required (`perception` refusal otherwise).

Unresolved Roles: a gameplay change needs a non-empty destination -- an
ordinary participant is never made Role-empty and "Clear role" is gone.
Correction TO `""` is allowed only for a Traveler (reopening an unassigned
Traveler character); a transition/correction FROM `""` (assigning an unassigned
Traveler) is allowed. Legacy ordinary unresolved seats stay readable and
diagnosable; migration fabricates nothing.

## Role validation (by authoritative type)

`classifyRole(script, id)`: the canonical Traveler catalogue decides Traveler
characters (the registry's own precedence); everything else must be a
townsfolk/outsider/minion/demon character **of the current script**. Fabled,
Loric, off-script and unknown ids are refused as Actual and Shown Roles for
ordinary participants. Custom/homebrew characters are valid exactly when they
are on the current custom script with an allowed type. The UI pickers use the
same policy (`ordinaryRoleChoices`), so routine UI never offers a choice the
command must reject. **Role ownership** (ASTRA-10D-004): the registry
(`buildRegistry`) resolves an admitted ordinary script character to that same
owned definition -- a Fabled or Loric reusing its id (e.g. a homebrew
Townsfolk `bigwig` vs the canonical Loric Big Wig) never replaces it -- so
classification, pickers, registry, projection and private-information
resolution agree; only the canonical Traveler catalogue keeps its precedence.
One `ORDINARY_ROLE_TYPES` definition is shared by the Role boundary and the
registry. The Traveler catalogue was reconciled with canonical data:
**Cacklejack** was missing from `TRAVELERS` (17 vs 18 canonical Travelers) and is
added, including the `travelerChoices` rule's catalogue pattern.

**RoleId uniqueness** (SOL-10D-C03): RoleId is the character identity key, so a
script names each character once.

- A NEW custom-script import with two character entries carrying the same
  RoleId is rejected (`parseClocktowerScript`), whichever way each entered --
  official id string or character object, compared on the resolved RoleId --
  with an error naming the duplicate id. It is never silently deduplicated.
- An already-stored LEGACY script that still carries a duplicate is not
  rejected, reset or migrated. Every runtime Role consumer resolves one
  deterministic owner, the FIRST definition (`ownedScriptCharacters`):
  `classifyRole`, `ordinaryRoleChoices`, `buildRegistry` (and so projection
  and private-information resolution), the Grimoire and Player Drawer role
  lookups and bluff lists, the Setup pool editor and bag fill, the Effect
  source list and the Almanac. A later duplicate is never admitted, offered
  or resolved.
- Setup analysis uses the same owner (SOL-10D-C03-R1): a later duplicate
  that differs from the first definition is a nonblocking Storyteller check
  ("Legacy duplicate definition for Chef. Silverwick is using the first
  definition."), never a Deal, Reveal or Begin blocker. Only an OWNING
  definition the runtime does not use -- e.g. one shadowed by the canonical
  Traveler catalogue -- still blocks as a conflict, alongside the unchanged
  genuine blockers (unresolved Role, Traveler/type contradiction, ...).
- The canonical Traveler catalogue keeps its precedence (the explicit Phase
  10D exception), and an admitted ordinary owner keeps its id against Fabled
  and Loric overlays (ASTRA-10D-004). No schema/store version change.
- Downstream consumers apply the same precedence (CLOSURE-03): every list
  that offers or names a character -- the Player Drawer's current and shown
  Role and bluff names, the Effect and Reminder source character (picker and
  label), the Almanac -- takes ONE definition per RoleId from
  `resolvedCharacters`, exactly what `buildRegistry` resolves (the Grimoire's
  display map already did). A script definition shadowed by a canonical
  Traveler (e.g. a legacy homebrew Demon `thief`) is never displayed, offered
  or acted on: the Traveler Thief's Drawer shows no Demon bluff controls.
  The Almanac then adds a Fabled or Loric catalogue entry only when its RoleId
  is not already shown, so a homebrew ordinary owner (e.g. Townsfolk `bigwig`,
  Outsider `doomsayer`) is never listed beside the catalogue character of the
  same id (LUNA-CLOSURE-03-R1). Bluff candidates are `ordinaryRoleChoices`.
  The Setup pool editor and bag fill remain ordinary script-owner lists by
  type; Setup analysis still blocks a Traveler-shadowed owner there as a
  conflict.

## Perception

Actual truth never automatically becomes ordinary perception. `setPerception`
sets `shownRole`, `shownAlignment` (`null` derives from the SHOWN Role only; an
explicit good/evil is shown as given) and optionally `behaviorMode` atomically;
it never derives Actual Alignment. A non-Traveler may not end with a Traveler,
Fabled, Loric, off-script or unknown Shown Role; a null Shown Role is an
explicit "unrevealed" and carries no alignment. A Traveler's Shown Role must be
their own public character. An identical bundle is a TRUE no-op -- nothing is
cleared or withdrawn, no Undo, no localSeq -- and the legacy
"double-select as destructive packet withdrawal" behavior is gone. A real
change withdraws the published packet and mints a new epoch; a changed Shown
Role also clears the private draft, while an alignment/behavior-only change
prunes only fields the new perception makes inapplicable. Perception produces
no Role History. Information Delivery records are never touched.

## Setup / phase boundaries

| Phase | Role seam |
|---|---|
| Setup, before the initial Reveal | Deal / Shuffle / Swap / Manual Override / Edit Bag stay Setup-specific and record no History. The seam accepts a Role assignment/correction here (no History) so the existing pre-Deal/Traveler flows keep working. |
| After the initial Reveal, before Night 1 | gameplay changes are refused (`phase`), except assigning an unassigned Traveler's character; corrections are allowed to repair the committed starting assignment; no History. `beginNightOne` keeps its own readiness/coherence validation. |
| Night / Day | gameplay changes, corrections and perception updates, with History. |
| Ended | every Role/perception mutation through the seam is refused. |

In Setup the seam never changes ordinary-vs-Traveler status (`setIsTraveler`,
pre-Reveal, is the Setup command and adjusts the plan; after Reveal it stays
locked).

## Role History

Only Actual Role mutations write History: `category: "role"`, a `value` change
with strictly `from: { actualRole }`, `to: { actualRole }`; a correction adds
`correction: true`; a transaction may carry a shared `resolutionId`. There is no
`roleOperation` field. Perception changes and Setup construction write none.
Legacy Role History is preserved as recorded (never rewritten into the v22
shape); the schema applies the strict `{ actualRole }` contract only to a Role
record that carries the v22-only metadata.

## v22 schema and migration

`STORE_VERSION` and `GAME_SCHEMA_VERSION` are 22. v22 adds no stored Current
State field; the v21 -> v22 step is a **stamp only** (no Role inference, no
History rewrite, no perception repair, no Current State reconstruction).

Explicit per-entry routing (Current State, every Undo snapshot and remote
checkpoint recovery all use the one `migrateGameEntry`):

| Marker | Result |
|---|---|
| 20 | v20 -> v21 -> v22 (a malformed entry the v21 step leaves untouched is never stamped by v22) |
| 21 | v21 -> v22 |
| 22 | current; no migration |
| malformed / unsupported / newer | never reinterpreted as legacy; the schema rejects it |
| older marker + newer evidence | rejected unrepaired |
| marker-less v20/v21/v22 evidence | malformed current-version data: rejected, never stamped |

`hasV22Evidence`: a `"role"` History record carrying `correction` or
`resolutionId`. It is checked before every older heuristic -- a Role correction
carries the generic `correction` key (v19 Life evidence) and a Role
`resolutionId` the generic `resolutionId` key (v20 evidence), so an older
heuristic could otherwise claim it and stamp it into validity. A step also
requires that the envelope itself be older than the step's target: a store
labelled 21 holding a marker-20 entry, or labelled 22 holding a marker-21 entry,
is malformed and resets.

## Projection safety

`projectIdentity` no longer throws on an unresolvable Shown Role and fails
closed per participant: no self identity, no fallback to the Actual Role or
Alignment, and one bad record cannot block the table's checkpoint, public
projection or anyone else's self projection. The Traveler projection branch
(which mirrors the Actual Alignment) is reachable only for `isTraveler`
participants, so a non-Traveler with a Traveler-type Shown Role can no longer
leak alignment; a Fabled/Loric Shown Role is never delivered to an ordinary
participant. `identityNeedsCheck` marks such a participant as a Storyteller-only
"Needs check" (Grimoire token and Drawer; nothing is rendered under Privacy
Mode).

## Traveler-choice participation fix

Player-written Traveler requests still carry only a character id (a canonical
Traveler RoleId at `travelerChoices/{uid}`); ParticipantId stays
Storyteller-private and writer fencing is unchanged.

- **Pending request is immutable for the player** (CLOSURE-01, Sol amendment):
  once submitted, the request stays exactly as submitted until the Storyteller
  or the membership lifecycle consumes/clears it. The player rule admits only a
  first request (no request yet) or a same-value resubmit (an idempotent
  no-op); a different Traveler while one is pending is refused, and the player
  cannot cancel or delete it. After the Storyteller/lifecycle clears it, a
  later choice is a NEW request (a new generation). The player screen shows
  the pending choice ("Thief selected · waiting for Storyteller") instead of
  the picker and never writes a replacement; the server rule, not the UI, is
  what enforces it. This replaces the earlier behavior that let a player
  replace a pending choice directly; no request nonce, claim path, conditional
  writer primitive or schema change was added.
- **Deployment order:** the Firebase Rules must be deployed before the updated
  client. The rules enforce immutability for every client, including older
  ones; the new UI against the old rules would only discourage a replacement.

- **Revocation** (`revokePlayerMembership`, legacy `revokeMembership`) clears
  `travelerChoices/{uid}` in the SAME fenced multi-path update.
- **Seating** (`seatPlayer`) clears a stale `travelerChoices/{uid}` in the same
  fenced update that creates the new binding.
- **Observation** (ASTRA-10D-001): each observed request is bound, when it is
  observed (`observeTravelerChoice`, in `useApplyTravelerChoices`), to the
  participation instance holding the seat: `{playerId, participantId, roleId}`.
  ParticipantId comes from the Storyteller's own Current State -- nothing is
  added to the player-written request, and there is no request nonce.
- **Liveness** (CLOSURE-02): a request observed while its seat holds no
  participation yet (e.g. before the Storyteller's own seating acknowledgment
  lands) is neither processed against the empty seat nor dropped.
  `useApplyTravelerChoices` also depends on
  `pendingTravelerChoiceParticipation` -- the participation each pending
  request would be observed for -- so when it changes (seating acknowledgment,
  recovery restoring the occupant, a new participation of the same uid) the
  request is observed for the now-current participation and revalidated
  exactly as below. No polling, no reaction to unrelated game changes, no
  second request write.
- **Application** (`applyTravelerChoice`), inside the fenced writer's exclusive
  section and before any local mutation, re-establishes that the request still
  exists remotely with the observed character, that the uid's CURRENT roster
  binding is the observed seat, and that the authoritative
  `rosterParticipants/{uid}` record names the observed ParticipantId and seat.
  After those reads, a final synchronous writer-lifetime gate
  (ASTRA-FINAL-01) -- with no await between it and the local commit --
  requires that the SessionWriter executing the operation has not stopped
  meanwhile (e.g. its lease was lost and another tab took over). A stopped
  writer's in-flight callback never mutates local Current State (no Role
  change, localSeq step or Undo entry) and never consumes a later request
  generation; server writes remain fenced by Firebase as before.
  The local commit (`commitTravelerChoiceLocally`) then requires the local
  occupant to still hold that ParticipantId as an unassigned Traveler and
  submits `changeActualRole` with `expectedActualRole: ""` and
  `expectedIsTraveler: true`. So a cached callback of an earlier participation
  never applies to (or consumes the request of) its replacement, a consumed or
  cleared request never re-applies (not even after an Undo returns the
  participant to blank), and a callback observed for an earlier request never
  applies or consumes a LATER request generation (a different value can only
  be a new request made after the earlier one was cleared). This relies on the
  immutability rule above plus the writer's exclusive section, in which every
  Storyteller-side clear runs; it is not a general compare-and-consume. The
  same participation's currently-existing identical request may be processed
  by any of its callbacks.
- **Cleanup** stays fenced and idempotent: the request is cleared only when it
  provably belongs to the observed participation (applied, or superseded by a
  Storyteller assignment / status change) or provably to no participation (the
  uid has no binding). A request the binding or record attributes to another
  participation -- or cannot attribute (no valid record) -- is left for its own
  participation's observation; revocation and seating still clear it
  atomically.

Proven at the emulator/rules boundary in `src/firebase/rules.spec.ts` (IMM-1..6,
IMM-8), at the production-command boundary in `membershipCommands.test.ts` /
`StorytellerSession.travelerChoices.test.ts` /
`StorytellerSession.travelerChoiceLiveness.test.ts`, and for the player's pending
lock in `PlayerScreen.test.tsx` (IMM-7).

## UI

Player Drawer, minimal changes: the live "Clear role" action is removed; the
Actual and Shown pickers list only what the seam accepts; every change is bound
to the participation and observed state the Drawer rendered (a stale change is
refused inline, naming no character); an optional "Also show the player the new
role" applies the explicit perception in the same atomic resolution;
correction is a progressively disclosed "Correct the recorded role…"; an unsafe
Shown Role shows "Needs check". Privacy Mode keeps the Drawer's safe view (no
Role detail); refusal text never names a character.

Traveler arrival panel (ASTRA-10D-003): the public-character selector and "Show
public character in player view" build their intents (`changeRoleIntent`,
`correctRoleIntent`, `setPerceptionIntent`) from the Traveler record the panel
RENDERED and submit them through `resolveRoles`, like the Drawer; a stale
selection (the character or the occupant changed in between) receives the
seam's structured `stale` refusal inline and changes nothing. The PlayerId-only
compatibility wrappers remain for non-render-bound callers.

## Traveler status and Life are independent (ASTRA-10D-C01 conformance)

- Traveler status is Role state; Life is Life state. Ordinary <-> Traveler
  Role transitions (gameplay or correction) never read or write `alive`,
  `ghostVote` or `exiled`, and the Role planner never reads `exiled` to decide
  a Role.
- An exile-death therefore survives every Role transition: a Traveler who was
  exiled and died and later becomes ordinary (or another Traveler) stays
  dead, exiled, with the same ghost vote -- a valid state, shown as Exiled to
  the Storyteller and publicly (see TERMINOLOGY.md §12 and the PHASE10A.md
  compatibility amendment). The Life Event Window and Life History are not
  touched by the Role transition; Role History records only the Role change.
- Life corrections and correction-recorded exile events (amend / late record)
  do not consult the current Role (ASTRA-10D-C02); gameplay exile still
  requires a current Traveler. No schema/store version change.

## Writer audit

Live/general mutation APIs route through the seam. `assignRole`,
`correctRole`, `showAssignedRole`, `setShownRole`, `setShownAlignment`,
`setBehaviorMode` and `setPerception` are thin compatibility adapters over
`resolveRoles`. The only other writers of the Role/perception fields are
narrow and non-live: constructors/occupancy (`blankPlayer`, `arrivalPlayer`,
`occupySeat`, unseat), Setup (`dealtIdentity`/`freshAssignment`,
`setIsTraveler`), and migration; whole-snapshot Undo/recovery replaces `game`
without writing a field. `src/stores/roleArchitecture.test.ts` guards this.

## Interpretations of the frozen contract

1. Assigning an unassigned Traveler's character after the initial Reveal (and
   before Night 1) is allowed as an ordinary Role change, per "transition FROM
   `""` is allowed when assigning an unassigned Traveler" -- otherwise a late
   Traveler could not choose a character in that window.
2. A same-Role Traveler correction is NOT automatically a no-op:
   `travelerArrivalPolicy: "preserve"` (the default) with no other change is a
   true no-op, while `"restart"` explicitly reinitializes `travelerArrival` and
   clears only that Traveler's current-night arrival/role night steps -- one
   atomic commit, one Undo, one localSeq. The Actual Role, ParticipantId, Actual
   Alignment, `abilityUsed`, perception, draft/packet, Life, Effects and
   Reminders are untouched, and no Role History value record is written (the
   Actual Role did not change). If the arrival is already initial and there is
   no step to clear, the restart is net-zero and therefore a true no-op; an
   unassigned Traveler (no Role yet), an ordinary participant and a gameplay
   `changeActualRole` (which rejects the policy) are unaffected.
3. A Traveler's alignment perception fields are stored as given (their own
   projection always reflects the Actual Alignment); their Shown Role must be
   their own character. **Amended by Phase 10E (store v23, `PHASE10E.md`
   3.2):** a Traveler's `shownAlignment` is no longer inert -- `null` (Normal)
   follows the Actual Alignment, an explicit good/evil/undisclosed is honored;
   v22 leftovers are normalized to `null` by the v22 -> v23 migration.
4. The compatibility wrappers never flip ordinary-vs-Traveler status; the seam
   does.

## Non-goals (not implemented)

Role ability parsing/evaluation; Pit-Hag/Barber/Hatter/Hindu/Kazali/Summoner/
Scarlet Woman/Imp/Fang Gu/Riot logic; Actual Alignment changes (10E);
Effect applicability or automatic removal after a source changes Role; per-
character Reminder cleanup; Undertaker/Cannibal character-at-Life-Event
snapshots; "YOU ARE" Information Delivery; the cross-domain 10F coordinator;
replacement-player handover; participant-scoped night-progress redesign; any
Firebase authority/fencing change.
