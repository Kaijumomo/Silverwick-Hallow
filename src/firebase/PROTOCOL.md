# Lobby protocol

This document describes the active Firebase protocol for Silverwick Hallow.
Deploy the matching client and `rules.json` together. Existing pre-Phase-4
lobbies use the legacy shape and must be retired rather than silently migrated.

## Session and ownership

Each new lobby has an eight-character confusable-glyph-free code and these
identity records:

| Path | Meaning and access |
| --- | --- |
| `storytellerUid` | Immutable authenticated owner; only the owner can claim it |
| `session` | `{version: 2, id, state}` lifecycle record; authenticated reads, owner writes |
| `writer` | Short-lived owner lease `{token, expiresAt}`; owner reads/writes |
| `writeGuard` | Monotonic `{token, revision}` receipt used to fence stale writes |

The Storyteller claims `storytellerUid` with `setIfAbsent`, then creates a new
active session ID. A `SessionWriter` must acquire the lease before writing. It
renews every ten seconds, expires after thirty seconds, and carries its token
and an increasing revision on every projection or lifecycle update. Firebase
rules reject an expired token, an old token, or an older revision. A second tab
gets a controlled conflict; it can reclaim only after the lease expires.

## Request and membership paths

Names and authoritative IDs have separate paths. A request is never an
authorization claim.

| Path | Meaning and access |
| --- | --- |
| `joinRequests/{uid}` | Canonical 1–20 character name; own UID creates/cancels, Storyteller deletes; own UID and Storyteller read |
| `roster/{uid}` | Storyteller-only authoritative UID → player ID binding; bound UID and Storyteller read |
| `rosterParticipants/{uid}` | Storyteller-only `{playerId, participantId, name}`: the participation instance that binding seats (Phase 9R.2). Written and deleted only in the same update as `roster/{uid}`; owner reads, no player ever reads |
| `membershipRevocations/{uid}` | Storyteller-only `{playerId, participantId, action: "unseat" \| "remove"}`: receipt of a committed Storyteller revocation that owes a local occupancy completion (Phase 9R.6). Written only in the same update as the revocation; cleared when that UID is seated again and at session close; owner reads, no player or display ever reads |
| `outcomes/{uid}` | Storyteller records `rejected` or `revoked`; that UID reads its outcome |
| `leaveRequests/{uid}` | A seated UID requests departure; that UID creates, Storyteller consumes |
| `public` | Storyteller projection; active request holders and members may read |
| `player/{playerId}` | Storyteller private projection; only a UID bound to exactly that ID may read |
| `storyteller` | Full Storyteller state; owner only |
| `checkpoint` | Acknowledged game plus roster snapshot for takeover recovery; owner only |
| `presence` | Parent read by the Storyteller; each UID reads/writes only its own child |

The join handshake normalizes the code and name once, validates the active
session, checks any durable outcome, and creates an absent request. It never
uses a persisted player ID as authorization. Seating and revocation reuse the
Phase-3 Firebase-first membership commands. Rejection clears the request and
records an outcome atomically; a stale reject cannot strand a player who was
already seated. A player cancelling before acceptance clears its own request;
a seated player writes a leave request that the Storyteller consumes through
the same revocation command.

## Join and reconnect state

Player state progresses through `knocking` → `waiting` → `seated`, with
`reconnecting`, `rejected`, `revoked`, `notFound`, `ended`, and `error` as
explicit recovery or terminal states. On refresh, the client reads session,
outcome, its own roster entry, and its own request before installing listeners.
Private data is subscribed only after an authoritative roster binding exists.
Missing or ended sessions terminate promptly; malformed snapshots are rejected
at the validation boundary.

An explicit `?join=` URL wins over a stale saved session. Without new intent, a
saved session resumes only for the same authenticated UID and matching code.
After a successful join the canonical code is written back to the URL so a
refresh does not create a duplicate request.

## Storyteller synchronization and recovery

The active session manager is mounted at the app level, not on `GameScreen`.
It owns the writer, projection debounce, request/roster/leave watchers,
presence watcher, and session/lease conflict detection while the lobby is
active. Navigation to Home or the New Game screen does not pause it. Ending or
losing the session stops listeners and aborts pending work.

On takeover, an acknowledged `checkpoint` is the recovery point. The current
server session and roster are read first. The checkpoint game is restored only
when the session ID still matches; membership differences are reconciled
against the current roster, and an unresolvable current binding is revoked
instead of being trusted.

