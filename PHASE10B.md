# Phase 10B — Effect Lifecycle & Visual Effect Indicators

Status: implemented; Opus architecture remediation (SOL-10B-R1…R9) and the
final closure patch (SOL-10B-RC1/RC2 + gameplay Apply coherence) applied,
awaiting final Opus RC re-check. **Not closed.** Store schema **v20**.

UX principle: *mechanically rich underneath, operationally simple for the
Storyteller.* Routine actions stay `player → Effect → done`.

## Model

An **Effect** is one currently existing causal condition attached to one
participant. `STPlayerRecord.effects[]` is the authoritative Current State
collection; there is no global `game.effects[]`.

| Field | Meaning |
|---|---|
| `id` | Unique within the participant's `effects[]`. Identity = target participant + id (not global). |
| `type` | Free-form semantic type (`poisoned`, `safeFromDemon`, homebrew…). Not a closed enum. |
| `sourceParticipant?` / `sourceCharacter?` | **Origin**: what originally caused the Effect. Durable ParticipantRef; never rewritten by an ordinary update, never re-resolved from a seat. |
| `appliedAt?` | Game Moment it took hold (Setup = `{ setup, 0 }`). |
| `lifetime` | The duration **declared** when the Effect was applied (manual, untilDawn, throughFollowingDay, untilNextNight, nights(n), days(n)). Metadata after Apply. |
| `state` | `active` or `suppressed` — an explicit lifecycle decision (see Suppression). |
| `expiry` | The **sole mechanical duration authority**: `none`, `at(LiveGameMoment)`, or `unresolved` (legacy only). |
| `parameters?` | Typed structured values keyed by a short identifier: `participant` (durable refs), `role`, `alignment`, `number`, `boolean`, `text`. Mechanics never parse `note`. |
| `note?` | Storyteller text only. |

### Truth hierarchy: expiry vs lifetime (SOL-10B-R2)

`expiry` is the only thing mechanics read for duration. `lifetime` is what was
declared at application.

- **Gameplay Apply** derives the initial expiry from the declared lifetime and
  the actual application moment: manual → `none`; timed → the exact derived
  `at`. A caller-supplied expiry must **equal** that derived value or the Apply
  is refused (e.g. `untilDawn` + Night 9 is refused). A new Effect never starts
  `unresolved`. The application moment is the current Night N / Day N, and in
  Setup always exactly `{setup, 0}` — never derived from a legacy Setup `day`
  (SOL-10B-RC1).
- A **correction Apply** records presently-correct state and may supply any
  valid authoritative expiry.
- **Update** may set the authoritative expiry to `none` or any strictly future
  `at`, whatever the declared lifetime (extend, shorten, or remove the timer).
  It never rewrites the declared lifetime. Update is what decouples the end
  from the declared lifetime after creation.
- **Correction** is the only way to change the declared lifetime (and see R3).
- After Apply, mechanics never recompute current truth from `lifetime`.

### Record and game invariants (schema-enforced, never repaired)

- `EffectRecordSchema` (strict): `unresolved` exists only for a finite declared
  lifetime; `at` is a live moment; participant parameters are current-kind
  refs; the `manual:` namespace (below).
- Per participant: unique ids. **An empty seat owns no Effects (SOL-10B-R1).**
- Game-level temporal coherence (SOL-10B-R4), checked by
  `StorytellerGamePersistedSchema` for Current State, every Undo snapshot and
  every recovered checkpoint:
  - Night/Day: every `at` is strictly after the current moment; `appliedAt` is
    never after it (a Setup marker applied at `{setup, 0}` legitimately
    survives into Live Play).
  - Setup: no `at` at all; `appliedAt`, if present, is `{setup, 0}`.
  - Ended: the final snapshot is frozen; no live moment is manufactured and
    this rule does not apply.

  Phase rollover is never what conceals an overdue Effect: overdue state is
  invalid before it can be committed. (`effectExpiresAt` keeps `<=` as a
  defensive rule.)

### The `manual:` namespace (SOL-10B-R7)

