# Phase 10B — Effect Lifecycle & Visual Effect Indicators

Status: implemented, awaiting Luna verification. **Not closed.** Store schema **v20**.

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
| `lifetime` | Lifetime vocabulary (manual, untilDawn, throughFollowingDay, untilNextNight, nights(n), days(n)). |
| `state` | `active` (applies) or `suppressed` (still exists, currently does not apply). |
| `expiry` | Resolved authoritative expiry: `none`, `at(LiveGameMoment)`, or `unresolved` (legacy only). |
| `parameters?` | Typed structured values keyed by a short identifier: `participant` (durable refs), `role`, `alignment`, `number`, `boolean`, `text`. Mechanics never parse `note`. |
| `note?` | Storyteller text only. |

Schema invariants (`EffectRecordSchema`, strict): `manual` ⇔ `expiry: none`;
a finite lifetime has `at` or `unresolved`; `at` is a live moment; participant
parameters are current-kind refs; ids unique per participant.

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
- **Update** keeps the same instance and may change only `expiry` (a future
  `at`), `parameters` (per-key merge, `null` deletes) and `note`. Rewriting
  id/type/source/source character/applied moment/lifetime/state → `immutable`.
- **Remove** deletes exactly one id; removing an absent id is a no-op.
- **Suppress / resume** flip `state` in place, preserving id, origin,
  application, expiry and parameters. Already-current → no-op.
- **Correction** repairs wrongly recorded Current State now (add a missing
  Effect, remove an erroneous one, amend source/type/lifecycle/parameters);
  old History is never rewritten.

Structured refusals: `{ ok: false, code, message, intentIndex? }` with codes
`invalid | phase | notSeated | stale | notFound | conflict | immutable |
expiryUnresolvable | mixedCorrection | tooMany`. An ended game's Effects are
frozen (`phase`).

### Origin vs mutation provenance

Origin lives on the EffectRecord. Mutation provenance lives on History: the
transaction's Mutation Context. Only an **Apply** without a context falls back
to its own origin (the mutation *is* the origin). Update/remove/correction
never inherit the origin — a removed snapshot still names Alice/Poisoner,
while the removal record carries its own (or no) provenance.

### History (category `effect`)

One record per changed operation, at the current moment (Live Play only; Setup
records none):

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

## Stacking and precedence

Effects stack by identity: same type from several sources, manual + ability,
Drunk + Poisoned, Poisoned + protections, several protections. The lifecycle
infers no cancellation or precedence and never deletes an instance because
another overrides it (Poisoned + Sober & healthy coexist) — later evaluation
(10F) reads the instances.

## Queries and presentation registry

`src/stores/effects.ts`: `hasEffect` (**effective**: active only — for
mechanics), `hasStoredEffect` (exists, even suppressed), `effectiveEffects`,
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
  each instance's origin, applied moment, expiry, state, note and parameters
  with Suppress/Resume, Remove, "Recorded in error" (correction) and, for an
  unresolved legacy lifetime, one-tap "Ends as … begins"; *+ Add effect* — the
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
under an existing id, a timed lifetime in Setup, or an `appliedAt` other than
now). `removeEffect(id, effectId)` → one `remove` intent. None bypasses the
planner.

## Membership / Undo / recovery

Effects belong to participation instances: unseat rebuilds a blank seat and
removal deletes the record, so a replacement occupant never inherits Effects;
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

## Non-goals (deferred)

No Role ability logic (Poisoner, Monk, Sailor, Innkeeper, Courtier, Preacher,
Barista, Bone Collector, Cerenovus, Harpy, Witch, Fearmonger, Exorcist, Spy,
Recluse, Fortune Teller…), registration, jinxes, precedence/cancellation rules,
ability grants, Role/Alignment changes, global modifiers, Reminders (10C),
nominations/voting. The legacy `statuses` field and `BehaviorMode: "poisoned"`
are unchanged.
