# Phase 10C — Reminder Workflow & Visual Reminder Tokens

Status: **IMPLEMENTED — Astra remediation complete, awaiting targeted verification.** Not closed.
Store schema **v21** (`GAME_SCHEMA_VERSION = 21`, `STORE_VERSION = 21`).

Starting checkpoint: `70864ada51f887399d5d3529a450204468fc8d65` (main =
dev/phase-10b = dev/phase-10c at implementation start; reviewed 10B parent
`3c9e20f4506258bab143b5f20750deb34b290379`).

Closure still requires: Luna verification → Astra adversarial review → Sol
adjudication / remediation → closure verification → Sol closure →
integration into `main`.

## Luna remediation (LUNA-10C-001 / LUNA-10C-002)

Luna verification of `94c93390c8cf4bea915b1319fc2910cac81b5ed7` returned
REVISE; both findings were accepted by Sol and are remediated. Status is still
**IMPLEMENTED — awaiting Luna re-verification**.

- **LUNA-10C-001 (MEDIUM) — fail-closed empty-seat migration.** v20 -> v21
  now runs an entry-level preflight over every Reminder on every seat
  (empty seats included) against the exact v20 Reminder contract
  (`LegacyV20ReminderRecordSchema`, a verbatim copy of the v20 schema). Any
  malformed Reminder leaves the whole entry untouched and unstamped (rejected
  by the v21 schema) -- nothing is dropped, transformed or half-migrated.
  Only when every Reminder is valid v20 data are orphans dropped, occupied
  Reminders transformed and the entry stamped 21.
- **LUNA-10C-002 (LOW) — strict keys by presence.** One rule
  (`unknownOwnKey`) for every caller-facing Reminder object: transaction,
  intent, participant bindings, Place spec, Amend changes, correction
  amendment and cleanup request; the raw Mutation Context is parsed by the
  strict schema (not an undefined-stripped copy); `addReminder` applies the
  same rule to its input. An unknown key is refused even when its value is
  `undefined`; a known optional field given as `undefined` keeps its meaning.

## Astra remediation (ASTRA-10C-001 … 004)

Astra adversarial review of `7ddc3fb9f566f429a5c5a6e0f4d0b8bbbabb5ae4`
returned REVISE; Sol accepted all four findings.

- **ASTRA-10C-001 (HIGH) — unique current ParticipantIds.**
  `StorytellerGamePersistedSchema` (the boundary every Current State, Undo
  snapshot and recovered checkpoint passes) now enforces that every occupied
  seat's ParticipantId is unique within the snapshot
  (`checkCurrentParticipantIdentityUniqueness`). Empty seats and historical
  ParticipantRefs are outside the set, so repeated/departed historical refs
  stay valid. Duplicates are rejected, never repaired; Life/Effect/Reminder
  planners are unchanged and keep assuming a valid game.
- **ASTRA-10C-002 (MEDIUM) — legacy Reminder History.** An operation-less
  Reminder record may only be `added`/`removed` (a `value` one is rejected,
  never read as an amend), and an operation-less snapshot carrying a
  `cleanupCue` is rejected as a hybrid. `hasV21Evidence` now treats a
  `cleanupCue` inside any Reminder History snapshot (`item`, `from`, `to`) as
  v21 evidence, so marker-20 or marker-less hybrids are never migrated.
  Genuine legacy add/remove History (lifetime snapshots, mirrored origin
  provenance) is still accepted and never rewritten.
