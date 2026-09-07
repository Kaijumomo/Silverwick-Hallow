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
instead of being trusted. The initial projection is acknowledged before the
writer is exposed to UI controls. Thus an older local snapshot cannot overwrite
newer remote membership or an ended session.

`writeProjections` remains the projection chokepoint. It writes public/private
views, Storyteller state, and a checkpoint containing the game and the
authoritative roster snapshot in one writer-guarded update. Membership commands
are the only intentional lifecycle exceptions.

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
that marks `session.state = ended` and removes roster, requests, leave requests,
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

The protocol intentionally does not address role-deception, night-order,
setup-analyzer, custom-script, or visual/mobile findings from later audit
phases.
