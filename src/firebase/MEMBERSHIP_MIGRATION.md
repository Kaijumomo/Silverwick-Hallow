# AUD-001 / AUD-003 membership rollout

This changes the database protocol. Deploy the rules and updated client in a
coordinated maintenance window. No production migration or deployment is
performed by this implementation.

## Data and authorization

| Path within a lobby | Value | Writers | Readers |
| --- | --- | --- | --- |
| `storytellerUid` | Owner UID | Caller may claim a completely new lobby as themselves; owner may repeat that same value | Authenticated clients |
| `joinRequests/{uid}` | Name, 1–20 characters, no surrounding spaces, tabs or line breaks | That UID may create/cancel its request; ST may delete it | That UID and ST |
| `roster/{uid}` | Authoritative player ID | ST only, including deletion/revocation | That UID and ST |
| `public` | Existing public projection | ST only | ST, pending request UIDs, seated UIDs |
| `player/{playerId}` | Existing private projection | ST only | ST or a UID bound to exactly this player ID in this lobby |

Requests may be created only when an owner exists, the version-2 session is
active, and the requesting UID is not already seated. The Phase-4 session
record, writer lease, monotonic write fence, durable outcomes, and presence
parent authorization are part of the coordinated protocol; legacy lobbies do
not receive an implicit upgrade.

`seatPlayer` atomically removes the request, writes the binding, and writes the
private projection when supplied. A null projection preserves the existing
waiting-for-role behavior. `revokeMembership` deletes only the binding; rules
then deny private reads even if the private record still exists. An authorized
live listener is also cancelled by Firebase after revocation. Previously
downloaded data cannot be recalled from a device.

## Required migration

1. Pause hosting/client access and lobby activity during maintenance. Preserve
   a restricted administrator backup if needed for recovery; it contains secrets.
2. Retire the exact existing lobby nodes using an administrator operation. Do
   not copy old `roster` values into the new model: both names and attacker-chosen
   IDs were writable under the old rules, so neither shape proves authorization.
3. Deploy the updated rules while clients are paused, then publish the matching
   client. Do not deploy the new client while old rules remain active.
4. Clear persisted Storyteller/player lobby sessions on participating devices,
   reload the updated client, and create fresh lobby codes. Old code/session
   reuse is unsupported; every new game gets a new local identity and a new
   multiplayer session when the Storyteller explicitly goes live.
5. Resume service and verify request → manual seating → private read using the
   updated clients. Re-run `npm run test:rules` before deployment.

This is a deliberate hard cutover; there is no legacy-name fallback. Merely
deploying new write rules cannot revoke a forged binding already in the database.
Do not interpret this implementation as verifying or securing an unchanged
production database until the migration is completed.

## Attack regression

An attacker requests the name `p-alice`. This is harmless untrusted display
text in `joinRequests/attacker`. Writing `roster/attacker = p-alice` is denied
because only the lobby owner can write any roster entry. Reading
`player/p-alice` is denied because that lobby has no authoritative binding for
the attacker. The emulator suite verifies direct writes, transactions, ancestor
replacement, and a multi-path request-plus-roster attack.

## Scope intentionally deferred

The Phase-3 seat/revoke commands remain Firebase-first and membership changes
remain outside generic undo. Phase 4 adds the explicit join/reconnect/reject
handshake, app-level sync ownership, ordered end operation, bounded retries,
single-writer lease, and parent presence read. Gameplay/data/style findings
outside these lifecycle concerns remain unchanged.

The dedicated rules command fails if startup fails, setup cannot connect, no
tests execute, any assertion fails, or any test is skipped/pending/todo. Ordinary
unit tests are explicitly separate. The lobby-code unit assertion verifies the
intended eight-character default.