- **ASTRA-10C-003 (MEDIUM) — per-entry routing before old store steps.**
  `migrateStoreState` classifies Current State and each Undo entry
  independently, from its untouched content, with `detectLegacyGameVersion`
  (`null` → the envelope's version) before any old step. A game-content step
  targeting version N runs on an entry only if both the envelope and that
  entry are older than N; the entry then migrates from its own routed version
  (the same answer checkpoint recovery reaches). Marker-21 entries receive no
  legacy repair; marker-20 entries receive only v20 → v21; genuine legacy
  saves migrate as before. Envelope metadata (localSeq/sync) is still
  migrated by the envelope version; the pre-v8 lobby step, which would drop
  Undo and rewrite the game, fails closed if any entry is itself v8 or newer.
- **ASTRA-10C-004 (LOW) — sparse intent arrays.** Every index
  `0 <= i < length` must be an own element holding a known intent object
  before any intent is dereferenced; a hole is a structured `invalid` refusal
  with its `intentIndex`, never an exception.

## The rule

> Silverwick knows that a Reminder is something the Storyteller wants to
> remember — not something the rules engine believes is true.

A **Reminder** is participant-bound, Storyteller-private, non-authoritative
notation for human bookkeeping. It is never a source of mechanical truth. No
mechanic, rule query, planner or future ability evaluator may answer a rules
question from `player.reminders`; labels and notes are never parsed. Phase 10F
may *write* Reminder notation through the 10C seam; it must never *read*
Reminders to determine rules.

### Effect / Reminder truth boundary

| Fact | Authoritative home |
|---|---|
| Poisoned / Drunk / Protected / Mad / ability lost | Effect |
| alive / dead | Life State / Life Event Window |
| ability used | `abilityUsed` |
| Actual Role / Alignment | Role / Alignment Current State |

No Reminder establishes any of these. The v21 record has no `semanticType`,
no mechanical parameters, no Effect link, no authoritative state and no
expiry. A free-text "Poisoned" Reminder is allowed and inert; the UI shows a
non-blocking hint ("Poisoned is tracked as an Effect…") and never converts,
blocks or later inspects it.

## v21 record

```
ReminderRecord {            // strict: unknown keys rejected, never stripped
  id                        // unique within one participant's reminders[]
  label                     // required display text; no length rule in the schema
  sourceCharacter?          // origin (not mutation provenance)
  sourceParticipant?        // durable ParticipantRef, built centrally
  createdAt?                // planner-generated; absent only on migrated legacy
  cleanupCue?               // { kind: "at", moment: LiveGameMoment } | { kind: "unresolved" }
  note?                     // Storyteller text, never parsed
}
```

`lifetime` is removed. Schema invariants (Current State, every Undo snapshot,
every recovered checkpoint): duplicate ids rejected; **an empty seat owning a
Reminder is rejected**; a `createdAt` after the snapshot's own moment is
rejected (Setup: exactly `{setup, 0}`; ended: frozen). A cleanup cue is not
temporally judged — a cue at/before now is exactly "Needs cleanup".

## The seam

```
ReminderIntent[] → planReminderTransaction(game, tx, ids?)   (pure)
                 → ReminderPlan | no-op | ReminderRefusal
                 → applyReminderPlan(game, plan)              (pure)
                 → resolveReminders (store): one replacement,
                   one Undo entry, one localSeq step, one projection cycle
```

`src/stores/reminderResolution.ts`. The planner binds every target/source to
`{ playerId, participantId }` (stale → refused, never applied to a
replacement occupant), validates caller input strictly -- unknown keys refused by presence, even when undefined (unknown / smuggled
`sourceParticipant`, `createdAt`, `cleanupCue`, `lifetime`, exact cue
moments, extra binding keys, malformed Mutation Context → `invalid`), builds
durable refs, fills `createdAt` and resolves cues, plans History, and is
all-or-nothing across up to `MAX_REMINDER_INTENTS` intents. Refusals:
`invalid | phase | notSeated | stale | notFound | conflict | immutable |
mixedCorrection | tooMany`, with `intentIndex` where useful; every refusal
leaves game, History, Undo and localSeq unchanged.

| Gameplay | Correction |
|---|---|
| `place` — new instance; no id → fresh `rm-…`; same id + identical content → no-op; different content → `conflict` (never upsert) | `correctPlace` — recorded now, never backdated |
| `amend` — `note` and `cleanup` only; id/label/source/character/createdAt → `immutable`; resolving an `unresolved` cue → `immutable` ("resolve it as a correction") | `correctAmend` — label, origin (a bindable current participant), character, note, cleanup; never id/createdAt |
| `remove` — exactly one identity; absent → no-op | `correctRemove` — recorded in error |

Gameplay and correction never mix (`mixedCorrection`). Ended games refuse
everything (`phase`). Setup mutations record no History.

### Cleanup cues (presentation only)

The only caller request is `{ kind: "nextPhase" }`, resolved once: Setup →
Night 1, Night N → Day N, Day N → Night N+1. `reminderCleanupStatus` derives
`due` / `check` / `scheduled` / `none` at render time; nothing derived is
stored. `advancePhase` does not read or touch Reminders: records are
byte-for-byte unchanged across rollover, no Reminder History is written, and
Undo of a phase advance only changes the derived status.

### History (category `reminder`)

New v21 records carry `reminderOperation` (`place` → `added`, `remove` →
`removed`, `amend` → `value` with full before/after snapshots), optional
`correction: true` and `resolutionId`. Their snapshots must be complete strict
v21 Reminders. Participant = durable ref of the bound target. **Mutation
provenance comes only from the validated Mutation Context** — never from the
Reminder's origin or note (`provenanceOf` is no longer used). Net-zero
identities within one transaction leave no History (SOL-10B-R9 principle).

**Legacy Reminder History is backward compatible and never rewritten**: a
record without `reminderOperation` keeps its pre-v21 shape (generic
added/removed, `lifetime` inside snapshots, provenance mirroring origin) and
is judged only by its original Phase 9R.2 source contract. A legacy record
may not carry `correction`/`resolutionId` (those are v21-only).

## ParticipantId / empty seats

`occupySeat()` now starts every participation instance with `reminders: []`
(as well as `effects: []`) — `addPlayer`, `addPlayerToSeat`,
`assignPendingToSeat` and `restoreSeatedMember` all flow through it. Unseat
rebuilds a blank seat; removal deletes the record; neither writes History.
Membership transitions keep clearing Undo. Origin refs never retarget when a
PlayerId is reused.

## v20 → v21 migration

`migrateEntryV20ToV21` in `gameMigration.ts`, shared by local Current State,
every Undo snapshot (independently) and remote checkpoint recovery. Never
consults or rewrites History; deterministic and idempotent.

| v20 | v21 |
|---|---|
| manual lifetime | lifetime removed, no cue |
| finite lifetime | lifetime removed, `cleanupCue: { kind: "unresolved" }` (never inferred) |
| Reminders on an **empty seat** | **dropped** (no owner invented, nothing transferred, no History) |
| temporally impossible legacy `createdAt` | omitted (never replaced) |
| labels, notes, ids, origin refs | preserved exactly (legacy refs never re-resolved) |
| any malformed Reminder on any seat (orphans included) | the whole entry is left untouched and **not stamped** 21 → rejected |

### Version evidence

- marker `20` → exactly v20 → v21, nothing older;
- marker `20` + any v21-only evidence (`cleanupCue`, `reminderOperation`, a
  reminder `correction`/`resolutionId`) → malformed current data: no repair,
  rejected;
- marker `21`, or any malformed/unsupported marker → no migration; the v21
  schema judges (rejects) it;
- marker-less v20/v21 evidence → never treated as legacy; rejected;
- marker-less genuine legacy → existing chain → v20 → v21 (only here; a
  marker-less entry under a v20+ envelope is never stamped into validity).

`detectLegacyGameVersion` reports 20 for marker 20, 21 for 21/malformed
markers and marker-less v21 evidence. `PREVIOUS_GAME_SCHEMA_VERSION` names the
one earlier marker still migrated. The ASTRA-10B-002 principle is preserved.

## Privacy / projections

Reminders stay Storyteller-private: absent from public, self and Public
Display projections. Under Privacy Mode no label, chip, count, overflow,
cleanup state, tooltip or accessible text is rendered (DOM absence); the
Drawer shows the safe view, which unmounts the Reminder section, so an open
detail closes and never reopens when Privacy Mode ends.

## UI

- **Drawer → Reminders** (`src/features/reminders/ReminderControls.tsx`),
  keyed by ParticipantId: type + Add, or one-tap safe presets (Knows, Did not
  act, Dies tonight — Used/Drunk/Poisoned/Protected/Mad removed); one row per
  instance with a one-tap remove; row disclosure shows origin (departed
  participants by durable name + "(left)", resolved by ParticipantId, never
  the seat's current occupant), placed moment, cleanup hint, note, amend
  controls, "Recorded in error", and correction controls for a legacy "Needs
  check"; "More options" adds source (character pre-filled), cleanup hint and
  note — never required.
- **Grimoire token grammar**: a distinct notation family (dashed notched tag
  with a ✎ glyph — never the Effect artwork or pill), identical labels
  aggregated (`Chosen ×2`), attention-first ordering, at most 4 chips with an
  explicit `+N more`, due/check shown in words (`· cleanup` / `· check`) plus
  a double border. The token's accessible name appends e.g. `3 reminders:
  Chosen ×2, Master; 1 needs cleanup`. Chips are presentational (`aria-hidden`):
  the token is already one keyboard/touch control that opens the Drawer's
  per-instance controls, and nested controls inside it would be flattened by
  assistive technology.

## Architecture guard

`src/stores/reminderArchitecture.test.ts` scans source (comments stripped):
named mechanics modules (Life, Effects, setup analysis, night order,
identity/projection/perception…) never touch Reminders, and every production
module that does is on a short reviewed allowlist of persistence / seam /
presentation modules; the seam itself reads no Effect/Life/Role/Alignment
state and never compares label text. A planted-violation self-check proves the
detector works. (The unused `findReminder` helper was removed from the Effect
query module.)

## Future 10F composition

```
workingGame → planLife → applyLifePlan → planEffects → applyEffectPlan
            → planReminders → applyReminderPlan → (future coordinator commits once)
```

Proven in `reminderResolution.test.ts` with a shared `resolutionId`. No
coordinator is implemented in 10C.

## Firebase

No rule, writer, lease, guard or revision-fencing change. Reminders travel
inside the game snapshot exactly as before.

## Deferred / non-goals

Canonical per-character Reminder tokens and a `(roleId, label)` disposition
table (→ 10F); Role-specific bookkeeping (Red Herring, Master, Twin, Chosen);
a cross-domain coordinator; correcting an origin to a departed participant
(same safe limitation as OPUS-10B-010).