Phase 9R.2: a seat (player ID) is reusable, so a live binding keeps the
recovered game's occupant of its seat only when that occupant is proven to be
the participation instance the binding seats: its ParticipantId equals the
binding's `rosterParticipants/{uid}.participantId`. A matching player ID, UID,
name, or seat is never proof. An unproven occupant is unseated in the
recovered game (its History is untouched), and the seat is rebuilt for the
live binding with the binding's own recorded ParticipantId and seat-time name;
a binding without a record falls back to the pending queue (a fresh
participation instance) or revocation. A binding with no record (created
before records existed) is accepted as proven only for a same-device
reconnect whose writer guard shows no other writer has committed since this
device's last acknowledged commit.

Phase 9R.6: an explicit Storyteller unseat/remove (including an accepted
leave request, always an unseat) writes `membershipRevocations/{uid}` in the
same guarded update that revokes the binding, naming the exact ParticipantId
revoked (from the binding's `rosterParticipants` record, or for a record-less
binding the local occupant this writer lineage publishes to it) and the
Storyteller's intended local completion. Reconnect -- automatic or explicit,
KEEP_LOCAL or RESTORE -- completes that action before the initial flush, but
only on a seat whose current occupant carries exactly that ParticipantId; a
missing roster binding alone never unseats a locally typed player, and a
later participant at the same player ID is never touched. The initial projection is acknowledged before the
writer is exposed to UI controls. Thus an older local snapshot cannot overwrite
newer remote membership or an ended session.

`writeProjections` remains the projection chokepoint. It writes public/private
views, Storyteller state, and a checkpoint containing the game and the
authoritative roster snapshot in one writer-guarded update. Membership commands
are the only intentional lifecycle exceptions.

The checkpoint game carries no explicit schema version. Recovery infers the
newest supported legacy shape (v13–v17) the game itself evidences, then runs it
through the same migration as local persisted state (`migrateGameEntry` in
`src/stores/gameMigration.ts`) before validating it against the current schema.
A checkpoint carrying v17 participant-identity evidence is detected as v17. A
markerless modern game may conservatively be detected as an earlier supported
version, such as v16. An example is a valid empty game with no participant
identity, History, or Information Delivery. For an already-current markerless
shape, those intermediate migration steps are no-ops. The shared migration then
still reaches the idempotent store-v18 step that renames the History category
`"identity"` to `"role"`. So both legacy v17 and already-v18 checkpoints recover
correctly without a checkpoint version field.

## Presence

The Storyteller subscribes to `presence` at the exact parent path authorized by
the rules. Players can read and write only `presence/{theirUid}`; they cannot
enumerate other players. Presence state is `unknown`, `ready`, or `error`.
An error never becomes “everyone offline.” Confirmed offline values are shown
only after a valid presence snapshot; missing/stale records remain unknown and
expire locally after the documented heartbeat window.

## Ordering, end, and retry behavior

All writer operations are serialized. `close()` first stops new commands,
cancels old retry backoff, and publishes a guarded `public/status = ended`
sentinel so new joins stop immediately. It then drains any already-started
write, reacquires its lease, and performs one final guarded multi-path update
that marks `session.state = ended` and removes roster, participant records, requests, leave requests,
private projections, Storyteller state, and checkpoint. It then stops listeners.
Rules allow no new join after the sentinel or projection after the session is
ended, and stale revisions cannot revive it.

Transient network failures use bounded exponential backoff (250/500/1000 ms,
four attempts including the initial call). Retry is cancelled when the writer
or operation is stopped. Authorization, validation, conflict, and terminal
session errors are not retried as network failures. A write retry first checks
the guard receipt, so a lost acknowledgement does not duplicate an applied
write.

## Migration and legacy data

This is a coordinated hard cutover. Retire legacy lobby nodes, deploy the rules,
clear persisted lobby sessions, and create fresh codes. Legacy lobbies without a
version-2 session are not joinable or writable by the new client. A persisted
Storyteller lobby is cleared during the store migration; a new game always
creates a fresh local identity and no lobby. No production migration is
performed by the test suite.

## Phase 5: actual, shown, and published identity (AUD-004)

Actual role and behavior mode are authoritative Storyteller-only state in
`storyteller` and `checkpoint`. Neither is read by the self projection.
`shownRole` is explicit intended perception. A null shown role produces no
self record, no alignment, and no private packet; the player sees the existing
waiting card. A null shown alignment derives solely from the explicit shown
role's definition. There is no independent actual-alignment field in this
model; a full alignment redesign remains AUD-017.

The published identity is the acknowledged `player/{id}` record, not the
actual assignment or the player's local “tap to reveal” flag. The latter only
seals a card whose data has already arrived. Store edits express intended
perception; the existing serialized session writer publishes it with the
Storyteller state and checkpoint. Pending or failed writes do not mean an
identity was delivered. No new authorization path or delivery state machine
is introduced.