Ids beginning `manual:` are reserved for the Storyteller quick Effect of that
type: the id is exactly `manual:<type>`, the declared lifetime is manual, and
it carries no source participant or source character. An ability-shaped
(sourced or timed) Effect can never claim it; a correction cannot change its
type away from its id. Its authoritative expiry may still be scheduled by an
Update (R2). Compatible with `manual:drunk`, `manual:poisoned`,
`manual:protected` and future quick types.

## The one mutation seam

```
EffectIntent[] → planEffectTransaction (pure, effectResolution.ts)
              → EffectPlan | no-op | EffectRefusal
              → resolveEffects (store) → one game replacement
```

`planEffectTransaction(game, { intents, context?, resolutionId? })` is pure.
`resolveEffects` commits an accepted plan as **one** game replacement, **one**
Undo entry, **one** localSeq step (so one projection cycle). Nothing outside
migration, validated recovery restoration, this seam and the phase-rollover
expiry step writes `player.effects`.

Intents (applied in order against the evolving working state; all-or-nothing;
at most `MAX_EFFECT_INTENTS` = 4 × the 20-participant cap):

| Gameplay | Correction |
|---|---|
| `apply`, `update`, `remove`, `suppress`, `resume` | `correctApply`, `correctRemove`, `correctAmend` |

Gameplay and correction intents never mix (`mixedCorrection`).

### Identity binding

Every target, source and participant parameter is an
`EffectParticipantBinding { playerId, participantId }`. The planner verifies
the seat still holds that participation instance; otherwise the whole
transaction is refused as `stale`. The UI captures `participantId` from the
player record it rendered — the Storyteller never enters it. Stored refs are
built centrally (`participantRefOf`); a prebuilt `sourceParticipant` or any
lifecycle field in a spec is refused.

### Semantics

- **Apply** creates a new instance. No id → fresh `fx-…` id. Same id with
  identical content → true no-op. Same id with different content → `conflict`
  (never an upsert). Planner fills `appliedAt` (now), `state: active` and the
  resolved expiry.
- **Update** keeps the same instance and may change only `expiry` (`none` or a
  strictly future `at`, whatever the declared lifetime — R2), `parameters`
  (per-key merge, `null` deletes) and `note`. Rewriting id/type/source/source
  character/applied moment/declared lifetime/state → `immutable`.
- **Remove** deletes exactly one id; removing an absent id is a no-op.
- **Suppress / resume** flip `state` in place, preserving id, origin,
  application, expiry and parameters. Already-current → no-op.
- **Correction** repairs wrongly recorded Current State now (add a missing
  Effect, remove an erroneous one, amend source/type/lifecycle/parameters);
  old History is never rewritten. **Temporal coherence (SOL-10B-R3, RC2):**
  when a correction changes the applied moment and/or the declared lifetime
  without supplying an expiry:
  - if the stored expiry is **still coupled** to the old facts — it equals what
    the old lifetime and applied moment derive (a pure comparison, never
    refused for lying in the past) — it is re-derived from the corrected
    facts; a re-derived end at/before now refuses (`expiryUnresolvable`):
    correct-remove the Effect instead, or supply its current exact end;
  - if the expiry was **independently rescheduled** by gameplay (an Update),
    it is authoritative and survives the descriptive correction unchanged;
  - an `unresolved` legacy end stays `unresolved` — correcting a legacy
    declaration never silently resolves the missing exact end.

  An explicitly supplied expiry is authoritative (R2) and must still be `none`
  or strictly future.
- **Resolving a legacy `unresolved` end is a correction (SOL-10B-R6)**: it
  repairs incomplete migrated Current State, so it records correction History.

Structured refusals: `{ ok: false, code, message, intentIndex? }` with codes
`invalid | phase | notSeated | stale | notFound | conflict | immutable |
expiryUnresolvable | mixedCorrection | tooMany`. An ended game's Effects are
frozen (`phase`).

### Origin vs mutation provenance (SOL-10B-R8)

