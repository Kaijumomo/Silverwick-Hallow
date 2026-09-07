# Phase 6 — AUD-013 and AUD-027

## Baseline and verification

Phase 5 was committed as `2028a2e9e8ecdbfa22ee3746cfc0597220424a35`
(`fix: separate actual and shown player identity`). The working tree was clean
before Phase 6 implementation. HEAD remains that commit.

| Check | Phase 6 starting baseline | Final Phase 6 verification |
| --- | --- | --- |
| Normal tests | 305 passed, 0 failed, 0 skipped | 344 passed, 0 failed, 0 skipped |
| Firebase RTDB emulator tests | 56 passed, 0 failed, 0 skipped | 57 passed, 0 failed, 0 skipped |
| Production build | Passed | Passed |
| git diff --check | Passed | Passed |

Commands: `npm test`, `npm run test:rules`, `npm run build`, and
`git diff --check`. Emulator tests ran against the local demo project, not
production. The pinned Firebase CLI emits a future Java-version warning;
the emulator suite exits successfully. No dependency was upgraded.

Phase 6 is uncommitted. No push or deployment was performed.

## Findings confirmed before implementation

AUD-013 reproduced: the old night-order effective-role resolver returned no
player step for Marionette behavior even when a shown good character was
configured. Normal behavior used actual identity; Drunk and Lunatic behavior
used shown identity.

AUD-027 reproduced: privateInfo values were copied directly into the self
projection with no explicit preview/publication acknowledgement workflow.
Existing projection tests expected this automatic copying. Fake-minion IDs
and extra text had no usable player-screen presentation.

The existing night path remains NightOrderPanel → computeNightOrder → script
night instructions and persisted progress. The old effective-role helper was
replaced with a centralized, read-only wakeIdentity resolver.

## Final identity and wake model

Actual identity remains authoritative Storyteller-only state. Explicit shown
identity remains the Phase 5 player perception. Missing shown identity still
produces no player identity and no inferred actual-role wake.

Wake identity resolves the explicit shown role through the existing role
registry. It is metadata for the Storyteller's procedure, never a mechanical
ability assignment. A step is simulated when a centralized deception policy
requires it, the actual and shown role differ, or an existing deceptive
behavior mode applies.

| Player | Shown/wake identity | Storyteller operation |
| --- | --- | --- |
| Ordinary Empath | Empath | Existing Empath wake procedure |
| Drunk shown Empath | Empath | Simulated procedure; manually choose information; actual Drunk remains unchanged |
| Marionette shown Fortune Teller | Fortune Teller | Simulated good-character procedure; excluded from standard Minion introduction |
| Lunatic shown Imp | Imp | Simulated Demon procedure and explicitly selected information; never an actual Demon effect |

Night steps retain Storyteller-only actual role, wake role, simulated flag, and
player ID linking the relevant packet. The UI labels simulated wakes with
actual identity and a no-real-ability warning. These annotations never enter
player projections.

Standard team-introduction recipient lists exclude simulated identities.
Private-information tasks also appear independently of numeric wake slots,
so a Lunatic shown Imp has a first-night delivery task even when Imp has no
individual first-night slot in the existing dataset.

Changing shown role changes future wake steps. Step progress keys now include
shown role, preventing completion of one apparent character's step from
silently completing another. Old legacy progress keys are retained in saved
data but no longer applied to the new role-keyed steps.

## Private packet and delivery model

The existing privateInfo fields remain drafts: bluffs, fakeMinions selections,
and extraText. A packet captures explicit shown role/alignment and only those
selected fields. No actual team lookup is performed.

Fake-minion selections become neutral player-facing `minions` records with
the selected names and seat numbers captured at preview time. They contain no
roles. The internal `fakeMinions` field name is not published. Later seat reuse
cannot make an old delivered name silently become the new occupant's name.

States are:

1. **Not configured:** no draft content.
2. **Configured:** draft exists, but has not been reviewed for its current
   identity, referenced players, and day/phase.
3. **Previewed / ready:** the preview fingerprint matches the current draft and
   delivery context.
4. **Queued:** an explicit Publish action is in the existing session writer.
5. **Published:** the server acknowledged that exact sanitized player record.

Ready validates shown identity, nonempty content, resolvable bluff roles,
and nonempty other-player selections. It does not claim every BOTC character's
information is mechanically complete. The Storyteller decides appropriate
content and timing.