Bulk dealing uses the centralized `stores/identity.ts` setup policy to
establish ordinary shown role/alignment explicitly. Drunk, Marionette, and
Lunatic receive actual roles but no shown identity until configured. The
Storyteller selects a Townsfolk for Drunk, a good character for Marionette, or
a Demon for Lunatic. Shown alignment follows that perception. Their existing
behavior modes are initialized for configuration; this phase adds no new
false-role wake or false-team delivery behavior.

Manual actual-role assignment does not publish identity. It preserves shown
role/alignment and behavior, but removes the previous role's private packet.
The drawer exposes shown identity controls for every assigned role and an
explicit “Show assigned role” shortcut for ordinary roles. Changing shown role
clears the prior alignment override and private packet. Clearing shown role
withdraws the self record on the next acknowledged sync. Clearing actual role
or changing Traveler status clears identity and packets. New games and
unseated/reused seats start blank; seating with no identity atomically removes
any stale private record before exposing the binding.

Refresh and reconnect read only the authorized published self record.
Storyteller recovery restores explicit perception from the acknowledged
checkpoint, without reinitializing it from actual roles. Retries reuse the
same guarded publication. Removal retains the Firebase-first revocation
boundary.

Existing records with null shown role are deliberately left unrevealed; there
is no migration that guesses their identity from truth. On first successful
sync with this client, stale self projections for such players are removed.
Deploy the updated Storyteller client before using these guarantees in a live
game: older clients still contain the fallback. Already delivered identities
cannot be made secret again; affected games should start fresh.

Deferred: AUD-013 false-role wakes, AUD-027 advanced fake-minion/team packets,
AUD-017 independent alignment/state, and all other night-order, setup,
custom-script, and visual findings. Existing explicitly configured private
packets remain supported, but no automatic false-information delivery is
added.

## Phase 9C.6 (OPUS-002): separate-device Public Display authorization

`?display=public&code=XXXX` used to rely on the projector's anonymous
Firebase identity happening to match the Storyteller's own — true only in a
sibling browser context on the same device, never on a genuinely separate
projector or TV. `displayAccess` (Storyteller-owned capability) and
`displayMembers/{uid}` (a display's own enrollment) replace that with
explicit capability authorization, scoped to `/public` only.

**Capability creation.** Once a live lobby, its session id, and the live
runtime writer are all present, the Storyteller ensures a capability via
`ensurePublicDisplayAccess`. It is read-first: a valid capability for the
current session is reused with zero writes; a capability is (re)created only
when absent, malformed, the wrong version, or bound to a different session.
The token is 32 cryptographically secure random bytes, encoded as unpadded
base64url (43 characters); there is no insecure fallback.

**Fragment link.** The Storyteller's "Copy display link" builds
`?display=public&code=<CODE>#displayToken=<TOKEN>` from the current
origin/path. The token lives in the URL fragment, never an ordinary query
parameter, so it is never sent to a server in a request line. The token
itself is never rendered as visible text.

**Enrollment and UID binding.** A display connects anonymously through the
same `connectFirebase()` every client uses; its authorization UID comes only
from that call, never the URL. If a `#displayToken=` fragment is present and
locally well-formed, the display calls `authorizePublicDisplay`, which writes
`displayMembers/{uid} = token` — accepted only when it exactly equals the
current `displayAccess/token` for an active session. On success the fragment
is stripped from the URL with `history.replaceState`, leaving
`?display=public&code=<CODE>`; a later refresh of that cleaned URL needs no
token, since the UID's own binding already exists. A denied or stale
fragment does not block the normal `/public` subscription attempt — the same
UID may already hold a valid binding from an earlier successful enrollment.

**Rotation.** "Reset display link" always mints and writes a fresh token,
unconditionally. Every existing `displayMembers/{uid}` binding is revoked
immediately (its stored token no longer matches) without being enumerated or
deleted; a display holding an old link loses `/public` access on its very
next read, with no further write required.

**Session-end revocation.** `SessionWriter.close()` preserves the session id
while moving `session/state` to `"ended"` — session-id equality alone is
never enough. Every display authorization and enrollment rule also requires
`session/state === "active"`, so ending the game revokes display access the
same way it revokes everything else.

**Lost anonymous identity.** If the display's anonymous Firebase identity is
lost (cleared site data, a different browser/profile), its existing
`displayMembers/{uid}` binding cannot be recovered — a fresh authorized link
must be reopened from the Storyteller. This is the same anonymous-identity
tradeoff every other role in this protocol already accepts.