Origin (`sourceParticipant`, `sourceCharacter`) lives on the EffectRecord and
therefore inside every History snapshot of it. Mutation provenance — *what
caused this lifecycle mutation* — comes **only** from the transaction's
Mutation Context, for apply, update, remove, suppress, resume and corrections
alike; with no context, no provenance is stored (the origin is never copied
into it). Expiry keeps its deterministic system provenance
`{ reason: "expired" }`.

### History (category `effect`)

One record per changed operation, in intent order, at the current moment (Live
Play only; Setup records none). **Net-zero identities leave no History
(SOL-10B-R9):** for each Effect identity (participant + id) touched by a
transaction, if its final snapshot equals its pre-transaction snapshot
(apply X → remove X, suppress X → resume X, …) every record for it is dropped —
History explains committed Current State, it is not an Effect event window.
(Phase 10A Life Events deliberately keep ordered operations; unchanged.)

| Operation | `change` | `effectOperation` |
|---|---|---|
| Apply | `added` (full snapshot) | `apply` |
| Update | `value` (full before/after snapshots) | `update` |
| Remove | `removed` | `remove` |
| Suppress / resume | `value` | `suppress` / `resume` |
| Expire | `removed`, provenance `{ reason: "expired" }` | `expire` |
| Correction | apply/remove/update shape + `correction: true` | apply/remove/update |

v20 validation: `correction` is valid for `life` and `effect`; `effectOperation`
and `resolutionId` only for `effect`; the change kind must match the operation;
expiry is never a correction; a v20 lifecycle record's snapshots must be complete
valid v20 Effects (so malformed lifecycle/source/parameters cannot hide in
History). Legacy v19 effect records keep only the Phase 9R.2 source contract,
now also applied to `value` snapshots. Mechanics never read History.

`resolutionId` is correlation metadata only (not idempotency, not authority,
not unique).

## Expiry

`resolveEffectExpiry(lifetime, anchor)` turns a lifetime, once, into the exact
moment whose **entry** ends it (timeline Night 1, Day 1, Night 2…):

| Lifetime | From Night N | From Day N |
|---|---|---|
| untilDawn = nights(1) | Day N | Day N+1 |
| untilNextNight = days(1) | Night N+1 | Night N+1 |
| throughFollowingDay | Night N+1 | Night N+2 |
| nights(k) | k-th next Day | k-th next Day |
| days(k) | k-th next Night | k-th next Night |

The phase transition (`advancePhase`, and `setPhase` Night↔Day which delegates
to it) computes the destination, removes every Effect whose `at` ≤ destination
(suppressed ones too — suppression pauses applying, not lifetime), prunes the
Life Event Window, moves phase/day and appends `expire` History at the
**destination** moment — one replacement, one Undo, one localSeq. Undo restores
the expired Effects. No wall clock, timers, render/query/reconnect/startup or
recovery expiry. `none`/`unresolved` never expire. Entering `ended` invents no
final expiry. Setup has no countdown: a timed Effect in Setup is refused
(`expiryUnresolvable`); manual Setup markers are allowed and beginning Night 1
records no History for them.

## Suppression (SOL-10B-R5)

`state: suppressed` is an explicit authoritative lifecycle decision that this
Effect instance currently does not apply. It is **not** a cache of every
derived reason an Effect may fail to operate. A future rules engine (10F)
computes derived applicability from stored `state`, whether the source is
functioning, other Effects, jinxes/modifiers, ability semantics and
Storyteller decisions — and never continuously writes such conclusions into
`state`. Accordingly `hasEffect(player, type)` means only "a stored Effect of
this type exists in the active (non-suppressed) state", not "every BOTC
interaction has been evaluated and it is mechanically effective".

## Stacking and precedence

Effects stack by identity: same type from several sources, manual + ability,
Drunk + Poisoned, Poisoned + protections, several protections. The lifecycle
infers no cancellation or precedence and never deletes an instance because
another overrides it (Poisoned + Sober & healthy coexist) — later evaluation
(10F) reads the instances.

## Queries and presentation registry

