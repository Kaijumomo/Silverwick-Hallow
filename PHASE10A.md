# Phase 10A — Life State, Life Events, Day Resolution & Visual Life Grammar

Status: implemented, awaiting Luna verification. Store schema **v19**.

## Model

| Concern | Where | Notes |
|---|---|---|
| Current life truth | `STPlayerRecord.alive / ghostVote / exiled / abilityUsed` | Unchanged fields; `exiled` = the *current* death was a Traveler exile. "Not exiled" is stored as an absent key. |
| Recent life events | `game.lifeEventWindow` (`LifeEventWindow`) | Authoritative, temporary, Storyteller-private. Current + immediately previous phase only. |
| Explanation | `game.history` (`"life"` records) | Mirrors the state diff and/or the event added/removed, plus `correction: true`. Never queried by mechanics. |

Life Events: `death` (Night or Day, no outcome), `execution` (Day, outcome
`died | survived | alreadyDead`), `exile` (Day, Traveler, outcome
`died | survived`), `resurrection` (no outcome). One semantic action = one
event per subject. Generic death = `kind === "death"` or `outcome === "died"`.

## The mutation seam

`planLifeTransaction(game, { intents, context?, resolutionId? })`
(`src/stores/lifeResolution.ts`) is pure: guard → plan (player patches, next
window, one History record per affected participant) or a structured refusal
(`refused` / `needsConfirmation`) or a true no-op. `resolveLife` in the store
commits an accepted plan as one game replacement (one Undo entry, one localSeq
step). Every Life command (`recordDeath`, `recordExecution`, `recordExile`,
`resurrect`, `spendGhostVote`, `restoreGhostVote`, `correctLifeStatus`,
`retractLifeEvent`, `amendLifeEvent`, `lateRecordLifeEvent`) wraps it.

A future ability engine submits already-resolved intents — several subjects
at once if needed, correlated by `resolutionId` — through the same
`resolveLife`. Phase 10A contains no Role logic.

Legacy `setAlive` / `setGhostVote` / `exileTraveler` remain only as
deprecated adapters over the semantic commands (`setAlive(true)` is a status
correction, never a resurrection). No production UI uses them.

## Starting life state (10A-LUNA-001)

Setup life fields are never gameplay (Setup life commands are refused). At the
single Setup → Live Play boundary, `beginNightOne` (which `setPhase` and
`advancePhase` delegate to from Setup), every occupied participant is set to
canonical starting life — alive, vote held, not exiled — by
`canonicalizeStartingLife` in the same commit that starts Night 1. This covers
stale values a migrated v18 Setup may carry. It records no Life Event, no
History and no Provenance; empty planned seats and `abilityUsed` are
untouched. Undo of the start restores the exact pre-start Setup snapshot;
starting again canonicalizes again. `undo` and `restoreRemoteCheckpoint`
replace the whole game with an existing snapshot, so no Setup field crosses
into Live Play through them; later Night ↔ Day changes never touch life state.

Setup is pre-game only (10A-LUNA-RV-001): `setPhase("setup")` from Night or
Day is refused with no change, and `beginNightOne` is refused outside Setup
(setup readiness), so canonicalization can never rerun over live play. Undo of
the initial start, adopting a genuine Setup checkpoint and New Game still
produce Setup legitimately.

## Window, coverage and rollover

- Every phase change (`advancePhase`, `setPhase`, `beginNightOne`) prunes the
  window to {current, previous} inside the same commit and Undo snapshot. No
  History is written for expiry. Entering `ended` freezes the window.
- `coverageFrom` is the earliest moment from which *absence* of an event means
  "none occurred". Queries (`src/stores/lifeEvents.ts`) return `unknown`
  (`notCovered` / `expired` / `future`) instead of an empty result otherwise.

## v18 → v19 migration

Applied identically to local Current State, every Undo snapshot, and remote
checkpoint recovery (shared `migrateGameEntry`). Life Events are **never**
backfilled from History. Each entry gets an empty window whose coverage
starts at the *next* phase, because its current/previous phases were not
observed under the v19 event model:

| Entry state | `coverageFrom` |
|---|---|
| Setup | Night 1 |
| Night N | Day N |
| Day N | Night N+1 |
| Ended (day N) | Night N+1 — never reached, so the window is inert |

A `coverageFrom` later than the current phase is intentional, not an error:
recent pre-migration absence stays **unknown**. Migration is deterministic and
idempotent (no ids, clocks or randomness).

Version evidence: `lifeEventWindow` (or a life History `lifeEvent` /
`correction`) is v19 evidence by *presence*. Such an entry is never migrated;
a malformed window fails the v19 schema (local reset / checkpoint rejected)
instead of being replaced by a fresh one. `lifeEventWindow.events` defaults to
`[]` only when absent, because the RTDB `storyteller` projection drops empty
arrays (the same convention as `history`).

Schema validation is structural (ids, ParticipantRef, moments, kinds,
required/forbidden outcomes, Day-only kinds, unique ids). It deliberately does
not reject stale events, departed subjects or state/event disagreement.

## abilityUsed audit

Production uses of `abilityUsed`: set `false` on a fresh Deal/Setup
assignment (`freshAssignment`) and on `assignRole`; toggled manually in the
drawer ("Ability used"); read by the night order to skip a used
`oncePerGame` Role and to show a "used" badge. It is the generic
current-ability-used marker, so a true resurrection resets it; a status
correction never does.

## UI

- Grimoire token: shroud ("Dead"/"Exiled"), vote token (solid = available,
  struck ring = used), text ("Dead · vote used"), Storyteller-only "Needs
  check", accessible name "Alice, seat 3, dead, vote available". Privacy Mode
  keeps life visible.
- Drawer "Life" section: labelled semantic actions only; inline confirmation
  for an additional execution or a Traveler executee; explicit status
  correction.
- Day: **Day resolution** (execution with the actual executee and outcome;
  Traveler exile Died/Survived). **Dusk review** on Day → Night reads the
  window, requires confirming "no execution" on a covered Day, and says
  "unknown" otherwise. **Life events**: bounded current/previous-phase list
  with retract / amend / late record, each with an explicit status repair.
- Public display and player town list use the same public grammar
  (`publicLifeOf`); a dead Traveler stays visibly dead over Role art, and
  exile-death is public (`PlayerPublicRecord.exiled`).

## Deferred (Phase 10B+)

Role ability resolution (Imp, protection, poisoning, Shabaloth, …), public
registration effects such as Zombuul (to be applied inside `publicLifeOf`),
long-lived Role-specific life memory, nominations and voting.
