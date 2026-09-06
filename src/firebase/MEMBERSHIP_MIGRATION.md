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

Requests may be created only when an owner exists, `public/status` is not
`ended`, and the requesting UID is not already seated. Absence of a status
continues to mean active. Request cancellation remains possible after end.
No expiry, new lifecycle state machine, or presence-rule redesign is included.

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
   reuse is unsupported; the separate new-game lifecycle finding is deferred.
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

The current seat UI still makes a local assignment before remote acknowledgement;
undo/removal are not connected to membership revocation (AUD-006/AUD-007).
The revocation helper establishes the tested authorization operation without
rewriting those flows. Reject/Leave UI and retry/session handling remain their
existing behavior (AUD-009); the request cancellation helper and rules are ready
for a later UI pass. Parent presence reads (AUD-008), new-game/end-game races
(AUD-005/AUD-010), and all gameplay/data/style findings are unchanged.

The dedicated rules command fails if startup fails, setup cannot connect, no
tests execute, any assertion fails, or any test is skipped/pending/todo. Ordinary
unit tests are explicitly separate. The lobby-code unit assertion verifies the
intended eight-character default.