`src/stores/effects.ts`: `hasEffect` (a stored **active** Effect of that type
— not evaluated applicability, see Suppression), `hasStoredEffect` (exists, even suppressed), `effectiveEffects`,
`effectInstances`, `manualEffectOf` / `manualEffectState` / `hasManualEffect`
(the exact `manual:<type>` quick-control Effect), `effectsNeedingCheck`.

`src/stores/effectRegistry.ts` is presentation only: semantic definitions
(label, indicator) and visual indicators (label, family, optional icon).
Families: impairment, protection, abilityState, obligation, conditional,
registration, custom. `protected`, `safeFromDemon` and `cannotDie` all draw
the **Protected** indicator while staying distinct; Protected has no universal
rule anywhere. Unknown types get a synthesized custom indicator and no
behavior.

## UI

- **Grimoire**: one indicator per visual key for *effective* Effects (never one
  badge per record), with `×n` multiplicity. Drunk/Poisoned/Protected keep their
  perimeter artwork; other indicators are labelled pills. Artwork is decorative
  (`alt=""`, `aria-hidden`); the token's accessible name carries the state in
  words, e.g. `Carol, seat 3, alive, Poisoned, 3 active effects`. A legacy
  unresolved lifetime adds the Storyteller-only "Needs check".
- **Player Drawer → Effects**: *Quick effects* (Drunk / Poisoned / Protected,
  one tap each, `aria-pressed` from the exact manual Effect, `mixed` when that
  manual Effect is suppressed); *Active effects* (compact aggregated rows,
  e.g. `Poisoned ×2`, keyboard/touch buttons with `aria-expanded`) revealing
  each instance's origin, applied moment, authoritative end, declared
  lifetime, state, note and parameters with Suppress/Resume, Remove,
  "Recorded in error" (correction) and, for a legacy Effect whose "Exact end
  not recorded", one-tap corrections: "Ends as … begins" or "Until removed"; *+ Add effect* — the
  only advanced form (type incl. custom, caused by, character pre-filled from
  the source's Actual Role, lifetime with expiry preview, note).
- **Privacy Mode**: no indicator, count, label or Needs check is rendered
  (not CSS-hidden); the drawer shows the safe view, unmounting the Effect
  section so open details and the advanced form close and never reopen when
  Privacy Mode ends.

## Privacy / projections

Effects stay Storyteller-private: the public and self projections and the
Public Display are allowlisted and carry no Effect data, source, lifetime,
parameters, notes or version marker. Communicating something to a player is an
Information Delivery, never a projection of Effect Current State.

## Compatibility adapters

`setStatus(id, type, on)` → `setManualEffect` bound to the current occupant.
`addEffect(id, input)` → one `apply` intent (Apply semantics: returns the id
on create or exact duplicate; `null` on refusal, including different content
under an existing id, a timed lifetime in Setup, a reserved `manual:` id it
does not satisfy, or an `appliedAt` other than now). `removeEffect(id, effectId)` → one `remove` intent. None bypasses the
planner.

## Membership / Undo / recovery

Effects belong to participation instances (SOL-10B-R1): an empty seat can never
own an Effect (schema-enforced; malformed v20 data is rejected, never
repaired), unseat rebuilds a blank seat, removal deletes the record, and every
newly occupied participation starts with `effects: []` even if the seat object
were malformed — so a replacement occupant never inherits Effects. Phase
expiry leaves a (never-valid) participant-less seat untouched rather than
silently removing anything;
durable refs elsewhere stay valid. Undo restores the pre-transaction snapshot
(Effects, History, suppression, expiry, and phase/Life Event Window for a
rollover). Checkpoint recovery restores Effect Current State exactly — no
expiry, no recomputation, no History rebuild, no source reassignment.

## v19 → v20 migration

`migrateGameEntry` (shared by local Current State, every Undo snapshot and
remote checkpoint recovery), `migrateEntryV19ToV20`:

| v19 Effect | v20 |
|---|---|
| manual lifetime | `state: active`, `expiry: none` |
| finite lifetime | `state: active`, `expiry: unresolved` (never guessed, never removed, never inferred from the phase, never from History) |

Then the entry is stamped `gameSchemaVersion: 20`. History is untouched.
Deterministic and idempotent.

**Legacy `appliedAt` (SOL-10B-RC1).** `appliedAt` was optional historical
metadata in v19, and v19 builds allowed non-monotonic phase moves (e.g. Day 1
→ Night 1, or Live → Setup keeping a legacy Setup `day` > 0). During v19 → v20
migration only, a structurally valid legacy `appliedAt` that is temporally
impossible for that entry's own phase/day under the v20 rules (Setup:
exactly `{setup, 0}`; Night/Day: not after the current moment; ended: frozen,
not judged) is **omitted** — never replaced, never used to compute an expiry,
never taken from History; the Effect and the entry's phase/day are kept, and
the expiry migration is unchanged (manual → `none`, finite → `unresolved`). A
coherent legacy `appliedAt` stays; a malformed one is left for the schema to
reject. The same coherence rule (`isEffectAppliedAtCoherent`) backs the v20
schema.

