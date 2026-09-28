# Phase 10D — Role Transitions

Status: **implemented on `dev/phase-10d`, awaiting independent verification.**
This document records the frozen Phase 10D contract and what was delivered. It
does not claim the phase is closed; closure belongs to the review workflow.

Store schema **v22** (`GAME_SCHEMA_VERSION = 22`, `STORE_VERSION = 22`).

Starting checkpoint: `c6fce7dd77e50baf4a34c75529ad48490558296d` (`main` =
`dev/phase-10d` at implementation start; Phase 10A/10B/10C closed).

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
command must reject. The Traveler catalogue was reconciled with canonical data:
**Cacklejack** was missing from `TRAVELERS` (17 vs 18 canonical Travelers) and is
added, including the `travelerChoices` rule's catalogue pattern.

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

Player-written Traveler requests still carry only a character id; ParticipantId
stays Storyteller-private and no player permission or writer fencing changed.

- **Revocation** (`revokePlayerMembership`, legacy `revokeMembership`) clears
  `travelerChoices/{uid}` in the SAME fenced multi-path update.
- **Seating** (`seatPlayer`) clears a stale `travelerChoices/{uid}` in the same
  fenced update that creates the new binding.
- **Application** (`applyTravelerChoice`) re-resolves the roster binding AND
  reads the authoritative `rosterParticipants/{uid}` record; only a record
  naming the same seat yields a `{playerId, participantId}` binding. The local
  commit (`commitTravelerChoiceLocally`) requires the local occupant to hold
  that ParticipantId and submits `changeActualRole` with
  `expectedActualRole: ""` and `expectedIsTraveler: true`. A request whose
  binding is unprovable, mismatched or superseded is cleared, never replayed.

Proven at the emulator/rules boundary in `src/firebase/rules.spec.ts` and at the
production-command boundary in `membershipCommands.test.ts` /
`StorytellerSession.travelerChoices.test.ts`.

## UI

Player Drawer, minimal changes: the live "Clear role" action is removed; the
Actual and Shown pickers list only what the seam accepts; every change is bound
to the participation and observed state the Drawer rendered (a stale change is
refused inline, naming no character); an optional "Also show the player the new
role" applies the explicit perception in the same atomic resolution;
correction is a progressively disclosed "Correct the recorded role…"; an unsafe
Shown Role shows "Needs check". Privacy Mode keeps the Drawer's safe view (no
Role detail); refusal text never names a character.

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
2. A same-Role correction with `travelerArrivalPolicy: "restart"` is a no-op
   (nothing recorded is wrong); `restart` applies when the correction actually
   changes the Role or status.
3. A Traveler's alignment perception fields are stored as given (their own
   projection always reflects the Actual Alignment); their Shown Role must be
   their own character.
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