The player editor and night sheet share the packet controls and player-safe
preview renderer. The last published snapshot can be inspected separately
from a newer draft, with its day/phase context. A new day/phase requires another
preview; earlier information remains available as previously published.

“Published” means accepted by Firebase, not read or acknowledged by a human.
There is no player-read receipt or new messaging protocol. Night-step completion
does not publish information.

## Synchronization, privacy, and lifecycle

Publication checks the active code/session, current preview, and authoritative
roster inside the existing serialized SessionWriter operation. It uses
writeProjections to atomically send the self payload and Storyteller/checkpoint
snapshot. Local publication metadata is committed only after the write is
acknowledged. Duplicate queued clicks are rejected.

The existing lease, revision fence, and retry receipt handle failed writes and
lost responses. A retry reuses the same packet and guarded write. Draft edits
made during an in-flight write remain drafts. Identity changes invalidate the
packet epoch, preventing a delayed acknowledgement from restoring the old
packet into a new perception; the ordered normal flush reconciles the new view.

The self boundary reads explicit identity and, when compatible, the sanitized
published snapshot. It does not read actualRole and does not copy drafts.
Allowlisting strips Storyteller fields and legacy deception labels. Unknown
or malformed remote minion records still pass through runtime validation and
are rejected when invalid.

Refresh, reconnect, navigation, and host takeover restore the published
snapshot separately from any newer draft. Recovery's acknowledged flush
rebuilds ephemeral publication receipts. Configured-only previews stay private.

Actual/shown role changes invalidate old packet snapshots and clear old drafts
under Phase 5 semantics. Alignment or behavior changes invalidate preview and
publication, retaining draft content for deliberate re-review. Manual actual
assignment remains private; ordinary explicit show/deal behavior is unchanged.

Removal uses the existing Firebase-first revocation/private-record deletion.
Empty/reused seats and new games cannot inherit packet state. Information
already seen by a person cannot be retracted.

## Regression evidence

The normal suite adds 39 tests covering wake identities and mechanical
non-mutation, missing perception, introduction exclusion, future role steps,
draft/preview isolation, sanitized publication, runtime validation, stale
previews, day changes, identity changes, seat reuse, new game, duplicate queue
protection, delayed acknowledgement, failed/lost-response retries, player
refresh, host recovery, and UI preview/sealed-card presentation.

Existing tests which expected automatic privateInfo exposure now explicitly
construct already-published fixtures. They still test cross-player/public
isolation; separate new tests ensure drafts never publish automatically.
Ordinary night fixtures now explicitly initialize shownRole, matching Phase 5,
instead of requiring an actual-role fallback.

The emulator addition exercises the real guarded publication command:
Alice can read the published intended payload; Bob cannot read it; Alice cannot
read preview/checkpoint/publication metadata or forge private data; revocation
removes access and the private record. Existing 56 security cases remain passing.

A getter-trap regression proves projectToSelf never accesses actualRole even
with a published packet. Wake tests compare authoritative state before/after:
the resolver and night computation do not mutate actual role, role type, ability
state, or effects.

Phases 1–5 remain intact: no Firebase rules, membership commands, writer lease
engine, reconnect manager, join trust model, or canonical role dataset was
changed. Runtime schemas were extended, not bypassed.

## Manual operation and deferred scope

The Storyteller still chooses truthful/false information, bluff completeness,
team selections, timing, and real effects manually. No automatic Empath result,
fake-team generation, kill, or gained ability is computed from wake identity.

Phase 7 remains responsible for AUD-011 role text, AUD-012 canonical numeric
night order, and AUD-014 global conditional introductions/Poppy Grower. Existing
numeric global positions and character datasets were deliberately left intact;
the packet API is the integration point for delayed team information.

AUD-017 independent alignment, gained abilities, death registration, and
complete mechanical ability resolution remain deferred. Existing dead-player,
once-per-game, and behavior-mode limitations were not redesigned.
There is no complete Lunatic engine or structured fake-Demon/team-information
engine; the pre-existing model has no fakeDemon field, and extraText supplies
manual instructions where appropriate.

Setup analysis, Travelers, custom scripts, visual/mobile/accessibility work,
and broad dependencies are unchanged. This verification covers automated
store/UI tests and real emulator authorization; no production two-device
gameplay session or deployment is claimed.