Remediation impact (still v20, no version bump — v20 is unreleased and every
path already validates against the one v20 schema): migrated legacy data must
satisfy the tightened v20 invariants. In particular a pre-v20 Effect sitting on
an **empty** seat (never producible through the UI; only by direct command
misuse, since unseat always cleared Effects) now fails validation after
migration and the snapshot is rejected through the existing reset / invalid
checkpoint paths — it is never silently dropped or reassigned (SOL-10B-R1).
Legacy `manual:<type>` Effects written by the quick toggle already satisfy the
reserved namespace.

**Explicit version evidence.** Every authoritative game snapshot carries
`gameSchemaVersion: 20` (required, no default). It travels inside the game, so
checkpoints carry it with no Firebase rule or writer change. Any
`gameSchemaVersion` key, or any v20 lifecycle key (`state`/`expiry`/
`parameters` on an Effect, `effectOperation`/`resolutionId` on History) is
v20 evidence: detection reports 20 and no legacy step runs, so malformed v20
data is rejected, never repaired. Markerless snapshots keep the bounded
structural detection.

## Future ability-engine seam (10F)

A rules engine evaluates a Role ability, asks the Storyteller only where
judgment is required, then submits already-resolved `EffectIntent`s (bound
targets/sources, typed parameters, optional `resolutionId`) to
`planEffectTransaction` / `resolveEffects`. It never writes `player.effects`.

## Future conventions (documentation only)

- **Character-target convention (10F).** When an ability selects a character
  but produces a participant-scoped Effect, 10F resolves the character against
  Current State, identifies the current participant(s), applies participant
  Effect(s), and may keep the selected Role as a structured parameter. With no
  applicable participant, nothing is fabricated. A mechanic attached to a
  character concept independent of any current participant does not belong in
  a participant's `effects[]`; later ability-specific/global bookkeeping owns
  it.
- **Effect / Reminder authority (10C).** If a mechanical condition is
  authoritative as an Effect, a Reminder may visualize or bookkeep it but must
  never become a second independent source of that mechanical truth. 10C
  should also consider the analogous empty-seat rule for Reminders (not
  changed in 10B).

## Deferred findings

- **OPUS-10B-010:** a correction cannot currently change an Effect's origin to
  a participant who has already left (a source must be a bound current
  participant). This is a safe limitation — callers still can never
  manufacture arbitrary ParticipantRefs — and a dedicated correction workflow
  is deferred.

## Non-goals (deferred)

No Role ability logic (Poisoner, Monk, Sailor, Innkeeper, Courtier, Preacher,
Barista, Bone Collector, Cerenovus, Harpy, Witch, Fearmonger, Exorcist, Spy,
Recluse, Fortune Teller…), registration, jinxes, precedence/cancellation rules,
ability grants, Role/Alignment changes, global modifiers, Reminders (10C),
nominations/voting. The legacy `statuses` field and `BehaviorMode: "poisoned"`
are unchanged.
